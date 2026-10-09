import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import CAPACITY from "@tj/slides/templates/activity-capacity.json" with { type: "json" };
import { getTheme } from "@tj/slides/themes";
import {
  activityDefs,
  activityFaults,
  activityMenu,
  bounds,
  cellFor,
  elementText,
  fitsLine,
  fromWriterActivity,
  WRITER_ACTIVITIES,
  type WriterActivity,
  withActivities,
  withActivityMenu,
} from "./activities";
import { writerBundle } from "./bundle";
import { checkSlide } from "./checks";
import { type Brief, promptStage } from "./fixes";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import { repairable } from "./guards";
import { materialise, type Plan, type VisualState, visualsOf, wordsOf } from "./materialise";
import { type WriterStage, writerSchema } from "./schema";
import type { ChatReq, WriterReq, WriterServices } from "./services";
import { runWriter, writerSystem } from "./stage";

/*
 * TEACH-101 part c: the activity templates as writer layouts. Schema bounds from the measured
 * capacities, the mapping onto the template, the code repair, the shuffle and leak checks, the
 * word-card fallback and the whole writer stage on a fake model.
 */

type S = Record<string, unknown>;
type J = Record<string, unknown>;
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
const brief = fixture.brief as unknown as Brief;
const theme = getTheme("splash", "ks1");
const ctxFor = (visual: (k: string) => VisualState = () => ({ status: "pending" })) => ({
  brief,
  theme,
  stage: "ks1" as const,
  index: 3,
  plan: { slides: [] } as Plan,
  visual,
});
const writerActivity = (id: WriterActivity) =>
  fixture.main.slides.find((s) => s.template === id) as unknown as S;
const photo = (k: string): VisualState => ({
  status: "photo",
  photo: { src: `/files/${k}.jpg`, alt: k, aspect: 4 / 3 },
});

/** A strict-mode subset validator: what the writer's schema uses, nothing more. */
function validate(schema: J, v: unknown, root: J = schema, path = "$"): string[] {
  if (schema.$ref) {
    const name = String(schema.$ref).replace("#/$defs/", "");
    return validate((root.$defs as Record<string, J>)[name] as J, v, root, path);
  }
  if (schema.anyOf) {
    const each = (schema.anyOf as J[]).map((x) => validate(x, v, root, path));
    return each.some((e) => e.length === 0) ? [] : [`${path}: no anyOf branch (${each[0]?.[0]})`];
  }
  if (schema.enum && !(schema.enum as unknown[]).includes(v)) return [`${path}: not in enum`];
  const t = schema.type;
  if (t === "null") return v === null ? [] : [`${path}: not null`];
  if (t === "string") {
    if (typeof v !== "string") return [`${path}: not a string`];
    return typeof schema.maxLength === "number" && v.length > schema.maxLength
      ? [`${path}: over ${schema.maxLength}`]
      : [];
  }
  if (t === "integer" || t === "number") {
    if (typeof v !== "number" || (t === "integer" && !Number.isInteger(v)))
      return [`${path}: not a ${t}`];
    if (typeof schema.minimum === "number" && v < schema.minimum) return [`${path}: low`];
    if (typeof schema.maximum === "number" && v > schema.maximum) return [`${path}: high`];
    return [];
  }
  if (t === "boolean") return typeof v === "boolean" ? [] : [`${path}: not a boolean`];
  if (t === "array") {
    if (!Array.isArray(v)) return [`${path}: not an array`];
    if (typeof schema.minItems === "number" && v.length < schema.minItems) return [`${path}: few`];
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) return [`${path}: many`];
    return v.flatMap((x, k) => validate(schema.items as J, x, root, `${path}[${k}]`));
  }
  if (t === "object") {
    if (!v || typeof v !== "object") return [`${path}: not an object`];
    const props = (schema.properties ?? {}) as Record<string, J>;
    const o = v as S;
    const missing = (schema.required as string[]).filter((k) => !(k in o));
    const extra = Object.keys(o).filter((k) => !(k in props));
    return [
      ...missing.map((k) => `${path}.${k}: missing`),
      ...extra.map((k) => `${path}.${k}: extra`),
      ...Object.entries(props).flatMap(([k, p]) =>
        k in o ? validate(p, o[k], root, `${path}.${k}`) : [],
      ),
    ];
  }
  return [];
}

/** Every object in a schema is strict: all keys required, no others. */
function strictObjects(x: unknown, out: string[] = [], path = "$"): string[] {
  if (Array.isArray(x)) {
    for (const [k, y] of x.entries()) strictObjects(y, out, `${path}[${k}]`);
  } else if (x && typeof x === "object") {
    const o = x as J;
    if (o.type === "object") {
      const keys = Object.keys((o.properties ?? {}) as J).sort();
      if (o.additionalProperties !== false) out.push(`${path}: additionalProperties`);
      if (JSON.stringify([...((o.required as string[]) ?? [])].sort()) !== JSON.stringify(keys))
        out.push(`${path}: required`);
    }
    for (const [k, v] of Object.entries(o)) strictObjects(v, out, `${path}.${k}`);
  }
  return out;
}

describe("schema", () => {
  test("the five families join the slides and cards joins the flow's looks, strict throughout", () => {
    for (const st of STAGES) {
      const s = withActivities(writerSchema(st, { min: 9, max: 12 }), st);
      const refs = ((s.properties as J).slides as { items: { anyOf: J[] } }).items.anyOf.map(
        (r) => r.$ref,
      );
      for (const id of WRITER_ACTIVITIES) expect(refs).toContain(`#/$defs/${id}`);
      expect(refs).not.toContain("#/$defs/label");
      expect(JSON.stringify(s)).toContain('"cards"]');
      expect(strictObjects(activityDefs(st))).toEqual([]);
    }
    // Off, the schema is the pinned one byte for byte.
    expect(JSON.stringify(writerSchema("KS2", { min: 9, max: 12 }))).not.toContain("group-sort");
  });

  test("bounds are the measured variants with a cell of 8 characters or more", () => {
    expect(bounds("pair", "KS1").cards).toEqual([3, 4]);
    expect(bounds("pair", "KS2").cards).toEqual([3, 5]);
    expect(bounds("group-sort", "KS1")).toEqual({ cards: [6, 6], groups: [2, 2], chars: 8 });
    expect(bounds("group-sort", "KS3-5")).toEqual({ cards: [6, 8], groups: [2, 3], chars: 12 });
    expect(bounds("sequence", "KS1").cards).toEqual([4, 4]);
    expect(bounds("choose", "KS3-5")).toEqual({ cards: [2, 4], chars: 60 });
    const table = CAPACITY as unknown as Record<string, Record<string, Record<string, number>>>;
    expect(cellFor("odd-one-out", "KS2", 4)).toBe(table["odd-one-out"]?.KS2?.["4 cards"] as number);
    const def = activityDefs("KS1").pair as J;
    const card = ((def.properties as J).cards as J).items as J;
    expect((card.properties as J).picture).toEqual({ type: "string" });
    expect(((card.properties as J).label as J).maxLength).toBe(22);
  });

  test("the fixture lesson is a valid strict answer to the KS1 schema", () => {
    const s = withActivities(writerSchema("KS1", fixture.brief.slides), "KS1");
    expect(validate(s, fixture.main)).toEqual([]);
    const tooMany = {
      ...writerActivity("pair"),
      cards: Array(5).fill({ label: "a", picture: "b" }),
    };
    expect(
      validate(s, {
        ...fixture.main,
        slides: fixture.main.slides.map((x, k) => (k === 3 ? tooMany : x)),
      }).join(),
    ).toContain("no anyOf");
  });
});

describe("menu", () => {
  test("fits are rendered per stage from the capacity table; label is not offered", () => {
    expect(fitsLine("pair", "KS1")).toBe("3 cards, labels up to 22 characters; 4 cards, 16");
    expect(fitsLine("group-sort", "KS2")).toBe(
      "6 cards in 2 or 3 groups, labels up to 10 characters",
    );
    expect(fitsLine("group-sort", "KS3-5")).toBe(
      "6 to 8 cards in 2 or 3 groups, labels up to 12 characters",
    );
    for (const st of STAGES) {
      const m = activityMenu(st);
      expect(m).not.toContain("{fits");
      expect(m).not.toContain("- label:");
      expect(m.startsWith("Activity layouts.")).toBe(true);
    }
  });

  test("the menu goes after the last layout, before the pictures; off, the system is pinned", () => {
    const sys = writerSystem(brief, writerBundle());
    const on = withActivityMenu(sys, "KS1");
    expect(on.indexOf("- exit-ticket:")).toBeLessThan(on.indexOf("Activity layouts."));
    expect(on.indexOf("Activity layouts.")).toBeLessThan(on.indexOf("Pictures and diagrams:"));
    expect(on.replace(`\n\n${activityMenu("KS1")}`, "")).toBe(sys);
  });
});

describe("mapping and code repair", () => {
  test("every family maps to the template's fields, 1-based indices to 0-based", () => {
    const pair = fromWriterActivity(writerActivity("pair"), "KS1").slide;
    expect(pair.cards).toEqual([
      {
        text: "chick",
        picture: {
          shows: "a fluffy yellow chick",
          must_see: ["a fluffy yellow chick"],
          subject: "generic",
        },
      },
      expect.anything(),
      expect.anything(),
    ]);
    const gs = fromWriterActivity(writerActivity("group-sort"), "KS1").slide;
    expect(gs.groups).toEqual(["Baby", "Grown-up"]);
    expect((gs.cards as { group: number }[]).map((c) => c.group)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(gs.lead).toBe("Sort the cards.");
    const seq = fromWriterActivity(writerActivity("sequence"), "KS1").slide;
    expect((seq.cards as { text: string }[]).map((c) => c.text)).toEqual([
      "frogspawn",
      "tadpole",
      "froglet",
      "frog",
    ]);
    const ch = fromWriterActivity(writerActivity("choose"), "KS1").slide;
    expect(ch.correct).toBe(2);
    const odd = fromWriterActivity(writerActivity("odd-one-out"), "KS1").slide;
    expect(odd).toMatchObject({ correct: 3, explanation: "The others are all babies." });
    // A word card (no picture phrase) asks for no picture.
    const words = fromWriterActivity(
      {
        ...writerActivity("choose"),
        cards: [
          { label: "2/4", picture: null },
          { label: "3/4", picture: null },
        ],
      },
      "KS2",
    ).slide;
    expect(visualsOf(words, 3, ctxFor())).toEqual([]);
    // Card pictures go to the director as one set.
    const asks = visualsOf(pair, 3, ctxFor());
    expect(asks.map((a) => (a.type === "photo" ? a.set : "x"))).toEqual([
      "cards",
      "cards",
      "cards",
    ]);
    // Activities are repaired by code only.
    expect(repairable(pair, 3)).toBe(false);
  });

  test("capacity: over the stage's count, never the answer; a long word takes a smaller count", () => {
    const five = { label: "x", picture: "y" };
    const pair = fromWriterActivity(
      { ...writerActivity("pair"), cards: Array(5).fill(five) },
      "KS1",
    );
    expect((pair.slide.cards as unknown[]).length).toBe(4);
    const choose = fromWriterActivity(
      {
        template: "choose",
        heading: "Which one?",
        instruction: null,
        cards: ["aa", "bb", "cc", "dd", "ee"].map((label) => ({ label, picture: null })),
        correct: 5,
        explanation: null,
      },
      "KS1",
    );
    expect((choose.slide.cards as { text: string }[]).map((c) => c.text)).toEqual([
      "aa",
      "bb",
      "cc",
      "ee",
    ]);
    expect(choose.slide.correct).toBe(4);
    // 18 characters do not fit 4 KS1 pair cards (16) but fit 3 (22).
    const long = fromWriterActivity(
      {
        ...writerActivity("pair"),
        cards: ["a fluffy chick abc", "lamb", "calf", "tadpole"].map((label) => ({
          label,
          picture: label,
        })),
      },
      "KS1",
    );
    expect((long.slide.cards as unknown[]).length).toBe(3);
    expect(long.fixes.join()).toContain("characters");
    // A group sort drops from its fullest group, never empties one.
    const gs = fromWriterActivity(
      {
        ...writerActivity("group-sort"),
        cards: [1, 1, 1, 1, 1, 2, 2].map((group, k) => ({ label: `c${k}`, picture: null, group })),
      },
      "KS1",
    );
    const groups = (gs.slide.cards as { group: number }[]).map((c) => c.group);
    expect(groups.length).toBe(6);
    expect(groups.filter((g) => g === 1).length).toBe(2);
    // A card in no group is dropped.
    const bad = fromWriterActivity(
      { ...writerActivity("group-sort"), cards: [{ label: "x", picture: null, group: 3 }] },
      "KS1",
    );
    expect(bad.fixes).toContain("card 1 in no group");
  });
});

describe("checks on the laid-out slide", () => {
  const laid = (id: WriterActivity, over: S = {}, visual = photo) => {
    const s = { ...fromWriterActivity(writerActivity(id), "KS1").slide, ...over };
    return { s, m: materialise(s, ctxFor(visual)) };
  };

  test("every family lays out with its answer to reveal and no leak", () => {
    for (const id of WRITER_ACTIVITIES) {
      const { s, m } = laid(id);
      expect(m.slide.question).toBeDefined();
      expect(activityFaults(s, m.slide)).toEqual([]);
    }
  });

  test("an answer in the heading or the reveal's words on the slide is a leak", () => {
    const { s, m } = laid("choose", { heading: "Which baby is the chick?" });
    expect(activityFaults(s, m.slide).join()).toContain('the answer "chick"');
    const odd = laid("odd-one-out", { lead: "The others are all babies." });
    expect(activityFaults(odd.s, odd.m.slide).join()).toContain("explanation is on the slide");
  });

  test("a shown order that gives the answer away is a leak", () => {
    const { s, m } = laid("sequence");
    const q = m.slide.question as Extract<NonNullable<Slide["question"]>, { type: "sort" }>;
    const byId = new Map(m.slide.elements.map((e) => [e.id, e]));
    // Put the markers back in written order, left to right.
    const elements = m.slide.elements.map((e) => {
      const k = q.order.indexOf(e.id);
      return k < 0 ? e : { ...e, x: 100 + 150 * k, y: byId.get(q.order[0] as string)?.y ?? 0 };
    });
    expect(activityFaults(s, { ...m.slide, elements }).join()).toContain("leak: the sequence");
    const pair = laid("pair");
    const pq = pair.m.slide.question as Extract<
      NonNullable<Slide["question"]>,
      { type: "image-match" }
    >;
    const p0 = pq.pairs[0] as { imageId: string; labelId: string };
    const img = pair.m.slide.elements.find((e) => e.id === p0.imageId);
    const moved = pair.m.slide.elements.map((e) =>
      e.id === p0.labelId && img ? { ...e, x: img.x + img.w / 2 - e.w / 2 } : e,
    );
    expect(activityFaults(pair.s, { ...pair.m.slide, elements: moved }).join()).toContain(
      "under its own picture",
    );
  });

  test("a failed picture becomes a word card; a 'look at' line over word cards is dangling", () => {
    for (const id of WRITER_ACTIVITIES) {
      const { s, m } = laid(id, { lead: "Look at the pictures." }, () => ({ status: "failed" }));
      expect(m.slide.elements.some((e) => e.type === "image")).toBe(false);
      expect(m.slide.question).toBeDefined();
      const words = m.slide.elements.map(elementText).join(" ");
      for (const c of s.cards as { text: string }[]) expect(words).toContain(c.text);
      const check = checkSlide({
        index: 3,
        slide: m.slide,
        over: m.over,
        questions: [],
        answers: undefined,
        notesChecked: false,
        words: wordsOf(s),
      });
      expect(check.faults.some((f) => f.startsWith("dangling:"))).toBe(true);
    }
    // A pair of word cards is a word-to-word matching question.
    const pair = laid("pair", {}, () => ({ status: "failed" }));
    expect(pair.m.slide.question?.type).toBe("matching");
  });
});

describe("the writer stage on a fake model", () => {
  const services = (seen: { writer?: WriterReq; chats: ChatReq[] }): WriterServices => ({
    log: () => {},
    writer: async (req) => {
      seen.writer = req;
      return { text: JSON.stringify(fixture.main), usd: 0, ms: 1, finishReason: "stop" } as never;
    },
    chat: async (req) => {
      seen.chats.push(req);
      throw new Error("no notes in this run");
    },
  });

  test("activities on: the menu and schema go to the writer, each activity slide has its reveal", async () => {
    const seen: { writer?: WriterReq; chats: ChatReq[] } = { chats: [] };
    const out = await runWriter({
      brief,
      objectives: fixture.objectives,
      services: services(seen),
      activities: true,
      pupilWording: false,
      visual: (_i, key) => photo(key),
    });
    expect(seen.writer?.system).toContain(activityMenu(promptStage(brief.keyStage)));
    expect(JSON.stringify(seen.writer?.schema)).toContain('"odd-one-out"');
    const acts = out.slides.slice(5, 10);
    expect(acts.map((s) => s.question?.type)).toEqual([
      "image-match",
      "fill-gap",
      "sort",
      "multiple-choice",
      "multiple-choice",
    ]);
    const faults = out.checks.slice(5).flatMap((c) => c.faults);
    expect(faults.filter((f) => /^(leak|activity):/.test(f))).toEqual([]);
  });

  test("activities off (the default): neither the menu nor the schema has them", async () => {
    const seen: { writer?: WriterReq; chats: ChatReq[] } = { chats: [] };
    await runWriter({
      brief,
      objectives: fixture.objectives,
      services: services(seen),
      pupilWording: false,
    }).catch(() => undefined);
    expect(seen.writer?.system).not.toContain("Activity layouts.");
    expect(JSON.stringify(seen.writer?.schema)).not.toContain('"group-sort"');
  });
});

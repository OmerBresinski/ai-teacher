import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DIAGRAM_SAMPLES } from "@tj/slides/diagrams";
import { ICON_CONCEPTS, resolveIcon } from "@tj/slides/icons";
import type { FieldReport } from "@tj/slides/templates";
import { SPLIT_SIDE_DIAGRAM_KINDS } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import {
  LAYOUT_WRITER_MENUS,
  layoutFieldCaps,
  layoutOffer,
  listCaps,
  menuWords,
} from "./layout-menu";
import { materialise, type Plan, pilotFit, visualsOf } from "./materialise";
import {
  carryFigures,
  fitPilot,
  pilotOvers,
  pilotSlips,
  sentenceCut,
  trimPilot,
  writerPath,
} from "./pilot-fit";
import {
  layoutIconNames,
  PILOT_PACK_ID,
  PILOT_PACKS,
  pilotRepairSchema,
  pilotRequest,
  stripStringCaps,
  withPatches,
} from "./pilot-pack";
import { slotFillArrival } from "./slot-fill";

/*
 * TEACH-110 part s: the writer's pilot slides are measured at their drawn size and never ship
 * clipped (one bounded repair, else a code trim), and every pilot layout reaches the editor as a
 * layout group with its pictures asked for and placed.
 */
type S = Record<string, unknown>;
const brief = { ...sampleBriefLesson().brief, keyStage: "KS2" } as never;
const base = { brief, theme: getTheme("paper", "ks2"), stage: "ks2" as never };
const pending = () => ({ status: "pending" }) as const;
const ctxAt = (index: number, slides: S[] = []) => ({
  ...base,
  index,
  plan: { slides } as unknown as Plan,
  visual: pending,
});
const long =
  "The heart is a strong muscle that pumps blood around the whole body, through arteries, capillaries and veins, all day and all night without ever stopping to rest.";
const pic = (shows: string) => ({ shows, must_see: [shows], subject: "generic" });

const row: S = {
  template: "items-row",
  heading: "Three parts working together",
  accentWord: null,
  lead: null,
  ordered: false,
  items: [
    { name: "Heart", text: long, icon: "heart" },
    { name: "Blood", text: "Blood carries oxygen.", icon: null },
    { name: "Vessels", text: "Tubes carry the blood.", icon: null },
  ],
};
const panel: S = {
  template: "panel-list",
  heading: "Rock properties",
  accentWord: null,
  lead: null,
  panel: null,
  items: [
    { name: "Appearance", text: long, icon: null },
    { name: "Texture", text: "How it feels.", icon: null },
    { name: "Hardness", text: "How hard it is to scratch.", icon: null },
  ],
};
const split: S = {
  template: "split-compare",
  heading: "Arteries vs veins",
  accentWord: null,
  sides: [
    { title: "Arteries", text: `${long} ${long}`, quote: null, picture: null },
    { title: "Veins", text: "Veins carry blood back to the heart.", quote: null, picture: null },
  ],
};
const pictured = (names: string[]): S => ({
  template: "panel-list",
  heading: "Adapted to survive",
  accentWord: null,
  lead: null,
  panel: null,
  items: names.map((n) => ({
    name: n,
    text: `${n} is adapted to where it lives.`,
    picture: pic(n),
  })),
});

describe("measured at the drawn size", () => {
  test("an over-long field is found by the writer's own path", () => {
    expect(pilotOvers(row, ctxAt(3)).overs.map((o) => o.path)).toContain("items.0.text");
    expect(pilotOvers(panel, ctxAt(3)).overs.map((o) => o.path)).toContain("items.0.text");
    expect(pilotOvers(split, ctxAt(3)).overs.map((o) => o.path)).toContain("sides.0.text");
  });
  test("a slide written to its caps has nothing over", () => {
    const short = { ...row, items: (row.items as S[]).map((i) => ({ ...i, text: "Short line." })) };
    expect(pilotOvers(short, ctxAt(3))).toEqual({ overs: [], tooMany: false });
  });
  test("laid paths map back to the writer's", () => {
    expect(writerPath("panel-list", "panel-list", "rows.2.text")).toBe("items.2.text");
    expect(writerPath("side-by-side", "panel-list", "sides.1.title")).toBe("items.1.name");
    expect(writerPath("side-by-side", "panel-list", "sides.1.text")).toBe("items.1.text");
    expect(writerPath("split-compare", "split-compare", "sides.0.text")).toBe("sides.0.text");
  });
});

const fixedRow = (): S => ({
  ...row,
  items: (row.items as S[]).map((i) => ({ ...i, text: "Short line." })),
});

describe("the code step cuts whole sentences only", () => {
  test("a sentence cut, or nothing: never a clause or a word", () => {
    expect(sentenceCut("One fact here. Another fact follows on.", 20)).toBe("One fact here.");
    expect(sentenceCut("Blood flows round, carrying oxygen to every cell.", 26)).toBeUndefined();
    // live3 s5: "…pass between blood." changed what the slide says
    const cap = "Tiny, thin-walled vessels where substances pass between blood and cells.";
    expect(sentenceCut(cap, 70)).toBeUndefined();
    expect(sentenceCut("Short.", 20)).toBe("Short.");
  });
  test("one long sentence is kept whole and the slide is still over", () => {
    const t = trimPilot(row, ctxAt(3));
    expect(t.ok).toBe(false);
    expect(t.kept).toContain("items.0.text");
    expect((t.slide.items as S[])[0]?.text).toBe(long);
  });
  test("two sentences: the second goes, the first stays whole", () => {
    const two = {
      ...row,
      items: (row.items as S[]).map((i, n) =>
        n === 0 ? { ...i, text: `The heart pumps blood. ${long}` } : i,
      ),
    };
    const t = trimPilot(two, ctxAt(3));
    expect((t.slide.items as S[])[0]?.text).toBe("The heart pumps blood.");
    expect(t.ok).toBe(true);
  });
  test("a field past its comfort cap that still shows whole is never touched", async () => {
    const words = {
      ...row,
      items: (row.items as S[]).map((i, n) =>
        n === 0 ? { ...i, text: "Pumps blood to the lungs and the body, all day long." } : i,
      ),
    };
    const o = pilotOvers(words, ctxAt(3)).overs;
    if (o.length && !o.some((x) => x.clipped)) {
      const r = await fitPilot(words, ctxAt(3));
      expect(r.path).toBe("tight");
      expect(r.slide).toEqual(words);
    }
  });
  test("too many members are never cut by code", () => {
    const seven = {
      ...panel,
      items: Array.from({ length: 7 }, (_, n) => ({ name: `R${n}`, text: "x", icon: null })),
    };
    const t = trimPilot(seven, ctxAt(3), 6);
    expect((t.slide.items as S[]).length).toBe(7);
    expect(t.ok).toBe(false);
  });
});

describe("members past the layout's most", () => {
  test("a row with more items than it holds is re-laid as a panel list, every item kept", async () => {
    const five = {
      ...fixedRow(),
      items: Array.from({ length: 5 }, (_, n) => ({
        name: `Part ${n}`,
        text: "Short line.",
        icon: null,
      })),
    };
    expect(pilotOvers(five, ctxAt(3)).tooMany).toBe(true);
    const r = await fitPilot(five, ctxAt(3));
    expect(r.path).toBe("relaid");
    expect(r.slide.template).toBe("panel-list");
    expect((r.slide.items as S[]).map((i) => i.name)).toEqual(
      (five.items as S[]).map((i) => i.name),
    );
  });
  test("members no layout holds stay whole and are flagged, never dropped", async () => {
    const seven = {
      ...panel,
      items: Array.from({ length: 7 }, (_, n) => ({ name: `R${n}`, text: "x", icon: null })),
    };
    const r = await fitPilot(seven, ctxAt(3));
    expect(r.membersOver).toBe(true);
    expect(r.path).toBe("still-over");
    expect((r.slide.items as S[]).length).toBe(7);
  });
});

describe("slips the strict decoder lets through", () => {
  test("a stray script letter, a title cut mid-phrase and its tail in the text are found", () => {
    const slips = pilotSlips({
      template: "split-compare",
      heading: "Two ways 水",
      sides: [
        { title: "What mummification", text: "could do: keep the body.", picture: null },
        { title: "Burial", text: "Kept bodies in sand.", picture: null },
      ],
    });
    expect(slips.some((x) => x.startsWith("stray script: heading"))).toBe(true);
    expect(slips.some((x) => x.startsWith("split title: sides.0.text"))).toBe(true);
    expect(pilotSlips({ template: "items-row", items: [{ name: "Flow of", text: "A." }] })).toEqual(
      ["split title: items.0.name ends mid-phrase: name it whole"],
    );
    expect(pilotSlips(fixedRow())).toEqual([]);
  });
  test("slips go to the one repair call with the over fields", async () => {
    let seen: string[] = [];
    const slipped = { ...fixedRow(), heading: "Parts 心" };
    const r = await fitPilot(slipped, ctxAt(3), async (_s, f) => {
      seen = f;
      return fixedRow();
    });
    expect(seen.some((x) => x.startsWith("stray script"))).toBe(true);
    expect(r.path).toBe("repaired");
  });
});

describe("one repair, then whole sentences", () => {
  const fixed = { ...row, items: (row.items as S[]).map((i) => ({ ...i, text: "Short line." })) };
  test("a slide that fits is never sent", async () => {
    let calls = 0;
    const r = await fitPilot(fixed, ctxAt(3), async () => {
      calls++;
      return undefined;
    });
    expect(r.path).toBe("fits");
    expect(calls).toBe(0);
  });
  test("a first repair that fits is kept; it sees each over field in characters", async () => {
    let seen: string[] = [];
    const r = await fitPilot(row, ctxAt(3), async (_s, faults) => {
      seen = faults;
      return fixed;
    });
    expect(r.path).toBe("repaired");
    expect(r.slide).toEqual(fixed);
    expect(seen.some((f) => /^overflow: items\.0\.text is \d+ characters/.test(f))).toBe(true);
  });
  test("one call per slide: a clipped field is asked for in its exact budget, never a second call", async () => {
    const calls: string[][] = [];
    const r = await fitPilot(row, ctxAt(3), async (s, faults) => {
      calls.push(faults);
      return s;
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatch(
      /^overflow: items\.0\.text is \d+ characters: rewrite it whole, as a complete sentence, in at most \d+ characters$/,
    );
    expect(r.path).toBe("still-over");
  });
  test("the call fails, changes layout or stays over: the long sentence is left whole, still over", async () => {
    for (const out of [{ template: "explain", heading: "x" }, undefined, row] as (
      | S
      | undefined
    )[]) {
      const r = await fitPilot(row, ctxAt(3), async () => out);
      expect(r.path).toBe("still-over");
      expect((r.slide.items as S[])[0]?.text).toBe(long);
      expect(r.steps.at(-1)).toContain("kept whole items.0.text");
    }
    const thrown = await fitPilot(row, ctxAt(3), async () => {
      throw new Error("timeout");
    });
    expect(thrown.path).toBe("still-over");
  });
  test("no budget: straight to the code step", async () => {
    // Over the slide's own measured fit, not only the capacity table: every row runs past what the
    // column holds at the floors (a single long row now fits whole and is only tight, TEACH-75 part ao).
    const over: S = {
      ...panel,
      items: (panel.items as { name: string }[]).map((it) => ({ ...it, text: `${long} ${long}` })),
    };
    expect(pilotOvers(over, ctxAt(3)).overs.some((o) => o.clipped)).toBe(true);
    expect((await fitPilot(over, ctxAt(3))).steps).toHaveLength(1);
  });
  // TEACH-110 part x: the writer is offered every icon the matcher knows, built per request from
  // the catalogue (pilot set + LAYOUT_CONCEPTS), never a frozen list in the pack.
  test("the icon names are the matcher's whole catalogue", () => {
    const want = layoutIconNames();
    expect(want).toHaveLength(201);
    // One name per concept, in catalogue order: its label, or its id when the label needs a subject.
    expect(want).toEqual(
      ICON_CONCEPTS.map((c) =>
        want.includes(c.label.toLowerCase()) ? c.label.toLowerCase() : c.id,
      ),
    );
    expect(want).toContain("root");
    for (const ks of ["KS1", "KS2", "KS3"]) {
      const { schema } = pilotRequest(PILOT_PACK_ID, ks, {}, (sc) => sc);
      const icon = schema.$defs["layout-icon"];
      expect(icon.anyOf[0].enum).toEqual(want);
      expect(icon.anyOf[1]).toEqual({ type: "null" });
    }
    expect(layoutIconNames()).toEqual(expect.arrayContaining(["warmth", "fair test", "beaker"]));
  });
  test("every icon name resolves to its drawing with no subject given", () => {
    const ids = new Set(ICON_CONCEPTS.map((c) => c.id));
    const miss = layoutIconNames().filter((n) => !ids.has(resolveIcon(n) ?? ""));
    expect(miss).toEqual([]);
    expect(resolveIcon("roots")).toBeNull();
  });
  test("the repair schema carries only what the slide's own layout reaches", () => {
    const { schema } = pilotRequest("v4.5", "KS2", {}, (sc) => sc);
    const repair = {
      type: "object",
      properties: { fix: { type: "string" }, slide: {}, to_notes: { type: "array" } },
      $defs: { explain: { type: "object" } },
    };
    const out = pilotRepairSchema(repair, schema, "items-row");
    expect(Object.keys(out.$defs).sort()).toEqual(["items-row", "layout-icon"]);
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(schema).length / 5);
    const sc = pilotRepairSchema(repair, schema, "split-compare");
    expect(Object.keys(sc.$defs)).toContain("split-compare");
    expect(Object.keys(sc.$defs)).not.toContain("explain");
  });
});

describe("the generation path reaches the editor as layout groups (TEACH-110 part s)", () => {
  type G = {
    id: string;
    type: string;
    layout?: { template: string };
    children?: { id: string; type: string; src?: string }[];
  };
  const group = (
    s: S,
    index = 3,
    slides: S[] = [],
    visual = pending as unknown as (k: string) => never,
  ) => materialise(s, { ...ctxAt(index, slides), visual }).slide.elements as unknown as G[];
  const sbsDeck = [
    pictured(["Igneous", "Sedimentary", "Metamorphic"]),
    pictured(["Leaf", "Cactus"]),
  ];
  for (const [name, s, idx, deck, want] of [
    ["items-row", row, 3, [], "items-row"],
    ["panel-list", panel, 3, [], "panel-list"],
    ["split-compare", split, 3, [], "split-compare"],
    ["pictured panel-list", sbsDeck[1], 1, sbsDeck, "panel-list"],
  ] as const)
    test(`${name}: one group, its template kept, id from the slide's place`, () => {
      const els = group(s as S, idx, deck as unknown as S[]);
      expect(els).toHaveLength(1);
      expect(els[0]?.type).toBe("group");
      expect(els[0]?.layout?.template).toBe(want);
      expect(els[0]?.id).toBe(`d-s${idx + 1}-layout`);
      expect(els[0]?.children?.every((c) => c.id.startsWith(`d-s${idx + 1}-layout:`))).toBe(true);
    });

  test("row, panel and side pictures are asked for by key", () => {
    const keys = (s: S) => visualsOf(s, 3, { ...ctxAt(3) } as never).map((a) => a.key);
    expect(keys(pictured(["Leaf", "Cactus", "Fern"]))).toEqual(["row.0", "row.1", "row.2"]);
    expect(keys({ ...panel, panel: { picture: pic("granite") } })).toEqual(["panel"]);
    const sides = {
      ...split,
      sides: (split.sides as S[]).map((d, n) => ({ ...d, picture: pic(`s${n}`) })),
    };
    expect(keys(sides)).toEqual(["side.0", "side.1"]);
  });

  test("a landed row or side picture is drawn in the group", () => {
    const photo = (k: string) =>
      ({
        status: "photo",
        photo: { src: `https://img/${k}.jpg`, alt: k, aspect: 1.5, request: k },
      }) as never;
    const srcs = (els: G[]) => (els[0]?.children ?? []).flatMap((c) => (c.src ? [c.src] : []));
    expect(srcs(group(pictured(["Leaf", "Cactus", "Fern"]), 3, [], photo))).toEqual(
      expect.arrayContaining(["https://img/row.0.jpg", "https://img/row.2.jpg"]),
    );
    expect(srcs(group(sbsDeck[1] as S, 1, sbsDeck, photo))).toEqual(
      expect.arrayContaining(["https://img/row.0.jpg", "https://img/row.1.jpg"]),
    );
    const sides = {
      ...split,
      sides: (split.sides as S[]).map((d, n) => ({ ...d, picture: pic(`s${n}`) })),
    };
    expect(srcs(group(sides, 3, [], photo))).toEqual(
      expect.arrayContaining(["https://img/side.0.jpg", "https://img/side.1.jpg"]),
    );
  });

  // TEACH-110 part x: a side's diagram, bare (`{kind…}`) or wrapped (`{diagram: {kind…}}`, as
  // a-hinge-y9-forces s6 stored it), is asked for and drawn, never dropped to text.
  test("a split compare side's diagram is asked for and drawn in the group", () => {
    const dia = (n: number) => ({
      kind: "labelled-diagram",
      shows: `forces ${n}`,
      labels: ["Weight"],
    });
    const drawn = (k: string) =>
      ({
        status: "diagram",
        spec: { drawn: { src: `https://img/${k}.svg`, aspect: 1.5, alt: k, bare: true } },
      }) as never;
    const srcs = (els: G[]) => (els[0]?.children ?? []).flatMap((c) => (c.src ? [c.src] : []));
    for (const wrap of [(n: number) => dia(n), (n: number) => ({ diagram: dia(n) })]) {
      const sides = {
        ...split,
        sides: (split.sides as S[]).map((d, n) => ({ ...d, text: "Short.", picture: wrap(n) })),
      };
      const asks = visualsOf(sides, 3, { ...ctxAt(3) } as never);
      expect(asks.map((a) => [a.key, a.type])).toEqual([
        ["side.0", "diagram"],
        ["side.1", "diagram"],
      ]);
      expect(srcs(group(sides, 3, [], drawn))).toEqual(
        expect.arrayContaining(["https://img/side.0.svg", "https://img/side.1.svg"]),
      );
    }
  });

  // TEACH-110 part ad: the live drawer hands back the spec itself (`{status: "diagram", spec}`, no
  // pre-drawn `drawn`), so the side is `{diagram: spec}`. A side draws it only for a kind that reads
  // cleanly at side size (SPLIT_SIDE_DIAGRAM_KINDS); the forces lesson's labelled drawings crowded
  // there, so its sides stay words, as before, never a crowded sketch.
  const live = JSON.parse(
    readFileSync(new URL("./fixtures/split-side-diagrams.json", import.meta.url), "utf8"),
  ) as Record<string, S>;
  const sideSvgs = (s: S, specs: unknown[]) => {
    const drawer = ((k: string) => ({
      status: "diagram",
      spec: specs[Number(k.split(".")[1])],
    })) as unknown as (k: string) => never;
    const m = materialise(s, { ...ctxAt(3), visual: drawer });
    expect(m.diagram).toBeUndefined();
    const kids = (m.slide.elements as unknown as G[])[0]?.children ?? [];
    return kids.filter(
      (c) => c.type === "image" && (c.src ?? "").startsWith("data:image/svg"),
    ) as unknown as { x: number; w: number }[];
  };
  for (const [name, s] of Object.entries(live))
    test(`a-hinge-y9-forces ${name}: labelled drawings stay words at side size`, () => {
      const specs = (s.sides as S[]).map((d) => (d.picture as S).diagram);
      expect(visualsOf(s, 3, { ...ctxAt(3) } as never).map((a) => [a.key, a.type])).toEqual([
        ["side.0", "diagram"],
        ["side.1", "diagram"],
      ]);
      expect(specs.every((d) => !SPLIT_SIDE_DIAGRAM_KINDS.includes(String((d as S).kind)))).toBe(
        true,
      );
      expect(sideSvgs(s, specs)).toHaveLength(0);
    });
  for (const kind of SPLIT_SIDE_DIAGRAM_KINDS.filter((k) => k === "venn" || k === "particles"))
    test(`a ${kind} side pair is drawn, one in each half`, () => {
      const spec = DIAGRAM_SAMPLES[kind] as S;
      const s = {
        ...(live["20261016-1221-s5"] as S),
        sides: ((live["20261016-1221-s5"] as S).sides as S[]).map((d) => ({
          ...d,
          picture: { diagram: spec },
        })),
      };
      const pics = sideSvgs(s, [spec, spec]);
      expect(pics).toHaveLength(2);
      const [a, b] = [...pics].sort((p, q) => p.x - q.x);
      expect((a?.x ?? 0) + (a?.w ?? 0)).toBeLessThanOrEqual(480);
      expect(b?.x ?? 0).toBeGreaterThanOrEqual(480);
    });
});

describe("slot-fill reads a pilot slide as written, not as a writer fault (TEACH-110 part s)", () => {
  const { schema } = pilotRequest("v4.4", "KS2", {}, (sc) => sc);
  const short = (s: S, key: string, field: string) => ({
    ...s,
    [key]: (s[key] as S[]).map((i) => ({ ...i, [field]: "A short line." })),
  });
  for (const [name, s] of [
    ["items-row", { ...short(row, "items", "text"), motif: null }],
    [
      "panel-list",
      (({ accentWord: _a, ...p }) => ({
        ...p,
        items: (short(panel, "items", "text").items as S[]).map((i) => ({ ...i, picture: null })),
      }))(panel),
    ],
    ["split-compare", short(split, "sides", "text")],
  ] as const)
    test(`${name}: no fit, no breach, fields read against its own def`, () => {
      const a = slotFillArrival(s as S, "KS2", schema);
      expect(a.breaches).toEqual([]);
      expect(a.route).toBe("as-written");
      expect(a.fields.length).toBeGreaterThan(0);
    });
  test("an old layout without its fit is still a writer fault", () => {
    const a = slotFillArrival(
      { template: "explain", heading: "x", lead: "y", points: [] },
      "KS2",
      schema,
    );
    expect(a.breaches).toContain("fit: missing");
  });
});

test("a completion stem ending in an ellipsis is not read as cut (live y6-heart s6)", () => {
  const { schema } = pilotRequest("v4.4", "KS2", {}, (sc) => sc);
  const hinge = Object.keys(schema.$defs).find((k) => k.startsWith("hinge~")) as string;
  const a = slotFillArrival(
    {
      template: "hinge",
      fit: hinge.split("~")[1],
      heading: "Choose the correct answer",
      stem: "An artery always carries blood…",
      options: ["away from the heart", "towards the heart", "rich in oxygen"],
      correct: 1,
    },
    "KS2",
    schema,
  );
  expect(a.cuts).not.toContain("stem");
});

describe("pilot pack v4.5 (answers from 1, short flow)", () => {
  test("base patches land: answer fields say counting from 1, flow shows may be null", () => {
    for (const ks of ["KS1", "KS2", "KS3"]) {
      const { schema, system } = pilotRequest("v4.5", ks, {}, (sc) => sc);
      const hinges = Object.keys(schema.$defs).filter((k) => k.startsWith("hinge~"));
      expect(hinges.length).toBeGreaterThan(0);
      for (const h of hinges)
        expect(schema.$defs[h].properties.correct.description).toContain("counting from 1");
      const shows = schema.properties.flow.items.properties.look_at.properties.shows;
      expect(shows.anyOf).toContainEqual({ type: "null" });
      expect(system).not.toBe(PILOT_PACKS["v4.4"].system[ks as "KS1"]);
    }
  });
  test("a patch pointing nowhere throws, so a base swap cannot drop one silently", () => {
    expect(() => withPatches({ properties: {} }, { "/properties/flow/x": {} })).toThrow();
  });
  test("the pack's own base is left untouched for the next lesson", () => {
    pilotRequest("v4.5", "KS2", {}, (sc) => sc);
    const raw = PILOT_PACKS["v4.5"].base.KS2 as Record<string, any>;
    expect(raw.properties.flow.items.properties.does.description).toBeUndefined();
  });
});

test("a pilot repair's pictures, diagrams and icons come back as the writer gave them (proof y6-heart s4)", () => {
  const before = {
    template: "panel-list",
    picture: { ask: "a capillary" },
    items: [{ name: "A", text: "long", icon: "heart" }],
  };
  const after = {
    template: "panel-list",
    picture: null,
    items: [{ name: "A", text: "short", icon: "lungs" }],
  };
  expect(carryFigures(before, after)).toEqual({
    template: "panel-list",
    picture: { ask: "a capillary" },
    items: [{ name: "A", text: "short", icon: "heart" }],
  });
});

test("a pilot row shortened in other words passes the fit rule; a dropped row does not", async () => {
  const { judgeRepair } = await import("./guards");
  const before = {
    template: "panel-list",
    heading: "Vessels",
    items: [
      { name: "Arteries", text: "Carry blood away from the heart under high pressure." },
      { name: "Veins", text: "Carry blood back towards the heart." },
    ],
  };
  const short = {
    ...before,
    items: [{ name: "Arteries", text: "Take blood from the heart." }, before.items[1]],
  };
  expect(judgeRepair(before, short, [], { fit: true }).ok).toBe(true);
  expect(judgeRepair(before, { ...before, items: [before.items[0]] }, [], { fit: true }).ok).toBe(
    false,
  );
});

describe("pilot pack v4.6 (no string caps a model reads)", () => {
  const caps = (x: unknown): number =>
    JSON.stringify(x).match(/"(maxLength|pattern)":/g)?.length ?? 0;
  test("the writer's request and every repair schema carry no maxLength or pattern", () => {
    for (const ks of ["KS1", "KS2", "KS3"]) {
      const r = pilotRequest("v4.6", ks, {}, (sc) => sc);
      expect(caps(r.schema)).toBe(0);
      expect(caps(r.caps)).toBeGreaterThan(100);
      const repair = {
        type: "object",
        properties: { slide: {}, fix: { type: "string", maxLength: 9 } },
        $defs: {},
      };
      expect(caps(pilotRepairSchema(repair, r.schema, "items-row"))).toBe(0);
    }
  });
  test("strip keeps counts, enums and integer bounds; a pattern becomes minLength 1", () => {
    const s: unknown = stripStringCaps<unknown>({
      type: "object",
      properties: {
        a: { type: "string", maxLength: 9 },
        b: { type: "string", pattern: "^.{1,13}$" },
        c: { type: "array", minItems: 2, maxItems: 4, items: { enum: ["x"] } },
        d: { type: "integer", minimum: 1, maximum: 4 },
      },
    });
    expect(s).toEqual({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string", minLength: 1 },
        c: { type: "array", minItems: 2, maxItems: 4, items: { enum: ["x"] } },
        d: { type: "integer", minimum: 1, maximum: 4 },
      },
    });
  });
  test("slot-fill still reads each field's room from the cap table: a long uncapped option is a writer fault", async () => {
    const { slotFillArrival } = await import("./slot-fill");
    const r = pilotRequest("v4.6", "KS2", {}, (sc) => sc);
    const slide = {
      template: "hinge",
      fit: "options-4",
      heading: "Check",
      stem: "Which is right?",
      options: ["Arteries leave the heart; capillaries exchange; veins return", "B", "C", "D"],
      correct: 1,
    };
    const withCaps = slotFillArrival(slide, "KS2", r.schema, r.caps);
    expect(withCaps.fields.find((f) => f.path === "options[0]")?.capWords).toBeGreaterThan(0);
    expect(withCaps.route).toBe("writer-fault");
    expect(slotFillArrival(slide, "KS2", r.schema).fields).toHaveLength(0);
  });
});

describe("the v4.6 pack's system text", () => {
  for (const ks of ["KS1", "KS2", "KS3"] as const)
    test(`${ks}: assembled from the menu constants, byte for byte the v4.6 pack`, () => {
      const pinned = readFileSync(
        new URL(`./bundles/pilot-v4.6/system-${ks}.txt`, import.meta.url),
        "utf8",
      );
      expect(PILOT_PACKS["v4.6"].system[ks]).toBe(pinned);
    });
});

describe("one source for the pilot caps: menu, schema and enforcer agree", () => {
  const STAGES = ["KS1", "KS2", "KS3-5"] as const;
  const at = (node: unknown, ...path: string[]) =>
    path.reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], node) as
      | Record<string, unknown>
      | undefined;
  const maxLen = (node: Record<string, unknown> | undefined) =>
    node?.type === "string"
      ? node.maxLength
      : ((node?.anyOf as Record<string, unknown>[] | undefined)?.find((b) => b.type === "string")
          ?.maxLength ?? undefined);

  for (const stage of STAGES)
    test(`${stage}: the code's cap table is the measured tables, the writer's schema has none`, () => {
      const req = pilotRequest("v4.6", stage, {}, (sc) => sc);
      const want = layoutFieldCaps(stage);
      const capDefs = at(req.caps, "$defs");
      for (const [layout, list, fields] of [
        ["items-row", "items", ["name", "text"]],
        ["panel-list", "items", ["name", "text"]],
        ["split-compare", "sides", ["title", "text", "quote"]],
      ] as const) {
        const props = at(capDefs, layout, "properties", list, "items", "properties");
        for (const f of fields) {
          const cap = (want[layout] as Record<string, number>)[f];
          expect(maxLen(at(props, f)), `${stage} ${layout}.${f}`).toBe(cap);
          const writerProp = at(
            req.schema,
            "$defs",
            layout,
            "properties",
            list,
            "items",
            "properties",
            f,
          );
          expect(maxLen(writerProp), `${stage} ${layout}.${f} reaches the model`).toBeUndefined();
        }
        if (layout !== "split-compare") {
          const heading = at(capDefs, layout, "properties", "heading");
          expect(maxLen(heading)).toBe(want[layout].heading);
        }
      }
      // The counts the schema allows are the counts the menu offers.
      const offer = layoutOffer(stage);
      expect(at(req.schema, "$defs", "items-row", "properties", "items")?.maxItems).toBe(
        Math.max(...offer["items-row"].counts),
      );
    });

  test("KS2: each offered row count's enforced cap is its table cell, and the menu never promises more", () => {
    const menu = LAYOUT_WRITER_MENUS["items-row"].KS2;
    const plain = (menu.split("Fits:")[1] ?? "").split("with a lead")[0] ?? "";
    for (const n of layoutOffer("KS2")["items-row"].icons) {
      const cell = listCaps("items-row", "primary", n);
      const slide = {
        ...fixedRow(),
        lead: null,
        items: Array.from({ length: n }, (_, k) => ({
          name: `Part ${k}`,
          text: "Short line.",
          icon: ["heart", "lungs", "muscles", "blood"][k] ?? "heart",
        })),
      };
      const field = (pilotFit(slide, ctxAt(3)).fields as FieldReport[]).find(
        (f) => f.path === "items.0.text",
      );
      expect(field?.cap, `${n} items: enforcer`).toBe(cell?.text);
      const words = new RegExp(`(?:^|; )(?:\\d+ to )?${n} items: up to (\\d+) words`).exec(plain);
      const promised = Number(
        words?.[1] ?? /(\d+) to (\d+) items: up to (\d+) words/.exec(plain)?.[3] ?? Number.NaN,
      );
      expect(promised, `${n} items: menu`).toBeLessThanOrEqual(
        menuWords(cell?.text ?? 0, "primary"),
      );
    }
  });
});

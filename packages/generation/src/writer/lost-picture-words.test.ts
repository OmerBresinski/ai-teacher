import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "@tj/slides/themes";
import type { Brief } from "./fixes";
import { fixedFallback } from "./fixes";
import { judgeRepair, textSlots, words } from "./guards";
import type { VisualState } from "./materialise";
import { materialise } from "./materialise";
import { replayServices } from "./replay-fixture";
import { type ModelRepair, runWriter } from "./stage";

/*
 * RC2 (e2e-11nov ROOT-CAUSES #24, R3-DIAGNOSIS fault D): round 3's Year 2 Great Fire slide 10
 * "Samuel Pepys's diary" lost its picture to a search timeout; the reroute rewrite turned the
 * picture's must_see ("Open diary", "Writing quill") into the slide's points ("He wrote in an
 * open diary.") and the slide shipped as explain with its key card gone and the right half empty.
 * A repair or fallback may drop or re-lay, never add words to a slide's visible text.
 */
type S = Record<string, unknown>;

/**
 * Slide 10 as the writer wrote it (genlab run 20261112-100228-record-e2e-y2-greatfire, debug seq
 * 111 `before`: the stage's slide JSON before the repair).
 */
const PEPYS: S = {
  icon: null,
  lead: "Samuel Pepys saw the fire.",
  cards: [
    {
      num: null,
      kind: "word",
      term: "Eyewitness account",
      unit: null,
      label: "His diary",
      meaning: "A record by someone who saw events.",
      examples: null,
    },
  ],
  figure: {
    shows: "Samuel Pepys writing in his diary in the seventeenth century.",
    subject: "named",
    must_see: ["Samuel Pepys", "Open diary", "Writing quill"],
  },
  points: [],
  heading: "Samuel Pepys’s diary",
  template: "visual-text",
};
/** The reroute's recorded answer (seq 111 `after`): the invented points. */
const INVENTED: S = {
  ...PEPYS,
  figure: null,
  points: ["He wrote in an open diary.", "He used a quill to write."],
};

const textWords = (s: unknown) => new Set(textSlots(s).flatMap((x) => words(x.text)));
/** Every string a laid-out slide shows (text runs and plain text). */
const shown = (els: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown, k = "") => {
    if (typeof v === "string") {
      if (k === "text") out.push(v);
    } else if (Array.isArray(v)) for (const x of v) walk(x, k);
    else if (v && typeof v === "object")
      for (const [kk, x] of Object.entries(v as S)) if (kk !== "alt" && kk !== "name") walk(x, kk);
  };
  walk(els);
  return out;
};
const lay = (s: S) =>
  materialise(s, {
    brief: { keyStage: "ks1", year: 2, theme: "crayon" } as never,
    theme: getTheme("crayon", "ks1"),
    stage: "ks1",
    index: 9,
    plan: { flow: [], slides: [s] },
    goldLooks: true,
    visual: () => ({ status: "failed" }),
  } as never);

describe("RC2: a lost picture never becomes slide words (round 3 y2 s10)", () => {
  test("the recorded reroute answer is rejected: it added words the slide never held", () => {
    const v = judgeRepair(PEPYS, INVENTED, [], { restage: true });
    expect(v.ok).toBe(false);
    expect(v.ok ? "" : v.why.join(";")).toMatch(/added \d+ words \(.*(open|wrote|quill)/);
  });

  test("the deterministic outcome keeps only the writer's words and lays the card full width", () => {
    const fb = fixedFallback(PEPYS, { type: "photo" }, [], 0, { goldNoPicture: true }).slide;
    expect(fb.figure).toBeNull();
    const own = textWords(PEPYS);
    for (const w of textWords(fb)) expect(own.has(w)).toBe(true);
    expect(JSON.stringify(fb)).not.toMatch(/quill|open diary|seventeenth/i);
    const m = lay(fb);
    expect(m.drawer).toBe("gold:picture-text");
    expect(m.over).toEqual([]);
    const els = m.slide.elements as unknown as S[];
    const seen = shown(els).join(" ");
    for (const w of words(seen)) expect(own.has(w)).toBe(true);
    expect(seen).toContain("Eyewitness account");
    // no element box is empty: every text box shows words, every box has an area
    for (const e of els) {
      expect(Number(e.w) > 0 && Number(e.h) > 0).toBe(true);
      if (e.type === "text") expect(shown(e).join("").trim().length > 0).toBe(true);
      expect(e.type).not.toBe("image");
    }
    // the card takes the width (no half-empty slide): wider than the 667 plain column
    const widest = Math.max(...els.filter((e) => e.type !== "text").map((e) => Number(e.w)));
    expect(widest).toBeGreaterThan(667);
  });
});

/*
 * The forced failures through the whole stage (the y1 replay fixture's "Watch me describe" slide,
 * whose picture never lands): a search that runs out of time (retryable), every candidate judged
 * unfit (not retryable), and a library or drawer that refuses. With the model repairs off nothing
 * is asked again and no rewrite is called; with them on, the invented answer is still refused.
 */
const B = "y1-science-animals-young";
const read = (f: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures/replay", B, f), "utf8"));
const MAIN = (read("main.json") as { text: string }).text;
const findSlide = (v: unknown): S | undefined => {
  if (Array.isArray(v))
    for (const x of v) {
      const r = findSlide(x);
      if (r) return r;
    }
  if (v && typeof v === "object") {
    if ((v as S).heading === "Watch me describe") return v as S;
    for (const x of Object.values(v as S)) {
      const r = findSlide(x);
      if (r) return r;
    }
  }
  return undefined;
};
const WRITTEN = findSlide(JSON.parse(MAIN)) as S;

const run = (o: { retryable: boolean; modelRepairs?: ModelRepair[] }) => {
  const calls = { slide: 0, placeMore: 0 };
  const out = runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (x) => x.teacher,
    ),
    checks: "log",
    ...(o.modelRepairs ? { modelRepairs: o.modelRepairs } : {}),
    services: {
      ...replayServices(B),
      writer: async () => ({ text: MAIN, finishReason: "stop", usd: 0, ms: 0 }),
      chat: async (r) => {
        if (r.name === "slide" && r.user.includes("Watch me describe")) {
          calls.slide++;
          // the reroute invents words from the picture's ask, as round 3's did
          return {
            out: {
              fix: "diagram",
              slide: { ...WRITTEN, figure: null, points: ["A fluffy yellow chick hatches."] },
            },
            usd: 0,
            ms: 0,
          };
        }
        return replayServices(B).chat(r);
      },
    },
    visual: (): VisualState => ({ status: "failed" }),
    drawDiagrams: {
      callDrawer: async () => {
        throw new Error("library refused");
      },
    },
    retryable: () => o.retryable,
    placeMore: async () => {
      calls.placeMore++;
    },
  });
  return { out, calls };
};
const finalWords = async (r: ReturnType<typeof run>) => {
  const lesson = await r.out;
  const s = lesson.slides.find((x) => JSON.stringify(x).includes("Watch me describe"));
  expect(s).toBeDefined();
  const els = (s as unknown as { elements: S[] }).elements;
  for (const e of els) {
    expect(Number(e.w) > 0 && Number(e.h) > 0).toBe(true);
    if (e.type === "text") expect(shown(e).join("").trim().length > 0).toBe(true);
  }
  return words(shown(els).join(" "));
};

describe("RC2: forced failures end in the writer's own words", () => {
  const own = textWords(WRITTEN);
  for (const [name, retryable] of [
    ["picture search timeout", true],
    ["every candidate judged unfit", false],
  ] as const) {
    test(`${name}, repairs off: no retry, no rewrite, text a subset of the writer's`, async () => {
      const r = run({ retryable, modelRepairs: [] });
      for (const w of await finalWords(r)) expect(own.has(w)).toBe(true);
      expect(r.calls.slide).toBe(0);
      expect(r.calls.placeMore).toBe(0);
    });
    test(`${name}, repairs on: the inventing rewrite is refused`, async () => {
      const r = run({ retryable });
      const got = await finalWords(r);
      // the reroute was asked (the path ran) and its invented words were refused
      expect(r.calls.slide).toBeGreaterThan(0);
      expect(got).not.toContain("fluffy");
      for (const w of got) expect(own.has(w)).toBe(true);
    });
  }
});

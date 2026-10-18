import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { asTableText, splitWordsOnly, type TablePack } from "./fallbacks";
import { layoutsFor, PACK_SWITCH, SWITCH } from "./fixes";
import type { Plan } from "./materialise";
import { pilotOvers } from "./pilot-fit";
import { pilotRequest } from "./pilot-pack";
import type { WriterStage } from "./schema";
import { slotFillArrival } from "./slot-fill";

/*
 * Ruling 218's code half (TEACH-110 part t): on the pilot pack (production) no writer code path
 * makes a retired layout, and what the table fallback makes is a slide the pack's own schema takes,
 * every cell kept. Runs without a pack behave as before. Saved decks and stored writer JSON with
 * compare still render (materialise's case stays).
 */

type S = Record<string, unknown>;
const RETIRED = ["compare", "cards-grid"];
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
const ks = (st: WriterStage) => (st === "KS1" ? "ks1" : st === "KS2" ? "ks2" : "ks3");
const slide = (lead?: string, heading = "Day and night"): S => ({
  template: "visual-text",
  heading,
  ...(lead ? { lead } : {}),
  points: [],
});
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

/** Production's drawn-size check at a stage, as the stage passes it (pilotOvers). */
const packAt = (stage: WriterStage): TablePack => {
  const brief = { ...sampleBriefLesson().brief, keyStage: ks(stage) } as never;
  const ctx = {
    brief,
    theme: getTheme("paper", ks(stage) as never),
    stage: ks(stage) as never,
    index: 0,
    plan: { slides: [] } as unknown as Plan,
    visual: () => ({ status: "pending" }) as const,
  };
  return {
    stage,
    holds: (x) => {
      const o = pilotOvers(x, ctx);
      return !o.tooMany && !o.overs.length;
    },
  };
};
const schemaAt = (stage: WriterStage) =>
  pilotRequest("v4.7", stage, { properties: {}, $defs: {} }, (x) => x).schema;
/** The fit an explain's points name in the pack's schema. */
const explainFit = (out: S) => {
  const p = out.points as unknown[];
  if (p.some((x) => typeof x === "object")) return `points-${p.length}-key`;
  return `points-${p.length}`;
};
/** What the pack's own schema finds wrong with the slide (the real v4.7 defs). */
const breaches = (out: S, stage: WriterStage) =>
  slotFillArrival(
    out.template === "explain" ? { ...out, fit: explainFit(out) } : out,
    stage,
    schemaAt(stage),
  ).breaches;
/** Every cell of the table is somewhere on the slide. */
const keepsAll = (out: S, rows: string[][]) => {
  const all = JSON.stringify(out);
  return rows.every((r) => r.every((c) => all.includes(c)));
};

describe("on the pilot pack, asTableText makes only what the pack's schema takes", () => {
  test("two short rows become a words-only split-compare that holds as drawn", () => {
    const rows = [
      ["Day side", "faces the Sun", "bright"],
      ["Night side", "faces away", "dark"],
    ];
    const out = asTableText(slide(), { header: ["Side", "Sun", "Light"], rows }, packAt("KS2"));
    expect(out.template).toBe("split-compare");
    expect(out.sides).toEqual([
      { title: "Day side", text: "Sun: faces the Sun; Light: bright", quote: null, picture: null },
      { title: "Night side", text: "Sun: faces away; Light: dark", quote: null, picture: null },
    ]);
    expect(breaches(out, "KS2")).toEqual([]);
  });

  test("a side one word over the menu's cap, or over the table's characters, is not a split", () => {
    const room = splitWordsOnly("KS2", 3);
    if (!room) throw new Error("no KS2 3-side words-only room");
    const at = (text: string) => [
      ["A", text],
      ["B", "two words"],
      ["C", "two words"],
    ];
    const pack = packAt("KS2");
    expect(asTableText(slide(), { rows: at(words(room.text, "a")) }, pack).template).toBe(
      "split-compare",
    );
    // One word over; then within the words but past the characters (10 characters a word).
    const charsOver = words(Math.ceil(room.textChars / 10) + 1, "abcdefghi");
    expect(charsOver.split(" ").length).toBeLessThanOrEqual(room.text);
    for (const text of [words(room.text + 1, "a"), charsOver]) {
      const out = asTableText(slide(), { rows: at(text) }, pack);
      expect(out.template).not.toBe("split-compare");
      expect(breaches(out, "KS2")).toEqual([]);
      expect(keepsAll(out, at(text))).toBe(true);
    }
  });

  test("a heading past the split's room (measured as drawn) is not a split", () => {
    const rows = [
      ["Day side", "bright"],
      ["Night side", "dark"],
    ];
    const out = asTableText(slide(undefined, words(30, "heading")), { rows }, packAt("KS2"));
    expect(out.template).not.toBe("split-compare");
    expect(keepsAll(out, rows)).toBe(true);
  });

  test("a lead has no place on a split: the rows go to a panel list or explain, lead kept", () => {
    const rows = [
      ["A", "one"],
      ["B", "two"],
    ];
    const out = asTableText(slide("The Earth spins."), { rows }, packAt("KS2"));
    expect(["panel-list", "explain"]).toContain(String(out.template));
    expect(JSON.stringify(out)).toContain("The Earth spins.");
    expect(breaches(out, "KS2")).toEqual([]);
  });

  test("four rows at KS2 become a panel list (the menu offers 4); six become explain's 3 points", () => {
    const four = ["A", "B", "C", "D"].map((n) => [n, `${n} is short`]);
    const p = asTableText(slide(), { rows: four }, packAt("KS2"));
    expect(p.template).toBe("panel-list");
    expect(breaches(p, "KS2")).toEqual([]);
    const six = ["A", "B", "C", "D", "E", "F"].map((n) => [n, `${n} is short`]);
    const e = asTableText(slide(), { rows: six }, packAt("KS2"));
    expect(e.template).toBe("explain");
    expect((e.points as unknown[]).length).toBe(3);
    expect(breaches(e, "KS2")).toEqual([]);
    expect(keepsAll(e, six)).toBe(true);
  });

  test("every table of 1 to 8 rows, at every stage: valid, never retired, every cell kept", () => {
    for (const stage of STAGES) {
      const pack = packAt(stage);
      for (let n = 1; n <= 8; n += 1)
        for (const text of ["short", words(25, "long")]) {
          const rows = Array.from({ length: n }, (_, k) => [`Row${k}`, `${text} ${k}`]);
          const out = asTableText(slide(), { rows }, pack);
          expect(RETIRED).not.toContain(String(out.template));
          expect(breaches(out, stage)).toEqual([]);
          expect(keepsAll(out, rows)).toBe(true);
        }
    }
  });

  test("production's menu gives a words-only room for 2 and 3 sides at every stage", () => {
    for (const stage of STAGES)
      for (const n of [2, 3]) {
        const r = splitWordsOnly(stage, n);
        if (!r) throw new Error(`no words-only split room at ${stage} for ${n} sides`);
        for (const v of Object.values(r)) expect(v).toBeGreaterThan(0);
      }
    expect(splitWordsOnly("KS2", 4)).toBeUndefined();
  });
});

describe("without a pack (lab runs), the table fallback is as before", () => {
  test("2-4 rows are cards (compare); other counts labelled points", () => {
    const rows = [
      ["A", "one"],
      ["B", "two"],
    ];
    expect(asTableText(slide("Lead."), { rows })).toEqual({
      template: "compare",
      heading: "Day and night",
      lead: "Lead.",
      columns: [
        { label: "A", text: "one", picture: null },
        { label: "B", text: "two", picture: null },
      ],
    });
    const five = ["A", "B", "C", "D", "E"].map((n) => [n, n.toLowerCase()]);
    expect(asTableText(slide(), { rows: five })).toEqual({
      template: "explain",
      heading: "Day and night",
      lead: "",
      points: five.map(([label, text]) => ({ label, text })),
    });
  });
});

describe("the fit repair's switches", () => {
  test("on the pack: nothing to or from compare; a picture sequence may become a split", () => {
    expect(PACK_SWITCH["picture-sequence"]).toEqual(["split-compare"]);
    for (const [from, to] of Object.entries(PACK_SWITCH)) {
      expect(RETIRED).not.toContain(from);
      for (const t of to) expect(RETIRED).not.toContain(t);
    }
  });
  test("without a pack: SWITCH and the cut menu are as before", () => {
    expect(SWITCH["picture-sequence"]).toEqual(["compare"]);
    expect(SWITCH.compare).toEqual(["visual-text", "explain"]);
    const menu = "Layouts.\n- picture-sequence: a\n- compare: b\n- split-compare: c";
    expect(layoutsFor(menu, "picture-sequence")).toBe(
      "Layouts.\n- picture-sequence: a\n- compare: b",
    );
    expect(layoutsFor(menu, "picture-sequence", true)).toBe(
      "Layouts.\n- picture-sequence: a\n- split-compare: c",
    );
  });
});

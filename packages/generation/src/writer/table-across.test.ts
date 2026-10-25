import { describe, expect, test } from "bun:test";
import { slotOf } from "@tj/slides/diagrams";
import { G } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";

import { layoutSlotProbe } from "./diagrams";
import { materialise, type Plan } from "./materialise";
import { continueTable, drawable, tableDrawn, tableSplitter } from "./table-pack";

type S = Record<string, unknown>;

/*
 * Y3 plants s9 (LAYOUT-SEL run): a fair-test table too long for the side slot was split, and its
 * first part was laid beside the bullets at half width (4 rows), the 5th row continued. A table
 * takes the full width before it is continued (#453's continuation stays for what does not fit
 * even there). The `fits` here is the writer stage's own (`stage.ts` `splitTable`).
 */
const at = (stage: "KS1" | "KS2" | "KS3") => {
  const brief = { ...sampleBriefLesson().brief, keyStage: stage } as never;
  return { brief, theme: getTheme("splash", stage as never), stage: stage as never };
};
const plan = { slides: [] } as unknown as Plan;
const layAt = (base: ReturnType<typeof at>) => (sl: S) =>
  materialise(sl, {
    ...base,
    index: 8,
    plan,
    visual: () => ({ status: "diagram", spec: drawable(sl.figure as S) }),
  });
const fitsAt =
  (base: ReturnType<typeof at>) =>
  (template: string) =>
  (sl: S, first: boolean, asWritten?: boolean) => {
    const probe = (slot: "side" | "full") =>
      !layoutSlotProbe(drawable(sl.figure as S), slot, base.stage, base.theme).length;
    if (asWritten) return probe(slotOf(template));
    if (first && !probe(slotOf(String(sl.template ?? "")))) return false;
    return tableDrawn(sl, first, layAt(base)(sl));
  };
const lay = layAt(at("KS2"));
const fits = fitsAt(at("KS2"));

const plants: S = {
  template: "visual-text",
  heading: "A fair water test",
  lead: "Does the amount of water affect seedling growth?",
  points: [
    "Change only the water amount.",
    "Keep other conditions the same.",
    "Measure height on days 0, 3 and 6.",
  ],
  figure: {
    kind: "table",
    alt: "Two matching bean seedlings get different daily water but the same light, pots, soil and starting height.",
    header: ["Condition", "Plant A", "Plant B"],
    rows: [
      ["Water each day", "5 ml", "20 ml"],
      ["Plant type", "Bean", "Bean"],
      ["Starting height", "8 cm", "8 cm"],
      ["Light", "Same windowsill", "Same windowsill"],
      ["Pot and soil", "Same size and amount", "Same size and amount"],
    ],
  },
};

const diagramOf = (sl: S, l = lay) => l(sl).slide.elements.find((e) => e.name === "Diagram");

describe("a table too big for the side slot goes across before it is continued", () => {
  test("the plants table is never laid beside the bullets: words first, then the table full width", () => {
    const r = continueTable(plants, fits("visual-text"));
    expect(r).toBeDefined();
    if (!r) return;
    // At KS2 the key-card strip leaves no room for a row across under the words, so the words
    // keep their own slide (nothing cut) and the table follows across the slide.
    expect(r.first.template).toBe("explain");
    expect(r.first.figure).toBeUndefined();
    expect(r.first.points).toEqual(plants.points);
    expect(lay(r.first).over).toEqual([]);
    for (const p of r.rest) {
      expect(lay(p).over).toEqual([]);
      expect(diagramOf(p)?.w ?? 0).toBeGreaterThan(G.panel.w);
    }
    // Every row is shown once, in order.
    const rows = r.rest.flatMap((p) => (p.figure as { rows: string[][] }).rows.map((x) => x[0]));
    expect(rows).toEqual((plants.figure as { rows: string[][] }).rows.map((x) => x[0]));
    // The whole table fits one full-width slide: no "(continued)" chain of one-row slides.
    expect(r.rest).toHaveLength(1);
    // Nothing was continued: the table's own slide keeps the slide's heading.
    expect(r.rest[0]?.heading).toBe("A fair water test");
  });

  test("where a row fits across under the words (KS3), the first part keeps its words and draws across", () => {
    const ks3 = at("KS3");
    const l3 = layAt(ks3);
    const r = continueTable(plants, fitsAt(ks3)("visual-text"));
    expect(r).toBeDefined();
    if (!r) return;
    expect(r.first.template).toBe("big-visual");
    expect(r.first.cardsUnder).toBe(true);
    expect(r.first.points).toEqual(plants.points);
    // Across the slide, never the half-width table beside the bullets.
    for (const p of [r.first, ...r.rest]) {
      expect(l3(p).over).toEqual([]);
      expect(diagramOf(p, l3)?.w ?? 0).toBeGreaterThan(G.panel.w);
    }
    const rows = [r.first, ...r.rest].flatMap((p) =>
      (p.figure as { rows: string[][] }).rows.map((x) => x[0]),
    );
    expect(rows).toEqual((plants.figure as { rows: string[][] }).rows.map((x) => x[0]));
  });

  test("a short-celled table moved across holds as many rows as a continuation, not one", () => {
    // Short cells draw larger beside the words than across, so the across layout used to be
    // refused for every first part but a single row (`across` lifts that for a moved table).
    const ks3 = at("KS3");
    const numbers: S = {
      ...plants,
      points: ["Point one.", "Point two."],
      lead: "One lead line.",
      figure: {
        kind: "table",
        alt: "Numbers and their doubles and triples.",
        header: ["n", "2n", "3n"],
        rows: Array.from({ length: 12 }, (_, i) => [`${i}`, `${i * 2}`, `${i * 3}`]),
      },
    };
    const r = continueTable(numbers, fitsAt(ks3)("visual-text"));
    expect(r).toBeDefined();
    if (!r) return;
    expect(r.first.cardsUnder).toBe(true);
    const n = (p: S) => (p.figure as { rows: unknown[] }).rows.length;
    expect(n(r.first)).toBe(Math.max(...r.rest.map(n)));
    expect(diagramOf(r.first, layAt(ks3))?.w ?? 0).toBeGreaterThan(G.panel.w);
  });

  test("the table's own slide after the words takes the table's title, drawn once", () => {
    const titled = { ...plants, figure: { ...(plants.figure as S), title: "Our two plants" } };
    const r = continueTable(titled, fits("visual-text"));
    expect(r?.first.template).toBe("explain");
    expect(r?.rest[0]?.heading).toBe("Our two plants");
    expect((r?.rest[0]?.figure as S | undefined)?.title).toBeUndefined();
  });

  test("rows carried on from a table on the slide before are headed (continued)", () => {
    const ks3 = at("KS3");
    const r = continueTable(plants, fitsAt(ks3)("visual-text"));
    expect(r?.first.figure).toBeDefined();
    expect(r?.rest.length).toBeGreaterThan(0);
    for (const p of r?.rest ?? []) expect(p.heading).toBe("A fair water test (continued)");
  });

  test("a side-panel drawing of the moved first part is refused", () => {
    const side = {
      over: [],
      slide: { elements: [{ type: "image", name: "Diagram", w: G.panel.w - 44 }] },
    };
    expect(tableDrawn({ cardsUnder: true }, true, side)).toBe(false);
    expect(tableDrawn({ cardsUnder: true }, false, side)).toBe(true);
    expect(tableDrawn({}, true, side)).toBe(true);
  });

  // A table too long for one slide even full width, whose words keep their own slide: the
  // table's first slide continues nothing; every later one carries rows on.
  const lifeCycles = (lead: string): S => ({
    template: "visual-text",
    heading: "Life cycles",
    lead,
    points: [
      "Each animal changes as it grows.",
      "Some change shape completely.",
      "Look for the pattern.",
    ],
    figure: {
      kind: "table",
      alt: "Animals at each stage of their life cycle.",
      header: ["Animal", "Young", "Adult"],
      rows: Array.from({ length: 16 }, (_, i) => [`A${i + 1}`, "egg", "adult"]),
    },
  });
  // KS3 keeps a row across the slide under fewer words, so its words here are longer.
  const longer = [1, 2, 3].map((i) => `Point ${i} explains a careful idea about growth.`);
  for (const [stage, lead, points] of [
    ["KS1", "How animals grow and change.", undefined],
    [
      "KS3",
      "A longer lead sentence that sets up what the class will look at on this slide today.",
      longer,
    ],
  ] as const) {
    test(`${stage}: a table over several slides after its words is headed (continued) only where it carries on`, () => {
      const slide: S = { ...lifeCycles(lead), ...(points ? { points } : {}) };
      const r = continueTable(slide, fitsAt(at(stage))("visual-text"));
      expect(r).toBeDefined();
      if (!r) return;
      expect(r.first.template).toBe("explain");
      expect(r.first.figure).toBeUndefined();
      expect(r.rest.length).toBeGreaterThan(1);
      expect(r.rest.map((p) => p.heading)).toEqual([
        "Life cycles",
        ...r.rest.slice(1).map(() => "Life cycles (continued)"),
      ]);
      const rows = r.rest.flatMap((p) => (p.figure as { rows: string[][] }).rows.map((x) => x[0]));
      expect(rows).toEqual((slide.figure as { rows: string[][] }).rows.map((x) => x[0]));
    });
  }
});

describe("the stage's table splits follow rewrites of the slide (stage.ts splitTable)", () => {
  test("words-first: a repair of the words slide (no table) keeps the table's slides", () => {
    const tables = tableSplitter(() => fits("visual-text"));
    const r = tables.split(8, plants);
    expect(r.slide.template).toBe("explain");
    const rest = tables.rest.get(8);
    expect(rest?.length).toBe(1);
    // An overflow or wording repair starts from the words slide: the table still belongs to it.
    const again = tables.split(8, { ...r.slide, points: ["Only water changes."] }, true);
    expect(again.slide.points).toEqual(["Only water changes."]);
    expect(tables.rest.get(8)).toBe(rest);
  });

  test("words-first: the slide written afresh without the table leaves no table slides behind", () => {
    const tables = tableSplitter(() => fits("visual-text"));
    tables.split(8, plants);
    expect(tables.rest.get(8)?.length).toBe(1);
    // The writer re-emits the slide (not a rewrite of the split) with words only.
    const { figure: _f, ...words } = plants;
    tables.split(8, { ...words, template: "explain" });
    expect(tables.rest.get(8)).toBeUndefined();
  });

  test("a rewrite that drops the first part's table drops its continuations", () => {
    const tables = tableSplitter(() => fitsAt(at("KS3"))("visual-text"));
    const r = tables.split(8, plants);
    expect(r.slide.figure).toBeDefined();
    const { figure: _f, ...words } = r.slide;
    tables.split(8, words, true);
    expect(tables.rest.get(8)).toBeUndefined();
  });

  test("a rewrite that keeps the first part's table keeps its continuations", () => {
    const tables = tableSplitter(() => fitsAt(at("KS3"))("visual-text"));
    const r = tables.split(8, plants);
    expect(r.slide.figure).toBeDefined();
    const rest = tables.rest.get(8);
    expect(rest?.length).toBeGreaterThan(0);
    for (const rewrite of [true, false]) {
      const again = tables.split(8, { ...r.slide, lead: "Reworded lead." }, rewrite);
      expect(again.slide.figure).toEqual(r.slide.figure);
      expect(tables.rest.get(8)).toBe(rest);
    }
  });
});

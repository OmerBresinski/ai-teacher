import { describe, expect, test } from "bun:test";
import { figureTextFix } from "./figure-text";

// The D52 cases (blind-j12 `figure_contradicts_text`), as the writer wrote them.
const half = (shape: string, cut = "auto") => ({ shape, parts: 2, cut, shaded: 1, name: "½" });
const quarter = (shape: string) => ({ shape, parts: 4, cut: "auto", shaded: 1, name: "¼" });
const shapesSlide = (alt: string, shows: string) => ({
  template: "big-visual",
  heading: "Halves and quarters of shapes",
  figure: {
    kind: "fraction-shapes",
    alt,
    shows,
    title: null,
    shapes: [half("circle"), half("square", "vertical"), half("rectangle"), quarter("circle")],
  },
});
const frenchTable = (alt: string) => ({
  template: "visual-text",
  heading: "L'âge",
  figure: {
    kind: "table",
    alt,
    shows: "French numbers one to twenty for expressing ages",
    title: null,
    header: ["Nombre", "Français", "Nombre", "Français"],
    rows: [1, 2, 3, 4, 5, 6].map((n) => [String(n), "x", String(n + 10), "y"]),
  },
});
const groups = (total: number, g: number, alt: string, shows: string) => ({
  template: "big-visual",
  heading: "Share",
  figure: { kind: "equal-groups", alt, shows, total, groups: g, layout: "rings", unknown: false },
});

describe("figureTextFix", () => {
  test("fraction shapes: alt promising a quarter of every shape is rewritten from the spec", () => {
    const r = figureTextFix(
      shapesSlide(
        "A circle, square and rectangle each show one half shaded, then one quarter shaded.",
        "One half and one quarter of each of three shapes",
      ),
    );
    const want =
      "A circle, a square and a rectangle, each with one of two equal parts shaded; then a circle with one of four equal parts shaded.";
    expect(r.changes.map((c) => c.action)).toEqual(["words"]);
    expect(r.slide.figure).toMatchObject({ alt: want, shows: want });
  });

  test("fraction shapes: 'three more each' with one quarter drawn is a miss", () => {
    const r = figureTextFix(
      shapesSlide(
        "Three shapes each have one of two equal parts shaded. Three more each have one of four equal parts shaded.",
        "Shapes in halves and quarters",
      ),
    );
    expect(r.changes).toHaveLength(1);
  });

  test("fraction shapes: a triangle the spec never draws is a miss", () => {
    const s = shapesSlide("A circle and a square in halves.", "Halves and quarters in triangles");
    expect(figureTextFix(s).changes).toHaveLength(1);
  });

  test("fraction shapes: two quarters shaded counts as a half", () => {
    const s = {
      figure: {
        kind: "fraction-shapes",
        alt: "A rectangle has two of four equal parts shaded, showing one half.",
        shows: "Two quarters make one half",
        shapes: [{ shape: "rectangle", parts: 4, shaded: 2 }],
      },
    };
    expect(figureTextFix(s).changes).toEqual([]);
  });

  test("fraction shapes: words that agree with the spec are kept", () => {
    const s = shapesSlide(
      "A circle, square and rectangle each show one half; a circle shows one quarter.",
      "Halves of three shapes and a quarter of a circle",
    );
    expect(figureTextFix(s)).toEqual({ slide: s, changes: [] });
  });

  test("table: 'one to twenty' over rows 1-6 and 11-16 is rewritten to what the table holds", () => {
    const r = figureTextFix(
      frenchTable("A number bank showing the French words for one to twenty."),
    );
    expect((r.slide.figure as { alt: string }).alt).toBe(
      "A table of Nombre and Français in six rows, for the numbers 1 to 6 and 11 to 16.",
    );
  });

  test("table: a decimal reading is not a number range", () => {
    const s = {
      figure: {
        kind: "table",
        alt: "Mass falls from 85.0 to 84.4 grams between 0 and 30 seconds.",
        shows: "Readings",
        header: ["Time (s)", "Mass (g)"],
        rows: [
          ["0", "85.0"],
          ["10", "84.7"],
          ["30", "84.4"],
        ],
      },
    };
    expect(figureTextFix(s).changes).toEqual([]);
  });

  test("table: a row count the table does not have is a miss", () => {
    const s = frenchTable("Ten rows of numbers.");
    (s.figure as { shows: string }).shows = "Numbers";
    expect(figureTextFix(s).changes).toHaveLength(1);
  });

  test("equal groups: 16 in 10 groups takes the one group count its words agree on", () => {
    const alt = "Sixteen counters are shown in one collection.";
    const r = figureTextFix(groups(16, 10, alt, "Sixteen counters in one collection to share."));
    expect(r.changes.map((c) => c.action)).toEqual(["groups"]);
    expect(r.slide.figure).toMatchObject({ groups: 1, alt });
  });

  test("equal groups: per-group and total counts that agree are kept", () => {
    const s = groups(
      24,
      4,
      "Four equal groups contain six counters each.",
      "Twenty-four counters shared equally into four groups; one group is one quarter.",
    );
    expect(figureTextFix(s).changes).toEqual([]);
    const t = groups(
      12,
      4,
      "Twelve counters shared into four equal groups, with three counters in each group.",
      "Twelve counters in four rings, as two pairs so the teacher can also show two groups of six.",
    );
    expect(figureTextFix(t).changes).toEqual([]);
  });

  test("equal groups: a group count the spec does not draw is rewritten", () => {
    const r = figureTextFix(groups(12, 3, "Twelve counters in two equal groups.", "Sharing"));
    expect((r.slide.figure as { alt: string }).alt).toBe(
      "Twelve counters in three equal groups of four.",
    );
  });

  test("equal groups: a hidden per-group count is never written into the alt or shows", () => {
    const s = groups(
      12,
      4,
      "Twelve sweets in three groups of four.",
      "Twelve sweets in three groups of four, for pupils to find how many in each.",
    );
    (s.figure as { unknown: boolean }).unknown = true;
    const f = figureTextFix(s).slide.figure as { alt: string; shows: string };
    expect(f.alt).toBe("Twelve sweets in four equal groups; how many in each is not shown.");
    expect(f.shows).toBe(
      "Twelve sweets in four equal groups; how many in each is not shown, for pupils to find how many in each.",
    );
    for (const t of [f.alt, f.shows]) expect(t).not.toMatch(/\bthree\b|\b3\b|groups of/);
  });

  test("equal groups: a hidden total is never written, nor a per-group count that gives it", () => {
    const s = groups(
      12,
      4,
      "Twelve sweets in three groups.",
      "Twelve sweets in three groups of four.",
    );
    (s.figure as { unknown: unknown }).unknown = "total";
    const f = figureTextFix(s).slide.figure as { alt: string; shows: string };
    expect(f.alt).toBe("Sweets in four equal groups; how many in all is not shown.");
    for (const t of [f.alt, f.shows]) expect(t).not.toMatch(/twelve|\b12\b|three|groups of/i);
  });

  test("equal groups: with no item noun in the words, the rewrite uses a neutral one", () => {
    const r = figureTextFix(groups(12, 3, "Two equal groups.", "Sharing"));
    expect((r.slide.figure as { alt: string }).alt).toBe(
      "Twelve objects in three equal groups of four.",
    );
  });

  test("shows: only the contradicting count is corrected, its teaching purpose kept", () => {
    const r = figureTextFix(
      groups(
        12,
        3,
        "Twelve counters in two equal groups.",
        "Twelve counters in two rings, so the teacher can model fair sharing.",
      ),
    );
    expect(r.slide.figure).toMatchObject({
      alt: "Twelve counters in three equal groups of four.",
      shows: "Twelve counters in three rings, so the teacher can model fair sharing.",
    });
  });

  test("shows: when it cannot be corrected in place, the purpose is kept beside the description", () => {
    const t = figureTextFix(frenchTable("A number bank for one to twenty."));
    expect((t.slide.figure as { shows: string }).shows).toBe(
      "A table of Nombre and Français in six rows, for the numbers 1 to 6 and 11 to 16, for expressing ages.",
    );
    const r = figureTextFix(
      shapesSlide(
        "A circle, square and rectangle each show one half shaded, then one quarter shaded.",
        "Halves and quarters in triangles; each pair uses identical whole shapes.",
      ),
    );
    expect((r.slide.figure as { shows: string }).shows).toBe(
      "A circle, a square and a rectangle, each with one of two equal parts shaded; then a circle with one of four equal parts shaded. Each pair uses identical whole shapes.",
    );
  });

  test("shows that agree with the spec are kept when only the alt contradicts it", () => {
    const shows = "Pupils compare the sizes of the equal parts";
    const r = figureTextFix(shapesSlide("Halves and quarters in triangles.", shows));
    expect(r.changes).toHaveLength(1);
    expect((r.slide.figure as { shows: string }).shows).toBe(shows);
  });

  test("each behaviour runs only under its own flag", () => {
    const s = groups(16, 10, "Sixteen counters in one collection.", "One collection.");
    expect(figureTextFix(s, { specRepair: true }).changes.map((c) => c.action)).toEqual(["groups"]);
    expect(figureTextFix(s, { fromSpec: true }).changes.map((c) => c.action)).toEqual(["words"]);
    expect(figureTextFix(s, {}).changes).toEqual([]);
    const t = frenchTable("A number bank for one to twenty.");
    expect(figureTextFix(t, { specRepair: true }).changes).toEqual([]);
  });

  test("other kinds and slides without figures are untouched", () => {
    const s = { heading: "x", figure: { kind: "line-graph", alt: "1 to 20", shows: "" } };
    expect(figureTextFix(s)).toEqual({ slide: s, changes: [] });
  });
});

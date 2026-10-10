import { describe, expect, test } from "bun:test";
import { layoutTemplate, shownMinFont } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { fixture, type J } from "./harness";

/* Group C (slot room): study figures squeezed into small slots (FIX-PLAN, UX ruling 194). */

const els = (s: { elements: unknown[] }) => s.elements as J[];
const diagram = (s: { elements: unknown[] }) => els(s).find((e) => e.name === "Diagram");

describe("REGISTER diagrams-05: study figures squeezed into small slots", () => {
  test("FIXED diagrams-05: a teaching flow that reads larger across the slide goes across, its points as body-size key cards", () => {
    const shipped = fixture<{ elements: J[] }>("diagrams-05").elements.find(
      (e) => e.name === "Diagram",
    );
    // Shipped (pr440-paid-2 s8): the drawing was a 788x97 band under three points.
    expect(Number(shipped?.h)).toBeLessThan(100);
    for (const nodes of [
      ["Light", "Leaf", "Glucose", "Growth"],
      ["Evaporation", "Condensation", "Precipitation", "Collection", "Run-off", "Rivers"],
    ]) {
      const spec = {
        kind: "flow",
        alt: "x",
        nodes,
        links: nodes.slice(1).map((_, i) => ({ from: i, to: i + 1 })),
      };
      const input = (template: string) =>
        ({
          template,
          heading: "How it moves",
          lead: "Each stage leads to the next.",
          points: [
            "The first stage starts it.",
            "Each step needs the last.",
            "The end feeds back.",
          ],
          figure: { diagram: spec },
        }) as never;
      const across = layoutTemplate(input("big-diagram"), getTheme("studio"), "ks3").slide;
      const beside = layoutTemplate(input("diagram-text"), getTheme("studio"), "ks3").slide;
      const d = diagram(across) as J;
      expect(Number(d.w)).toBe(788);
      expect(Number(d.h)).toBeGreaterThan(1.2 * Number(shipped?.h));
      // Type floor: the drawing's smallest text is 18 pt or more and no smaller than beside the
      // words; the cards are at the points' body size.
      const min = shownMinFont(d as never) ?? 0;
      expect(min).toBeGreaterThanOrEqual(18);
      const side = diagram(beside);
      if (side) expect(min).toBeGreaterThanOrEqual(shownMinFont(side as never) ?? 0);
      const cardText = els(across).filter((e) => e.name === "Point");
      const pointText = els(beside).filter((e) => e.name === "Point");
      expect(els(across).filter((e) => e.name === "Key card")).toHaveLength(3);
      expect(cardText.map((e) => (e.style as J)?.fontSize)).toEqual(
        pointText.map((e) => (e.style as J)?.fontSize),
      );
    }
  });

  test("a full-width layout that would set the labels smaller keeps the slide diagram + text (type-floor check)", () => {
    // A 4-row table draws larger beside the words (zoomed to the side slot) than in the band left
    // over by the key cards, so it stays beside them.
    const table = {
      kind: "table",
      alt: "Readings",
      header: ["Test", "Time (s)", "Reading"],
      rows: [
        ["Gas", "10", "20 cm³"],
        ["Gas", "30", "60 cm³"],
        ["Mass", "0", "85.0 g"],
        ["Mass", "30", "84.4 g"],
      ],
    };
    const r = layoutTemplate(
      {
        template: "big-diagram",
        heading: "Mean rate: change divided by time",
        lead: "Mean rate = quantity changed ÷ time taken",
        points: [
          "Gas: (60 − 20) ÷ (30 − 10) = 2 cm³/s",
          "Mass lost: (85.0 − 84.4) ÷ 30 = 0.020 g/s",
          "Use the change, not just the final reading.",
        ],
        figure: { diagram: table },
      } as never,
      getTheme("studio"),
      "ks4",
    );
    expect(els(r.slide).some((e) => e.name === "Key card")).toBe(false);
    expect(Number(diagram(r.slide)?.w)).toBe(348);
  });
});

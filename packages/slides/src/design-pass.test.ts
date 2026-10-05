import { describe, expect, it } from "bun:test";
import { monotonePath } from "./diagrams/line-graph";
import { materialiseSlide } from "./materialise";
import { noPictureTitleVariant } from "./no-picture";
import { curlyQuotes, quoteParts } from "./quote";
import { THEMES } from "./themes";

const meta = { promptVersion: "t", model: "t", at: "2026-10-05T00:00:00.000Z" };

describe("design pass (UX rulings 151-157)", () => {
  it("157: sets straight double quotes curly and leaves apostrophes", () => {
    expect(curlyQuotes('He said "go" and Pythagoras\' theorem')).toBe(
      "He said “go” and Pythagoras' theorem",
    );
  });

  it("157: lifts a verse quotation with its speaker and act and scene", () => {
    const q = quoteParts(
      'Prospero tells Ariel, "I will rend an oak / And peg thee in his knotty entrails" (1.2). How does this threat secure service?',
    );
    expect(q?.lines).toEqual(["I will rend an oak", "And peg thee in his knotty entrails"]);
    expect(q?.speaker).toBe("Prospero");
    expect(q?.where).toBe("Act 1 Scene 2");
    expect(q?.rest).toBe("How does this threat secure service?");
  });

  it("157: a short quoted word is not a quote block", () => {
    expect(quoteParts('"My" is possessive')).toBeUndefined();
  });

  it("156: a title with no photo is a cover on every theme, never the bare stack", () => {
    const spec = {
      kind: "title" as const,
      title: "The Tempest: Prospero and the mechanics of power",
      subtitle: "Year 10 · English",
      factRefs: [],
    };
    const variant = noPictureTitleVariant(() => false);
    expect(variant).toBe("cover-long");
    for (const t of THEMES) {
      const slide = materialiseSlide(spec, t.id, meta, undefined, variant);
      expect(slide.elements.some((e) => e.name === "Cover pattern")).toBe(true);
      expect(slide.elements.some((e) => e.name === "Band")).toBe(true);
    }
  });

  it("155: a curve through a plateau never rises above it", () => {
    const d = monotonePath([
      [0, 100],
      [10, 40],
      [20, 20],
      [30, 20],
    ]);
    const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20);
  });

  it("151: a five-step worked example is step rows, never the working card, on every theme", () => {
    const spec = {
      kind: "worked-example" as const,
      heading: "Calculating reaction rates",
      question:
        "How are the mean rate over 40 s and the instantaneous rate at 20 s determined for the magnesium reaction?",
      steps: [
        "Mean rate = amount formed ÷ time (mean means the average over an interval)",
        "48 ÷ 40 = 1.2 cm³/s (48 cm³ forms in the first 40 s)",
        "Draw a tangent at 20 s (a tangent follows the curve's slope at that point)",
        "Tangent rise/run = (48 − 20) ÷ (30 − 10) (use two points on the tangent)",
        "Instantaneous rate = 28 ÷ 20 = 1.4 cm³/s (the rate at that single moment)",
      ],
      factRefs: [],
    };
    for (const t of THEMES) {
      const slide = materialiseSlide(spec, t.id, meta);
      expect([t.id, slide.elements.some((e) => e.name === "Working card")]).toEqual([t.id, false]);
    }
  });
});

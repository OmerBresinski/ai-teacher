import { describe, expect, test } from "bun:test";
import type { OutlineEntry, Slide } from "@tj/domain/documents";
import { fitsPlanned, materialiseSlide, type SlideSpec } from "@tj/slides";
import { renderSlot, slotRender } from "../planner/coded-slides";
import type { DesignSlot } from "../prompts/design-cycle";
import { designerRepairGate, designerRepairRejected, heldToSlot } from "./repair";

const META = { promptVersion: "t", model: "t", at: "1970-01-01T00:00:00.000Z" };

/* Smoke r1's two discards: a photo slot (weimar slide 8) and a diagram slot (plants slide 4). */
const photoSlot: DesignSlot = {
  form: "photo",
  heading: "The Rentenmark helped restore confidence in money",
  body: "Introduced in 1923, the new currency was backed by land and industrial property.",
  imageBrief: { subject: "Rentenmark banknotes from 1923", mustShow: ["the currency name"] },
};
const photoEntry: OutlineEntry = {
  id: "s8",
  kind: "content",
  factRefs: ["o3"],
  imageBrief: {
    subject: "Rentenmark banknotes from 1923",
    mustShow: ["the currency name"],
    purpose: "context",
  },
};
const diagramSlot: DesignSlot = {
  form: "diagram-slot",
  heading: "Roots, stems and leaves keep a plant alive",
  body: "Roots take in water, stems carry it to the leaves, and leaves use it to make food.",
  diagram: "A plant with roots, stem and leaves labelled, arrows showing water moving up",
};
const stored = (slot: DesignSlot): Slide => renderSlot(slotRender(slot, "s"), "chalk", META);

describe("designer repair held to its slot (repair discards, smoke r1)", () => {
  test("points a rewrite adds beside a photo move to the notes, word for word, and it fits", () => {
    const original = stored(photoSlot);
    const rewrite: SlideSpec = {
      kind: "content",
      factRefs: ["o3"],
      heading: photoSlot.heading,
      body: "The Rentenmark was backed by land and industrial property, so people trusted it.",
      points: [
        "Its supply was strictly limited by the new Reichsbank rules.",
        "It replaced the worthless paper mark at a fixed rate.",
      ],
    };
    const held = heldToSlot(rewrite, original, photoEntry);
    expect((held.spec as { points?: string[] }).points).toBeUndefined();
    expect(held.spec.notes).toContain(
      "Its supply was strictly limited by the new Reichsbank rules.; It replaced the worthless paper mark at a fixed rate.",
    );
    expect(held.structure).toEqual({
      photo: { subject: "Rentenmark banknotes from 1923", mustShow: ["the currency name"] },
    });
    const gate = designerRepairGate(rewrite, original, photoEntry);
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    // Stored with its photo zone, as the designer laid it out.
    const slide = materialiseSlide(
      gate.spec,
      "chalk",
      META,
      undefined,
      gate.variant,
      gate.structure,
    );
    expect(slide.elements.some((e) => e.type === "image")).toBe(true);
  });

  test("a diagram slot keeps its instruction when the rewrite drops it", () => {
    const original = stored(diagramSlot);
    const rewrite: SlideSpec = {
      kind: "content",
      factRefs: ["o1"],
      heading: diagramSlot.heading,
      body: "Roots take in water; stems carry it up; leaves use it to make food.",
    };
    const held = heldToSlot(rewrite, original, undefined);
    expect((held.spec as { diagram?: string }).diagram).toBe(diagramSlot.diagram);
    expect(designerRepairRejected(rewrite, original)).toBeUndefined();
  });

  test("a photo slot is measured and stored with its photo zone", () => {
    const original = stored(photoSlot);
    const sentence =
      "The new currency was backed by land and industrial property, which people could see and value.";
    const grown: SlideSpec = {
      kind: "content",
      factRefs: [],
      heading: photoSlot.heading,
      body: [sentence, sentence, sentence, sentence].join(" "),
    };
    // The old gate measured it without the photo zone: it passed, and the stored slide lost its
    // photo. Measured as stored, it does not fit and is discarded.
    expect(fitsPlanned(grown, { stepDown: 1 }).ok).toBe(true);
    expect(designerRepairRejected(grown, original, photoEntry)).toBe("does not fit");
  });

  test("old notes brought onto the slide are still refused", () => {
    const original = {
      ...stored(photoSlot),
      notes: "Ask the class why a currency needs people to trust it first.",
    };
    const rewrite: SlideSpec = {
      kind: "content",
      factRefs: [],
      heading: photoSlot.heading,
      body: "Ask the class why a currency needs people to trust it first.",
    };
    expect(designerRepairRejected(rewrite, original, photoEntry)).toBe(
      "notes moved onto the slide",
    );
    // A rewrite that really does not fit, even held, is still discarded.
    const long: SlideSpec = {
      kind: "content",
      factRefs: [],
      heading: photoSlot.heading,
      body: Array.from(
        { length: 12 },
        () => "The new currency was trusted because land backed it.",
      ).join(" "),
    };
    expect(designerRepairRejected(long, original, photoEntry)).toBe("does not fit");
  });
});

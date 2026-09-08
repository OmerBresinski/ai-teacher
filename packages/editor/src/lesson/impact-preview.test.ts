import { describe, expect, test } from "bun:test";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { impactPreview, impactSentence, slidesReferencing } from "./impact-preview";

/* The regenerate dialog's informational "Also changes" line (ADR 0025 §18). */

describe("impactPreview", () => {
  test("a slide sharing a fact with another AI slide names that slide", () => {
    const lesson = generatedLesson();
    // Slide 2 (objectives) carries o1 and o2; slide 4 (multiple-choice) carries q1 and o1.
    const preview = impactPreview(lesson, { slideId: "s-objectives" });
    expect(preview.factRefs).toEqual(expect.arrayContaining(["o1", "o2"]));
    expect(preview.slides).toEqual([{ slideId: "s-mc", number: 4 }]);
    expect(impactSentence(preview)).toBe("Also changes: slide 4");
  });

  test("an element target narrows the facts to that element", () => {
    const lesson = generatedLesson();
    // "ob-2" is derived from o2 only, which no other slide uses.
    const preview = impactPreview(lesson, { slideId: "s-objectives", elementId: "ob-2" });
    expect(preview.factRefs).toEqual(["o2"]);
    expect(preview.slides).toEqual([]);
    expect(impactSentence(preview)).toBe("Also changes: —");
  });

  test("teacher-authored elements are not in the impact set; several slides read as a list", () => {
    const lesson = generatedLesson();
    const title = lesson.slides[0];
    const vocab = lesson.slides[2];
    if (!title?.elements[0] || !vocab?.elements[1]) throw new Error("fixture");
    // Make the title slide lean on o1 too — once as AI, once as the teacher's own edit.
    title.elements[0] = {
      ...title.elements[0],
      generatedFrom: {
        factRefs: ["o1"],
        promptVersion: "p",
        model: "m",
        at: "2026-09-08T00:00:00.000Z",
      },
      authoredBy: "ai",
    };
    vocab.elements[1] = {
      ...vocab.elements[1],
      generatedFrom: { ...vocab.elements[1].generatedFrom, factRefs: ["o1"] } as never,
      authoredBy: "teacher",
    };
    const preview = impactPreview(lesson, { slideId: "s-mc", elementId: "q" });
    expect(preview.slides.map((s) => s.number)).toEqual([1, 2]);
    expect(impactSentence(preview)).toBe("Also changes: slides 1, 2");
    expect(impactPreview(lesson, { slideId: "missing" })).toEqual({ factRefs: [], slides: [] });
  });

  test("slidesReferencing lists the slides a cascade for the facts would touch", () => {
    const lesson = generatedLesson();
    expect(slidesReferencing(lesson, ["o1"])).toEqual(["s-objectives", "s-mc"]);
    expect(slidesReferencing(lesson, ["v2"])).toEqual(["s-vocab"]);
    expect(slidesReferencing(lesson, ["nope"])).toEqual([]);
  });
});

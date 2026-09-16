import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIDENCE,
  DEFAULT_VERB,
  isYoungClass,
  lessonShapeOf,
  OBJECTIVE_VERBS,
  PRIOR_CONFIDENCES,
  teachingSlidesFor,
} from "./shapes";

const shape = (verb: string, confidence: string, yearGroup?: string) =>
  lessonShapeOf({ objectiveVerb: verb, priorConfidence: confidence }, { yearGroup });

describe("lessonShapeOf (project: Lesson shape by objective verb)", () => {
  test("missing or unknown answers fall back to the brief screen's suggestions", () => {
    expect(lessonShapeOf(undefined)).toMatchObject({
      verb: DEFAULT_VERB,
      confidence: DEFAULT_CONFIDENCE,
    });
    expect(lessonShapeOf({ objectiveVerb: "Sing", priorConfidence: "Maybe" })).toMatchObject({
      verb: "Explain",
      confidence: "Some prior knowledge",
    });
    // The web stores the verb as "Explain the water cycle": the verb is the first word.
    expect(lessonShapeOf({ objectiveVerb: "Apply fractions to money" }).verb).toBe("Apply");
  });

  test("Recall / New to it: definition first, vocabulary slide, retrieval only, no open-response", () => {
    const s = shape("Recall", "New to it");
    expect(s.firstExplainKind).toBe("content");
    expect(s.requireVocabulary).toBe(true);
    expect(s.requiredKinds).toContain("vocabulary");
    expect(s.forbiddenKinds).toEqual(["open-response"]);
    expect(s.minCheckEntries).toBe(3);
    expect(s.explainMinPercent).toBe(40);
    expect(s.tierWeights.easy).toBeGreaterThan(s.tierWeights.stretch);
  });

  test("Explain / Some prior knowledge: definition, two content slides, reasoning example, why-question, misconception", () => {
    const s = shape("Explain", "Some prior knowledge");
    expect(s.firstExplainKind).toBe("content");
    expect(s.minContent).toBe(2);
    expect(s.requiredKinds).toEqual(expect.arrayContaining(["worked-example", "open-response"]));
    expect(s.requireMisconceptionConfronted).toBe(true);
    expect(s.explainMinPercent).toBe(30);
    expect(s.requireVocabulary).toBe(false);
  });

  test("Apply / Revisiting: method before practice, no definition slide, practice-heavy, stretch weighted", () => {
    const s = shape("Apply", "Revisiting");
    expect(s.requireWorkedExampleBeforePractise).toBe(true);
    expect(s.firstExplainKind).toBeNull();
    expect(s.requireVocabulary).toBe(false);
    expect(s.practiseMinPercent).toBeGreaterThanOrEqual(40);
    expect(s.explainMinPercent).toBeLessThanOrEqual(20);
    expect(s.tierWeights.stretch).toBeGreaterThanOrEqual(4);
  });

  test("Evaluate: criteria, two cases, a judgement with reasons — softened below Year 5", () => {
    const older = shape("Evaluate", "Some prior knowledge", "Year 8");
    expect(older.requireTwoCases).toBe(true);
    expect(older.requiredKinds).toEqual(expect.arrayContaining(["content", "open-response"]));
    expect(older.judgementStem).toBe("which … and why");
    expect(older.young).toBe(false);
    const younger = shape("Evaluate", "Some prior knowledge", "Year 3");
    expect(younger.young).toBe(true);
    expect(younger.judgementStem).toBe("which … and one reason");
    expect(younger.requireTwoCases).toBe(true);
    // Softening is Evaluate's alone.
    expect(shape("Explain", "New to it", "Year 2").young).toBe(false);
  });

  test("New to it adds the vocabulary slide to every verb; Revisiting removes it", () => {
    for (const verb of OBJECTIVE_VERBS) {
      expect(shape(verb, "New to it").requiredKinds).toContain("vocabulary");
      expect(shape(verb, "Revisiting").requiredKinds).not.toContain("vocabulary");
    }
  });

  test("every cell builds and is internally consistent", () => {
    for (const verb of OBJECTIVE_VERBS) {
      for (const confidence of PRIOR_CONFIDENCES) {
        const s = shape(verb, confidence);
        expect(s.requiredKinds.some((k) => s.forbiddenKinds.includes(k))).toBe(false);
        expect(s.explainMinPercent + s.practiseMinPercent).toBeLessThanOrEqual(80);
        const total = s.tierWeights.easy + s.tierWeights.core + s.tierWeights.stretch;
        expect(total).toBeGreaterThanOrEqual(10);
      }
    }
  });

  test("isYoungClass reads the year first, then the band", () => {
    expect(isYoungClass("Year 4", undefined)).toBe(true);
    expect(isYoungClass("Year 5", "ks2")).toBe(false);
    expect(isYoungClass("Reception", undefined)).toBe(true);
    expect(isYoungClass(undefined, "ks1")).toBe(true);
    expect(isYoungClass(undefined, "ks2")).toBe(false);
    expect(isYoungClass("Y10", "ks4")).toBe(false);
    expect(isYoungClass("Key Stage 3", "ks3")).toBe(false);
    expect(isYoungClass("Key Stage 1", "ks1")).toBe(true);
  });
});

describe("minTeachingSlides (quality lab, Sept 2026)", () => {
  test("one teaching slide per quarter hour, at most five, never below minContent", () => {
    expect(teachingSlidesFor(2, 60)).toBe(4);
    expect(teachingSlidesFor(2, 45)).toBe(3);
    expect(teachingSlidesFor(1, 20)).toBe(1);
    expect(teachingSlidesFor(2, 20)).toBe(2);
    expect(teachingSlidesFor(1, 120)).toBe(5);
    expect(teachingSlidesFor(2, undefined)).toBe(2);
  });
  test("the shape carries it from the lesson length; the judge's shape (no length) keeps minContent", () => {
    const hour = lessonShapeOf(
      { objectiveVerb: "Explain", priorConfidence: "New to it" },
      { yearGroup: "Year 4", durationMin: 60 },
    );
    expect(hour.minTeachingSlides).toBe(4);
    expect(
      lessonShapeOf({ objectiveVerb: "Explain" }, { yearGroup: "Year 4" }).minTeachingSlides,
    ).toBe(2);
  });
});

import { describe, expect, it } from "bun:test";
import type { Lesson, LessonFacts, OutlineEntry } from "@tj/domain/documents";
import { demoLibrary } from "@tj/editor/starter";
import { pendingSlides } from "./pending-slides";

const KINDS: OutlineEntry["kind"][] = [
  "title",
  "objectives",
  "starter",
  "vocabulary",
  "content",
  "worked-example",
  "multiple-choice",
  "content",
  "true-false",
  "discussion",
  "plenary",
];

function facts(kinds: readonly OutlineEntry["kind"][]): LessonFacts {
  return {
    objectives: [],
    vocabulary: [],
    workedExamples: [],
    questions: [],
    misconceptions: [],
    outline: kinds.map((kind, i) => ({ id: `s${i + 1}`, kind, minutes: 5, factRefs: [] })),
    durationMin: 60,
  };
}

/** The demo lesson carries no `facts`, as a lesson the pipeline has only just started does not. */
function lessonWith(slides: number, lessonFacts?: LessonFacts): Lesson {
  const base = demoLibrary()[0];
  if (!base) throw new Error("demo lesson missing");
  const lesson: Lesson = { ...base, slides: base.slides.slice(0, slides) };
  if (lessonFacts) lesson.facts = lessonFacts;
  return lesson;
}

describe("pendingSlides", () => {
  it("is the outline past the slides written so far", () => {
    expect(pendingSlides(lessonWith(4, facts(KINDS)))).toEqual(
      KINDS.slice(4).map((kind) => ({ kind })),
    );
  });

  it("promises the objectives slide after a lone title slide, before the outline exists", () => {
    expect(pendingSlides(lessonWith(1))).toEqual([{ kind: "objectives" }]);
  });

  it("promises nothing otherwise", () => {
    expect(pendingSlides(lessonWith(0))).toEqual([]);
    expect(pendingSlides(lessonWith(2))).toEqual([]);
    expect(pendingSlides(lessonWith(3, facts(["title", "objectives", "plenary"])))).toEqual([]);
    expect(pendingSlides(lessonWith(4, facts(["title", "objectives", "plenary"])))).toEqual([]);
  });
});

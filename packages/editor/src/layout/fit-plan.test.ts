import { describe, expect, test } from "bun:test";
import { type Lesson, LessonSchema, type Slide, type TextElement } from "@tj/domain/documents";
import { docFromText, newLesson, newSlide } from "../model/factories";
import { FIT_VERSION } from "../model/themes";
import {
  fitMigrationMessage,
  fitVersionOf,
  isFitStale,
  planFitMigration,
  renderedHeights,
} from "./fit-plan";
import { findOverlaps } from "./lint";
import type { Measurer } from "./reflow";

/* TeachDeck `fit-migration.test.ts`, the pure half (fitVersionOf, planFitMigration, renderedHeights, message). */

const slide = (id: string): Slide => ({ id, kind: "content", elements: [] });
const lessonWith = (fitVersion: number | undefined, ids: string[]): Lesson => ({
  ...newLesson("The water cycle", "chalk"),
  ...(fitVersion === undefined ? {} : { fitVersion }),
  slides: ids.map(slide),
});

describe("fitVersionOf", () => {
  test("reads a lesson with no version as 0, which is behind every table", () => {
    const lesson = lessonWith(undefined, ["a"]);
    delete (lesson as { fitVersion?: number }).fitVersion;
    expect(fitVersionOf(lesson)).toBe(0);
    expect(isFitStale(lesson)).toBe(true);
  });
  test("defaults a stored document that predates the field to 0, not to the current table", () => {
    const raw = JSON.parse(JSON.stringify(newLesson("Old", "chalk"))) as Record<string, unknown>;
    delete raw.fitVersion;
    const lesson = LessonSchema.parse(raw);
    expect(lesson.fitVersion).toBe(0);
    expect(isFitStale(lesson)).toBe(true);
  });
  test("stamps a freshly made lesson with the current table", () => {
    expect(newLesson("New", "chalk").fitVersion).toBe(FIT_VERSION);
    expect(isFitStale(newLesson("New", "chalk"))).toBe(false);
  });
});

describe("planFitMigration", () => {
  test("does nothing at all for a lesson already at the current version", () => {
    let linted = 0;
    const plan = planFitMigration(lessonWith(FIT_VERSION, ["a", "b"]), () => {
      linted += 1;
      return true;
    });
    expect(plan).toEqual({ needed: false, slideIds: [], version: FIT_VERSION });
    expect(linted).toBe(0);
  });
  test("does nothing for a lesson stamped ahead of the current version", () => {
    expect(planFitMigration(lessonWith(FIT_VERSION + 1, ["a"]), () => true).needed).toBe(false);
  });
  test("re-fits only the slides the linter flags, in document order", () => {
    const flagged = new Set(["d", "b"]);
    const plan = planFitMigration(lessonWith(1, ["a", "b", "c", "d"]), (s) => flagged.has(s.id), 2);
    expect(plan.needed).toBe(true);
    expect(plan.slideIds).toEqual(["b", "d"]);
  });
  test("leaves a stale lesson whose slides all pass untouched, but still stamps it", () => {
    expect(planFitMigration(lessonWith(1, ["a", "b"]), () => false, 2)).toEqual({
      needed: true,
      slideIds: [],
      version: 2,
    });
  });
  test("reports the version to stamp, which is the current table", () => {
    expect(planFitMigration(lessonWith(0, ["a"]), () => true).version).toBe(FIT_VERSION);
  });
  test("is a no-op on the second run, because the first stamped the lesson", () => {
    const lesson = lessonWith(1, ["a"]);
    const first = planFitMigration(lesson, () => true, 2);
    expect(first.slideIds).toEqual(["a"]);
    expect(planFitMigration({ ...lesson, fitVersion: first.version }, () => true, 2).needed).toBe(
      false,
    );
  });
  test("never plans a slide twice, however many slides the lesson has", () => {
    const plan = planFitMigration(lessonWith(0, ["a", "b", "c"]), () => true, 2);
    expect(plan.slideIds).toEqual(["a", "b", "c"]);
    expect(new Set(plan.slideIds).size).toBe(3);
  });
  test("works on a real lesson of laid-out slides", () => {
    const lesson: Lesson = {
      ...newLesson("W", "chalk"),
      fitVersion: 1,
      slides: [newSlide("title", "chalk"), newSlide("vocabulary", "chalk")],
    };
    expect(planFitMigration(lesson, (s) => s.kind === "vocabulary", 2).slideIds).toEqual([
      lesson.slides[1]?.id ?? "",
    ]);
  });
});

describe("renderedHeights", () => {
  const textEl = (
    id: string,
    y: number,
    h: number,
    o: { autoHeight?: boolean; preset?: "small" | "body" } = {},
  ): TextElement => ({
    id,
    type: "text",
    x: 58,
    y,
    w: 413,
    h,
    doc: docFromText("A definition that runs to two lines on the board"),
    style: { preset: o.preset ?? "small", autoHeight: o.autoHeight ?? true },
  });
  /** A definition needs 75pt (two lines of `small` at the 24pt floor), a term 41pt. */
  const ruler: Measurer = (input) => (input.preset === "small" ? 75 : 41);

  test("grows an auto-height box to the height its text needs", () => {
    expect(
      renderedHeights({ id: "s", kind: "vocabulary", elements: [textEl("def", 185, 62)] }, ruler)
        .elements[0]?.h,
    ).toBe(75);
  });
  test("leaves a fixed-height box alone: its overflow is the linter's other check", () => {
    expect(
      renderedHeights(
        { id: "s", kind: "vocabulary", elements: [textEl("def", 185, 62, { autoHeight: false })] },
        ruler,
      ).elements[0]?.h,
    ).toBe(62);
  });
  test("never shrinks a box that is already taller than its text", () => {
    expect(
      renderedHeights({ id: "s", kind: "vocabulary", elements: [textEl("def", 185, 120)] }, ruler)
        .elements[0]?.h,
    ).toBe(120);
  });
  test("finds the overlap the stored document hides, which is the whole bug", () => {
    const s: Slide = {
      id: "s",
      kind: "vocabulary",
      elements: [textEl("def", 185, 62), textEl("next-term", 251, 38, { preset: "body" })],
    };
    expect(findOverlaps(s)).toEqual([]);
    expect(findOverlaps(renderedHeights(s, ruler))).toEqual([["def", "next-term"]]);
  });
});

describe("fitMigrationMessage", () => {
  test("counts the slides it tidied", () => {
    expect(fitMigrationMessage(1)).toBe("1 slide tidied to fit the new text sizes.");
    expect(fitMigrationMessage(2)).toBe("2 slides tidied to fit the new text sizes.");
  });
  test("says nothing when nothing moved", () => {
    expect(fitMigrationMessage(0)).toBe("");
  });
  test("stays in one sentence, no exclamation, no em dash, no helper", () => {
    const message = fitMigrationMessage(3);
    expect(message).not.toMatch(/[!—]|just|really|actually/i);
    expect(message.split(".").filter((s) => s.trim()).length).toBe(1);
  });
});

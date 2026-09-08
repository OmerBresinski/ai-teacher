import { describe, expect, test } from "bun:test";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
import { findingsBySlide, residualFindings, thingsToCheck } from "./residual-findings";

/* The merge behind the residual badge (ADR 0025 §12): stored model findings + live schema findings. */

describe("residualFindings", () => {
  test("a lesson without facts and without generation state has nothing to check", () => {
    const lesson = generatedLesson();
    delete lesson.facts;
    delete lesson.generation;
    expect(residualFindings(lesson)).toEqual([]);
  });

  test("keeps the stored model findings and adds the live schema findings", () => {
    const lesson = generatedLesson();
    const mc = lesson.slides[3];
    if (mc?.question?.type !== "multiple-choice") throw new Error("fixture");
    mc.question = {
      ...mc.question,
      options: mc.question.options.map((o) => ({ ...o, correct: false })),
    };
    const findings = residualFindings(lesson, generatedWorksheet());
    expect(findings.map((f) => [f.check, f.target.slideId])).toEqual([
      ["age-fit", "s-vocab"],
      ["question-answer", "s-mc"],
    ]);
  });

  test("a stored schema finding is dropped in favour of the live recomputation", () => {
    const lesson = generatedLesson();
    lesson.generation?.findings.push({
      check: "question-answer",
      severity: "error",
      target: { slideId: "s-mc" },
      message: "stale: the teacher has since set an answer",
    });
    // The fixture's multiple-choice slide has a correct option, so the live check is clean.
    expect(residualFindings(lesson).map((f) => f.check)).toEqual(["age-fit"]);
  });

  test("the budget finding survives, and duplicates by check + target collapse", () => {
    const lesson = generatedLesson();
    const budget = {
      check: "budget",
      severity: "error" as const,
      target: {},
      message: "Generation stopped at slide 6: the lesson's cost cap was reached.",
    };
    lesson.generation?.findings.push(budget, { ...budget, message: "again" });
    const findings = residualFindings(lesson);
    expect(findings.filter((f) => f.check === "budget")).toHaveLength(1);
    expect(findings.find((f) => f.check === "budget")?.message).toBe(budget.message);
  });

  test("without the worksheet the objective-coverage worksheet half is skipped, not failed", () => {
    const lesson = generatedLesson();
    expect(residualFindings(lesson).some((f) => f.check === "objective-coverage")).toBe(false);
    const ws = generatedWorksheet();
    ws.blocks = ws.blocks.map((b) => ({ ...b, generatedFrom: undefined }));
    expect(
      residualFindings(lesson, ws).filter((f) => f.check === "objective-coverage"),
    ).toHaveLength(2);
  });

  test("findingsBySlide groups by slide and leaves lesson-level findings out", () => {
    const by = findingsBySlide([
      { check: "a", severity: "warning", target: { slideId: "s1" }, message: "" },
      { check: "b", severity: "error", target: { slideId: "s1" }, message: "" },
      { check: "timing", severity: "warning", target: {}, message: "" },
    ]);
    expect([...by.keys()]).toEqual(["s1"]);
    expect(by.get("s1")).toHaveLength(2);
  });

  test("thingsToCheck pluralises", () => {
    expect(thingsToCheck(1)).toBe("1 thing to check");
    expect(thingsToCheck(2)).toBe("2 things to check");
  });
});

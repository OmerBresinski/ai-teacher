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

  test("a stored timing finding on an old lesson is retired, not shown (ruling 82)", () => {
    const lesson = generatedLesson();
    if (!lesson.facts) throw new Error("fixture");
    // Generated before ruling 82: minutes on every entry and the timing warning the job stored.
    lesson.facts.outline = lesson.facts.outline.map((entry) => ({ ...entry, minutes: 1 }));
    lesson.generation?.findings.push({
      check: "timing",
      severity: "warning",
      target: {},
      message: "The outline plans 6 minutes for a 60-minute lesson.",
    });
    // Only the fixture's stored model finding is left; the timing line never reaches the editor.
    expect(residualFindings(lesson, generatedWorksheet()).map((f) => f.check)).toEqual(["age-fit"]);
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

  test("applied Verify corrections are not things to check; the failed-call finding is", () => {
    const lesson = generatedLesson();
    lesson.generation?.findings.push(
      {
        check: "fact-verify",
        severity: "warning",
        target: { factId: "q3" },
        message: "Question stem corrected: could be read two ways.",
      },
      {
        check: "fact-verify",
        severity: "warning",
        target: { factId: "v1" },
        message: "Vocabulary term corrected: not the accepted term.",
      },
      { check: "pitch", severity: "warning", target: {}, message: "Pitched a year too high." },
    );
    const stored = residualFindings(lesson).filter((f) => f.check !== "age-fit");
    expect(stored.map((f) => f.check)).toEqual(["pitch"]);

    const failed = generatedLesson();
    failed.generation?.findings.push({
      check: "fact-verify",
      severity: "warning",
      target: {},
      message: "Fact verification could not be completed.",
    });
    expect(residualFindings(failed).some((f) => f.check === "fact-verify")).toBe(true);
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

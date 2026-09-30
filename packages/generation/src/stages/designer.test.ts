import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { isGeneratedSlide } from "@tj/slides";
import { labAi, romansLesson, versionsOf } from "../planner/testing";
import { recordingDeps } from "../testing";
import { runLessonPipeline } from "../workflow";
import { isDesignerStamp, plannerOf, resumeFromDesigner } from "./objectives-first";

const romans = (slideCount: 6 | 8 | 10 | 12): Lesson => {
  const lesson = romansLesson();
  return { ...lesson, brief: { ...(lesson.brief as NonNullable<Lesson["brief"]>), slideCount } };
};

describe("the lesson designer (AI_LESSON_PLANNER=designer)", () => {
  test("title first, then the deck at exactly the count asked, saved one slide at a time", async () => {
    const ai = labAi({
      retrieval: [
        { question: "What is an empire?", answer: "Lands ruled by one ruler" },
        { question: "Who were the Celts?", answer: "People living in Britain" },
        { question: "What is a soldier?", answer: "Someone who fights in an army" },
      ],
    });
    const deps = recordingDeps(ai);
    const final = await runLessonPipeline({ lesson: romans(10) }, deps, { planner: "designer" });
    const lesson = final.lesson;
    expect(lesson.slides).toHaveLength(10);
    expect(lesson.slides.map((s) => s.kind)).toEqual([
      "title",
      "objectives",
      "starter",
      "content",
      "true-false",
      "content",
      "true-false",
      "content",
      "true-false",
      "exit-ticket",
    ]);
    // The title alone is the first save, before any model call returns.
    expect(deps.persisted[0]?.lesson.slides.map((s) => s.kind)).toEqual(["title"]);
    // During the design step the deck only ever grows, one slide or more per save, in order.
    const counts = deps.persisted.map((p) => p.lesson.slides.length);
    const designing = counts.slice(counts.indexOf(3));
    for (let i = 1; i < designing.length; i++)
      expect(designing[i] ?? 0).toBeGreaterThanOrEqual(designing[i - 1] ?? 0);
    expect(Math.max(...counts)).toBe(10);
    // One design-cycle call per objective; no facts, no slide writer.
    const versions = versionsOf(ai);
    expect(versions.filter((v) => v === "design-cycle")).toHaveLength(3);
    expect(versions.some((v) => v.startsWith("generate-slide"))).toBe(false);
    expect(versions.some((v) => v.startsWith("plan-teach"))).toBe(false);
    expect(isDesignerStamp(lesson.generation?.promptVersions.planned)).toBe(true);
    expect(plannerOf(lesson)).toBe("designer");
    // Every slide is generated (Tidy formats it, never splits it) and fitted.
    for (const s of lesson.slides) expect(isGeneratedSlide(s)).toBe(true);
    // The exit ticket: one line per objective, from the cycles' exit questions.
    const exit = lesson.facts?.outline.at(-1);
    expect(exit?.kind).toBe("exit-ticket");
    expect(exit?.factRefs).toHaveLength(3);
    const report = final.designReport;
    expect(report?.allocation).toEqual([2, 2, 2]);
    expect(report?.exitCovered).toBe(3);
    expect(report?.slots).toHaveLength(6);
    expect(report?.failedCycles).toEqual([]);
    expect(report?.minimums.checks).toBe(3);
    // The photo slots carry their brief on the outline for illustrate.
    expect(lesson.facts?.outline.filter((e) => e.imageBrief)).toHaveLength(3);
  });

  test("a cycle that fails twice keeps the count: its slots ask about the objective", async () => {
    const ai = labAi({
      designCycle: (_call, target, count) => {
        if (target === 1) return JSON.stringify({ nope: true });
        return JSON.stringify({
          slots: Array.from({ length: count }, () => ({
            form: "explain",
            heading: "Forts guarded the frontier",
            body: "Soldiers lived in forts.",
          })),
          exitQuestion: { question: "Why forts?", answer: "To guard" },
        });
      },
    });
    const deps = recordingDeps(ai);
    const final = await runLessonPipeline({ lesson: romans(12) }, deps, { planner: "designer" });
    expect(final.lesson.slides).toHaveLength(12);
    expect(final.designReport?.failedCycles).toEqual([1]);
    expect(
      final.lesson.generation?.findings.filter((f) => f.check === "missing-material").length,
    ).toBeGreaterThan(0);
    // Its exit line falls back to nothing it can print; the other two objectives keep theirs.
    expect(final.designReport?.exitCovered).toBe(2);
  });

  test("resume: the objectives checkpoint re-designs; a later checkpoint moves on", () => {
    const lesson = romans(10);
    expect(resumeFromDesigner(lesson)).toBe("check-input");
    const planned = {
      ...lesson,
      facts: {
        ...(lesson.facts as NonNullable<Lesson["facts"]>),
        objectives: [{ id: "o1", text: "x" }],
      },
      generation: {
        jobId: "j",
        stage: "planned" as const,
        startedAt: "2026-09-30T00:00:00.000Z",
        promptVersions: {},
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        findings: [],
      },
    } as unknown as Lesson;
    expect(resumeFromDesigner(planned)).toBe("design");
    const generated = {
      ...planned,
      generation: {
        ...(planned.generation as NonNullable<Lesson["generation"]>),
        stage: "generated" as const,
      },
    };
    expect(resumeFromDesigner(generated)).toBe("illustrate");
  });
});

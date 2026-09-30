import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { isGeneratedSlide } from "@tj/slides";
import weimarFixture from "../fixtures/design-cycle.y9-weimar.json";
import romansFixture from "../fixtures/objective-facts.y4-history-romans.json";
import { designCycleAnswer, labAi, romansLesson, versionsOf } from "../planner/testing";

const romansObjectives = romansFixture.objectives;

import { recordingDeps } from "../testing";
import { runLessonPipeline } from "../workflow";
import { arcsFor } from "./designer";
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

  test("the arcs are saved on the objectives, so the generate job after the plan screen has them", async () => {
    const leans = ["explain", "explain", "worked-example"] as const;
    const withArc = romansObjectives.map((o, i) => ({
      ...o,
      arc: { angle: `Angle ${i + 1}`, lean: leans[i] as string, misconception: `Myth ${i + 1}` },
    }));
    const ai = labAi({ objectives: withArc });
    // The plan job: stops at the plan screen.
    const plannedDeps = recordingDeps(ai);
    const planned = await runLessonPipeline({ lesson: romans(12) }, plannedDeps, {
      planner: "designer",
      stopAfter: "planned",
    });
    const saved = plannedDeps.persisted.at(-1)?.lesson as Lesson;
    expect(saved.facts?.objectives.map((o) => o.arc)).toEqual(withArc.map((o) => o.arc));
    expect(planned.lesson.slides).toHaveLength(2);
    // The generate job: a fresh run from the saved lesson, nothing handed on in-process.
    const genDeps = recordingDeps(ai);
    const final = await runLessonPipeline({ lesson: saved }, genDeps, { planner: "designer" });
    const cycles = ai.calls.filter((c) => c.context?.promptVersion?.startsWith("design-cycle"));
    expect(cycles.length).toBeGreaterThan(0);
    for (const c of cycles)
      expect(c.promptText).toContain("Angle: Angle 3. Leans to: worked-example");
    // The heavy lean weighs in the allocation (unweighted, 12 slides is [3, 3, 2]).
    expect(final.designReport?.allocation).toEqual([3, 2, 3]);
    // An arc the palette no longer has is dropped on read, not sent.
    expect(
      arcsFor(
        [{ id: "o1", text: "x", arc: { angle: "a", lean: "hologram", misconception: "m" } }],
        undefined,
      ),
    ).toEqual([undefined]);
  });

  test("the re-fill call sees the slot it replaces and a structural reason", async () => {
    const tooBig = weimarFixture.electrolysisWorkedExample;
    const refills: string[] = [];
    const ai = labAi({
      designCycle: (call, target, count) => {
        if (call.promptText.includes("This slot replaces")) {
          refills.push(call.promptText);
          return JSON.stringify({
            slots: [
              {
                form: "sequence",
                heading: "Electrolysis of brine",
                body: "Three products form.",
                steps: ["Chlorine at the anode", "Hydrogen at the cathode"],
              },
            ],
            exitQuestion: { question: "Why?", answer: "Because" },
          });
        }
        if (target !== 0) return JSON.stringify(designCycleAnswer(target, count));
        const answer = designCycleAnswer(target, count);
        return JSON.stringify({ ...answer, slots: [tooBig, ...answer.slots.slice(1)] });
      },
    });
    const final = await runLessonPipeline({ lesson: romans(10) }, recordingDeps(ai), {
      planner: "designer",
    });
    expect(refills).toHaveLength(1);
    expect(refills[0]).toContain("This slot replaces a worked-example slot that did not fit");
    expect(refills[0]).toContain(JSON.stringify(tooBig.question));
    expect(refills[0]).toContain("Write the same content as a sequence slot.");
    expect(refills[0]).not.toMatch(/shorter|shorten/i);
    expect(final.designReport?.slots[0]?.rung).toBe("refill");
  });

  test("latency: the first teaching slide goes first, and the deck is saved before Verify", async () => {
    const ai = labAi({
      // The first objective's cycle answers last; the others at once.
      designCycle: async (_call, target, count) => {
        if (target === 0) await new Promise((r) => setTimeout(r, 40));
        return JSON.stringify(designCycleAnswer(target, count));
      },
    });
    const base = recordingDeps(ai);
    const verifyCallsAtSave: number[] = [];
    const deps = {
      ...base,
      persist: async (lesson: Lesson) => {
        if (lesson.generation?.stage === "generated")
          verifyCallsAtSave.push(versionsOf(ai).filter((v) => v === "verify-facts").length);
        return base.persist(lesson);
      },
    };
    const final = await runLessonPipeline({ lesson: romans(10) }, deps, { planner: "designer" });
    const slides = final.lesson.slides;
    // Rendered in that order: the first teaching slide's element ids come before the other
    // cycles' (the counting id supplier), although their answers came 40 ms earlier.
    const firstId = (i: number) => Number(slides[i]?.elements[0]?.id.slice(1));
    expect(firstId(3)).toBeLessThan(firstId(5));
    expect(firstId(3)).toBeLessThan(firstId(7));
    // Saved as generated before the Verify call started, then saved again after it.
    expect(verifyCallsAtSave[0]).toBe(0);
    expect(verifyCallsAtSave.length).toBeGreaterThanOrEqual(2);
    const t = final.designReport?.timings;
    expect(t?.cycles.map((c) => c.objective).sort()).toEqual([0, 1, 2]);
    expect(t?.editableMs).toBeDefined();
    expect(t?.firstSlotSavedMs).toBeDefined();
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

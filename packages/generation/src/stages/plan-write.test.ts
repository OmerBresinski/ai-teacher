import { describe, expect, test } from "bun:test";
import type { FakeCall } from "@tj/ai";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import type { Lesson } from "@tj/domain/documents";
import { isPlanWriteStamp } from "../plan-write/steps";
import { romansLesson } from "../planner/testing";
import type { PlanSlide } from "../prompts/plan-lesson";
import type { WriteSlidesInput } from "../prompts/write-slides";
import { FIXTURES, recordingDeps } from "../testing";
import { runLessonPipeline } from "../workflow";
import { plannerOf } from "./objectives-first";

const json = (v: unknown) => JSON.stringify(v);
const row = (over: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1],
  form: "explain",
  layout: "default",
  purpose: "teach it",
  parts: 1,
  teaches: [],
  tests: [],
  imageBrief: null,
  figureBrief: null,
  ...over,
});
const PLAN = {
  objectives: ["Explain why the Romans built forts", "Describe life in a fort"],
  runningExample: "Vindolanda",
  misconception: "Forts were only for fighting",
  slides: [
    row({ role: "title", form: "title", objectives: [1, 2] }),
    row({ role: "starter", form: "starter-set", parts: 2 }),
    row({ teaches: ["forts"] }),
    row({ objectives: [2], teaches: ["life"] }),
    row({ role: "hinge", form: "hinge", parts: 4, tests: ["forts"] }),
    row({
      role: "exit",
      form: "exit-ticket",
      objectives: [1, 2],
      parts: 2,
      tests: ["forts", "life"],
    }),
  ],
};
const LONG =
  "Soldiers in a Roman fort lived, ate, trained and slept together inside thick stone walls every day";
const ANSWERS: Record<string, unknown> = {
  "starter-set": {
    questions: [
      { question: "What is an empire?", answer: "Lands ruled by one ruler" },
      { question: "Who were the Celts?", answer: "People in Britain" },
    ],
    notes: "Retrieval.",
  },
  explain: {
    heading: "Forts guarded the frontier",
    body: ["Soldiers watched the border from stone forts."],
    notes: "Say it.",
  },
  hinge: {
    stem: "Why did the Romans build forts?",
    options: [
      { text: "To guard the border", correct: true },
      { text: "To store grain", correct: false },
      { text: "To hold markets", correct: false },
      { text: "To house the emperor", correct: false },
    ],
    explanation: "Forts held soldiers who guarded the frontier.",
    notes: "Hinge.",
  },
  "exit-ticket": {
    questions: [
      { question: "Why did the Romans build forts?", answer: "To guard the border" },
      { question: "Where did soldiers sleep?", answer: "In barracks" },
    ],
    notes: "Exit.",
  },
};

/** The slides a writer call was asked for (and a re-write's field), read back from its user turn. */
function writerCallOf(text: string): WriteSlidesInput {
  const slides = [...text.matchAll(/^Slide (\d+): [^,]+, ([a-z-]+)(?: \(([a-z-]+)\))?$/gm)].map(
    (m) => ({
      number: Number(m[1]),
      form: m[2] as string,
      layout: m[3] ?? "default",
      contract: "",
    }),
  );
  const field = /Write (\S+) again/.exec(text)?.[1];
  const base = { topic: "", audience: {}, objectives: [], runningExample: "", misconception: "" };
  return {
    ...base,
    // One plan row per line ("1 title", "2 retrieve · …"): only the count is asserted.
    table: [...text.matchAll(/^\d+ [a-z]/gm)].map(() => ({}) as PlanSlide),
    slides,
    ...(field && slides[0]
      ? { rewrite: { slide: slides[0], field, failure: "", current: {} } }
      : {}),
  };
}

function planWriteAi(calls: WriteSlidesInput[]) {
  const fallback: FakeScriptEntry = async (call: FakeCall) => {
    const version = call.context?.promptVersion ?? "";
    if (version.startsWith("check-input")) return json({ findings: [] });
    if (version.startsWith("plan-lesson")) return json(PLAN);
    if (version.startsWith("write-slides")) {
      const input = writerCallOf(call.promptText);
      calls.push(input);
      if (input.rewrite) return json({ [input.rewrite.field]: "Soldiers lived inside the fort" });
      return json(
        Object.fromEntries(
          input.slides.map((s) => [
            `slide${s.number}`,
            s.number === 4 ? { ...(ANSWERS.explain as object), heading: LONG } : ANSWERS[s.form],
          ]),
        ),
      );
    }
    if (version.startsWith("verify-facts")) return json({ corrections: [] });
    if (version.startsWith("evaluate")) return json({ findings: [] });
    if (version.startsWith("repair")) return json(FIXTURES.repair);
    throw new Error(`unexpected call: ${version}`);
  };
  return createFakeAi({ fallback, usage: { inputTokens: 1000, outputTokens: 400 } });
}

const lesson6 = (): Lesson => {
  const l = romansLesson();
  return { ...l, brief: { ...(l.brief as NonNullable<Lesson["brief"]>), slideCount: 6 } };
};

describe("plan-write (AI_LESSON_PLANNER=plan-write)", () => {
  test("one plan call, parallel writers, one re-write of the failing field, N slides saved in order", async () => {
    const calls: WriteSlidesInput[] = [];
    const deps = recordingDeps(planWriteAi(calls));
    const final = await runLessonPipeline({ lesson: lesson6() }, deps, { planner: "plan-write" });
    const lesson = final.lesson;
    expect(lesson.slides.map((s) => s.kind)).toEqual([
      "title",
      "starter",
      "content",
      "content",
      "multiple-choice",
      "exit-ticket",
    ]);
    // The title alone is the first save.
    expect(deps.persisted[0]?.lesson.slides.map((s) => s.kind)).toEqual(["title"]);
    // Writers: two batches of 2–3 slides, each seeing the whole table; then one re-write.
    const writes = calls.filter((c) => !c.rewrite);
    expect(writes.map((c) => c.slides.map((s) => s.number))).toEqual([
      [2, 3, 4],
      [5, 6],
    ]);
    for (const c of writes) expect(c.table).toHaveLength(6);
    const rewrites = calls.filter((c) => c.rewrite);
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0]?.rewrite?.field).toBe("heading");
    expect(JSON.stringify(lesson.slides[3]?.elements)).toContain("Soldiers lived inside the fort");
    expect(isPlanWriteStamp(lesson.generation?.promptVersions.planned)).toBe(true);
    expect(plannerOf(lesson)).toBe("plan-write");
    expect(lesson.facts?.objectives.map((o) => o.text)).toEqual(PLAN.objectives);
    expect(lesson.facts?.retrieval).toHaveLength(2);
    expect(lesson.facts?.questions.filter((q) => q.use === "exit")).toHaveLength(2);
    expect(lesson.facts?.outline.map((e) => e.kind)[0]).toBe("title");
    // No fit flag: every slide fits after the re-write.
    expect(lesson.generation?.findings.filter((f) => f.check === "fit")).toEqual([]);
  });

  test("stops after the plan when asked: objectives and the table saved as planned", async () => {
    const deps = recordingDeps(planWriteAi([]));
    const final = await runLessonPipeline({ lesson: lesson6() }, deps, {
      planner: "plan-write",
      stopAfter: "planned",
    });
    expect(final.lesson.generation?.stage).toBe("planned");
    expect(final.lesson.facts?.slidePlan).toBeDefined();
    expect(final.lesson.slides).toHaveLength(1);
  });
});

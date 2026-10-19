import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { labAi, recordingDeps, romansLesson } from "../testing";
import type { PipelineState } from "../types";
import { runLessonPipeline } from "../workflow";
import { runFactsStep } from "./facts";
import { generate } from "./generate";

/*
 * Latency lane L1: slide 3 (the retrieval starter) is saved before the facts waves, and slides are
 * saved without waiting for Verify. Only the timing may change: the same mocked answers must give
 * the same deck, byte for byte, with or without the early starter.
 */

const RETRIEVAL = [
  { question: "Which came first in Britain: the Iron Age or the Romans?", answer: "The Iron Age" },
  { question: "What is an invasion?", answer: "An army entering a country to take it over" },
  { question: "Name the sea between Britain and France.", answer: "The English Channel" },
];

/** The row after the plan job (objectives and the retrieval set), confirmed. */
async function confirmedRow(priorKnowledge?: string): Promise<Lesson> {
  const lesson = romansLesson();
  const start = priorKnowledge
    ? ({ ...lesson, brief: { ...lesson.brief, classContext: { priorKnowledge } } } as Lesson)
    : lesson;
  const final = await runLessonPipeline(
    { lesson: start },
    recordingDeps(labAi({ retrieval: RETRIEVAL })),
    { stopAfter: "planned", planner: "objectives-first" },
  );
  return {
    ...final.lesson,
    plan: { revision: 1, state: "confirmed", confirmedAt: "2026-09-26T10:00:00.000Z" },
  } as Lesson;
}

/** The facts step then Generate, on a fresh fake and fresh counters. */
async function factsThenGenerate(row: Lesson, preview: boolean) {
  const deps = recordingDeps(labAi({ retrieval: RETRIEVAL }));
  const { state } = await runFactsStep({ lesson: row } as PipelineState, deps, { preview });
  const done = await generate(state, deps);
  return { deps, lesson: done.lesson };
}

/** A slide without what is drawn fresh per copy: element ids and the stamp's time. */
const content = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (k, v) => (k === "id" || k === "at" ? undefined : v)));

describe("slide 3 before the waves (latency L1)", () => {
  test("the same mocked answers give a byte-identical deck with or without the early starter", async () => {
    const row = await confirmedRow();
    const before = await factsThenGenerate(row, false);
    const after = await factsThenGenerate(row, true);
    expect(JSON.stringify(after.lesson)).toBe(JSON.stringify(before.lesson));
    expect(after.lesson.slides[2]?.kind).toBe("starter");
  });

  test("slide 3 is saved first, before any facts call answers, and is the slide Generate writes", async () => {
    const row = await confirmedRow();
    const { deps, lesson } = await factsThenGenerate(row, true);
    const [first, planned, generated3] = deps.persisted;
    expect(first?.lesson.slides).toHaveLength(3);
    expect(first?.lesson.generation?.stage).toBe(row.generation?.stage);
    // The planned checkpoint keeps it in place; Generate's first save is its own copy of it.
    expect(planned?.lesson.generation?.stage).toBe("planned");
    expect(planned?.lesson.slides[2]).toEqual(first?.lesson.slides[2]);
    expect(content(first?.lesson.slides[2])).toEqual(content(lesson.slides[2]));
    expect(generated3?.lesson.slides).toHaveLength(3);
    // The progress event after the early save carries its `updatedAt`, so the editor refetches.
    expect(deps.progress[0]?.documentUpdatedAt).toBe(first?.updatedAt);
  });

  test("with prior knowledge declared the starter's slot waits for the facts: no early save", async () => {
    const row = await confirmedRow("Pupils know the Iron Age.");
    const { deps } = await factsThenGenerate(row, true);
    expect(deps.persisted[0]?.lesson.generation?.stage).toBe("planned");
    expect(deps.persisted[0]?.lesson.slides).toHaveLength(2);
  });
});

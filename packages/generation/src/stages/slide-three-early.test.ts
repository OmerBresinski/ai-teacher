import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Lesson } from "@tj/domain/documents";
import { labAi, recordingDeps, romansLesson, SAMPLE_JOB_ID } from "../testing";
import { runLessonPipeline } from "../workflow";
import { runFactsStep } from "./facts";
import { generate, isUnverifiedMark } from "./generate";

/*
 * Latency lane L1: slide 3 (the retrieval starter) is saved before the facts waves, and slides are
 * saved without waiting for Verify. Generate writes slide 3 under the early copy's id; a failed or
 * stopped facts step withdraws the early copy; the deck itself is the same.
 */

const json = (v: unknown) => JSON.stringify(v);

const RETRIEVAL = [
  { question: "Which came first in Britain: the Iron Age or the Romans?", answer: "The Iron Age" },
  { question: "What is an invasion?", answer: "An army entering a country to take it over" },
  { question: "Name the sea between Britain and France.", answer: "The English Channel" },
];

/** The row after the plan job (objectives and the retrieval set), confirmed. */
async function confirmedRow(priorKnowledge?: string): Promise<Lesson> {
  const lesson = romansLesson();
  const start: Lesson =
    priorKnowledge && lesson.brief
      ? { ...lesson, brief: { ...lesson.brief, classContext: { priorKnowledge } } }
      : lesson;
  const final = await runLessonPipeline(
    { lesson: start },
    recordingDeps(labAi({ retrieval: RETRIEVAL })),
    { stopAfter: "planned", planner: "objectives-first" },
  );
  return {
    ...final.lesson,
    plan: {
      revision: 1,
      state: "confirmed",
      jobId: SAMPLE_JOB_ID,
      confirmedAt: "2026-09-26T10:00:00.000Z",
    },
  };
}

/** The facts step then Generate, on a fresh fake and fresh counters. */
async function factsThenGenerate(row: Lesson, preview: boolean, verify?: unknown) {
  const deps = recordingDeps(labAi({ retrieval: RETRIEVAL, verify }));
  const { state } = await runFactsStep({ lesson: row }, deps, { preview });
  const done = await generate(state, deps);
  return { deps, lesson: done.lesson };
}

/** The deck with slide 3's id (drawn fresh by the early copy) taken out. */
const withoutSlide3Id = (lesson: Lesson) =>
  JSON.stringify({
    ...lesson,
    slides: lesson.slides.map((s, i) => (i === 2 ? { ...s, id: "slide-3" } : s)),
  });

/** A slide without what is drawn fresh per copy: element ids and the stamp's time. */
const content = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (k, v) => (k === "id" || k === "at" ? undefined : v)));

describe("slide 3 before the waves (latency L1)", () => {
  test("the same mocked answers give the same deck with or without the early starter; slide 3 keeps the early id", async () => {
    const row = await confirmedRow();
    const before = await factsThenGenerate(row, false);
    const after = await factsThenGenerate(row, true);
    expect(withoutSlide3Id(after.lesson)).toBe(withoutSlide3Id(before.lesson));
    const earlyId = after.deps.persisted[0]?.lesson.slides[2]?.id;
    expect(earlyId).toBeDefined();
    expect(after.lesson.slides[2]?.kind).toBe("starter");
    expect(after.lesson.slides[2]?.id).toBe(earlyId ?? "");
    // Every save from the early one on holds slide 3 under that one id, in third place.
    for (const p of after.deps.persisted) expect(p.lesson.slides[2]?.id).toBe(earlyId ?? "");
  });

  test("slide 3 is saved first, marked unverified, kept at planned, and is the slide Generate writes", async () => {
    const row = await confirmedRow();
    const { deps, lesson } = await factsThenGenerate(row, true);
    const [first, planned] = deps.persisted;
    const id = first?.lesson.slides[2]?.id;
    expect(first?.lesson.slides).toHaveLength(3);
    expect(first?.lesson.generation?.stage).toBe(row.generation?.stage);
    expect(
      first?.lesson.generation?.findings.filter(isUnverifiedMark).map((f) => f.target.slideId),
    ).toEqual([id]);
    expect(planned?.lesson.generation?.stage).toBe("planned");
    expect(planned?.lesson.slides[2]).toEqual(first?.lesson.slides[2]);
    expect(content(first?.lesson.slides[2])).toEqual(content(lesson.slides[2]));
    expect(lesson.generation?.findings.filter(isUnverifiedMark)).toEqual([]);
    // The progress event after the early save carries its `updatedAt`, so the editor refetches.
    expect(deps.progress[0]?.documentUpdatedAt).toBe(first?.updatedAt);
  });

  test("a facts step that fails after the early save withdraws it", async () => {
    const row = await confirmedRow();
    const deps = recordingDeps(
      labAi({
        retrieval: RETRIEVAL,
        teach: () => {
          throw new Error("provider down");
        },
      }),
    );
    await expect(runFactsStep({ lesson: row }, deps, {})).rejects.toThrow();
    expect(deps.persisted.map((p) => p.lesson.slides.length)).toEqual([3, 2]);
    expect(deps.persisted.at(-1)?.lesson).toEqual(row);
  });

  test("a facts step stopped after the early save withdraws it", async () => {
    const row = await confirmedRow();
    const deps = recordingDeps(labAi({ retrieval: RETRIEVAL }));
    const stopping = recordingDeps(
      labAi({
        retrieval: RETRIEVAL,
        teach: () => {
          deps.abort.abort(new DOMException("cancelled", "AbortError"));
          return json({});
        },
      }),
    );
    const run = runFactsStep({ lesson: row }, { ...stopping, signal: deps.abort.signal }, {});
    await expect(run).rejects.toThrow();
    expect(stopping.persisted.map((p) => p.lesson.slides.length)).toEqual([3, 2]);
    expect(stopping.persisted.at(-1)?.lesson).toEqual(row);
  });

  test("with prior knowledge declared the starter's slot waits for the facts: no early save", async () => {
    const row = await confirmedRow("Pupils know the Iron Age.");
    const { deps } = await factsThenGenerate(row, true);
    expect(deps.persisted[0]?.lesson.generation?.stage).toBe("planned");
    expect(deps.persisted[0]?.lesson.slides).toHaveLength(2);
  });

  test("pinned: fixed answers with a Verify correction and no early starter give this deck", async () => {
    // A withdrawn early starter leaves Generate exactly the no-preview run (`state.preview` unset).
    const verify = {
      corrections: [{ factId: "v1", field: "term", value: "Clan", reason: "wrong-term" }],
    };
    const row = await confirmedRow();
    const { lesson } = await factsThenGenerate(row, false, verify);
    expect(lesson.facts?.vocabulary[0]?.term).toBe("Clan");
    const hash = createHash("sha256").update(JSON.stringify(lesson)).digest("hex");
    expect(hash).toBe("254807bc8556d9f37531750280edbd12f6c57858f837afe5a3c0b225546d5c3d");
  });
});

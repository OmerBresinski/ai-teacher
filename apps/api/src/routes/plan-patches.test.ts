/**
 * The body changes behind `/plan` and `/generate` (ADR 0029 item 8, TDD §4.4), without a database.
 */
import { describe, expect, test } from "bun:test";
import { type JobId, newId } from "@tj/domain";
import { type Lesson, type LessonFacts, parseLesson } from "@tj/domain/documents";
import { generatedLesson, lessonFacts } from "@tj/domain/documents/fixtures";
import { confirmLesson, pinnedFacts, replanLesson } from "./plan-patches";

const planJobId = newId<JobId>();
const jobId = newId<JobId>();
const now = new Date("2026-09-17T12:00:00.000Z");

/** Facts whose vocabulary each serves one objective, so a removal has something to drop. */
const facts = (): LessonFacts => {
  const base = lessonFacts();
  return {
    ...base,
    vocabulary: base.vocabulary.map((v, i) => ({ ...v, objectiveRefs: [`o${i + 1}`] })),
  };
};

/** The lesson the plan job left at `planned`, revision `revision`, proposed. */
const planned = (revision = 1): Lesson & { facts: LessonFacts } => {
  const { artefacts: _artefacts, ...lesson } = generatedLesson();
  const generation = lesson.generation;
  if (!generation) throw new Error("fixture without generation");
  return {
    ...lesson,
    brief: { topic: "The water cycle", durationMin: 60, slideCount: 10 },
    facts: facts(),
    generation: { ...generation, stage: "planned" },
    plan: { revision, state: "proposed", jobId: planJobId },
  };
};

const sameObjectives = (lesson: Lesson) =>
  (lesson.facts?.objectives ?? []).map(({ id, text }) => ({ id, text }));

describe("pinnedFacts", () => {
  test("keeps the objectives and empties everything derived from them", () => {
    const pinned = pinnedFacts({ ...facts(), keyIdeas: [] });
    expect(pinned).toEqual({
      objectives: facts().objectives,
      keyIdeas: [],
      vocabulary: [],
      workedExamples: [],
      questions: [],
      misconceptions: [],
      outline: [],
      durationMin: 60,
    });
  });
});

describe("replanLesson (/plan)", () => {
  const input = (patch: Partial<Parameters<typeof replanLesson>[1]> = {}) => ({
    expectedRevision: 1,
    brief: { topic: "The water cycle" },
    ...patch,
  });

  test("a new topic is a fresh proposal: facts, checkpoint and slides cleared, title renamed", () => {
    const { lesson, pinned } = replanLesson(
      planned(),
      input({ brief: { topic: "  Volcanoes " } }),
      { jobId },
    );
    expect(pinned).toBe(false);
    expect(lesson.facts).toBeUndefined();
    expect(lesson.generation).toBeUndefined();
    expect(lesson.slides).toEqual([]);
    expect(lesson.title).toBe("Volcanoes");
    expect(lesson.brief).toEqual({ topic: "  Volcanoes ", durationMin: 60, slideCount: 10 });
    expect(lesson.plan).toEqual({ revision: 2, state: "proposed", jobId });
    expect(() => parseLesson(lesson)).not.toThrow();
  });

  test("a new Source list is a fresh proposal too, with the new list on the lesson", () => {
    const sources = [{ id: newId(), kind: "file" as const, name: "rocks.pdf", pages: 3 }];
    const { lesson, pinned } = replanLesson(planned(), input(), { jobId, sources });
    expect(pinned).toBe(false);
    expect(lesson.facts).toBeUndefined();
    expect(lesson.sources).toEqual(sources);
  });

  test("the same topic with a new level keeps the objectives pinned and clears the rest", () => {
    const before = planned();
    const { lesson, pinned } = replanLesson(
      before,
      input({ brief: { topic: "The water cycle", level: "harder", slideCount: 8 } }),
      { jobId },
    );
    expect(pinned).toBe(true);
    expect(lesson.facts).toEqual(pinnedFacts(before.facts));
    expect(lesson.generation).toBeUndefined();
    expect(lesson.title).toBe(before.title);
    expect(lesson.brief).toEqual({
      topic: "The water cycle",
      durationMin: 60,
      slideCount: 8,
      level: "harder",
    });
  });

  test("a new year group re-derives the age band; unsent fields keep their values", () => {
    const { lesson } = replanLesson(planned(), input({ yearGroup: "Year 9" }), { jobId });
    expect(lesson).toMatchObject({ yearGroup: "Year 9", ageBand: "ks3", subject: "Science" });
    expect(replanLesson(planned(), input(), { jobId }).lesson).toMatchObject({
      yearGroup: "Year 4",
      ageBand: "ks2",
    });
  });

  test("a proposal whose plan job wrote no objectives yet is replanned fresh", () => {
    const { facts: _facts, ...bare } = planned();
    expect(replanLesson(bare, input(), { jobId }).pinned).toBe(false);
  });

  test("a lesson without plan becomes revision 1", () => {
    const { plan: _plan, ...legacy } = planned();
    expect(replanLesson(legacy, input({ expectedRevision: 0 }), { jobId }).lesson.plan).toEqual({
      revision: 1,
      state: "proposed",
      jobId,
    });
  });
});

describe("confirmLesson (/generate)", () => {
  test("a text-only edit keeps the revision, the checkpoint and the slides", () => {
    const before = planned(2);
    const objectives = sameObjectives(before).map((o, i) =>
      i === 0 ? { ...o, text: "Name the stages of the water cycle" } : o,
    );
    const { lesson, replan } = confirmLesson(
      before,
      { expectedRevision: 2, objectives },
      { jobId, now },
    );
    expect(replan).toBe(false);
    expect(lesson.facts?.objectives[0]?.text).toBe("Name the stages of the water cycle");
    expect(lesson.facts?.outline).toEqual(before.facts.outline);
    expect(lesson.generation).toEqual(before.generation);
    expect(lesson.slides).toEqual(before.slides);
    expect(lesson.plan).toEqual({
      revision: 2,
      state: "confirmed",
      jobId,
      confirmedAt: now.toISOString(),
    });
  });

  test("the same slide count and duration sent back are not a shape change", () => {
    const before = planned();
    const { replan } = confirmLesson(
      before,
      { expectedRevision: 1, objectives: sameObjectives(before), slideCount: 10, durationMin: 60 },
      { jobId, now },
    );
    expect(replan).toBe(false);
  });

  test("a removed objective re-plans pinned: facts serving only it dropped, revision bumped", () => {
    const before = planned();
    const { lesson, replan } = confirmLesson(
      before,
      { expectedRevision: 1, objectives: sameObjectives(before).slice(0, 1) },
      { jobId, now },
    );
    expect(replan).toBe(true);
    expect(lesson.facts?.objectives.map((o) => o.id)).toEqual(["o1"]);
    expect(lesson.facts?.vocabulary.map((v) => v.id)).toEqual(["v1"]);
    expect(lesson.facts?.outline).toEqual([]);
    expect(lesson.generation).toBeUndefined();
    expect(lesson.slides).toEqual([]);
    expect(lesson.plan).toMatchObject({ revision: 2, state: "confirmed", jobId });
    expect(() => parseLesson(lesson)).not.toThrow();
  });

  test("an added objective takes the next id", () => {
    const before = planned();
    const { lesson, replan } = confirmLesson(
      before,
      {
        expectedRevision: 1,
        objectives: [...sameObjectives(before), { text: "Draw the water cycle" }],
      },
      { jobId, now },
    );
    expect(replan).toBe(true);
    expect(lesson.facts?.objectives.map((o) => o.id)).toEqual(["o1", "o2", "o3"]);
  });

  test("a new slide count re-plans pinned with the objectives kept and the lists emptied", () => {
    const before = planned();
    const { lesson, replan } = confirmLesson(
      before,
      { expectedRevision: 1, objectives: sameObjectives(before), slideCount: 6 },
      { jobId, now },
    );
    expect(replan).toBe(true);
    expect(lesson.brief).toEqual({ topic: "The water cycle", durationMin: 60, slideCount: 6 });
    expect(lesson.facts).toEqual(pinnedFacts(before.facts));
    expect(lesson.plan?.revision).toBe(2);
  });

  test("a new slide count with a new duration re-plans, and the facts carry the duration too", () => {
    const before = planned();
    const { lesson, replan } = confirmLesson(
      before,
      { expectedRevision: 1, objectives: sameObjectives(before), slideCount: 6, durationMin: 45 },
      { jobId, now },
    );
    expect(replan).toBe(true);
    expect(lesson.brief?.durationMin).toBe(45);
    expect(lesson.facts).toEqual({ ...pinnedFacts(before.facts), durationMin: 45 });
  });

  test("a new duration is stored but re-plans nothing (ruling 82: the size is the slide count)", () => {
    const before = planned();
    const { lesson, replan } = confirmLesson(
      before,
      { expectedRevision: 1, objectives: sameObjectives(before), durationMin: 45 },
      { jobId, now },
    );
    expect(replan).toBe(false);
    expect(lesson.brief?.durationMin).toBe(45);
    expect(lesson.plan?.revision).toBe(1);
    expect(lesson.facts?.outline).toEqual(before.facts.outline);
    expect(lesson.facts?.durationMin).toBe(45);
    expect(lesson.slides).toEqual(before.slides);
  });

  test("a lesson written before plans existed is confirmed as revision 1", () => {
    const { plan: _plan, ...legacy } = planned();
    const { lesson, replan } = confirmLesson(
      legacy,
      { expectedRevision: 0, objectives: sameObjectives(legacy) },
      { jobId, now },
    );
    expect(replan).toBe(false);
    expect(lesson.plan?.revision).toBe(1);
  });
});

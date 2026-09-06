import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createFakeAi, type FakeAi } from "@tj/ai/testing";
import { createDocument, forWorkspace, getDocument } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, JobResultSchema, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import type { Lesson, SlideElement } from "@tj/domain/documents";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
import { noSources, PROPOSE_CONCURRENCY } from "@tj/generation";
import { FIXTURES } from "@tj/generation/testing";
import { NonRetryableError } from "@tj/jobs";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { lessonCascadeJob } from "./lesson-cascade";
import { lessonRegenerateJob } from "./lesson-regenerate";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping proposal job tests: ${t.reason}`);

const json = (v: unknown) => JSON.stringify(v);
const mcSpec = FIXTURES.slides["multiple-choice"];
const blockSpec = {
  type: "multiple-choice",
  text: "Which process turns vapour back into liquid water?",
  options: [
    { text: "Evaporation", correct: false },
    { text: "Condensation", correct: true },
    { text: "Freezing", correct: false },
    { text: "Melting", correct: false },
  ],
  factRefs: ["o2", "v2"],
};

describeDb("lesson.cascade / lesson.regenerate jobs", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const deps = (ai: FakeAi, caps = { capUsd: 5, capTokens: 1_000_000 }): WorkerDeps => ({
    ai,
    db: unsafeDb,
    caps,
    sources: noSources,
  });

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  });

  /** The generated fixture pair as two rows, linked both ways; `mc` is the multiple-choice slide. */
  async function seed(mutate: (lesson: Lesson) => void = () => {}) {
    const ws = forWorkspace(unsafeDb, workspaceId);
    const lesson = generatedLesson();
    const worksheetRow = await createDocument(ws, "worksheet", generatedWorksheet());
    lesson.artefacts = { worksheetId: worksheetRow.id };
    mutate(lesson);
    const lessonRow = await createDocument(ws, "lesson", lesson);
    return { ws, lessonRow, worksheetRow, lessonId: lessonRow.id as LessonId };
  }

  function ctx<P>(
    payload: P,
    ai: FakeAi,
    options: { ac?: AbortController; caps?: WorkerDeps["caps"] } = {},
  ) {
    const ac = options.ac ?? new AbortController();
    const progress: Array<[number | undefined, string | undefined]> = [];
    return {
      progress,
      ctx: {
        jobId: newId<JobId>(),
        workspaceId,
        payload,
        signal: ac.signal,
        progress: async (percent?: number, message?: string) => {
          progress.push([percent, message]);
        },
        logger: pino({ level: "silent" }),
        deps: deps(ai, options.caps),
      },
    };
  }

  test("cascade: proposals for every AI element and block naming the fact; teacher element flagged; row untouched", async () => {
    // Make ob-2 (an o2 element) the teacher's so it is flagged; q on s-mc names o1, so use o2 → wb3 and ob-2 only.
    const { ws, lessonRow, lessonId } = await seed((lesson) => {
      const objectives = lesson.slides.find((s) => s.id === "s-objectives");
      const ob2 = objectives?.elements.find((e) => e.id === "ob-2") as SlideElement;
      ob2.authoredBy = "teacher";
      // Give the multiple-choice slide's stem a reference to o2 so a slide element is redone too.
      const mc = lesson.slides.find((s) => s.id === "s-mc");
      const q = mc?.elements.find((e) => e.id === "q") as SlideElement;
      q.generatedFrom = {
        ...(q.generatedFrom as NonNullable<SlideElement["generatedFrom"]>),
        factRefs: ["q1", "o2"],
      };
    });
    const ai = createFakeAi({
      script: [json(mcSpec), json(blockSpec)],
      usage: { inputTokens: 500, outputTokens: 200 },
    });
    const h = ctx({ lessonId, changedFactIds: ["o2"] }, ai);
    const result = await lessonCascadeJob(h.ctx as never);
    expect(result).toBeDefined();
    if (!result) return;
    expect(JobResultSchema.safeParse(result).success).toBe(true);
    expect(result.job).toBe("lesson.cascade");
    expect(result.proposals.map((p) => p.target)).toEqual([
      { slideId: "s-mc", elementId: "q" },
      { blockId: "wb3" },
    ]);
    expect(result.flagged).toEqual([
      { slideId: "s-objectives", elementId: "ob-2", reason: "teacher" },
    ]);
    expect(result.proposals.every((p) => p.generatedFrom.promptVersion === "cascade.v1")).toBe(
      true,
    );
    expect(ai.calls).toHaveLength(2);
    expect(h.progress).toEqual([[10, "Working out what changes"]]);
    // Nothing written: same updated_at, same body.
    const after = await getDocument(ws, lessonId);
    expect(after?.updatedAt.getTime()).toBe(lessonRow.updatedAt.getTime());
    expect(after?.body).toEqual(lessonRow.body);
  });

  test("regenerate: an element target keeps the original box; a slide target returns the whole slide", async () => {
    const { lessonId, lessonRow } = await seed();
    const mc = (lessonRow.body as Lesson).slides.find((s) => s.id === "s-mc");
    const q = mc?.elements.find((e) => e.id === "q") as SlideElement;
    const ai = createFakeAi({
      script: [json(mcSpec), json(mcSpec)],
      usage: { inputTokens: 500, outputTokens: 200 },
    });
    const one = await lessonRegenerateJob(
      ctx(
        { lessonId, targets: [{ slideId: "s-mc", elementId: "q" }], instruction: "simpler words" },
        ai,
      ).ctx as never,
    );
    expect(one?.proposals).toHaveLength(1);
    expect(one?.proposals[0]?.element).toMatchObject({
      x: q.x,
      y: q.y,
      w: q.w,
      h: q.h,
      authoredBy: "ai",
    });
    expect(one?.proposals[0]?.generatedFrom.promptVersion).toBe("regenerate.v1");
    expect(ai.calls).toHaveLength(1);

    const whole = await lessonRegenerateJob(
      ctx({ lessonId, targets: [{ slideId: "s-mc" }] }, ai).ctx as never,
    );
    expect(whole?.proposals.length).toBeGreaterThan(1);
    expect(whole?.proposals.every((p) => p.target.slideId === "s-mc" && !p.target.elementId)).toBe(
      true,
    );
    expect(whole?.flagged).toEqual([]);
  });

  test("a missing lesson, a non-lesson row and a lesson without facts are NonRetryableError", async () => {
    const ai = createFakeAi();
    await expect(
      lessonCascadeJob(
        ctx({ lessonId: newId<LessonId>(), changedFactIds: ["o1"] }, ai).ctx as never,
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
    const ws = forWorkspace(unsafeDb, workspaceId);
    const sheet = await createDocument(ws, "worksheet", generatedWorksheet());
    await expect(
      lessonCascadeJob(
        ctx({ lessonId: sheet.id as LessonId, changedFactIds: ["o1"] }, ai).ctx as never,
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
    const { facts: _f, ...noFacts } = generatedLesson();
    const plain = await createDocument(ws, "lesson", noFacts);
    await expect(
      lessonCascadeJob(
        ctx({ lessonId: plain.id as LessonId, changedFactIds: ["o1"] }, ai).ctx as never,
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(ai.calls).toHaveLength(0);
  });

  test("a missing worksheet row is tolerated: slide proposals only", async () => {
    const ws = forWorkspace(unsafeDb, workspaceId);
    const lesson = generatedLesson();
    lesson.artefacts = { worksheetId: newId() };
    const row = await createDocument(ws, "lesson", lesson);
    const ai = createFakeAi({ script: [json(mcSpec)] });
    const result = await lessonCascadeJob(
      ctx({ lessonId: row.id as LessonId, changedFactIds: ["q1"] }, ai).ctx as never,
    );
    expect(result?.proposals.every((p) => p.element)).toBe(true);
  });

  test("an unconfigured AI is NonRetryableError before any call", async () => {
    const { lessonId } = await seed();
    const { createAi } = await import("@tj/ai");
    const h = ctx({ lessonId, changedFactIds: ["o2"] }, createAi({}) as FakeAi);
    await expect(lessonCascadeJob(h.ctx as never)).rejects.toBeInstanceOf(NonRetryableError);
  });

  test("a cancel returns undefined so runJob records cancelled", async () => {
    const { lessonId } = await seed();
    const ac = new AbortController();
    ac.abort("cancelled");
    const ai = createFakeAi({ script: [json(mcSpec)] });
    const result = await lessonCascadeJob(
      ctx({ lessonId, changedFactIds: ["q1"] }, ai, { ac }).ctx as never,
    );
    expect(result).toBeUndefined();
    expect(ai.calls).toHaveLength(0);
  });

  test("a tiny budget returns the proposals done so far without throwing", async () => {
    const { lessonId } = await seed((lesson) => {
      // Every slide element names o1 so the impact set is large.
      for (const slide of lesson.slides)
        for (const e of slide.elements)
          e.generatedFrom = {
            ...(e.generatedFrom as NonNullable<SlideElement["generatedFrom"]>),
            factRefs: ["o1"],
          };
    });
    const ai = createFakeAi({
      script: Array.from({ length: 8 }, () => json(mcSpec)),
      usage: { inputTokens: 1000, outputTokens: 400 },
    });
    const result = await lessonCascadeJob(
      ctx({ lessonId, changedFactIds: ["o1"] }, ai, {
        caps: { capUsd: 0.015, capTokens: 1_000_000 },
      }).ctx as never,
    );
    expect(result).toBeDefined();
    // Up to `PROPOSE_CONCURRENCY` calls are in flight before the first charge lands, plus one
    // that passed the check just before; the rest are refused.
    expect(ai.calls.length).toBeLessThanOrEqual(PROPOSE_CONCURRENCY + 1);
    expect(ai.calls.length).toBeLessThan(8);
    expect(result?.proposals.length).toBeGreaterThan(0);
  });
});

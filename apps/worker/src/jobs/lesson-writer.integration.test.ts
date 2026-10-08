/**
 * Integration (TEACH-110 part b, rows 8 and 9): `AI_LESSON_PLANNER=writer` through the two lesson
 * jobs against Postgres, with a fake answering by prompt version. The plan job stops at `planned`
 * stamped for the writer; the generate job runs the writer (a saved writer answer) to a finished
 * deck; the writer call goes to `gpt-6.1-sol` at low effort through the worker's route; a flip of
 * the flag back does not move a writer lesson off the writer. K3: an incomplete writer answer
 * fails the job (pg-boss records it on the last attempt), saves no deck but keeps the call's cost,
 * and the retry resumes at the writer; a `length` finish is not retried. Skips visibly without a
 * database.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { FakeCall, FakeReply } from "@tj/ai/testing";
import { createDocument, forWorkspace, getDocument, setPlanRevisionAndLock } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import {
  type JobId,
  type LessonId,
  type LessonPlanPayload,
  newId,
  type WorkspaceId,
} from "@tj/domain";
import { type Lesson, parseLesson } from "@tj/domain/documents";
import {
  type Planner,
  plannerOf,
  WRITER_PLANNED_VERSION,
  WRITER_VERSION,
  writerRoute,
} from "@tj/generation";
import { labAi, romansLesson, writerFixture } from "@tj/generation/testing";
import { NonRetryableError } from "@tj/jobs";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { memoryStorage } from "../testing/memory-storage";
import { lessonGenerateJob } from "./lesson-generate";
import { lessonPlanJob } from "./lesson-plan";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping writer planner job tests: ${t.reason}`);

describeDb("writer planner through the lesson jobs (TEACH-110 part b)", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const ws = () => forWorkspace(unsafeDb, workspaceId);
  const quiet = pino({ level: "silent" });
  const fixture = writerFixture();
  /** The writer stage's calls by prompt version: the saved writer answer, its notes, pupil lines. */
  const writerAnswers = (call: FakeCall): string | undefined => {
    const v = call.context?.promptVersion ?? "";
    if (!v.startsWith(`${WRITER_VERSION}/`)) return undefined;
    if (v.endsWith("/lesson")) return fixture.main;
    if (v.endsWith("/notes")) return fixture.notes;
    if (v.endsWith("/pupil_objectives"))
      return JSON.stringify({
        pupil: ["I can say who invaded", "I can explain why", "I can judge it"],
      });
    return "{}";
  };
  const ai = (lesson?: FakeReply) =>
    labAi({
      extra: (call) =>
        lesson && call.context?.promptVersion === `${WRITER_VERSION}/lesson`
          ? lesson
          : writerAnswers(call),
      route: writerRoute,
    });
  const depsWith = (a: WorkerDeps["ai"], planner?: Planner): WorkerDeps => ({
    ai: a,
    db: unsafeDb,
    caps: { capUsd: 5, capTokens: 5_000_000 },
    worksheetCapUsd: 0.1,
    storage: memoryStorage(),
    ...(planner ? { planner } : {}),
  });

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  });

  const ctxFor = <P>(jobId: JobId, payload: P, deps: WorkerDeps) => ({
    jobId,
    workspaceId,
    payload,
    signal: new AbortController().signal,
    progress: async () => {},
    logger: quiet,
    deps,
  });

  async function newLesson(): Promise<{ lessonId: LessonId; jobId: JobId }> {
    const jobId = newId<JobId>();
    const lessonId = newId<LessonId>();
    const lesson = {
      ...romansLesson(),
      id: lessonId,
      plan: { revision: 1, state: "proposed", jobId },
    } as Lesson;
    await createDocument(ws(), "lesson", lesson, { id: lessonId, generatingJobId: jobId });
    return { lessonId, jobId };
  }
  const row = async (lessonId: LessonId) => {
    const stored = await getDocument(ws(), lessonId);
    return { lock: stored?.generatingJobId ?? null, lesson: parseLesson(stored?.body) };
  };
  async function confirm(lessonId: LessonId) {
    const jobId = newId<JobId>();
    const result = await setPlanRevisionAndLock(ws(), lessonId, {
      expectedRevision: 1,
      jobId,
      patch: (lesson) => ({
        ...lesson,
        plan: { revision: 1, state: "confirmed", jobId, confirmedAt: new Date().toISOString() },
      }),
    });
    expect(result.status).toBe("ok");
    return jobId;
  }

  async function planOnly() {
    const { lessonId, jobId } = await newLesson();
    await lessonPlanJob(
      ctxFor<LessonPlanPayload>(
        jobId,
        { lessonId, revision: 1, stopAfter: "planned" },
        depsWith(ai(), "writer"),
      ) as never,
    );
    return { lessonId, planned: await row(lessonId) };
  }

  async function planAndGenerate(generatePlanner: Planner | undefined) {
    const { lessonId, jobId } = await newLesson();
    const planAi = ai();
    await lessonPlanJob(
      ctxFor<LessonPlanPayload>(
        jobId,
        { lessonId, revision: 1, stopAfter: "planned" },
        depsWith(planAi, "writer"),
      ) as never,
    );
    const planned = await row(lessonId);
    const genAi = ai();
    const genJob = await confirm(lessonId);
    await lessonGenerateJob(
      ctxFor(genJob, { lessonId, revision: 1 }, depsWith(genAi, generatePlanner)) as never,
    );
    return { planned, planAi, genAi, done: await row(lessonId) };
  }

  test("plan stops at `planned` with the writer stamp; generate writes the deck on Sol, low", async () => {
    const { planned, planAi, genAi, done } = await planAndGenerate("writer");
    expect(planned.lock).toBeNull();
    expect(planned.lesson.generation?.stage).toBe("planned");
    expect(planned.lesson.generation?.promptVersions.planned).toBe(WRITER_PLANNED_VERSION);
    expect(plannerOf(planned.lesson)).toBe("writer");
    expect(planAi.calls.some((c) => c.context?.promptVersion?.startsWith(WRITER_VERSION))).toBe(
      false,
    );

    const writer = genAi.calls.filter(
      (c) => c.context?.promptVersion === `${WRITER_VERSION}/lesson`,
    );
    expect(writer).toHaveLength(1);
    expect(writer[0]?.modelId).toBe("openai/gpt-6.1-sol");
    expect(writer[0]?.context?.effort).toBe("low");
    const small = genAi.calls.filter(
      (c) => c.context?.promptVersion?.startsWith(`${WRITER_VERSION}/`) && c !== writer[0],
    );
    expect(small.length).toBeGreaterThan(0);
    for (const c of small) expect(c.modelId).toBe("openai/gpt-6-luna");
    // No objectives-first step ran in the generate job.
    expect(genAi.calls.some((c) => c.context?.promptVersion?.startsWith("plan-"))).toBe(false);

    expect(done.lock).toBeNull();
    expect(done.lesson.generation?.stage).toBe("generated");
    expect(done.lesson.slides.length).toBe(12);
    expect(done.lesson.slides.slice(0, 2).map((s) => s.kind)).toEqual(["title", "objectives"]);
  });

  test("flipping the flag back: a writer-stamped lesson still generates on the writer route", async () => {
    const { genAi, done } = await planAndGenerate("objectives-first");
    expect(genAi.calls.filter((c) => c.modelId === "openai/gpt-6.1-sol")).toHaveLength(1);
    expect(done.lesson.generation?.stage).toBe("generated");
    expect(plannerOf(done.lesson)).toBe("writer");
  });

  test("K3: an incomplete answer fails the job, saves no deck, and the retry resumes at the writer", async () => {
    const { lessonId, planned } = await planOnly();
    const genJob = await confirm(lessonId);
    const cut = ai({ text: fixture.main.slice(0, 400) });
    const err = await lessonGenerateJob(
      ctxFor(genJob, { lessonId, revision: 1 }, depsWith(cut, "writer")) as never,
    ).catch((e: unknown) => e);
    // Thrown, not swallowed: pg-boss retries it, and on the last attempt records the job failed.
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
    expect(String((err as Error).message)).toContain("writer output incomplete");
    const after = await row(lessonId);
    expect(after.lock).toBe(genJob);
    // The job re-materialises the objectives slide (fresh ids); no writer slide was saved.
    expect(after.lesson.slides.map((x) => x.kind)).toEqual(
      planned.lesson.slides.map((x) => x.kind),
    );
    expect(after.lesson.generation?.stage).toBe("planned");
    expect(after.lesson.generation?.usage?.calls).toBeGreaterThan(0);

    // The retry (same job): no objectives call, straight to the writer, and the cost carries on.
    const retry = ai();
    await lessonGenerateJob(
      ctxFor(genJob, { lessonId, revision: 1 }, depsWith(retry, "writer")) as never,
    );
    const versions = retry.calls.map((c) => c.context?.promptVersion ?? "");
    expect(versions.some((v) => v.startsWith("plan-objectives"))).toBe(false);
    expect(versions.filter((v) => v === `${WRITER_VERSION}/lesson`)).toHaveLength(1);
    const done = await row(lessonId);
    expect(done.lesson.generation?.stage).toBe("generated");
    expect(done.lock).toBeNull();
    expect(done.lesson.generation?.usage?.calls).toBeGreaterThan(
      after.lesson.generation?.usage?.calls ?? 0,
    );
  });

  test("K3: a length finish fails without a retry and releases the lock", async () => {
    const { lessonId, planned } = await planOnly();
    const genJob = await confirm(lessonId);
    const err = await lessonGenerateJob(
      ctxFor(
        genJob,
        { lessonId, revision: 1 },
        depsWith(ai({ text: fixture.main, finishReason: "length" }), "writer"),
      ) as never,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    const after = await row(lessonId);
    expect(after.lock).toBeNull();
    // The job re-materialises the objectives slide (fresh ids); no writer slide was saved.
    expect(after.lesson.slides.map((x) => x.kind)).toEqual(
      planned.lesson.slides.map((x) => x.kind),
    );
  });
});

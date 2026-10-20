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
    // The writer planner's objectives call (TEACH-110 part f): the lab's schema, a list of strings.
    if (v.endsWith("/objectives"))
      return JSON.stringify({
        objectives: [
          "Describe who invaded Britain in AD 43.",
          "Explain why the Romans invaded Britain.",
          "Evaluate how far the invasion changed Britain.",
        ],
      });
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

  const ctxFor = <P>(
    jobId: JobId,
    payload: P,
    deps: WorkerDeps,
    extra: { attemptsLeft?: boolean; signal?: AbortSignal } = {},
  ) => ({
    jobId,
    workspaceId,
    payload,
    signal: extra.signal ?? new AbortController().signal,
    progress: async () => {},
    logger: quiet,
    deps,
    ...(extra.attemptsLeft !== undefined ? { attemptsLeft: extra.attemptsLeft } : {}),
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
    // The plan job's one model call is the writer's objectives call, on Sol, low (part f).
    const planCalls = planAi.calls.filter((c) =>
      c.context?.promptVersion?.startsWith(WRITER_VERSION),
    );
    expect(planCalls.map((c) => c.context?.promptVersion)).toEqual([
      `${WRITER_VERSION}/objectives`,
    ]);
    expect(planCalls[0]?.modelId).toBe("openai/gpt-6.1-sol");
    expect(planCalls[0]?.context?.effort).toBe("low");
    expect(planAi.calls.some((c) => c.context?.promptVersion?.startsWith("plan-objectives"))).toBe(
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
    // 12 written slides, then the guard and three Answers pages (TEACH-191 parts b and d): measured
    // at the size KS2 draws them, the sentence answers no longer fit two pages without overlapping.
    expect(done.lesson.slides.length).toBe(16);
    expect(done.lesson.slides.slice(12).map((s) => s.answersRole)).toEqual([
      "guard",
      "answers",
      "answers",
      "answers",
    ]);
    expect(done.lesson.slides.slice(0, 2).map((s) => s.kind)).toEqual(["title", "objectives"]);
  });

  test("C2: slides are saved read-only while the writer streams, before it ends", async () => {
    // TEACH-110 part h: the writer's answer arrives in paced pieces (a model writing over time).
    // The deck is saved at most once a second, so the stream must outlast the first slide plus a
    // second's wait plus a save: 55 pieces 60 ms apart is about 3.2 s, the first slide closing at
    // about 0.8 s. The stream's end is read off the fake when its last piece goes out, never
    // worked out from the pace: under CI load the timers run late and a computed end comes early.
    const PIECE = 150;
    const PACE = 60;
    let writerEnd = Number.POSITIVE_INFINITY;
    const paced = labAi({
      extra: (call) => {
        if (call.context?.promptVersion === `${WRITER_VERSION}/lesson`) {
          const onEnd = () => {
            writerEnd = performance.now();
          };
          return { text: fixture.main, stream: { pieceChars: PIECE, paceMs: PACE, onEnd } };
        }
        return writerAnswers(call);
      },
      route: writerRoute,
    });
    const { lessonId } = await planOnly();
    const genJob = await confirm(lessonId);
    const seen: { at: number; message: string; kinds: string[]; states: string[] }[] = [];
    await lessonGenerateJob({
      ...ctxFor(genJob, { lessonId, revision: 1 }, depsWith(paced, "writer")),
      progress: async (_percent: number, message: string) => {
        if (message !== "Writing slides" && message !== "Slides written") return;
        // The save has landed when its progress is sent: stamp it before this test's own read.
        const at = performance.now();
        const r = await row(lessonId);
        seen.push({
          at,
          message,
          kinds: r.lesson.slides.map((x) => x.kind),
          states: Object.values(r.lesson.generation?.slideStates ?? {}),
        });
      },
    } as never);
    const first = seen[0];
    expect(first?.message).toBe("Writing slides");
    // the first save lands while the writer is still streaming
    expect(first?.at ?? Number.POSITIVE_INFINITY).toBeLessThan(writerEnd);
    // read-only: the streamed slides are `writing`; the plan's title and objectives stand
    expect(first?.states).toContain("writing");
    expect(first?.kinds.slice(0, 2)).toEqual(["title", "objectives"]);
    // a part of the deck (at most one save a second), then the editable deck with every slide done
    const editable = seen.find((x) => x.message === "Slides written");
    const streamed = seen.filter((x) => x.message === "Writing slides" && x.at < writerEnd);
    const most = Math.max(...streamed.map((x) => x.kinds.length));
    expect(most).toBeGreaterThan(2);
    expect(most).toBeLessThan(editable?.kinds.length ?? 0);
    expect(editable?.states.every((x) => x === "done")).toBe(true);
    const done = await row(lessonId);
    expect(done.lesson.generation?.stage).toBe("generated");
    expect(done.lesson.slides.filter((s) => !s.answersRole).length).toBe(12);
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
    expect(after.lesson.generation?.slideStates).toBeUndefined();
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
    // UX-A: the slides the writer closed before the cut are kept, after the plan's own slides, so
    // the teacher keeps them in the editor; only whole, schema-valid slides survive.
    const kinds = after.lesson.slides.map((x) => x.kind);
    expect(kinds.slice(0, planned.lesson.slides.length)).toEqual(
      planned.lesson.slides.map((x) => x.kind),
    );
    expect(kinds.length).toBeGreaterThan(planned.lesson.slides.length);
    expect(new Set(after.lesson.slides.map((x) => x.id)).size).toBe(kinds.length);
  });

  // TEACH-202 part g (the part f bug): a lesson hung for good when the writer's retry was refused
  // on budget. The refusal came wrapped in the stream's error, was taken for a retryable one, and
  // the last attempt kept the lock "for the retry" that pg-boss never ran.
  describe("the generating lock is released on every terminal exit (TEACH-202 part g)", () => {
    /** A budget no call fits, so the first model call of the run is refused by the middleware. */
    const broke = (a: WorkerDeps["ai"]): WorkerDeps => ({
      ...depsWith(a, "writer"),
      caps: { capUsd: 0.000_001, capTokens: 5_000_000 },
    });
    const generate = (genJob: JobId, lessonId: LessonId, deps: WorkerDeps, extra = {}) =>
      lessonGenerateJob(ctxFor(genJob, { lessonId, revision: 1 }, deps, extra) as never).catch(
        (e: unknown) => e,
      );

    test("a retry refused on budget fails for good and releases the lock (the Y10 eye hang)", async () => {
      const { lessonId } = await planOnly();
      const genJob = await confirm(lessonId);
      // Attempt 0: an unknown failure mid-stage, with attempts left: the lock is kept for the retry.
      const first = await generate(
        genJob,
        lessonId,
        depsWith(ai({ text: fixture.main.slice(0, 400) }), "writer"),
        {
          attemptsLeft: true,
        },
      );
      expect(first).not.toBeInstanceOf(NonRetryableError);
      expect((await row(lessonId)).lock).toBe(genJob);
      // Attempt 1 (resumed): the writer's streamed call is refused by the budget.
      const refusedAi = ai();
      const second = await generate(genJob, lessonId, broke(refusedAi), { attemptsLeft: true });
      expect(second).toBeInstanceOf(NonRetryableError);
      expect((await row(lessonId)).lock).toBeNull();
    });

    test("a budget refusal on attempt 0 is not retried and releases the lock", async () => {
      const { lessonId } = await planOnly();
      const genJob = await confirm(lessonId);
      const err = await generate(genJob, lessonId, broke(ai()), { attemptsLeft: true });
      expect(err).toBeInstanceOf(NonRetryableError);
      expect((await row(lessonId)).lock).toBeNull();
    });

    test("an error thrown mid-stage on the last attempt releases the lock; no calls after it", async () => {
      const { lessonId } = await planOnly();
      const genJob = await confirm(lessonId);
      const cut = ai({ text: fixture.main.slice(0, 400) });
      const err = await generate(genJob, lessonId, depsWith(cut, "writer"), {
        attemptsLeft: false,
      });
      expect(err).toBeInstanceOf(Error);
      expect((await row(lessonId)).lock).toBeNull();
      const calls = cut.calls.length;
      await new Promise((r) => setTimeout(r, 150));
      expect(cut.calls.length).toBe(calls);
    });

    test("a shutdown on the last attempt releases the lock; with attempts left it keeps it", async () => {
      for (const attemptsLeft of [false, true]) {
        const { lessonId } = await planOnly();
        const genJob = await confirm(lessonId);
        const stop = new AbortController();
        stop.abort("shutdown");
        await generate(genJob, lessonId, depsWith(ai(), "writer"), {
          attemptsLeft,
          signal: stop.signal,
        });
        expect((await row(lessonId)).lock).toBe(attemptsLeft ? genJob : null);
      }
    });

    test("a cancel mid-stream releases the lock", async () => {
      const { lessonId } = await planOnly();
      const genJob = await confirm(lessonId);
      const stop = new AbortController();
      const paced = labAi({
        extra: (call) => {
          if (call.context?.promptVersion === `${WRITER_VERSION}/lesson`) {
            setTimeout(() => stop.abort("cancelled"), 60);
            return { text: fixture.main, stream: { pieceChars: 100, paceMs: 30 } };
          }
          return writerAnswers(call);
        },
        route: writerRoute,
      });
      await generate(genJob, lessonId, depsWith(paced, "writer"), { signal: stop.signal });
      const after = await row(lessonId);
      expect(after.lock).toBeNull();
      expect(after.lesson.generation?.stage).not.toBe("generated");
    });

    test("after a terminal failure a second job for the same lesson starts and finishes", async () => {
      const { lessonId } = await planOnly();
      const genJob = await confirm(lessonId);
      await generate(genJob, lessonId, broke(ai()), { attemptsLeft: true });
      expect((await row(lessonId)).lock).toBeNull();
      const next = await setPlanRevisionAndLock(ws(), lessonId, {
        expectedRevision: 1,
        jobId: newId<JobId>(),
        patch: (lesson) => lesson,
      });
      expect(next.status).toBe("ok");
      const nextJob = (await row(lessonId)).lock as JobId;
      expect(nextJob).not.toBe(genJob);
      await lessonGenerateJob(
        ctxFor(nextJob, { lessonId, revision: 1 }, depsWith(ai(), "writer")) as never,
      );
      const done = await row(lessonId);
      expect(done.lock).toBeNull();
      expect(done.lesson.generation?.stage).toBe("generated");
    });
  });
});

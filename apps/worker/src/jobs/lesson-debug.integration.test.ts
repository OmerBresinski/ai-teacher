/**
 * Integration (Greg, 20 Oct 2026): the per-lesson debug record through the writer planner's two
 * lesson jobs against Postgres, with the saved writer answer replayed by a fake. Recording never
 * changes the deck; a failing or hanging debug store never fails or delays the job; a failed job
 * leaves its full error (message and stack) in `generation_debug`, never in its job event. Skips
 * visibly without a database.
 */
import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FakeReply } from "@tj/ai/testing";
import {
  createDocument,
  forWorkspace,
  getDocument,
  insertGenerationDebug,
  listGenerationDebug,
  setPlanRevisionAndLock,
} from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import {
  type JobId,
  type LessonId,
  type LessonPlanPayload,
  newId,
  type WorkspaceId,
} from "@tj/domain";
import { type Lesson, parseLesson } from "@tj/domain/documents";
import { WRITER_VERSION, writerRoute } from "@tj/generation";
import { labAi, romansLesson, writerFixture } from "@tj/generation/testing";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import type { DebugStore } from "../generation-debug";
import { memoryStorage } from "../testing/memory-storage";
import { lessonGenerateJob } from "./lesson-generate";
import { lessonPlanJob } from "./lesson-plan";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping lesson debug integration tests: ${t.reason}`);

/** A lesson's slides without the ids and stamps minted per run (`uid()`, clocks). */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !/(^id$|Id$|^ids$|At$|^at$|^src$|^key$)/.test(k))
        .map(([k, v]) => [k, shape(v)]),
    );
  return value;
}

describeDb("the lesson debug record (generation_debug)", () => {
  setDefaultTimeout(60_000);
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const ws = () => forWorkspace(unsafeDb, workspaceId);
  const fixture = writerFixture();
  const warnings: string[] = [];
  const watching = pino(
    { level: "warn" },
    { write: (line: string) => warnings.push(JSON.parse(line).msg) },
  );

  const ai = (lesson?: FakeReply) =>
    labAi({
      extra: (call) => {
        const v = call.context?.promptVersion ?? "";
        if (!v.startsWith(`${WRITER_VERSION}/`)) return undefined;
        if (v.endsWith("/lesson")) return lesson ?? fixture.main;
        if (v.endsWith("/notes")) return fixture.notes;
        if (v.endsWith("/objectives"))
          return JSON.stringify({ objectives: ["Describe AD 43.", "Explain why.", "Judge it."] });
        if (v.endsWith("/pupil_objectives"))
          return JSON.stringify({ pupil: ["I can say", "I can explain", "I can judge"] });
        return "{}";
      },
      route: writerRoute,
    });
  const realStore: DebugStore = (wsId, rows) => insertGenerationDebug(unsafeDb, wsId, rows);
  const depsWith = (a: WorkerDeps["ai"], store?: DebugStore): WorkerDeps => ({
    ai: a,
    db: unsafeDb,
    caps: { capUsd: 5, capTokens: 5_000_000 },
    worksheetCapUsd: 0.1,
    storage: memoryStorage(),
    planner: "writer",
    ...(store ? { generationDebug: store } : {}),
  });

  const reset = async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  };
  beforeEach(async () => {
    warnings.length = 0;
    await reset();
  });
  /**
   * The ids a run uses. The deck's seeded orders (answer options) hash the ids, so two runs compared
   * slide for slide use the same ids, each on a fresh database.
   */
  type Ids = { lessonId: LessonId; plan: JobId; generate: JobId };
  const freshIds = (): Ids => ({
    lessonId: newId<LessonId>(),
    plan: newId<JobId>(),
    generate: newId<JobId>(),
  });

  /** A job context; `settled` collects the after-settle hooks, as `runJob` would run them. */
  const ctxFor = <P>(
    jobId: JobId,
    payload: P,
    deps: WorkerDeps,
    settled?: (() => Promise<void>)[],
  ) => ({
    jobId,
    workspaceId,
    payload,
    signal: new AbortController().signal,
    progress: async () => {},
    logger: watching,
    deps,
    attempt: 0,
    ...(settled ? { afterSettle: (hook: () => Promise<void>) => settled.push(hook) } : {}),
  });

  async function planned(store?: DebugStore, ids: Ids = freshIds()): Promise<LessonId> {
    const { lessonId, plan: jobId } = ids;
    const lesson = {
      ...romansLesson(),
      id: lessonId,
      plan: { revision: 1, state: "proposed", jobId },
    };
    await createDocument(ws(), "lesson", lesson as Lesson, {
      id: lessonId,
      generatingJobId: jobId,
    });
    await lessonPlanJob(
      ctxFor<LessonPlanPayload>(
        jobId,
        { lessonId, revision: 1, stopAfter: "planned" },
        depsWith(ai(), store),
      ) as never,
    );
    return lessonId;
  }
  async function confirm(lessonId: LessonId, jobId: JobId = newId<JobId>()) {
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
  async function generate(
    store?: DebugStore,
    settled?: (() => Promise<void>)[],
    ids: Ids = freshIds(),
  ) {
    const lessonId = await planned(store, ids);
    const job = await confirm(lessonId, ids.generate);
    const genAi = ai();
    await lessonGenerateJob(
      ctxFor(job, { lessonId, revision: 1 }, depsWith(genAi, store), settled) as never,
    );
    const stored = await getDocument(ws(), lessonId);
    return { lessonId, lesson: parseLesson(stored?.body), calls: genAi.calls.length };
  }

  test("the same deck with debug on and off; the record holds the writer's raw output", async () => {
    const ids = freshIds();
    const off = await generate(undefined, undefined, ids);
    const offRows = await listGenerationDebug(unsafeDb, workspaceId, off.lessonId);
    await reset();
    const on = await generate(realStore, undefined, ids);
    expect(on.lesson.generation?.stage).toBe(off.lesson.generation?.stage);
    expect(on.lesson.slides.length).toBeGreaterThan(2);
    expect(shape(on.lesson.slides)).toEqual(shape(off.lesson.slides));
    expect(offRows).toEqual([]);

    const rows = await listGenerationDebug(unsafeDb, workspaceId, on.lessonId);
    const kinds = new Set(rows.map((r) => r.kind));
    for (const k of ["plan", "model-call", "writer-output", "check", "event", "fact-check"])
      expect(kinds).toContain(k);
    const output = rows.find((r) => r.kind === "writer-output")?.payload as { text?: string };
    expect(output.text).toBe(fixture.main);
    // One model-call row per model request of the generate job, each with its full exchange.
    const generateJob = rows.at(-1)?.jobId;
    const calls = rows.filter((r) => r.kind === "model-call" && r.jobId === generateJob);
    expect(calls.length).toBe(on.calls);
    type Call = Record<string, unknown> & {
      context: { promptVersion?: string };
      request: { system: string[] };
      response: { text: string };
    };
    const writer = calls
      .map((r) => r.payload as Call)
      .find((p) => p.context.promptVersion === `${WRITER_VERSION}/lesson`) as Call;
    expect(writer.response.text).toBe(fixture.main);
    expect(writer.request.system[0]?.length).toBeGreaterThan(1000);
    expect(writer.truncated).toBeUndefined();
    expect(writer).toMatchObject({ ok: true, mode: "stream" });
    // DEBUG_PAYLOAD_MAX_BYTES is sized from this row: printed for the record.
    console.info(`writer model-call row: ${Buffer.byteLength(JSON.stringify(writer))} bytes`);
    // seq orders each attempt's rows from 0 without gaps.
    const ofGenerate = rows.filter((r) => r.jobId === rows.at(-1)?.jobId).map((r) => r.seq);
    expect([...ofGenerate].sort((a, b) => a - b)).toEqual(ofGenerate.map((_, i) => i));
    expect(warnings).not.toContain("generation debug write failed");
  });

  test("a failing debug store never fails the job and changes nothing", async () => {
    const ids = freshIds();
    const off = await generate(undefined, undefined, ids);
    await reset();
    const broken = await generate(
      async () => {
        throw new Error("debug db down");
      },
      undefined,
      ids,
    );
    expect(shape(broken.lesson.slides)).toEqual(shape(off.lesson.slides));
    expect(broken.lesson.generation?.stage).toBe(off.lesson.generation?.stage);
    expect(warnings).toContain("generation debug write failed");
  });

  test("a hanging debug store never delays the job; its close waits after the job settles", async () => {
    const settled: (() => Promise<void>)[] = [];
    const never: DebugStore = () => new Promise(() => {});
    const t0 = Date.now();
    const hung = await generate(never, settled);
    expect(hung.lesson.generation?.stage).toBe("generated");
    // The debug close is an after-settle hook, never awaited inside the job.
    expect(settled.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(30_000);
  });

  test("a failed job keeps its full error in the debug record only", async () => {
    const lessonId = await planned(realStore);
    const job = await confirm(lessonId);
    const err = await lessonGenerateJob(
      ctxFor(
        job,
        { lessonId, revision: 1 },
        depsWith(ai({ text: fixture.main.slice(0, 400) }), realStore),
      ) as never,
    ).catch((e: unknown) => e);
    expect(String((err as Error).message)).toContain("writer output incomplete");
    const rows = await listGenerationDebug(unsafeDb, workspaceId, lessonId);
    const failure = rows.find((r) => r.kind === "job-error")?.payload as Record<string, unknown>;
    expect(String(failure.message)).toContain("writer output incomplete");
    expect(String(failure.stack)).toContain("at ");
    const stageError = rows.find((r) => r.kind === "stage-error")?.payload as { stage?: string };
    expect(stageError.stage).toBe("write");
    expect(rows.some((r) => r.kind === "writer-output")).toBe(true);
  });

  test("a failure before the pipeline starts (the lesson load) is in the debug record too", async () => {
    const lessonId = await planned(realStore);
    await confirm(lessonId);
    // Another job holds the lock: the load throws before any stage runs.
    const err = await lessonGenerateJob(
      ctxFor(newId<JobId>(), { lessonId, revision: 1 }, depsWith(ai(), realStore)) as never,
    ).catch((e: unknown) => e);
    expect(String((err as Error).message)).toContain("lock lost");
    const rows = await listGenerationDebug(unsafeDb, workspaceId, lessonId);
    const failure = rows.find((r) => r.kind === "job-error")?.payload as Record<string, unknown>;
    expect(String(failure.message)).toContain("lock lost");
  });
});

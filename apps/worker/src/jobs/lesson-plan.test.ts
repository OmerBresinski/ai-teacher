import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createAi } from "@tj/ai";
import { createFakeAi, type FakeAi } from "@tj/ai/testing";
import { createDocument, deleteDocument, forWorkspace, getDocument } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import {
  type Lesson,
  lessonFromBrief,
  parseLesson,
  parseStoredWorksheet,
} from "@tj/domain/documents";
import { INPUT_CHECK_MESSAGES, noSources } from "@tj/generation";
import { FIXTURES, pipelineScript, SLIDES_INDEX, scriptedPipelineAi } from "@tj/generation/testing";
import { NonRetryableError } from "@tj/jobs";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { lessonPlanJob } from "./lesson-plan";

// Integration test against the compose Postgres (ADR 0014): the lock, the worksheet row and the
// per-slide writes are real repository calls, so the handler is exercised with the real `@tj/db`
// rather than a module mock — `mock.module("@tj/db")` would leak into every other test file.
const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping lesson.plan tests: ${t.reason}`);

describeDb("lesson.plan job", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const ws = () => forWorkspace(unsafeDb, workspaceId);
  const quiet = pino({ level: "silent" });

  const depsWith = (ai: WorkerDeps["ai"], caps?: WorkerDeps["caps"]): WorkerDeps => ({
    ai,
    db: unsafeDb,
    caps: caps ?? { capUsd: 5, capTokens: 1_000_000 },
    sources: noSources,
  });

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  });

  /** The row `POST /lessons` writes: a brief, no slides, locked by `jobId`. */
  async function briefLesson(jobId: JobId, patch: Partial<Lesson> = {}) {
    const lessonId = newId<LessonId>();
    const lesson = {
      ...lessonFromBrief(
        { brief: { topic: "States of matter" }, subject: "Science", yearGroup: "Year 8" },
        lessonId,
        new Date("2026-09-06T10:00:00.000Z"),
      ),
      ...patch,
    };
    await createDocument(ws(), "lesson", lesson, { id: lessonId, generatingJobId: jobId });
    return lessonId;
  }

  function ctx(
    jobId: JobId,
    lessonId: LessonId,
    deps: WorkerDeps,
    options: { ac?: AbortController } = {},
  ) {
    const ac = options.ac ?? new AbortController();
    const calls: Array<[number | undefined, string | undefined, string | undefined]> = [];
    return {
      calls,
      ctx: {
        jobId,
        workspaceId,
        payload: { lessonId },
        signal: ac.signal,
        progress: async (
          percent?: number,
          message?: string,
          extra?: { documentUpdatedAt?: string | undefined },
        ) => {
          calls.push([percent, message, extra?.documentUpdatedAt]);
        },
        logger: quiet,
        deps,
      },
    };
  }

  const storedLesson = async (lessonId: LessonId) =>
    parseLesson((await getDocument(ws(), lessonId))?.body);

  test("plans, generates, evaluates and repairs the brief; both rows unlocked; progress carries updatedAt", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ai = scriptedPipelineAi();
    const h = ctx(jobId, lessonId, depsWith(ai));

    await lessonPlanJob(h.ctx);

    const row = await getDocument(ws(), lessonId);
    expect(row?.generatingJobId).toBeNull();
    const lesson = parseLesson(row?.body);
    expect(lesson.facts).toBeDefined();
    expect(lesson.slides).toHaveLength(FIXTURES.planSkeleton.outline.length);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(lesson.generation?.jobId).toBe(jobId);
    const worksheetId = lesson.artefacts?.worksheetId;
    expect(worksheetId).toBeDefined();
    const worksheetRow = await getDocument(ws(), worksheetId ?? "");
    expect(worksheetRow?.kind).toBe("worksheet");
    expect(worksheetRow?.generatingJobId).toBeNull();
    const worksheet = parseStoredWorksheet(worksheetRow?.body);
    expect(worksheet.lessonId).toBe(lessonId);
    expect(worksheet.blocks.length).toBeGreaterThanOrEqual(4);

    // One progress line per stage plus one per generated slide, each stamped with the row's clock.
    const stamped = h.calls.filter(([, , at]) => at !== undefined);
    expect(stamped.length).toBeGreaterThanOrEqual(9);
    expect(stamped.at(-1)?.[2]).toBe(row?.updatedAt.toISOString());
    const ats = stamped.map(([, , at]) => Date.parse(at ?? ""));
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
  });

  test("a row locked by another job is a NonRetryableError: no write, no model call", async () => {
    const jobId = newId<JobId>();
    const otherJobId = newId<JobId>();
    const lessonId = await briefLesson(otherJobId);
    const before = await getDocument(ws(), lessonId);
    const ai = scriptedPipelineAi();

    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      NonRetryableError,
    );

    expect(ai.calls).toHaveLength(0);
    const after = await getDocument(ws(), lessonId);
    expect(after?.generatingJobId).toBe(otherJobId);
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
  });

  test("a row hard-deleted before the job runs is `lesson missing`; `finally` does not throw", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    await deleteDocument(ws(), lessonId);
    const ai = scriptedPipelineAi();

    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      "lesson missing",
    );
    expect(ai.calls).toHaveLength(0);
  });

  test("a failed Evaluate keeps the locks; the retry resumes after `generated` without re-planning", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    // Evaluate is the 13th call (check + 2 plan + 8 slides + worksheet); make it blow up as the
    // provider.
    const evaluateIndex = SLIDES_INDEX + FIXTURES.planSkeleton.outline.length - 2 + 1;
    const first: FakeAi = createFakeAi({
      script: pipelineScript({
        overrides: {
          [evaluateIndex]: () => {
            throw new Error("provider unreachable");
          },
        },
      }),
    });

    // `@tj/ai` wraps provider failures as a retryable `AiError`; the handler rethrows it as-is.
    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(first)).ctx)).rejects.toThrow(
      "Bedrock model call failed",
    );
    const mid = await storedLesson(lessonId);
    expect(mid.generation?.stage).toBe("generated");
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBe(jobId);
    const worksheetId = mid.artefacts?.worksheetId ?? "";
    expect((await getDocument(ws(), worksheetId))?.generatingJobId).toBe(jobId);

    const second = createFakeAi({ script: pipelineScript().slice(evaluateIndex) });
    await lessonPlanJob(ctx(jobId, lessonId, depsWith(second)).ctx);

    expect(second.calls.map((c) => c.context?.stage)).toEqual(["evaluate"]);
    const done = await storedLesson(lessonId);
    expect(done.generation?.stage).toBe("repaired");
    expect(done.artefacts?.worksheetId).toBe(worksheetId);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
    expect((await getDocument(ws(), worksheetId))?.generatingJobId).toBeNull();
  });

  test("a `generated` checkpoint whose worksheet row is missing is recreated under the same id on retry", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const evaluateIndex = SLIDES_INDEX + FIXTURES.planSkeleton.outline.length - 2 + 1;
    const first = createFakeAi({
      script: pipelineScript({
        overrides: {
          [evaluateIndex]: () => {
            throw new Error("provider unreachable");
          },
        },
      }),
    });
    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(first)).ctx)).rejects.toThrow();
    const mid = await storedLesson(lessonId);
    const worksheetId = mid.artefacts?.worksheetId ?? "";
    expect(mid.generation?.stage).toBe("generated");
    // The partial state the review found: checkpoint advanced, worksheet row not there.
    expect(await deleteDocument(ws(), worksheetId)).toBe(true);

    // Generate re-runs for the worksheet only (every slide is already on the row), then Evaluate.
    const second = createFakeAi({ script: pipelineScript().slice(evaluateIndex - 1) });
    await lessonPlanJob(ctx(jobId, lessonId, depsWith(second)).ctx);

    expect(second.calls.map((c) => c.context?.stage)).toEqual(["generate", "evaluate"]);
    const done = await storedLesson(lessonId);
    expect(done.generation?.stage).toBe("repaired");
    expect(done.slides).toHaveLength(FIXTURES.planSkeleton.outline.length);
    expect(done.artefacts?.worksheetId).toBe(worksheetId);
    const worksheetRow = await getDocument(ws(), worksheetId);
    expect(worksheetRow?.kind).toBe("worksheet");
    expect(worksheetRow?.generatingJobId).toBeNull();
  });

  test("an unconfigured provider is a NonRetryableError and releases the lock", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const deps = depsWith(createAi({}, { logger: quiet }));
    expect(deps.ai.kind).toBe("unconfigured");

    await expect(lessonPlanJob(ctx(jobId, lessonId, deps).ctx)).rejects.toThrow(NonRetryableError);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a brief the input check refuses is a NonRetryableError with the finding's message; nothing written, locks released", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const before = await getDocument(ws(), lessonId);
    const ai = scriptedPipelineAi({
      checkInput: {
        findings: [
          {
            check: "learner-name",
            severity: "error",
            target: {},
            message: "The brief seems to name a pupil. Please reword it.",
          },
        ],
      },
    });

    // The job-visible message is the fixed per-check text, not what the model wrote.
    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      new NonRetryableError(INPUT_CHECK_MESSAGES["learner-name"]),
    );

    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["check-input"]);
    const after = await getDocument(ws(), lessonId);
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
    expect(after?.generatingJobId).toBeNull();
  });

  test("a cancel during Generate keeps the slides so far and releases the locks", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ac = new AbortController();
    // Cancel while the fifth slide's answer is pending: four slides are already on the row.
    const script = pipelineScript();
    const pending = SLIDES_INDEX + 2;
    script[pending] = async (_call) => {
      ac.abort("cancelled");
      return script[pending - 1] as string;
    };
    const ai = createFakeAi({ script });

    await lessonPlanJob(ctx(jobId, lessonId, depsWith(ai), { ac }).ctx);

    const lesson = await storedLesson(lessonId);
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.slides.length).toBeGreaterThanOrEqual(2);
    expect(lesson.slides.length).toBeLessThan(FIXTURES.planSkeleton.outline.length);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a tiny cost cap completes with a budget finding after at most three calls", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ai = scriptedPipelineAi();

    // The fake's usage costs $0.003 on `small` and $0.009 on `standard`: the cap admits the input
    // check and Plan's skeleton call and refuses the facts call, which Plan records as a finding.
    await lessonPlanJob(
      ctx(jobId, lessonId, depsWith(ai, { capUsd: 0.005, capTokens: 1_000_000 })).ctx,
    );

    expect(ai.calls.length).toBeLessThanOrEqual(3);
    const lesson = await storedLesson(lessonId);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(lesson.generation?.findings.some((f) => f.check === "budget")).toBe(true);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("does nothing but release the lock when already cancelled", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ac = new AbortController();
    ac.abort("cancelled");
    const ai = scriptedPipelineAi();
    const h = ctx(jobId, lessonId, depsWith(ai), { ac });

    await lessonPlanJob(h.ctx);

    expect(h.calls).toEqual([]);
    expect(ai.calls).toHaveLength(0);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a shutdown abort keeps the lock for pg-boss's retry", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ac = new AbortController();
    ac.abort("shutdown");

    await lessonPlanJob(ctx(jobId, lessonId, depsWith(scriptedPipelineAi()), { ac }).ctx);

    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBe(jobId);
  });

  test("another Workspace's lesson is untouched", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const foreign = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: foreign });
    const h = ctx(jobId, lessonId, depsWith(scriptedPipelineAi()));
    h.ctx.workspaceId = foreign;

    await expect(lessonPlanJob(h.ctx)).rejects.toThrow("lesson missing");

    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBe(jobId);
  });
});

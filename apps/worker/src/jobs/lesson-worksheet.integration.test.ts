/**
 * Integration: `lesson.worksheet` against the compose Postgres (ADR 0014) with the scripted
 * fake provider (ADR 0030 items 1, 3, 8–9; TDD §7, T7). The lesson row is seeded at `planned`
 * with the fixture facts, confirmed at revision 1 and — as when the slides job is running —
 * locked by another job; the worksheet row is created locked by this job, as
 * `POST /lessons/:id/worksheet` writes it. The handler runs directly. Skips visibly when the
 * database is unreachable.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { createDocument, forWorkspace, getDocument } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import {
  type JobId,
  type LessonId,
  type LessonWorksheetPayload,
  newId,
  type WorkspaceId,
} from "@tj/domain";
import {
  type Lesson,
  lessonFromBrief,
  parseLesson,
  parseWorksheet,
  type Worksheet,
} from "@tj/domain/documents";
import { assignFactIds, generateWorksheetFillPrompt, stemPlan } from "@tj/generation";
import { FIXTURES, routed, scriptedWorksheetAi, worksheetScript } from "@tj/generation/testing";
import { NonRetryableError, type ProgressExtra } from "@tj/jobs";
import {
  defaultPracticeMinutes,
  estimateMinutes,
  newWorksheet,
  RECIPE_PROMPT_VERSION,
  resolveRecipe,
} from "@tj/slides";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { memoryStorage } from "../testing/memory-storage";
import { lessonWorksheetJob } from "./lesson-worksheet";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping lesson.worksheet tests: ${t.reason}`);

describeDb("lesson.worksheet job", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const ws = () => forWorkspace(unsafeDb, workspaceId);
  const quiet = pino({ level: "silent" });
  const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
  const depsWith = (ai: WorkerDeps["ai"], worksheetCapUsd = 0.1): WorkerDeps => ({
    ai,
    db: unsafeDb,
    caps: { capUsd: 5, capTokens: 1_000_000 },
    worksheetCapUsd,
    storage: memoryStorage(),
  });

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  });

  type Event = { percent?: number; message?: string } & ProgressExtra;

  function ctxFor(
    jobId: JobId,
    payload: LessonWorksheetPayload,
    deps: WorkerDeps,
    options: { ac?: AbortController; onProgress?: (event: Event) => Promise<void> } = {},
  ) {
    const events: Event[] = [];
    const ac = options.ac ?? new AbortController();
    return {
      events,
      ctx: {
        jobId,
        workspaceId,
        payload,
        signal: ac.signal,
        progress: async (percent?: number, message?: string, extra?: ProgressExtra) => {
          const event = { percent, message, ...(extra ?? {}) };
          events.push(event);
          await options.onProgress?.(event);
        },
        logger: quiet,
        deps,
      },
    };
  }

  /**
   * A confirmed lesson at `planned` with the fixture facts, locked by `lockedBy` (the slides job
   * running beside the sheet) unless told otherwise.
   */
  async function confirmedLesson(
    opts: { lockedBy?: JobId | null; revision?: number; stage?: "planned" | null } = {},
  ) {
    const lessonId = newId<LessonId>();
    const planJobId = newId<JobId>();
    const lockedBy = opts.lockedBy === undefined ? newId<JobId>() : opts.lockedBy;
    const base = lessonFromBrief(
      { brief: { topic: "States of matter" }, subject: "Science", yearGroup: "Year 8" },
      lessonId,
      new Date("2026-09-06T10:00:00.000Z"),
    );
    const lesson: Lesson = {
      ...base,
      facts,
      ...(opts.stage === null
        ? {}
        : {
            generation: {
              jobId: planJobId,
              stage: "planned",
              startedAt: "2026-09-06T10:00:00.000Z",
              promptVersions: {},
              usage: { calls: 3, inputTokens: 100, outputTokens: 50, costUsd: 0.02 },
              findings: [],
            },
          }),
      plan: {
        revision: opts.revision ?? 1,
        state: "confirmed",
        jobId: planJobId,
        confirmedAt: "2026-09-06T10:05:00.000Z",
      },
    };
    const row = await createDocument(ws(), "lesson", lesson, {
      id: lessonId,
      ...(lockedBy ? { generatingJobId: lockedBy } : {}),
    });
    return { lessonId, row };
  }

  /** The shell `POST /lessons/:id/worksheet` writes: an empty sheet with `lessonId`, locked. */
  async function worksheetShell(lessonId: LessonId, jobId: JobId, body?: Worksheet) {
    const worksheetId = newId();
    const shell = body ?? { ...newWorksheet("States of matter"), id: worksheetId, lessonId };
    await createDocument(
      ws(),
      "worksheet",
      { ...shell, id: worksheetId },
      {
        id: worksheetId,
        generatingJobId: jobId,
      },
    );
    return worksheetId;
  }

  const payloadFor = (
    lessonId: LessonId,
    worksheetId: string,
    patch: Partial<LessonWorksheetPayload> = {},
  ): LessonWorksheetPayload => ({
    lessonId,
    worksheetId,
    revision: 1,
    recipeId: "knowledge-check",
    practiceMinutes: defaultPracticeMinutes(resolveRecipe("knowledge-check", facts)),
    ...patch,
  });

  test("frames, fills and checks the fixture sheet: events 5/20/80/100 with the sheet's updatedAt, framed then checked, lock released, lesson untouched", async () => {
    const { lessonId, row: lessonBefore } = await confirmedLesson();
    const jobId = newId<JobId>();
    const worksheetId = await worksheetShell(lessonId, jobId);
    const ai = scriptedWorksheetAi();
    const stagesSeen: (string | undefined)[] = [];
    const h = ctxFor(jobId, payloadFor(lessonId, worksheetId), depsWith(ai), {
      onProgress: async (event) => {
        const row = await getDocument(ws(), worksheetId);
        stagesSeen.push(parseWorksheet(row?.body).generation?.stage);
        // Every event carries the worksheet row's own updatedAt, as it stands at that moment.
        expect(event.documentUpdatedAt).toBe(row?.updatedAt.toISOString());
      },
    });

    await lessonWorksheetJob(h.ctx);

    expect(h.events.map((e) => [e.percent, e.message, e.stage])).toEqual([
      [5, "Framing", "worksheet"],
      [20, "Writing the questions", "worksheet"],
      [80, "Checking", "worksheet"],
      [100, "Worksheet ready", "worksheet"],
    ]);
    // `generation.stage` as each event went out: none, framed, filled, checked.
    expect(stagesSeen).toEqual([undefined, "framed", "filled", "checked"]);

    const row = await getDocument(ws(), worksheetId);
    expect(row?.kind).toBe("worksheet");
    expect(row?.lessonId).toBe(lessonId);
    expect(row?.generatingJobId).toBeNull();
    const sheet = parseWorksheet(row?.body);
    expect(sheet.lessonId).toBe(lessonId);
    expect(sheet.generation).toMatchObject({
      jobId,
      stage: "checked",
      recipeId: "knowledge-check",
      practiceMinutes: 13,
      promptVersions: {
        frame: RECIPE_PROMPT_VERSION,
        fill: generateWorksheetFillPrompt.version,
      },
    });
    expect(sheet.generation?.completedAt).toBeDefined();
    expect(sheet.generation?.usage.calls).toBe(1);
    expect(sheet.generation?.usage.costUsd ?? 0).toBeGreaterThan(0);
    // One fill call on `small` at low effort, in this job's context.
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.context).toMatchObject({
      stage: "worksheet",
      jobId,
      lessonId,
      effort: "low",
      promptVersion: generateWorksheetFillPrompt.version,
    });
    expect(ai.calls[0]?.modelId).toBe(ai.modelId("small"));
    // The frame's blocks then the three items the fixture fills, all provenance-stamped.
    expect(sheet.blocks.map((b) => b.type)).toEqual([
      "instructions",
      "question",
      "question",
      "multiple-choice",
      "multiple-choice",
      "multiple-choice",
    ]);
    expect(sheet.blocks.every((b) => b.generatedFrom !== undefined)).toBe(true);
    expect(sheet.blocks.slice(3).every((b) => b.authoredBy === "ai")).toBe(true);
    // Within 30% of the practice time, so no practice-time finding; nothing else either.
    expect(sheet.generation?.findings).toEqual([]);
    expect(Math.abs(estimateMinutes(sheet.blocks) - 13) * 100).toBeLessThanOrEqual(13 * 30);

    // The lesson row was never written: same updatedAt, still locked by the slides job.
    const lessonAfter = await getDocument(ws(), lessonId);
    expect(lessonAfter?.updatedAt.toISOString()).toBe(lessonBefore.updatedAt.toISOString());
    expect(lessonAfter?.generatingJobId).toBe(lessonBefore.generatingJobId);
    expect(parseLesson(lessonAfter?.body).generation?.usage.costUsd).toBe(0.02);
  });

  test("a stem the exit-ticket slide owns is reserved from the sheet and absent from it", async () => {
    const { lessonId } = await confirmedLesson();
    const jobId = newId<JobId>();
    const worksheetId = await worksheetShell(lessonId, jobId);
    const ai = scriptedWorksheetAi();
    await lessonWorksheetJob(ctxFor(jobId, payloadFor(lessonId, worksheetId), depsWith(ai)).ctx);
    const { reservedForWorksheet } = stemPlan(facts);
    const exitStem = facts.questions.find((q) => q.use === "exit")?.stem as string;
    expect(reservedForWorksheet).toContain(exitStem);
    expect(ai.calls[0]?.promptText).toContain(`  - ${exitStem}`);
    const sheet = parseWorksheet((await getDocument(ws(), worksheetId))?.body);
    expect(JSON.stringify(sheet.blocks)).not.toContain(exitStem);
  });

  test("exit ticket at 10 minutes: the schema admits only questions; the time is within 30% or a warning is recorded", async () => {
    const { lessonId } = await confirmedLesson();
    const jobId = newId<JobId>();
    const worksheetId = await worksheetShell(lessonId, jobId);
    const answer = JSON.stringify({
      slots: [
        {
          index: 5,
          blocks: [
            {
              type: "question",
              text: "Why can you pour a liquid but not a solid?",
              answer: "Liquid particles slide past each other; solid particles are held in place.",
              answerLines: 4,
              marks: 2,
              factRefs: ["q7", "o1"],
            },
          ],
        },
      ],
    });
    const ai = scriptedWorksheetAi({ fill: answer });
    await lessonWorksheetJob(
      ctxFor(
        jobId,
        payloadFor(lessonId, worksheetId, { recipeId: "exit-ticket", practiceMinutes: 10 }),
        depsWith(ai),
      ).ctx,
    );
    expect(ai.calls[0]?.promptText).toContain("slot 5: 1–2 blocks; types: question");
    const sheet = parseWorksheet((await getDocument(ws(), worksheetId))?.body);
    expect(sheet.generation).toMatchObject({
      stage: "checked",
      recipeId: "exit-ticket",
      practiceMinutes: 10,
    });
    const minutes = estimateMinutes(sheet.blocks);
    const within = Math.abs(minutes - 10) * 100 <= 10 * 30;
    const warning = sheet.generation?.findings.find((f) => f.check === "practice-time");
    expect(within ? warning : warning?.severity).toBe(within ? undefined : "warning");
  });

  test("a fill that misses its schema twice fails without retry: the frame stays at framed, lock null; a new job reuses the row", async () => {
    const { lessonId, row: lessonBefore } = await confirmedLesson();
    const jobId = newId<JobId>();
    const worksheetId = await worksheetShell(lessonId, jobId);
    const bad = "not json";
    const ai = createFakeAi({ script: routed([bad, bad]) });

    await expect(
      lessonWorksheetJob(ctxFor(jobId, payloadFor(lessonId, worksheetId), depsWith(ai)).ctx),
    ).rejects.toBeInstanceOf(NonRetryableError);

    expect(ai.calls).toHaveLength(2);
    const row = await getDocument(ws(), worksheetId);
    expect(row?.generatingJobId).toBeNull();
    const framed = parseWorksheet(row?.body);
    expect(framed.generation).toMatchObject({
      jobId,
      stage: "framed",
      recipeId: "knowledge-check",
    });
    expect(framed.blocks.map((b) => b.type)).toEqual([
      "instructions",
      "question",
      "question",
      "paragraph",
    ]);
    expect(framed.generation?.usage.calls).toBe(0);
    const lessonAfter = await getDocument(ws(), lessonId);
    expect(lessonAfter?.updatedAt.toISOString()).toBe(lessonBefore.updatedAt.toISOString());

    // The API re-locks the same row under a new job id (`relockWorksheet`); the job reframes it,
    // keeps its createdAt and finishes.
    const again = newId<JobId>();
    await unsafeDb.execute(
      `update documents set generating_job_id = '${again}' where id = '${worksheetId}'`,
    );
    await lessonWorksheetJob(
      ctxFor(again, payloadFor(lessonId, worksheetId), depsWith(scriptedWorksheetAi())).ctx,
    );
    const done = parseWorksheet((await getDocument(ws(), worksheetId))?.body);
    expect(done.id).toBe(worksheetId);
    expect(done.createdAt).toBe(framed.createdAt);
    expect(done.generation).toMatchObject({ jobId: again, stage: "checked" });
    expect(done.blocks).toHaveLength(6);
    expect((await getDocument(ws(), worksheetId))?.generatingJobId).toBeNull();
  });

  test("cancel during the fill: the handler returns, the frame is kept, the lock is released", async () => {
    const { lessonId } = await confirmedLesson();
    const jobId = newId<JobId>();
    const worksheetId = await worksheetShell(lessonId, jobId);
    const ac = new AbortController();
    const script = worksheetScript();
    const fill = script[0];
    script[0] = async (call) => {
      ac.abort("cancelled");
      return typeof fill === "function" ? fill(call) : (fill as string);
    };
    const ai = createFakeAi({ script: routed(script) });
    const h = ctxFor(jobId, payloadFor(lessonId, worksheetId), depsWith(ai), { ac });

    await lessonWorksheetJob(h.ctx);

    expect(ai.calls).toHaveLength(1);
    expect(h.events.map((e) => e.percent)).toEqual([5, 20]);
    const row = await getDocument(ws(), worksheetId);
    expect(row?.generatingJobId).toBeNull();
    expect(parseWorksheet(row?.body).generation?.stage).toBe("framed");
  });

  test("the budget is the worksheet's own: a cap the fill cannot afford fails without a call", async () => {
    const { lessonId } = await confirmedLesson();
    const jobId = newId<JobId>();
    const worksheetId = await worksheetShell(lessonId, jobId);
    const ai = scriptedWorksheetAi();
    await expect(
      lessonWorksheetJob(ctxFor(jobId, payloadFor(lessonId, worksheetId), depsWith(ai, 0)).ctx),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(ai.calls).toHaveLength(0);
    const row = await getDocument(ws(), worksheetId);
    expect(row?.generatingJobId).toBeNull();
    expect(parseWorksheet(row?.body).generation?.stage).toBe("framed");
  });

  test("refusals before any call: lock lost, another kind, revision moved, not planned, lesson missing", async () => {
    const { lessonId } = await confirmedLesson();
    const ai = scriptedWorksheetAi();
    const jobId = newId<JobId>();
    const worksheetId = await worksheetShell(lessonId, jobId);

    await expect(
      lessonWorksheetJob(
        ctxFor(newId<JobId>(), payloadFor(lessonId, worksheetId), depsWith(ai)).ctx,
      ),
    ).rejects.toThrow(new NonRetryableError("lock lost"));
    // Still locked by its job.
    expect((await getDocument(ws(), worksheetId))?.generatingJobId).toBe(jobId);

    await expect(
      lessonWorksheetJob(ctxFor(jobId, payloadFor(lessonId, lessonId), depsWith(ai)).ctx),
    ).rejects.toThrow(new NonRetryableError("worksheet missing"));

    await expect(
      lessonWorksheetJob(
        ctxFor(jobId, payloadFor(lessonId, worksheetId, { revision: 2 }), depsWith(ai)).ctx,
      ),
    ).rejects.toThrow(new NonRetryableError("revision moved"));

    const unplanned = await confirmedLesson({ stage: null });
    const jobB = newId<JobId>();
    const sheetB = await worksheetShell(unplanned.lessonId, jobB);
    await expect(
      lessonWorksheetJob(ctxFor(jobB, payloadFor(unplanned.lessonId, sheetB), depsWith(ai)).ctx),
    ).rejects.toThrow(new NonRetryableError("lesson is not planned"));

    const jobC = newId<JobId>();
    const sheetC = await worksheetShell(lessonId, jobC);
    await expect(
      lessonWorksheetJob(ctxFor(jobC, payloadFor(newId<LessonId>(), sheetC), depsWith(ai)).ctx),
    ).rejects.toThrow(new NonRetryableError("lesson missing"));

    expect(ai.calls).toHaveLength(0);
    // A refusal after the ownership check still releases this job's lock.
    expect((await getDocument(ws(), sheetC))?.generatingJobId).toBeNull();
  });
});

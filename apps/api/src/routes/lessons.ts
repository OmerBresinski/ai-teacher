/**
 * `POST /lessons` — a brief becomes a Lesson row and a queued `lesson.plan` job (ADR 0024 §6,
 * §13, §15, §18; F01 item 2). One call from the brief screen: the API applies the key-stage
 * defaults, mints the lesson id and the job id, inserts the lesson with
 * `generating_job_id = jobId`, enqueues the Plan job with `{ lessonId, revision: 1 }` under that
 * id and answers `202 { lessonId, jobId, revision: 1 }`; the client navigates to `/l/$lessonId`
 * and follows `GET /jobs/:jobId/events`.
 *
 * Order of operations: the row is written **before** the job is queued, so a worker that picks
 * the job up at once always finds a lock to clear — the reverse order could leave a lesson locked
 * for ever when the stub completes faster than the insert commits (§18). If the enqueue fails
 * after the insert, the row is removed again so no half-created lesson stays behind; `enqueue`
 * itself cancels the pg-boss job when it cannot write the `queued` event. The same request body
 * cap as `/documents` applies. Rate-limited per Workspace with the model-call limiter in `app.ts`
 * (§15). Nothing about the brief is logged — only ids, the revision and counts (ADR 0015).
 *
 * `POST /lessons/:id/cascade` and `POST /lessons/:id/regenerate` (ADR 0025 §18, §19) enqueue the
 * proposal jobs. They take **no** generating lock — the teacher keeps editing and the editor
 * applies the result as one undo transaction — so they refuse (`409 generating`) only while a
 * pipeline still holds the row. `singletonKey` `<lessonId>:<job>` with a `PROPOSAL_DEBOUNCE_S`
 * slot debounces each job per lesson: a second identical request inside the slot is `409`
 * "already queued" (as `/jobs/*`), and the editor coalesces its fact edits anyway.
 *
 * The plan screen (ADR 0029, TDD T1–T4): `POST /lessons` writes `plan { revision: 1 }` and the
 * job stops at `planned` unless `skipPlanning`; a repeat `requestId` answers the first lesson.
 * `POST /lessons/:id/plan` re-plans and `POST /lessons/:id/generate` confirms, each one
 * compare-and-set on `expectedRevision` that moves the lock to a freshly minted job id in the same
 * write (`setPlanRevisionAndLock`), then the enqueue under that id. A re-plan supersedes the plan
 * job still writing the proposal (its next write is `lost_lock`) and cancels it, best effort. If
 * the enqueue fails the previous body is put back and the lock released, so the screen can retry.
 * Logs carry ids, revisions, counts and booleans — never brief or objective text (ADR 0015).
 */
import { zValidator } from "@hono/zod-validator";
import {
  bindSourcesToLesson,
  clearGenerating,
  createDocument,
  DOCUMENTS_REQUEST_ID_INDEX,
  type DocumentRow,
  deleteDocument,
  findLessonByRequestId,
  forWorkspace,
  getDocument,
  isUniqueViolation,
  putDocumentAsJob,
  type ScopableDb,
  type SetPlanRevisionOptions,
  type SetPlanRevisionResult,
  setPlanRevisionAndLock,
  toSourceRef,
  unbindSource,
  unbindSourcesFromLesson,
  type WorkspaceDb,
} from "@tj/db";
import {
  type JobId,
  type JobName,
  type JobPayloadInputs,
  LessonCascadePayloadSchema,
  type LessonId,
  LessonRegeneratePayloadSchema,
  newId,
} from "@tj/domain";
import {
  CreateLessonSchema,
  GenerateLessonSchema,
  type Lesson,
  lessonFromBrief,
  PlanLessonSchema,
  type SourceRef,
} from "@tj/domain/documents";
import { cancel, enqueue } from "@tj/jobs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { smallJsonBodyLimit } from "../body-limits";
import type { AppEnv } from "../context";
import { ConflictError } from "../errors";
import type { EventsRuntime } from "../events/runtime";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";
import { documentBodyLimit, GENERATING_MESSAGE, NOT_FOUND_MESSAGE } from "./documents";
import { requireRuntime } from "./jobs";
import { confirmLesson, replanLesson } from "./plan-patches";

// `lessonFromBrief` lives in `@tj/domain/documents` (shared with the Studio entry); re-exported
// because `lessons.test.ts` and the brief screen import it from here.
export { lessonFromBrief };

export const SOURCES_UNAVAILABLE_MESSAGE = "One of the uploaded files is no longer available.";

/**
 * Insert the locked lesson, then queue its Plan job under the pre-minted id. On an enqueue failure
 * the row is removed so the Library never shows a lesson no job will ever fill.
 *
 * Sources (ADR 0027 §5): the claim and the insert run in **one transaction**. `bindSourcesToLesson`
 * is a single conditional `UPDATE … RETURNING`; fewer rows than distinct ids means a Source is
 * missing, another Workspace's, deleted or already bound — the transaction rolls back and the
 * teacher is told, and two concurrent lessons can never claim the same Source. The claimed rows
 * become `lesson.sources` before the document is written.
 */
export async function createLessonAndEnqueue(
  ws: WorkspaceDb,
  runtime: EventsRuntime,
  lesson: Lesson,
  sourceIds: readonly string[] = [],
  { skipPlanning = false, requestId }: { skipPlanning?: boolean; requestId?: string } = {},
): Promise<{ lessonId: LessonId; jobId: JobId; revision: number }> {
  const lessonId = lesson.id as LessonId;
  const jobId = newId<JobId>();
  const distinct = [...new Set(sourceIds)];
  // ADR 0029 items 1, 3: revision 1 belongs to this job. Skip planning is confirmed up front —
  // there is no plan screen to confirm it on.
  const plan: Lesson["plan"] = skipPlanning
    ? { revision: 1, state: "confirmed", jobId, confirmedAt: lesson.createdAt }
    : { revision: 1, state: "proposed", jobId };
  await ws.tx(async (scoped) => {
    const rows = await bindSourcesToLesson(scoped, distinct, lessonId);
    if (rows.length !== distinct.length) {
      throw new HTTPException(422, { message: SOURCES_UNAVAILABLE_MESSAGE });
    }
    const body: Lesson = {
      ...lesson,
      ...(rows.length > 0 ? { sources: rows.map(toSourceRef) } : {}),
      plan,
    };
    await createDocument(scoped, "lesson", body, {
      id: lessonId,
      generatingJobId: jobId,
      requestId,
      continueWhenPlanned: skipPlanning,
    });
  });
  let queued: JobId | null;
  try {
    queued = await enqueue(
      runtime.jobs,
      "lesson.plan",
      { lessonId, revision: 1, ...(skipPlanning ? {} : { stopAfter: "planned" as const }) },
      {
        workspaceId: ws.workspaceId,
        id: jobId,
      },
    );
  } catch (error) {
    await undoCreate(ws, lessonId, distinct.length > 0);
    throw error;
  }
  if (queued === null) {
    await undoCreate(ws, lessonId, distinct.length > 0);
    throw new HTTPException(409, { message: "An identical job is already queued." });
  }
  return { lessonId, jobId, revision: 1 };
}

/** The `202` a repeated `requestId` gets: the first call's lesson as it stands now (ADR 0029). */
function replayed(row: DocumentRow): { lessonId: LessonId; jobId: JobId; revision: number } {
  const plan = (row.body as Lesson).plan;
  return {
    lessonId: row.id as LessonId,
    jobId: (row.generatingJobId ?? plan?.jobId ?? "") as JobId,
    revision: plan?.revision ?? 0,
  };
}

/** The enqueue-failure compensation: drop the row and release any Sources it had claimed. */
async function undoCreate(ws: WorkspaceDb, lessonId: LessonId, hadSources: boolean): Promise<void> {
  await deleteDocument(ws, lessonId).catch(() => undefined);
  if (hadSources) await unbindSourcesFromLesson(ws, lessonId).catch(() => undefined);
}

const lessonParam = z.object({ id: z.uuid() });
/** The request bodies: the payload schemas without `lessonId`, which comes from the path. */
const cascadeBody = LessonCascadePayloadSchema.omit({ lessonId: true });
const regenerateBody = LessonRegeneratePayloadSchema.omit({ lessonId: true });

type ProposalJob = Extract<JobName, "lesson.cascade" | "lesson.regenerate">;

/**
 * One proposal job per lesson per this many seconds. pg-boss `standard` queues do not dedupe on
 * `singletonKey` alone; the throttle slot is what makes a repeat request `409` while the previous
 * one is still queued or running (a cascade takes a few seconds on the fake, tens on Bedrock).
 */
export const PROPOSAL_DEBOUNCE_S = 5;

/**
 * Enqueue a proposal job for an existing, unlocked lesson (ADR 0025 §18). `404` for a missing or
 * non-lesson row (another Workspace's id reads as missing, ADR 0007); `409 generating` while the
 * pipeline holds the lock; `409` when the same job is already queued for this lesson.
 */
async function enqueueProposal<J extends ProposalJob>(
  ws: WorkspaceDb,
  rt: EventsRuntime,
  job: J,
  payload: JobPayloadInputs[J],
): Promise<JobId> {
  const row = await getDocument(ws, payload.lessonId);
  if (row === null || row.kind !== "lesson") {
    throw new HTTPException(404, { message: NOT_FOUND_MESSAGE });
  }
  if (row.generatingJobId !== null) throw new ConflictError("generating", GENERATING_MESSAGE);
  const jobId = await enqueue(rt.jobs, job, payload, {
    workspaceId: ws.workspaceId,
    singletonKey: `${payload.lessonId}:${job.slice("lesson.".length)}`,
    singletonSeconds: PROPOSAL_DEBOUNCE_S,
  });
  if (jobId === null)
    throw new HTTPException(409, { message: "An identical job is already queued." });
  return jobId;
}

export const STALE_PLAN_MESSAGE = "This plan changed elsewhere. Reload to see the latest.";
export const PLANNING_MESSAGE = "The plan is still being written.";
export const CONFIRMED_MESSAGE = "This plan is already confirmed.";
export const NOT_PLANNED_MESSAGE = "This lesson has no plan to confirm yet.";
export const NO_OBJECTIVES_MESSAGE = "Keep at least one objective.";
export const NO_BRIEF_MESSAGE = "This lesson has no brief to plan from.";
const JOBS_UNAVAILABLE_MESSAGE = "Background jobs are not available right now.";

/**
 * The `409` for a lesson `setPlanRevisionAndLock` found locked: `generating` once the plan is
 * confirmed (a generate job, or a pinned re-plan, owns it), `planning` while a plan job writes the
 * proposal. Read after the refusal, so the answer names the holder the client should follow.
 */
async function lockedConflict(ws: WorkspaceDb, lessonId: LessonId, holder: JobId) {
  const row = await getDocument(ws, lessonId);
  const plan = (row?.body as Lesson | undefined)?.plan;
  const details = { jobId: holder, ...(plan ? { revision: plan.revision } : {}) };
  return plan?.state === "confirmed"
    ? new ConflictError("generating", CONFIRMED_MESSAGE, details)
    : new ConflictError("planning", PLANNING_MESSAGE, details);
}

/**
 * `setPlanRevisionAndLock` with its refusals as HTTP errors: `missing` → 404, `stale` → `409
 * stale { revision }`, locked → `lockedConflict`. `prepare` runs first in the same transaction
 * (the Source changes), and `patch` may throw an `HTTPException` for a precondition only the
 * locked row can answer; a throw from either rolls the whole change back. Returns the written
 * lesson and the one it replaced.
 */
async function changePlan(
  ws: WorkspaceDb,
  lessonId: LessonId,
  change: SetPlanRevisionOptions,
  prepare: (scoped: WorkspaceDb) => Promise<void> = async () => {},
): Promise<{ lesson: Lesson; previous: Lesson }> {
  let previous: Lesson | undefined;
  const result = await ws
    .tx(async (scoped) => {
      await prepare(scoped);
      const written = await setPlanRevisionAndLock(scoped, lessonId, {
        ...change,
        patch: (lesson) => {
          previous = lesson;
          return change.patch(lesson);
        },
      });
      // Nothing was written: undo what `prepare` did.
      if (written.status !== "ok") throw new PlanRefused(written);
      return written;
    })
    .catch(async (error: unknown) => {
      if (!(error instanceof PlanRefused)) throw error;
      const refused = error.result;
      if (refused.status === "missing") {
        throw new HTTPException(404, { message: NOT_FOUND_MESSAGE });
      }
      if (refused.status === "stale") {
        throw new ConflictError("stale", STALE_PLAN_MESSAGE, { revision: refused.revision });
      }
      throw await lockedConflict(ws, lessonId, refused.jobId);
    });
  return { lesson: result.row.body as Lesson, previous: previous as Lesson };
}

/** Rolls `changePlan`'s transaction back with the refusal it is carrying. */
class PlanRefused extends Error {
  constructor(readonly result: Exclude<SetPlanRevisionResult, { status: "ok" }>) {
    super(`plan change refused: ${result.status}`);
  }
}

/**
 * Enqueue the job a plan change locked the row for, under that id. When it cannot be queued the
 * previous body goes back (while this id still holds the lock), `undo` reverses the rest (Sources)
 * and the lock is released: the teacher sees the plan as it was and can press again. `503`.
 */
async function enqueueForPlan<N extends "lesson.plan" | "lesson.generate">(
  ws: WorkspaceDb,
  rt: EventsRuntime,
  name: N,
  payload: JobPayloadInputs[N],
  { jobId, previous, undo }: { jobId: JobId; previous: Lesson; undo?: () => Promise<void> },
): Promise<void> {
  let queued: JobId | null = null;
  let failure: unknown;
  try {
    queued = await enqueue(rt.jobs, name, payload, { workspaceId: ws.workspaceId, id: jobId });
  } catch (error) {
    failure = error;
  }
  if (queued !== null) return;
  await putDocumentAsJob(ws, previous.id, previous, jobId).catch(() => undefined);
  await undo?.().catch(() => undefined);
  await clearGenerating(ws, previous.id, jobId).catch(() => undefined);
  throw new HTTPException(503, { message: JOBS_UNAVAILABLE_MESSAGE, cause: failure });
}

/** What `/plan` changed about the lesson's Sources (ADR 0029 item 12). */
interface SourceChange {
  /** The new list, in the order the client sent. */
  sources: SourceRef[];
  added: string[];
  removed: string[];
}

/**
 * Claim the new Sources and release the dropped ones, when `sourceIds` names a list other than
 * the stored one; `undefined` otherwise. Runs inside the plan transaction, before the
 * compare-and-set: a short claim is `422`, and a stale revision rolls the claim back with it.
 */
async function changeSources(
  scoped: WorkspaceDb,
  lessonId: LessonId,
  sourceIds: readonly string[] | undefined,
): Promise<SourceChange | undefined> {
  if (sourceIds === undefined) return undefined;
  const row = await getDocument(scoped, lessonId);
  if (row === null || row.kind !== "lesson") return undefined;
  const current = (row.body as Lesson).sources ?? [];
  const wanted = [...new Set(sourceIds)];
  const have = new Map(current.map((s) => [s.id, s]));
  const added = wanted.filter((id) => !have.has(id));
  const removed = current.map((s) => s.id).filter((id) => !wanted.includes(id));
  if (added.length === 0 && removed.length === 0) return undefined;
  const claimed = await bindSourcesToLesson(scoped, added, lessonId);
  if (claimed.length !== added.length) {
    throw new HTTPException(422, { message: SOURCES_UNAVAILABLE_MESSAGE });
  }
  for (const id of removed) await unbindSource(scoped, id, lessonId);
  for (const row of claimed) have.set(row.id, toSourceRef(row));
  return { sources: wanted.map((id) => have.get(id) as SourceRef), added, removed };
}

/** The reverse of `changeSources`, for an enqueue that failed after the commit. */
async function restoreSources(ws: WorkspaceDb, lessonId: LessonId, change: SourceChange) {
  for (const id of change.added) await unbindSource(ws, id, lessonId);
  await bindSourcesToLesson(ws, change.removed, lessonId);
}

export function lessonRoutes(unsafeDb: ScopableDb, runtime: EventsRuntime | undefined) {
  return new Hono<AppEnv>()
    .post(
      "/lessons",
      documentBodyLimit(),
      requireJsonBody(),
      zValidator("json", CreateLessonSchema, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const rt = requireRuntime(runtime);
        const input = c.req.valid("json");
        const ws = forWorkspace(unsafeDb, workspaceId);
        const { requestId, skipPlanning = false } = input;
        if (requestId !== undefined) {
          const existing = await findLessonByRequestId(ws, requestId);
          if (existing !== null) {
            const answer = replayed(existing);
            c.get("logger")?.info({ ...answer, replayed: true }, "lesson request repeated");
            return c.json(answer, 202);
          }
        }
        const lesson = lessonFromBrief(input, newId<LessonId>(), new Date());
        const sourceIds = input.sourceIds ?? [];
        let created: Awaited<ReturnType<typeof createLessonAndEnqueue>>;
        try {
          created = await createLessonAndEnqueue(ws, rt, lesson, sourceIds, {
            skipPlanning,
            requestId,
          });
        } catch (error) {
          // Two requests with one `requestId` raced past the read: the loser answers the winner's.
          const winner =
            requestId !== undefined && isUniqueViolation(error, DOCUMENTS_REQUEST_ID_INDEX)
              ? await findLessonByRequestId(ws, requestId)
              : null;
          if (winner === null) throw error;
          created = replayed(winner);
        }
        c.get("logger")?.info(
          { ...created, sources: sourceIds.length, skipPlanning },
          "lesson created from brief",
        );
        return c.json(created, 202);
      },
    )
    .post(
      "/lessons/:id/plan",
      smallJsonBodyLimit(),
      requireJsonBody(),
      zValidator("param", lessonParam, validationHook),
      zValidator("json", PlanLessonSchema, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const rt = requireRuntime(runtime);
        const lessonId = c.req.valid("param").id as LessonId;
        const input = c.req.valid("json");
        const ws = forWorkspace(unsafeDb, workspaceId);
        const jobId = newId<JobId>();
        let sources: SourceChange | undefined;
        let pinned = false;
        const { lesson, previous } = await changePlan(
          ws,
          lessonId,
          {
            expectedRevision: input.expectedRevision,
            jobId,
            supersedeProposal: true,
            patch: (stored) => {
              if (stored.plan?.state === "confirmed") {
                throw new ConflictError("generating", CONFIRMED_MESSAGE, {
                  revision: stored.plan.revision,
                });
              }
              const next = replanLesson(stored, input, { jobId, sources: sources?.sources });
              pinned = next.pinned;
              return next.lesson;
            },
          },
          async (scoped) => {
            sources = await changeSources(scoped, lessonId, input.sourceIds);
          },
        );
        const revision = lesson.plan?.revision ?? 0;
        const change = sources;
        await enqueueForPlan(
          ws,
          rt,
          "lesson.plan",
          { lessonId, revision, stopAfter: "planned", ...(pinned ? { pinObjectives: true } : {}) },
          {
            jobId,
            previous,
            ...(change ? { undo: () => restoreSources(ws, lessonId, change) } : {}),
          },
        );
        // The superseded proposal job, if it is still running: its next write is `lost_lock`
        // whatever happens here, so the cancel only saves its remaining model calls.
        const superseded = previous.plan?.jobId as JobId | undefined;
        let cancelled = false;
        if (superseded !== undefined && superseded !== jobId) {
          cancelled = await cancel(rt.jobs, superseded, { name: "lesson.plan" })
            .then((r) => r.status === "cancelled" || r.status === "cancelling")
            .catch(() => false);
        }
        c.get("logger")?.info(
          {
            lessonId,
            jobId,
            revision,
            pinned,
            supersededJobId: superseded ?? null,
            cancelled,
            sourcesAdded: change?.added.length ?? 0,
            sourcesRemoved: change?.removed.length ?? 0,
          },
          "lesson re-plan queued",
        );
        return c.json({ jobId, revision }, 202);
      },
    )
    .post(
      "/lessons/:id/generate",
      smallJsonBodyLimit(),
      requireJsonBody(),
      zValidator("param", lessonParam, validationHook),
      zValidator("json", GenerateLessonSchema, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const input = c.req.valid("json");
        if (input.objectives.length === 0) {
          throw new HTTPException(422, { message: NO_OBJECTIVES_MESSAGE });
        }
        const rt = requireRuntime(runtime);
        const lessonId = c.req.valid("param").id as LessonId;
        const ws = forWorkspace(unsafeDb, workspaceId);
        const jobId = newId<JobId>();
        const now = new Date();
        let replan = false;
        const { lesson, previous } = await changePlan(ws, lessonId, {
          expectedRevision: input.expectedRevision,
          jobId,
          patch: (stored) => {
            if (stored.plan?.state === "confirmed") {
              throw new ConflictError("generating", CONFIRMED_MESSAGE, {
                revision: stored.plan.revision,
              });
            }
            const facts = stored.facts;
            if (facts === undefined || stored.generation?.stage !== "planned") {
              throw new HTTPException(422, { message: NOT_PLANNED_MESSAGE });
            }
            if (!stored.brief) throw new HTTPException(422, { message: NO_BRIEF_MESSAGE });
            const next = confirmLesson({ ...stored, facts }, input, { jobId, now });
            replan = next.replan;
            return next.lesson;
          },
        });
        const revision = lesson.plan?.revision ?? 0;
        if (replan) {
          // A shape change (ADR 0029 item 8): the teacher already confirmed, so no `stopAfter`.
          await enqueueForPlan(
            ws,
            rt,
            "lesson.plan",
            { lessonId, revision, pinObjectives: true },
            { jobId, previous },
          );
        } else {
          await enqueueForPlan(
            ws,
            rt,
            "lesson.generate",
            { lessonId, revision },
            { jobId, previous },
          );
        }
        c.get("logger")?.info(
          {
            lessonId,
            jobId,
            revision,
            replan,
            objectives: lesson.facts?.objectives.length ?? 0,
          },
          "lesson plan confirmed",
        );
        return c.json({ jobId, revision }, 202);
      },
    )
    .post(
      "/lessons/:id/cascade",
      smallJsonBodyLimit(),
      requireJsonBody(),
      zValidator("param", lessonParam, validationHook),
      zValidator("json", cascadeBody, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const rt = requireRuntime(runtime);
        const lessonId = c.req.valid("param").id as LessonId;
        const { changedFactIds } = c.req.valid("json");
        const ws = forWorkspace(unsafeDb, workspaceId);
        const jobId = await enqueueProposal(ws, rt, "lesson.cascade", { lessonId, changedFactIds });
        c.get("logger")?.info({ lessonId, jobId, facts: changedFactIds.length }, "cascade queued");
        return c.json({ jobId }, 202);
      },
    )
    .post(
      "/lessons/:id/regenerate",
      smallJsonBodyLimit(),
      requireJsonBody(),
      zValidator("param", lessonParam, validationHook),
      zValidator("json", regenerateBody, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const rt = requireRuntime(runtime);
        const lessonId = c.req.valid("param").id as LessonId;
        const body = c.req.valid("json");
        const ws = forWorkspace(unsafeDb, workspaceId);
        const jobId = await enqueueProposal(ws, rt, "lesson.regenerate", { lessonId, ...body });
        c.get("logger")?.info(
          { lessonId, jobId, targets: body.targets.length },
          "regenerate queued",
        );
        return c.json({ jobId }, 202);
      },
    );
}

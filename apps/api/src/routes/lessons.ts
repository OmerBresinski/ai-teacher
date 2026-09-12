/**
 * `POST /lessons` — a brief becomes a Lesson row and a queued `lesson.plan` job (ADR 0024 §6,
 * §13, §15, §18; F01 item 2). One call from the brief screen: the API applies the key-stage
 * defaults, mints the lesson id and the job id, inserts the lesson with
 * `generating_job_id = jobId`, enqueues the Plan job with `{ lessonId }` under that id and
 * answers `202 { lessonId, jobId }`; the client navigates to `/l/$lessonId` and follows
 * `GET /jobs/:jobId/events`.
 *
 * Order of operations: the row is written **before** the job is queued, so a worker that picks
 * the job up at once always finds a lock to clear — the reverse order could leave a lesson locked
 * for ever when the stub completes faster than the insert commits (§18). If the enqueue fails
 * after the insert, the row is removed again so no half-created lesson stays behind; `enqueue`
 * itself cancels the pg-boss job when it cannot write the `queued` event. The same request body
 * cap as `/documents` applies. Rate-limited per Workspace with the model-call limiter in `app.ts`
 * (§15). Nothing about the brief is logged — only `{ lessonId, jobId }` (ADR 0015).
 *
 * `POST /lessons/:id/cascade` and `POST /lessons/:id/regenerate` (ADR 0025 §18, §19) enqueue the
 * proposal jobs. They take **no** generating lock — the teacher keeps editing and the editor
 * applies the result as one undo transaction — so they refuse (`409 generating`) only while a
 * pipeline still holds the row. `singletonKey` `<lessonId>:<job>` with a `PROPOSAL_DEBOUNCE_S`
 * slot debounces each job per lesson: a second identical request inside the slot is `409`
 * "already queued" (as `/jobs/*`), and the editor coalesces its fact edits anyway.
 */
import { zValidator } from "@hono/zod-validator";
import {
  bindSourcesToLesson,
  createDocument,
  deleteDocument,
  forWorkspace,
  getDocument,
  type ScopableDb,
  toSourceRef,
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
import { CreateLessonSchema, type Lesson, lessonFromBrief } from "@tj/domain/documents";
import { enqueue } from "@tj/jobs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context";
import { ConflictError } from "../errors";
import type { EventsRuntime } from "../events/runtime";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";
import { documentBodyLimit, GENERATING_MESSAGE, NOT_FOUND_MESSAGE } from "./documents";
import { requireRuntime } from "./jobs";

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
): Promise<{ lessonId: LessonId; jobId: JobId }> {
  const lessonId = lesson.id as LessonId;
  const jobId = newId<JobId>();
  const distinct = [...new Set(sourceIds)];
  await ws.tx(async (scoped) => {
    const rows = await bindSourcesToLesson(scoped, distinct, lessonId);
    if (rows.length !== distinct.length) {
      throw new HTTPException(422, { message: SOURCES_UNAVAILABLE_MESSAGE });
    }
    const body: Lesson = rows.length > 0 ? { ...lesson, sources: rows.map(toSourceRef) } : lesson;
    await createDocument(scoped, "lesson", body, { id: lessonId, generatingJobId: jobId });
  });
  let queued: JobId | null;
  try {
    queued = await enqueue(
      runtime.jobs,
      "lesson.plan",
      { lessonId },
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
  return { lessonId, jobId };
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
        const lesson = lessonFromBrief(input, newId<LessonId>(), new Date());
        const ws = forWorkspace(unsafeDb, workspaceId);
        const sourceIds = input.sourceIds ?? [];
        const { lessonId, jobId } = await createLessonAndEnqueue(ws, rt, lesson, sourceIds);
        c.get("logger")?.info(
          { lessonId, jobId, sources: sourceIds.length },
          "lesson created from brief",
        );
        return c.json({ lessonId, jobId }, 202);
      },
    )
    .post(
      "/lessons/:id/cascade",
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

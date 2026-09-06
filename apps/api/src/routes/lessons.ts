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
 */
import { zValidator } from "@hono/zod-validator";
import {
  createDocument,
  deleteDocument,
  forWorkspace,
  type ScopableDb,
  type WorkspaceDb,
} from "@tj/db";
import { type JobId, type LessonId, newId } from "@tj/domain";
import {
  type CreateLesson,
  CreateLessonSchema,
  DEFAULT_THEME_ID,
  defaultDurationMin,
  deriveAgeBand,
  LESSON_TITLE_MAX,
  type Lesson,
  parseLesson,
} from "@tj/domain/documents";
import { enqueue } from "@tj/jobs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../context";
import type { EventsRuntime } from "../events/runtime";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";
import { documentBodyLimit } from "./documents";
import { requireRuntime } from "./jobs";

/**
 * The empty lesson the brief becomes: canonical Lesson fields from the request, `ageBand` derived
 * from the year group when not given, `durationMin` defaulted by key stage, `title` from the topic.
 * Pure, so the brief screen can show the same defaults the API applies.
 */
export function lessonFromBrief(input: CreateLesson, lessonId: LessonId, now: Date): Lesson {
  const ageBand = input.ageBand ?? deriveAgeBand(input.yearGroup);
  const durationMin = input.brief.durationMin ?? defaultDurationMin(ageBand);
  const at = now.toISOString();
  return parseLesson({
    version: 1,
    id: lessonId,
    title: input.brief.topic.trim().slice(0, LESSON_TITLE_MAX),
    themeId: input.themeId ?? DEFAULT_THEME_ID,
    slides: [],
    createdAt: at,
    updatedAt: at,
    subject: input.subject,
    yearGroup: input.yearGroup,
    ageBand,
    readingLevel: input.readingLevel,
    language: input.language ?? "en-GB",
    brief: { ...input.brief, durationMin },
  });
}

/**
 * Insert the locked lesson, then queue its Plan job under the pre-minted id. On an enqueue failure
 * the row is removed so the Library never shows a lesson no job will ever fill.
 */
export async function createLessonAndEnqueue(
  ws: WorkspaceDb,
  runtime: EventsRuntime,
  lesson: Lesson,
): Promise<{ lessonId: LessonId; jobId: JobId }> {
  const lessonId = lesson.id as LessonId;
  const jobId = newId<JobId>();
  await createDocument(ws, "lesson", lesson, { id: lessonId, generatingJobId: jobId });
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
    await deleteDocument(ws, lessonId).catch(() => undefined);
    throw error;
  }
  if (queued === null) {
    await deleteDocument(ws, lessonId).catch(() => undefined);
    throw new HTTPException(409, { message: "An identical job is already queued." });
  }
  return { lessonId, jobId };
}

export function lessonRoutes(unsafeDb: ScopableDb, runtime: EventsRuntime | undefined) {
  return new Hono<AppEnv>().post(
    "/lessons",
    documentBodyLimit(),
    requireJsonBody(),
    zValidator("json", CreateLessonSchema, validationHook),
    async (c) => {
      const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
      const rt = requireRuntime(runtime);
      const lesson = lessonFromBrief(c.req.valid("json"), newId<LessonId>(), new Date());
      const ws = forWorkspace(unsafeDb, workspaceId);
      const { lessonId, jobId } = await createLessonAndEnqueue(ws, rt, lesson);
      c.get("logger")?.info({ lessonId, jobId }, "lesson created from brief");
      return c.json({ lessonId, jobId }, 202);
    },
  );
}

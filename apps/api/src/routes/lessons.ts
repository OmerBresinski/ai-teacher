/**
 * `POST /lessons` — a brief becomes a Lesson row and a queued `lesson.plan` job (ADR 0024 §6,
 * §13, §15, §18; F01 item 2). One call from the brief screen: the API applies the key-stage
 * defaults, mints the lesson id, enqueues the Plan job with `{ lessonId }`, inserts the lesson with
 * `generating_job_id = jobId` and answers `202 { lessonId, jobId }`; the client navigates to
 * `/l/$lessonId` and follows `GET /jobs/:jobId/events`.
 *
 * Order of operations: `enqueue` mints the job id, and the row needs that id for its lock, so the
 * job is queued first and the row inserted second. If the insert fails the job is cancelled; if
 * that cancel also fails, the stub handler's `clearGenerating` is a no-op and the job simply
 * completes (accepted; noted in TEACH-120). The same request body cap as `/documents` applies.
 * Rate-limited per Workspace with the model-call limiter in `app.ts` (§15). Nothing about the
 * brief is logged — only `{ lessonId, jobId }` (ADR 0015).
 */
import { zValidator } from "@hono/zod-validator";
import { createDocument, forWorkspace, type ScopableDb } from "@tj/db";
import { type LessonId, newId } from "@tj/domain";
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
import { cancel, enqueue } from "@tj/jobs";
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

export function lessonRoutes(unsafeDb: ScopableDb, runtime: EventsRuntime | undefined) {
  return new Hono<AppEnv>().post(
    "/lessons",
    documentBodyLimit(),
    requireJsonBody(),
    zValidator("json", CreateLessonSchema, validationHook),
    async (c) => {
      const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
      const rt = requireRuntime(runtime);
      const lessonId = newId<LessonId>();
      const lesson = lessonFromBrief(c.req.valid("json"), lessonId, new Date());

      const jobId = await enqueue(rt.jobs, "lesson.plan", { lessonId }, { workspaceId });
      if (jobId === null) {
        throw new HTTPException(409, { message: "An identical job is already queued." });
      }
      const ws = forWorkspace(unsafeDb, workspaceId);
      try {
        await ws.tx((scoped) =>
          createDocument(scoped, "lesson", lesson, { id: lessonId, generatingJobId: jobId }),
        );
      } catch (error) {
        await cancel(rt.jobs, jobId, { name: "lesson.plan" }).catch(() => undefined);
        throw error;
      }
      c.get("logger")?.info({ lessonId, jobId }, "lesson created from brief");
      return c.json({ lessonId, jobId }, 202);
    },
  );
}

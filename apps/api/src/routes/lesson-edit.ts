/**
 * `POST /lessons/:id/edit` (TEACH-97 part d; rulings 171–173, 175, 176): edit with a prompt, fast
 * path. The editor sends the slide as it holds it now, the selected text box and the teacher's
 * instruction; one `editFast` call (gpt-6-luna, reasoning off, `@tj/generation`) rewrites that
 * box, the fit and answer-leak checks run on the result, and the answer is either the new doc for
 * the editor to apply as one undoable step, or a teacher-worded reason and no change. Nothing is
 * written here: the editor applies the edit and its autosave stores it, so Undo is the editor's
 * history. Behind the session guard and `aiLimiter` (`app.ts`), like every route that may end in a
 * model call.
 *
 * Logging (ADR 0015): `{ action, attempts, ms, check, modelId }`, never the instruction or text.
 */
import { zValidator } from "@hono/zod-validator";
import type { CreatedAi } from "@tj/ai";
import { forWorkspace, getDocument, type ScopableDb } from "@tj/db";
import { guarded, type Lesson, type Slide, SlideSchema } from "@tj/domain/documents";
import { EDIT_INSTRUCTION_MAX, EDIT_MESSAGES, EditTargetError, editFast } from "@tj/generation";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";
import { documentBodyLimit, NOT_FOUND_MESSAGE } from "./documents";

const lessonParam = z.object({ id: z.uuid() });

export const LessonEditBodySchema = z.strictObject({
  slide: SlideSchema,
  elementId: z.string().min(1).max(64),
  /** The input guard runs on the instruction before any model sees it, as on a brief. */
  instruction: guarded(z.string().trim().min(1).max(EDIT_INSTRUCTION_MAX)),
});

export function lessonEditRoutes(unsafeDb: ScopableDb, ai: CreatedAi | undefined) {
  return new Hono<AppEnv>().post(
    "/lessons/:id/edit",
    documentBodyLimit(),
    requireJsonBody(),
    zValidator("param", lessonParam, validationHook),
    zValidator("json", LessonEditBodySchema, validationHook),
    async (c) => {
      const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
      const lessonId = c.req.valid("param").id;
      const body = c.req.valid("json");
      const logger = c.get("logger");
      const row = await getDocument(forWorkspace(unsafeDb, workspaceId), lessonId as never);
      if (row === null || row.kind !== "lesson") {
        throw new HTTPException(404, { message: NOT_FOUND_MESSAGE });
      }
      const lesson = row.body as Lesson;
      const slide = body.slide as Slide;
      if (!lesson.slides.some((s) => s.id === slide.id)) {
        throw new HTTPException(404, { message: NOT_FOUND_MESSAGE });
      }
      if (ai === undefined || ai.kind === "unconfigured") {
        return c.json({ action: "failed" as const, reason: EDIT_MESSAGES.failed }, 200);
      }
      try {
        const result = await editFast(
          { lesson, slide, elementId: body.elementId, instruction: body.instruction },
          {
            ai,
            logger,
            signal: c.req.raw.signal,
            context: { lessonId, jobId: c.get("requestId") },
          },
        );
        logger.info(
          {
            action: result.action,
            attempts: result.attempts,
            ms: result.ms,
            ...(result.action === "edit"
              ? { modelId: result.modelId }
              : { check: result.check ?? null }),
          },
          "lesson edit",
        );
        if (result.action === "edit") {
          return c.json(
            { action: "edit" as const, doc: result.doc, summary: result.summary, ms: result.ms },
            200,
          );
        }
        return c.json({ action: result.action, reason: result.reason, ms: result.ms }, 200);
      } catch (error) {
        if (error instanceof EditTargetError) {
          throw new HTTPException(400, { message: "Select a text box to edit it with a prompt." });
        }
        logger.warn({ error: (error as Error).name }, "lesson edit failed");
        return c.json({ action: "failed" as const, reason: EDIT_MESSAGES.failed }, 200);
      }
    },
  );
}

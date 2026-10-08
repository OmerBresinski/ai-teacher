/**
 * `POST /lessons/:id/edit` (TEACH-97 part d; rulings 171–173, 175, 176): edit with a prompt, fast
 * path, behind the editor's chat pane. The editor sends the slide as it holds it now, the selected
 * text box (or none, for the whole slide) and the teacher's instruction. The router's rules run
 * first; a request the agent path would handle is answered in teacher words, as that path waits on
 * the saved slide spec (part c). Otherwise one `editFast` call (gpt-6-luna, reasoning off,
 * `@tj/generation`) rewrites the box or the slide's boxes, the fit and answer-leak checks run on
 * the result, and the answer is either the new docs for the editor to apply as one undoable step,
 * or a teacher-worded reason and no change. Nothing is
 * written here: the editor applies the edit and its autosave stores it, so Undo is the editor's
 * history. Behind the session guard and `aiLimiter` (`app.ts`), like every route that may end in a
 * model call.
 *
 * Streaming (TEACH-97, chat-d): a request that accepts `text/event-stream` gets the same answer
 * over SSE: `partial` events while the model writes (the summary and each box's text so far,
 * unchecked, for display only), then one `final` event with exactly the JSON answer above, after
 * every check. The editor applies only `final`. Closing the request (Stop) aborts the model call,
 * so the budget stops spending; the budget middleware reserves and settles a streamed call like a
 * generated one. The guards are the same middleware either way (`app.ts`).
 *
 * Logging (ADR 0015): `{ action, attempts, ms, check, modelId }`, never the instruction or text.
 */
import { zValidator } from "@hono/zod-validator";
import type { CreatedAi } from "@tj/ai";
import { forWorkspace, getDocument, type ScopableDb } from "@tj/db";
import { guarded, type Lesson, type Slide, SlideSchema } from "@tj/domain/documents";
import {
  AGENT_MESSAGES,
  EDIT_INSTRUCTION_MAX,
  EDIT_MESSAGES,
  type EditFastPartial,
  EditTargetError,
  editFast,
  routeEdit,
} from "@tj/generation";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AppEnv } from "../context";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";
import { documentBodyLimit, NOT_FOUND_MESSAGE } from "./documents";

const lessonParam = z.object({ id: z.uuid() });
const NO_TEXT = "There is no text to change on this slide.";

export const LessonEditBodySchema = z.strictObject({
  slide: SlideSchema,
  /** The selected text box; absent → the whole slide. */
  elementId: z.string().min(1).max(64).optional(),
  /** The input guard runs on the instruction before any model sees it, as on a brief. */
  instruction: guarded(z.string().trim().min(1).max(EDIT_INSTRUCTION_MAX)),
  /** The thread's last 3 turns, oldest first, for follow-ups ("a bit more"). */
  history: z
    .array(
      z.strictObject({
        instruction: guarded(z.string().trim().min(1).max(EDIT_INSTRUCTION_MAX)),
        /** The reply the teacher saw: model-facing, so guarded like the instruction. */
        summary: guarded(z.string().max(300)),
        slides: z.array(z.string().regex(/^s\d{1,3}$/)).max(40),
      }),
    )
    .max(3)
    .optional(),
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
      const run = async (
        signal: AbortSignal,
        onPartial?: (partial: EditFastPartial) => void,
      ): Promise<Record<string, unknown>> => {
        // The router's rules (code, no model). The agent path waits on part c (the saved slide
        // spec), so a request that needs it is answered now, in teacher words, with no change.
        const route = routeEdit(body.elementId ? "element" : "slide", body.instruction);
        if (route.path === "agent") {
          logger.info({ action: "escalate", check: `route:${route.need}`, ms: 0 }, "lesson edit");
          return {
            action: "escalate" as const,
            reason: AGENT_MESSAGES[route.need],
            need: route.need,
            ms: 0,
          };
        }
        if (ai === undefined || ai.kind === "unconfigured") {
          return { action: "failed" as const, reason: EDIT_MESSAGES.failed };
        }
        try {
          const result = await editFast(
            {
              lesson,
              slide,
              elementId: body.elementId,
              instruction: body.instruction,
              history: body.history,
            },
            {
              ai,
              logger,
              signal,
              context: { lessonId, jobId: c.get("requestId") },
              onPartial,
            },
          );
          logger.info(
            {
              action: result.action,
              attempts: result.attempts,
              ms: result.ms,
              streamed: onPartial !== undefined,
              ...(result.action === "edit"
                ? { modelId: result.modelId }
                : { check: result.check ?? null }),
            },
            "lesson edit",
          );
          if (result.action === "edit") {
            return {
              action: "edit" as const,
              changes: result.changes.map((x) => ({ elementId: x.elementId, doc: x.doc })),
              summary: result.summary,
              ms: result.ms,
            };
          }
          return {
            action: result.action,
            reason: result.reason,
            ms: result.ms,
            ...(result.action !== "no-change" && result.check ? { check: result.check } : {}),
            ...(result.action === "refuse" && result.offer ? { offer: result.offer } : {}),
          };
        } catch (error) {
          if (error instanceof EditTargetError) {
            if (onPartial) return { action: "refuse" as const, reason: NO_TEXT };
            throw new HTTPException(400, { message: NO_TEXT });
          }
          if (signal.aborted) logger.info({ action: "stopped" }, "lesson edit");
          else logger.warn({ error: (error as Error).name }, "lesson edit failed");
          return { action: "failed" as const, reason: EDIT_MESSAGES.failed };
        }
      };

      if (!(c.req.header("accept") ?? "").includes("text/event-stream")) {
        return c.json(await run(c.req.raw.signal), 200);
      }
      return streamSSE(c, async (stream) => {
        // Stop closes the request: the model call is aborted and nothing more is spent.
        const stop = new AbortController();
        stream.onAbort(() => stop.abort());
        const signal = AbortSignal.any([c.req.raw.signal, stop.signal]);
        let last = "";
        const answer = await run(signal, (partial) => {
          const data = JSON.stringify(partial);
          if (data === last || stream.aborted) return;
          last = data;
          void stream.writeSSE({ event: "partial", data });
        });
        if (!stream.aborted)
          await stream.writeSSE({ event: "final", data: JSON.stringify(answer) });
      });
    },
  );
}

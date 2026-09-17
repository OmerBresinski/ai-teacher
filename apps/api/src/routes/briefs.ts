/**
 * `POST /briefs/parse` (ADR 0029 item 13; TEACH-16): the website's free-text box becomes brief
 * fields for the intake form. Rules first, then one `small` model call for what is still blank,
 * under a 2 s deadline; every string the model returns is guarded; a model failure of any kind is
 * still a 200 with the rules' result. Stateless — no document row, no job, nothing persisted —
 * and behind the session guard and `aiLimiter` (`app.ts`), like every route that may end in a
 * model call. The model call inside the request follows ADR 0027 §1.
 *
 * Logging (ADR 0015): `{ rules, model, dropped, ms }` — counts, booleans and milliseconds; never
 * the text or a parsed field.
 */
import { zValidator } from "@hono/zod-validator";
import type { CreatedAi } from "@tj/ai";
import { BRIEF_TOPIC_MAX, guarded } from "@tj/domain/documents";
import { parseBrief } from "@tj/generation";
import { Hono } from "hono";
import { z } from "zod";
import { smallJsonBodyLimit } from "../body-limits";
import type { AppEnv } from "../context";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";

/** The input guard runs on the text before any model sees it, as on `Brief.topic`. */
export const ParseBriefBodySchema = z.strictObject({
  text: guarded(z.string().min(1).max(BRIEF_TOPIC_MAX)),
  /** The year groups the form offers, so the answer is one the form can show. */
  yearGroups: z.array(z.string().max(40)).max(20).optional(),
});

export function briefRoutes(ai: CreatedAi | undefined) {
  return new Hono<AppEnv>().post(
    "/briefs/parse",
    smallJsonBodyLimit(),
    requireJsonBody(),
    zValidator("json", ParseBriefBodySchema, validationHook),
    async (c) => {
      // Authenticated only: the dev header shim sets `workspaceId` but no `user`.
      getWorkspaceId(c, { allowHeaderShim: false });
      const body = c.req.valid("json");
      const logger = c.get("logger");
      const start = performance.now();
      const { rules, dropped, usedModel, ...fields } = await parseBrief(body, {
        ai,
        logger,
        signal: c.req.raw.signal,
        context: { lessonId: "", jobId: c.get("requestId") },
      });
      logger.info(
        { rules, model: usedModel, dropped, ms: Math.round(performance.now() - start) },
        "brief parsed",
      );
      return c.json(fields, 200);
    },
  );
}

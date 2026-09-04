/**
 * `/me` routes are protected by `requireSession` (app.ts). The greeting is one bounded small-model
 * call, so it runs inline rather than adding an ADR 0006 job/SSE round trip for a page subtitle.
 */
import { zValidator } from "@hono/zod-validator";
import type { CreatedAi } from "@tj/ai";
import { FALLBACK_GREETING, GreetingQuerySchema, type GreetingResponse } from "@tj/domain";
import { generateText } from "ai";
import { Hono } from "hono";
import { UNAUTHORIZED_MESSAGE } from "../auth/require-session";
import type { AppEnv } from "../context";
import { errorResponse } from "../errors";
import {
  buildGreetingPrompt,
  firstNameOf,
  GREETING_SYSTEM_PROMPT,
  sanitiseGreeting,
} from "../greeting/prompt";
import { validationHook } from "../validation";

export function meRoutes(ai: CreatedAi | undefined) {
  return new Hono<AppEnv>()
    .get("/me", (c) => {
      const user = c.get("user");
      const workspaceId = c.get("workspaceId");
      // `requireSession` always sets both; the guard keeps the route safe if it is ever mounted bare.
      if (!user || !workspaceId) {
        return errorResponse(c, 401, "unauthorized", UNAUTHORIZED_MESSAGE, false);
      }
      return c.json(
        { user: { id: user.id, email: user.email, name: user.name }, workspaceId: workspaceId },
        200,
      );
    })
    .get("/me/greeting", zValidator("query", GreetingQuerySchema, validationHook), async (c) => {
      const { weekday } = c.req.valid("query");
      const fallback = { text: FALLBACK_GREETING, source: "fallback" as const };
      c.header("cache-control", "private, no-store");
      if (!ai || ai.kind === "unconfigured") return c.json(fallback, 200);

      try {
        const result = await generateText({
          model: ai.model("small"),
          system: GREETING_SYSTEM_PROMPT,
          prompt: buildGreetingPrompt({ firstName: firstNameOf(c.get("user")?.name), weekday }),
          maxOutputTokens: 40,
          temperature: 0.9,
          abortSignal: c.req.raw.signal,
        });
        const text = sanitiseGreeting(result.text);
        if (!text) return c.json(fallback, 200);
        return c.json({ text, source: "model" as const } satisfies GreetingResponse, 200);
      } catch (error) {
        if (c.req.raw.signal.aborted) throw error;
        // Provider failures retain a diagnostic message, so log only the safe fallback classification.
        c.get("logger").warn({ greeting: "fallback" }, "greeting model call failed");
        return c.json(fallback, 200);
      }
    });
}

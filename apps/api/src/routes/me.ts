/**
 * `/me` routes are protected by `requireSession` (app.ts). The greeting (a programming-in-2026 dad
 * joke) is one bounded small-model call, so it runs inline rather than adding an ADR 0006 job/SSE
 * round trip for a page subtitle. Every call produces a fresh joke; the web caches it per sign-in
 * and the refresh button re-requests it.
 */
import { type CreatedAi, isAiError, ProviderFailure } from "@tj/ai";
import { FALLBACK_GREETING, type GreetingResponse } from "@tj/domain";
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
    .get("/me/greeting", async (c) => {
      c.header("cache-control", "private, no-store");
      const fallback = { text: FALLBACK_GREETING, source: "fallback" as const };
      if (!ai || ai.kind === "unconfigured") return c.json(fallback, 200);

      try {
        const result = await generateText({
          model: ai.model("small"),
          system: GREETING_SYSTEM_PROMPT,
          prompt: buildGreetingPrompt({ firstName: firstNameOf(c.get("user")?.name) }),
          maxOutputTokens: 60,
          temperature: 0.9,
          abortSignal: c.req.raw.signal,
        });
        const text = sanitiseGreeting(result.text);
        if (!text) return c.json(fallback, 200);
        return c.json({ text, source: "model" as const } satisfies GreetingResponse, 200);
      } catch (error) {
        if (c.req.raw.signal.aborted) throw error;
        // ADR 0015: never serialise the error itself — `ProviderFailure.message` carries the
        // provider's diagnostic text. Log only primitive, content-free metadata.
        const failure = isAiError(error) ? error.cause : undefined;
        c.get("logger").warn(
          {
            greeting: "fallback",
            aiErrorCode: isAiError(error) ? error.code : undefined,
            providerStatusCode: failure instanceof ProviderFailure ? failure.statusCode : undefined,
            providerRetryable: failure instanceof ProviderFailure ? failure.isRetryable : undefined,
          },
          "greeting model call failed",
        );
        return c.json(fallback, 200);
      }
    });
}

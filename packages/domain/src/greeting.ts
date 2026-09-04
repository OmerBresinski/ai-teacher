import { z } from "zod";

export const GreetingSourceSchema = z.enum(["model", "fallback"]);
export const GreetingResponseSchema = z.object({
  text: z.string().min(1).max(160),
  source: GreetingSourceSchema,
});
export type GreetingResponse = z.infer<typeof GreetingResponseSchema>;

/** Shown when the model is unavailable or returns nothing usable. Same string in api and web. */
export const FALLBACK_GREETING =
  "In 2026 I asked my AI to fix one bug. It fixed three and filed a ticket against me.";
export const GREETING_MAX_CHARS = 160;

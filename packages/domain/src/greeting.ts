import { z } from "zod";

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const GreetingQuerySchema = z.object({ weekday: WeekdaySchema.optional() });

export const GreetingSourceSchema = z.enum(["model", "fallback"]);
export const GreetingResponseSchema = z.object({
  text: z.string().min(1).max(160),
  source: GreetingSourceSchema,
});
export type GreetingResponse = z.infer<typeof GreetingResponseSchema>;

/** Shown when the model is unavailable or returns nothing usable. Same string in api and web. */
export const FALLBACK_GREETING = "Good to see you. Your next lesson is waiting to be planned.";
export const GREETING_MAX_CHARS = 160;

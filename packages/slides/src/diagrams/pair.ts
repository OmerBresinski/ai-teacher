import { z } from "zod";
/**
 * r5: a fixed-length pair. The wire is JSON schema for OpenAI, which refuses tuples (`items: [a, b]`,
 * the round 4 400 that failed every particles spec), so a pair is an array of exactly two at
 * runtime; its type stays the tuple the drawers destructure.
 */
export const pair = <T extends z.ZodType>(t: T) =>
  z.array(t).length(2) as unknown as z.ZodTuple<[T, T], null>;

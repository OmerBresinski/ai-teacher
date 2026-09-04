/**
 * Shared `@hono/zod-validator` hook: instead of the validator's default 400 body (a raw Zod
 * result), throw a `ValidationError` so `app.onError` renders the standard envelope with
 * `code: "validation_failed"` and `fields`. Pass it as the third argument of every `zValidator`:
 *
 * ```ts
 * .get("/hello", zValidator("query", schema, validationHook), (c) => …)
 * ```
 *
 * The hook returns `void`, so it does not add a 400 variant to the RPC response type.
 */
import type { $ZodError } from "zod/v4/core";
import { ValidationError } from "./errors";

export function validationHook(result: { success: boolean; error?: $ZodError }): void {
  if (result.success) return;
  const fields = new Set<string>();
  for (const issue of result.error?.issues ?? []) fields.add(String(issue.path[0] ?? "(root)"));
  throw new ValidationError([...fields]);
}

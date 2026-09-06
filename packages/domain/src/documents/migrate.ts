import type { z } from "zod";

/*
 * Version migrations and the shared parse-error message (ADR 0021 §3). Behavioural reference:
 * TeachDeck `lib/model/schema.ts:480-554`. The error copy is verbatim: a TeachDeck file and a
 * product file are the same document.
 */

/** Current document version. Bump alongside a new `migrate` branch. */
export const CURRENT_VERSION = 1;

/**
 * Version migrations. v1 is the only shape that has ever shipped, so this is a pass-through;
 * add a branch per old version as the model moves on, each one upgrading to the next version
 * rather than straight to the latest.
 */
export function migrate(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const doc = json as { version?: unknown };
  switch (doc.version) {
    case undefined:
      // Pre-versioned exports never shipped; assume the current shape.
      return { ...doc, version: CURRENT_VERSION };
    case 1:
      return doc;
    default:
      throw new Error(
        `This file was made with a newer version of TeachDeck (document version ${String(doc.version)}).`,
      );
  }
}

/** Human-readable message naming the first three problems. */
export function describeIssues(error: z.ZodError, what: string): string {
  const issues = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  const more = error.issues.length > 3 ? ` (+${error.issues.length - 3} more)` : "";
  return `This file is not a valid TeachDeck ${what}. ${issues.join("; ")}${more}`;
}

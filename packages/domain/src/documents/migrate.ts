import type { z } from "zod";

/**
 * Thrown by `migrate()` and by `parseLesson` / `parseWorksheet` / `parseSeries` when the input is
 * not a document this build can read. A named class so a caller (the API's `POST`/`PUT
 * /documents`) can turn it into a 422 without matching on the message; the message is the
 * TeachDeck copy, safe to show to the teacher.
 */
export class DocumentParseError extends Error {
  override readonly name = "DocumentParseError";
}

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
      return migrateMisconceptions(doc);
    default:
      throw new DocumentParseError(
        `This file was made with a newer version of TeachDeck (document version ${String(doc.version)}).`,
      );
  }
}

/**
 * `Misconception` was `{ id, text }` until Generation quality (TEACH-209) made it
 * `{ id, belief, correction, objectiveRefs }`. No stored lesson had a non-empty list (the
 * production lessons and every fixture carried `misconceptions: []`), so the document version does
 * not bump; this maps the old shape if one ever turns up. Byte-identical for anything else.
 */
function migrateMisconceptions(doc: Record<string, unknown>): unknown {
  const facts = doc.facts;
  if (!facts || typeof facts !== "object") return doc;
  const list = (facts as { misconceptions?: unknown }).misconceptions;
  if (!Array.isArray(list)) return doc;
  const old = (m: unknown): m is { id: unknown; text: string } =>
    !!m && typeof m === "object" && typeof (m as { text?: unknown }).text === "string";
  if (!list.some(old)) return doc;
  return {
    ...doc,
    facts: {
      ...facts,
      misconceptions: list.map((m) =>
        old(m) ? { id: m.id, belief: m.text, correction: "", objectiveRefs: [] } : m,
      ),
    },
  };
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

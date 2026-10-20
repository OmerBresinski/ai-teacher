/**
 * Pipeline events from the worker's structured log lines (ADR 0041, `docs/observability.md`).
 * Every lesson-pipeline fact the logs already carry (writer `ev` lines, stage timeline, fact check,
 * pictures, repairs, splits, budget stops, job lifecycle) becomes a `gen_*` PostHog event, with
 * only metadata kept: numbers, booleans and identifier-shaped strings (no spaces, at most 64
 * characters), and never a key that can hold content.
 */

/** Keys whose values can be lesson text, prompts or model output: never sent, whatever their shape. */
const CONTENT_KEYS = new Set([
  "alt",
  "answer",
  "answers",
  "body",
  "brief",
  "caption",
  "completion",
  "content",
  "doc",
  "err",
  "error",
  "fix",
  "heading",
  "input",
  "instructions",
  "label",
  "message",
  "messages",
  "missing",
  "msg",
  "name",
  "notes",
  "output",
  "prompt",
  "query",
  "queries",
  "question",
  "stem",
  "subject",
  "system",
  "text",
  "title",
  "topic",
  "user",
  "value",
  "where",
  "words",
]);
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
/** An identifier, a code or an ISO time: no spaces, so never a sentence of lesson text. */
const TOKEN = /^[A-Za-z0-9_.:/+@-]{1,64}$/;
const MAX_ARRAY = 20;
const MAX_DEPTH = 2;

type Scalar = string | number | boolean | null;

function scalar(value: unknown): Scalar | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return TOKEN.test(value) ? value : undefined;
  return undefined;
}

function isContentKey(key: string): boolean {
  return CONTENT_KEYS.has(key.toLowerCase());
}

/**
 * The metadata of a log record, flattened: `{ images: { placed: 2 } }` → `images_placed: 2`.
 * Drops content keys, prose strings, objects past two levels and arrays of non-scalars.
 */
export function metadataOf(
  record: Record<string, unknown>,
  prefix = "",
  depth = 0,
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(record)) {
    if (!KEY.test(key)) continue;
    // A number or a boolean cannot carry content, whatever its key (`byField: { answer: 2 }`).
    if (isContentKey(key) && typeof value !== "number" && typeof value !== "boolean") continue;
    const name = prefix ? `${prefix}_${key}` : key;
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY).map(scalar);
      if (items.every((v) => v !== undefined)) out[name] = items;
      else out[`${name}_count`] = value.length;
      continue;
    }
    if (value && typeof value === "object") {
      if (depth < MAX_DEPTH) metadataOf(value as Record<string, unknown>, name, depth + 1, out);
      continue;
    }
    const v = scalar(value);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** `picture-outcome` → `gen_picture_outcome`. */
export function eventNameOf(ev: string): string | undefined {
  const name = ev
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return name && name.length <= 48 ? `gen_${name}` : undefined;
}

/** Log messages without an `ev` that are pipeline or job facts, and the event and status they become. */
export const MESSAGE_EVENTS: Record<string, { event: string; status?: string }> = {
  "job started": { event: "gen_job", status: "started" },
  "job completed": { event: "gen_job", status: "completed" },
  "job cancelled": { event: "gen_job", status: "cancelled" },
  "job failed; pg-boss will retry": { event: "gen_job", status: "retry" },
  "job failed (non-retryable)": { event: "gen_job", status: "failed" },
  "job failed; no attempts left": { event: "gen_job", status: "failed" },
  "job already terminal, skipping": { event: "gen_job", status: "skipped" },
  "generating lock kept for the retry": { event: "gen_job", status: "lock_kept" },
  "illustrate budget stop": { event: "gen_budget_stop" },
  "lesson cost above target": { event: "gen_cost_over_target" },
  "lesson brief rejected by the input check": { event: "gen_input_rejected" },
  "source unavailable": { event: "gen_source_unavailable" },
  "input checked": { event: "gen_input_checked" },
  "plan call": { event: "gen_plan_call" },
};

/** Log lines that are already their own event elsewhere (`$ai_generation`, `gen_lesson`). */
export const SKIPPED_MESSAGES = new Set(["generation summary"]);

/** Child-logger bindings worth keeping on every event (never content). */
export const BINDING_KEYS = ["job", "attempt", "resumed", "usagePriorUsd"] as const;

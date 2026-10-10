/** Finite diagnostics only: error messages, stacks, causes and custom fields may contain content. */
const ERROR_TYPES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "TimeoutError",
  "DrizzleQueryError",
  "PostgresError",
  "ZodError",
  "HTTPException",
  "AiError",
  "AI_APICallError",
  "AI_NoObjectGeneratedError",
  "ExtractError",
  "StageFailure",
  "InputRejected",
  "SourceUnavailable",
  "BudgetExceeded",
  "NonRetryableError",
  "ResendSendError",
  "UnknownError",
]);
const ERROR_CODES = new Set([
  "22021",
  "22P05",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "53300",
  "57014",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOENT",
  "EACCES",
  "unconfigured",
  "provider",
  "invalid_model",
  "moderated",
]);

export interface SafeError {
  type: string;
  code?: string;
}

/** Never recurse into a cause or coerce a thrown value. Also safe for repeated serialization. */
export function safeError(error: unknown): SafeError {
  try {
    if (typeof error !== "object" || error === null) return { type: "UnknownError" };
    const value = error as Record<string, unknown>;
    const name = value.name ?? value.type;
    const type = typeof name === "string" && ERROR_TYPES.has(name) ? name : "UnknownError";
    const code = value.code;
    return typeof code === "string" && ERROR_CODES.has(code) ? { type, code } : { type };
  } catch {
    // A hostile getter/proxy must not turn error reporting into another failure.
    return { type: "UnknownError" };
  }
}

/** Where a failure was thrown, for the logs: never a value the code was handling. */
export interface SafeErrorWhere {
  /** The engine's own words for a code fault (TypeError, RangeError, ReferenceError), data masked. */
  message?: string;
  /** The stack's frames, function and file:line:col, paths from `packages/` or `apps/` on. */
  stack?: string[];
}

const CODE_FAULTS = new Set(["TypeError", "RangeError", "ReferenceError"]);
const MAX_FRAMES = 12;

/** A code fault's message with anything that could carry data masked (URLs, emails, tokens, numbers). */
const maskMessage = (m: string) =>
  m
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\S+@\S+/g, "<email>")
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "<token>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300);

/** One stack frame, from the repo's own `packages/` or `apps/` on; anything else kept by file name. */
const frame = (line: string) =>
  line
    .trim()
    .replace(/^at\s+/, "")
    .replace(/(?:file:\/\/)?\/[^\s()]*?\/((?:packages|apps)\/[^\s()]+)/g, "$1")
    .replace(/(?:file:\/\/)?\/[^\s()]*\/(node_modules\/[^\s()]+)/g, "$1")
    .replace(/(?:file:\/\/)?\/(?:[^\s()/]+\/)+([^\s()/]+:\d+:\d+)/g, "$1")
    .slice(0, 200);

/**
 * Where an error was thrown (TEACH-312 part g): a generation stage failure that logs only its
 * type cannot be placed. The message is read only for a code fault, whose words are the engine's
 * (masked as above); the frames are code locations. Never throws.
 */
export function safeErrorWhere(error: unknown): SafeErrorWhere {
  try {
    if (!(error instanceof Error)) return {};
    const out: SafeErrorWhere = {};
    if (CODE_FAULTS.has(error.name) && typeof error.message === "string")
      out.message = maskMessage(error.message);
    const raw = typeof error.stack === "string" ? error.stack : "";
    const frames = raw
      .split("\n")
      .filter((l) => /^\s+at\s/.test(l))
      .slice(0, MAX_FRAMES)
      .map(frame);
    if (frames.length) out.stack = frames;
    return out;
  } catch {
    return {};
  }
}

/** Project before logging as well as in serializers: Pino otherwise copies err.message to msg. */
export function safeErrorLogRecord(value: unknown): unknown {
  if (value instanceof Error) return { err: safeError(value) };
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (!("err" in record) && !("error" in record)) return value;
  return {
    ...record,
    ...("err" in record ? { err: safeError(record.err) } : {}),
    ...("error" in record ? { error: safeError(record.error) } : {}),
  };
}

export const JOB_FAILURE_MESSAGE = "Something went wrong while running this job. Please try again.";

const ISSUE_CODES = new Set([
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
]);

/** Zod paths, messages, keys and custom params can all contain model/user-authored strings. */
export function safeValidationIssues(issues: readonly { code?: unknown }[]): string[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const code =
      typeof issue.code === "string" && ISSUE_CODES.has(issue.code) ? issue.code : "unknown";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => `${code}: ${count}`);
}

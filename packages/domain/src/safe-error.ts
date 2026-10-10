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
  /**
   * A code fault's message, only when it is one of the engine's known templates, rebuilt from
   * code identifiers alone; any other message is `<unrecognised>`.
   */
  message?: string;
  /** The stack's frames, function and file:line:col, paths from `packages/` or `apps/` on. */
  stack?: string[];
}

const CODE_FAULTS = new Set(["TypeError", "RangeError", "ReferenceError"]);
const MAX_FRAMES = 12;
export const UNRECOGNISED = "<unrecognised>";

/**
 * A code expression as the engine quotes it: identifier characters only, no literal and no space,
 * except Bun's own `(void 0)` for a compiled `undefined`.
 */
const ID = String.raw`(?:\(void 0\)|[A-Za-z0-9_$.?()[\]{}])+`;
/**
 * The engine fault templates kept (Bun/JSC and V8), each rebuilt from its captured identifiers so
 * nothing outside the template reaches the log. A template that matches only a prefix ("x is not a
 * function. (In 'x(\"…\")', …)") keeps the prefix.
 */
const TEMPLATES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    new RegExp(String.raw`^(undefined|null) is not an object \(evaluating '(${ID})'\)$`),
    (m) => `${m[1]} is not an object (evaluating '${m[2]}')`,
  ],
  [
    new RegExp(String.raw`^Cannot read properties of (undefined|null) \(reading '(${ID})'\)$`),
    (m) => `Cannot read properties of ${m[1]} (reading '${m[2]}')`,
  ],
  [
    new RegExp(String.raw`^(${ID}) is not a function(?=$|[.\s])`),
    (m) => `${m[1]} is not a function`,
  ],
  [new RegExp(String.raw`^(${ID}) is not iterable(?=$|[.\s])`), (m) => `${m[1]} is not iterable`],
  [
    new RegExp(String.raw`^Cannot access '(${ID})' before initialization\.?$`),
    (m) => `Cannot access '${m[1]}' before initialization`,
  ],
  [new RegExp(String.raw`^(${ID}) is not defined$`), (m) => `${m[1]} is not defined`],
  [new RegExp(String.raw`^Can't find variable: (${ID})$`), (m) => `Can't find variable: ${m[1]}`],
  [/^Maximum call stack size exceeded\.?$/, () => "Maximum call stack size exceeded"],
  [/^Invalid array length$/, () => "Invalid array length"],
];

const knownMessage = (m: string): string => {
  for (const [re, out] of TEMPLATES) {
    const hit = m.length <= 400 ? m.match(re) : null;
    if (hit) return hit.slice(1).some((g) => (g ?? "").length > 120) ? UNRECOGNISED : out(hit);
  }
  return UNRECOGNISED;
};

/** One stack frame line, strictly: `at [async|new] [name (]path:line:col[)]`; anything else is dropped. */
const FRAME =
  /^\s+at (?:(?:async |new )?([A-Za-z0-9_$.<>[\]]{1,120}) \()?((?:file:\/\/)?[A-Za-z0-9_./@+-]{1,400}):(\d{1,7}):(\d{1,7})(\))?$/;

/** The frame's path from the repo's own `packages/`, `apps/` or `node_modules/` on, else its file name. */
const shortPath = (p: string) => {
  const repo = p.match(/(?:^|\/)((?:packages|apps|node_modules)\/.+)$/);
  return repo?.[1] ?? p.split("/").pop() ?? p;
};

const frameOf = (line: string): string | undefined => {
  const m = line.match(FRAME);
  if (!m || (m[1] !== undefined) !== (m[5] !== undefined)) return undefined;
  const at = `${shortPath(m[2] ?? "")}:${m[3]}:${m[4]}`;
  return m[1] ? `${m[1]} (${at})` : at;
};

/**
 * Where an error was thrown (TEACH-312 part g): a generation stage failure that logs only its
 * type cannot be placed. The message is kept only for a code fault in a known engine template
 * (rebuilt from identifiers); the frames are read only after the stack's `name: message` header and
 * only in the strict frame shape. Never throws.
 */
export function safeErrorWhere(error: unknown): SafeErrorWhere {
  try {
    if (!(error instanceof Error)) return {};
    const out: SafeErrorWhere = {};
    const message = typeof error.message === "string" ? error.message : "";
    if (CODE_FAULTS.has(error.name)) out.message = knownMessage(message);
    const raw = typeof error.stack === "string" ? error.stack : "";
    // The header is `name: message` (or `name`), however many lines the message runs to; a stack
    // that does not start with it is not read.
    const header = message ? `${error.name}: ${message}` : error.name;
    if (!raw.startsWith(header)) return out;
    const frames = raw
      .slice(header.length)
      .split("\n")
      .slice(1)
      .map(frameOf)
      .filter((f): f is string => f !== undefined)
      .slice(0, MAX_FRAMES);
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

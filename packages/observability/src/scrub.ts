import { safeError, safeErrorWhere } from "@tj/domain";

/**
 * What an error may tell PostHog (ADR 0041): its type, a message only when our own code wrote it,
 * and its stack frames. Error messages from libraries, providers and the database can quote prompt
 * text, model output, SQL parameters or a request URL, so they never leave the process.
 */

/** Error classes whose messages are written by this repo's code (fixed strings or identifiers). */
const OWN_MESSAGE_TYPES = new Set([
  "StageFailure",
  "NonRetryableError",
  "InputRejected",
  "SourceUnavailable",
  "BudgetExceeded",
  "BudgetReservationError",
  "UnestimableCallError",
  "AiError",
  "AbortError",
  "TimeoutError",
]);
const CODE_FAULTS = new Set(["TypeError", "RangeError", "ReferenceError"]);
export const UNRECOGNISED_MESSAGE = "<unrecognised>";
const MAX_MESSAGE = 300;
const MAX_FRAMES = 30;
const MAX_CAUSES = 3;

/**
 * Secrets and token-shaped strings, replaced before a message leaves the process. Applied to our
 * own messages too: a message built from an identifier could still carry a URL or a key.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  // URLs: keep scheme, host and path; drop credentials, query and fragment (tokens live there).
  [
    /\b([a-z][a-z0-9+.-]{1,20}):\/\/(?:[^\s/@]*@)?([^\s/?#]+)([^\s?#]*)(?:\?[^\s#]*)?(?:#\S*)?/gi,
    "$1://$2$3",
  ],
  [/\bBearer\s+\S+/gi, "Bearer [redacted]"],
  [/\b(phc|phx|sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/g, "[redacted-key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]"],
  [/\b(api[_-]?key|token|secret|password|signature|key)=([^\s&]+)/gi, "$1=[redacted]"],
  // Long opaque strings (JWTs, hex or base64 tokens, signed-URL signatures).
  [/[A-Za-z0-9+/=_.-]{32,}/g, "[redacted]"],
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}…` : out;
}

/** The message PostHog may see: ours (scrubbed), a known engine fault, or `<unrecognised>`. */
export function safeMessage(error: unknown): string {
  try {
    if (!(error instanceof Error)) return UNRECOGNISED_MESSAGE;
    const type = safeError(error).type;
    if (OWN_MESSAGE_TYPES.has(type) && typeof error.message === "string") {
      return scrubSecrets(error.message);
    }
    if (CODE_FAULTS.has(error.name)) return safeErrorWhere(error).message ?? UNRECOGNISED_MESSAGE;
    return UNRECOGNISED_MESSAGE;
  } catch {
    return UNRECOGNISED_MESSAGE;
  }
}

/** One strict stack frame: `at [async|new] [name (]path:line:col[)]`; anything else is dropped. */
const FRAME =
  /^\s+at (?:(?:async |new )?([A-Za-z0-9_$.<>[\]]{1,120}) \()?((?:file:\/\/)?[A-Za-z0-9_./@+-]{1,400}):(\d{1,7}):(\d{1,7})(\))?$/;

/** A frame's path from the repo's own `packages/`, `apps/` or `node_modules/` on, else its file name. */
function shortPath(path: string): string {
  const repo = path.match(/(?:^|\/)((?:packages|apps|node_modules)\/.+)$/);
  return repo?.[1] ?? path.split("/").pop() ?? path;
}

/**
 * The stack's frames, re-rendered from the strict shape only. The message is cut off first (it
 * can span lines and is not ours to send), whatever header the engine wrote in front of it.
 */
export function safeFrames(error: Error): string[] {
  try {
    let raw = typeof error.stack === "string" ? error.stack : "";
    const message = typeof error.message === "string" ? error.message : "";
    if (message) {
      const at = raw.indexOf(message);
      if (at !== -1) raw = raw.slice(at + message.length);
    }
    const frames: string[] = [];
    for (const line of raw.split("\n")) {
      const m = line.match(FRAME);
      if (!m || (m[1] !== undefined) !== (m[5] !== undefined)) continue;
      const where = `${shortPath(m[2] ?? "")}:${m[3]}:${m[4]}`;
      frames.push(m[1] ? `    at ${m[1]} (${where})` : `    at ${where}`);
      if (frames.length >= MAX_FRAMES) break;
    }
    return frames;
  } catch {
    return [];
  }
}

/**
 * A stand-in for `error` that carries only the safe type, message and frames (and the same for up
 * to three causes), so the PostHog client's own exception parser never reads the original.
 */
export function sanitizeError(error: unknown, depth = 0): Error {
  const type = safeError(error).type;
  const message = safeMessage(error);
  const frames = error instanceof Error ? safeFrames(error) : [];
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const clean = new Error(
    message,
    cause !== undefined && cause !== null && depth < MAX_CAUSES
      ? { cause: sanitizeError(cause, depth + 1) }
      : undefined,
  );
  clean.name = type;
  clean.stack = [`${type}: ${message}`, ...frames].join("\n");
  return clean;
}

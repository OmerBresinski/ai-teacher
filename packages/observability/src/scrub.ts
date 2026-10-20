import { safeError } from "@tj/domain";

/**
 * What an error may tell PostHog (ADR 0041): its type and its stack frames, never a message. Error
 * messages from libraries, providers and the database can quote prompt text, model output, SQL
 * parameters or a request URL, and even our own can carry a model id or a value, so none leaves the
 * process.
 */

const MAX_FRAMES = 30;
const MAX_CAUSES = 3;

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
 * A stand-in for `error` that carries only its type and its stack frames (and the same for up to
 * three causes), so the PostHog client's own exception parser never reads the original. No message
 * is sent, not even our own (ADR 0041): the type, `errorCode` and the frames place a failure, and a
 * model id an `AiError` names goes as its own enum-checked property (`modelIdIn`).
 */
export function sanitizeError(error: unknown, depth = 0): Error {
  const type = safeError(error).type;
  const frames = error instanceof Error ? safeFrames(error) : [];
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const clean = new Error(
    type,
    cause !== undefined && cause !== null && depth < MAX_CAUSES
      ? { cause: sanitizeError(cause, depth + 1) }
      : undefined,
  );
  clean.name = type;
  clean.stack = [`${type}: ${type}`, ...frames].join("\n");
  return clean;
}

/** The first allowed model id any message in the cause chain names (`AiError` text), or none. */
export function modelIdIn(error: unknown, models: ReadonlySet<string>): string | undefined {
  let e: unknown = error;
  for (let i = 0; i < 5 && e instanceof Error; i++) {
    const message = typeof e.message === "string" ? e.message : "";
    for (const id of models) if (message.includes(id)) return id;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

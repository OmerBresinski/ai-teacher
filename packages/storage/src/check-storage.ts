import { redactSecrets, type StorageAdapter } from "@tj/domain";

/**
 * The reserved workspace the boot check writes under (25 Oct 2026 incident: a reset bucket secret
 * went unnoticed until a lesson paid for pictures it could not save). A valid object key, so
 * storage needs no new key rule; no row in `workspaces` has this id.
 */
export const STORAGE_CHECK_WORKSPACE_ID = "0b0b0000-0000-4000-8000-0000000c4ec0";
export const STORAGE_CHECK_PREFIX = `${STORAGE_CHECK_WORKSPACE_ID}/storage-check`;
/** A probe that has not answered by then has failed (a hung endpoint must not hold the boot). */
export const STORAGE_CHECK_TIMEOUT_MS = 10_000;
const MESSAGE_MAX = 300;

export type StorageCheck =
  | { ok: true; ms: number }
  | {
      ok: false;
      ms: number;
      /** The call that failed: a write proves the credentials sign, so it goes first. */
      step: "put" | "delete";
      /** The S3 error code (`SignatureDoesNotMatch`, `AccessDenied`, `NoSuchBucket`) or `timeout`. */
      code?: string;
      status?: number;
      /** The provider's message with keys, tokens and URL query strings removed. */
      message?: string;
    };

const IDENT = /^[A-Za-z0-9_.:-]{1,64}$/;
const identOf = (v: unknown) => (typeof v === "string" && IDENT.test(v) ? v : undefined);

/** The first code and HTTP status down the cause chain, and the innermost message, redacted. */
function describe(error: unknown) {
  let code: string | undefined;
  let status: number | undefined;
  let message: string | undefined;
  let cur: unknown = error;
  for (let depth = 0; depth < 6 && cur && typeof cur === "object"; depth++) {
    const e = cur as Record<string, unknown> & { $metadata?: { httpStatusCode?: unknown } };
    // `StorageError.code` is our own class (`backend`); the provider's code is further down.
    if (e.name !== "StorageError") code ??= identOf(e.code) ?? identOf(e.Code);
    const s = e.status ?? e.statusCode ?? e.$metadata?.httpStatusCode;
    if (typeof s === "number") status ??= s;
    if (typeof e.message === "string" && e.message) message = e.message;
    cur = e.cause;
  }
  const clean = message ? redactSecrets(message.replace(/\s+/g, " ").trim()) : "";
  return {
    ...(code ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(clean ? { message: clean.slice(0, MESSAGE_MAX) } : {}),
  };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`no answer in ${ms} ms`), { code: "timeout" })),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One authenticated round trip against the store: put a tiny object under
 * `STORAGE_CHECK_PREFIX`, then delete it. A read alone may pass with credentials that cannot sign
 * a write, so the write is the test. Never throws; the result says which step failed and why.
 */
export async function checkStorage(
  adapter: StorageAdapter,
  opts: { timeoutMs?: number; id?: () => string; now?: () => number } = {},
): Promise<StorageCheck> {
  const now = opts.now ?? (() => performance.now());
  const timeoutMs = opts.timeoutMs ?? STORAGE_CHECK_TIMEOUT_MS;
  const key = `${STORAGE_CHECK_PREFIX}/${(opts.id ?? (() => crypto.randomUUID()))()}.txt`;
  const t0 = now();
  let step: "put" | "delete" = "put";
  try {
    await withTimeout(
      adapter.put(key, new TextEncoder().encode("ok"), { contentType: "text/plain" }),
      timeoutMs,
    );
    step = "delete";
    await withTimeout(adapter.delete(key), timeoutMs);
    return { ok: true, ms: Math.round(now() - t0) };
  } catch (error) {
    return { ok: false, ms: Math.round(now() - t0), step, ...describe(error) };
  }
}

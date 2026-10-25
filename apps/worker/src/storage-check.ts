import { type StorageAdapter, safeError } from "@tj/domain";
import { checkStorage, type StorageCheck, type StorageKind } from "@tj/storage";

interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Whether picture generation may run now; read when a lesson job builds its picture maker. */
export interface StorageGate {
  readonly open: boolean;
}

/** The re-check delay after the `n`th failure (0-based): 30 s, 60 s, 120 s, 240 s, then 5 min. */
export function recheckDelayMs(n: number): number {
  return Math.min(30_000 * 2 ** n, 300_000);
}

/**
 * The boot storage check (25 Oct 2026 incident: a reset bucket secret, every picture paid for and
 * then lost at `storage.put`, while the worker had booted and logged `storage="s3"`). On S3, one
 * put and delete (`checkStorage`); local disk is not checked. A failure does not stop the worker:
 * lessons still write. It logs at error level and closes the gate, so nothing is paid for that
 * cannot be saved: a lesson then runs as on a worker without `OPENAI_API_KEY` (no picture maker,
 * `lesson-pipeline.ts`). The check re-runs in the background with backoff (`recheckDelayMs`), one
 * at a time, until it passes and the gate opens again, or `signal` aborts (shutdown).
 */
export async function verifyStorage(
  storage: StorageAdapter,
  storageKind: StorageKind,
  logger: Logger,
  opts: {
    check?: (adapter: StorageAdapter) => Promise<StorageCheck>;
    delayMs?: (n: number) => number;
    signal?: AbortSignal;
  } = {},
): Promise<{ gate: StorageGate; storageCheck: "ok" | "failed" | "skipped" }> {
  let open = true;
  const gate: StorageGate = {
    get open() {
      return open;
    },
  };
  if (storageKind !== "s3") return { gate, storageCheck: "skipped" };
  const check = opts.check ?? checkStorage;
  const delayMs = opts.delayMs ?? recheckDelayMs;
  const failed = (out: Exclude<StorageCheck, { ok: true }>) => {
    const { ok: _ok, ...failure } = out;
    return { storage: storageKind, ...failure, imageGeneration: "disabled" };
  };
  /** A pass that left its probe behind (no `DeleteObject`): pictures stay on, the warn says why. */
  const warnLeftover = (out: Extract<StorageCheck, { ok: true }>) => {
    if (out.warning)
      logger.warn(
        { storage: storageKind, ...out.warning },
        "storage_check: the probe could not be deleted",
      );
  };
  const first = await check(storage);
  if (first.ok) {
    logger.info({ storage: storageKind, ms: first.ms }, "storage_check ok");
    warnLeftover(first);
    return { gate, storageCheck: "ok" };
  }
  open = false;
  logger.error(
    failed(first),
    "storage_check failed: picture generation is off until a re-check passes",
  );
  // One timer at a time: the next re-check is scheduled only after the last one has settled.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (n: number) => {
    if (opts.signal?.aborted) return;
    const wait = delayMs(n);
    timer = setTimeout(async () => {
      timer = undefined;
      // Never lets the chain die with the gate closed: a throw is logged and re-checked later.
      try {
        const out = await check(storage);
        if (opts.signal?.aborted) return;
        if (out.ok) {
          open = true;
          logger.info(
            { storage: storageKind, ms: out.ms, rechecks: n + 1 },
            "storage_check ok (recovered)",
          );
          warnLeftover(out);
          return;
        }
        logger.warn({ ...failed(out), rechecks: n + 1 }, "storage_check still failing");
      } catch (error) {
        logger.warn(
          { storage: storageKind, err: safeError(error), rechecks: n + 1 },
          "storage_check re-check threw",
        );
      }
      schedule(n + 1);
    }, wait);
    timer.unref?.();
  };
  opts.signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
  schedule(0);
  return { gate, storageCheck: "failed" };
}

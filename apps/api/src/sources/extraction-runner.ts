/**
 * Extraction runner (TEACH-278, audit F02/F03; ADR 0027 §5 amendment): where `POST /sources`
 * parses an untrusted document.
 *
 * `ChildProcessExtractionRunner` spawns `extract-child.ts` per upload, pipes the bytes in, reads
 * one JSON answer out and **kills** the child on the deadline, on client abort, or when its output
 * grows past the cap — the only way to stop a synchronous inflater or parser. A semaphore bounds
 * how many children run at once and how many uploads may wait for a slot; past that the request
 * is refused before anything is spawned (`ExtractionBusyError` → 503 with Retry-After).
 *
 * `InProcessExtractionRunner` (`./runner.ts`, with the interface and the error classes) calls
 * `extract()` directly; tests use it, production never does. Route modules import `./runner` only:
 * this file touches `Bun.spawn`, and a Bun type reaching `AppType` breaks `@tj/api-client`.
 *
 * Failure is content-free: the child's stderr is discarded, its exit code and the answer's `code`
 * are the only diagnostics, and neither carries document text.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractError, type ExtractInput } from "@tj/extract";
import { z } from "zod";
import { decodeExtraction, parseChildAnswer } from "./protocol";
import {
  ExtractionBusyError,
  ExtractionFailedError,
  type ExtractionRunner,
  type RunInput,
  type RunOptions,
  type RunResult,
} from "./runner";

export {
  ExtractionBusyError,
  ExtractionFailedError,
  type ExtractionRunner,
  InProcessExtractionRunner,
  type RunInput,
  type RunOptions,
  type RunResult,
} from "./runner";

export interface ChildRunnerConfig {
  /** Source-mode Bun entry in dev, memory-limited Node `.mjs` bundle in production. */
  entry: string;
  /** Wall-clock budget for one document, spawn to answer. */
  deadlineMs: number;
  /** Children running at once. */
  maxConcurrent: number;
  /** Uploads waiting for a slot before `ExtractionBusyError`. */
  maxQueue: number;
  /** Bytes of stdout accepted before the child is killed (images are base64 inside it). */
  maxOutputBytes: number;
  /**
   * Address-space ceiling for the production Node child, in MiB. Defaults to 1536; validated on
   * native Railway Linux x64. This is an OS limit, not just the V8 managed-heap size.
   */
  vmemLimitMb?: number;
  /** Extra caps forwarded to the child (tests scale them). */
  limits?: ExtractInput["limits"];
  /** Overridable for tests. */
  bunExecutable?: string;
  nodeExecutable?: string;
  /** Extra child environment (tests drive the fake child with it). */
  childEnv?: Record<string, string>;
}

export const CHILD_RUNNER_DEFAULTS = {
  deadlineMs: 30_000,
  maxConcurrent: 2,
  maxQueue: 8,
  maxOutputBytes: 128 * 1024 * 1024,
  vmemLimitMb: 1536,
} as const;

/** The child entry next to the API: source TypeScript or the isolated production Node bundle. */
export function childEntryFor(apiEntryUrl: string): string {
  const here = fileURLToPath(apiEntryUrl);
  const ext = here.endsWith(".ts") ? "ts" : "mjs";
  return join(dirname(here), "sources", `extract-child.${ext}`);
}

const positiveInt = z.coerce.number().int().positive();

/** The `EXTRACT_*` knobs (infra/env.contract.ts); all optional. */
export const ExtractionConfigSchema = z.object({
  EXTRACT_DEADLINE_MS: positiveInt.default(CHILD_RUNNER_DEFAULTS.deadlineMs),
  EXTRACT_MAX_CONCURRENT: positiveInt.default(CHILD_RUNNER_DEFAULTS.maxConcurrent),
  EXTRACT_MAX_QUEUE: positiveInt.default(CHILD_RUNNER_DEFAULTS.maxQueue),
  EXTRACT_CHILD_MAX_VMEM_MB: z.coerce
    .number()
    .int()
    .min(1536)
    .max(2048)
    .default(CHILD_RUNNER_DEFAULTS.vmemLimitMb),
});

export function loadChildRunnerConfig(
  source: Record<string, string | undefined>,
  entry: string,
): ChildRunnerConfig {
  // Empty strings mean "unset" (a blank line in an env file).
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = ExtractionConfigSchema.parse(cleaned);
  if (
    source.NODE_ENV === "production" &&
    (!entry.endsWith(".mjs") || process.platform !== "linux")
  ) {
    throw new Error("Production extraction requires the Linux memory-isolated child bundle");
  }
  return {
    entry,
    deadlineMs: parsed.EXTRACT_DEADLINE_MS,
    maxConcurrent: parsed.EXTRACT_MAX_CONCURRENT,
    maxQueue: parsed.EXTRACT_MAX_QUEUE,
    maxOutputBytes: CHILD_RUNNER_DEFAULTS.maxOutputBytes,
    vmemLimitMb: parsed.EXTRACT_CHILD_MAX_VMEM_MB,
  };
}

/** A counting semaphore with a bounded wait queue. */
class Slots {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}

  get inUse(): number {
    return this.running;
  }

  get queued(): number {
    return this.waiting.length;
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.running < this.max) {
      this.running += 1;
      return Promise.resolve(this.releaser());
    }
    if (this.waiting.length >= this.maxQueue) throw new ExtractionBusyError(5);
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        this.running += 1;
        resolve(this.releaser());
      };
      const onAbort = () => {
        const i = this.waiting.indexOf(grant);
        if (i >= 0) this.waiting.splice(i, 1);
        reject(new ExtractionFailedError("aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(grant);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
      const next = this.waiting.shift();
      if (next) next();
    };
  }
}

export class ChildProcessExtractionRunner implements ExtractionRunner {
  private readonly slots: Slots;

  constructor(private readonly config: ChildRunnerConfig) {
    this.slots = new Slots(config.maxConcurrent, config.maxQueue);
  }

  /** For tests and health: children running / uploads waiting. */
  get load(): { running: number; queued: number } {
    return { running: this.slots.inUse, queued: this.slots.queued };
  }

  async run(input: RunInput, options: RunOptions = {}): Promise<RunResult> {
    if (options.signal?.aborted) throw new ExtractionFailedError("aborted");
    const release = await this.slots.acquire(options.signal);
    try {
      // An abort may happen between the slot grant and this async continuation.
      if (options.signal?.aborted) throw new ExtractionFailedError("aborted");
      return await this.spawn(input, options.signal);
    } finally {
      release();
    }
  }

  private command(): string[] {
    const { vmemLimitMb, entry } = this.config;
    if (!entry.endsWith(".mjs")) {
      return [this.config.bunExecutable ?? process.execPath, "--no-env-file", entry];
    }
    if (process.platform !== "linux") throw new ExtractionFailedError("crashed");
    // The limit needs a shell builtin; the script is a constant and the values are positional
    // arguments, never interpolated.
    return [
      "sh",
      "-c",
      'ulimit -c 0; ulimit -v "$1" && exec "$2" --max-old-space-size=256 --max-semi-space-size=8 "$3"',
      "sh",
      String((vmemLimitMb ?? CHILD_RUNNER_DEFAULTS.vmemLimitMb) * 1024),
      this.config.nodeExecutable ?? "node",
      entry,
    ];
  }

  private async spawn(input: RunInput, signal?: AbortSignal): Promise<RunResult> {
    const limits = { ...this.config.limits, ...input.limits };
    const proc = Bun.spawn(this.command(), {
      stdin: input.bytes,
      stdout: "pipe",
      stderr: "ignore",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "/tmp",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        DO_NOT_TRACK: "1",
        ...(input.mime ? { EXTRACT_MIME: input.mime } : {}),
        ...(Object.keys(limits).length > 0 ? { EXTRACT_LIMITS: JSON.stringify(limits) } : {}),
        ...this.config.childEnv,
      },
    });

    let why: ExtractionFailedError["why"] | null = null;
    const kill = (reason: ExtractionFailedError["why"]) => {
      why ??= reason;
      try {
        proc.kill("SIGKILL");
      } catch {
        // It may have exited between the reader event and this call; finally still reaps it.
      }
    };
    const timer = setTimeout(() => kill("timeout"), this.config.deadlineMs);
    const onAbort = () => kill("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const reader = proc.stdout.getReader();
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.config.maxOutputBytes) {
          kill("output-too-large");
          throw new ExtractionFailedError("output-too-large");
        }
        chunks.push(value);
      }
      const exitCode = await proc.exited;
      if (why !== null || exitCode !== 0) {
        throw new ExtractionFailedError(why ?? "crashed", exitCode);
      }
      let parsed: ReturnType<typeof parseChildAnswer>;
      try {
        parsed = parseChildAnswer(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new ExtractionFailedError("bad-answer", exitCode);
      }
      if (!parsed.ok) {
        if (parsed.code === "crashed") throw new ExtractionFailedError("crashed", exitCode);
        throw new ExtractError(parsed.code, parsed.format);
      }
      return { mime: parsed.mime, extraction: decodeExtraction(parsed.extraction) };
    } catch (error) {
      kill(why ?? "crashed");
      if (error instanceof ExtractError || error instanceof ExtractionFailedError) throw error;
      throw new ExtractionFailedError(why ?? "crashed");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      // A kill request is not process exit. Retain the semaphore slot until the child is reaped.
      await proc.exited;
    }
  }
}

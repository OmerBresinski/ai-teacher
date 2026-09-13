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
import {
  ExtractError,
  type ExtractInput,
  type Extraction,
  type ExtractionKind,
  MIME,
} from "@tj/extract";
import { z } from "zod";
import { type ChildAnswer, decodeExtraction } from "./protocol";
import {
  ExtractionBusyError,
  ExtractionFailedError,
  type ExtractionRunner,
  type RunOptions,
} from "./runner";

export {
  ExtractionBusyError,
  ExtractionFailedError,
  type ExtractionRunner,
  InProcessExtractionRunner,
  type RunOptions,
} from "./runner";

export interface ChildRunnerConfig {
  /** Path of the child entry (`extract-child.ts` in dev, `dist/sources/extract-child.js` in the image). */
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
   * Optional address-space limit for the child (`ulimit -v`, KiB) — Linux only, opt-in through
   * `EXTRACT_CHILD_MAX_VMEM_MB`. Bun/JSC reserves large virtual ranges; verify the value boots
   * `bun` in the image before relying on it (infra/README.md "Source extraction").
   */
  vmemLimitMb?: number;
  /** Extra caps forwarded to the child (tests scale them). */
  limits?: ExtractInput["limits"];
  /** Overridable for tests. */
  bunExecutable?: string;
  /** Extra child environment (tests drive the fake child with it). */
  childEnv?: Record<string, string>;
}

export const CHILD_RUNNER_DEFAULTS = {
  deadlineMs: 30_000,
  maxConcurrent: 2,
  maxQueue: 8,
  maxOutputBytes: 128 * 1024 * 1024,
} as const;

/** The child entry next to the running api entry: `src/sources/extract-child.ts` or `dist/sources/extract-child.js`. */
export function childEntryFor(apiEntryUrl: string): string {
  const here = fileURLToPath(apiEntryUrl);
  const ext = here.endsWith(".ts") ? "ts" : "js";
  return join(dirname(here), "sources", `extract-child.${ext}`);
}

const positiveInt = z.coerce.number().int().positive();

/** The `EXTRACT_*` knobs (infra/env.contract.ts); all optional. */
export const ExtractionConfigSchema = z.object({
  EXTRACT_DEADLINE_MS: positiveInt.default(CHILD_RUNNER_DEFAULTS.deadlineMs),
  EXTRACT_MAX_CONCURRENT: positiveInt.default(CHILD_RUNNER_DEFAULTS.maxConcurrent),
  EXTRACT_MAX_QUEUE: positiveInt.default(CHILD_RUNNER_DEFAULTS.maxQueue),
  EXTRACT_CHILD_MAX_VMEM_MB: positiveInt.optional(),
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
  return {
    entry,
    deadlineMs: parsed.EXTRACT_DEADLINE_MS,
    maxConcurrent: parsed.EXTRACT_MAX_CONCURRENT,
    maxQueue: parsed.EXTRACT_MAX_QUEUE,
    maxOutputBytes: CHILD_RUNNER_DEFAULTS.maxOutputBytes,
    ...(parsed.EXTRACT_CHILD_MAX_VMEM_MB !== undefined
      ? { vmemLimitMb: parsed.EXTRACT_CHILD_MAX_VMEM_MB }
      : {}),
  };
}

const kindOf = (mime: ExtractInput["mime"]): ExtractionKind | "unknown" =>
  (Object.entries(MIME) as [ExtractionKind, string][]).find(([, m]) => m === mime)?.[0] ??
  "unknown";

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

  async run(input: ExtractInput, options: RunOptions = {}): Promise<Extraction> {
    if (options.signal?.aborted) throw new ExtractionFailedError("aborted");
    const release = await this.slots.acquire(options.signal);
    try {
      return await this.spawn(input, options.signal);
    } finally {
      release();
    }
  }

  private command(): string[] {
    const bun = this.config.bunExecutable ?? process.execPath;
    const { vmemLimitMb, entry } = this.config;
    if (vmemLimitMb === undefined) return [bun, entry];
    // The limit needs a shell builtin; the script is a constant and the values are positional
    // arguments, never interpolated.
    return [
      "sh",
      "-c",
      'ulimit -v "$1" && exec "$2" "$3"',
      "sh",
      String(vmemLimitMb * 1024),
      bun,
      entry,
    ];
  }

  private spawn(input: ExtractInput, signal?: AbortSignal): Promise<Extraction> {
    const limits = { ...this.config.limits, ...input.limits };
    const proc = Bun.spawn(this.command(), {
      stdin: input.bytes,
      stdout: "pipe",
      stderr: "ignore",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "/tmp",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        EXTRACT_MIME: input.mime,
        ...(Object.keys(limits).length > 0 ? { EXTRACT_LIMITS: JSON.stringify(limits) } : {}),
        ...this.config.childEnv,
      },
    });

    return new Promise<Extraction>((resolve, reject) => {
      let settled = false;
      let why: ExtractionFailedError["why"] | null = null;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const kill = (reason: ExtractionFailedError["why"]) => {
        if (why === null) why = reason;
        try {
          proc.kill("SIGKILL");
        } catch {
          // already gone
        }
      };
      const timer = setTimeout(() => kill("timeout"), this.config.deadlineMs);
      const onAbort = () => kill("aborted");
      signal?.addEventListener("abort", onAbort, { once: true });

      const chunks: Uint8Array[] = [];
      let size = 0;
      const readOut = async () => {
        const reader = proc.stdout.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > this.config.maxOutputBytes) {
            kill("output-too-large");
            chunks.length = 0;
            // Keep draining so the child's exit is observed.
            continue;
          }
          chunks.push(value);
        }
      };

      Promise.all([readOut(), proc.exited])
        .then(([, exitCode]) => {
          finish(() => {
            if (why !== null) {
              reject(new ExtractionFailedError(why, exitCode));
              return;
            }
            const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
            let parsed: ChildAnswer;
            try {
              parsed = JSON.parse(text) as ChildAnswer;
            } catch {
              reject(
                new ExtractionFailedError(exitCode === 0 ? "bad-answer" : "crashed", exitCode),
              );
              return;
            }
            if (parsed.ok === true) {
              resolve(decodeExtraction(parsed.extraction));
            } else if (parsed.code === "crashed") {
              reject(new ExtractionFailedError("crashed", exitCode));
            } else {
              reject(new ExtractError(parsed.code, kindOf(input.mime)));
            }
          });
        })
        .catch(() => finish(() => reject(new ExtractionFailedError(why ?? "crashed"))));
    });
  }
}

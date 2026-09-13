/**
 * The extraction seam `POST /sources` depends on (TEACH-278). Kept free of Bun-only types so route
 * modules can import it without leaking `Bun.*` into `AppType` (`@tj/api-client`). The production
 * implementation is `./extraction-runner.ts` (`ChildProcessExtractionRunner`).
 */
import {
  ExtractError,
  type ExtractInput,
  type Extraction,
  extract,
  type SourceMime,
  sniffMime,
} from "@tj/extract";

/** What the route hands the runner: bytes, and the MIME only when it is already known (a paste). */
export interface RunInput extends Omit<ExtractInput, "mime"> {
  mime?: SourceMime;
}

/** The runner sniffs a file's real type itself (inside the child, in production). */
export interface RunResult {
  mime: SourceMime;
  extraction: Extraction;
}

export interface RunOptions {
  /** Aborted when the client goes away; the child is killed and the slot reclaimed. */
  signal?: AbortSignal;
}

export interface ExtractionRunner {
  run(input: RunInput, options?: RunOptions): Promise<RunResult>;
}

/** Every slot and every queue position is taken: refuse before spawning. */
export class ExtractionBusyError extends Error {
  override readonly name = "ExtractionBusyError";
  constructor(readonly retryAfterSeconds: number) {
    super("Extraction capacity is full");
  }
}

/** The child did not answer in time, was aborted, over-produced or crashed. `why` is content-free. */
export class ExtractionFailedError extends Error {
  override readonly name = "ExtractionFailedError";
  constructor(
    readonly why: "timeout" | "aborted" | "output-too-large" | "crashed" | "bad-answer",
    readonly exitCode: number | null = null,
  ) {
    super(`extraction child: ${why}`);
  }
}

export class InProcessExtractionRunner implements ExtractionRunner {
  async run(input: RunInput): Promise<RunResult> {
    const mime = input.mime ?? (await sniffMime(input.bytes));
    if (mime === null) throw new ExtractError("unsupported", "unknown");
    return { mime, extraction: await extract({ ...input, mime }) };
  }
}

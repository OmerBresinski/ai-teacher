/**
 * The extraction seam `POST /sources` depends on (TEACH-278). Kept free of Bun-only types so route
 * modules can import it without leaking `Bun.*` into `AppType` (`@tj/api-client`). The production
 * implementation is `./extraction-runner.ts` (`ChildProcessExtractionRunner`).
 */
import { type ExtractInput, type Extraction, extract } from "@tj/extract";

export interface RunOptions {
  /** Aborted when the client goes away; the child is killed and the slot reclaimed. */
  signal?: AbortSignal;
}

export interface ExtractionRunner {
  run(input: ExtractInput, options?: RunOptions): Promise<Extraction>;
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
  run(input: ExtractInput): Promise<Extraction> {
    return extract(input);
  }
}

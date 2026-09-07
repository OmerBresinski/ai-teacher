import type { AiCallContext, Budget, CreatedAi } from "@tj/ai";
import type { Finding, GenerationStage, Lesson, SourceRef, Worksheet } from "@tj/domain/documents";
import type { Logger } from "pino";

/*
 * The pipeline's contract with its host (ADR 0025 §17): everything the stages need arrives in
 * `PipelineDeps`; nothing here touches a database, pg-boss or HTTP. The worker owns persistence
 * and injects it as `persist`; tests inject a recorder.
 */

/**
 * The `lesson.plan` stages, in order (ADR 0025 §5). `check-input` (TEACH-137) runs first and
 * writes no checkpoint: it either lets the brief through or stops the job; the four after it each
 * write one.
 */
export type PipelineStageName = "check-input" | "plan" | "generate" | "evaluate" | "repair";

/**
 * Every stage a model call can belong to, as it appears in call contexts and failures: the
 * pipeline's four plus the two proposal jobs (§18), which write no checkpoint.
 */
export type StageName = PipelineStageName | "cascade" | "regenerate";

/**
 * The checkpoint each pipeline stage writes to `Lesson.generation.stage` (ADR 0025 §3, §5);
 * `null` for a stage that writes none, so a resumed job never lands on it.
 */
export const STAGE_CHECKPOINT: Record<PipelineStageName, GenerationStage | null> = {
  "check-input": null,
  plan: "planned",
  generate: "generated",
  evaluate: "evaluated",
  repair: "repaired",
};

export const STAGE_ORDER: readonly PipelineStageName[] = [
  "check-input",
  "plan",
  "generate",
  "evaluate",
  "repair",
];

/** One extracted passage of a teacher-provided Source (ADR 0025 §20); loaded by the worker. */
export type SourceText = {
  sourceId: string;
  ref: { page?: number; slide?: number };
  text: string;
};

export type SourceLoader = (refs: SourceRef[]) => Promise<SourceText[]>;

/** The loader until F03 ships one: no Source text. */
export const noSources: SourceLoader = async () => [];

export type PipelineContext = { lessonId: string; jobId: string };

export interface PipelineDeps {
  ai: CreatedAi;
  budget: Budget;
  /** Checked between model calls; passed as `abortSignal` to every call. */
  signal: AbortSignal;
  /** Never receives prompts, model output or document content (ADR 0015). */
  logger: Logger;
  now: () => Date;
  /** Element and block ids; `uid()` in production, a counter in tests. */
  ids: () => string;
  sources: SourceLoader;
  /**
   * Write the documents as they stand (ADR 0025 §6, §7) and return the lesson's new `updatedAt`,
   * which the next `onProgress` carries so the read-only editor knows to refetch.
   */
  persist: (lesson: Lesson, worksheet?: Worksheet) => Promise<{ updatedAt: string }>;
  onProgress: (percent: number, message: string, documentUpdatedAt?: string) => Promise<void>;
  context: PipelineContext;
}

/** What flows between stages: the documents and the id the worker minted for the worksheet row. */
export interface PipelineState {
  lesson: Lesson;
  worksheet?: Worksheet;
  /** The `documents` row id the worker created for the worksheet (ADR 0025 §4). */
  worksheetId: string;
}

/**
 * A stage could not produce its output after the one permitted retry (ADR 0025 §14), or lost the
 * document it was writing. Plan and Generate failures fail the job; Evaluate and Repair failures
 * are recorded as findings by the stage itself and never reach here.
 */
export class StageFailure extends Error {
  override readonly name = "StageFailure";
  constructor(
    readonly stage: StageName,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
  }
}

/**
 * The brief must not go to Plan (TEACH-137): a learner's name, unsafe content or not a lesson
 * request. Thrown by `check-input` before anything is persisted; the worker maps it to a
 * `NonRetryableError` — a re-run cannot fix the input. `findings` carry the teacher-readable,
 * content-free reasons; `message` is the first of them.
 */
export class InputRejected extends Error {
  override readonly name = "InputRejected";
  constructor(readonly findings: Finding[]) {
    super(findings[0]?.message ?? "The brief cannot be turned into a lesson as written.");
  }
}

/** Thrown by `callStructured` when `budget.exceeded()` before a call; stages catch it (§15). */
export class BudgetExceeded extends Error {
  override readonly name = "BudgetExceeded";
  constructor(readonly by: "usd" | "tokens") {
    super(`lesson budget exceeded (${by} cap)`);
  }
}

/** The `AiCallContext` for a stage's calls (ADR 0025 §16). */
export function callContext(
  deps: Pick<PipelineDeps, "context">,
  stage: StageName,
  promptVersion: string,
): AiCallContext {
  return { ...deps.context, stage, promptVersion };
}

/** The error a cancelled stage throws: the signal's own reason when it is one, else an AbortError. */
export function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new DOMException(
    typeof reason === "string" ? reason : "The operation was aborted.",
    "AbortError",
  );
}

/**
 * Cancel is checked between model calls (ADR 0025 §5): what was written stays, and the stage
 * stops here rather than advancing a checkpoint it did not earn, so a retry resumes correctly and
 * the worker records `cancelled`, not `completed`.
 */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

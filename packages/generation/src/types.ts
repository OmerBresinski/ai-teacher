import type { AiCallContext, Budget, CreatedAi } from "@tj/ai";
import type { Finding, GenerationStage, Lesson, SourceRef, Worksheet } from "@tj/domain/documents";
import type { PhotoResult, StoredPhoto } from "@tj/images";
import type { Logger } from "pino";

/*
 * The pipeline's contract with its host (ADR 0025 §17): everything the stages need arrives in
 * `PipelineDeps`; nothing here touches a database, pg-boss or HTTP. The worker owns persistence
 * and injects it as `persist`; tests inject a recorder.
 */

/**
 * The `lesson.plan` stages, in order (ADR 0025 §5). `check-input` (TEACH-137) runs first and
 * writes no checkpoint: it either lets the brief through or stops the job; `illustrate`
 * (Images project) places photographs and writes none either — idempotent, one `small` judge
 * call per image slide (TEACH-191), a stop on budget like every stage. The four others each
 * write one.
 */
export type PipelineStageName =
  | "check-input"
  | "plan"
  | "generate"
  | "illustrate"
  | "evaluate"
  | "repair";

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
  illustrate: null,
  evaluate: "evaluated",
  repair: "repaired",
};

export const STAGE_ORDER: readonly PipelineStageName[] = [
  "check-input",
  "plan",
  "generate",
  "illustrate",
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

/**
 * The image collaborator illustrate talks to (Images project). Injected so `@tj/generation`
 * still makes no HTTP call itself; the worker closes it over the Pexels client, storage and
 * Workspace. Types only from `@tj/images` — never a value import.
 */
export interface PhotoPlacer {
  search(
    query: string,
    opts: {
      orientation: "landscape" | "portrait" | "square";
      perPage: number;
      signal: AbortSignal;
    },
  ): Promise<PhotoResult[]>;
  store(photo: PhotoResult, target: "slide"): Promise<StoredPhoto>;
}

/**
 * What the `generation summary` line reports for pictures (TEACH-159): the illustrate counts, and
 * whether Plan said the topic could be photographed at all (TEACH-238; `null` until Plan answers),
 * so the Images measure is placed ÷ photographable, not placed ÷ every lesson.
 */
export interface ImageCounts {
  photographable: boolean | null;
  requested: number;
  placed: number;
  empty: number;
  failed: number;
}

export function emptyImageCounts(): ImageCounts {
  return { photographable: null, requested: 0, placed: 0, empty: 0, failed: 0 };
}

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
  /** Pexels + bucket behind illustrate; absent → the step logs and returns the state. */
  images?: PhotoPlacer;
  /**
   * Where illustrate reports its counts for the summary line. Stages cannot see the
   * `RequestContext`, so the per-run counts ride here instead (the same shape of channel as
   * `budget`, which stages charge the same way). Created by illustrate when absent.
   */
  imageCounts?: ImageCounts;
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

/** The checks the input step may report (TEACH-137); every one stops the run. */
export const INPUT_CHECKS = ["learner-name", "unsafe-content", "not-a-lesson"] as const;
export type InputCheck = (typeof INPUT_CHECKS)[number];

/**
 * What the teacher is told per check. Fixed text, never the model's: the model's own `message`
 * stays on the finding for the editor, but the error message travels into logs and the job's
 * terminal event (ADR 0015), so it must not be able to echo the brief.
 */
export const INPUT_CHECK_MESSAGES: Record<InputCheck, string> = {
  "learner-name":
    "The brief seems to name or identify a pupil. Please describe the class without naming anyone.",
  "unsafe-content": "The brief asks for material that is not suitable for a classroom.",
  "not-a-lesson":
    "The brief does not describe a lesson to teach. Please give a topic or objective.",
};

/**
 * The brief must not go to Plan (TEACH-137): a learner's name, unsafe content or not a lesson
 * request. Thrown by `check-input` before anything is persisted; the worker maps it to a
 * `NonRetryableError` — a re-run cannot fix the input. `findings` carry the reasons for the
 * editor; `message` is the fixed text for the first recognised check, so nothing the model wrote
 * reaches a log line or a job event.
 */
export class InputRejected extends Error {
  override readonly name = "InputRejected";
  constructor(readonly findings: Finding[]) {
    super(inputRejectionMessage(findings));
  }
}

export function inputRejectionMessage(findings: Finding[]): string {
  const known = findings.find((f) => (INPUT_CHECKS as readonly string[]).includes(f.check));
  return known
    ? INPUT_CHECK_MESSAGES[known.check as InputCheck]
    : INPUT_CHECK_MESSAGES["not-a-lesson"];
}

/** Thrown by `callStructured` when `budget.exceeded()` before a call; stages catch it (§15). */
export class BudgetExceeded extends Error {
  override readonly name = "BudgetExceeded";
  constructor(readonly by: "usd" | "tokens") {
    super(`lesson budget exceeded (${by} cap)`);
  }
}

/** The `AiCallContext` for a stage's calls (ADR 0025 §16): ids, stage, prompt version, effort. */
export function callContext(
  deps: Pick<PipelineDeps, "context">,
  stage: StageName,
  promptVersion: string,
  effort?: string,
): AiCallContext {
  return { ...deps.context, stage, promptVersion, ...(effort !== undefined ? { effort } : {}) };
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

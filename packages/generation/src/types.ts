import type { AiCallContext, Budget, CreatedAi } from "@tj/ai";
import type {
  Finding,
  GenerationStage,
  Lesson,
  LessonFacts,
  SourceLocator,
  SourceRef,
  Worksheet,
} from "@tj/domain/documents";
import type { PhotoResult, StoredPhoto } from "@tj/images";
import type { Logger } from "pino";
import type { ReasoningEffort } from "./call";
import type { VerifyCorrection } from "./specs";

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
 * pipeline's four plus the two proposal jobs (§18), which write no checkpoint, the worksheet
 * job's one stage (ADR 0030 item 3) and the API's brief parse (ADR 0029 item 13), which runs
 * outside any job.
 */
export type StageName = PipelineStageName | "cascade" | "regenerate" | "worksheet" | "parse-brief";

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

/**
 * One extracted passage of a teacher-provided Source (ADR 0025 §20, ADR 0027 §3, §6): a chunk of
 * `extracted.json`, located by page, slide or heading section. Loaded by the worker.
 */
export type SourceText = {
  sourceId: string;
  ref: SourceLocator;
  text: string;
};

/** Characters of Source text Plan will show the model per lesson (ADR 0027 §6). */
export const SOURCE_TEXT_MAX_CHARS = 40_000;

export type SourceLoader = (refs: SourceRef[]) => Promise<SourceText[]>;

/** A loader with no Source text: for lessons without Sources, Studio and tests. */
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
  /**
   * One progress event. `stage` is the pipeline stage emitting it (ADR 0029 item 14): the worker
   * writes it as `progress.stage` so the client no longer has to read the stage off the percent.
   */
  onProgress: (
    percent: number,
    message: string,
    stage: PipelineStageName,
    documentUpdatedAt?: string,
  ) => Promise<void>;
  context: PipelineContext;
  /** Pexels + bucket behind illustrate; absent → the step logs and returns the state. */
  images?: PhotoPlacer;
  /**
   * Plan (skeleton, facts, Verify) runs on the `frontier` class for a lesson whose year group is
   * this number or above (TEACH-259; `AI_PLAN_FRONTIER_FROM_YEAR`). Unset: every Plan call is
   * `standard`, as before. Generate and the later stages never read it.
   */
  planFrontierFromYear?: number;
  /**
   * The reasoning effort a call runs at, given the stage, the prompt name (`plan-facts`) and the
   * effort the stage asked for. Set by the lab's effort bench, and by the worker when
   * `AI_REASONING_EFFORT` is set (TEACH-72). Unset: the stage's choice.
   */
  effortFor?: (stage: string, promptName: string, effort: ReasoningEffort) => ReasoningEffort;
  /**
   * Where illustrate reports its counts for the summary line. Stages cannot see the
   * `RequestContext`, so the per-run counts ride here instead (the same shape of channel as
   * `budget`, which stages charge the same way). Created by illustrate when absent.
   */
  imageCounts?: ImageCounts;
}

/**
 * What flows between stages: the lesson, the run's options and the in-process Verify hand-off.
 * The pipeline writes no worksheet since ADR 0030 item 2; the two worksheet fields stay optional
 * for a lesson generated before that (Evaluate and Repair still read the sheet when one is
 * passed) and for the worker until TEACH-13 stops minting the row.
 */
export interface PipelineState {
  lesson: Lesson;
  /** Legacy (ADR 0025 §4): the worksheet of a lesson generated before ADR 0030, when resuming. */
  worksheet?: Worksheet;
  /** Legacy (ADR 0025 §4): the row id the worker minted; nothing in the pipeline reads it. */
  worksheetId?: string;
  /**
   * Stop after the `planned` checkpoint (ADR 0029 item 1): Plan then awaits Verify and folds
   * its outcome into that checkpoint (item 2), and `runLessonPipeline` skips every later stage.
   */
  stopAfter?: "planned";
  /**
   * A re-plan with the teacher's objectives fixed (ADR 0029 item 8): Plan gives the skeleton
   * call `facts.objectives` as `givenObjectives` and keeps their ids and text.
   */
  pinObjectives?: boolean;
  /**
   * The Verify call Plan started (TEACH-233), for Generate to await before its first persist.
   * In-process only: Mastra hands step output on by reference, so it survives the step boundary,
   * but it is never persisted — a resumed lesson has none and Generate starts Verify itself.
   */
  pendingVerify?: Promise<VerifyResult>;
}

/** What one Verify call settles to (`stages/verify.ts`); a type here so `PipelineState` can name it. */
export interface VerifyResult {
  facts: LessonFacts;
  applied: VerifyCorrection[];
  findings: Finding[];
}

/**
 * A stage could not produce its output after the one permitted retry (ADR 0025 §14), or lost the
 * document it was writing. Plan and Generate failures fail the job; Evaluate and Repair failures
 * are recorded as findings by the stage itself and never reach here.
 */
export type StageFailureReason = "timeout" | "objectives-check";

export class StageFailure extends Error {
  override readonly name: string = "StageFailure";
  /** `timeout`: a call ran past its bound; `objectives-check`: the lab stopped before facts. */
  readonly reason: StageFailureReason | undefined;
  constructor(
    readonly stage: StageName,
    message: string,
    options: { cause?: unknown; reason?: StageFailureReason } = {},
  ) {
    super(message, options);
    this.reason = options.reason;
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

/**
 * `@tj/generation` — the lesson generation pipeline (ADR 0025 §5, §8, §11–§17, §21): the four
 * stages as pure functions over `PipelineState`, the versioned prompt modules, `callStructured`
 * (structured output with one retry and the budget), and `runLessonPipeline`, which composes
 * them as an in-process Mastra workflow. Server-only; `apps/worker` is the consumer and owns
 * persistence through `PipelineDeps.persist`. Nothing here reads a database or the environment.
 * The dev Studio entry lives in `./mastra.dev.ts` and is never imported from here.
 */

export {
  type CallResult,
  type CallStructuredOptions,
  type CallUsage,
  callStructured,
  type EditorialMiss,
  MAX_OUTPUT_TOKENS,
  SPEC_RULE_CHECK,
  type StructuredPrompt,
  specRuleFinding,
} from "./call";
export * from "./prompts";
export * from "./shapes";
export * from "./specs";
export { checkInput } from "./stages/check-input";
export { evaluate } from "./stages/evaluate";
export { BUDGET_FINDING, generate, PLANNED_SLIDES } from "./stages/generate";
export { plan } from "./stages/plan";
export {
  type ImpactSet,
  impactSet,
  MAX_REDO_TARGETS,
  PROPOSE_CONCURRENCY,
  type ProposeContext,
  type ProposeResult,
  proposeFor,
} from "./stages/proposals";
export { MAX_TARGETS, repair, repairTargets } from "./stages/repair";
export { audienceOf, blockText, runBounded, slideText } from "./stages/shared";
export {
  type SelectedSourceTexts,
  SOURCE_TEXT_MIN_CHARS,
  type SourceUnit,
  selectSourceTexts,
  sourceUnitOf,
  type TruncatedSource,
} from "./stages/source-texts";
export * from "./types";
export {
  checkInputStep,
  evaluateStep,
  generateStep,
  lessonWorkflow,
  type PipelineInput,
  planStep,
  repairStep,
  resumeFrom,
  runLessonPipeline,
} from "./workflow";

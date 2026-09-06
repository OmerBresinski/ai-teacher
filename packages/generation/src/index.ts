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
  MAX_OUTPUT_TOKENS,
  type StructuredPrompt,
} from "./call";
export * from "./prompts";
export * from "./specs";
export { evaluate } from "./stages/evaluate";
export { BUDGET_FINDING, generate, PLANNED_SLIDES } from "./stages/generate";
export { plan } from "./stages/plan";
export { MAX_TARGETS, repair, repairTargets } from "./stages/repair";
export { audienceOf, blockText, slideText } from "./stages/shared";
export * from "./types";
export {
  evaluateStep,
  generateStep,
  lessonWorkflow,
  type PipelineInput,
  planStep,
  repairStep,
  resumeFrom,
  runLessonPipeline,
} from "./workflow";

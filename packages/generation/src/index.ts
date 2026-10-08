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
  REASONING_EFFORTS,
  type ReasoningEffort,
  SPEC_RULE_CHECK,
  type StructuredPrompt,
  specRuleFinding,
} from "./call";
export {
  EDIT_FAST_EFFORT,
  EDIT_FAST_MODEL_ID,
  EDIT_INSTRUCTION_MAX,
  EDIT_MESSAGES,
  type EditFastChange,
  type EditFastDeps,
  type EditFastRequest,
  type EditFastResult,
  EditTargetError,
  editFast,
} from "./edit-fast";
export {
  AGENT_MESSAGES,
  type EditNeed,
  type EditRoute,
  routeEdit,
} from "./edit-route";
export {
  MODEL_FIELDS,
  type ModelField,
  mergeModelFields,
  PARSE_BRIEF_DEADLINE_MS,
  type ParseBriefDeps,
  type ParseBriefOutput,
  ParseBriefOutputSchema,
  type ParseBriefRequest,
  type ParseBriefResult,
  type ParseBriefRules,
  parseBrief,
  parseBriefRules,
  RULE_FIELDS,
  type RuleField,
} from "./parse-brief";
// The objectives-first planner (TEACH-91) as the lab runs it; production runs its two steps as
// workflow steps behind `AI_LESSON_PLANNER` (TEACH-93).
export {
  MISSING_MATERIAL_CHECK,
  PLANNED_VERSION,
  PlanBlocked,
  type PlannedState,
  type PlannerOptions,
  type PlanReport,
  type PlanStatus,
  planFromObjectives,
  planReportMarkdown,
  runPlannedLessonPipeline,
  runStatus,
  statusLine,
} from "./planner/plan-pipeline";
export * from "./prompts";
export { type EditFastInput, editFastPrompt } from "./prompts/edit-fast";
export * from "./shapes";
export * from "./specs";
export { checkInput } from "./stages/check-input";
export { evaluate } from "./stages/evaluate";
export { type FactsStepReport, facts, runFactsStep } from "./stages/facts";
export { BUDGET_FINDING, generate, PLANNED_SLIDES } from "./stages/generate";
export {
  MAX_OUTPUT_TOKENS_OBJECTIVES,
  ObjectivesBlocked,
  type ObjectivesStepReport,
  objectives,
  PLANNER_EFFORT,
  type PlannerEffortOption,
  runObjectivesStep,
  writerObjectives,
} from "./stages/objectives";
export {
  isObjectivesFirstStamp,
  isWriterStamp,
  OBJECTIVES_FIRST_CHECKPOINT,
  OBJECTIVES_FIRST_ORDER,
  OBJECTIVES_FIRST_VERSION,
  type ObjectivesFirstStageName,
  PLANNERS,
  type Planner,
  plannerFor,
  plannerOf,
  resumeFromObjectivesFirst,
  resumeFromWriter,
  WRITER_CHECKPOINT,
  WRITER_ORDER,
  WRITER_PLANNED_VERSION,
  type WriterStageName,
} from "./stages/objectives-first";
export { materialiseObjectives, materialiseTitle, plan } from "./stages/plan";
export {
  type ImpactSet,
  impactSet,
  MAX_REDO_TARGETS,
  PROPOSE_CONCURRENCY,
  type ProposeContext,
  type ProposeResult,
  proposeFor,
} from "./stages/proposals";
export { stemPlan } from "./stages/question-pool";
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
export { slideRange, write, writerBrief } from "./stages/write";
export * from "./types";
export {
  checkInputStep,
  evaluateStep,
  generateStep,
  lessonWorkflow,
  objectivesFirstWorkflow,
  type PipelineInput,
  type PipelineOptions,
  planStep,
  repairStep,
  resumeFrom,
  runLessonPipeline,
  type StepName,
} from "./workflow";
export * from "./worksheet";
export { WRITER_VERSION, writerRoute } from "./writer/ai-services";
export { DIAGRAM_CONTRACT, writerDrawerSystem } from "./writer/diagram-contract.gen";
export { SMALL_MODEL, WRITER_EFFORT, WRITER_MODEL } from "./writer/services";
export { runWriter, WriterIncompleteError } from "./writer/stage";

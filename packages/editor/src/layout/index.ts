/** Text fitting engine (TeachDeck SPEC "Text fitting engine"). */
export {
  type FitPlan,
  fitMigrationMessage,
  fitVersionOf,
  isFitStale,
  measureInputsOf,
  planFitMigration,
  renderedHeights,
} from "./fit-plan";
export {
  findLaneOverflow,
  findOverflow,
  findOverlaps,
  isBleed,
  isDecorative,
  isOffSlide,
  lintSlide,
  type OverlapPair,
  type SlideLint,
} from "./lint";
export {
  clearMeasureCache,
  createMeasurer,
  measureDocHeight,
  measureLines,
  measureMany,
  warmMeasurer,
  whenFontsReady,
} from "./measure";
export {
  docLineCount,
  isBackdrop,
  isFrozen,
  isHairline,
  type MeasureInput,
  type Measurer,
  type ReflowResult,
  reflowSlide,
  SAFE_BOTTOM,
  SAFETY,
  STEPPABLE,
  splitDocToFit,
  splitListElement,
  stepDownSize,
  textPartsOf,
} from "./reflow";
export { type TidyOutcome, tidyMessage, tidySlide, tidySlideReducer } from "./tidy";
export {
  createRunGate,
  type FitMigrationDeps,
  type FitMigrationOutcome,
  MAX_ATTEMPTS,
  runFitMigration,
  useFitMigration,
} from "./use-fit-migration";
export { useSlideLint } from "./use-slide-lint";

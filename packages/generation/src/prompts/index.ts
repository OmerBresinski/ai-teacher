import { checkInputPrompt } from "./check-input";
import { evaluatePrompt } from "./evaluate";
import { generateSlidePrompt } from "./generate-slide";
import { generateWorksheetPrompt } from "./generate-worksheet";
import { generateWorksheetFillPrompt } from "./generate-worksheet-fill";
import { parseBriefPrompt } from "./parse-brief";
import { pickOrRequeryPrompt } from "./pick-or-requery-photo";
import { planFactsPrompt } from "./plan-facts";
import { planSkeletonPrompt } from "./plan-skeleton";
import { cascadePrompt, regeneratePrompt } from "./propose";
import { repairPrompt } from "./repair";
import { repairFactPrompt } from "./repair-fact";
import { shortlistPhotosPrompt } from "./shortlist-photos";
import { verifyFactsPrompt } from "./verify-facts";

/*
 * The prompt registry (ADR 0025 §17). Every prompt is a TypeScript module exporting
 * `{ version, system, user(input) }`; the version string is written to `generatedFrom` and
 * `generation.promptVersions`, and `prompts.test.ts` pins a hash of each prompt's text to it.
 */

export type { CheckInputInput } from "./check-input";
export type { EvaluateInput } from "./evaluate";
export type { GenerateSlideInput, SlidePhoto } from "./generate-slide";
export { IMAGE_TEXT_RULE, photoBlock } from "./generate-slide";
export type { GenerateWorksheetInput } from "./generate-worksheet";
export { BLOCK_SHAPES } from "./generate-worksheet";
export type {
  FillBlockType,
  GenerateWorksheetFillInput,
  WorksheetFill,
  WorksheetFillRecipe,
  WorksheetFillSlot,
} from "./generate-worksheet-fill";
export type { ParseBriefFields, ParseBriefInput } from "./parse-brief";
export type { PickOrRequeryInput } from "./pick-or-requery-photo";
export type { PlanFactsInput } from "./plan-facts";
export { type PlanSkeletonInput, SOURCE_INSTRUCTION } from "./plan-skeleton";
export type { ProposeInput } from "./propose";
export type { RepairInput } from "./repair";
export type { RepairFactInput } from "./repair-fact";
export type { Audience, WritingShape } from "./shared";
export { VERB_WRITING, verbBlock } from "./shared";
export { describeRef } from "./source-ref";
export type { VerifyFactsInput } from "./verify-facts";
export {
  cascadePrompt,
  checkInputPrompt,
  evaluatePrompt,
  generateSlidePrompt,
  generateWorksheetFillPrompt,
  generateWorksheetPrompt,
  parseBriefPrompt,
  pickOrRequeryPrompt,
  planFactsPrompt,
  planSkeletonPrompt,
  regeneratePrompt,
  repairFactPrompt,
  repairPrompt,
  shortlistPhotosPrompt,
  verifyFactsPrompt,
};

export const PROMPTS = {
  "check-input": checkInputPrompt,
  "plan-skeleton": planSkeletonPrompt,
  "plan-facts": planFactsPrompt,
  "verify-facts": verifyFactsPrompt,
  "generate-slide": generateSlidePrompt,
  "generate-worksheet": generateWorksheetPrompt,
  "generate-worksheet-fill": generateWorksheetFillPrompt,
  "parse-brief": parseBriefPrompt,
  "pick-or-requery-photo": pickOrRequeryPrompt,
  "shortlist-photos": shortlistPhotosPrompt,
  evaluate: evaluatePrompt,
  repair: repairPrompt,
  "repair-fact": repairFactPrompt,
  cascade: cascadePrompt,
  regenerate: regeneratePrompt,
} as const;
export type PromptName = keyof typeof PROMPTS;

export const PROMPT_VERSIONS = {
  "check-input": checkInputPrompt.version,
  "plan-skeleton": planSkeletonPrompt.version,
  "plan-facts": planFactsPrompt.version,
  "verify-facts": verifyFactsPrompt.version,
  "generate-slide": generateSlidePrompt.version,
  "generate-worksheet": generateWorksheetPrompt.version,
  "generate-worksheet-fill": generateWorksheetFillPrompt.version,
  "parse-brief": parseBriefPrompt.version,
  "pick-or-requery-photo": pickOrRequeryPrompt.version,
  "shortlist-photos": shortlistPhotosPrompt.version,
  evaluate: evaluatePrompt.version,
  repair: repairPrompt.version,
  "repair-fact": repairFactPrompt.version,
  cascade: cascadePrompt.version,
  regenerate: regeneratePrompt.version,
} as const satisfies Record<PromptName, string>;

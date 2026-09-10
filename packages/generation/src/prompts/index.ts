import { checkInputPrompt } from "./check-input";
import { evaluatePrompt } from "./evaluate";
import { generateSlidePrompt } from "./generate-slide";
import { generateWorksheetPrompt } from "./generate-worksheet";
import { pickOrRequeryPrompt } from "./pick-or-requery-photo";
import { planFactsPrompt } from "./plan-facts";
import { planSkeletonPrompt } from "./plan-skeleton";
import { cascadePrompt, regeneratePrompt } from "./propose";
import { repairPrompt } from "./repair";
import { repairFactPrompt } from "./repair-fact";
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
export type { PickOrRequeryInput } from "./pick-or-requery-photo";
export type { PlanFactsInput } from "./plan-facts";
export type { PlanSkeletonInput } from "./plan-skeleton";
export type { ProposeInput } from "./propose";
export type { RepairInput } from "./repair";
export type { RepairFactInput } from "./repair-fact";
export type { Audience } from "./shared";
export type { VerifyFactsInput } from "./verify-facts";
export {
  cascadePrompt,
  checkInputPrompt,
  evaluatePrompt,
  generateSlidePrompt,
  generateWorksheetPrompt,
  pickOrRequeryPrompt,
  planFactsPrompt,
  planSkeletonPrompt,
  regeneratePrompt,
  repairFactPrompt,
  repairPrompt,
  verifyFactsPrompt,
};

export const PROMPTS = {
  "check-input": checkInputPrompt,
  "plan-skeleton": planSkeletonPrompt,
  "plan-facts": planFactsPrompt,
  "verify-facts": verifyFactsPrompt,
  "generate-slide": generateSlidePrompt,
  "generate-worksheet": generateWorksheetPrompt,
  "pick-or-requery-photo": pickOrRequeryPrompt,
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
  "pick-or-requery-photo": pickOrRequeryPrompt.version,
  evaluate: evaluatePrompt.version,
  repair: repairPrompt.version,
  "repair-fact": repairFactPrompt.version,
  cascade: cascadePrompt.version,
  regenerate: regeneratePrompt.version,
} as const satisfies Record<PromptName, string>;

/**
 * SHA-256 of a prompt's text: `system` plus `user(sampleInput)`. The test snapshots this per
 * version so a wording change without a version bump fails CI (ADR 0025 §17).
 */
export function promptHash(name: PromptName, sampleInput: unknown): string {
  const prompt = PROMPTS[name] as { system: string; user: (input: never) => string };
  const text = `${prompt.system}\n---\n${prompt.user(sampleInput as never)}`;
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

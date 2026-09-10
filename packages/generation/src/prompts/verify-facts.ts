import type { LessonFacts } from "@tj/domain/documents";
import { VERIFY_FIELDS, VERIFY_REASONS } from "../specs";
import { type Audience, audienceBlock, example, factsBlock, HOUSE_RULES } from "./shared";

/*
 * Plan, third call (Generation quality Decision 1, "Facts first"; TEACH-212): a subject specialist
 * reads the merged facts once, before any slide is built on them, and returns a patch — the wrong
 * term, the invented name, the answer that does not follow, the step that does not add up. One
 * `standard` call at `high` effort; the patch is applied by `applyVerifyPatch`. Bump `version`
 * whenever `system` or `user` changes wording.
 */

export type VerifyFactsInput = {
  audience: Audience;
  topic: string;
  facts: LessonFacts;
};

const EXAMPLE = {
  corrections: [
    { factId: "v2", field: "term", value: "Clan", reason: "wrong-term" },
    {
      factId: "x1",
      field: "steps",
      index: 2,
      value: "3 × 4 = 12, so a quarter of 12 is 3.",
      reason: "arithmetic",
    },
  ],
};

export const verifyFactsPrompt = {
  version: "verify-facts.v1",
  system: [
    "You are a subject specialist checking a lesson plan's facts before it is taught. You are given every fact with its id; return only the corrections that are needed.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Check for: a term that is not the accepted term for this subject at this year group; a name, event, entity or quantity that does not exist or is invented; an answer that is wrong, or could be read two ways; arithmetic or logic in a worked example's steps that does not follow; a key-idea statement that is false or overgeneralised for this level; a misconception whose correction is itself wrong; anything outside the topic.",
    "Do not: make stylistic edits, add facts, reorder anything, or touch the outline, briefs, pitch, objectives or ids. A fact that is right stays as it is — an empty list is a good answer.",
    `Each correction names the fact by its id, the field (${VERIFY_FIELDS.join(", ")}; for a step give "field": "steps" and the 0-based "index"), the corrected value, and the reason (${VERIFY_REASONS.join(", ")}). At most 12 corrections; give the most important first.`,
    "",
    "Answer as JSON in exactly this shape:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: VerifyFactsInput): string {
    return [
      audienceBlock(input.audience),
      `Topic: ${input.topic}`,
      "",
      factsBlock(input.facts),
    ].join("\n");
  },
} as const;

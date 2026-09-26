import type { LessonFacts } from "@tj/domain/documents";
import { VERIFY_FIELDS, VERIFY_LIMITS, VERIFY_REASONS } from "../specs";
import { type Audience, audienceBlock, example, factsBlock, houseRules } from "./shared";

/*
 * Plan, third call (Generation quality Decision 1, "Facts first"; TEACH-212): a subject specialist
 * reads the merged facts once, before any slide is built on them, and returns a patch — the wrong
 * term, the invented name, the answer that does not follow, the step that does not add up. One
 * `standard` call at `low` effort (`stages/verify.ts`); the patch is applied by `applyVerifyPatch`.
 * Bump `version` whenever `system` or `user` changes wording.
 *
 * v3 (24 Sept 2026 audit, FIX-PLAN B1/B2/B5): British English and no names (ADR 0024) are the only house rules (the pitch
 * rule invited restyling labelled "ambiguous"; the `factRefs` rule has no field here). "An empty
 * list is a good answer" let two low-effort calls return `[]` in a second without checking; it now
 * says when an empty list is right. The per-field caps are stated from `VERIFY_LIMITS` (a third of
 * lessons retried on an unstated cap, and one retry dropped its corrections). A one-line field map
 * says which rendered text is which field (a question's rendered answer and distractors were
 * pasted into `answer`). "the outline, briefs, pitch, objectives or ids" went: the schema admits
 * no such field.
 *
 * v4 (A6): distractors are a correctable field, given by index like steps.
 *
 * v5 (25 Sept 2026, luna-direct checklist): 7 multiple-choice or "name one" items on gpt-6-luna low
 * had a second defensible answer and verify corrected none of them. It now checks for a distractor
 * that is also right (reason "wrong-answer", corrected by index as v4 allows).
 *
 * v6 (l6c, luna-direct change 4): the user turn lists the starter's retrieval set as `r1`–`rN`
 * lines when there is one (9 of 38 false claims came from the starter). The field map names their
 * fields; the existing checks cover the faults, and an off-topic correction on one is dropped in code.
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
  version: "verify-facts.v6",
  system: [
    "You are a subject specialist checking a lesson plan's facts before it is taught. You are given every fact with its id; return only the corrections that are needed.",
    "",
    "Rules:",
    houseRules("british", "names"),
    "Check for: a term that is not the accepted term for this subject at this year group; a name, event, entity or quantity that does not exist or is invented; an answer that is wrong, or could be read two ways; a distractor that is also right; arithmetic or logic in a worked example's steps that does not follow; a key-idea statement that is false or overgeneralised for this level; a misconception whose correction is itself wrong; anything outside the topic.",
    "Do not make stylistic edits, add facts or reorder anything. Return an empty list only when every answer and step checks out.",
    "Field map: a key idea reads `statement — explanation`, a misconception `believes <belief>; correct: <correction>`, vocabulary `term — definition`, a worked example `problem` then its steps (step 1 is index 0), a question `stem`, then its distractors (the first is index 0), a starter question `question — answer` (fields stem, answer); every other field is labelled.",
    `Each correction names the fact by its id, the field (${VERIFY_FIELDS.join(", ")}; for a step or a distractor also give the 0-based "index"), the corrected value, and the reason (${VERIFY_REASONS.join(", ")}). At most 12 corrections; give the most important first.`,
    `Length limits (characters): ${Object.entries(VERIFY_LIMITS)
      .map(([field, max]) => `${field} ${max}`)
      .join(", ")}.`,
    "",
    "Answer as JSON in exactly this shape:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: VerifyFactsInput): string {
    // l6c (DIAGNOSIS FM5): the starter's retrieval set, as `r<n>` lines after the facts. Kept out
    // of `factsBlock`, which slide, evaluate and repair share, so their prompts do not move; with
    // no retrieval set this prompt is unchanged too.
    const retrieval = input.facts.retrieval ?? [];
    return [
      audienceBlock(input.audience),
      `Topic: ${input.topic}`,
      "",
      factsBlock(input.facts),
      ...(retrieval.length > 0
        ? [
            "Starter questions (earlier learning, not this lesson):",
            ...retrieval.map((r, i) => `  r${i + 1}: ${r.question} — ${r.answer}`),
          ]
        : []),
    ].join("\n");
  },
} as const;

import type { LessonFacts } from "@tj/domain/documents";
import { VERIFY_FIELDS, VERIFY_REASONS } from "../specs";
import { type Audience, audienceBlock, example, factsBlock, houseRules } from "./shared";

/*
 * Repair — the fact (Generation quality §4, "Facts first"; TEACH-216): when Evaluate says a slide
 * or block is wrong because the fact under it is wrong (`fact-consistency` with a `factId`), the
 * fact is corrected before the artefact is regenerated, so the two do not drift apart again. Same
 * correction shape as Verify (`VerifyOutputSchema`), applied by `applyVerifyPatch`; one `small`
 * call at `low` effort. Bump `version` whenever `system` or `user` changes wording.
 *
 * v4 (24 Sept 2026 audit, FIX-PLAN B1/B6): the call is told the quotes are the slide's text and
 * may return no correction when the fact is right and only the slide is wrong (in 3 of 8 lab calls
 * the review said the slide overstated the fact, and the fact was rewritten anyway). House rules:
 * British English and no names only (it writes fact text, no `factRefs`, no restyling). v5 (A6):
 * distractors are a correctable field, by index like steps.
 */

export type RepairFactInput = {
  audience: Audience;
  /** Only the fact in question and what it links to, as `factsBlock` renders them. */
  facts: LessonFacts;
  factId: string;
  /** The fields `applyVerifyPatch` may correct on this fact (`VERIFY_FIELDS_BY_ARRAY`). */
  fields: readonly string[];
  /** What Evaluate said, and the text it quoted. */
  findings: { message: string; evidence?: string | undefined }[];
};

export const repairFactPrompt = {
  version: "repair-fact.v5",
  system: [
    'A review found a slide wrong about one fact in a lesson plan. You check that fact, given with its id and fields, and return only the corrections needed to make it right. If the fact is right and only the slide is wrong, return {"corrections": []}.',
    "",
    "Rules:",
    houseRules("british", "names"),
    "Change only the field or fields the review shows to be wrong; keep the rest, and make no stylistic edits. Do not add, remove or reorder facts.",
    `Each correction names the fact by its id, the field (${VERIFY_FIELDS.join(", ")}; for a step or a distractor also give the 0-based "index"), the corrected value, and the reason (${VERIFY_REASONS.join(", ")}). At most 3 corrections.`,
    "",
    "Answer as JSON in exactly this shape:",
    example({
      corrections: [{ factId: "v2", field: "term", value: "Clan", reason: "wrong-term" }],
    }),
  ].join("\n"),
  user(input: RepairFactInput): string {
    return [
      audienceBlock(input.audience),
      "",
      factsBlock(input.facts),
      "",
      `What the review said about ${input.factId}, quoting the slide:`,
      ...input.findings.map(
        (f) => `- ${f.message}${f.evidence ? ` — the slide says: "${f.evidence}"` : ""}`,
      ),
      "",
      `Fields you may correct on ${input.factId}: ${input.fields.join(", ")}.`,
      "",
      "Answer with the corrections JSON.",
    ].join("\n");
  },
} as const;

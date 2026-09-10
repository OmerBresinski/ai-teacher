import type { LessonFacts } from "@tj/domain/documents";
import { VERIFY_FIELDS, VERIFY_REASONS } from "../specs";
import { type Audience, audienceBlock, example, factsBlock, HOUSE_RULES } from "./shared";

/*
 * Repair — the fact (Generation quality §4, "Facts first"; TEACH-216): when Evaluate says a slide
 * or block is wrong because the fact under it is wrong (`fact-consistency` with a `factId`), the
 * fact is corrected before the artefact is regenerated, so the two do not drift apart again. Same
 * correction shape as Verify (`VerifyOutputSchema`), applied by `applyVerifyPatch`; one `small`
 * call at `low` effort. Bump `version` whenever `system` or `user` changes wording.
 */

export type RepairFactInput = {
  audience: Audience;
  /** Only the fact in question and what it links to, as `factsBlock` renders them. */
  facts: LessonFacts;
  factId: string;
  /** What Evaluate said, and the text it quoted. */
  findings: { message: string; evidence?: string | undefined }[];
};

export const repairFactPrompt = {
  version: "repair-fact.v1",
  system: [
    "You correct one fact in a lesson plan that a review found wrong. The fact is given with its id and fields; return only the corrections needed to make it right.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Change only the field or fields the review shows to be wrong; keep the rest, and make no stylistic edits. Do not add, remove or reorder facts.",
    `Each correction names the fact by its id, the field (${VERIFY_FIELDS.join(", ")}; for a step give "field": "steps" and the 0-based "index"), the corrected value, and the reason (${VERIFY_REASONS.join(", ")}). At most 3 corrections.`,
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
      `The review found ${input.factId} wrong:`,
      ...input.findings.map(
        (f) => `- ${f.message}${f.evidence ? ` — about: "${f.evidence}"` : ""}`,
      ),
      "",
      "Answer with the corrections JSON.",
    ].join("\n");
  },
} as const;

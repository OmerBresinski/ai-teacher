import type { Finding, LessonFacts } from "@tj/domain/documents";
import { LessonFactsSchema } from "@tj/domain/documents";
import {
  type VerifyCorrection,
  type VerifyField,
  type VerifyReason,
  verifiableArrayOf,
} from "../specs";

/*
 * Verify (Generation quality, Decision 1; TEACH-212): the patch the subject-specialist call
 * returns, applied to the merged `LessonFacts` before anything is generated. Pure: a new facts
 * object, the input untouched, the result parsed by `LessonFactsSchema` so a correction can never
 * leave the facts invalid. Same semantics as the editor's `updateFact` reducer, which
 * `@tj/generation` cannot import (ADR 0013). Called from `plan()`; not a pipeline stage.
 */

/** What the residual badge says for each reason; never the corrected text (ADR 0015). */
const REASON_LABEL: Record<VerifyReason, string> = {
  "wrong-term": "not the accepted term",
  invented: "named something that does not exist",
  "wrong-answer": "the answer was wrong",
  arithmetic: "the working did not add up",
  "false-statement": "the statement was false or overgeneralised",
  "off-topic": "outside the topic",
  ambiguous: "could be read two ways",
};

/** The fact kind as the teacher reads it, with the field. */
const KIND_LABEL: Record<Exclude<ReturnType<typeof verifiableArrayOf>, undefined>, string> = {
  keyIdeas: "Key idea",
  vocabulary: "Vocabulary",
  workedExamples: "Worked example",
  questions: "Question",
  misconceptions: "Misconception",
};

const FIELD_LABEL: Record<VerifyField, string> = {
  term: "term",
  definition: "definition",
  problem: "problem",
  steps: "step",
  answer: "answer",
  stem: "stem",
  reasoning: "reasoning",
  statement: "statement",
  explanation: "explanation",
  example: "example",
  analogy: "analogy",
  belief: "belief",
  correction: "correction",
};

/** The content-free finding one applied correction leaves on the lesson. */
export function verifyFinding(correction: VerifyCorrection): Finding {
  const array = verifiableArrayOf(correction.factId);
  const kind = array ? KIND_LABEL[array] : "Fact";
  return {
    check: "fact-verify",
    severity: "warning",
    target: { factId: correction.factId },
    message: `${kind} ${FIELD_LABEL[correction.field]} corrected: ${REASON_LABEL[correction.reason]}.`,
  };
}

/** The finding recorded when the Verify call itself could not be completed. */
export const VERIFY_FAILED_FINDING: Finding = {
  check: "fact-verify",
  severity: "warning",
  target: {},
  message: "Fact verification could not be completed.",
};

/**
 * Apply the corrections in order. A correction naming an unknown id, a field its kind lacks or a
 * step that does not exist is skipped (the schema factory refuses them before this runs; skipping
 * keeps the function total). Returns the parsed facts and the corrections that took effect.
 */
export function applyVerifyPatch(
  facts: LessonFacts,
  corrections: readonly VerifyCorrection[],
): { facts: LessonFacts; applied: VerifyCorrection[] } {
  const next: LessonFacts = structuredClone(facts);
  const applied: VerifyCorrection[] = [];
  for (const c of corrections) {
    const array = verifiableArrayOf(c.factId);
    if (!array) continue;
    const list = next[array] as { id: string }[] | undefined;
    const fact = list?.find((f) => f.id === c.factId) as Record<string, unknown> | undefined;
    if (!fact) continue;
    if (c.field === "steps") {
      const steps = fact.steps;
      if (!Array.isArray(steps) || c.index === undefined || c.index >= steps.length) continue;
      steps[c.index] = c.value;
    } else {
      if (!(c.field in fact) && c.field !== "analogy") continue;
      fact[c.field] = c.value;
    }
    applied.push(c);
  }
  return { facts: LessonFactsSchema.parse(next), applied };
}

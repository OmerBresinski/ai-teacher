import type { Finding, LessonFacts } from "@tj/domain/documents";
import { LessonFactsSchema } from "@tj/domain/documents";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { numericFindings } from "../numeric-check";
import { type Audience, verifyFactsPrompt } from "../prompts";
import {
  retrievalIndexOf,
  type VerifyCorrection,
  type VerifyField,
  type VerifyReason,
  verifiableArrayOf,
  verifyOutputSchemaFor,
} from "../specs";
import { BudgetExceeded, type PipelineDeps, StageFailure, type VerifyResult } from "../types";
import { BUDGET_FINDING } from "./shared";

/*
 * Verify (Generation quality, Decision 1; TEACH-212, TEACH-233): the subject-specialist call over
 * the merged `LessonFacts` and the patch it returns. `applyVerifyPatch` is pure: a new facts
 * object, the input untouched, the result parsed by `LessonFactsSchema` so a correction can never
 * leave the facts invalid. Same semantics as the editor's `updateFact` reducer, which
 * `@tj/generation` cannot import (ADR 0013). `runVerify` is the call: started by `plan()` after
 * the facts call and awaited by `generate()` before its first persist, so the Verify latency is
 * spent alongside the first slide batch; a lesson resumed at `planned` without the promise starts
 * it in `generate()` itself. Not a pipeline stage.
 */

export type { VerifyResult };

/**
 * The Verify call and its patch. A cap stop records the budget finding and leaves the facts as they
 * are; two schema misses (or a provider fault) record `VERIFY_FAILED_FINDING`; a cancel settles
 * with the facts untouched and no finding — the stage awaiting it checks the signal itself. One
 * `fact-verify` warning per applied correction, content-free. Then the numeric check (code,
 * `numeric-check.ts`) over the facts it hands on, whatever the call did: one `fact-verify` warning
 * per equality whose sides disagree, with the equality as evidence. Logged under `stage: "plan"`:
 * it is Plan's third call whichever stage awaits it.
 */
export async function runVerify(
  facts: LessonFacts,
  briefInput: { topic: string; audience: Audience },
  deps: PipelineDeps,
  /** Plan's class for this lesson (`planClassFor`, TEACH-259): Verify runs where the facts were written. */
  cls: "frontier" | "standard",
): Promise<VerifyResult> {
  deps.logger.info({ stage: "plan", call: "verify", cls }, "plan call");
  const startedAt = Date.now();
  try {
    const call = await callStructured({
      deps,
      stage: "plan",
      cls,
      effort: "low",
      prompt: verifyFactsPrompt,
      input: { audience: briefInput.audience, topic: briefInput.topic, facts },
      schema: verifyOutputSchemaFor(facts),
      maxOutputTokens: MAX_OUTPUT_TOKENS.verify,
    });
    const patched = applyVerifyPatch(facts, call.output.corrections);
    deps.logger.info(
      {
        stage: "plan",
        call: "verify",
        corrections: patched.applied.length,
        durationMs: Date.now() - startedAt,
      },
      "facts verified",
    );
    const verified = patched.applied.length > 0 ? patched.facts : facts;
    return {
      facts: verified,
      applied: patched.applied,
      findings: [...patched.applied.map(verifyFinding), ...numericFindings(verified)],
    };
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      return {
        facts,
        applied: [],
        findings: [BUDGET_FINDING(error.by, "fact verification"), ...numericFindings(facts)],
      };
    }
    if (error instanceof Error && error.name === "AbortError") {
      return { facts, applied: [], findings: [] };
    }
    deps.logger.warn(
      { stage: "plan", call: "verify", err: error instanceof StageFailure ? undefined : error },
      "fact verification failed; facts kept",
    );
    return { facts, applied: [], findings: [VERIFY_FAILED_FINDING, ...numericFindings(facts)] };
  }
}

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
  distractors: "distractor",
  statement: "statement",
  explanation: "explanation",
  example: "example",
  analogy: "analogy",
  belief: "belief",
  correction: "correction",
};

/** The content-free finding one applied correction leaves on the lesson. */
export function verifyFinding(correction: VerifyCorrection): Finding {
  // A starter question is not a fact: no id the editor can open, so the finding targets the lesson.
  if (retrievalIndexOf(correction.factId) !== undefined) {
    return {
      check: "fact-verify",
      severity: "warning",
      target: {},
      message: `Starter question ${correction.field === "stem" ? "question" : "answer"} corrected: ${REASON_LABEL[correction.reason]}.`,
    };
  }
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
 * Apply the corrections in order. Every correction is first checked against the facts with the same
 * factory the model's answer went through (`verifyOutputSchemaFor`), so a direct caller cannot
 * bypass the field, index and per-field limit rules: an invalid correction is skipped, never
 * applied. Returns the parsed facts and the corrections that took effect.
 */
export function applyVerifyPatch(
  facts: LessonFacts,
  corrections: readonly VerifyCorrection[],
): { facts: LessonFacts; applied: VerifyCorrection[] } {
  const next: LessonFacts = structuredClone(facts);
  const applied: VerifyCorrection[] = [];
  const schema = verifyOutputSchemaFor(facts);
  for (const c of corrections) {
    if (!schema.safeParse({ corrections: [c] }).success) continue;
    const r = retrievalIndexOf(c.factId);
    if (r !== undefined) {
      // l6c: a starter tests earlier learning, outside this lesson's topic by design, so an
      // off-topic correction on it is dropped here rather than excepted in the prompt.
      const item = next.retrieval?.[r];
      if (!item || c.reason === "off-topic") continue;
      if (c.field === "stem") item.question = c.value;
      else if (c.field === "answer") item.answer = c.value;
      else continue;
      applied.push(c);
      continue;
    }
    const array = verifiableArrayOf(c.factId);
    if (!array) continue;
    const list = next[array] as { id: string }[] | undefined;
    const fact = list?.find((f) => f.id === c.factId) as Record<string, unknown> | undefined;
    if (!fact) continue;
    if (c.field === "steps") {
      const steps = fact.steps;
      if (!Array.isArray(steps) || c.index === undefined || c.index >= steps.length) continue;
      steps[c.index] = c.value;
    } else if (c.field === "distractors") {
      const distractors = fact.distractors as { text: string }[] | undefined;
      const distractor = c.index === undefined ? undefined : distractors?.[c.index];
      if (!distractor) continue;
      distractor.text = c.value;
    } else {
      if (!(c.field in fact) && c.field !== "analogy") continue;
      fact[c.field] = c.value;
    }
    applied.push(c);
  }
  return { facts: LessonFactsSchema.parse(next), applied };
}

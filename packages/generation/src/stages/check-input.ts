import { type Finding, findNamePatterns } from "@tj/domain/documents";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { checkInputPrompt } from "../prompts";
import { CheckInputOutputSchema } from "../specs";
import {
  INPUT_CHECK_MESSAGES,
  InputRejected,
  type PipelineDeps,
  type PipelineState,
} from "../types";
import { audienceOf } from "./shared";

/*
 * Check input (TEACH-137; ADR 0024 §2, F15-R03, principle P6): the pipeline's first step. Before
 * anything is persisted or planned, the Brief's free text is screened twice — the deterministic
 * Identifier guard (`findNamePatterns`, already enforced by the schema, kept as belt and braces)
 * and one `small` model call that catches what a regex cannot: a bare name used as a pupil's,
 * unsafe content, or a request that is not a lesson. Any `error` finding stops the run with
 * `InputRejected`; the worker maps it to a non-retryable failure. Writes no checkpoint and never
 * logs the text (ADR 0015): only `{ stage, findings: n }`.
 */

/** The Identifier guard's structural hit, in the shared `Finding` shape. */
const GUARD_FINDING: Finding = {
  check: "learner-name",
  severity: "error",
  target: {},
  message: INPUT_CHECK_MESSAGES["learner-name"],
};

/** Every free-text field of the Brief and its class context, in one list. */
function briefTexts(brief: NonNullable<PipelineState["lesson"]["brief"]>): string[] {
  return [
    brief.topic,
    ...Object.values(brief.answers ?? {}),
    brief.classContext?.priorKnowledge,
    brief.classContext?.notes,
  ].filter((t): t is string => typeof t === "string" && t.length > 0);
}

export async function checkInput(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const brief = state.lesson.brief;
  if (!brief) throw new Error("check-input: the lesson has no brief");

  // A structural hit is a learner identifier in the text (an email, an id number, "a pupil
  // called …"): that text must not reach a model at all (ADR 0024 §2, principle P6), so the
  // model call is skipped, not added to.
  const structural = briefTexts(brief).some((text) => findNamePatterns(text).length > 0);
  const findings: Finding[] = structural ? [GUARD_FINDING] : [];

  if (!structural) {
    const call = await callStructured({
      deps,
      stage: "check-input",
      cls: "small",
      prompt: checkInputPrompt,
      input: { topic: brief.topic, answers: brief.answers, audience: audienceOf(state.lesson) },
      schema: CheckInputOutputSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS.checkInput,
    });
    findings.push(...call.output.findings);
  }

  deps.logger.info({ stage: "check-input", findings: findings.length }, "input checked");
  if (findings.length > 0) throw new InputRejected(findings);
  return state;
}

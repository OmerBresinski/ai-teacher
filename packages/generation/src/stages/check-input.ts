import { type Finding, findNamePatterns } from "@tj/domain/documents";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { checkInputPrompt } from "../prompts";
import { CheckInputOutputSchema } from "../specs";
import { InputRejected, type PipelineDeps, type PipelineState } from "../types";
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

/** The message the Identifier guard's structural hit carries; the model's own is used otherwise. */
const GUARD_FINDING: Finding = {
  check: "learner-name",
  severity: "error",
  target: {},
  message:
    "The brief contains a pupil identifier (an email, a number or a named pupil). Please reword it without identifying anyone.",
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

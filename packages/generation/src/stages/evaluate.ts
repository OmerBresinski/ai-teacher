import { checkLesson, type Finding } from "@tj/domain/documents";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { evaluatePrompt } from "../prompts";
import { EvaluateOutputSchema } from "../specs";
import { BudgetExceeded, type PipelineDeps, type PipelineState, StageFailure } from "../types";
import { BUDGET_FINDING, withUsage } from "./generate";
import { audienceOf, blockText, generationOf, slideText } from "./shared";

/*
 * Evaluate (ADR 0025 §10, §11, §14): the shared schema checks, then one `small` call over the
 * facts and the plain-text projection of every slide and block. Model findings are appended;
 * a schema miss twice, or the budget, is recorded as a finding — Evaluate never fails the job.
 */

/** Findings a model may return are trusted only where they point at something that exists. */
function knownTargetsOnly(findings: Finding[], state: PipelineState): Finding[] {
  const slideIds = new Set(state.lesson.slides.map((s) => s.id));
  const blockIds = new Set(state.worksheet?.blocks.map((b) => b.id) ?? []);
  return findings.filter((f) => {
    if (f.target.slideId !== undefined && !slideIds.has(f.target.slideId)) return false;
    if (f.target.blockId !== undefined && !blockIds.has(f.target.blockId)) return false;
    return true;
  });
}

export async function evaluate(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const { lesson, worksheet } = state;
  const facts = lesson.facts;
  if (!facts) throw new Error("evaluate: the lesson has no facts; Plan has not run");
  const generation = generationOf(lesson);
  // Findings Generate recorded (a budget stop) survive; everything else is recomputed here.
  const carried = generation.findings.filter((f) => f.check === "budget");
  const schema = checkLesson(lesson, worksheet);

  let model: Finding[] = [];
  if (!deps.signal.aborted) {
    try {
      const call = await callStructured({
        deps,
        stage: "evaluate",
        cls: "small",
        prompt: evaluatePrompt,
        input: {
          facts,
          audience: audienceOf(lesson),
          slides: lesson.slides.map((s) => ({ id: s.id, kind: s.kind, text: slideText(s) })),
          blocks: (worksheet?.blocks ?? []).map((b) => ({
            id: b.id,
            type: b.type,
            text: blockText(b),
          })),
        },
        schema: EvaluateOutputSchema,
        maxOutputTokens: MAX_OUTPUT_TOKENS.evaluate,
      });
      model = knownTargetsOnly(call.output.findings, state);
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        model = [BUDGET_FINDING(error.by, "the review")];
      } else if (error instanceof StageFailure) {
        model = [
          {
            check: "evaluate",
            severity: "warning",
            target: {},
            message:
              "The automatic review could not be completed; the schema checks below still ran.",
          },
        ];
      } else {
        throw error;
      }
    }
  }

  const next = withUsage(
    {
      ...lesson,
      generation: {
        ...generation,
        stage: "evaluated",
        promptVersions: { ...generation.promptVersions, evaluated: evaluatePrompt.version },
        findings: [...carried, ...schema, ...model],
      },
    },
    deps,
  );
  const { updatedAt } = await deps.persist(next, worksheet);
  await deps.onProgress(90, "Reviewed", updatedAt);
  return { ...state, lesson: next };
}

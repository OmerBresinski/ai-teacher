import { checkLesson, type Finding, type Slide } from "@tj/domain/documents";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { evaluatePrompt } from "../prompts";
import { EvaluateOutputSchema } from "../specs";
import {
  BudgetExceeded,
  type PipelineDeps,
  type PipelineState,
  StageFailure,
  throwIfAborted,
} from "../types";
import { BUDGET_FINDING, withUsage } from "./generate";
import { audienceOf, blockText, generationOf, slideText } from "./shared";

/*
 * Evaluate (ADR 0025 §10, §11, §14; Generation quality §4, TEACH-216): the shared schema checks,
 * then one `standard` call over the facts and the plain-text projection of every slide (with its
 * notes) and block. The model's findings name a check from a closed set and quote the text they
 * are about; a finding whose target does not exist, or whose evidence is not in that target's
 * text, is dropped rather than retried (a vague finding is the failure this guards against).
 * Model findings are appended; a schema miss twice, or the budget, is recorded as a finding —
 * Evaluate never fails the job.
 */

/**
 * Findings a model may return are trusted only where they point at something that exists and quote
 * text that is really there (case and whitespace aside). Returns the kept findings and the count
 * dropped — the count is logged, never the text (ADR 0015).
 */
export function knownTargetsWithEvidence(
  findings: Finding[],
  state: PipelineState,
): { kept: Finding[]; dropped: number } {
  const slideText_ = new Map(state.lesson.slides.map((s) => [s.id, haystack(s)]));
  const blockText_ = new Map(
    (state.worksheet?.blocks ?? []).map((b) => [b.id, normalise(blockText(b))]),
  );
  const kept = findings.filter((f) => {
    const { slideId, blockId } = f.target;
    if (slideId !== undefined && !slideText_.has(slideId)) return false;
    if (blockId !== undefined && !blockText_.has(blockId)) return false;
    if (f.evidence === undefined) return true;
    const needle = normalise(f.evidence);
    if (slideId !== undefined) return slideText_.get(slideId)?.includes(needle) ?? false;
    if (blockId !== undefined) return blockText_.get(blockId)?.includes(needle) ?? false;
    // A lesson-level finding (no target) may quote a fact.
    return normalise(factsText(state)).includes(needle);
  });
  return { kept, dropped: findings.length - kept.length };
}

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
/** What a slide finding may quote: the slide's text, its notes and the facts (a wrong fact). */
const haystack = (slide: Slide) => normalise(`${slideText(slide)}\n${slide.notes ?? ""}`);
function factsText(state: PipelineState): string {
  return JSON.stringify(state.lesson.facts ?? {});
}

/** Checks an earlier stage recorded that Evaluate keeps as they are. */
const CARRIED_CHECKS: ReadonlySet<string> = new Set(["budget", "image", "fact-verify"]);

export async function evaluate(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const { lesson, worksheet } = state;
  const facts = lesson.facts;
  if (!facts) throw new Error("evaluate: the lesson has no facts; Plan has not run");
  const generation = generationOf(lesson);
  // Findings Generate recorded (a budget stop) survive, as do illustrate's image warnings and
  // Verify's fact corrections — none is recomputable here; everything else is recomputed below.
  const carried = generation.findings.filter((f) => CARRIED_CHECKS.has(f.check));
  const schema = checkLesson(lesson, worksheet);

  let model: Finding[] = [];
  try {
    const call = await callStructured({
      deps,
      stage: "evaluate",
      cls: "standard",
      effort: "medium",
      prompt: evaluatePrompt,
      input: {
        facts,
        audience: audienceOf(lesson),
        slides: lesson.slides.map((s) => ({
          id: s.id,
          kind: s.kind,
          text: slideText(s),
          notes: s.notes,
        })),
        blocks: (worksheet?.blocks ?? []).map((b) => ({
          id: b.id,
          type: b.type,
          text: blockText(b),
        })),
      },
      schema: EvaluateOutputSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS.evaluate,
    });
    const filtered = knownTargetsWithEvidence(call.output.findings, state);
    model = filtered.kept;
    if (filtered.dropped > 0) {
      deps.logger.info({ stage: "evaluate", dropped: filtered.dropped }, "findings dropped");
    }
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      // One budget finding per job: Generate's already says the cap was hit.
      model = carried.length > 0 ? [] : [BUDGET_FINDING(error.by, "the review")];
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

  throwIfAborted(deps.signal);
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

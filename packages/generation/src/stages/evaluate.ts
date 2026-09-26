import { checkLesson, FACT_ARRAYS, type Finding, type LessonFacts } from "@tj/domain/documents";
import { callStructured, MAX_OUTPUT_TOKENS, SPEC_RULE_CHECK } from "../call";
import { NUMERIC_MESSAGE, numericFactMismatches } from "../numeric-check";
import { isCodeBuilt, isRetrievalStarter } from "../planner/coded-slides";
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
import {
  audienceOf,
  blockText,
  generationOf,
  normaliseText,
  photoThumbnails,
  retrievalInput,
  shapeOf,
  slideHaystack,
  slideText,
} from "./shared";

/*
 * Evaluate (ADR 0025 §10, §11, §14; Generation quality §4, TEACH-216): the shared schema checks,
 * then one `standard` call over the facts and the plain-text projection of every slide (with its
 * notes) and block. The model's findings name a check from a closed set and quote the text they
 * are about; a finding whose target does not exist, or whose evidence is not in that target's
 * text, is dropped rather than retried (a vague finding is the failure this guards against), as is
 * a `verb-fit` finding on a slide kind the verb never reaches (`verbFitApplies`, TEACH-262).
 * Model findings are appended; a schema miss twice, or the budget, is recorded as a finding —
 * Evaluate never fails the job.
 */

/**
 * Findings a model may return are trusted only where they point at something that exists and quote
 * text that is really there (case and whitespace aside). A `target.factId` that names no patchable
 * fact (unknown, or an objective) is removed from the finding rather than dropping it: the
 * artefact finding stands, Repair just has no fact to patch. Returns the kept findings and the
 * count dropped — the count is logged, never the text (ADR 0015).
 */
export function knownTargetsWithEvidence(
  findings: Finding[],
  state: PipelineState,
): { kept: Finding[]; dropped: number } {
  const slideText_ = new Map(state.lesson.slides.map((s) => [s.id, haystack(s)]));
  const blockText_ = new Map(
    (state.worksheet?.blocks ?? []).map((b) => [b.id, normalise(blockText(b))]),
  );
  const patchable = patchableFactIds(state.lesson.facts);
  const kept = findings
    .filter((f) => {
      const { slideId, blockId } = f.target;
      if (slideId !== undefined && !slideText_.has(slideId)) return false;
      if (blockId !== undefined && !blockText_.has(blockId)) return false;
      if (f.evidence === undefined) return true;
      const needle = normalise(f.evidence);
      if (slideId !== undefined) return slideText_.get(slideId)?.includes(needle) ?? false;
      if (blockId !== undefined) return blockText_.get(blockId)?.includes(needle) ?? false;
      // A lesson-level finding (no target) may quote a fact.
      return normalise(factsText(state)).includes(needle);
    })
    .map((f) => {
      const { factId, ...rest } = f.target;
      if (factId === undefined || patchable.has(factId)) return f;
      return { ...f, target: rest };
    });
  return { kept, dropped: findings.length - kept.length };
}

/**
 * A picture task pupils cannot do (TEACH-227): on a slide whose purpose is to look at the
 * photograph (`identify-parts`, `observe`), an `image-fit` finding is an error with a regenerate
 * fix, so Repair rewrites the text to what is visible. Any other finding is returned as is.
 */
function imageFitAsError(finding: Finding, state: PipelineState): Finding {
  if (finding.check !== "image-fit" || finding.target.slideId === undefined) return finding;
  const index = state.lesson.slides.findIndex((s) => s.id === finding.target.slideId);
  const purpose = state.lesson.facts?.outline[index]?.imageBrief?.purpose;
  if (purpose !== "identify-parts" && purpose !== "observe") return finding;
  return { ...finding, severity: "error", fix: { kind: "regenerate-slide" } };
}

/**
 * Numeric mismatches as errors Repair acts on (w0b): Verify records each one as a `fact-verify`
 * warning on the fact, which Repair never reads (it acts on errors that name a slide or block).
 * Here each mismatch in the current facts becomes a `fact-consistency` error on every slide built
 * from that fact (its outline entry's references or its elements' stamps), naming the fact, so
 * Repair patches the fact through `repair-fact` and regenerates the slide from it. A mismatch no
 * slide cites stays a warning. Verify's numeric warnings are replaced by these, never doubled.
 */
export function numericAsErrors(state: PipelineState): Finding[] {
  const facts = state.lesson.facts;
  if (!facts) return [];
  const out: Finding[] = [];
  for (const m of numericFactMismatches(facts)) {
    // Lab r4: the retrieval starter carries its entry's refs but prints none of them.
    const citing = state.lesson.slides.filter(
      (slide, i) =>
        !isRetrievalStarter(slide, facts) &&
        (facts.outline[i]?.factRefs.includes(m.factId) ||
          slide.elements.some((e) => e.generatedFrom?.factRefs.includes(m.factId))),
    );
    if (citing.length === 0) {
      out.push({
        check: "fact-verify",
        severity: "warning",
        target: { factId: m.factId },
        message: NUMERIC_MESSAGE,
        evidence: m.text,
      });
      continue;
    }
    for (const slide of citing)
      out.push({
        check: "fact-consistency",
        severity: "error",
        target: { slideId: slide.id, factId: m.factId },
        message: NUMERIC_MESSAGE,
        evidence: m.text,
      });
  }
  return out;
}

/** Slide kinds every lesson has whatever its verb: the shape never asks them to serve it. */
const VERB_FIT_EXEMPT_KINDS: ReadonlySet<string> = new Set([
  "title",
  "objectives",
  "starter",
  "vocabulary",
]);

/**
 * Whether a `verb-fit` finding can be right about its target (TEACH-262): on a title, objectives,
 * starter or vocabulary slide it never can — those slides serve no verb — so it is dropped and
 * counted with the other dropped findings. A `content`, `true-false` or worksheet finding needs
 * the model's judgement and stands; the prompt's exemptions cover those. Any other check applies.
 */
export function verbFitApplies(finding: Finding, state: PipelineState): boolean {
  if (finding.check !== "verb-fit" || finding.target.slideId === undefined) return true;
  const slide = state.lesson.slides.find((s) => s.id === finding.target.slideId);
  return slide === undefined || !VERB_FIT_EXEMPT_KINDS.has(slide.kind);
}

/**
 * Lab r4: whether a `fact-consistency` finding can be right about its target. On the retrieval
 * starter (`isRetrievalStarter`) it never can: its questions are earlier lessons' by design, so
 * "the facts do not define …" is the check reading a slide the facts were never meant to cover
 * (r3-h-y9-coasts-L). It is dropped and counted with the other dropped findings; any other check
 * on that slide, and this check anywhere else, stands.
 */
export function factConsistencyApplies(finding: Finding, state: PipelineState): boolean {
  if (finding.check !== "fact-consistency" || finding.target.slideId === undefined) return true;
  const slide = state.lesson.slides.find((s) => s.id === finding.target.slideId);
  return slide === undefined || !isRetrievalStarter(slide, state.lesson.facts);
}

/** Ids `applyVerifyPatch` can correct: every fact array except the objectives. */
function patchableFactIds(facts: LessonFacts | undefined): Set<string> {
  const ids = new Set<string>();
  if (!facts) return ids;
  for (const key of FACT_ARRAYS) {
    if (key === "objectives") continue;
    for (const fact of facts[key] ?? []) ids.add(fact.id);
  }
  return ids;
}

const normalise = normaliseText;
const haystack = slideHaystack;
function factsText(state: PipelineState): string {
  return JSON.stringify(state.lesson.facts ?? {});
}

/**
 * Checks an earlier stage recorded that Evaluate keeps as they are: none is recomputable here, and
 * a `spec-rule` finding (TEACH-257) is what Repair rewrites its slide or block against.
 */
const CARRIED_CHECKS: ReadonlySet<string> = new Set([
  "budget",
  "image",
  "fact-verify",
  SPEC_RULE_CHECK,
]);

export async function evaluate(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const { lesson, worksheet } = state;
  const facts = lesson.facts;
  if (!facts) throw new Error("evaluate: the lesson has no facts; Plan has not run");
  const generation = generationOf(lesson);
  // Findings Generate recorded (a budget stop) survive, as do illustrate's image warnings and
  // Verify's fact corrections — none is recomputable here; everything else is recomputed below.
  const carried = generation.findings.filter(
    (f) => CARRIED_CHECKS.has(f.check) && f.message !== NUMERIC_MESSAGE,
  );
  const numeric = numericAsErrors(state);
  const schema = checkLesson(lesson, worksheet);

  // Photographed slides (TEACH-220): each placed image-text slide's thumbnail — the picture the
  // judge chose — goes in as an image part so `image-fit` can look at it; numbered in slide order.
  const images = photoThumbnails(lesson);
  const photos = images.map((i) => i.id);
  const { verb, confidence } = shapeOf(lesson);

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
        // Contract C1 (audit FIX-PLAN): the starter's questions, rendered by the evaluate prompt.
        ...retrievalInput(facts),
        audience: audienceOf(lesson),
        shape: { verb, confidence },
        // Audit A2: slides the lab printed in code from the facts (starter, checks, exit quiz) are
        // left out. Their correctness is the facts' (Verify owns it), Repair discards every warning
        // on them, and they drew 85% of findings (132/156 over l1/l2). Production slides never
        // carry the code stamp, so this changes nothing there.
        slides: lesson.slides
          .filter((s) => !isCodeBuilt(s))
          .map((s) => ({
            id: s.id,
            kind: s.kind,
            text: slideText(s),
            notes: s.notes,
            ...(photos.indexOf(s.id) === -1 ? {} : { photo: photos.indexOf(s.id) + 1 }),
          })),
        blocks: (worksheet?.blocks ?? []).map((b) => ({
          id: b.id,
          type: b.type,
          text: blockText(b),
        })),
      },
      schema: EvaluateOutputSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS.evaluate,
      images,
    });
    const filtered = knownTargetsWithEvidence(call.output.findings, state);
    const applicable = filtered.kept.filter(
      (f) => verbFitApplies(f, state) && factConsistencyApplies(f, state),
    );
    model = applicable.map((f) => imageFitAsError(f, state));
    const dropped = filtered.dropped + (filtered.kept.length - applicable.length);
    if (dropped > 0) {
      deps.logger.info({ stage: "evaluate", dropped }, "findings dropped");
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
        findings: [...carried, ...numeric, ...schema, ...model],
      },
    },
    deps,
  );
  const { updatedAt } = await deps.persist(next, worksheet);
  await deps.onProgress(90, "Reviewed", "evaluate", updatedAt);
  return { ...state, lesson: next };
}

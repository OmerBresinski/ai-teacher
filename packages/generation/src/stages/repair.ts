import { isAiError } from "@tj/ai";
import {
  checkLesson,
  type Finding,
  isSchemaCheck,
  type Lesson,
  type LessonFacts,
  type Slide,
  type Worksheet,
  type WorksheetBlock,
} from "@tj/domain/documents";
import {
  blockSpecSchemaFor,
  imageTextSpecSchemaFor,
  type MaterialiseMeta,
  materialiseBlock,
  materialiseSlide,
  slideSpecSchemaFor,
} from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS, specRuleFinding } from "../call";
import { isCodeBuilt, isRetrievalStarter, withShuffledOptions } from "../lab/coded-slides";
import {
  type Audience,
  type RepairInput,
  repairFactPrompt,
  repairPrompt,
  type WritingShape,
} from "../prompts";
import type { RepairContextSlide } from "../prompts/repair";
import {
  isOutlineFromFacts,
  VERIFY_FIELDS_BY_ARRAY,
  verifiableArrayOf,
  verifyOutputSchemaFor,
} from "../specs";
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
  imageTextPhotoOf,
  normaliseText,
  shapeOf,
  slideHaystack,
  slidePhotoOf,
  slideText,
  specFieldsCover,
  specFieldsOf,
  withImageCaption,
} from "./shared";
import { applyVerifyPatch, verifyFinding } from "./verify";

/*
 * Repair (ADR 0025 §12, §14): one targeted pass. Every `error` finding that names a slide or a
 * block is grouped per target (at most `MAX_TARGETS`), one `standard` call regenerates that
 * target's spec with the findings in context, and the slide/block is re-materialised in place
 * (same slide id, new element ids). `checkLesson` runs again; what remains, plus the model's
 * findings, are the residuals. Never runs twice; the job completes whatever is left.
 *
 * Since lab round 1 the actionable warnings (`ACTIONABLE_WARNINGS`: tested-not-taught, verb-fit,
 * repetition) are acted on too: they ride with an error on the same target, and up to
 * `MAX_WARNING_TARGETS` targets are taken on for them alone. Each slide call also gets the slides
 * around it as read-only context (`repairContext`).
 *
 * A `spec-rule` error from Generate (TEACH-257) is repaired like any other: the target is
 * regenerated against the full schema. A repair answer that itself still misses an editorial rule
 * on both attempts is accepted, and each miss is recorded as a `spec-rule` **warning** — the
 * residual badge says so; there is no second pass.
 */

export const MAX_TARGETS = 6;

/**
 * The warnings the judges punish and Repair can act on (lab round 1), in the order a warning-only
 * target is chosen: the structural `tested-not-taught` first, then the model's `verb-fit` and
 * `repetition`. Any other warning (pitch, notes-quality, readability) is left as a residual.
 */
export const ACTIONABLE_WARNINGS: readonly string[] = [
  "tested-not-taught",
  "verb-fit",
  "repetition",
];

/**
 * Targets Repair takes on for actionable warnings alone, on top of the error targets: the cost
 * bound. The CB runs (24 Sept) made 0–6 repair calls a lesson; this adds at most two targets, one
 * call each (plus a retry only when that answer misses the schema). A warning on a slide that is
 * already an error target rides along in the same call for nothing.
 */
export const MAX_WARNING_TARGETS = 2;

type Target = {
  key: string;
  slideId?: string;
  blockId?: string;
  findings: Finding[];
  /** Chosen for its actionable warnings alone (`MAX_WARNING_TARGETS`). */
  warningOnly?: boolean;
};

const keyOf = (finding: Finding): string | undefined => {
  const { slideId, blockId } = finding.target;
  if (slideId !== undefined) return `slide:${slideId}`;
  if (blockId !== undefined) return `block:${blockId}`;
  return undefined;
};

/**
 * The `error` findings by target, in first-seen order, capped at `MAX_TARGETS`; each carries the
 * actionable warnings on the same target too. Then up to `MAX_WARNING_TARGETS` targets with
 * actionable warnings and no error, ranked by `ACTIONABLE_WARNINGS` and then first-seen order.
 *
 * `codeBuilt`: the slides the lab printed in code from the facts (starter, check sets, exit quiz;
 * `isCodeBuilt`). A warning on one is never acted on, alone or riding with an error: those sets are
 * quick quizzes by design, and in round 1 a verb-fit rewrite ("asks pupils to choose, not
 * explain") turned 10 clean quizzes into long "explain" items, merged items and dropped options
 * (r1-h-y2-plants-L and r1-cb-y5-fractions-L slide 10). The warning stays a residual.
 *
 * `retrieval`: the retrieval starter (lab r4, `isRetrievalStarter`), never a target at any
 * severity. Its questions are earlier lessons' and Repair's only source is this lesson's facts, so
 * a rewrite can only pre-test what the lesson is about to teach (r3-h-y9-coasts-L: an error that
 * the facts did not define weathering had it rewritten about fetch and managed retreat). An error
 * on it, a wrong answer included, stays a residual for the teacher.
 */
export function repairTargets(
  findings: Finding[],
  codeBuilt: ReadonlySet<string> = new Set(),
  retrieval: ReadonlySet<string> = new Set(),
): Target[] {
  const onRetrieval = (f: Finding) =>
    f.target.slideId !== undefined && retrieval.has(f.target.slideId);
  const byKey = new Map<string, Target>();
  for (const finding of findings) {
    if (finding.severity !== "error" || onRetrieval(finding)) continue;
    const key = keyOf(finding);
    if (key === undefined) continue;
    const { slideId, blockId } = finding.target;
    const target = byKey.get(key) ?? { key, slideId, blockId, findings: [] };
    target.findings.push(finding);
    byKey.set(key, target);
  }
  const errorTargets = [...byKey.values()].slice(0, MAX_TARGETS);
  const chosen = new Map(errorTargets.map((t) => [t.key, t]));
  const rank = (f: Finding) => ACTIONABLE_WARNINGS.indexOf(f.check);
  const actionable = findings.filter(
    (f) =>
      f.severity === "warning" &&
      rank(f) >= 0 &&
      !(f.target.slideId !== undefined && codeBuilt.has(f.target.slideId)) &&
      !onRetrieval(f),
  );
  const warningOnly = new Map<string, Target>();
  for (const finding of actionable) {
    const key = keyOf(finding);
    if (key === undefined || byKey.has(key)) {
      if (key !== undefined) chosen.get(key)?.findings.push(finding);
      continue;
    }
    const { slideId, blockId } = finding.target;
    const target = warningOnly.get(key) ?? {
      key,
      slideId,
      blockId,
      findings: [],
      warningOnly: true,
    };
    target.findings.push(finding);
    warningOnly.set(key, target);
  }
  const best = (t: Target) => Math.min(...t.findings.map(rank));
  const extra = [...warningOnly.values()]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => best(a.t) - best(b.t) || a.i - b.i)
    .slice(0, MAX_WARNING_TARGETS)
    .map(({ t }) => t);
  return [...errorTargets, ...extra];
}

/** Outline kinds whose slides teach; a `tested-not-taught` repair is shown what they said. */
const TEACHING_KINDS: ReadonlySet<string> = new Set(["content", "image-text", "worked-example"]);
/** The most read-only slides one repair call is shown. */
export const MAX_CONTEXT_SLIDES = 6;

export type { RepairContextSlide } from "../prompts/repair";

/**
 * The read-only slides a repair of `lesson.slides[index]` needs (lab round 1): the slides either
 * side, so a rewrite does not recreate a neighbour's point (cb-y1-animals-P D8); any other slide
 * holding a repetition finding's quoted evidence; and, for a `tested-not-taught` finding, the
 * teaching slides before it, so the task is rewritten to what they teach and no untaught clause is
 * added (cb-y1-animals-P D4, cb-y4-romans-P). At most `MAX_CONTEXT_SLIDES`, chosen in that order
 * (nearest teaching slides first) and returned in deck order.
 */
export function repairContext(
  lesson: Lesson,
  index: number,
  findings: Finding[],
): RepairContextSlide[] {
  const why = new Map<number, RepairContextSlide["why"]>();
  const add = (i: number, reason: RepairContextSlide["why"]) => {
    if (i !== index && i >= 0 && i < lesson.slides.length && !why.has(i)) why.set(i, reason);
  };
  for (const f of findings) {
    if (f.check !== "repetition" || f.evidence === undefined) continue;
    const needle = normaliseText(f.evidence);
    lesson.slides.forEach((s, i) => {
      if (needle && slideHaystack(s).includes(needle)) add(i, "repeats");
    });
  }
  add(index - 1, "before");
  add(index + 1, "after");
  if (findings.some((f) => f.check === "tested-not-taught")) {
    for (let i = index - 1; i >= 0; i--) {
      if (TEACHING_KINDS.has(lesson.slides[i]?.kind ?? "")) add(i, "taught-earlier");
    }
  }
  return [...why.entries()]
    .slice(0, MAX_CONTEXT_SLIDES)
    .sort(([a], [b]) => a - b)
    .map(([i, reason]) => {
      const slide = lesson.slides[i] as Slide;
      return { position: i + 1, kind: slide.kind, text: slideText(slide), why: reason };
    });
}

export async function repair(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  let { lesson, worksheet } = state;
  let facts = lesson.facts;
  if (!facts) throw new Error("repair: the lesson has no facts; Plan has not run");
  const generation = generationOf(lesson);
  const audience = audienceOf(lesson);
  const { verb, confidence } = shapeOf(lesson);
  const lessonShape = { verb, confidence };
  // Schema findings are recomputed at the end. Model warnings stay as residuals; a model `error`
  // drops once its target has been regenerated (Repair never re-asks the model, §12) and stays
  // when the target could not be repaired, so the badge still says so.
  const modelFindings = generation.findings.filter((f) => !isSchemaCheck(f.check));
  const repaired = new Set<string>();
  const extra: Finding[] = [];

  // Lab only: slides printed in code are not rewritten for a warning, the retrieval starter is
  // never rewritten (r4), and a rewritten multiple-choice slide gets Generate's seeded option
  // order back (the model lists the answer first, so without it the answer is A again).
  const lab = isOutlineFromFacts(generation.promptVersions.planned);
  const codeBuilt = new Set(lesson.slides.filter(isCodeBuilt).map((s) => s.id));
  const retrieval = new Set(
    lesson.slides.filter((s) => isRetrievalStarter(s, facts)).map((s) => s.id),
  );
  for (const target of repairTargets(generation.findings, codeBuilt, retrieval)) {
    throwIfAborted(deps.signal);
    // Facts first (TEACH-216): a `fact-consistency` finding that names the wrong fact patches the
    // fact before the artefact is regenerated from it, so the two do not drift apart again. The
    // patch is staged on this target's copy and committed with the regenerated artefact: a target
    // that could not be repaired leaves the facts as they were, never corrected facts beside an
    // artefact still built on the old ones.
    let staged = facts;
    const stagedFindings: Finding[] = [];
    const commitFacts = () => {
      facts = staged;
      lesson = { ...lesson, facts };
      extra.push(...stagedFindings);
    };
    try {
      for (const factId of wrongFacts(target.findings)) {
        const patched = await repairFact(staged, factId, target.findings, audience, deps);
        staged = patched.facts;
        stagedFindings.push(...patched.applied.map(verifyFinding));
      }
      if (target.slideId !== undefined) {
        const index = lesson.slides.findIndex((s) => s.id === target.slideId);
        const slide = lesson.slides[index];
        // A kind the pipeline cannot generate (an image slide the teacher added) cannot be repaired.
        // An image-text slide keeps its photograph: its text is re-checked against the same evidence.
        const specSchema = (soft: boolean) =>
          !slide
            ? undefined
            : slide.kind === "image-text"
              ? imageTextSpecSchemaFor(imageTextPhotoOf(slide, lesson.facts?.outline[index]), {
                  soft,
                })
              : slideSpecSchemaFor(slide.kind, { soft });
        const schema = specSchema(false);
        if (!slide || !schema) continue;
        // The slides around it, read-only (lab round 1), rendered by `repair.v14`.
        const input: RepairInput = {
          facts: staged,
          audience,
          lessonShape,
          target: {
            kind: "slide",
            slideKind: slide.kind,
            slideId: slide.id,
            text: slideText(slide),
            // The labelled fields, when they carry everything the flat text does; else the text.
            ...(specFieldsCover(slide) ? { fields: specFieldsOf(slide) } : {}),
            ...(slide.kind === "image-text"
              ? { photo: slidePhotoOf(slide, lesson.facts?.outline[index]) }
              : {}),
          },
          findings: target.findings,
          shape: `a "${slide.kind}" slide spec`,
          context: { slides: repairContext(lesson, index, target.findings) },
        };
        const call = await callStructured({
          deps,
          stage: "repair",
          cls: "small",
          effort: "low",
          prompt: repairPrompt,
          input,
          schema,
          soft: specSchema(true),
          retryCapMisses: true,
          maxOutputTokens: MAX_OUTPUT_TOKENS.repair,
        });
        commitFacts();
        repaired.add(target.key);
        for (const miss of call.editorialMisses) {
          extra.push(specRuleFinding(miss, { slideId: slide.id }, "warning"));
        }
        const spec = lab ? withShuffledOptions(call.output, `${lesson.id}:${index}`) : call.output;
        const fresh: Slide = keepPhoto(slide, {
          ...materialiseSlide(
            withImageCaption(spec, lesson.facts?.outline[index]),
            lesson.themeId,
            meta(call.modelId, deps),
            deps.ids,
          ),
          id: slide.id,
        });
        lesson = { ...lesson, slides: lesson.slides.map((s, i) => (i === index ? fresh : s)) };
      } else if (target.blockId !== undefined && worksheet) {
        const index = worksheet.blocks.findIndex((b) => b.id === target.blockId);
        const block = worksheet.blocks[index];
        if (!block) continue;
        const result = await repairBlock(
          { block, findings: target.findings, facts: staged, audience, lessonShape },
          deps,
        );
        if (!result) continue;
        commitFacts();
        repaired.add(target.key);
        extra.push(...result.findings);
        const blocks = worksheet.blocks.map((b, i) => (i === index ? result.block : b));
        worksheet = { ...worksheet, blocks } as Worksheet;
      }
    } catch (error) {
      throwIfAborted(deps.signal);
      if (error instanceof BudgetExceeded) {
        extra.push(BUDGET_FINDING(error.by, "the repair pass"));
        break;
      }
      const moderated = isAiError(error, "moderated");
      if (error instanceof StageFailure || moderated) {
        extra.push({
          check: "repair",
          severity: "warning",
          target: { slideId: target.slideId, blockId: target.blockId },
          message: moderated
            ? `The review could not rewrite this ${target.slideId !== undefined ? "slide" : "block"}; check it yourself.`
            : "This item could not be repaired automatically; please check it.",
        });
        continue;
      }
      throw error;
    }
  }

  throwIfAborted(deps.signal);
  const schema = checkLesson(lesson, worksheet);
  const next = withUsage(
    {
      ...lesson,
      generation: {
        ...generationOf(lesson),
        stage: "repaired",
        completedAt: deps.now().toISOString(),
        promptVersions: { ...generation.promptVersions, repaired: repairPrompt.version },
        findings: [
          ...schema,
          ...modelFindings.filter((f) => !staleAfterRepair(f, repaired, lesson, worksheet)),
          ...extra,
        ],
      },
    },
    deps,
  );
  const { updatedAt } = await deps.persist(next, worksheet);
  await deps.onProgress(100, "Done", "repair", updatedAt);
  return { ...state, lesson: next, worksheet };
}

/**
 * The block branch of the repair pass, shared with the worksheet job (ADR 0030 item 3.iv): one
 * `small` call regenerates the block's spec with the findings in context, and the block is
 * re-materialised under its own id. `undefined` for a type the pipeline cannot generate (an image
 * block the teacher added). An editorial miss the accepted retry still carries is a `spec-rule`
 * warning on the block: there is no second pass.
 */
export async function repairBlock(
  input: {
    block: WorksheetBlock;
    findings: Finding[];
    facts: LessonFacts;
    audience: Audience;
    lessonShape: WritingShape;
  },
  deps: Pick<PipelineDeps, "ai" | "budget" | "signal" | "logger" | "context" | "now" | "ids">,
): Promise<{ block: WorksheetBlock; findings: Finding[] } | undefined> {
  const { block, findings, facts, audience, lessonShape } = input;
  const schema = blockSpecSchemaFor(block.type);
  if (!schema) return undefined;
  const call = await callStructured({
    deps,
    stage: "repair",
    cls: "small",
    effort: "low",
    prompt: repairPrompt,
    input: {
      facts,
      audience,
      lessonShape,
      target: {
        kind: "block",
        blockType: block.type,
        blockId: block.id,
        text: blockText(block),
      },
      findings,
      shape: `a "${block.type}" block spec`,
    },
    schema,
    soft: blockSpecSchemaFor(block.type, { soft: true }),
    retryCapMisses: true,
    maxOutputTokens: MAX_OUTPUT_TOKENS.repair,
  });
  return {
    block: { ...materialiseBlock(call.output, meta(call.modelId, deps), deps.ids), id: block.id },
    findings: call.editorialMisses.map((miss) =>
      specRuleFinding(miss, { blockId: block.id }, "warning"),
    ),
  };
}

/** The fact ids the target's `fact-consistency` findings name, first-seen order, deduplicated. */
function wrongFacts(findings: Finding[]): string[] {
  const ids: string[] = [];
  for (const f of findings) {
    const id = f.target.factId;
    if (f.check === "fact-consistency" && id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * One `small` call that corrects the fact Evaluate found wrong, in Verify's correction shape, and
 * applies it. A cap stop or two schema misses propagate to the caller's handling like any repair
 * call; nothing is written on failure.
 */
async function repairFact(
  facts: LessonFacts,
  factId: string,
  findings: Finding[],
  audience: ReturnType<typeof audienceOf>,
  deps: PipelineDeps,
): Promise<ReturnType<typeof applyVerifyPatch>> {
  const about = findings
    .filter((f) => f.target.factId === factId)
    .map((f) => ({ message: f.message, evidence: f.evidence }));
  const call = await callStructured({
    deps,
    stage: "repair",
    cls: "small",
    effort: "low",
    prompt: repairFactPrompt,
    input: {
      audience,
      facts: factsAround(facts, factId),
      factId,
      fields: fieldsOf(factId),
      findings: about,
    },
    schema: verifyOutputSchemaFor(facts),
    maxOutputTokens: MAX_OUTPUT_TOKENS.verify,
  });
  // Only corrections to the fact in question: the review was about that fact and no other.
  return applyVerifyPatch(
    facts,
    call.output.corrections.filter((c) => c.factId === factId),
  );
}

/** The fields the fact's array allows a correction on, as `verifyOutputSchemaFor` enforces. */
function fieldsOf(factId: string): readonly string[] {
  const array = verifiableArrayOf(factId as Parameters<typeof verifiableArrayOf>[0]);
  return array ? VERIFY_FIELDS_BY_ARRAY[array] : [];
}

/** The fact in question with the objectives and misconceptions it links to; nothing else. */
function factsAround(facts: LessonFacts, factId: string): LessonFacts {
  const only = <T extends { id: string }>(list: T[]) => list.filter((f) => f.id === factId);
  const out: LessonFacts = {
    objectives: facts.objectives,
    vocabulary: only(facts.vocabulary),
    workedExamples: only(facts.workedExamples),
    questions: only(facts.questions),
    misconceptions: facts.misconceptions,
    outline: [],
    durationMin: facts.durationMin,
  };
  const keyIdeas = only(facts.keyIdeas ?? []);
  if (keyIdeas.length > 0) out.keyIdeas = keyIdeas;
  return out;
}

/**
 * The regenerated slide with the original's image element in place of the recipe's fresh
 * placeholder: Repair rewrites the text of an `image-text` slide, never its photograph.
 */
function keepPhoto(original: Slide, fresh: Slide): Slide {
  const image = original.elements.find((e) => e.type === "image");
  if (!image) return fresh;
  return {
    ...fresh,
    elements: fresh.elements.map((e) => (e.type === "image" ? image : e)),
  };
}

/**
 * A model finding whose target was regenerated in this pass and that no longer applies: every
 * `error` (the regeneration was its repair), and a warning whose quoted `evidence` is not in the
 * new text — the teacher must never read a check about a sentence that has been deleted
 * (TEACH-222). A warning whose evidence survived the rewrite stays.
 */
function staleAfterRepair(
  finding: Finding,
  repaired: Set<string>,
  lesson: Lesson,
  worksheet: Worksheet | undefined,
): boolean {
  const { slideId, blockId } = finding.target;
  const key =
    slideId !== undefined ? `slide:${slideId}` : blockId !== undefined ? `block:${blockId}` : null;
  if (key === null || !repaired.has(key)) return false;
  if (finding.severity === "error" || finding.evidence === undefined) return true;
  const needle = normaliseText(finding.evidence);
  if (slideId !== undefined) {
    const slide = lesson.slides.find((s) => s.id === slideId);
    return !slide || !slideHaystack(slide).includes(needle);
  }
  const block = worksheet?.blocks.find((b) => b.id === blockId);
  return !block || !normaliseText(blockText(block)).includes(needle);
}

const meta = (modelId: string, deps: Pick<PipelineDeps, "now">): MaterialiseMeta => ({
  promptVersion: repairPrompt.version,
  model: modelId,
  at: deps.now().toISOString(),
});

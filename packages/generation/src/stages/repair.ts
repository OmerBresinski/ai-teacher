import {
  checkLesson,
  type Finding,
  isSchemaCheck,
  type Lesson,
  type LessonFacts,
  type Slide,
  type Worksheet,
} from "@tj/domain/documents";
import {
  blockSpecSchemaFor,
  imageTextSpecSchemaFor,
  type MaterialiseMeta,
  materialiseBlock,
  materialiseSlide,
  slideSpecSchemaFor,
} from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import { repairFactPrompt, repairPrompt } from "../prompts";
import { VERIFY_FIELDS_BY_ARRAY, verifiableArrayOf, verifyOutputSchemaFor } from "../specs";
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
  slideHaystack,
  slidePhotoOf,
  slideText,
  specFieldsOf,
} from "./shared";
import { applyVerifyPatch, verifyFinding } from "./verify";

/*
 * Repair (ADR 0025 §12, §14): one targeted pass. Every `error` finding that names a slide or a
 * block is grouped per target (at most `MAX_TARGETS`), one `standard` call regenerates that
 * target's spec with the findings in context, and the slide/block is re-materialised in place
 * (same slide id, new element ids). `checkLesson` runs again; what remains, plus the model's
 * findings, are the residuals. Never runs twice; the job completes whatever is left.
 */

export const MAX_TARGETS = 6;

type Target = { key: string; slideId?: string; blockId?: string; findings: Finding[] };

/** The `error` findings by target, in first-seen order, capped. */
export function repairTargets(findings: Finding[]): Target[] {
  const byKey = new Map<string, Target>();
  for (const finding of findings) {
    if (finding.severity !== "error") continue;
    const { slideId, blockId } = finding.target;
    if (slideId === undefined && blockId === undefined) continue;
    const key = slideId !== undefined ? `slide:${slideId}` : `block:${blockId}`;
    const target = byKey.get(key) ?? { key, slideId, blockId, findings: [] };
    target.findings.push(finding);
    byKey.set(key, target);
  }
  return [...byKey.values()].slice(0, MAX_TARGETS);
}

export async function repair(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  let { lesson, worksheet } = state;
  let facts = lesson.facts;
  if (!facts) throw new Error("repair: the lesson has no facts; Plan has not run");
  const generation = generationOf(lesson);
  const audience = audienceOf(lesson);
  // Schema findings are recomputed at the end. Model warnings stay as residuals; a model `error`
  // drops once its target has been regenerated (Repair never re-asks the model, §12) and stays
  // when the target could not be repaired, so the badge still says so.
  const modelFindings = generation.findings.filter((f) => !isSchemaCheck(f.check));
  const repaired = new Set<string>();
  const extra: Finding[] = [];

  for (const target of repairTargets(generation.findings)) {
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
        const schema = !slide
          ? undefined
          : slide.kind === "image-text"
            ? imageTextSpecSchemaFor(imageTextPhotoOf(slide, lesson.facts?.outline[index]))
            : slideSpecSchemaFor(slide.kind);
        if (!slide || !schema) continue;
        const call = await callStructured({
          deps,
          stage: "repair",
          cls: "small",
          effort: "low",
          prompt: repairPrompt,
          input: {
            facts: staged,
            audience,
            target: {
              kind: "slide",
              slideKind: slide.kind,
              slideId: slide.id,
              text: slideText(slide),
              fields: specFieldsOf(slide),
              ...(slide.kind === "image-text"
                ? { photo: slidePhotoOf(slide, lesson.facts?.outline[index]) }
                : {}),
            },
            findings: target.findings,
            shape: `a "${slide.kind}" slide spec`,
          },
          schema,
          maxOutputTokens: MAX_OUTPUT_TOKENS.repair,
        });
        commitFacts();
        repaired.add(target.key);
        const fresh: Slide = keepPhoto(slide, {
          ...materialiseSlide(call.output, lesson.themeId, meta(call.modelId, deps), deps.ids),
          id: slide.id,
        });
        lesson = { ...lesson, slides: lesson.slides.map((s, i) => (i === index ? fresh : s)) };
      } else if (target.blockId !== undefined && worksheet) {
        const index = worksheet.blocks.findIndex((b) => b.id === target.blockId);
        const block = worksheet.blocks[index];
        const schema = block ? blockSpecSchemaFor(block.type) : undefined;
        if (!block || !schema) continue;
        const call = await callStructured({
          deps,
          stage: "repair",
          cls: "small",
          effort: "low",
          prompt: repairPrompt,
          input: {
            facts: staged,
            audience,
            target: {
              kind: "block",
              blockType: block.type,
              blockId: block.id,
              text: blockText(block),
            },
            findings: target.findings,
            shape: `a "${block.type}" block spec`,
          },
          schema,
          maxOutputTokens: MAX_OUTPUT_TOKENS.repair,
        });
        commitFacts();
        repaired.add(target.key);
        const fresh = {
          ...materialiseBlock(call.output, meta(call.modelId, deps), deps.ids),
          id: block.id,
        };
        const blocks = worksheet.blocks.map((b, i) => (i === index ? fresh : b));
        worksheet = { ...worksheet, blocks } as Worksheet;
      }
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        extra.push(BUDGET_FINDING(error.by, "the repair pass"));
        break;
      }
      if (error instanceof StageFailure) {
        extra.push({
          check: "repair",
          severity: "warning",
          target: { slideId: target.slideId, blockId: target.blockId },
          message: "This item could not be repaired automatically; please check it.",
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
  await deps.onProgress(100, "Done", updatedAt);
  return { ...state, lesson: next, worksheet };
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

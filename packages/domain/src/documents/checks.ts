import type { Finding } from "./finding";
import type { Lesson } from "./lesson";
import type { FactId, LessonFacts } from "./lesson-facts";
import { QUALITY_CHECKS, qualityChecks } from "./quality-checks";
import { richDocToPlainText } from "./rich-text";
import { hasRevealableAnswer, type Slide } from "./slide";
import { walkElements } from "./text";
import type { Worksheet, WorksheetBlock } from "./worksheet";

export * from "./finding";

/*
 * The shared schema checker (ADR 0025 §10). Pure and zod-only so the worker (Evaluate, Repair)
 * and the editor (the lint badge after every save) compute identical findings from the same
 * document; findings are recomputed here, never trusted from `Lesson.generation.findings`.
 *
 * When `worksheet` is omitted the worksheet half of the objective check is skipped — no finding,
 * not a pass. The worker always passes the worksheet it created; the editor passes it once
 * `Lesson.artefacts.worksheetId` has loaded.
 */

/**
 * The `check` names `checkLesson` produces: the four schema checks here and the deterministic
 * quality checks in `quality-checks.ts` (TEACH-210). Anything else on `Lesson.generation.findings`
 * is a model check (or the budget stop) and is shown as stored; these are always recomputed.
 */
export const SCHEMA_CHECKS: ReadonlySet<string> = new Set([
  "question-answer",
  "objective-coverage",
  "vocabulary-in-facts",
  "objective-taught",
  ...QUALITY_CHECKS,
]);
export const isSchemaCheck = (check: string): boolean => SCHEMA_CHECKS.has(check);

export function checkLesson(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  if (!lesson.facts) return [];
  const findings = [
    ...checkQuestionAnswers(lesson, worksheet),
    ...checkObjectiveCoverage(lesson, worksheet),
    ...checkVocabularyInFacts(lesson),
    ...checkObjectivesTaught(lesson),
    ...qualityChecks(lesson, worksheet),
  ];
  const ignored = lesson.ignoredChecks ?? [];
  if (ignored.length === 0) return findings;
  return findings.filter((f) => !isIgnored(ignored, f));
}

/** Ruling 96: a check the teacher ignored for one fact ("Ignore" on the objective's line). */
const isIgnored = (ignored: readonly { check: string; factId: string }[], f: Finding) =>
  f.target.factId !== undefined &&
  ignored.some((i) => i.check === f.check && i.factId === f.target.factId);

/* ------------------------------------------------------------------ */
/* question-answer                                                     */
/* ------------------------------------------------------------------ */

/** Every question slide and question block has an answer the reveal or the answer key can show. */
function checkQuestionAnswers(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const findings: Finding[] = [];
  for (const slide of lesson.slides) {
    const problem = slideAnswerProblem(slide);
    if (problem) {
      findings.push({
        check: "question-answer",
        severity: "error",
        target: { slideId: slide.id },
        message: `Slide "${slide.kind}" ${problem}.`,
        fix: { kind: "set-answer" },
      });
    }
  }
  for (const block of worksheet?.blocks ?? []) {
    const problem = blockAnswerProblem(block);
    if (problem) {
      findings.push({
        check: "question-answer",
        severity: "error",
        target: { blockId: block.id },
        message: `Worksheet ${block.type} block ${problem}.`,
        fix: { kind: "set-answer" },
      });
    }
  }
  return findings;
}

function slideAnswerProblem(slide: Slide): string | undefined {
  const q = slide.question;
  if (!q) return undefined;
  if (q.type === "open-response" && !hasRevealableAnswer(slide)) return "has no model answer";
  if (q.type === "fill-gap" && q.gaps.some((gap) => isBlank(gap.answer))) {
    return "has a gap with no answer";
  }
  if (q.type === "multiple-choice" && !q.options.some((option) => option.correct)) {
    return "has no correct option";
  }
  return undefined;
}

function blockAnswerProblem(block: WorksheetBlock): string | undefined {
  if (block.type === "question" && isBlank(block.answer)) return "has no answer";
  if (block.type === "multiple-choice" && !block.options.some((option) => option.correct)) {
    return "has no correct option";
  }
  if (block.type === "fill-gap" && block.gaps.some((gap) => isBlank(gap.answer))) {
    return "has a gap with no answer";
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* objective-coverage                                                  */
/* ------------------------------------------------------------------ */

/**
 * Every objective is taught on at least one slide and practised in at least one block. Coverage
 * resolves through the fact graph, not by literal id: a block whose `factRefs` name `q1` covers
 * `o1` when `q1` is linked to `o1` — by the question's own `objectiveRefs`, or by an outline entry
 * that lists both. Worksheet blocks reference questions, not objectives, so the literal check
 * reported "not covered by the worksheet" on every production lesson (Generation quality, Problem 6).
 */
function checkObjectiveCoverage(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const facts = lesson.facts;
  if (!facts) return [];
  const covers = objectivesCoveredBy(facts);
  const onSlides = new Set<string>();
  for (const slide of lesson.slides) {
    // The objectives slide names every objective; that states them, it does not cover them.
    if (slide.kind === "objectives") continue;
    walkElements(slide.elements, (element) => {
      for (const ref of element.generatedFrom?.factRefs ?? []) addCovered(onSlides, ref, covers);
    });
  }
  const onWorksheet = new Set<string>();
  for (const block of worksheet?.blocks ?? []) {
    for (const ref of block.generatedFrom?.factRefs ?? []) addCovered(onWorksheet, ref, covers);
  }
  const findings: Finding[] = [];
  // Until the slides are written only the objectives slide exists; the slide half waits for them.
  const deck = slidesWritten(lesson);
  for (const objective of facts.objectives) {
    const missing: string[] = [];
    if (deck && !onSlides.has(objective.id)) missing.push("any slide");
    if (worksheet && !onWorksheet.has(objective.id)) missing.push("the worksheet");
    if (missing.length === 0) continue;
    findings.push({
      check: "objective-coverage",
      severity: "error",
      target: { factId: objective.id },
      message: `Objective "${objective.text}" is not covered by ${missing.join(" or ")}.`,
      fix: { kind: "add-objective-coverage" },
    });
  }
  return findings;
}

/**
 * Which objectives each non-objective fact stands for: its own `objectiveRefs` when the fact
 * carries them, plus every objective an outline entry lists beside it. Objectives are keyed to
 * themselves so one lookup serves every ref.
 */
export function objectivesCoveredBy(facts: LessonFacts): Map<FactId, Set<FactId>> {
  const objectiveIds = new Set(facts.objectives.map((o) => o.id));
  const covers = new Map<FactId, Set<FactId>>();
  const link = (factId: FactId, objectiveId: FactId) => {
    if (!objectiveIds.has(objectiveId)) return;
    const set = covers.get(factId) ?? new Set<FactId>();
    set.add(objectiveId);
    covers.set(factId, set);
  };
  for (const id of objectiveIds) link(id, id);
  for (const entry of facts.outline) {
    const objectives = entry.factRefs.filter((ref) => objectiveIds.has(ref));
    for (const ref of entry.factRefs) {
      if (objectiveIds.has(ref)) continue;
      for (const objective of objectives) link(ref, objective);
    }
  }
  for (const fact of factsWithObjectiveRefs(facts)) {
    for (const objective of fact.objectiveRefs) link(fact.id, objective);
  }
  return covers;
}

/** Every fact that declares the objectives it serves. */
function factsWithObjectiveRefs(facts: LessonFacts): { id: FactId; objectiveRefs: FactId[] }[] {
  const out: { id: FactId; objectiveRefs: FactId[] }[] = [];
  const lists: { id: FactId; objectiveRefs?: FactId[] | undefined }[][] = [
    facts.keyIdeas ?? [],
    facts.vocabulary,
    facts.workedExamples,
    facts.questions,
    facts.misconceptions,
  ];
  for (const list of lists) {
    for (const fact of list) {
      if (fact.objectiveRefs && fact.objectiveRefs.length > 0) {
        out.push({ id: fact.id, objectiveRefs: fact.objectiveRefs });
      }
    }
  }
  return out;
}

function addCovered(into: Set<string>, ref: string, covers: Map<FactId, Set<FactId>>): void {
  for (const objective of covers.get(ref) ?? []) into.add(objective);
}

/* ------------------------------------------------------------------ */
/* vocabulary-in-facts                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every term a `vocabulary` slide shows exists in `facts.vocabulary`. Deliberately narrow: only
 * the term elements of vocabulary-kind slides are read, never ordinary prose, so a content slide
 * using a word the facts do not define is not a finding. The vocabulary recipe
 * (`layouts.ts` `vocabularySlide`) sets terms in the `body` preset and definitions in `small`,
 * with the slide heading in `heading`; the preset is how a term is told apart from the rest.
 */
function checkVocabularyInFacts(lesson: Lesson): Finding[] {
  const facts = lesson.facts;
  if (!facts) return [];
  const known = new Set(facts.vocabulary.map((item) => normaliseTerm(item.term)));
  const findings: Finding[] = [];
  for (const slide of lesson.slides) {
    if (slide.kind !== "vocabulary") continue;
    walkElements(slide.elements, (element) => {
      if (element.type !== "text" || element.style.preset !== "body") return;
      const term = firstParagraph(richDocToPlainText(element.doc));
      if (isBlank(term) || known.has(normaliseTerm(term))) return;
      findings.push({
        check: "vocabulary-in-facts",
        severity: "warning",
        target: { slideId: slide.id, elementId: element.id },
        message: `"${term}" is shown as key vocabulary but is not in the lesson's vocabulary.`,
      });
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* objective-taught                                                    */
/* ------------------------------------------------------------------ */

/** Outline kinds that teach an objective (ruling 81); vocabulary and practice kinds do not. */
const TEACHING_KINDS: ReadonlySet<string> = new Set(["content", "image-text", "worked-example"]);

/**
 * Each objective's teaching slides (ruling 81, 96): the content, image-text and worked-example
 * slides with an element that cites the objective, directly or through a fact that stands for it
 * (`objectivesCoveredBy`). The objectives slide never counts. Slide ids in deck order; an
 * objective no slide teaches maps to `[]`.
 */
export function teachingSlides(lesson: Lesson): Map<FactId, string[]> {
  const out = new Map<FactId, string[]>();
  const facts = lesson.facts;
  if (!facts) return out;
  for (const objective of facts.objectives) out.set(objective.id, []);
  const covers = objectivesCoveredBy(facts);
  for (const slide of lesson.slides) {
    if (!TEACHING_KINDS.has(slide.kind)) continue;
    const taught = new Set<string>();
    walkElements(slide.elements, (element) => {
      for (const ref of element.generatedFrom?.factRefs ?? []) addCovered(taught, ref, covers);
    });
    for (const id of taught) out.get(id)?.push(slide.id);
  }
  return out;
}

/**
 * Every objective has a slide that teaches it (ruling 81). While the slides are still being
 * written (`generation.stage` is `planned`) the outline is the rule: it gives up practice before
 * teaching, so this fires only when there are more objectives than the slide count can teach.
 * Once the deck exists the slides are the rule (`teachingSlides`), so deleting the last slide that
 * teaches an objective is a thing to check (ruling 96). A lesson with no outline was not planned
 * against its objectives and is not checked.
 */
function checkObjectivesTaught(lesson: Lesson): Finding[] {
  const facts = lesson.facts;
  if (!facts || facts.outline.length === 0) return [];
  const taught = new Set<string>();
  if (!slidesWritten(lesson)) {
    for (const entry of facts.outline) {
      if (!TEACHING_KINDS.has(entry.kind)) continue;
      for (const ref of entry.factRefs) taught.add(ref);
    }
  } else {
    for (const [id, slides] of teachingSlides(lesson)) if (slides.length > 0) taught.add(id);
  }
  const findings: Finding[] = [];
  facts.objectives.forEach((objective, i) => {
    if (taught.has(objective.id)) return;
    findings.push({
      check: "objective-taught",
      severity: "warning",
      target: { factId: objective.id },
      message: `Objective ${i + 1} has no slide that teaches it.`,
    });
  });
  return findings;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Whether the deck exists yet: past the `planned` checkpoint, where a lesson holds only its title
 * and objectives slides while the rest are written (ruling 90).
 */
const slidesWritten = (lesson: Lesson): boolean =>
  lesson.generation?.stage !== "planned" && lesson.slides.length > 0;

function isBlank(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

function firstParagraph(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}

/** Case-insensitive, whitespace-collapsed comparison key for a vocabulary term. */
function normaliseTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

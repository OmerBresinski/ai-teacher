import type { Finding } from "./finding";
import type { Lesson } from "./lesson";
import type { FactId, LessonFacts } from "./lesson-facts";
import { QUALITY_CHECKS, qualityChecks } from "./quality-checks";
import { richDocToPlainText } from "./rich-text";
import { answersOffSlide, hasRevealableAnswer, type Slide } from "./slide";
import { blockText, slideText, walkElements } from "./text";
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
  return [
    ...checkQuestionAnswers(lesson, worksheet),
    ...checkObjectiveCoverage(lesson, worksheet),
    ...checkVocabularyInFacts(lesson),
    ...checkObjectivesTaught(lesson),
    ...qualityChecks(lesson, worksheet),
  ];
}

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
  if (
    q.type === "open-response" &&
    (answersOffSlide(slide) ? !q.modelAnswer?.trim() : !hasRevealableAnswer(slide))
  )
    return "has no model answer";
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
 *
 * A side whose slides (or blocks) carry no `generatedFrom.factRefs` at all has no provenance to
 * resolve, so it is matched by wording instead (TEACH-247 part ak): the writer pipeline stamps no
 * provenance, and reading "no refs" as "not covered" flagged every objective of every fresh lesson.
 * One element with refs puts the whole side back on the id path, where a missing ref is a gap.
 */
function checkObjectiveCoverage(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const facts = lesson.facts;
  if (!facts) return [];
  const covers = objectivesCoveredBy(facts);
  const slideRefs = lesson.slides.map((slide) => {
    const refs: string[] = [];
    walkElements(slide.elements, (element) =>
      refs.push(...(element.generatedFrom?.factRefs ?? [])),
    );
    return refs;
  });
  const onSlides = slideRefs.some((refs) => refs.length > 0)
    ? coveredByRefs(slideRefs.flat(), covers)
    : coveredByWording(
        facts,
        lesson.slides
          .filter((s) => !UNTAUGHT_SLIDE_KINDS.has(s.kind) && !s.answersRole)
          .map(slideText),
      );
  const blocks = worksheet?.blocks ?? [];
  const blockRefs = blocks.flatMap((block) => block.generatedFrom?.factRefs ?? []);
  const onWorksheet =
    blockRefs.length > 0 || blocks.length === 0
      ? coveredByRefs(blockRefs, covers)
      : coveredByWording(facts, blocks.map(blockText));
  const findings: Finding[] = [];
  for (const objective of facts.objectives) {
    const missing: string[] = [];
    if (!onSlides.has(objective.id)) missing.push("any slide");
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

/** Slides that state objectives without teaching or practising them: the title and the list itself. */
const UNTAUGHT_SLIDE_KINDS: ReadonlySet<string> = new Set(["title", "objectives"]);

function coveredByRefs(refs: readonly string[], covers: Map<FactId, Set<FactId>>): Set<string> {
  const into = new Set<string>();
  for (const ref of refs) addCovered(into, ref, covers);
  return into;
}

/**
 * Objectives whose wording one text carries: at least half of the objective's content words (its
 * command verb and closed-class words dropped, each word reduced to a crude stem). One text must
 * carry them, so a word the lesson repeats everywhere ("fire") cannot cover an objective alone.
 */
function coveredByWording(facts: LessonFacts, texts: readonly string[]): Set<string> {
  const stemsOf = texts.map((t) => new Set(contentStems(t)));
  const covered = new Set<string>();
  for (const objective of facts.objectives) {
    const wanted = [...new Set(contentStems(objective.text))];
    if (wanted.length === 0) {
      covered.add(objective.id);
      continue;
    }
    const need = Math.ceil(wanted.length / 2);
    if (stemsOf.some((have) => wanted.filter((w) => have.has(w)).length >= need)) {
      covered.add(objective.id);
    }
  }
  return covered;
}

/**
 * Words that say nothing about what an objective covers: closed-class words and the command verbs
 * an objective opens with ("Describe how people used …").
 */
const NON_CONTENT_WORDS: ReadonlySet<string> = new Set(
  (
    "a an the and or but nor so yet of in on at by for from with without into onto to as than " +
    "that this these those it its their there they them he she his her we our you your i my " +
    "is are was were be been being do does did has have had can could should would will may " +
    "might must shall how why what which when where who whom whose whether if not no all some " +
    "any each every both more most many much few one ad bc " +
    "describe explain locate identify tell say state name list give know understand recognise " +
    "recognize recall define outline compare use used using show learn"
  ).split(" "),
);

/** A word's crude stem: lower case, a plural, past or "-ing" ending and a final "e" dropped. */
function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s", "e"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/** The content words of a text, stemmed; numbers count ("AD 122"). */
function contentStems(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[’']s\b/g, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .filter((w) => !NON_CONTENT_WORDS.has(w) && (w.length >= 3 || /^\p{N}+$/u.test(w)))
    .map(stem);
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
      // A word card's definition sets in `body` too once it fits there (the teaching body size,
      // ruling 140); `@tj/slides` names it "Definition" (structure.ts WORD_DEFINITION_NAME).
      if (element.name === "Definition") return;
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
const TEACHING_KINDS: ReadonlySet<string> = new Set([
  "content",
  "image-text",
  "diagram",
  "worked-example",
]);

/**
 * Every objective is named by at least one teaching entry of the outline (ruling 81). The outline
 * gives up practice before teaching, so this fires only when there are more objectives than the
 * slide count can teach; the teacher's objectives stay, and the gap is a thing to check.
 */
function checkObjectivesTaught(lesson: Lesson): Finding[] {
  const facts = lesson.facts;
  if (!facts || facts.outline.length === 0) return [];
  const taught = new Set<string>();
  for (const entry of facts.outline) {
    if (!TEACHING_KINDS.has(entry.kind)) continue;
    for (const ref of entry.factRefs) taught.add(ref);
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

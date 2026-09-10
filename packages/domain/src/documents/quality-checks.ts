import type { Finding } from "./finding";
import type { Lesson } from "./lesson";
import { type RichDoc, richDocToPlainText } from "./rich-text";
import type { Slide, SlideElement, TextPreset } from "./slide";
import { blockText, slideText, walkElements } from "./text";
import {
  allDistinct,
  hasLeakedPupilPhrase,
  hasLeakedRepairPhrase,
  isClassifyStem,
  isDoubleStatement,
  isOneOf,
  normaliseText,
  sameLeadingToken,
} from "./text-guards";
import { meanSentenceLength, ngrams, readingAge } from "./text-metrics";
import type { Worksheet, WorksheetBlock } from "./worksheet";

/*
 * The deterministic quality checks (Generation quality §5; TEACH-210), run by `checkLesson` beside
 * the schema checks and shared with the editor badge and the free half of the eval. Pure, over the
 * stored documents, so a lesson written before the spec sanitiser existed — or hand-edited since —
 * is caught the same way. Messages carry counts and measured values, never the matching text.
 *
 *   readability        warning  prose kinds only, against `facts.pitch` (Decision 4)
 *   repetition         warning  a stem used twice; a phrase said again and again
 *   explanation-share  warning  too little of the lesson explains
 *   degenerate-question error   an item a pupil cannot answer (equal options, repeated footnote)
 *   leaked-language    error    house rules in pupil text; repair commentary in notes
 */

export const QUALITY_CHECKS = [
  "readability",
  "repetition",
  "explanation-share",
  "degenerate-question",
  "leaked-language",
] as const;

/** Slide kinds whose `body` text is prose a pupil reads, so readability applies to it. */
const PROSE_SLIDE_KINDS: ReadonlySet<string> = new Set([
  "content",
  "image-text",
  "starter",
  "instructions",
  "discussion",
  "exit-ticket",
  "plenary",
]);
const PROSE_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "instructions"]);

/** Kinds whose heading is a question stem. */
const QUESTION_SLIDE_KINDS: ReadonlySet<string> = new Set([
  "true-false",
  "multiple-choice",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "discussion",
]);
const STEM_BLOCK_TYPES: ReadonlySet<string> = new Set(["question", "multiple-choice", "fill-gap"]);

/** Kinds where a footnote (the `small` text) must not repeat an item (a `body` line). */
const FOOTNOTE_KINDS: ReadonlySet<string> = new Set(["starter", "instructions", "exit-ticket"]);

/** Explain-phase kinds: the minutes that teach rather than test. */
const EXPLAIN_KINDS: ReadonlySet<string> = new Set(["content", "worked-example", "image-text"]);
export const EXPLANATION_SHARE_MIN_PERCENT = 30;

/** How many times a five-word phrase may recur across a lesson before it is repetition. */
export const PHRASE_REPEAT_LIMIT = 4;
const PHRASE_WORDS = 5;

export function qualityChecks(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  return [
    ...checkReadability(lesson, worksheet),
    ...checkRepetition(lesson, worksheet),
    ...checkExplanationShare(lesson),
    ...checkDegenerateQuestions(lesson, worksheet),
    ...checkLeakedLanguage(lesson, worksheet),
  ];
}

/* ------------------------------------------------------------------ */
/* readability                                                         */
/* ------------------------------------------------------------------ */

function checkReadability(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const pitch = lesson.facts?.pitch;
  if (!pitch) return [];
  const findings: Finding[] = [];
  const measure = (text: string, target: Finding["target"], where: string) => {
    const mean = meanSentenceLength(text);
    if (mean !== null && mean > pitch.sentenceLengthMax) {
      findings.push({
        check: "readability",
        severity: "warning",
        target,
        message: `${where} averages ${Math.round(mean)} words a sentence; the pitch allows ${pitch.sentenceLengthMax}.`,
      });
    }
    const age = readingAge(text);
    if (age !== null && age > pitch.readingAgeTarget + 2) {
      findings.push({
        check: "readability",
        severity: "warning",
        target,
        message: `${where} reads at about age ${Math.round(age)}; the pitch is a reading age of ${pitch.readingAgeTarget}.`,
      });
    }
  };
  for (const slide of lesson.slides) {
    if (!PROSE_SLIDE_KINDS.has(slide.kind)) continue;
    const prose = textsByPreset(slide, "body").join("\n");
    if (prose.trim()) measure(prose, { slideId: slide.id }, `Slide "${slide.kind}"`);
  }
  for (const block of worksheet?.blocks ?? []) {
    if (!PROSE_BLOCK_TYPES.has(block.type)) continue;
    const prose = blockDocText(block);
    if (prose.trim()) measure(prose, { blockId: block.id }, `Worksheet ${block.type} block`);
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* repetition                                                          */
/* ------------------------------------------------------------------ */

function checkRepetition(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const findings: Finding[] = [];
  // (a) The same stem twice, anywhere a pupil answers: the later one is the repeat.
  const seen = new Map<string, string>();
  const stem = (key: string, target: Finding["target"], where: string) => {
    if (!key) return;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, where);
      return;
    }
    findings.push({
      check: "repetition",
      severity: "warning",
      target,
      message: `${where} asks the same question as ${first}.`,
    });
  };
  for (const slide of lesson.slides) {
    const where = `slide "${slide.kind}"`;
    if (QUESTION_SLIDE_KINDS.has(slide.kind)) {
      stem(normaliseText(stemOf(slide)), { slideId: slide.id }, where);
    }
    if (slide.kind === "exit-ticket") {
      for (const item of lines(textsByPreset(slide, "body"))) {
        stem(normaliseText(item), { slideId: slide.id }, where);
      }
    }
  }
  for (const block of worksheet?.blocks ?? []) {
    if (!STEM_BLOCK_TYPES.has(block.type)) continue;
    stem(
      normaliseText(blockDocText(block)),
      { blockId: block.id },
      `worksheet ${block.type} block`,
    );
  }
  // (b) One five-word phrase said again and again across slides and sheet. The count is reported,
  // the phrase is not.
  const counts = new Map<string, number>();
  for (const text of pupilTexts(lesson, worksheet)) {
    for (const gram of ngrams(text, PHRASE_WORDS)) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let worst = 0;
  let phrases = 0;
  for (const n of counts.values()) {
    if (n >= PHRASE_REPEAT_LIMIT) {
      phrases += 1;
      if (n > worst) worst = n;
    }
  }
  if (phrases > 0) {
    findings.push({
      check: "repetition",
      severity: "warning",
      target: {},
      message: `${phrases === 1 ? "One phrase" : `${phrases} phrases`} of ${PHRASE_WORDS} words recur across the slides and worksheet (the most repeated ${worst} times).`,
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* explanation-share                                                   */
/* ------------------------------------------------------------------ */

function checkExplanationShare(lesson: Lesson): Finding[] {
  const facts = lesson.facts;
  if (!facts || facts.outline.length === 0) return [];
  const explain = facts.outline
    .filter((entry) => EXPLAIN_KINDS.has(entry.kind))
    .reduce((sum, entry) => sum + entry.minutes, 0);
  // Integer arithmetic, as `timing` does.
  if (explain * 100 >= facts.durationMin * EXPLANATION_SHARE_MIN_PERCENT) return [];
  return [
    {
      check: "explanation-share",
      severity: "warning",
      target: {},
      message: `Only ${explain} of ${facts.durationMin} minutes explain (content, worked example, picture); at least ${EXPLANATION_SHARE_MIN_PERCENT}% should.`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* degenerate-question                                                 */
/* ------------------------------------------------------------------ */

function checkDegenerateQuestions(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const findings: Finding[] = [];
  const degenerate = (target: Finding["target"], message: string, block: boolean) => {
    findings.push({
      check: "degenerate-question",
      severity: "error",
      target,
      message,
      fix: { kind: block ? "regenerate-block" : "regenerate-slide" },
    });
  };
  for (const slide of lesson.slides) {
    const target = { slideId: slide.id };
    const q = slide.question;
    if (q?.type === "multiple-choice" && !allDistinct(optionTexts(slide))) {
      degenerate(target, `Slide "${slide.kind}" offers the same option more than once.`, false);
    }
    if (q?.type === "matching") {
      const byId = elementTexts(slide);
      const lefts = q.pairs.map((p) => byId.get(p.leftElementId) ?? "");
      const rights = q.pairs.map((p) => byId.get(p.rightElementId) ?? "");
      if (!allDistinct(lefts) || !allDistinct(rights)) {
        degenerate(
          target,
          `Slide "${slide.kind}" has matching pairs that are not all different.`,
          false,
        );
      }
    }
    if (q?.type === "sort") {
      const byId = elementTexts(slide);
      const steps = q.order.map((id) => byId.get(id) ?? "");
      if (!allDistinct(steps)) {
        degenerate(target, `Slide "${slide.kind}" has the same step more than once.`, false);
      } else if (isClassifyStem(stemOf(slide)) || sameLeadingToken(steps)) {
        degenerate(
          target,
          `Slide "${slide.kind}" sets a classify task as a sequence; it wants matching or multiple-choice.`,
          false,
        );
      }
    }
    if (q?.type === "true-false" && isDoubleStatement(stemOf(slide))) {
      degenerate(target, `Slide "${slide.kind}" joins two claims into one statement.`, false);
    }
    if (FOOTNOTE_KINDS.has(slide.kind)) {
      const items = lines(textsByPreset(slide, "body"));
      const footnotes = textsByPreset(slide, "small");
      if (footnotes.some((f) => isOneOf(f, items))) {
        degenerate(
          target,
          `Slide "${slide.kind}" repeats one of its items as the footnote.`,
          false,
        );
      }
    }
  }
  for (const block of worksheet?.blocks ?? []) {
    const target = { blockId: block.id };
    if (block.type === "multiple-choice" && !allDistinct(block.options.map((o) => o.text))) {
      degenerate(
        target,
        "Worksheet multiple-choice block offers the same option more than once.",
        true,
      );
    }
    if (
      block.type === "matching" &&
      (!allDistinct(block.pairs.map((p) => p.left)) ||
        !allDistinct(block.pairs.map((p) => p.right)))
    ) {
      degenerate(target, "Worksheet matching block has pairs that are not all different.", true);
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* leaked-language                                                     */
/* ------------------------------------------------------------------ */

function checkLeakedLanguage(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const findings: Finding[] = [];
  for (const slide of lesson.slides) {
    let leaked = false;
    walkElements(slide.elements, (element) => {
      if (leaked) return;
      const text = elementText(element);
      if (text && hasLeakedPupilPhrase(text)) leaked = true;
    });
    if (leaked) {
      findings.push({
        check: "leaked-language",
        severity: "error",
        target: { slideId: slide.id },
        message: `Slide "${slide.kind}" shows pupils wording meant for the model or the teacher.`,
        fix: { kind: "regenerate-slide" },
      });
    }
    if (slide.notes && hasLeakedRepairPhrase(slide.notes)) {
      findings.push({
        check: "leaked-language",
        severity: "error",
        target: { slideId: slide.id },
        message: `Slide "${slide.kind}" has notes that describe a correction instead of what to say.`,
        fix: { kind: "regenerate-slide" },
      });
    }
  }
  for (const block of worksheet?.blocks ?? []) {
    if (hasLeakedPupilPhrase(blockPupilText(block))) {
      findings.push({
        check: "leaked-language",
        severity: "error",
        target: { blockId: block.id },
        message: `Worksheet ${block.type} block shows pupils wording meant for the model or the teacher.`,
        fix: { kind: "regenerate-block" },
      });
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function elementText(element: SlideElement): string | undefined {
  if (element.type === "group") return undefined;
  if ("doc" in element && element.doc) return richDocToPlainText(element.doc as RichDoc).trim();
  if (element.type === "table") return element.rows.map((r) => r.join(" ")).join("\n");
  return undefined;
}

/** The plain text of every `text` element with the given preset, in slide order. */
function textsByPreset(slide: Slide, preset: TextPreset): string[] {
  const out: string[] = [];
  walkElements(slide.elements, (element) => {
    if (element.type !== "text" || element.style.preset !== preset) return;
    const text = richDocToPlainText(element.doc).trim();
    if (text) out.push(text);
  });
  return out;
}

/** The stem of a question slide: the recipes set it in the `heading` preset; else the first text. */
function stemOf(slide: Slide): string {
  const heading = textsByPreset(slide, "heading")[0];
  if (heading) return heading;
  let first = "";
  walkElements(slide.elements, (element) => {
    if (!first && element.type === "text") first = richDocToPlainText(element.doc).trim();
  });
  return first;
}

/** Every element's text keyed by id (for `question` data that points at elements). */
function elementTexts(slide: Slide): Map<string, string> {
  const map = new Map<string, string>();
  walkElements(slide.elements, (element) => {
    const text = elementText(element);
    if (text !== undefined) map.set(element.id, text);
  });
  return map;
}

function optionTexts(slide: Slide): string[] {
  const out: string[] = [];
  walkElements(slide.elements, (element) => {
    if (element.type === "option") out.push(richDocToPlainText(element.doc).trim());
  });
  return out;
}

/** A numbered or bulleted `body` doc holds one item per line; a leading marker is not the item. */
function lines(texts: string[]): string[] {
  return texts
    .flatMap((t) => t.split("\n").map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s+/, "").trim()))
    .filter((l) => l.length > 0);
}

/** What a pupil sees on a block: its doc, options, words and pairs — never the answer key. */
function blockPupilText(block: WorksheetBlock): string {
  const parts = [blockDocText(block)];
  switch (block.type) {
    case "multiple-choice":
      parts.push(...block.options.map((o) => o.text));
      break;
    case "matching":
      parts.push(...block.pairs.flatMap((p) => [p.left, p.right]));
      break;
    case "word-bank":
    case "word-search":
      parts.push(...block.words);
      break;
    default:
      break;
  }
  return parts.join("\n");
}

function blockDocText(block: WorksheetBlock): string {
  return "doc" in block && block.doc ? richDocToPlainText(block.doc).trim() : "";
}

/** Everything a pupil reads, slide by slide and block by block; never the notes. */
function pupilTexts(lesson: Lesson, worksheet?: Worksheet): string[] {
  return [
    ...lesson.slides.map((slide) => slideText(slide)),
    ...(worksheet?.blocks ?? []).map((block) => blockText(block)),
  ];
}

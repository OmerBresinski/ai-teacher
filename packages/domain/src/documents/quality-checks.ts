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

/** The kinds that teach; the same set Plan's explain-share rule counts (`@tj/generation` specs). */
const EXPLAIN_KINDS: ReadonlySet<string> = new Set([
  "content",
  "worked-example",
  "image-text",
  "vocabulary",
]);
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
  if (!facts) return [];
  // Counted in slides (ruling 82): the outline after the title and objectives slides.
  const taught = facts.outline.filter((e) => e.kind !== "title" && e.kind !== "objectives");
  if (taught.length === 0) return [];
  const explain = taught.filter((entry) => EXPLAIN_KINDS.has(entry.kind)).length;
  const floor = Math.floor((taught.length * EXPLANATION_SHARE_MIN_PERCENT) / 100);
  if (explain >= floor) return [];
  return [
    {
      check: "explanation-share",
      severity: "warning",
      target: {},
      message: `Only ${explain} of ${taught.length} slides explain (content, worked example, picture, vocabulary); at least ${EXPLANATION_SHARE_MIN_PERCENT}% should.`,
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
    // A task must ask something (TEACH-223): an open-response stem, or each exit-ticket item.
    const stems =
      slide.kind === "open-response"
        ? [stemOf(slide)]
        : slide.kind === "exit-ticket"
          ? lines(textsByPreset(slide, "body"))
          : [];
    for (const stem of stems) {
      const verdict = questionless(stem);
      if (verdict === "no-question") {
        degenerate(target, `Slide "${slide.kind}" sets a task that asks nothing: "${stem}"`, false);
      } else if (verdict === "no-referent") {
        // An error since TEACH-226: Repair writes the question the task leans on.
        degenerate(
          target,
          `Slide "${slide.kind}" refers to a decision or answer no question posed: "${stem}"`,
          false,
        );
      }
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
    if (block.type === "question") {
      const stem = richDocToPlainText(block.doc).trim();
      const verdict = questionless(stem);
      if (verdict === "no-question") {
        degenerate(target, `Worksheet question asks nothing: "${stem}"`, true);
      } else if (verdict === "no-referent") {
        degenerate(
          target,
          `Worksheet question refers to a decision or answer no question posed: "${stem}"`,
          true,
        );
      }
    }
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

/** The words a task may open a sentence with and still be a task: command words and question words. */
const COMMAND_WORDS =
  /^(explain|describe|give|name|state|list|write|compare|contrast|suggest|calculate|work out|identify|decide|choose|select|complete|show|draw|sketch|label|predict|justify|evaluate|discuss|define|outline|summarise|summarize|use|find|match|sort|order|put|circle|tick|underline|fill|finish|add|count|measure|estimate|solve|prove|convert|read|look|think|imagine|plan|design|create|make|say|tell|record|note|simplify|spot|share|expand|factorise|factorize|rewrite|analyse|analyze|annotate|apply|argue|assess|categorise|categorize|check|classify|comment|construct|correct|criticise|criticize|deduce|demonstrate|derive|determine|distinguish|divide|examine|explore|express|group|illustrate|infer|interpret|investigate|multiply|plot|rank|recall|recommend|relate|review|round|subtract|test|verify|why|how|what|which|when|where|who|is|are|does|do|can|could|should|would|will)\b/i;
/**
 * Closed-class words (determiners, pronouns, prepositions, conjunctions, common adverbs) and the
 * scenario verbs that open a set-up rather than a task. None of these opens an imperative.
 */
const NOT_A_COMMAND =
  /^(?:the|a|an|this|that|these|those|all|both|each|every|some|any|no|many|most|few|several|such|one|it|there|here|he|she|they|we|you|i|his|her|their|its|our|my|your|in|on|at|by|for|from|with|without|within|to|of|off|into|onto|under|over|through|throughout|across|between|among|against|along|around|behind|beyond|despite|inside|outside|near|past|since|until|upon|towards?|about|above|below|beneath|beside|besides|except|like|unlike|as|during|after|before|once|when|while|whilst|although|though|because|if|unless|whereas|and|but|or|so|yet|nor|also|even|only|just|still|then|now|soon|later|often|sometimes|usually|always|never|today|meanwhile|instead|otherwise|thus|hence|therefore|however|perhaps|maybe|indeed|suppose|assume|let|consider)$/i;
/**
 * The words an imperative's object opens with. A sentence whose first word is an open-class word
 * followed straight by one of these is a command ("Divide both parts …", "Correct this account …",
 * "Assess this claim …"); a statement's subject is followed by its verb instead ("Plants need …").
 */
const OBJECT_OPENER =
  /^(?:the|a|an|this|these|those|both|each|every|its|their|his|her|your|our|how|why|what|whether)$/i;
/**
 * Whether a sentence opens with an imperative: a known command or question word, or any verb, told
 * by the shape "<open-class word> <object opener>". A gerund or "-ly" adverb is not a command
 * ("Sharing the sweets is fair.", "Finally the war ended."), nor is a name with a title ("Alfred
 * the Great ruled Wessex.").
 */
function opensImperative(sentence: string): boolean {
  if (COMMAND_WORDS.test(sentence)) return true;
  const [first = "", second = "", third = ""] = sentence.split(/\s+/);
  if (!/^\p{L}+$/u.test(first) || NOT_A_COMMAND.test(first) || /(?:ing|ly)$/i.test(first)) {
    return false;
  }
  if (!OBJECT_OPENER.test(second)) return false;
  return !(second.toLowerCase() === "the" && /^\p{Lu}/u.test(third));
}
/**
 * What may come before a task's imperative and leave it a task (lab round 2, recorded exit items
 * that raised "asks nothing"): a short label and a colon ("Exit: Name one way …"), or a length
 * frame ("In one line, explain …", "In one sentence, explain …"), or both stacked ("Exit: In one
 * line, explain …": luna-direct, gpt-6-luna at low, every lesson the check blocked).
 */
const TASK_PREFIX =
  /^(?:\p{L}+(?:\s\p{L}+)?:\s*|in (?:one|a|two|three) (?:word|line|sentence|phrase)s?,\s*)+/iu;
/**
 * A leading condition clause before the imperative (l6-c, l6-d: gpt-6-luna at low, "If one service
 * raises its price, explain why demand … may be responsive.").
 */
const CONDITION_PREFIX = /^(?:if|when|once|after|before|given|using)\b[^,]{1,120},\s*/i;
/**
 * The sentence from its task's imperative on: the sentence itself when it opens with one, else the
 * sentence after a label or length frame when that does ("Put these in order: …" stays whole).
 */
function taskOf(sentence: string): string | undefined {
  if (opensImperative(sentence)) return sentence;
  const rest = sentence.replace(TASK_PREFIX, "").replace(CONDITION_PREFIX, "");
  return rest !== sentence && opensImperative(rest) ? rest : undefined;
}
const opensTask = (sentence: string) => taskOf(sentence) !== undefined;
/** A task that leans on a decision or answer only an earlier question could have set up. */
const ANAPHORIC_TASK = /\b(your (decision|answer|choice)|(this|the) animal|these|this one)\b/i;
/**
 * "these" with its own noun ("these features"), which can point back at a noun phrase; a bare
 * "these" ("Sort these into two groups.") needs its items shown.
 */
function demonstrativeWithNoun(sentence: string): boolean {
  const noun = /\bthese\s+(\p{L}+)/iu.exec(sentence)?.[1];
  return noun !== undefined && !NOT_A_COMMAND.test(noun);
}
/** Anaphora only a decision or answer can resolve: "your decision", "the animal". */
const DECISION_ANAPHOR = /\b(your (decision|answer|choice)|(this|the) animal)\b/i;
/** The answer an earlier task in the same stem produced. */
const YOUR_ANSWER = /\byour (answer|choice)\b/i;
/**
 * "your answer" to a task the same sentence set first, joined by "and" or "then" (l6-e: "Suppose
 * 36 beads are shared in the ratio 1:3. Explain how to find each share and check your answer.").
 * The first clause must itself be a task of three words or more, so "Decide and explain your
 * answer." still leans on nothing.
 */
function answersOwnTask(sentence: string): boolean {
  const at = sentence.search(YOUR_ANSWER);
  if (at < 0) return false;
  const [first, ...rest] = sentence.slice(0, at).split(/\b(?:and|then)\b/i);
  const clause = (first ?? "").trim();
  return (
    rest.length > 0 &&
    opensTask(clause) &&
    !ANAPHORIC_TASK.test(clause) &&
    clause.split(/\s+/).length >= 3
  );
}
/** A bare "it"; dangling only when nothing before it in the sentence could be what it names. */
const BARE_IT = /\bit\b/i;
/**
 * A noun phrase "it" can refer back to: a determiner or number and a word ("a puppy", "two
 * changes"), or a capitalised word after the first ("Explain why Prospero ...").
 */
const ANTECEDENT =
  /\b(a|an|the|this|that|each|every|his|her|their|its|our|my|one|two|three|\d+)\s+\p{L}/iu;
const PROPER_NOUN = /\s\p{Lu}\p{L}/u;

/**
 * Whether a sentence leans on "it" with no noun before it ("Explain why it melts."). A noun in an
 * earlier sentence of the same stem counts (lab round 2: "Suppose a small plant is left in a dark
 * cupboard. Explain why it may grow weak and pale."; "A foal is a young horse. Explain how you
 * know it will become an adult horse."); each earlier sentence is tested on its own, so the
 * capital that opens the task sentence is never taken for a name.
 */
function danglingIt(sentence: string, earlier: readonly string[] = []): boolean {
  const at = sentence.search(BARE_IT);
  if (at < 0) return false;
  return !namesSomething(sentence.slice(0, at)) && !earlier.some(namesSomething);
}
/** Whether text holds a noun phrase a later "it" or "these" can point back at. */
function namesSomething(text: string): boolean {
  return ANTECEDENT.test(text) || PROPER_NOUN.test(text);
}
/** Text that poses the decision such a task refers back to. */
const POSES_DECISION = /\?|\b(whether|decide|is it|are they|which|what)\b/i;
/** A "these/this …" task whose items follow a colon as a list of two or more. */
const LISTS_ITS_REFERENTS = /\b(these|this)\b[^:?]*:\s*[^,]+,\s*\S/i;

/**
 * Whether a stem asks anything (TEACH-223). "no-question": no `?` and no sentence opens with an
 * imperative or question word — e.g. "The rodent family." "no-referent": it does set a task, but
 * one about "your decision"/"the animal"/"it" with nothing before it that posed the decision —
 * "An animal has X. Explain your decision." Otherwise "ok".
 */
export function questionless(stem: string): "ok" | "no-question" | "no-referent" {
  const sentences = stem
    // A quotation's closing mark after its full stop ends the sentence too (l6-c, l6-d: "Suppose
    // Prospero tells a spirit, “Wait here until I return.” Explain how …").
    .split(/(?<=[.?!][”"’']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return "ok";
  if (!stem.includes("?") && !sentences.some(opensTask)) {
    return "no-question";
  }
  for (let i = 0; i < sentences.length; i++) {
    const s = taskOf(sentences[i] as string);
    const earlier = sentences.slice(0, i);
    if (s === undefined || !(ANAPHORIC_TASK.test(s) || danglingIt(s, earlier))) continue;
    // "Put these dates in order: AD 43, AD 410, AD 1." — the things referred to follow the colon.
    if (LISTS_ITS_REFERENTS.test(s)) continue;
    // "these features" after a sentence that names them, as "it" is (l6-h: "A particular brand of
    // washing-up liquid has few close alternatives and costs little. Explain how these features
    // affect …").
    if (
      demonstrativeWithNoun(s) &&
      !DECISION_ANAPHOR.test(s) &&
      !danglingIt(s, earlier) &&
      earlier.some(namesSomething)
    ) {
      continue;
    }
    const before = earlier.join(" ");
    // An earlier task sentence poses the answer "your answer" refers to ("Share £72 in the ratio
    // 5:7. Give a check for your answer.").
    if (earlier.some(opensTask) && YOUR_ANSWER.test(s) && !danglingIt(s, earlier)) continue;
    // The same sentence set the task first ("Explain how to find each share and check your answer.").
    if (answersOwnTask(s) && !danglingIt(s, earlier)) continue;
    if (!POSES_DECISION.test(before) && !POSES_DECISION.test(s)) return "no-referent";
  }
  return "ok";
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

import type {
  FactQuestion,
  LessonFacts,
  Misconception,
  OutlineEntry,
  Slide,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { asksForUnlistedOptions } from "@tj/domain/documents";
import {
  ANSWERS_NAME,
  fitSlide,
  getTheme,
  HEADING_NAME,
  isBackdrop,
  materialiseSlide,
  measureHeadless,
  type QuizLine,
  SAFE_BOTTOM,
  type SlideSpec,
  SPACE,
  THEMES,
  textPartsOf,
} from "@tj/slides";

/*
 * Lab r1 (structure): the slides the lab writes in code from the facts, with no model call —
 * question sets on starter, check and exit slides (pending UX ruling 89 / decision D5), and the
 * deterministic option order of every multiple-choice question (SYNTHESIS cause 6: the correct
 * answer was always A). Only the lab path uses this: Generate calls it only for a lesson whose
 * outline `outlineFromFacts` wrote (the `OUTLINE_FROM_FACTS_VERSION` stamp), so production's
 * planner and its slides are untouched.
 *
 * A set is a numbered list of short questions, one line each, printed from the facts verbatim:
 * - a question with three or more distractors is multiple choice, its four options on the line
 *   in a seeded order ("… A x  B y  C z  D w");
 * - any other question is asked as its stem (a one-line answer);
 * - a misconception is a true/false line on its belief (the facts declare the belief false).
 * A line longer than `LINE_MAX` (the list item cap) is never cut: the outline leaves such a
 * question to a slide of its own. The answers ride on the slide as a reveal (step 1) in the
 * footnote's place, and in the notes.
 */

/** The `generatedFrom.model` a slide printed in code carries (no model wrote it). */
export const CODE_MODEL = "code";

/**
 * Whether a slide is one the lab printed in code (a question set: starter, check or exit quiz):
 * every element that records its provenance names `CODE_MODEL`. A slide Repair has rewritten
 * names the repair model and is not.
 */
export function isCodeBuilt(slide: Slide): boolean {
  const stamps = slide.elements.flatMap((e) => (e.generatedFrom ? [e.generatedFrom.model] : []));
  return stamps.length > 0 && stamps.every((m) => m === CODE_MODEL);
}

/**
 * Lab r4: whether a slide is the retrieval starter, the set `codedSetSpec` prints from
 * `LessonFacts.retrieval` whenever the facts carry one (a code-built starter then always is it).
 * Its questions are about earlier lessons by design, so its answers are not in this lesson's facts:
 * a check that reads it against them cannot be right, and a rewrite from them would pre-test what
 * the lesson is about to teach (r3-h-y9-coasts-L: fetch and managed retreat replaced weathering).
 */
export function isRetrievalStarter(
  slide: Slide,
  facts: Pick<LessonFacts, "retrieval"> | undefined,
): boolean {
  return slide.kind === "starter" && (facts?.retrieval?.length ?? 0) > 0 && isCodeBuilt(slide);
}

/** A list item's cap (`SPEC_LIMITS.item`), restated so the outline has no `@tj/slides` import. */
export const LINE_MAX = 160;
/**
 * A multiple-choice line carries its four options, so it may run longer than a stem (36 of 49
 * cb/w0b multiple-choice questions fit 240, 14 fit 160); a set stays within `SET_CHARS`.
 */
export const MC_LINE_MAX = 240;
/** The text one set slide carries at most, its lines together (a content body is 400). */
export const SET_CHARS = 600;
/** A set: 2–4 lines (the `instructions` list holds four; the starter three). */
export const SET_MIN = 2;
export const SET_MAX = 4;
export const STARTER_MAX = 3;
/**
 * The exit ticket: at most three questions, one per objective first (UX ruling 108, TEACH-172),
 * on one slide with its answers. One is enough to print it; the outline tops it up to three.
 */
export const EXIT_QUIZ_MIN = 1;
export const EXIT_QUIZ_MAX = 3;
const LETTERS = ["A", "B", "C", "D"] as const;

type LineQuestion = Pick<FactQuestion, "stem" | "answer"> & {
  distractors?: readonly { text: string }[] | undefined;
};
/** `quiz`: the line as data, for the options grid (`@tj/slides` structure.ts). */
export type Line = { text: string; answer: string; mc?: boolean; ref?: string; quiz?: QuizLine };

/** 32-bit FNV-1a: a stable seed from a string (lesson id and slide). */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A permutation of `0..n-1`, the same for the same seed (mulberry32 driving Fisher–Yates). */
export function seededOrder(n: number, seed: string): number[] {
  let state = hash(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

/** `items` in the seeded order. */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  return seededOrder(items.length, seed).map((i) => items[i] as T);
}

/**
 * A multiple-choice spec with its options in the seeded order (SYNTHESIS cause 6: the model lists
 * the answer first, so it was always A). Any other spec is returned as it is.
 */
export function withShuffledOptions(spec: SlideSpec, seed: string): SlideSpec {
  if (spec.kind !== "multiple-choice") return spec;
  return { ...spec, options: shuffled(spec.options, seed) };
}

/** Multiple choice: the answer and the first three distractors, in the seeded order. */
export function mcOptions(
  q: LineQuestion,
  seed: string,
): { text: string; correct: boolean }[] | undefined {
  const distractors = q.distractors ?? [];
  if (distractors.length < 3) return undefined;
  const options = [
    { text: q.answer, correct: true },
    ...distractors.slice(0, 3).map((d) => ({ text: d.text, correct: false })),
  ];
  return shuffled(options, seed);
}

/** Words that carry no content for `sameQuestion`: short words and the usual question frame. */
const FRAME_WORDS = new Set([
  "what",
  "which",
  "why",
  "how",
  "does",
  "did",
  "that",
  "this",
  "these",
  "those",
  "with",
  "from",
  "into",
  "they",
  "their",
  "them",
  "there",
  "when",
  "would",
  "could",
  "should",
  "about",
  "your",
  "have",
  "been",
  "were",
  "will",
  "than",
  "then",
  "some",
  "most",
  "more",
  "each",
  "because",
]);
const contentWords = (text: string): Set<string> =>
  new Set(
    (text.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? []).filter(
      (w) => /\d/.test(w) || (w.length >= 4 && !FRAME_WORDS.has(w)),
    ),
  );
/** Share of the smaller question's content words the other repeats at or above which two questions ask the same thing. */
export const SAME_QUESTION_OVERLAP = 0.6;
/**
 * Two questions ask the same thing: their stems and answers share most content words (words of
 * four letters or more outside the question frame, and every number). Measured on the l1/l2 exit
 * quizzes (pw prompts-2): a slide question topped up beside the exit question written in parallel
 * on the same key idea ("Why did the government move children from cities in 1939?" twice). Two
 * questions whose numbers differ are never the same ("Simplify 8:12" and "Simplify 15:25" are two
 * practice items), so a set of practice on one method is not a repeat.
 */
export function sameQuestion(
  a: Pick<LineQuestion, "stem" | "answer">,
  b: Pick<LineQuestion, "stem" | "answer">,
): boolean {
  const x = contentWords(`${a.stem} ${a.answer}`);
  const y = contentWords(`${b.stem} ${b.answer}`);
  const numbers = (set: Set<string>) =>
    [...set]
      .filter((w) => /\d/.test(w))
      .sort()
      .join(" ");
  if (numbers(x) !== numbers(y)) return false;
  const smaller = Math.min(x.size, y.size);
  if (smaller === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / smaller >= SAME_QUESTION_OVERLAP;
}

/** A question as one line of a set, with its answer. */
export function questionLine(q: LineQuestion, seed = ""): Line {
  const options = mcOptions(q, seed);
  if (!options) {
    const open = { stem: q.stem.trim(), answer: q.answer.trim() };
    return { text: open.stem, answer: open.answer, quiz: open };
  }
  const at = options.findIndex((o) => o.correct);
  const answer = `${LETTERS[at]} (${options[at]?.text.trim() ?? ""})`;
  return {
    text: `${q.stem.trim()} ${options.map((o, i) => `${LETTERS[i]} ${o.text.trim()}`).join("  ")}`,
    answer,
    mc: true,
    quiz: { stem: q.stem.trim(), options: options.map((o) => o.text.trim()), correct: at, answer },
  };
}

/** A misconception as a true/false line: its belief, which the facts declare false. */
export function misconceptionLine(m: Pick<Misconception, "belief" | "correction">): Line {
  const belief = m.belief.trim().replace(/[.!]+$/, "");
  const answer = `False. ${m.correction.trim()}`;
  return {
    text: `True or false? ${belief}.`,
    answer,
    quiz: { stem: `${belief}.`, options: ["True", "False"], correct: 1, answer },
  };
}

export const fitsLine = (line: Line) => line.text.length <= (line.mc ? MC_LINE_MAX : LINE_MAX);

/**
 * The lines a set keeps, in order: each within its line cap, at most `max`, and each only while
 * the set with its answers still fits one slide on every theme (`fitsSet`, slot-first packing).
 * A line that does not fit is passed over for a later one; it is left off, never shortened.
 */
export function keptLines<T extends Line>(
  lines: readonly T[],
  max: number,
  kind: "starter" | "instructions" = "instructions",
): T[] {
  const kept: T[] = [];
  for (const line of lines) {
    if (!fitsLine(line) || kept.length >= max) continue;
    if (fitsSet(kind, [...kept, line])) kept.push(line);
  }
  return kept;
}

/** The set kinds the lab writes in code, with their heading and line cap. */
const CODED: Partial<Record<OutlineEntry["kind"], { heading: string; max: number }>> = {
  starter: { heading: "Do now", max: STARTER_MAX },
  instructions: { heading: "Quick check", max: SET_MAX },
  "exit-ticket": { heading: "Exit ticket", max: EXIT_QUIZ_MAX },
};

/**
 * The spec of a lab set slide, built from the entry's question and misconception refs, or
 * `undefined` when the entry is not one (another kind, or a starter with no question and no
 * retrieval set: that one retrieves the brief's prior knowledge and the model writes it). `seed`: lesson id and position.
 */
export function codedSetSpec(
  entry: OutlineEntry,
  facts: LessonFacts,
  seed: string,
): { spec: SlideSpec; answers: string[]; questionRefs: string[]; quiz: QuizLine[] } | undefined {
  const coded = CODED[entry.kind];
  if (!coded) return undefined;
  const questions = new Map(facts.questions.map((q) => [q.id, q]));
  const misconceptions = new Map((facts.misconceptions ?? []).map((m) => [m.id, m]));
  const lines: Line[] = [];
  let asked = 0;
  // Lab r2: a starter prints the objectives call's retrieval questions (prior knowledge, answers
  // shown) whenever the facts carry them; the outline then gives it no question of the lesson's.
  const retrieval = entry.kind === "starter" ? (facts.retrieval ?? []) : [];
  for (const r of retrieval) {
    asked += 1;
    const open = { stem: r.question.trim(), answer: r.answer.trim() };
    lines.push({ text: open.stem, answer: open.answer, quiz: open });
  }
  for (const ref of retrieval.length > 0 ? [] : entry.factRefs) {
    const q = questions.get(ref);
    const m = misconceptions.get(ref);
    if (q) {
      // A stem that asks pupils to choose from options it does not list is left off; `asked`
      // counts printed questions only, so a check slide left with none is the model's.
      if (asksForUnlistedOptions(q)) continue;
      asked += 1;
      lines.push({ ...questionLine(q, `${seed}:${ref}`), ref });
    } else if (m && entry.kind !== "starter") lines.push(misconceptionLine(m));
  }
  // A starter or check slide with no question is the model's (a misconception discussed, prior
  // knowledge retrieved); the exit quiz is code's whenever it has a line.
  if ((entry.kind !== "exit-ticket" && asked === 0) || lines.length === 0) return undefined;
  const kept =
    entry.kind === "exit-ticket"
      ? exitLines(lines)
      : keptLines(lines, coded.max, entry.kind === "starter" ? "starter" : "instructions");
  if (kept.length === 0) return undefined;
  const answers = kept.map((l) => l.answer);
  const footnote = answersLine(answers);
  const notes = `Answers: ${answers.map((a, i) => `${i + 1}. ${a}`).join(" ")}`;
  const items = kept.map((l) => l.text);
  const base = { factRefs: entry.factRefs, notes, heading: coded.heading, footnote };
  const spec: SlideSpec =
    entry.kind === "instructions"
      ? { kind: "instructions", ...base, steps: items }
      : entry.kind === "starter"
        ? { kind: "starter", ...base, items }
        : { kind: "exit-ticket", ...base, items };
  // The lesson questions the set actually prints (a line over the caps is dropped): what
  // `laterQuestionsFor` hands the teaching slides before it.
  const questionRefs = kept.flatMap((l) => (l.ref && questions.has(l.ref) ? [l.ref] : []));
  const quiz = kept.map((l) => l.quiz ?? { stem: l.text, answer: l.answer });
  return { spec, answers, questionRefs, quiz };
}

const answersLine = (answers: readonly string[]) =>
  `Answers: ${answers.map((a, i) => `${i + 1} ${a}`).join("  ·  ")}`;
/** The gap between a list and the answers revealed under it. */
const ANSWERS_GAP = SPACE[2];
const EXIT_META = { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" };

/** Height a text element's words need at its width, by the headless ruler. */
function needOf(slide: Slide, el: TextElement, theme: Theme): number {
  const parts = textPartsOf(el, slide);
  return parts ? measureHeadless(theme)({ ...parts, width: el.w }) : el.h;
}

/** The list and the answer strip of a set slide: its body and its footnote. */
function setParts(slide: Slide): { body: TextElement; foot: TextElement } | undefined {
  const texts = slide.elements.filter((e): e is TextElement => e.type === "text");
  const body = texts.find((e) => e.style.preset === "body");
  const foot = texts.find((e) => e.style.preset === "small");
  return body && foot ? { body, foot } : undefined;
}

/**
 * Room for a set's answers between its list's measured text and the foot of the safe area, in
 * points, on `theme` (negative: they do not fit). The footnote's own box is not the bound: the
 * fit engine pushes it down when the list grows, past the safe area if need be.
 */
function answersRoom(slide: Slide, theme: Theme): { top: number; spare: number } | undefined {
  const parts = setParts(slide);
  if (!parts) return undefined;
  const { body, foot } = parts;
  const top = Math.ceil(body.y + needOf(slide, body, theme) + ANSWERS_GAP);
  return { top, spare: SAFE_BOTTOM - top - needOf(slide, foot, theme) };
}

const CHROME_NAMES = new Set([HEADING_NAME, "Kind tag", "Accent bar"]);

/**
 * Whether a set `materialiseSlide` laid out itself fits: the answers panel (`@tj/slides`
 * structure.ts, a card anchored to the foot on reveal step 1) clears the last question, as
 * `answersClear` there asks, or, with the answers shown in place and no panel, the questions end
 * inside the safe area; nothing overflows. Undefined for a slide still carrying its answers as a
 * footnote, which `answersRoom` measures.
 */
function laidOutFits(slide: Slide, theme: Theme): boolean | undefined {
  const panel = slide.elements.find((e) => e.name === ANSWERS_NAME && e.type === "shape");
  if (!panel && setParts(slide)) return undefined;
  const fitted = fitSlide(slide, theme);
  if (fitted.overflow.length > 0) return false;
  const foot = Math.max(
    0,
    ...fitted.slide.elements
      .filter(
        (e) =>
          e.id !== panel?.id &&
          !CHROME_NAMES.has(e.name ?? "") &&
          !isBackdrop(e) &&
          !(e.revealStep ?? 0),
      )
      .map((e) => e.y + e.h),
  );
  return panel ? panel.y >= foot + ANSWERS_GAP : foot <= SAFE_BOTTOM;
}

/**
 * The exit ticket's lines and their answers fit one slide on every theme (UX ruling 108): the
 * list at full size under the heading, the answers under the list, all inside the safe area.
 * Every theme, because a teacher can change the look after the lesson is written.
 */
export function fitsExitTicket(lines: readonly Line[]): boolean {
  return fitsSet("exit-ticket", lines);
}

/**
 * Slot-first packing (fit lab): any set the lab prints in code — a starter, a check, the exit
 * ticket — fits one slide with its answers on every theme, measured as the exit ticket is.
 */
export function fitsSet(
  kind: "starter" | "instructions" | "exit-ticket",
  lines: readonly Line[],
): boolean {
  const items = lines.map((l) => l.text);
  const base = {
    factRefs: [],
    heading: CODED[kind]?.heading ?? "",
    footnote: answersLine(lines.map((l) => l.answer)),
  };
  const spec: SlideSpec =
    kind === "instructions" ? { kind, ...base, steps: items } : { kind, ...base, items };
  return THEMES.every((theme) => {
    const slide = materialiseSlide(spec, theme.id, EXIT_META);
    const laid = laidOutFits(slide, theme);
    if (laid !== undefined) return laid;
    const room = answersRoom(slide, theme);
    return room !== undefined && room.spare >= 0;
  });
}

/**
 * The lines an exit ticket keeps (UX ruling 108, TEACH-172): in order, at most `EXIT_QUIZ_MAX`,
 * each within its line cap, and a line only when the ticket with it still fits
 * (`fitsExitTicket`); a line that does not fit is passed over for a later, shorter one, and when
 * taking the shortest first keeps more lines, those are kept (in the given order). Measured
 * rather than counted: a character budget cannot know where a line wraps. When no line fits
 * alone, the first that fits its cap is kept, so the ticket is never empty for want of room.
 */
export function exitLines<T extends Line>(lines: readonly T[]): T[] {
  const capped = lines.filter(fitsLine);
  const greedy = (order: readonly T[]) => {
    const kept: T[] = [];
    for (const line of order) {
      if (kept.length >= EXIT_QUIZ_MAX) break;
      if (fitsExitTicket([...kept, line])) kept.push(line);
    }
    return kept;
  };
  const inOrder = greedy(capped);
  // A long first line can crowd out two short ones: shortest first (question and answer) keeps
  // more when it can, still printed in the given order.
  const size = (l: T) => l.text.length + l.answer.length;
  const short = greedy([...capped].sort((a, b) => size(a) - size(b)));
  const kept = short.length > inOrder.length ? capped.filter((l) => short.includes(l)) : inOrder;
  const first = capped[0];
  return kept.length === 0 && first ? [first] : kept;
}

/**
 * The answers as a reveal. A slide `materialiseSlide` gave the answers panel (`@tj/slides`
 * structure.ts: a card anchored to the foot on reveal step 1) is returned as it is. Otherwise the footnote element (which carries them) appears on the slide's
 * first step. Given the lesson's theme, it sits under the list's measured text when there is room
 * there (TEACH-172: no answer covers a question); otherwise, or with no theme, in the lower part
 * of the list's box, which gives it the room. Nothing else moves.
 */
export function withAnswersReveal(slide: Slide, themeId?: string): Slide {
  if (slide.elements.some((e) => e.name === ANSWERS_NAME && e.type === "shape")) return slide;
  const parts = setParts(slide);
  if (!parts) return slide;
  const { body, foot } = parts;
  const bottom = foot.y + foot.h;
  const room = themeId === undefined ? undefined : answersRoom(slide, getTheme(themeId));
  if (room && room.spare >= 0) {
    return {
      ...slide,
      elements: slide.elements.map((e) => {
        if (e === body) return { ...e, h: room.top - ANSWERS_GAP - body.y };
        if (e === foot)
          return {
            ...e,
            y: room.top,
            h: SAFE_BOTTOM - room.top,
            name: ANSWERS_NAME,
            revealStep: 1,
            reveal: "fade",
          };
        return e;
      }),
    };
  }
  const top = body.y + Math.round(body.h * 0.7);
  return {
    ...slide,
    elements: slide.elements.map((e) => {
      if (e === body) return { ...e, h: top - body.y - 8 };
      if (e === foot)
        return { ...e, y: top, h: bottom - top, name: ANSWERS_NAME, revealStep: 1, reveal: "fade" };
      return e;
    }),
  };
}

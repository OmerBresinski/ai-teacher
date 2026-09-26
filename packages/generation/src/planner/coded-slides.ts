import type {
  FactQuestion,
  LessonFacts,
  Misconception,
  OutlineEntry,
  Slide,
} from "@tj/domain/documents";
import { asksForUnlistedOptions } from "@tj/domain/documents";
import type { SlideSpec } from "@tj/slides";

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
/** The exit quiz's text on one slide, its lines together (six lines of about 140). */
export const EXIT_CHARS = 840;
/** A set: 2–4 lines (the `instructions` list holds four; the starter three). */
export const SET_MIN = 2;
export const SET_MAX = 4;
export const STARTER_MAX = 3;
/** The exit quiz: 4–6 quick items (uk-teacher review, cb judges). */
export const EXIT_QUIZ_MIN = 4;
export const EXIT_QUIZ_MAX = 6;
const LETTERS = ["A", "B", "C", "D"] as const;

type LineQuestion = Pick<FactQuestion, "stem" | "answer"> & {
  distractors?: readonly { text: string }[] | undefined;
};
export type Line = { text: string; answer: string; mc?: boolean; ref?: string };

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
  if (!options) return { text: q.stem.trim(), answer: q.answer.trim() };
  const at = options.findIndex((o) => o.correct);
  return {
    text: `${q.stem.trim()} ${options.map((o, i) => `${LETTERS[i]} ${o.text.trim()}`).join("  ")}`,
    answer: `${LETTERS[at]} (${options[at]?.text.trim() ?? ""})`,
    mc: true,
  };
}

/** A misconception as a true/false line: its belief, which the facts declare false. */
export function misconceptionLine(m: Pick<Misconception, "belief" | "correction">): Line {
  const belief = m.belief.trim().replace(/[.!]+$/, "");
  return { text: `True or false? ${belief}.`, answer: `False. ${m.correction.trim()}` };
}

export const fitsLine = (line: Line) => line.text.length <= (line.mc ? MC_LINE_MAX : LINE_MAX);

/** The lines a set keeps: each fits, at most `max`, within `SET_CHARS` together, in order. */
export function keptLines<T extends Line>(
  lines: readonly T[],
  max: number,
  chars_ = SET_CHARS,
): T[] {
  const kept: T[] = [];
  let chars = 0;
  for (const line of lines) {
    if (!fitsLine(line) || kept.length >= max || chars + line.text.length > chars_) continue;
    kept.push(line);
    chars += line.text.length;
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
): { spec: SlideSpec; answers: string[]; questionRefs: string[] } | undefined {
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
    lines.push({ text: r.question.trim(), answer: r.answer.trim() });
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
  const kept = keptLines(lines, coded.max, entry.kind === "exit-ticket" ? EXIT_CHARS : SET_CHARS);
  if (kept.length === 0) return undefined;
  const answers = kept.map((l) => l.answer);
  const footnote = `Answers: ${answers.map((a, i) => `${i + 1} ${a}`).join("  ·  ")}`;
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
  return { spec, answers, questionRefs };
}

/**
 * The answers as a reveal: the footnote element (which carries them) appears on the slide's
 * first step, in the lower part of the list's box, which gives it the room. Nothing else moves.
 */
export function withAnswersReveal(slide: Slide): Slide {
  const body = slide.elements.find((e) => e.type === "text" && e.style.preset === "body");
  const foot = slide.elements.find((e) => e.type === "text" && e.style.preset === "small");
  if (!body || !foot) return slide;
  const bottom = foot.y + foot.h;
  const top = body.y + Math.round(body.h * 0.7);
  return {
    ...slide,
    elements: slide.elements.map((e) => {
      if (e === body) return { ...e, h: top - body.y - 8 };
      if (e === foot)
        return { ...e, y: top, h: bottom - top, name: "Answers", revealStep: 1, reveal: "fade" };
      return e;
    }),
  };
}

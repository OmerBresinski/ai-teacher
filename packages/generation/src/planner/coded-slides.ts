import type {
  FactQuestion,
  FigureRef,
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
  diagramVariantFor,
  FIGURE_TEMPLATES,
  fitSlide,
  getTheme,
  HEADING_NAME,
  type IdSupplier,
  isBackdrop,
  type MaterialiseMeta,
  materialiseSlide,
  measureHeadless,
  paletteForm,
  type QuizLine,
  SAFE_BOTTOM,
  type SlideSpec,
  type SlideStructure,
  SPACE,
  THEMES,
  textPartsOf,
} from "@tj/slides";
import { type DesignSlot, ROLE_FORMS, type SlotForm, type SlotRole } from "../prompts/design-cycle";
import { VISUAL_NEED_LEANS } from "./cycles";

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
 * The exit ticket: one line per objective (the lesson designer plan, requirement 5), for up to
 * four objectives, on one slide with its answers (TEACH-172). One is enough to print it.
 */
export const EXIT_QUIZ_MIN = 1;
export const EXIT_QUIZ_MAX = 4;
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
/**
 * A check question on the exit ticket, when its objective has no exit question that fits: the
 * stem, asked open, with its answer (the options are left off, as the line has no room for them).
 */
export function exitStemLine(q: Pick<FactQuestion, "stem" | "answer">): Line {
  return questionLine({ stem: q.stem, answer: q.answer });
}

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
      // On the exit ticket a question that is not an exit question is an objective's check
      // question standing in for its missing exit line: its stem, asked open.
      const line =
        entry.kind === "exit-ticket" && q.use !== "exit"
          ? exitStemLine(q)
          : questionLine(q, `${seed}:${ref}`);
      lines.push({ ...line, ref });
    } else if (m && entry.kind !== "starter") lines.push(misconceptionLine(m));
  }
  // A starter or check slide with no question is the model's (a misconception discussed, prior
  // knowledge retrieved); the exit quiz is code's whenever it has a line.
  if ((entry.kind !== "exit-ticket" && asked === 0) || lines.length === 0) return undefined;
  const kept =
    entry.kind === "exit-ticket" ? exitLines(lines) : keptLines(lines, coded.max, SET_CHARS);
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
  const spec: SlideSpec = {
    kind: "exit-ticket",
    factRefs: [],
    heading: "Exit ticket",
    items: lines.map((l) => l.text),
    footnote: answersLine(lines.map((l) => l.answer)),
  };
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
  // The fit stepped the list down to make room for the footnote in the flow; once the footnote is
  // the reveal panel, the list goes back to its own size when the panel still has room under it
  // (plan-write: every set on playground and splash stayed a step down whatever it held).
  if (themeId !== undefined && body.type === "text" && body.style.fontSize !== undefined) {
    const { fontSize: _stepped, ...style } = body.style;
    const full = { ...body, style } as typeof body;
    const t = getTheme(themeId);
    const grown = { ...full, h: Math.max(body.h, needOf(slide, full as TextElement, t)) };
    const unstepped = { ...slide, elements: slide.elements.map((e) => (e === body ? grown : e)) };
    const roomFull = answersRoom(unstepped, t);
    if (roomFull && roomFull.spare >= 0) return withAnswersReveal(unstepped, themeId);
  }
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

/* ------------------------------------------------------------------ designer slots */

/*
 * The lesson designer's slot renderers (the lesson designer plan, PR 8; TEACH-208): every palette
 * slide form mapped from its slot material to the slide spec its palette entry names, laid out in
 * that entry's variant with its structure hints. No second writer runs: the text the design cycle
 * wrote is the text on the slide. A figure slot whose brief names a template with values that
 * pass the template's rules (ADR 0032, `FIGURE_TEMPLATES[t].values`) is a diagram slide drawing
 * that template; one without them, or with values the template refuses, is the labelled diagram
 * placeholder carrying its brief (ruling 133).
 */

/**
 * The figure a figure slot draws: its brief's template and values, when the values pass the
 * template's rules (the same schema a generated diagram spec embeds). `undefined` otherwise.
 */
export function figureOfBrief(brief: {
  template: FigureRef["template"];
  values?: Record<string, unknown> | undefined;
}): FigureRef | undefined {
  if (!brief.values) return undefined;
  const template = FIGURE_TEMPLATES[brief.template];
  if (!template) return undefined;
  const parsed = template.values.safeParse(brief.values);
  return parsed.success
    ? { template: brief.template, values: parsed.data as Record<string, unknown> }
    : undefined;
}

/** A slot as the renderer lays it out: the spec, the recipe variant and the structure hints. */
export type SlotRender = {
  form: SlotForm;
  spec: SlideSpec;
  variant?: string;
  structure: SlideStructure;
};

/** The palette's variant for a form (the kind's default when the entry names none). */
export function paletteVariantOf(form: SlotForm): string | undefined {
  const r = paletteForm(form).renderer;
  return r.on === "slide" ? r.variant : undefined;
}

/**
 * The slide spec, variant and structure for one designer slot. `seed` orders a hinge's options
 * (the model tends to list the answer first); `factRefs` ride on the spec as for any slide.
 */
export function slotRender(slot: DesignSlot, seed: string, factRefs: string[] = []): SlotRender {
  const base = { factRefs, ...(slot.notes ? { notes: slot.notes } : {}) };
  const variant = paletteVariantOf(slot.form);
  const out = (spec: SlideSpec, structure: SlideStructure = {}): SlotRender => ({
    form: slot.form,
    spec,
    ...(variant ? { variant } : {}),
    structure,
  });
  switch (slot.form) {
    case "explain":
      return out({ kind: "content", ...base, heading: slot.heading, body: slot.body });
    case "explain-callout":
      return out({
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        callout: { kind: "watch-out", text: slot.callout.text },
      });
    case "list":
      return out({
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        points: slot.points,
      });
    case "compare":
      return out({
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        compare: slot.compare,
      });
    case "sequence":
      return out({
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        steps: slot.steps,
      });
    case "photo":
      return out(
        { kind: "content", ...base, heading: slot.heading, body: slot.body },
        { photo: { subject: slot.imageBrief.subject, mustShow: slot.imageBrief.mustShow ?? [] } },
      );
    case "figure": {
      const figure = figureOfBrief(slot.figureBrief);
      if (figure) {
        return {
          form: slot.form,
          spec: { kind: "diagram", ...base, heading: slot.heading, body: slot.body, figure },
          variant: diagramVariantFor(figure.template, figure.values),
          structure: {},
        };
      }
      return out({
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        diagram: slot.figureBrief.purpose,
      });
    }
    case "diagram-slot":
      return out({
        kind: "content",
        ...base,
        heading: slot.heading,
        body: slot.body,
        diagram: slot.diagram,
      });
    case "worked-example":
      return out({
        kind: "worked-example",
        ...base,
        heading: slot.heading,
        question: slot.question,
        steps: slot.steps,
      });
    case "hinge":
      return out(
        withShuffledOptions(
          {
            kind: "multiple-choice",
            ...base,
            stem: slot.stem,
            options: slot.options,
            // A hinge written with no explanation leaves no "Why?" panel.
            ...(slot.explanation ? { explanation: slot.explanation } : {}),
          },
          seed,
        ),
      );
    case "true-false":
      return out({
        kind: "true-false",
        ...base,
        statement: slot.statement,
        correct: slot.correct,
        ...(slot.explanation ? { explanation: slot.explanation } : {}),
      });
    case "matching":
      return out({ kind: "matching", ...base, stem: slot.stem, pairs: slot.pairs });
    case "fill-gap":
      return out({
        kind: "fill-gap",
        ...base,
        stem: slot.stem,
        sentence: slot.sentence,
        answers: slot.answers,
      });
    case "sort":
      return out({ kind: "sort", ...base, stem: slot.stem, steps: slot.steps });
    case "open-response":
      return out({
        kind: "open-response",
        ...base,
        stem: slot.stem,
        modelAnswer: slot.modelAnswer,
      });
    case "discussion":
      return out({
        kind: "discussion",
        ...base,
        prompt: slot.prompt,
        ...(slot.footnote ? { footnote: slot.footnote } : {}),
      });
    case "vocabulary":
      return out({ kind: "vocabulary", ...base, entries: slot.entries });
  }
}

/** The slot laid out as a slide in the lesson's theme (`materialiseSlide`). */
export function renderSlot(
  render: SlotRender,
  themeId: string,
  meta: MaterialiseMeta,
  ids?: IdSupplier,
): Slide {
  return materialiseSlide(render.spec, themeId, meta, ids, render.variant, render.structure);
}

/** Forms that check the objective (the lesson's check count reads these). */
export const CHECK_FORMS: ReadonlySet<SlotForm> = new Set([
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
]);
/** Forms that show the objective rather than tell it. */
export const VISUAL_FORMS: ReadonlySet<SlotForm> = new Set(["photo", "figure", "diagram-slot"]);

export type DesignMinimums = {
  /** Objectives (0-based) whose arc says concrete or structural and that got no visual slot. */
  visualMissing: number[];
  /** Check-form slots across the lesson (the plan's minimum is 3). */
  checks: number;
  /** 1-based slide pairs that sit side by side in the same form. */
  sameNeighbours: [number, number][];
  /** Objectives with no teaching slot, or no check slot. */
  untaught: number[];
  unchecked: number[];
};

export const MIN_CHECKS = 3;

/**
 * The code minimums over a designed lesson (the plan's "Code enforces the minimums"): a visual
 * for every objective whose arc leans concrete or structural, at least `MIN_CHECKS` check slots,
 * no two neighbouring slides in the same form, and a teach and a check slot per objective. The
 * caller logs a miss; nothing is rewritten.
 */
export function designMinimums(
  slots: readonly { objective: number; form: SlotForm; slide: number }[],
  arcs: readonly ({ lean: string } | undefined)[],
): DesignMinimums {
  const byObjective = arcs.map((_, o) => slots.filter((s) => s.objective === o));
  const ordered = [...slots].sort((a, b) => a.slide - b.slide);
  const sameNeighbours: [number, number][] = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (a && b && b.slide === a.slide + 1 && a.form === b.form)
      sameNeighbours.push([a.slide, b.slide]);
  }
  return {
    visualMissing: arcs.flatMap((arc, o) =>
      arc &&
      VISUAL_NEED_LEANS.has(arc.lean) &&
      !byObjective[o]?.some((s) => VISUAL_FORMS.has(s.form))
        ? [o]
        : [],
    ),
    checks: slots.filter((s) => CHECK_FORMS.has(s.form)).length,
    sameNeighbours,
    untaught: byObjective.flatMap((list, o) =>
      list.some((s) => !CHECK_FORMS.has(s.form)) ? [] : [o],
    ),
    unchecked: byObjective.flatMap((list, o) =>
      list.some((s) => CHECK_FORMS.has(s.form)) ? [] : [o],
    ),
  };
}

const VISUAL_FROM_CHECK =
  "the objective has no photo, figure or diagram and its teaching slot stays; this check becomes the visual, and the objective keeps another check";

/** The most single-slot re-fills a lesson spends on its design minimums. */
export const MAX_MINIMUM_REFILLS = 2;

export type MinimumRefill = {
  /** 1-based slide number of the slot replaced. */
  slide: number;
  objective: number;
  into: SlotForm;
  /** Why, for the re-fill call: which minimum the replaced slot now meets. */
  reason: string;
  /** Set for a role re-fill: the slot's role, whose forms (`ROLE_FORMS`) the re-fill must be in. */
  role?: SlotRole;
};

/**
 * The design minimums enforced (designer eval r1): an objective whose arc leans concrete or
 * structural with no visual slot gets one teaching slot re-filled as its visual (the arc's lean
 * when it is a visual form the subject offers, else a diagram slot); a lesson with fewer than 3
 * checks gets teaching slots re-filled as true-false checks, from an objective that keeps another
 * teaching slot, unchecked objectives first. Before both, each slot held to its role
 * (`ROLE_FORMS`, when the caller passes `role`): a show slot that came back as text is re-filled
 * as its visual, a check that came back open as a true-false. Roles, then visuals, then checks; at
 * most `MAX_MINIMUM_REFILLS`. The count never changes: each re-fill replaces one slot.
 *
 * Teaching is never spent on a visual (designer r3): a slot that carries a callout
 * (`explain-callout`), or the objective's only teaching slot, is kept. The visual then takes one of
 * the objective's checks when the objective keeps another and the lesson stays at `MIN_CHECKS`, or
 * is left missing (logged by `designMinimums`). In round 2 the re-fill of 2-slot cycles' text slot
 * cut 6-8 planned callouts to 1.
 */
export function minimumRefills(
  placed: readonly { objective: number; form: SlotForm; slide: number; role?: SlotRole }[],
  arcs: readonly ({ lean: string } | undefined)[],
  offered: readonly SlotForm[],
): MinimumRefill[] {
  const out: MinimumRefill[] = [];
  const taken = new Set<number>();
  const minimums = designMinimums(placed, arcs);
  const visualFor = (o: number): SlotForm => {
    const lean = arcs[o]?.lean as SlotForm | undefined;
    return lean && VISUAL_FORMS.has(lean) && offered.includes(lean) ? lean : "diagram-slot";
  };
  const visualDone = new Set<number>();
  let checks = minimums.checks;
  const open = (o: number) => placed.filter((p) => p.objective === o && !taken.has(p.slide));
  /** A text slot a visual may replace: no callout, and another teaching slot stays. */
  const spendable = (p: { objective: number; form: SlotForm; slide: number }) =>
    p.form !== "explain-callout" &&
    open(p.objective).some((q) => q.slide !== p.slide && !CHECK_FORMS.has(q.form));
  /** A check the visual may take instead: the objective keeps another, the lesson its 3. */
  const spareCheck = (o: number) => {
    const own = open(o).filter((p) => CHECK_FORMS.has(p.form));
    return own.length >= 2 && checks > MIN_CHECKS ? own[0] : undefined;
  };
  const visualFrom = (slot: { objective: number; slide: number }, into: SlotForm) => {
    taken.add(slot.slide);
    visualDone.add(slot.objective);
    checks -= 1;
    out.push({ slide: slot.slide, objective: slot.objective, into, reason: VISUAL_FROM_CHECK });
  };
  for (const p of placed) {
    if (out.length >= MAX_MINIMUM_REFILLS) return out;
    if (!p.role || ROLE_FORMS[p.role].includes(p.form)) continue;
    if (p.role === "show") {
      const into = visualFor(p.objective);
      if (!offered.includes(into)) continue;
      visualDone.add(p.objective);
      if (!spendable(p)) {
        // The designer taught here (a callout, or the objective's only teaching): keep it.
        const check = spareCheck(p.objective);
        if (check) visualFrom(check, into);
        continue;
      }
      taken.add(p.slide);
      out.push({
        slide: p.slide,
        objective: p.objective,
        into,
        reason: "this slot's role is to show the content: it is a photo, figure or diagram slot",
        role: "show",
      });
    } else if (p.role === "check") {
      if (!offered.includes("true-false")) continue;
      taken.add(p.slide);
      if (!CHECK_FORMS.has(p.form)) checks += 1;
      out.push({
        slide: p.slide,
        objective: p.objective,
        into: "true-false",
        reason: "this slot's role is a quick closed check; an open question is not one",
        role: "check",
      });
    }
  }
  const teaching = (o: number) =>
    placed.filter(
      (p) =>
        p.objective === o &&
        !CHECK_FORMS.has(p.form) &&
        !VISUAL_FORMS.has(p.form) &&
        !taken.has(p.slide),
    );
  for (const o of minimums.visualMissing) {
    if (out.length >= MAX_MINIMUM_REFILLS) return out;
    if (visualDone.has(o)) continue;
    const into = visualFor(o);
    if (!offered.includes(into)) continue;
    const slot = teaching(o).find(spendable);
    if (!slot) {
      const check = spareCheck(o);
      if (check) visualFrom(check, into);
      continue;
    }
    taken.add(slot.slide);
    out.push({
      slide: slot.slide,
      objective: o,
      into,
      reason: "the objective has no photo, figure or diagram; this slot shows its content",
    });
  }
  const order = [
    ...minimums.unchecked,
    ...arcs.map((_, i) => i).filter((i) => !minimums.unchecked.includes(i)),
  ];
  for (const o of order) {
    if (checks >= 3 || out.length >= MAX_MINIMUM_REFILLS || !offered.includes("true-false")) break;
    const texts = teaching(o);
    const keepsTeaching =
      placed.filter((p) => p.objective === o && !CHECK_FORMS.has(p.form) && !taken.has(p.slide))
        .length >= 2;
    const slot = texts.filter((p) => p.form !== "explain-callout").at(-1);
    if (!slot || !keepsTeaching) continue;
    taken.add(slot.slide);
    checks += 1;
    out.push({
      slide: slot.slide,
      objective: o,
      into: "true-false",
      reason: "the lesson needs another check; this slot checks the objective",
    });
  }
  return out;
}

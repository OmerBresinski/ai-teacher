import type { Slide, SlideElement, Theme } from "@tj/domain/documents";
import { answersFaults, type Measurer, materialiseSlides, renderedHeights } from "@tj/slides";
import {
  answerGroupsOf,
  layoutAnswersGuard,
  layoutAnswersPage,
  paginateAnswers,
} from "@tj/slides/templates/end-answers";
import { FIGURE_NAMES } from "@tj/slides/templates/figure";
import { withoutOpenSlots } from "../stages/open-slots";
import { checkSlide, offSlide, placeholderSlots } from "./checks";
import type { Stage } from "./fixes";
import { LAYOUT_FAULT } from "./layout-gate";

/*
 * RC1 (e2e-11nov ROOT-CAUSES): the ship gate. It runs once, on the deck exactly as it is saved
 * (the writer's slides, their continuations and the code-built Answers slides), after every other
 * step, with no model call. It looks only for faults a measure makes certain, never for judgement
 * (facts, pedagogy, meaning stay log-only):
 *
 * - `empty-slot:` a picture slot never filled, or a figure plate with nothing drawn on it;
 * - `clipped:` / `off-slide:` text or a card past the slide's edge, measured as drawn (each
 *   auto-height box at the height its words take, `renderedHeights`);
 * - `overlap:` words on words or words over a picture (`checkSlide`'s rule), and on an Answers
 *   slide the template's own rules (`answersFaults`).
 *
 * It acts in code only, and never adds or rewords a word: an empty slot is taken away (the
 * design's no-picture look); overflowing Answers slides are paginated again by the builder, more
 * finely; a writer slide still at fault is laid as words only (the design's own no-picture
 * fallback, else the plain words layout, split at a sentence over pages). A result is kept only
 * when it is clean and every word it shows was on the slide before. Every slide with a fault gets
 * one record (fault, action, what still ships), so a safety net never hides a problem.
 */

export type ShipAction = "slot-removed" | "answers-paginated" | "words-only" | "none";

/** One slide the gate found at fault: what it saw, what it did, and what still ships. */
export type ShipRecord = {
  /** The slide's number in the deck the gate was given (1-based). */
  slide: number;
  id: string;
  faults: string[];
  action: ShipAction;
  /** Faults left on the slide (or its pages) as saved; empty when the action cleared them. */
  shipped: string[];
};

export type ShipCounts = { detected: number; acted: number; shipped: number };

/** The fault kinds the gate acts on (`kind:` prefixes). */
export const SHIP_FAULT = /^(empty-slot|clipped|off-slide|overlap):/;

/** The fault's kind alone (`clipped`), for logs that never carry slide text. */
export const faultKind = (f: string) => f.slice(0, Math.max(0, f.indexOf(":"))) || f;

type Box = { x: number; y: number; w: number; h: number };
const centreIn = (e: Box, p: Box) => {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  return cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h;
};

/** A figure plate with no drawing, picture, icon or group on it (round 3 Y5 s6). */
function emptyPlates(elements: readonly SlideElement[]): SlideElement[] {
  return elements.filter(
    (p) =>
      p.type === "shape" &&
      p.name === FIGURE_NAMES.plate &&
      !elements.some(
        (e) => e !== p && e.type !== "text" && e.name !== FIGURE_NAMES.plate && centreIn(e, p),
      ),
  );
}

/** An image with no source at all: a slot nothing will ever fill. */
const sourceless = (e: SlideElement) =>
  e.type === "image" && !String((e as { src?: unknown }).src ?? "").trim();

/**
 * The certain faults on one saved slide, measured with `measure` (the ruler of the theme the deck
 * is laid in). Unique and in a stable order.
 */
export function shipFaults(slide: Slide, measure: Measurer): string[] {
  if (slide.answersRole) return [...new Set(answersFaults(slide, measure))];
  const drawn = renderedHeights(slide, measure);
  const out: string[] = [];
  for (const e of placeholderSlots(drawn.elements))
    out.push(`empty-slot: picture slot never filled (${e.name ?? "image"})`);
  for (const e of drawn.elements)
    if (sourceless(e)) out.push(`empty-slot: picture with no source (${e.name ?? e.id})`);
  for (const _plate of emptyPlates(drawn.elements))
    out.push(`empty-slot: ${FIGURE_NAMES.plate} with nothing drawn on it`);
  const laid = checkSlide({
    index: 0,
    slide: drawn,
    over: [],
    questions: [],
    answers: undefined,
    notesChecked: true,
    words: "",
  }).faults.filter((f) => LAYOUT_FAULT.test(f));
  out.push(...laid, ...offSlide(drawn.elements));
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ */
/* Words in, words out                                                 */
/* ------------------------------------------------------------------ */

/** Every string a slide shows (text runs, option and gap words), never alt text or names. */
export function shownText(slide: Pick<Slide, "elements">): string[] {
  const out: string[] = [];
  const walk = (v: unknown, k = "") => {
    if (typeof v === "string") {
      if (k === "text") out.push(v);
    } else if (Array.isArray(v)) for (const x of v) walk(x, k);
    else if (v && typeof v === "object")
      for (const [kk, x] of Object.entries(v as Record<string, unknown>))
        if (kk !== "alt" && kk !== "name" && kk !== "request") walk(x, kk);
  };
  walk(slide.elements);
  return out;
}

const wordsIn = (texts: readonly string[]) =>
  texts.flatMap((t) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/**
 * The marker the existing split puts on a continuation's heading (ruling 91, "(continued)"): the
 * only word a split may show that the slide did not.
 */
const SPLIT_MARKER = new Set(["continued"]);

/** Words `after` shows that `before` did not (empty: nothing was added). */
export function addedWords(before: readonly Slide[], after: readonly Slide[]): string[] {
  const had = new Set(wordsIn(before.flatMap(shownText)));
  return [
    ...new Set(
      wordsIn(after.flatMap(shownText)).filter((w) => !had.has(w) && !SPLIT_MARKER.has(w)),
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* The plain words layout                                              */
/* ------------------------------------------------------------------ */

const plain = (d: unknown): string => {
  const n = d as { text?: string; content?: unknown[] } | undefined;
  return n?.text ?? (n?.content ?? []).map(plain).join(" ");
};
/** Names of words that read as a list item. */
const POINT = /^(point|item|bullet text|step text)$/i;
/** Interactive slides (options, gaps, a question) are never laid as plain words. */
const interactive = (s: Slide) =>
  !!s.question ||
  s.elements.some(
    (e) => e.type !== "text" && e.type !== "shape" && e.type !== "image" && e.type !== "icon",
  );
/** The title and objectives keep their own look whatever happens (a fault there ships, counted). */
const OWN_LOOK = new Set(["title", "objectives"]);

/**
 * The slide's own words laid as the plain words layout (`content`: heading, the rest as its body,
 * list items as points), split at a sentence over pages when they need more than one (the
 * existing `materialiseSlides` split). Undefined for a slide with no heading, no other words, or
 * anything a pupil answers on.
 */
export function plainWordsPages(slide: Slide, themeId: string): Slide[] | undefined {
  if (interactive(slide) || OWN_LOOK.has(slide.kind) || slide.answersRole) return undefined;
  const texts = slide.elements
    .filter((e) => e.type === "text")
    .map((e) => ({
      e,
      t: plain((e as { doc?: unknown }).doc)
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((x) => x.t);
  const head =
    texts.find((x) => x.e.name === "Heading") ??
    [...texts].sort((a, b) => a.e.y - b.e.y || a.e.x - b.e.x)[0];
  if (!head) return undefined;
  const rest = texts.filter((x) => x !== head).sort((a, b) => a.e.y - b.e.y || a.e.x - b.e.x);
  if (!rest.length) return undefined;
  const points = rest.filter((x) => POINT.test(x.e.name ?? "")).map((x) => x.t);
  const bodyParts = rest.filter((x) => !POINT.test(x.e.name ?? "") || points.length < 2);
  const body = bodyParts.map((x) => x.t).join(" ");
  if (!body && points.length < 2) return undefined;
  let n = 0;
  const pages = materialiseSlides(
    {
      kind: "content",
      factRefs: [],
      heading: head.t,
      body,
      ...(points.length >= 2 ? { points } : {}),
    } as never,
    themeId,
    { promptVersion: "ship-gate", model: "code", at: new Date(0).toISOString() },
    () => `${slide.id}~g${++n}`,
  );
  // The recipe's own labels (a lone sentence is laid on a key card headed "KEY IDEA") are not the
  // slide's words: a text box with no word the slide said is left off, so nothing is added.
  const had = new Set(wordsIn(shownText(slide)));
  const own = (e: SlideElement) =>
    e.type !== "text" || wordsIn(shownText({ elements: [e] })).some((w) => had.has(w));
  return pages.map((p, k) => ({
    ...p,
    elements: p.elements.filter(own),
    id: k === 0 ? slide.id : `${slide.id}g${k + 1}`,
    ...(k === 0 && slide.notes !== undefined ? { notes: slide.notes } : {}),
  }));
}

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

export type ShipGateContext = {
  /** The theme the deck is laid and measured in. */
  theme: Theme;
  themeId: string;
  stage: Stage;
  measure: Measurer;
  /**
   * The writer's own words-only look for one of its slides (by id): the design's no-picture
   * fallback laid by the stage (`WriterOutput.wordsOnly`). Absent or undefined: the plain words.
   */
  wordsOnly?: (id: string) => Slide | undefined;
  /** Faults the stage already reported on a slide (by id), counted as detected here too. */
  reported?: ReadonlyMap<string, readonly string[]>;
};

const faultsOf = (pages: readonly Slide[], m: Measurer) =>
  pages.flatMap((p, k) => shipFaults(p, m).map((f) => (k ? `page ${k + 1}: ${f}` : f)));

/**
 * The Answers slides again, from the same groups, paginated by the builder; a page still at fault
 * is split again between its answers (halves) until each page is clean or holds one answer. The
 * guard is laid as the builder lays it. Undefined when the deck has no answers to lay.
 */
function answersAgain(lesson: readonly Slide[], c: ShipGateContext): Slide[] | undefined {
  const groups = answerGroupsOf(lesson).filter((g) => g.items.length);
  if (!groups.length) return undefined;
  type Groups = typeof groups;
  const pageOk = (gs: Groups) =>
    !shipFaults(
      layoutAnswersPage({ groups: gs, page: 1, of: 2 }, c.theme, c.stage).slide,
      c.measure,
    ).length;
  const halves = (gs: Groups): Groups[] => {
    if (pageOk(gs)) return [gs];
    const count = gs.reduce((t, g) => t + g.items.length, 0);
    if (count <= 1) return [gs];
    // Whole groups apart first, then a lone group's answers in two.
    if (gs.length > 1) {
      const k = Math.ceil(gs.length / 2);
      return [...halves(gs.slice(0, k)), ...halves(gs.slice(k))];
    }
    const g = gs[0] as Groups[number];
    const k = Math.ceil(g.items.length / 2);
    return [
      ...halves([{ ...g, items: g.items.slice(0, k) }]),
      ...halves([{ ...g, items: g.items.slice(k) }]),
    ];
  };
  const split = paginateAnswers(c.theme, c.stage, groups).flatMap((p) => halves(p.groups));
  return [
    layoutAnswersGuard(c.theme, c.stage).slide,
    ...split.map(
      (gs, i) =>
        layoutAnswersPage({ groups: gs, page: i + 1, of: split.length }, c.theme, c.stage).slide,
    ),
  ];
}

/**
 * The ship gate over the saved deck: each slide's certain faults acted on in code, and one record
 * for every slide with a fault. Slides with none come back as they were (same objects).
 */
export function shipGate(
  slides: readonly Slide[],
  c: ShipGateContext,
): { slides: Slide[]; records: ShipRecord[] } {
  const records: ShipRecord[] = [];
  const detected = (s: Slide) => [
    ...new Set([...shipFaults(s, c.measure), ...(c.reported?.get(s.id) ?? [])]),
  ];
  const lesson = slides.filter((s) => !s.answersRole);
  const out: Slide[] = [];
  for (const [i, s] of lesson.entries()) {
    const faults = detected(s);
    if (!faults.length) {
      out.push(s);
      continue;
    }
    const tries: { action: ShipAction; pages: () => Slide[] | undefined }[] = [];
    if (faults.some((f) => f.startsWith("empty-slot:")))
      tries.push({ action: "slot-removed", pages: () => [withoutOpenSlots(s, c.theme)] });
    tries.push({
      action: "words-only",
      pages: () => {
        const w = c.wordsOnly?.(s.id);
        return w ? [w] : undefined;
      },
    });
    tries.push({ action: "words-only", pages: () => plainWordsPages(s, c.themeId) });
    let kept: { action: ShipAction; pages: Slide[] } | undefined;
    for (const t of tries) {
      let pages: Slide[] | undefined;
      try {
        pages = t.pages();
      } catch {
        pages = undefined;
      }
      if (!pages?.length || (pages.length === 1 && pages[0] === s)) continue;
      if (faultsOf(pages, c.measure).length) continue;
      if (addedWords([s], pages).length) continue;
      kept = { action: t.action, pages };
      break;
    }
    if (kept) out.push(...kept.pages);
    else out.push(s);
    records.push({
      slide: i + 1,
      id: s.id,
      faults,
      action: kept?.action ?? "none",
      shipped: kept ? [] : faults,
    });
  }
  // The Answers slides: the builder's own pages, judged on the template's rules.
  const ends = slides.filter((s) => s.answersRole);
  const at = (s: Slide) => slides.indexOf(s) + 1;
  const endFaults = ends.map((s) => ({ s, faults: detected(s) }));
  if (endFaults.some((e) => e.faults.length)) {
    const again = (() => {
      try {
        return answersAgain(lesson, c);
      } catch {
        return undefined;
      }
    })();
    const left = again ? faultsOf(again, c.measure) : undefined;
    const ok = again && !left?.length && !addedAnswerWords(ends, again).length;
    out.push(...(ok ? (again as Slide[]) : ends));
    for (const { s, faults } of endFaults)
      if (faults.length)
        records.push({
          slide: at(s),
          id: s.id,
          faults,
          action: ok ? "answers-paginated" : "none",
          shipped: ok ? [] : faults,
        });
  } else out.push(...ends);
  records.sort((a, b) => a.slide - b.slide);
  return { slides: out, records };
}

/**
 * Words the new Answers slides show that the old did not, besides the builder's own page numbers
 * ("Answers (2 of 3)"): the questions and answers are the deck's own.
 */
function addedAnswerWords(before: readonly Slide[], after: readonly Slide[]): string[] {
  return addedWords(before, after).filter((w) => !/^\d+$/.test(w));
}

/** The counts the summary and the lab metrics read (the same records). */
export function shipCounts(records: readonly ShipRecord[]): ShipCounts {
  return {
    detected: records.reduce((t, r) => t + r.faults.length, 0),
    acted: records.filter((r) => r.action !== "none").reduce((t, r) => t + r.faults.length, 0),
    shipped: records.reduce((t, r) => t + r.shipped.length, 0),
  };
}

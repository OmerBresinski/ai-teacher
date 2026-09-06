import type { Id, Lesson, RichDoc, Slide, SlideElement, Theme } from "@tj/domain/documents";
import { cloneSlide, docFromText } from "../model/factories";
import * as reducers from "../model/reducers";
import { getTheme } from "../model/themes";
import { docToPlainText } from "../text/static";
import { explanationReserve, hasExplanationPanel, reservedLines } from "./explanation";
import {
  docLineCount,
  type Measurer,
  type ReflowResult,
  reflowSlide,
  SAFE_BOTTOM,
  SAFETY,
  splitDocToFit,
  textPartsOf,
} from "./reflow";

/**
 * Text fitting engine — the action (TeachDeck `lib/layout/tidy.ts`). `tidySlide` is what "Tidy
 * slide" runs: measure the slide for real, reflow it (`./reflow.ts`), and return the lesson with
 * the result applied. When the slide still will not fit at the smallest legible size, it splits
 * the offending list across a continuation slide of the same kind rather than shrinking past the
 * SPEC §7 floor.
 *
 * TeachDeck wrote the result into the store inside a transaction; here the function is pure given
 * the measurer — `(lesson, slideId, measure) → { lesson, outcome }` — and the caller dispatches it
 * as one reducer step (`tidySlideReducer`), so a tidy is one undo entry by construction.
 */

export type TidyOutcome = {
  moved: number;
  stepped: number;
  /** How many continuation slides the split created. */
  continued: number;
  /** Ids still overflowing after everything the engine could do. */
  overflow: Id[];
  /** Ids still standing in the lane the "Why?" panel is owed. */
  laneOverflow: Id[];
  changed: boolean;
};

const EMPTY: TidyOutcome = {
  moved: 0,
  stepped: 0,
  continued: 0,
  overflow: [],
  laneOverflow: [],
  changed: false,
};

/** The doc an element carries, if it is one the engine can split. */
function splittableDoc(el: SlideElement): RichDoc | null {
  if (el.type !== "text" && el.type !== "gap-text") return null;
  return docLineCount(el.doc) > 1 ? el.doc : null;
}

/** Mark a continuation slide's heading so a teacher can see it is a second page. */
function markContinued(slide: Slide): void {
  const heading = slide.elements.find(
    (el) => el.type === "text" && (el.style.preset === "heading" || el.style.preset === "title"),
  );
  if (heading?.type !== "text") return;
  const text = docToPlainText(heading.doc).trim();
  if (!text || /continued/i.test(text)) return;
  heading.doc = docFromText(`${text} (continued)`);
}

/**
 * Split the element at `splitAt` across a continuation slide. Returns the head doc to leave behind
 * and the new slide to insert, or null when there is nothing sensible to split.
 */
function planSplit(
  slide: Slide,
  reflowed: SlideElement[],
  splitAt: number,
  measure: Measurer,
): { head: RichDoc; continuation: Slide } | null {
  const el = reflowed[splitAt];
  if (!el) return null;
  const doc = splittableDoc(el);
  const parts = doc ? textPartsOf(el, slide) : null;
  if (!doc || !parts) return null;

  const available = Math.max(parts.chrome + 1, SAFE_BOTTOM - el.y);
  const { head, tail } = splitDocToFit(
    doc,
    {
      width: el.w,
      style: parts.style,
      preset: parts.preset,
      inset: parts.inset,
      chrome: parts.chrome,
    },
    available / (1 + SAFETY),
    measure,
  );
  if (!tail) return null;

  const continuation = cloneSlide({ ...slide, elements: reflowed });
  const carried = continuation.elements[splitAt];
  if (!carried || (carried.type !== "text" && carried.type !== "gap-text")) return null;
  carried.doc = tail;
  carried.y = el.y;
  markContinued(continuation);
  return { head, continuation };
}

/**
 * The floor the fit test works to: a true-false or multiple-choice slide owes a lane at the foot of
 * the safe area to its "Why?" panel, so the engine keeps that lane clear.
 */
const reflowOptions = (slide: Slide, theme: Theme, measure: Measurer) =>
  hasExplanationPanel(slide.question)
    ? { fitBottom: SAFE_BOTTOM - explanationReserve(theme, reservedLines(slide, theme, measure)) }
    : {};

/** A slide can spill onto at most this many continuation slides in one tidy. */
const MAX_CONTINUATIONS = 6;

/**
 * Reflow a slide and, while it still will not fit at the smallest legible size, carry the overspill
 * onto a continuation slide — and reflow that too.
 */
function fitAndSplit(
  slide: Slide,
  theme: Theme,
  measure: Measurer,
): { slides: Slide[]; results: ReflowResult[] } {
  const slides: Slide[] = [];
  const results: ReflowResult[] = [];
  let current = slide;

  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    let result = reflowSlide(current, theme, measure, reflowOptions(current, theme, measure));
    let next: Slide | null = null;

    if (result.splitAt !== undefined && round < MAX_CONTINUATIONS) {
      const at = result.splitAt;
      const plan = planSplit(current, result.elements, at, measure);
      if (plan) {
        current = {
          ...current,
          elements: result.elements.map((el, i) =>
            i === at && (el.type === "text" || el.type === "gap-text")
              ? { ...el, doc: plan.head }
              : el,
          ),
        };
        // Settle the shortened slide before recording it.
        result = reflowSlide(current, theme, measure, reflowOptions(current, theme, measure));
        next = plan.continuation;
      }
    }

    slides.push({ ...current, elements: result.elements });
    results.push(result);
    if (!next) break;
    current = next;
  }

  return { slides, results };
}

const sizeOf = (el: SlideElement): number | undefined =>
  el.type === "text" || el.type === "gap-text"
    ? el.style.fontSize
    : el.type === "option"
      ? el.textStyle?.fontSize
      : undefined;

const docOf = (el: SlideElement): RichDoc | undefined =>
  el.type === "text" || el.type === "gap-text" || el.type === "option" ? el.doc : undefined;

/**
 * Tidy one slide. Safe to call on a slide that is already tidy: it reports `changed: false` and
 * returns the same lesson object, so the button never dirties a clean document.
 */
export function tidySlide(
  lesson: Lesson,
  slideId: Id,
  measure: Measurer,
): { lesson: Lesson; outcome: TidyOutcome } {
  const slide = lesson.slides.find((s) => s.id === slideId);
  if (!slide) return { lesson, outcome: EMPTY };

  const theme = getTheme(lesson.themeId);
  const { slides, results } = fitAndSplit(slide, theme, measure);

  const head = results[0];
  const last = results[results.length - 1];
  const tidied = slides[0];
  if (!head || !last || !tidied) return { lesson, outcome: EMPTY };
  const continuations = slides.slice(1);
  const before = new Map(slide.elements.map((e) => [e.id, e]));

  const changed = tidied.elements.filter((next) => {
    const prev = before.get(next.id);
    if (!prev) return true;
    if (Math.abs(prev.y - next.y) > 0.5 || Math.abs(prev.h - next.h) > 0.5) return true;
    return sizeOf(prev) !== sizeOf(next) || docOf(prev) !== docOf(next);
  });

  if (changed.length === 0 && continuations.length === 0) {
    return {
      lesson,
      outcome: { ...EMPTY, overflow: last.overflow, laneOverflow: last.laneOverflow },
    };
  }

  let out = lesson;
  for (const next of changed) {
    out = reducers.updateElement(out, slideId, next.id, (el: SlideElement) => {
      el.y = next.y;
      el.h = next.h;
      const size = sizeOf(next);
      if (size !== undefined) {
        if (el.type === "text" || el.type === "gap-text")
          el.style = { ...el.style, fontSize: size };
        else if (el.type === "option") el.textStyle = { ...el.textStyle, fontSize: size };
      }
      const doc = docOf(next);
      if (doc && (el.type === "text" || el.type === "gap-text" || el.type === "option"))
        el.doc = doc;
    });
  }
  let after = slideId;
  for (const continuation of continuations) {
    out = reducers.insertSlide(out, continuation, after);
    after = continuation.id;
  }

  return {
    lesson: out,
    outcome: {
      moved: head.moved.length,
      stepped: head.stepped.length,
      continued: continuations.length,
      overflow: last.overflow,
      laneOverflow: last.laneOverflow,
      changed: true,
    },
  };
}

/**
 * `tidySlide` in reducer shape, for `history.dispatch`: returns `{ lesson, outcome }` so the caller
 * gets the toast's numbers back from the same call that wrote the document.
 */
export const tidySlideReducer = (lesson: Lesson, slideId: Id, measure: Measurer) =>
  tidySlide(lesson, slideId, measure);

/**
 * The sentence the toast shows. Plain counting — and it says so when something still does not fit,
 * because the engine will not go below the text's own projector floor to hide the problem.
 */
export function tidyMessage(o: TidyOutcome): string {
  const n = o.overflow.length;
  const overflowing = new Set(o.overflow);
  const lane = o.laneOverflow.filter((id) => !overflowing.has(id)).length;
  const count = (k: number) => (k === 1 ? "1 box" : `${k} boxes`);
  const stuck = [
    n ? `${count(n)} will not fit at the smallest readable size` : "",
    lane ? `${count(lane)} still covers the room the reason needs` : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!o.changed) return stuck ? `Nothing left to tidy: ${stuck}` : "Nothing to tidy";
  const parts: string[] = [];
  if (o.moved) parts.push(`${o.moved} ${o.moved === 1 ? "box" : "boxes"} moved`);
  if (o.stepped) parts.push(`${o.stepped} ${o.stepped === 1 ? "size" : "sizes"} stepped down`);
  if (o.continued === 1) parts.push("list continued on a new slide");
  else if (o.continued > 1) parts.push(`list continued on ${o.continued} new slides`);
  if (parts.length === 0) parts.push("boxes resized to their text");
  return `Tidied: ${parts.join(", ")}${stuck ? `. ${stuck[0]?.toUpperCase()}${stuck.slice(1)}` : ""}`;
}

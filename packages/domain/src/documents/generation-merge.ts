import type { Lesson } from "./lesson";
import type { Slide, SlideElement } from "./slide";

/*
 * Per-slide ownership while a lesson is generating (ADR 0037, UX ruling 189). A job and the teacher
 * both write one lesson row while it fills: the job owns the slides still `writing`, the teacher
 * owns every `done` slide. These pure functions are the whole merge, used by the database's two
 * write paths (the teacher's `putDocument`, the job's `putDocumentAsJob`) and by the editor, which
 * folds each newer copy of the row into the open document without losing what the teacher typed.
 */

/** Deep equality of JSON values, ignoring key order and `undefined` members. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined);
  const ak = keys(ao);
  const bk = keys(bo);
  return ak.length === bk.length && ak.every((k) => sameJson(ao[k], bo[k]));
}

/** The ids of the slides a running job still owns: state `writing` in `generation.slideStates`. */
export function writingSlideIds(lesson: Pick<Lesson, "generation">): Set<string> {
  const states = lesson.generation?.slideStates ?? {};
  return new Set(Object.keys(states).filter((id) => states[id] === "writing"));
}

/** True when the lesson has at least one `done` slide the teacher may edit while the job runs. */
export function hasEditableSlides(lesson: Pick<Lesson, "generation" | "slides">): boolean {
  const states = lesson.generation?.slideStates;
  if (!states) return false;
  return lesson.slides.some((slide) => states[slide.id] === "done");
}

/**
 * A slot is a picture or a drawn diagram: an image element, or any element carrying a figure.
 * Late work may fill a slot on a slide the teacher edited; it never changes the slide's words.
 */
const isSlot = (el: SlideElement) =>
  el.type === "image" || (el as { figure?: unknown }).figure !== undefined;

/** An element without its place on the slide: moving or resizing a slot does not claim it. */
function content(el: SlideElement): Record<string, unknown> {
  const {
    x: _x,
    y: _y,
    w: _w,
    h: _h,
    rotation: _r,
    ...rest
  } = el as SlideElement & {
    rotation?: number;
  };
  return rest;
}

/** `next` placed where the teacher put `kept`. */
function inPlace(next: SlideElement, kept: SlideElement): SlideElement {
  const k = kept as SlideElement & { rotation?: number };
  return {
    ...next,
    x: k.x,
    y: k.y,
    w: k.w,
    h: k.h,
    ...(k.rotation !== undefined ? { rotation: k.rotation } : {}),
  } as SlideElement;
}

/**
 * A slide the teacher edited, with the job's late work that may still land: a picture or diagram
 * for a slot the teacher left as it was (moving or resizing it is fine), and notes the teacher has
 * not changed. Every other change the job made to the slide (its words, its layout) is dropped.
 */
export function mergeEditedSlide(base: Slide, mine: Slide, theirs: Slide): Slide {
  const byId = (els: SlideElement[]) => new Map(els.map((e) => [e.id, e]));
  const b = byId(base.elements);
  const t = byId(theirs.elements);
  const m = byId(mine.elements);
  // Slots the job replaced with a new element (a placeholder swapped for a picture), in order.
  const gone = base.elements.filter((e) => isSlot(e) && !t.has(e.id)).map((e) => e.id);
  const arrived = theirs.elements.filter((e) => isSlot(e) && !b.has(e.id));
  const replacement = new Map<string, SlideElement>();
  gone.forEach((id, i) => {
    const next = arrived[i];
    if (next && !m.has(next.id)) replacement.set(id, next);
  });
  const untouched = (el: SlideElement) => {
    const was = b.get(el.id);
    return was !== undefined && sameJson(content(el), content(was));
  };
  const elements = mine.elements.map((el) => {
    if (!isSlot(el) || !untouched(el)) return el;
    const swap = replacement.get(el.id);
    if (swap) return inPlace(swap, el);
    const next = t.get(el.id);
    const was = b.get(el.id);
    if (next && was && !sameJson(next, was)) return inPlace(next, el);
    return el;
  });
  const notes = sameJson(mine.notes, base.notes) ? theirs.notes : mine.notes;
  const merged = { ...mine, elements } as Slide;
  if (notes === undefined) delete (merged as { notes?: unknown }).notes;
  else merged.notes = notes;
  return merged;
}

/**
 * Three-way merge of a lesson while its job runs. `base` is the copy both sides last agreed on
 * (the job's previous write, or the row the editor last received), `mine` the teacher's copy and
 * `theirs` the job's newer copy. The result:
 *
 * - `generation` is always the job's (states, usage, stage);
 * - any other top-level field the teacher changed (title, theme) keeps the teacher's value;
 * - a slide the teacher did not change takes the job's copy; one the teacher changed keeps the
 *   teacher's words and takes only late slots and untouched notes (`mergeEditedSlide`);
 * - a slide the teacher deleted stays deleted, one the teacher added stays, in the teacher's
 *   order; slides new from the job land after the slide they follow in the job's copy.
 */
export function mergeJobLesson(base: Lesson | undefined, mine: Lesson, theirs: Lesson): Lesson {
  if (base === undefined) return theirs;
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)]);
  const record = (l: Lesson) => l as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (key === "slides") continue;
    const value =
      key === "generation"
        ? record(theirs)[key]
        : sameJson(record(mine)[key], record(base)[key])
          ? record(theirs)[key]
          : record(mine)[key];
    if (value !== undefined) merged[key] = value;
  }
  const baseOf = new Map(base.slides.map((s) => [s.id, s]));
  const theirsOf = new Map(theirs.slides.map((s) => [s.id, s]));
  const mineIds = new Set(mine.slides.map((s) => s.id));
  const slides: Slide[] = [];
  // Slides the job still owned at `base` are the job's whatever the teacher's copy holds (the
  // editor may have re-fitted them on open; they were read-only).
  const owned = writingSlideIds(base);
  for (const own of mine.slides) {
    const was = baseOf.get(own.id);
    const next = theirsOf.get(own.id);
    if (owned.has(own.id)) {
      if (next !== undefined) slides.push(next);
    } else if (was === undefined) {
      // The teacher's new slide, or one both copies gained since `base`: the job's copy wins only
      // when it is the same slide the teacher has.
      slides.push(next !== undefined && sameJson(own, next) ? next : own);
    } else if (sameJson(own, was)) {
      // Untouched: the job's copy, or gone when the job dropped it.
      if (next !== undefined) slides.push(next);
    } else {
      slides.push(next === undefined ? own : mergeEditedSlide(was, own, next));
    }
  }
  // Slides new from the job (not in `base`, not in `mine`), each after the slide it follows.
  theirs.slides.forEach((slide, i) => {
    if (mineIds.has(slide.id) || baseOf.has(slide.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const before = theirs.slides[j]?.id;
      const found = slides.findIndex((s) => s.id === before);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    slides.splice(at, 0, slide);
  });
  return { ...(merged as unknown as Lesson), slides };
}

/**
 * A teacher's write to a lesson a job is filling: the slides the job still owns (`writing` in the
 * stored row) are kept as stored, whatever the teacher's copy says, and the job's `generation` is
 * kept too. A writing slide missing from the teacher's copy is put back after the slide it follows
 * in the stored row. Read-only in the editor already; this makes it true at the database.
 */
export function keepWritingSlides(stored: Lesson, incoming: Lesson): Lesson {
  const writing = writingSlideIds(stored);
  const storedOf = new Map(stored.slides.map((s) => [s.id, s]));
  const slides = incoming.slides.map((s) => (writing.has(s.id) ? (storedOf.get(s.id) ?? s) : s));
  stored.slides.forEach((slide, i) => {
    if (!writing.has(slide.id) || slides.some((s) => s.id === slide.id)) return;
    const before = stored.slides[i - 1]?.id;
    const at = before === undefined ? 0 : slides.findIndex((s) => s.id === before) + 1;
    slides.splice(at, 0, slide);
  });
  const next = { ...incoming, slides } as Lesson;
  if (stored.generation) next.generation = stored.generation;
  return next;
}

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

/** Keys that only say where an element sits or how big its type is: a fit or a re-theme. */
const MECHANICAL = new Set([
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "from",
  "to",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "padding",
  "radius",
  "strokeWidth",
  "autoHeight",
  "autoFit",
  "fixedSize",
  "fitVersion",
  "updatedAt",
]);

/** A slide or lesson without what a fit or a re-theme changes: geometry, type sizes, colours. */
function substance(node: unknown, key?: string): unknown {
  if (key === "diagram" || key === "figure") return node;
  if (typeof node === "string")
    return key !== "text" && /^#[0-9a-f]{3,8}$/i.test(node) ? "#" : node;
  if (Array.isArray(node)) return node.map((n) => substance(n));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (!MECHANICAL.has(k) && v !== undefined) out[k] = substance(v, k);
    }
    return out;
  }
  return node;
}

/**
 * Whether two copies differ at most mechanically (TEACH-251 part p): the same words, elements,
 * notes and slide fields, apart from geometry, type sizes, colours and stamps. Never decides
 * ownership on its own; it only lets the editor drop a copy it can prove is its own repaint.
 */
export function sameSubstance(a: unknown, b: unknown): boolean {
  return sameJson(substance(a), substance(b));
}

/** Whether the teacher changed this slide while the job ran (`Slide.teacherEdited`). */
export const isTeacherEdited = (slide: Slide): boolean => slide.teacherEdited === true;

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
 * A slide the teacher changed while the job ran (`teacherEdited`), with the job's late work that
 * may still land. The teacher's slide is kept whole: words, layout, styles and slide fields.
 *
 * - A picture or diagram the job made late lands in a slot the teacher left as it was (moving or
 *   resizing it is fine), or as a new slot when the teacher has neither deleted nor added a
 *   picture or diagram on the slide. A slot the teacher deleted is never refilled.
 * - A slot the job took out with nothing in its place goes from the teacher's copy too when the
 *   teacher left it: never a placeholder (picq, 26 Oct).
 * - Notes the teacher has not changed take the job's.
 */
export function mergeEditedSlide(base: Slide, mine: Slide, theirs: Slide): Slide {
  const byId = (els: SlideElement[]) => new Map(els.map((e) => [e.id, e]));
  const b = byId(base.elements);
  const t = byId(theirs.elements);
  const m = byId(mine.elements);
  const untouched = (el: SlideElement) => {
    const was = b.get(el.id);
    return was !== undefined && sameJson(content(el), content(was));
  };
  // An unmarked copy that differs from `base` only in where its elements sit (an older editor's
  // fit on open), on a slide the job re-laid without a slot: the job's slide (picq, 26 Oct).
  const sameIds =
    mine.elements.length === base.elements.length && mine.elements.every((e) => b.has(e.id));
  const jobDroppedSlot = base.elements.some((e) => isSlot(e) && !t.has(e.id));
  if (
    !isTeacherEdited(mine) &&
    jobDroppedSlot &&
    sameIds &&
    mine.elements.every(untouched) &&
    sameJson(mine.notes, base.notes)
  )
    return theirs;
  // Slots the job replaced with a new element (a placeholder swapped for a diagram), in order.
  const gone = base.elements.filter((e) => isSlot(e) && !t.has(e.id)).map((e) => e.id);
  const arrived = theirs.elements.filter((e) => isSlot(e) && !b.has(e.id) && !m.has(e.id));
  const replacement = new Map<string, SlideElement>();
  gone.forEach((id, i) => {
    const next = arrived[i];
    if (next) replacement.set(id, next);
  });
  const paired = new Set([...replacement.values()].map((e) => e.id));
  // The teacher's own visual area: a slot of `base` they deleted (one the job still has, or
  // replaced), or one they added.
  const deletedSlot = base.elements.some(
    (e) => isSlot(e) && !m.has(e.id) && (t.has(e.id) || replacement.has(e.id)),
  );
  const addedSlot = mine.elements.some((e) => isSlot(e) && !b.has(e.id));
  const dropped = new Set(gone.filter((id) => !replacement.has(id)));
  const elements = mine.elements
    .filter((el) => !(dropped.has(el.id) && untouched(el)))
    .map((el) => {
      if (!isSlot(el) || !untouched(el)) return el;
      const swap = replacement.get(el.id);
      if (swap) return inPlace(swap, el);
      const next = t.get(el.id);
      const was = b.get(el.id);
      if (next && was && !sameJson(next, was)) return inPlace(next, el);
      return el;
    });
  // Late slots with no slot of `base` to fill (the placeholder went earlier): they land where the
  // job laid them, unless the teacher reworked the slide's pictures.
  if (!deletedSlot && !addedSlot) {
    for (const el of arrived) if (!paired.has(el.id)) elements.push(el);
  }
  const notes = sameJson(mine.notes, base.notes) ? theirs.notes : mine.notes;
  const merged = { ...mine, elements } as Slide;
  if (notes === undefined) delete (merged as { notes?: unknown }).notes;
  else merged.notes = notes;
  return merged;
}

/**
 * `mine` with every slide the teacher has not marked (`teacherEdited`) and that differs from
 * `ref`'s copy only mechanically (`sameSubstance`) taken from `ref` (the row, or the base of a
 * fold): what the editor merges and sends while a job writes
 * (TEACH-251 part p). Its own repaint into the lesson's theme and its fit are never sent as the
 * teacher's, so the job's late pictures and diagrams land; the editor draws them again.
 */
export function withoutEditorCopies(mine: Lesson, ref: Lesson): Lesson {
  const refOf = new Map(ref.slides.map((s) => [s.id, s]));
  let changed = false;
  const slides = mine.slides.map((s) => {
    const r = refOf.get(s.id);
    if (isTeacherEdited(s) || r === undefined || r === s) return s;
    // Only a provable repaint or fit is dropped: an unmarked slide with any other difference (a
    // mark missed) is kept as the teacher's. A missed mark can cost a late picture, never an edit.
    if (!sameSubstance(s, r)) return s;
    changed = true;
    return r;
  });
  return changed ? { ...mine, slides } : mine;
}

/**
 * Three-way merge of a lesson while its job runs. `base` is the copy both sides last agreed on
 * (the job's previous write, or the row the editor last received), `mine` the teacher's copy and
 * `theirs` the job's newer copy. The result:
 *
 * - `generation` is always the job's (states, usage, stage);
 * - any other top-level field the teacher changed (title, theme) keeps the teacher's value;
 * - a slide the teacher did not change takes the job's copy; one the teacher changed (marked
 *   `teacherEdited`, or differing from `base` at all) keeps the teacher's slide and takes only late
 *   slots and untouched notes (`mergeEditedSlide`);
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
    } else if (!isTeacherEdited(own) && sameJson(own, was)) {
      // Untouched: the job's copy, or gone when the job dropped it. Any difference on a done slide
      // is the teacher's, marked or not (a copy from an older editor carries no mark); the editor
      // keeps its own repaint and fit out of what it merges and saves (`withoutEditorCopies`).
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
 *
 * A `done` slide missing from the teacher's copy is only dropped when that copy saw it done (its
 * `generation` is this job's and marks the slide `done`): the teacher deleted it. A copy taken
 * before the slide was done (a stale or partial save, sent under a newer `updatedAt`) never saw
 * it, so it cannot delete it, and the slide is put back like a writing one; nor can it put back the
 * read-only copy it holds of a slide finished since (P0, 25 Oct 2026).
 */
export function keepWritingSlides(stored: Lesson, incoming: Lesson): Lesson {
  const writing = writingSlideIds(stored);
  const sameJob =
    incoming.generation?.jobId !== undefined &&
    incoming.generation.jobId === stored.generation?.jobId;
  const seenDone = (id: string) => sameJob && incoming.generation?.slideStates?.[id] === "done";
  const storedOf = new Map(stored.slides.map((s) => [s.id, s]));
  // The teacher's copy speaks only for the slides it saw done; any other stored slide is the job's.
  const jobs = (id: string) => writing.has(id) || (storedOf.has(id) && !seenDone(id));
  const slides = incoming.slides.map((s) => (jobs(s.id) ? (storedOf.get(s.id) ?? s) : s));
  stored.slides.forEach((slide, i) => {
    if (!jobs(slide.id) || slides.some((s) => s.id === slide.id)) return;
    // After the nearest earlier stored slide the copy still has (the one before may be deleted).
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const found = slides.findIndex((s) => s.id === stored.slides[j]?.id);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    slides.splice(at, 0, slide);
  });
  const next = { ...incoming, slides } as Lesson;
  if (stored.generation) next.generation = stored.generation;
  return next;
}

/**
 * A confirmed plan whose job has not yet said which slides it owns (no `slideStates`): the editor
 * opens on it at once (UX audit J2), and until the job marks slides it owns every one of them.
 */
export function isStartingJob(lesson: Pick<Lesson, "generation" | "plan" | "slides">): boolean {
  return (
    lesson.plan?.state === "confirmed" &&
    lesson.generation?.stage === "planned" &&
    !lesson.generation.slideStates &&
    lesson.slides.length > 0
  );
}

/**
 * The merge base for a starting job (`isStartingJob`): the row with every slide marked `writing`,
 * so `mergeJobLesson` takes the job's copy of each one (a re-fit on open, a drop or a split) rather
 * than keeping the teacher's read-only copy as an edit. Any other lesson is returned as it is.
 */
export function startingJobBase(lesson: Lesson): Lesson {
  if (!isStartingJob(lesson) || !lesson.generation) return lesson;
  const slideStates = Object.fromEntries(lesson.slides.map((s) => [s.id, "writing" as const]));
  return { ...lesson, generation: { ...lesson.generation, slideStates } };
}

/**
 * The merge base for a job that starts on a stored lesson (a retry or a resume, ADR 0037): the
 * stored copy without its `done` slides. The job never saw those as its own, so they read as the
 * teacher's in `mergeJobLesson` and the new run cannot write over them, edited or not.
 */
export function resumeBase(stored: Lesson): Lesson {
  const states = stored.generation?.slideStates;
  if (!states) return stored;
  return { ...stored, slides: stored.slides.filter((s) => states[s.id] !== "done") };
}

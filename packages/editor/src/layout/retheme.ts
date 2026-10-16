import type { GroupElement, Id, Lesson, Slide, Theme } from "@tj/domain/documents";
import { layoutKit } from "../model/layout-kit";
import * as reducers from "../model/reducers";
import { type LayoutKit, placeInto, tryRelayout } from "../model/reducers/layout";
import { renderTheme } from "../model/themes";
import { measureInputsOf } from "./fit-plan";
import { lintAsDrawn } from "./lint";
import type { Measurer } from "./reflow";
import { tidySlide } from "./tidy";

/*
 * Re-theme a whole lesson (TEACH-258, ruling 116). A theme is not paint only: its type ladder sets
 * how tall every text box needs to be, so a lesson laid out in one theme and drawn in another can
 * overrun its boxes. `setTheme` alone would leave that to the teacher. This sets the theme and
 * then tidies every slide the linter flags under the new theme, as the renderer will draw it —
 * the same decision and the same tidy the fit migration makes on open. A slide whose text still
 * does not fit at the legibility floor continues onto a new slide rather than losing words.
 *
 * Positions across the slide (x, w) stay where the old theme put them; only heights, the vertical
 * stack and type steps move. The recipes differ between themes in those too, but re-laying a
 * teacher's slide from its recipe would throw away their edits.
 *
 * An adaptive layout (a group with a `LayoutRef`) is the exception: its words live on the ref, so
 * it is re-laid by its template under the new theme first (TEACH-75 part aq). Its sizes were
 * measured in the old theme's faces; a Studio title at 44 in a 189-wide panel breaks Treehouse's
 * wider serif inside a word ("Brother / s and sisters"), which no lint of box heights sees. The
 * template measures every word in the new face and steps the title to its floor, or names it in
 * `over`.
 *
 * The deck's guard and Answers slides re-fit in the same pass (`relayEndAnswers`): their rows are
 * each answer's wrapped height in the old theme's faces, so a wider face ran one answer into the
 * next (TEACH-191 part c).
 */

export type RethemeOutcome = {
  /** Slides the tidy changed. */
  tidied: Id[];
  /** Boxes still past the safe area at the legibility floor, after the tidy. */
  overflow: Id[];
};

/**
 * Every slide that does not lint clean under `theme`, measured as the renderer draws it. The deck's
 * guard and Answers slides are left out: their template lays them out (a badge over its hidden
 * disc is an overlap by design), and a re-theme builds them again instead (`relayEndAnswers`).
 */
export function slidesNeedingFit(lesson: Lesson, theme: Theme, measure: Measurer): Id[] {
  return lesson.slides
    .filter((slide) => !slide.answersRole && !lintAsDrawn(slide, measure, theme).ok)
    .map((slide) => slide.id);
}

/**
 * Pure: every adaptive layout re-laid by its template under the lesson's own theme, where it is
 * (a moved group keeps its offset, a resized one its size: `placeInto`). A layout whose template
 * cannot lay out stays as it was; with no template code loaded (`kit` null) nothing changes.
 */
export function relayLayouts(lesson: Lesson, kit: LayoutKit | null): Lesson {
  if (!kit) return lesson;
  const theme = renderTheme(lesson);
  let changed = false;
  const slides = lesson.slides.map((slide) => {
    let touched = false;
    const elements = slide.elements.map((el) => {
      if (el.type !== "group" || !el.layout) return el;
      const relaid = tryRelayout(el.layout, lesson, kit, el.id);
      if (!relaid) return el;
      const g: GroupElement = { ...el };
      placeInto(g, el.layout, relaid, theme);
      touched = true;
      return g;
    });
    if (!touched) return slide;
    changed = true;
    return { ...slide, elements };
  });
  // The deck's guard and Answers slides re-fit the same way: built again by their template in this
  // theme's faces, so each row is as tall as its answer wraps here (TEACH-191 part c).
  const answered = kit.relayEndAnswers(slides, theme, kit.stageOf(theme, lesson.ageBand));
  if (answered) return { ...lesson, slides: answered };
  return changed ? { ...lesson, slides } : lesson;
}

/**
 * Pure: every adaptive layout re-laid under the lesson's own theme (`relayLayouts`), then every
 * slide the linter flags under it, tidied.
 */
export function fitLessonToTheme(
  lesson: Lesson,
  measure: Measurer,
  kit: LayoutKit | null = layoutKit(),
): { lesson: Lesson; outcome: RethemeOutcome } {
  const theme = renderTheme(lesson);
  let out = relayLayouts(lesson, kit);
  const tidied: Id[] = [];
  const overflow: Id[] = [];
  for (const id of slidesNeedingFit(out, theme, measure)) {
    const made = tidySlide(out, id, measure);
    out = made.lesson;
    if (made.outcome.changed) tidied.push(id);
    overflow.push(...made.outcome.overflow);
  }
  return { lesson: out, outcome: { tidied, overflow } };
}

/**
 * The recipes write the theme's palette into the elements they lay out (a caption in `muted`, a
 * card in `surface`, a rule in `line`), so a slide keeps its old colours after `setTheme`: Chalk's
 * muted caption on Night Lab's black is unreadable. Every colour value that is exactly one of the
 * old theme's palette entries becomes the new theme's entry of the same name; any other colour is
 * the teacher's own and is kept. Text content is never touched.
 */
export function recolourSlide(slide: Slide, from: Theme, to: Theme): Slide {
  if (from.id === to.id) return slide;
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(from.colors)) {
    const next = (to.colors as Record<string, string>)[key];
    const k = value.toLowerCase();
    if (next && !map.has(k)) map.set(k, next);
  }
  const walk = (node: unknown, key?: string): unknown => {
    // A drawing's stored source (TEACH-97 part h) is words and values, never colours on the slide:
    // a label that happens to read like a palette hex stays as written.
    if (key === "diagram") return node;
    if (typeof node === "string") {
      return key === "text" ? node : (map.get(node.toLowerCase()) ?? node);
    }
    if (Array.isArray(node)) return node.map((n) => walk(n));
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    }
    return node;
  };
  return walk(slide) as Slide;
}

/** Pure: the lesson in `themeId`, fitted to it. Choosing the theme it already has is a no-op. */
export function rethemeLesson(
  lesson: Lesson,
  themeId: string,
  measure: Measurer,
  kit: LayoutKit | null = layoutKit(),
): { lesson: Lesson; outcome: RethemeOutcome } {
  if (lesson.themeId === themeId) return { lesson, outcome: { tidied: [], overflow: [] } };
  const from = renderTheme(lesson);
  const to = renderTheme(lesson, themeId);
  const themed = reducers.setTheme(lesson, themeId);
  const recoloured = { ...themed, slides: themed.slides.map((s) => recolourSlide(s, from, to)) };
  return fitLessonToTheme(recoloured, measure, kit);
}

/** `fitLessonToTheme` in reducer shape, for `history.dispatch`. */
export const fitLessonToThemeReducer = (lesson: Lesson, measure: Measurer) =>
  fitLessonToTheme(lesson, measure);

/** Every measurement a re-theme will ask for, for one warm-up batch. */
export const rethemeMeasureInputs = (lesson: Lesson) =>
  lesson.slides.flatMap((slide) => measureInputsOf(slide));

/**
 * The theme picker's preview step, in reducer shape: whatever the lesson is now, it becomes
 * `opening` re-themed to `themeId` and fitted, so browsing themes never stacks one re-fit on
 * another. Picking the opening theme gives `opening` back unchanged.
 */
export const rethemeFromReducer = (
  _current: Lesson,
  opening: Lesson,
  themeId: string,
  measure: Measurer,
) => rethemeLesson(opening, themeId, measure);

/**
 * Text fitting engine — the migration decision, pure (TeachDeck `lib/layout/fit-plan.ts`).
 *
 * The floors in `MIN_FONT_SIZE` are applied at render time, so raising one grows the text inside
 * boxes positioned under the old number. A lesson records the floor table it was last fitted to
 * (`fitVersion`), and this file decides what to do about a lesson that is behind: a lesson at the
 * current version is left alone (one integer comparison); a lesson behind is re-fitted **only on
 * the slides the linter flags**; either way it is stamped, so the decision is made once per lesson.
 */

import type { Id, Lesson, Slide } from "@tj/domain/documents";
import { FIT_VERSION } from "../model/themes";
import { type MeasureInput, type Measurer, textPartsOf } from "./reflow";

/**
 * The auto-height text boxes on a slide, with the ruler input each one needs. Option cards count:
 * the engine treats them as auto-height (`textPartsOf`) and grows them at render time like a text
 * box, so a deck whose only stale slide is a question with overlong answers must be flagged too.
 */
const growable = (slide: Slide) =>
  slide.elements.flatMap((el) => {
    if (el.type !== "text" && el.type !== "gap-text" && el.type !== "option") return [];
    const parts = textPartsOf(el, slide);
    if (!parts?.autoHeight) return [];
    return [
      {
        el,
        input: {
          doc: parts.doc,
          width: el.w,
          style: parts.style,
          preset: parts.preset,
          role: parts.role,
          inset: parts.inset,
          chrome: parts.chrome,
        } satisfies MeasureInput,
      },
    ];
  });

/** Every measurement `renderedHeights` will ask for on this slide, for one warm-up batch. */
export const measureInputsOf = (slide: Slide): MeasureInput[] =>
  growable(slide).map((g) => g.input);

/**
 * The slide as the renderer will draw it: every auto-height text box at the height its own content
 * needs, and nothing moved. Only *growth* is modelled — a floor is a minimum, so a floor change can
 * only make stored text bigger.
 */
export function renderedHeights(slide: Slide, measure: Measurer): Slide {
  const grown = new Map(growable(slide).map((g) => [g.el.id, measure(g.input)]));
  if (grown.size === 0) return slide;
  const elements = slide.elements.map((el) => {
    const h = grown.get(el.id);
    return h !== undefined && h > el.h ? { ...el, h } : el;
  });
  return { ...slide, elements };
}

export type FitPlan = {
  /** True when there is anything at all to do, a version stamp included. */
  needed: boolean;
  /** The slides to re-fit, in document order. Empty when nothing is flagged. */
  slideIds: Id[];
  /** The version to stamp on the lesson afterwards. */
  version: number;
};

const NOTHING = (version: number): FitPlan => ({ needed: false, slideIds: [], version });

/** What the lesson was last fitted to. A document written before the field is at 0. */
export const fitVersionOf = (lesson: Pick<Lesson, "fitVersion">): number => lesson.fitVersion ?? 0;

/** True when the stored layout predates the current floor table. */
export const isFitStale = (lesson: Pick<Lesson, "fitVersion">, version = FIT_VERSION): boolean =>
  fitVersionOf(lesson) < version;

/** Which slides of `lesson` need re-fitting, given a linter. */
export function planFitMigration(
  lesson: Pick<Lesson, "fitVersion" | "slides">,
  flagged: (slide: Slide) => boolean,
  version = FIT_VERSION,
): FitPlan {
  if (!isFitStale(lesson, version)) return NOTHING(version);
  return {
    needed: true,
    slideIds: lesson.slides.filter((slide) => flagged(slide)).map((slide) => slide.id),
    version,
  };
}

/** The toast, shown only when a slide actually moved. */
export function fitMigrationMessage(slides: number): string {
  if (slides <= 0) return "";
  return `${slides === 1 ? "1 slide" : `${slides} slides`} tidied to fit the new text sizes.`;
}

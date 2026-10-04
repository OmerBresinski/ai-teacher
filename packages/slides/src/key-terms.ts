import {
  type LessonFacts,
  richDocToPlainText,
  type Slide,
  type SlideElement,
} from "@tj/domain/documents";
import { KIND_TAG_NAME } from "./look";
import { withTerms } from "./structure";
import { getTheme } from "./themes";

/*
 * Key terms (UX ruling 150): a lesson's vocabulary is bold at its first use on each teaching slide,
 * never in a heading, a question or an answer. `withTerms` (`structure.ts`) does the marking; this
 * file says where the terms come from and runs the marking over a whole lesson, for a planner that
 * only knows its terms once the slides are written (plan-write's vocabulary slide).
 */

/** The slide kinds that teach, whose running text carries the marks. */
const TEACHING = new Set<Slide["kind"]>(["content", "image-text"]);

/**
 * The lesson's key terms: its facts' vocabulary, then any term a vocabulary slide prints that the
 * facts do not hold. A vocabulary slide's terms are its `Term` elements, or before structuring its
 * `body` text that is not a definition (the reading `@tj/domain` `checkVocabularyInFacts` uses).
 */
export function lessonKeyTerms(lesson: {
  facts?: Pick<LessonFacts, "vocabulary"> | null;
  slides: readonly Slide[];
}): string[] {
  const out = new Map<string, string>();
  const add = (term: string) => {
    const clean = term.trim().replace(/[:.]$/, "").trim();
    if (clean && !out.has(clean.toLowerCase())) out.set(clean.toLowerCase(), clean);
  };
  for (const item of lesson.facts?.vocabulary ?? []) add(item.term);
  for (const slide of lesson.slides) {
    if (slide.kind !== "vocabulary") continue;
    for (const e of flat(slide.elements)) {
      if (e.type !== "text") continue;
      const term = e.name === "Term" || (!e.name && e.style.preset === "body");
      if (term) add(richDocToPlainText(e.doc).split("\n")[0] ?? "");
    }
  }
  return [...out.values()];
}

/**
 * Whether a slide teaches: a content or image-text slide, unless it carries a kind tag (a
 * PRACTICE or CHECK set drawn on the content recipe asks questions, and a question never shows
 * its key term in bold).
 */
export function isTeachingSlide(slide: Slide): boolean {
  return TEACHING.has(slide.kind) && !slide.elements.some((e) => e.name === KIND_TAG_NAME);
}

/**
 * Every teaching slide with its key terms bold at their first use; every other slide as it is.
 * `terms` is one list for the lesson, or a list per slide (index for index, e.g. a writer's
 * per-slide `keyTerms`); a slide with no list is left as it is.
 */
export function withKeyTerms(
  slides: readonly Slide[],
  themeId: string,
  terms: readonly string[] | readonly (readonly string[] | undefined)[],
): Slide[] {
  const theme = getTheme(themeId);
  const perSlide = terms.some((x) => Array.isArray(x));
  return slides.map((slide, i) => {
    const list = (perSlide ? terms[i] : terms) as readonly string[] | undefined;
    return list?.length && isTeachingSlide(slide) ? withTerms(slide, theme, [...list]) : slide;
  });
}

function flat(elements: readonly SlideElement[]): SlideElement[] {
  return elements.flatMap((e) => (e.type === "group" ? [e, ...flat(e.children)] : [e]));
}

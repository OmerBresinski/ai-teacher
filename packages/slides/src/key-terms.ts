import {
  type LessonFacts,
  richDocToPlainText,
  type Slide,
  type SlideElement,
} from "@tj/domain/documents";
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

/** Every teaching slide with its key terms bold at their first use; every other slide as it is. */
export function withKeyTerms(slides: readonly Slide[], themeId: string, terms: string[]): Slide[] {
  if (terms.length === 0) return [...slides];
  const theme = getTheme(themeId);
  return slides.map((slide) => (TEACHING.has(slide.kind) ? withTerms(slide, theme, terms) : slide));
}

function flat(elements: readonly SlideElement[]): SlideElement[] {
  return elements.flatMap((e) => (e.type === "group" ? [e, ...flat(e.children)] : [e]));
}

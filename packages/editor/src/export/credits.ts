/**
 * The "Image credits" page every lesson export ends on (Images project, Decisions 2 and 5): one
 * line per searched picture, "Photo by {photographer} on Pexels" from `source`, else the legacy
 * Openverse `credit` text. Nothing is drawn on the slides themselves. Shared by the print route
 * (PDF), the PowerPoint exporter and the PNG run, so the three can never list different pictures.
 *
 * Pure and tiny, so `ExportControl` may import it statically. It must never import `./pptx`,
 * `./png` or `./docx`: that would pull a click-loaded exporter into a route chunk (ADR 0023 §4,
 * `CLICK_LOADED_CHUNKS`). Hence its own group walk rather than `flattenElements`.
 *
 * Imported lessons are untrusted JSON: every address goes through `normaliseHref`, the gate
 * `ImageCreditText` uses, and a refused one is dropped. The wording matches `ImageCreditText`.
 */
import {
  type ImageElement,
  type Lesson,
  normaliseHref,
  type SlideElement,
} from "@tj/domain/documents";

export const IMAGE_CREDITS_TITLE = "Image credits";

export type ImageCreditLink = { label: string; href: string };
export type ImageCredit = {
  /** What the list is deduplicated on (`pexels:<id>` or `credit:<text>`); unique, so a React key. */
  key: string;
  text: string;
  links: ImageCreditLink[];
};

function* images(elements: readonly SlideElement[]): Generator<ImageElement> {
  for (const el of elements) {
    if (el.type === "image") yield el;
    else if (el.type === "group") yield* images(el.children);
  }
}

const link = (label: string, raw: string | undefined): ImageCreditLink[] => {
  const href = raw ? normaliseHref(raw) : null;
  return href ? [{ label, href }] : [];
};

/**
 * Every credited picture in the deck, deduplicated (by `source.id` for Pexels, by the credit text
 * otherwise) in order of first appearance. `slideIndices` limits the walk to those slides, in deck
 * order, for an export of a range; omitted, the whole deck.
 */
export function imageCredits(lesson: Lesson, slideIndices?: readonly number[]): ImageCredit[] {
  const slides = slideIndices
    ? [...new Set(slideIndices)].sort((a, b) => a - b).flatMap((i) => lesson.slides[i] ?? [])
    : lesson.slides;
  const seen = new Set<string>();
  const out: ImageCredit[] = [];
  for (const slide of slides) {
    for (const image of images(slide.elements)) {
      const { source, credit } = image;
      if (source) {
        const key = `pexels:${source.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          key,
          text: `Photo by ${source.photographer} on Pexels`,
          links: [
            ...link(source.photographer, source.photographerUrl),
            ...link("Pexels", source.pageUrl),
          ],
        });
      } else if (credit?.trim()) {
        const key = `credit:${credit}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, text: credit, links: link("View the original", image.creditUrl) });
      }
    }
  }
  return out;
}

export type CreditSegment = { text: string; href?: string };

/**
 * A credit line as runs, the way `ImageCreditText` reads it: a link whose label is in the text
 * links those words in place ("Photo by *Ada* on *Pexels*"); one that is not ("View the original")
 * follows the text after a middle dot. For the formats that carry links inline (PDF, PPTX).
 */
export function creditSegments(credit: ImageCredit): CreditSegment[] {
  const out: CreditSegment[] = [];
  const trailing: ImageCreditLink[] = [];
  let rest = credit.text;
  for (const link of credit.links) {
    const at = rest.indexOf(link.label);
    if (!link.label || at < 0) {
      trailing.push(link);
      continue;
    }
    if (at > 0) out.push({ text: rest.slice(0, at) });
    out.push({ text: link.label, href: link.href });
    rest = rest.slice(at + link.label.length);
  }
  if (rest) out.push({ text: rest });
  for (const link of trailing) out.push({ text: " · " }, { text: link.label, href: link.href });
  return out;
}

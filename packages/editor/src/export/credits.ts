/**
 * The "Image credits" page every lesson export ends on (Images project, Decisions 2 and 5): one
 * line per searched picture, worded by `photoCredit` from `source`, else the legacy
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
  type PhotoSource,
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
  const order = slideIndices
    ? [...new Set(slideIndices)].sort((a, b) => a - b)
    : lesson.slides.map((_, i) => i);
  const seen = new Set<string>();
  const out: ImageCredit[] = [];
  /** Deck numbers of slides with a generated picture: one line for all of them. */
  const generatedOn: number[] = [];
  let generatedAt = -1;
  for (const index of order) {
    const slide = lesson.slides[index];
    if (!slide) continue;
    for (const image of images(slide.elements)) {
      const { source, credit } = image;
      if (source?.provider === "generated") {
        if (generatedAt < 0) generatedAt = out.length;
        if (!generatedOn.includes(index + 1)) generatedOn.push(index + 1);
      } else if (source) {
        const line = photoCredit(source, { cropped: isCropped(image) });
        if (seen.has(line.key)) {
          // A picture shown cut down anywhere in the deck is credited as cropped.
          if (isCropped(image)) {
            const at = out.findIndex((c) => c.key === line.key);
            if (at >= 0) out[at] = line;
          }
          continue;
        }
        seen.add(line.key);
        out.push(line);
      } else if (credit?.trim()) {
        const key = `credit:${credit}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, text: credit, links: link("View the original", image.creditUrl) });
      }
    }
  }
  if (generatedOn.length)
    out.splice(generatedAt, 0, { key: "generated", text: generatedLine(generatedOn), links: [] });
  return out;
}

/** "and"-joined numbers: 1 / 1 and 3 / 1, 3, 4 and 8. */
const listed = (ns: number[]) =>
  ns.length < 2 ? String(ns[0]) : `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;

/**
 * The one credits-page line for every generated picture (TEACH-251): "Pictures on slides 1, 3, 4
 * and 8 were generated for this lesson." Each picture's own info dot keeps `GENERATED_CREDIT`.
 */
export function generatedLine(slideNumbers: number[]): string {
  return slideNumbers.length === 1
    ? `The picture on slide ${slideNumbers[0]} was generated for this lesson.`
    : `Pictures on slides ${listed(slideNumbers)} were generated for this lesson.`;
}

/**
 * Whether a placed picture is shown cut down (TEACH-251): a crop, a focal point, a transform, or
 * Fill (`cover`), which trims whatever does not match the box. Counted on the safe side: a
 * CC BY or BY-SA credit says "cropped" whenever the picture may have been.
 */
export function isCropped(image: Pick<ImageElement, "fit" | "crop" | "focal" | "imageTransform">) {
  return image.fit === "cover" || !!image.crop || !!image.focal || !!image.imageTransform;
}

/** A Commons file's title from its file page (`…/wiki/File:Hadrian%27s_Wall.jpg` → "Hadrian's Wall"). */
export function commonsTitle(sourceUrl: string | undefined): string | undefined {
  const m = sourceUrl ? /\/wiki\/File:([^?#]+)/.exec(sourceUrl) : null;
  if (!m?.[1]) return undefined;
  let name = m[1];
  try {
    name = decodeURIComponent(name);
  } catch {}
  return (
    name
      .replace(/_/g, " ")
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .trim() || undefined
  );
}

const ATTRIBUTION = /^cc[ -]by\b/i;
export const GENERATED_CREDIT = "Picture generated for this lesson";

/**
 * One picture's credit, as the badge and every export word it (TEACH-251):
 * - Pexels: "Photo by {photographer} on Pexels";
 * - Commons: "{file title}, {author}, {licence}", with ", cropped" for a CC BY or BY-SA picture
 *   shown cut down, the title linking the file page and the licence its deed;
 * - generated: "Picture generated for this lesson".
 */
export function photoCredit(source: PhotoSource, opts: { cropped?: boolean } = {}): ImageCredit {
  if (source.provider === "commons") {
    const title = commonsTitle(source.sourceUrl ?? source.pageUrl) ?? "Wikimedia Commons file";
    const author = source.author?.trim() || source.photographer || "Unknown author";
    const licence = source.licence?.trim() || "see the file page";
    const cropped = opts.cropped && ATTRIBUTION.test(licence) ? ", cropped" : "";
    return {
      key: `commons:${source.id}`,
      text: `${title}, ${author}, ${licence}${cropped}`,
      links: [
        ...link(title, source.sourceUrl ?? source.pageUrl),
        ...(source.licence ? link(licence, source.licenceUrl) : []),
      ],
    };
  }
  if (source.provider === "generated")
    return { key: `generated:${source.id}`, text: GENERATED_CREDIT, links: [] };
  return {
    key: `pexels:${source.id}`,
    text: `Photo by ${source.photographer} on Pexels`,
    links: [
      ...link(source.photographer, source.photographerUrl),
      ...link("Pexels", source.pageUrl),
    ],
  };
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

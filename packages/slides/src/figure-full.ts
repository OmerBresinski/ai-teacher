/**
 * DIAGRAM-AUDIT item 5: the big-diagram composition (`figure-full`). A heading across the top, the
 * drawing across the full safe width and most of the height, and an optional one-line caption under
 * it. For a diagram that is the slide's point and needs room: a 7-event timeline, a big labelled
 * cross-section, a process. `asFigureFull` turns a picture slide (image-text) into it, so a drawing
 * that does not fit the half-slide zone can step up before its labels shrink.
 */
import type { ImageElement, Slide, SlideElement, TextElement, Theme } from "@tj/domain/documents";
import { SAFE } from "./grid";
import { boxH, PLACEHOLDER_IMAGE, text } from "./layouts";

/** The gap between the heading and the drawing, and between the drawing and its caption. */
const GAP = 14;
/** The longest caption that sits on one line under the drawing at body size. */
export const FIGURE_FULL_CAPTION_MAX = 110;

/** Where the big diagram's heading, drawing and caption go on theme `t`. */
export function figureFullRects(t: Theme, caption: boolean) {
  const headH = boxH(t, "heading", 1);
  const capH = caption ? boxH(t, "body", 1) : 0;
  const top = SAFE.y + headH + GAP;
  const bottom = SAFE.y + SAFE.h - (caption ? capH + GAP : 0);
  return {
    heading: { x: SAFE.x, y: SAFE.y, w: SAFE.w, h: headH },
    figure: { x: SAFE.x, y: top, w: SAFE.w, h: bottom - top },
    caption: { x: SAFE.x, y: SAFE.y + SAFE.h - capH, w: SAFE.w, h: capH },
  };
}

/** The zone's shape for a menu line or a picture request: width over height. */
export function figureFullAspect(t: Theme): number {
  const { figure } = figureFullRects(t, true);
  return figure.w / figure.h;
}

const plain = (e: TextElement): string =>
  (e.doc?.content ?? [])
    .map((p) =>
      ((p as { content?: { text?: string }[] }).content ?? []).map((x) => x.text ?? "").join(""),
    )
    .join(" ")
    .trim();

/**
 * `slide` (a picture slide with its placeholder still empty) as the big-diagram composition, or
 * undefined when its words do not allow it: the body must fit the one-line caption. The kicker
 * goes; the heading keeps its words; the placeholder takes the full zone.
 */
export function asFigureFull(slide: Slide, t: Theme): Slide | undefined {
  const els = slide.elements as SlideElement[];
  const image = els.find(
    (e): e is ImageElement => e.type === "image" && (e as ImageElement).src === PLACEHOLDER_IMAGE,
  );
  const heading = els.find(
    (e): e is TextElement => e.type === "text" && (e as TextElement).style?.preset === "heading",
  );
  if (!image || !heading) return undefined;
  const bodies = els.filter(
    (e): e is TextElement => e.type === "text" && (e as TextElement).style?.preset === "body",
  );
  const words = bodies.map(plain).filter(Boolean).join(" ");
  if (words.length > FIGURE_FULL_CAPTION_MAX) return undefined;
  const r = figureFullRects(t, words.length > 0);
  const out: SlideElement[] = [
    { ...heading, ...r.heading, style: { ...heading.style, align: "left" } },
    { ...image, ...r.figure, fit: "contain" },
  ];
  if (words) out.push(text("body", words, r.caption, { align: "center", color: t.colors.muted }));
  return { ...slide, elements: out } as Slide;
}

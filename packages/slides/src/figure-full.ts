/**
 * DIAGRAM-AUDIT item 5: the big-diagram composition (`figure-full`). A heading across the top, the
 * drawing across the full safe width and most of the height, and an optional one-line caption under
 * it. For a diagram that is the slide's point and needs room: a 7-event timeline, a big labelled
 * cross-section, a process. `asFigureFull` turns a picture slide (image-text) into it, so a drawing
 * that does not fit the half-slide zone can step up before its labels shrink.
 */
import type {
  ImageElement,
  RichDoc,
  Slide,
  SlideElement,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { SAFE } from "./grid";
import { boxH, PLACEHOLDER_IMAGE, text } from "./layouts";
import { countLines } from "./text-measure";

/** The gap between the heading and the drawing, and between the drawing and its caption. */
const GAP = 14;
/**
 * The most lines the words under the drawing may take, measured on the slide's theme. LAYOUT-TEST:
 * every drawing slide the writer gave came with three teaching lines (77-426 characters), and a
 * one-line caption meant a drawing too big for the half zone (y7's three particle panels) was
 * dropped rather than stepped up. Four lines still leave the drawing about 3:1 across the slide.
 */
export const FIGURE_FULL_CAPTION_LINES = 4;

/** How many lines the words take under the drawing, one paragraph each, at body size on `t`. */
export function figureFullCaptionLines(t: Theme, words: string | string[]): number {
  const paras = (Array.isArray(words) ? words : [words]).filter(Boolean);
  return paras.reduce((n, p) => n + countLines(p, "body", t, SAFE.w), 0);
}

/** Ordinary slide words, to measure how many characters a line holds. */
const SAMPLE =
  "Particles in a solid vibrate about fixed positions, close together in a regular pattern, while ";

/** About how many characters of ordinary words one body line `width` points wide holds on `t`. */
export function bodyLineChars(t: Theme, width: number): number {
  const sample = SAMPLE.repeat(4);
  let n = 1;
  while (n < sample.length && countLines(sample.slice(0, n + 1).trimEnd(), "body", t, width) <= 1)
    n++;
  return n;
}

/** About how many characters of ordinary words one caption line holds on `t`. */
export function figureFullCaptionChars(t: Theme): number {
  return bodyLineChars(t, SAFE.w);
}

/**
 * Where the big diagram's heading, drawing and caption go on theme `t`, with a caption of
 * `caption` lines (true: one line).
 */
export function figureFullRects(t: Theme, caption: boolean | number) {
  const lines = caption === true ? 1 : caption === false ? 0 : caption;
  const headH = boxH(t, "heading", 1);
  const capH = lines > 0 ? boxH(t, "body", lines) : 0;
  const top = SAFE.y + headH + GAP;
  const bottom = SAFE.y + SAFE.h - (lines > 0 ? capH + GAP : 0);
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
 * The slide's words in reading order, each body line with the kicker set above it ("Miranda:
 * paternal care becomes command."): LAYOUT-TEST Z y10 slide 3 lost the kickers and read as
 * lower-case fragments.
 */
function captionWords(els: SlideElement[]): string[] {
  const out: string[] = [];
  let kicker = "";
  const texts = els
    .filter((e): e is TextElement => e.type === "text")
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const e of texts) {
    const preset = e.style?.preset;
    if (preset === "caption") kicker = plain(e);
    else if (preset === "body") {
      const w = plain(e);
      if (w) out.push(kicker ? `${kicker.replace(/[:\s]+$/, "")}: ${w}` : w);
      kicker = "";
    }
  }
  return out;
}

/**
 * `slide` (a picture slide with its placeholder still empty) as the big-diagram composition, or
 * undefined when its words do not allow it: the words, measured on `t`, must fit the caption's
 * lines, so the caption never runs past its box (LAYOUT-TEST Z y10 slide 3: a 100-character
 * caption took two lines in a one-line box and the render-time refit moved it onto the table).
 * The heading keeps its words; the placeholder takes the full zone.
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
  const words = captionWords(els);
  const lines = figureFullCaptionLines(t, words);
  if (lines > FIGURE_FULL_CAPTION_LINES) return undefined;
  const r = figureFullRects(t, lines);
  const out: SlideElement[] = [
    { ...heading, ...r.heading, style: { ...heading.style, align: "left" } },
    { ...image, ...r.figure, fit: "contain" },
  ];
  // One line reads as a caption, centred and muted; the slide's teaching lines, one paragraph
  // each, read as text under the drawing.
  if (words.length === 1)
    out.push(
      text("body", words[0] as string, r.caption, { align: "center", color: t.colors.muted }),
    );
  else if (words.length > 1) {
    const doc = {
      type: "doc",
      content: words.map((w) => ({ type: "paragraph", content: [{ type: "text", text: w }] })),
    } as unknown as RichDoc;
    out.push(text("body", doc, r.caption, { align: "left" }));
  }
  return { ...slide, elements: out } as Slide;
}

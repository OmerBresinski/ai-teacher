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
import { renderedHeights } from "./lint";
import { countLines, measureHeadless } from "./text-measure";

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
export function figureFullRects(
  t: Theme,
  caption: boolean | number,
  height?: number,
  headingHeight?: number,
) {
  const lines = caption === true ? 1 : caption === false ? 0 : caption;
  const headH = Math.max(headingHeight ?? 0, boxH(t, "heading", 1));
  const capH = lines > 0 ? Math.max(height ?? 0, boxH(t, "body", lines)) : 0;
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

/** The words under the drawing as their text element: one line a caption, more a block of lines. */
function wordsElement(
  t: Theme,
  words: string[],
  rect: { x: number; y: number; w: number; h: number },
) {
  if (words.length === 1)
    return text("body", words[0] as string, rect, { align: "center", color: t.colors.muted });
  const doc = {
    type: "doc",
    content: words.map((w) => ({ type: "paragraph", content: [{ type: "text", text: w }] })),
  } as unknown as RichDoc;
  return text("body", doc, rect, { align: "left" });
}

/**
 * The height the words take under the drawing, as the fit check's headless ruler measures it
 * (paragraph gaps included: LAYOUT-FIX offline, a 4-paragraph block sized by line count alone
 * overflowed its box on y1, y7 and y9).
 */
function wordsHeight(t: Theme, words: string[]): number {
  if (!words.length) return 0;
  const el = wordsElement(t, words, { x: SAFE.x, y: SAFE.y, w: SAFE.w, h: 1 });
  const probe = { id: "probe", kind: "content", elements: [el] } as unknown as Slide;
  return renderedHeights(probe, measureHeadless(t)).elements[0]?.h ?? 0;
}

/**
 * `slide` (a picture slide with its placeholder still empty) as the big-diagram composition, or
 * undefined when its words do not allow it: the words, measured on `t`, must fit the caption's
 * lines, so the caption never runs past its box (LAYOUT-TEST Z y10 slide 3: a 100-character
 * caption took two lines in a one-line box and the render-time refit moved it onto the table).
 * The heading keeps its words; the placeholder takes the full zone.
 */
export function asFigureFull(
  slide: Slide,
  t: Theme,
  { spill = false }: { spill?: boolean } = {},
): Slide | undefined {
  const els = slide.elements as SlideElement[];
  const image = els.find(
    (e): e is ImageElement => e.type === "image" && (e as ImageElement).src === PLACEHOLDER_IMAGE,
  );
  const heading = els.find(
    (e): e is TextElement => e.type === "text" && (e as TextElement).style?.preset === "heading",
  );
  if (!image || !heading) return undefined;
  let words = captionWords(els);
  let moved: string[] = [];
  // The room under the drawing: the cap's lines plus one for the gaps between paragraphs.
  const room = boxH(t, "body", FIGURE_FULL_CAPTION_LINES + 1);
  const over = (w: string[]) =>
    figureFullCaptionLines(t, w) > FIGURE_FULL_CAPTION_LINES || wordsHeight(t, w) > room;
  if (over(words)) {
    // LAYOUT-FIX smoke: y7's and y9's three lines measured 6 and 5 lines, the step-up was
    // refused and the drawing dropped. With `spill` (the drawing needs the full zone), whole lines
    // past the cap go to the notes word for word, from the end; the first line always stays.
    if (!spill) return undefined;
    let k = words.length - 1;
    while (k > 1 && over(words.slice(0, k))) k--;
    if (over(words.slice(0, k))) return undefined;
    moved = words.slice(k);
    words = words.slice(0, k);
  }
  const lines = figureFullCaptionLines(t, words);
  // The heading as tall as it measures across the full width (LAYOUT-FIX offline: y9's heading
  // took two lines on chalk and ran into the drawing).
  const headProbe = { id: "probe", kind: "content", elements: [{ ...heading, ...SAFE, h: 1 }] };
  const headH = renderedHeights(headProbe as unknown as Slide, measureHeadless(t)).elements[0]?.h;
  const r = figureFullRects(t, lines, wordsHeight(t, words), headH);
  const out: SlideElement[] = [
    { ...heading, ...r.heading, style: { ...heading.style, align: "left" } },
    { ...image, ...r.figure, fit: "contain" },
  ];
  // One line reads as a caption, centred and muted; the slide's teaching lines, one paragraph
  // each, read as text under the drawing.
  if (words.length) out.push(wordsElement(t, words, r.caption));
  const notes = moved.length
    ? [(slide as { notes?: string }).notes?.trim() ?? "", ...moved].filter(Boolean).join("\n")
    : (slide as { notes?: string }).notes;
  return { ...slide, elements: out, ...(notes === undefined ? {} : { notes }) } as Slide;
}

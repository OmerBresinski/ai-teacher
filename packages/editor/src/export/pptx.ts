/**
 * PPTX export (TeachDeck `lib/export/pptx.ts`; ADR 0023 §4, §7 and the 2026-09-12 amendment).
 * Reached only through `await import("./pptx")` from `ExportControl`, and `pptxgenjs` itself only
 * through the `import()` inside `exportLessonPptx`, so neither is in any route chunk.
 *
 * Why this file is a straight mapping and not a rasteriser: departments share
 * schemes of work as `.pptx` on a shared drive, and a cover teacher opens
 * whatever is on the network. Text that arrives as a picture is worse than
 * useless — so every element becomes a native PowerPoint object with real text,
 * real fonts and real shapes.
 *
 * Units. A slide is 960x540 logical points. We define a custom 13.333x7.5in
 * layout, so 1 slide point is exactly 1/72in — a PowerPoint point. Positions
 * divide by 72; font sizes and margins pass through unchanged.
 *
 * Reveal steps. pptxgenjs 4.0.1 has no animation API (there is no `animation`
 * property anywhere in its types), so research/02 decision 20 — "each reveal
 * phase maps to one PowerPoint animation set to On Click" — cannot be met
 * literally. Instead each reveal step becomes its own slide ("build slides"),
 * carrying the elements revealed so far. Clicking through in PowerPoint reveals
 * the same content in the same order; only the mechanism differs.
 *
 * Images. Every stored `src` is `/files/:key` on the api origin behind the session cookie, so
 * `toDataUrl` fetches with `credentials: "include"` for that origin and `"omit"` for any other
 * (an imported document's foreign URL; our cookie must not go to a third party). The api origin
 * arrives as `PptxExportOptions.imageOrigin` — never read from the environment here (ADR 0022).
 *
 * Answers. With `includeAnswers` the deck ends on an Answers slide (TeachDeck) *and* every correct
 * option card is drawn in its revealed state — the badge, tint and ring `OptionView` shows — which
 * TeachDeck never drew (TD item 4 leftover). Without it the cards are at rest and there is no
 * Answers slide.
 */
import type {
  GapTextElement,
  IconElement,
  ImageElement,
  Lesson,
  LineElement,
  OptionElement,
  QuestionData,
  ShapeElement,
  ShapeKind,
  Slide,
  SlideElement,
  TableElement,
  TextElement,
  Theme,
  TimerElement,
} from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import type PptxGenJS from "pptxgenjs";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  clamp,
  GAP_TOKEN,
  gapAnswers,
  optionChipLabel,
  optionPositions,
  optionState,
  type ResolvedText,
  resolveFontSize,
  resolveTextStyle,
} from "../slide/elements/kit";
import { docToPlainText } from "../text/static";
import { imageCredentials } from "./image-credentials";
import { slugify } from "./json";
import { docToRuns, type RunParagraph } from "./runs";

type Pptx = PptxGenJS;
type TextProps = PptxGenJS.TextProps;
type TextOptions = PptxGenJS.TextPropsOptions;
type ShapeName = PptxGenJS.SHAPE_NAME;
type ShapeOptions = PptxGenJS.ShapeProps;
type ImageOptions = PptxGenJS.ImageProps;
type TableRow = PptxGenJS.TableRow;

export const LAYOUT_NAME = "TD";
export const LAYOUT_W_IN = SLIDE_W / 72; // 13.333…
export const LAYOUT_H_IN = SLIDE_H / 72; // 7.5

/* ------------------------------------------------------------------ */
/* Units, colour, type                                                 */
/* ------------------------------------------------------------------ */

/** Slide points to inches. The only place 72 appears. */
export const inches = (pt: number): number => pt / 72;

/**
 * A CSS colour to PowerPoint's bare 6-digit hex. Anything it cannot read
 * (gradients, `currentColor`, named colours) returns undefined so the caller
 * can fall back to a theme value rather than write an invalid file.
 */
export function hexColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  const h = hex?.[1];
  if (h) return (h.length === 3 ? h.replace(/./g, (c) => c + c) : h).toUpperCase();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) {
    const byte = (n: string | undefined) =>
      clamp(Math.round(Number(n ?? 0)), 0, 255)
        .toString(16)
        .padStart(2, "0");
    return `${byte(rgb[1])}${byte(rgb[2])}${byte(rgb[3])}`.toUpperCase();
  }
  return undefined;
}

/** The real family names behind `lib/fonts.ts`'s CSS variables. */
export const FONT_FAMILIES: Record<string, string> = {
  lexend: "Lexend",
  gabarito: "Gabarito",
  figtree: "Figtree",
  "source-serif": "Source Serif 4",
  schibsted: "Schibsted Grotesk",
  literata: "Literata",
  "public-sans": "Public Sans",
  bricolage: "Bricolage Grotesque",
  "instrument-sans": "Instrument Sans",
  atkinson: "Atkinson Hyperlegible Next",
  geist: "Geist",
};

const FALLBACK_FACE = "Arial";

/**
 * `var(--font-lexend), "Trebuchet MS", sans-serif` becomes `Lexend`.
 * PowerPoint wants one family name, and a CSS variable means nothing to it.
 */
export function fontFaceFor(stack: string | undefined): string {
  if (!stack) return FALLBACK_FACE;
  const variable = /var\(\s*--font-([a-z0-9-]+)/i.exec(stack)?.[1];
  if (variable) {
    const named = FONT_FAMILIES[variable.toLowerCase()];
    if (named) return named;
  }
  for (const part of stack.split(",")) {
    const family = part.trim().replace(/^["']|["']$/g, "");
    if (!family || family.startsWith("var(")) continue;
    if (
      /^(sans-serif|serif|monospace|cursive|system-ui|ui-sans-serif|ui-serif|ui-monospace)$/i.test(
        family,
      )
    )
      continue;
    return family;
  }
  return FALLBACK_FACE;
}

/** `-0.01em` at 52pt is -0.52pt of tracking. Anything not in em is ignored. */
export function trackingToPt(
  letterSpacing: string | undefined,
  fontSize: number,
): number | undefined {
  if (!letterSpacing) return undefined;
  const em = /^(-?[\d.]+)em$/.exec(letterSpacing.trim());
  if (!em) return undefined;
  const pt = Number(em[1]) * fontSize;
  return Math.abs(pt) < 0.01 ? undefined : Number(pt.toFixed(2));
}

/** Element opacity as PowerPoint transparency (percent). */
const transparencyOf = (opacity: number | undefined): number | undefined =>
  opacity == null || opacity >= 1 ? undefined : clamp(Math.round((1 - opacity) * 100), 0, 100);

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

const SHAPES: Record<ShapeKind, ShapeName> = {
  rect: "rect",
  rounded: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  star: "star5",
  speech: "wedgeRoundRectCallout",
  pill: "roundRect",
};

export const pptxShapeName = (kind: ShapeKind): ShapeName => SHAPES[kind] ?? "rect";

const DASHES: Record<NonNullable<LineElement["dash"]>, "solid" | "dash" | "sysDot"> = {
  solid: "solid",
  dashed: "dash",
  dotted: "sysDot",
};

export const pptxDashType = (dash: LineElement["dash"]) => DASHES[dash ?? "solid"] ?? "solid";

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export type RunStyle = {
  fontFace: string;
  fontSize: number;
  color?: string;
  bold?: boolean;
  align?: TextOptions["align"];
  /** Caption preset is uppercase in the renderer, so it is uppercase here too. */
  uppercase?: boolean;
  charSpacing?: number;
};

/**
 * Paragraphs of runs to pptxgenjs's `TextProps[]`.
 *
 * pptxgenjs reads paragraph-level properties (bullet, align, indent) from each
 * run, so they are repeated across every run of a line, and `breakLine` ends the
 * line on its last run. The final line never breaks, or PowerPoint shows a
 * trailing empty paragraph.
 *
 * A shift+enter is a soft break — one `a:br` inside the paragraph, not a new
 * `a:p`. pptxgenjs only emits it for a run that is *not* first in its line
 * (`softBreakBefore` is skipped at `idx === 0`), so the paragraph before a soft
 * one must not close itself with `breakLine`, or the flag has no effect at all.
 */
export function paragraphsToTextProps(paragraphs: RunParagraph[], style: RunStyle): TextProps[] {
  const out: TextProps[] = [];
  paragraphs.forEach((para, pi) => {
    const last = pi === paragraphs.length - 1;
    const nextIsSoft = paragraphs[pi + 1]?.soft === true;
    const closes = !last && !nextIsSoft;
    const paraOpts: TextOptions = {};
    if (para.align) paraOpts.align = para.align;
    else if (style.align) paraOpts.align = style.align;
    // Only the paragraph that owns the list item carries the bullet: a bullet on a
    // soft continuation would start a fresh line in pptxgenjs and lose the break.
    if (para.list && !para.soft) {
      paraOpts.bullet = para.list === "ordered" ? { type: "number" } : true;
      if (para.level > 0) paraOpts.indentLevel = para.level;
    }
    if (para.soft) paraOpts.softBreakBefore = true;

    if (para.runs.length === 0) {
      out.push({
        text: "",
        options: {
          ...paraOpts,
          breakLine: closes,
          fontFace: style.fontFace,
          fontSize: style.fontSize,
        },
      });
      return;
    }

    para.runs.forEach((run, ri) => {
      const options: TextOptions = {
        ...paraOpts,
        fontFace: style.fontFace,
        fontSize: style.fontSize,
        breakLine: closes && ri === para.runs.length - 1,
      };
      if (ri > 0) delete options.softBreakBefore;
      const color = hexColor(run.color) ?? style.color;
      if (color) options.color = color;
      if (run.bold || style.bold) options.bold = true;
      if (run.italic) options.italic = true;
      if (run.underline) options.underline = { style: "sng" };
      if (run.strike) options.strike = true;
      // pptxgenjs writes a run hyperlink as `a:hlinkClick`, so the link survives as a
      // real PowerPoint link rather than as blue underlined text.
      if (run.href) options.hyperlink = { url: run.href };
      if (style.charSpacing) options.charSpacing = style.charSpacing;
      out.push({ text: style.uppercase ? run.text.toUpperCase() : run.text, options });
    });
  });
  return out.length > 0 ? out : [{ text: "", options: { fontSize: style.fontSize } }];
}

const runStyleFor = (r: ResolvedText, theme: Theme): RunStyle => ({
  fontFace: fontFaceFor(r.fontFamily || theme.fonts.body),
  fontSize: r.fontSize,
  color: hexColor(r.color) ?? hexColor(theme.colors.ink),
  bold: r.fontWeight >= 600,
  align: r.align,
  uppercase: r.textTransform === "uppercase",
  charSpacing: trackingToPt(r.letterSpacing, r.fontSize),
});

/** The box a text-ish element sits in: position, padding, fill, rotation. */
export function textBoxOptions(
  element: Pick<SlideElement, "x" | "y" | "w" | "h" | "rotation" | "opacity">,
  r: ResolvedText,
): TextOptions {
  const options: TextOptions = {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    margin: r.padding,
    align: r.align,
    valign: r.valign,
    lineSpacingMultiple: clamp(Number(r.lineHeight.toFixed(2)), 0.1, 9.99),
    isTextBox: true,
    wrap: true,
    fit: r.autoHeight ? "resize" : "none",
  };
  if (element.rotation) options.rotate = Math.round(element.rotation);
  const fill = hexColor(r.background);
  if (fill) {
    options.fill = { color: fill };
    if (r.radius > 0) {
      options.shape = "roundRect";
      options.rectRadius = inches(r.radius);
    }
  }
  const transparency = transparencyOf(element.opacity);
  if (transparency != null) options.transparency = transparency;
  return options;
}

/* ------------------------------------------------------------------ */
/* Reveal steps and answers                                            */
/* ------------------------------------------------------------------ */

/** The highest reveal step on a slide, walking into groups. */
export function maxRevealStep(slide: Slide): number {
  let max = 0;
  const walk = (els: SlideElement[]) => {
    for (const el of els) {
      if (el.revealStep && el.revealStep > max) max = el.revealStep;
      if (el.type === "group") walk(el.children);
    }
  };
  walk(slide.elements);
  return max;
}

/**
 * One entry per PowerPoint slide: the source slide plus the reveal step it shows.
 * A slide with no reveals yields exactly one entry, so a plain deck is 1:1.
 */
export type BuildSlide = { slide: Slide; index: number; step: number; steps: number };

export function buildSlidePlan(lesson: Lesson): BuildSlide[] {
  return lesson.slides.flatMap((slide, index) => {
    const steps = maxRevealStep(slide);
    return Array.from({ length: steps + 1 }, (_, step) => ({
      slide,
      index,
      step,
      steps: steps + 1,
    }));
  });
}

const visibleAt = (el: SlideElement, step: number) => (el.revealStep ?? 0) <= step;

/**
 * Every element on a slide in paint order, groups opened out. Answers are read
 * from this rather than from `slide.elements`, because a teacher who groups a
 * title with its underline still expects the title on the Answers slide —
 * `optionPositions` in `kit.ts` already walks groups the same way.
 */
export function flattenElements(elements: readonly SlideElement[]): SlideElement[] {
  const out: SlideElement[] = [];
  const walk = (els: readonly SlideElement[]) => {
    for (const el of els) {
      out.push(el);
      if (el.type === "group") walk(el.children);
    }
  };
  walk(elements);
  return out;
}

/** A short label for a slide, used on the Answers slide. */
export function slideLabel(slide: Slide, index: number): string {
  const text = flattenElements(slide.elements)
    .map((el) => ("doc" in el && el.doc ? docToPlainText(el.doc).trim() : ""))
    .find((t) => t.length > 0);
  const trimmed = (text ?? "").split("\n")[0]?.trim() ?? "";
  const short = trimmed.length > 64 ? `${trimmed.slice(0, 63)}…` : trimmed;
  return short ? `Slide ${index + 1}. ${short}` : `Slide ${index + 1}`;
}

export type AnswerEntry = { label: string; answer: string };

/** Every question slide's correct answer, in slide order. */
export function lessonAnswers(lesson: Lesson): AnswerEntry[] {
  const out: AnswerEntry[] = [];
  lesson.slides.forEach((slide, index) => {
    const answer = answerText(slide);
    if (answer) out.push({ label: slideLabel(slide, index), answer });
  });
  return out;
}

function optionText(slide: Slide, id: string): string {
  const el = flattenElements(slide.elements).find((e) => e.id === id);
  if (!el) return "";
  if (el.type === "option" || el.type === "text" || el.type === "gap-text")
    return docToPlainText(el.doc).trim();
  return el.name ?? "";
}

export function answerText(slide: Slide): string | null {
  const q: QuestionData | undefined = slide.question;
  if (!q) return null;
  switch (q.type) {
    case "true-false": {
      const value = q.correct ? "True" : "False";
      return q.explanation ? `${value}. ${q.explanation}` : value;
    }
    case "multiple-choice": {
      const correct = q.options
        .filter((o) => o.correct)
        .map((o) => optionText(slide, o.id))
        .filter(Boolean);
      const value = correct.length > 0 ? correct.join(", ") : "No correct option recorded";
      return q.explanation ? `${value}. ${q.explanation}` : value;
    }
    case "fill-gap":
      return q.gaps.map((g, i) => `${i + 1}. ${g.answer}`).join("   ") || null;
    case "sort":
      return q.order.map((id, i) => `${i + 1}. ${optionText(slide, id)}`).join("   ") || null;
    case "matching":
      return (
        q.pairs
          .map(
            (p) => `${optionText(slide, p.leftElementId)} → ${optionText(slide, p.rightElementId)}`,
          )
          .join("   ") || null
      );
    case "image-match":
      // Same shape as matching, with the picture's layer name standing in for the
      // left-hand card: an image has no text of its own to quote.
      return (
        q.pairs
          .map((p) => `${optionText(slide, p.imageId)} → ${optionText(slide, p.labelId)}`)
          .join("   ") || null
      );
    case "open-response":
      return q.modelAnswer?.trim() || null;
    default:
      return null;
  }
}

/** `[[gap:id]]` becomes an underscore rule as long as the answer it hides. */
export function gapTextToBlanks(
  element: GapTextElement,
  question: QuestionData | undefined,
): RunParagraph[] {
  const answers = gapAnswers(question);
  const paragraphs = docToRuns(element.doc);
  for (const para of paragraphs) {
    for (const run of para.runs) {
      run.text = run.text.replace(GAP_TOKEN, (_m, id: string) => {
        const answer = answers.get(id) ?? "";
        return "_".repeat(clamp(answer.length + 2, 5, 24));
      });
    }
  }
  return paragraphs;
}

/* ------------------------------------------------------------------ */
/* Images and icons                                                    */
/* ------------------------------------------------------------------ */

/**
 * Fetched images, deduplicated *within one export only*. It is cleared when an
 * export finishes, so a dropped connection cannot pin "Image could not be
 * embedded" to a URL for the life of the tab — "Try again" really does try
 * again — and a deck full of embedded data URLs is not held for the session.
 */
const imageCache = new Map<string, string | null>();

export const clearImageCache = (): void => imageCache.clear();

/** A data URL for `src`, or null when it cannot be embedded (CORS, 404, Node). */
async function toDataUrl(src: string, imageOrigin: string | undefined): Promise<string | null> {
  if (src.startsWith("data:")) return src;
  const cached = imageCache.get(src);
  if (cached !== undefined) return cached;
  let result: string | null = null;
  try {
    const response = await fetch(src, {
      mode: "cors",
      credentials: imageCredentials(src, imageOrigin),
    });
    if (response.ok) {
      const blob = await response.blob();
      result = await blobToDataUrl(blob);
    }
  } catch {
    result = null;
  }
  imageCache.set(src, result);
  return result;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === "undefined") {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      // `FileReader` is missing only outside the browser (a Node test run), where
      // `btoa` may be missing too; `Buffer` is the Node-only fallback of last
      // resort and is chunked out of the client bundle with the rest of this branch.
      const base64 =
        typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
      return `data:${blob.type || "image/png"};base64,${base64}`;
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image data"));
    reader.readAsDataURL(blob);
  });
}

/**
 * A lucide icon as a PNG data URL, rasterised at 4x so it stays crisp when a
 * teacher projects the deck. Browser only: without a DOM the caller draws a
 * placeholder instead.
 */
async function iconDataUrl(
  element: IconElement,
  color: string,
  size: number,
): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  try {
    // The icon set is React components, so the only way to a bitmap is to render one. TeachDeck
    // reached for `react-dom/server`; that pulled a second copy of the renderer (180 KB gz) into
    // the shared react chunk, so here the icon is mounted into a detached node with the client
    // root the page already has and its markup read back. `IconView` stays a dynamic import: it
    // lands in this chunk only when a deck that actually holds an icon is exported.
    const { ICONS } = await import("../slide/elements/IconView");
    const Icon = ICONS[element.icon];
    if (!Icon) return null;
    const strokeWidth = element.strokeWidth ?? clamp(size / 28, 2, 6);
    const host = document.createElement("div");
    const root = createRoot(host);
    let markup: string;
    try {
      flushSync(() =>
        root.render(createElement(Icon, { size, color, strokeWidth, absoluteStrokeWidth: true })),
      );
      markup = host.innerHTML;
    } finally {
      root.unmount();
    }
    const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    const scale = 4;
    const image = await loadImage(svg);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(size * scale);
    canvas.height = Math.round(size * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not rasterise icon"));
    image.src = src;
  });
}

/* ------------------------------------------------------------------ */
/* Element rendering                                                   */
/* ------------------------------------------------------------------ */

/**
 * What an enclosing group does to a child. PowerPoint gets the children as
 * top-level shapes rather than a `p:grpSp`, so the group's own frame has to be
 * baked into each child — exactly as `ElementFrame` bakes it into the DOM:
 * offset, then rotation about the group's centre, then opacity multiplied down.
 */
type GroupFrame = {
  dx: number;
  dy: number;
  /** Total rotation inherited from enclosing groups, in degrees. */
  rotation: number;
  /** Centre of that rotation, in absolute slide points. */
  cx: number;
  cy: number;
  /** Opacity of enclosing groups, multiplied together. */
  opacity: number;
};

const NO_FRAME: GroupFrame = { dx: 0, dy: 0, rotation: 0, cx: 0, cy: 0, opacity: 1 };

/** An element in absolute slide coordinates, with its group's frame baked in. */
export function place<T extends SlideElement>(element: T, frame: GroupFrame): T {
  if (frame.dx === 0 && frame.dy === 0 && frame.rotation === 0 && frame.opacity >= 1)
    return element;
  let x = element.x + frame.dx;
  let y = element.y + frame.dy;
  let rotation = element.rotation ?? 0;
  if (frame.rotation) {
    // Rotate the child's centre about the group's centre, then let PowerPoint
    // spin the child about its own centre by the same angle. Together those are
    // the single CSS `rotate()` the renderer puts on the group frame.
    const radians = (frame.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const px = x + element.w / 2 - frame.cx;
    const py = y + element.h / 2 - frame.cy;
    x = frame.cx + px * cos - py * sin - element.w / 2;
    y = frame.cy + px * sin + py * cos - element.h / 2;
    rotation += frame.rotation;
  }
  const opacity = (element.opacity ?? 1) * frame.opacity;
  return {
    ...element,
    x,
    y,
    ...(rotation ? { rotation } : {}),
    ...(opacity < 1 ? { opacity } : {}),
  };
}

/** The frame a group hands its children, given the group already placed. */
const frameFor = (group: SlideElement): GroupFrame => ({
  dx: group.x,
  dy: group.y,
  rotation: group.rotation ?? 0,
  cx: group.x + group.w / 2,
  cy: group.y + group.h / 2,
  opacity: group.opacity ?? 1,
});

/** What one export run carries down to every element. */
type DrawContext = {
  slide: Slide;
  step: number;
  /** Correct option cards draw revealed (`includeAnswers`). */
  revealAnswers: boolean;
  /** `optionPositions(slide)`: the true-false fallback `optionState` needs. */
  optionIndex: Map<string, number>;
  imageOrigin: string | undefined;
};

async function drawElement(
  pptxSlide: PptxGenJS.Slide,
  raw: SlideElement,
  theme: Theme,
  ctx: DrawContext,
  frame: GroupFrame,
): Promise<void> {
  const element = place(raw, frame);
  const { slide, step } = ctx;
  switch (element.type) {
    case "text":
      drawText(pptxSlide, element, theme);
      return;
    case "gap-text":
      drawGapText(pptxSlide, element, theme, slide.question);
      return;
    case "option": {
      const revealed =
        ctx.revealAnswers &&
        optionState(
          element,
          slide.question,
          docToPlainText(element.doc),
          ctx.optionIndex.get(element.id),
        ) === "correct";
      drawOption(pptxSlide, element, theme, slide.question, revealed);
      return;
    }
    case "shape":
      drawShape(pptxSlide, element, theme);
      return;
    case "line":
      drawLine(pptxSlide, element, theme);
      return;
    case "table":
      drawTable(pptxSlide, element, theme);
      return;
    case "timer":
      drawTimer(pptxSlide, element, theme);
      return;
    case "embed":
      drawEmbed(pptxSlide, element, theme);
      return;
    case "image":
      await drawImage(pptxSlide, element, theme, ctx.imageOrigin);
      return;
    case "icon":
      await drawIcon(pptxSlide, element, theme);
      return;
    case "group": {
      // A child of a group has its own reveal step, and the renderer hides it on
      // that step alone (`GroupView` forwards `step`, `ElementFrame` hides).
      // Without this filter every build slide would carry the whole group.
      const inner = frameFor(element);
      for (const child of element.children) {
        if (!visibleAt(child, step)) continue;
        await drawElement(pptxSlide, child, theme, ctx, inner);
      }
      return;
    }
    default:
      return;
  }
}

function drawText(pptxSlide: PptxGenJS.Slide, element: TextElement, theme: Theme): void {
  const r = resolveTextStyle(element.style, theme);
  pptxSlide.addText(
    paragraphsToTextProps(docToRuns(element.doc), runStyleFor(r, theme)),
    textBoxOptions(element, r),
  );
}

function drawGapText(
  pptxSlide: PptxGenJS.Slide,
  element: GapTextElement,
  theme: Theme,
  question: QuestionData | undefined,
): void {
  const r = resolveTextStyle(element.style, theme);
  pptxSlide.addText(
    paragraphsToTextProps(gapTextToBlanks(element, question), runStyleFor(r, theme)),
    textBoxOptions(element, r),
  );
}

const OPTION_PAD = 24;
const OPTION_CHIP = 34;
const OPTION_GAP = 19;
/** Reserved on the right for the tick, so nothing reflows on reveal. */
const OPTION_TICK_LANE = 44;

/** The revealed badge: `OptionView`'s `BADGE` / `BADGE_INSET`, in slide points. */
const OPTION_BADGE = 32;
const OPTION_BADGE_INSET = 10;

/**
 * The answer card, matching `slide/elements/OptionView.tsx` at rest — or, when `revealed`, in its
 * correct state: the `correct` tint at 10%, a 2pt ring in `correct`, the chip in `correct`, and the
 * tick badge in the top-right corner cut out in the card's own paper (TD item 4 leftover).
 */
function drawOption(
  pptxSlide: PptxGenJS.Slide,
  element: OptionElement,
  theme: Theme,
  question: QuestionData | undefined,
  revealed = false,
): void {
  const correct = hexColor(theme.colors.correct);
  const line = revealed ? correct : hexColor(theme.colors.line);
  const transparency = transparencyOf(element.opacity);
  const surface = hexColor(theme.colors.surface) ?? "FFFFFF";
  pptxSlide.addShape("roundRect", {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    fill: {
      color: surface,
      ...(transparency != null ? { transparency } : {}),
    },
    line: line
      ? {
          color: line,
          width: revealed ? 2 : 1.5,
          ...(transparency != null ? { transparency } : {}),
        }
      : { type: "none" },
    rectRadius: inches(theme.radius),
    ...(element.rotation ? { rotate: Math.round(element.rotation) } : {}),
  });
  // The 10% tint is a second plate over the paper: PowerPoint has one fill per shape, and the
  // renderer's `withAlpha(correct, 0.1)` is exactly that layer over `surface`.
  if (revealed && correct) {
    pptxSlide.addShape("roundRect", {
      x: inches(element.x),
      y: inches(element.y),
      w: inches(element.w),
      h: inches(element.h),
      fill: { color: correct, transparency: 90 },
      line: { type: "none" },
      rectRadius: inches(theme.radius),
      ...(element.rotation ? { rotate: Math.round(element.rotation) } : {}),
    });
  }

  // The tick lane is reserved on scorable cards whether or not the answer is
  // showing, exactly as `OptionView` reserves it, so the text wraps the same way.
  const scorable = question?.type === "multiple-choice" || question?.type === "true-false";
  const label = optionChipLabel(element, docToPlainText(element.doc));
  let textX = element.x + OPTION_PAD;
  let textW = element.w - OPTION_PAD - (scorable ? OPTION_PAD + OPTION_TICK_LANE : OPTION_PAD);
  if (label) {
    const chipY = element.y + (element.h - OPTION_CHIP) / 2;
    pptxSlide.addText(label, {
      x: inches(textX),
      y: inches(chipY),
      w: inches(OPTION_CHIP),
      h: inches(OPTION_CHIP),
      align: "center",
      valign: "middle",
      margin: 0,
      fontFace: fontFaceFor(theme.fonts.title),
      fontSize: 19,
      bold: true,
      color: (revealed ? correct : undefined) ?? hexColor(theme.colors.accent),
      // `OptionView`: the chip's tint is 12% at rest and 22% once the card is revealed.
      fill: {
        color: (revealed ? correct : undefined) ?? hexColor(theme.colors.accent) ?? "000000",
        transparency: revealed ? 78 : 88,
      },
      shape: "roundRect",
      rectRadius: inches(10),
    });
    textX += OPTION_CHIP + OPTION_GAP;
    textW -= OPTION_CHIP + OPTION_GAP;
  }

  // research/04 §4 sets option cards at small/1.35, tighter than the theme's body.
  // The `option` role carries the 31pt projector floor the `small` stop does not.
  const r = resolveTextStyle(
    { preset: "small", valign: "middle", lineHeight: 1.35, ...element.textStyle },
    theme,
    element.textStyle?.preset ?? "small",
    "option",
  );
  pptxSlide.addText(paragraphsToTextProps(docToRuns(element.doc), runStyleFor(r, theme)), {
    ...textBoxOptions({ ...element, x: textX, w: Math.max(textW, 24) }, r),
    margin: 0,
    fit: "none",
  });

  if (revealed && correct) {
    pptxSlide.addText("✓", {
      x: inches(element.x + element.w - OPTION_BADGE_INSET - OPTION_BADGE),
      y: inches(element.y + OPTION_BADGE_INSET),
      w: inches(OPTION_BADGE),
      h: inches(OPTION_BADGE),
      align: "center",
      valign: "middle",
      margin: 0,
      fontFace: fontFaceFor(theme.fonts.title),
      fontSize: 18,
      bold: true,
      color: surface,
      fill: { color: correct },
      shape: "ellipse",
    });
  }
}

function drawShape(pptxSlide: PptxGenJS.Slide, element: ShapeElement, theme: Theme): void {
  const stroke = hexColor(element.stroke);
  const strokeWidth = element.strokeWidth ?? (element.stroke ? 2 : 0);
  const radius =
    element.shape === "pill"
      ? Math.min(element.w, element.h) / 2
      : (element.radius ?? theme.radius);
  const options: ShapeOptions = {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    fill: { color: hexColor(element.fill ?? theme.colors.surface) ?? "FFFFFF" },
    line: stroke && strokeWidth > 0 ? { color: stroke, width: strokeWidth } : { type: "none" },
  };
  if (element.shape === "rounded" || element.shape === "pill") options.rectRadius = inches(radius);
  if (element.rotation) options.rotate = Math.round(element.rotation);
  const transparency = transparencyOf(element.opacity);
  if (transparency != null && options.fill) options.fill = { ...options.fill, transparency };
  pptxSlide.addShape(pptxShapeName(element.shape), options);

  if (element.doc && docToPlainText(element.doc).trim()) {
    const r = resolveTextStyle(
      { align: "center", valign: "middle", padding: 12, ...element.textStyle },
      theme,
      element.textStyle?.preset ?? "body",
    );
    pptxSlide.addText(paragraphsToTextProps(docToRuns(element.doc), runStyleFor(r, theme)), {
      ...textBoxOptions(element, r),
      fill: undefined,
      fit: "none",
    });
  }
}

function drawLine(pptxSlide: PptxGenJS.Slide, element: LineElement, theme: Theme): void {
  // Every other element maps opacity through `transparencyOf`; so does this one.
  const transparency = transparencyOf(element.opacity);
  const x1 = element.x + element.from.x * element.w;
  const y1 = element.y + element.from.y * element.h;
  const x2 = element.x + element.to.x * element.w;
  const y2 = element.y + element.to.y * element.h;
  pptxSlide.addShape("line", {
    x: inches(Math.min(x1, x2)),
    y: inches(Math.min(y1, y2)),
    w: inches(Math.max(Math.abs(x2 - x1), 0.01)),
    h: inches(Math.max(Math.abs(y2 - y1), 0.01)),
    flipH: x2 < x1,
    flipV: y2 < y1,
    ...(element.rotation ? { rotate: Math.round(element.rotation) } : {}),
    line: {
      color: hexColor(element.stroke ?? theme.colors.ink) ?? "000000",
      width: element.strokeWidth ?? 3,
      dashType: pptxDashType(element.dash),
      beginArrowType: element.arrowStart ? "triangle" : "none",
      endArrowType: element.arrowEnd ? "triangle" : "none",
      ...(transparency != null ? { transparency } : {}),
    },
  });
}

function drawTable(pptxSlide: PptxGenJS.Slide, element: TableElement, theme: Theme): void {
  const source = element.rows ?? [];
  if (source.length === 0) return;
  const header = element.header !== false;
  const cols = source.reduce((n, row) => Math.max(n, row.length), 0);
  const fontSize = resolveFontSize(theme, "small", element.fontSize);
  const line = hexColor(theme.colors.line) ?? "DDDDDD";
  const widths =
    element.colWidths && element.colWidths.length === cols
      ? element.colWidths.map((f) => inches(f * element.w))
      : Array.from({ length: cols }, () => inches(element.w / Math.max(1, cols)));

  // `TableView.tsx` drops the rule under the final body row, so the table ends on
  // white rather than on a hanging line. Same arithmetic for the cell padding.
  const lastRow = source.length - 1;
  const padY = Math.round(fontSize * 0.42);
  const padX = Math.round(fontSize * 0.6);
  const headTracking = trackingToPt(theme.titleTracking, fontSize);

  const rows: TableRow[] = source.map((row, ri) => {
    const isHead = header && ri === 0;
    const bottom: PptxGenJS.BorderProps = isHead
      ? { type: "solid", color: hexColor(theme.colors.accent) ?? line, pt: 2 }
      : ri === lastRow
        ? { type: "none" }
        : { type: "solid", color: line, pt: 1 };
    return Array.from({ length: cols }, (_, ci) => ({
      text: row[ci] ?? "",
      options: {
        // The renderer's header weight is the theme's, not an unconditional bold.
        bold: isHead ? theme.weights.heading >= 600 : theme.weights.body >= 600,
        ...(isHead && headTracking ? { charSpacing: headTracking } : {}),
        fontFace: fontFaceFor(isHead ? theme.fonts.title : theme.fonts.body),
        fontSize,
        color: hexColor(theme.colors.ink),
        valign: "top" as const,
        fill:
          !isHead && element.stripe && (header ? ri % 2 === 0 : ri % 2 === 1)
            ? { color: hexColor(theme.colors.accent2) ?? "EEEEEE", transparency: 94 }
            : undefined,
        border: [
          { type: "none" as const },
          { type: "none" as const },
          bottom,
          { type: "none" as const },
        ] as [
          PptxGenJS.BorderProps,
          PptxGenJS.BorderProps,
          PptxGenJS.BorderProps,
          PptxGenJS.BorderProps,
        ],
      },
    }));
  });

  pptxSlide.addTable(rows, {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    colW: widths,
    // [top, right, bottom, left], matching the renderer's asymmetric padding.
    margin: [padY, padX, padY, padX],
    fontSize,
    fontFace: fontFaceFor(theme.fonts.body),
  });
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function drawTimer(pptxSlide: PptxGenJS.Slide, element: TimerElement, theme: Theme): void {
  const digits = Math.max(28, Math.min(element.h * 0.52, element.w * 0.3));
  pptxSlide.addText(formatClock(element.seconds), {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    align: "center",
    valign: "middle",
    margin: 0,
    fontFace: fontFaceFor(theme.fonts.title),
    fontSize: Math.round(digits),
    bold: theme.weights.title >= 600,
    color: hexColor(theme.colors.ink),
    fill: { color: hexColor(theme.colors.surface) ?? "FFFFFF" },
    line: { color: hexColor(theme.colors.line) ?? "DDDDDD", width: 1.5 },
    shape: "roundRect",
    rectRadius: inches(theme.radius),
  });
}

/** A poster plate that links out: PowerPoint cannot host our iframe embeds. */
function drawEmbed(pptxSlide: PptxGenJS.Slide, element: EmbedLike, theme: Theme): void {
  pptxSlide.addShape("roundRect", {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    fill: { color: "101215" },
    line: { type: "none" },
    rectRadius: inches(theme.radius),
    hyperlink: { url: element.url, tooltip: "Open the video" },
  });
  pptxSlide.addText("Video. Click to open", {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    align: "center",
    valign: "middle",
    margin: 0,
    fontFace: fontFaceFor(theme.fonts.body),
    fontSize: Math.max(16, resolveFontSize(theme, "small")),
    color: "FFFFFF",
    hyperlink: { url: element.url, tooltip: element.url },
  });
}

type EmbedLike = { x: number; y: number; w: number; h: number; url: string };

async function drawImage(
  pptxSlide: PptxGenJS.Slide,
  element: ImageElement,
  theme: Theme,
  imageOrigin: string | undefined,
): Promise<void> {
  const data = await toDataUrl(element.src, imageOrigin);
  if (!data) {
    drawMissingImage(pptxSlide, element, theme);
    return;
  }
  const options: ImageOptions = {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    data,
    sizing: {
      type: element.fit === "cover" ? "cover" : "contain",
      w: inches(element.w),
      h: inches(element.h),
    },
  };
  if (element.alt) options.altText = element.alt;
  if (element.rotation) options.rotate = Math.round(element.rotation);
  if ((element.radius ?? 0) > 0) options.rounding = true;
  const transparency = transparencyOf(element.opacity);
  if (transparency != null) options.transparency = transparency;
  pptxSlide.addImage(options);
}

/** A CORS-blocked or missing image leaves a labelled plate, never a broken deck. */
function drawMissingImage(pptxSlide: PptxGenJS.Slide, element: ImageElement, theme: Theme): void {
  pptxSlide.addShape("roundRect", {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    fill: { color: hexColor(theme.colors.surface) ?? "FFFFFF" },
    line: { color: hexColor(theme.colors.line) ?? "DDDDDD", width: 1, dashType: "dash" },
    rectRadius: inches(theme.radius),
  });
  pptxSlide.addText(element.alt?.trim() || "Image could not be embedded", {
    x: inches(element.x),
    y: inches(element.y),
    w: inches(element.w),
    h: inches(element.h),
    align: "center",
    valign: "middle",
    margin: 12,
    fontFace: fontFaceFor(theme.fonts.body),
    fontSize: Math.max(14, resolveFontSize(theme, "caption")),
    color: hexColor(theme.colors.muted),
  });
}

async function drawIcon(
  pptxSlide: PptxGenJS.Slide,
  element: IconElement,
  theme: Theme,
): Promise<void> {
  const size = Math.max(8, Math.min(element.w, element.h));
  const color = element.color ?? theme.colors.accent;
  const data = await iconDataUrl(element, color, size);
  const x = element.x + (element.w - size) / 2;
  const y = element.y + (element.h - size) / 2;
  if (data) {
    pptxSlide.addImage({
      x: inches(x),
      y: inches(y),
      w: inches(size),
      h: inches(size),
      data,
      altText: element.name ?? element.icon,
      ...(element.rotation ? { rotate: Math.round(element.rotation) } : {}),
    });
    return;
  }
  // No DOM to rasterise with: an outlined plate keeps the layout honest.
  pptxSlide.addShape("roundRect", {
    x: inches(x),
    y: inches(y),
    w: inches(size),
    h: inches(size),
    fill: { type: "none" },
    line: { color: hexColor(color) ?? "000000", width: 2 },
    rectRadius: inches(size / 6),
  });
}

/* ------------------------------------------------------------------ */
/* Deck                                                                */
/* ------------------------------------------------------------------ */

export type PptxExportOptions = {
  /**
   * Show the answers: correct option cards draw revealed and a final slide lists every question's
   * answer. Default false — the one default every format shares (ADR 0023 §7, TD item 4).
   */
  includeAnswers?: boolean;
  /** The api origin (`${VITE_API_URL}`): image fetches to it carry the session cookie. */
  imageOrigin?: string;
};

export const pptxFilename = (lesson: Lesson): string => `${slugify(lesson.title)}.pptx`;

/**
 * The whole lesson as a PowerPoint file. By default question slides export with their answers
 * hidden and there is no answer key, so a teacher can project the deck without giving the game
 * away; `includeAnswers` reveals the correct cards and adds the Answers slide at the end.
 */
export async function exportLessonPptx(
  lesson: Lesson,
  theme: Theme,
  options: PptxExportOptions = {},
): Promise<Blob> {
  const { default: PptxGenJSClass } = await import("pptxgenjs");
  const pptx: Pptx = new PptxGenJSClass();

  pptx.defineLayout({ name: LAYOUT_NAME, width: LAYOUT_W_IN, height: LAYOUT_H_IN });
  pptx.layout = LAYOUT_NAME;
  pptx.title = lesson.title;
  pptx.subject = lesson.subject ?? "";
  pptx.author = "Teaching Journey";
  const revealAnswers = options.includeAnswers === true;

  const background = hexColor(theme.colors.background) ?? "FFFFFF";

  try {
    for (const build of buildSlidePlan(lesson)) {
      const { slide, step, steps } = build;
      const pptxSlide = pptx.addSlide();
      pptxSlide.background = { color: hexColor(slide.background?.color) ?? background };

      // A slide's own background wins outright, as in `SlideView`: theme art must
      // never paint over a colour the teacher chose, or there is no way off it.
      const own = slide.background;
      const image = own?.image ?? (own?.color ? undefined : theme.backgroundImage);
      if (image && !image.includes("gradient(")) {
        const data = await toDataUrl(image, options.imageOrigin);
        if (data) {
          pptxSlide.addImage({
            x: 0,
            y: 0,
            w: LAYOUT_W_IN,
            h: LAYOUT_H_IN,
            data,
            sizing: {
              type: (slide.background?.imageFit ?? "cover") === "contain" ? "contain" : "cover",
              w: LAYOUT_W_IN,
              h: LAYOUT_H_IN,
            },
          });
        }
      }

      const ctx: DrawContext = {
        slide,
        step,
        revealAnswers,
        optionIndex: optionPositions(slide),
        imageOrigin: options.imageOrigin,
      };
      for (const element of slide.elements) {
        if (!visibleAt(element, step)) continue;
        await drawElement(pptxSlide, element, theme, ctx, NO_FRAME);
      }

      const notes = slide.notes?.trim();
      const stepNote = steps > 1 ? `Reveal ${step + 1} of ${steps}.` : "";
      if (notes || stepNote) pptxSlide.addNotes([stepNote, notes].filter(Boolean).join("\n\n"));
    }

    const answers = revealAnswers ? lessonAnswers(lesson) : [];
    if (answers.length > 0) addAnswersSlide(pptx, lesson, theme, answers);

    const buffer = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
    return new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  } finally {
    clearImageCache();
  }
}

const SAFE_X = 64;
const SAFE_Y = 56;

function addAnswersSlide(pptx: Pptx, lesson: Lesson, theme: Theme, answers: AnswerEntry[]): void {
  const slide = pptx.addSlide();
  slide.background = { color: hexColor(theme.colors.background) ?? "FFFFFF" };

  slide.addText("Answers", {
    x: inches(SAFE_X),
    y: inches(SAFE_Y),
    w: inches(SLIDE_W - SAFE_X * 2),
    h: inches(resolveFontSize(theme, "heading") * 1.4),
    margin: 0,
    fontFace: fontFaceFor(theme.fonts.title),
    fontSize: resolveFontSize(theme, "heading"),
    bold: theme.weights.heading >= 600,
    color: hexColor(theme.colors.ink),
    charSpacing: trackingToPt(theme.titleTracking, resolveFontSize(theme, "heading")),
  });

  const size = Math.max(14, Math.min(resolveFontSize(theme, "small"), 20));
  const body: TextProps[] = answers.flatMap((entry, i) => [
    {
      text: entry.label,
      options: {
        fontFace: fontFaceFor(theme.fonts.title),
        fontSize: size,
        bold: true,
        color: hexColor(theme.colors.ink),
        breakLine: true,
      },
    },
    {
      text: entry.answer,
      options: {
        fontFace: fontFaceFor(theme.fonts.body),
        fontSize: size,
        color: hexColor(theme.colors.muted),
        breakLine: i < answers.length - 1,
        paraSpaceAfter: 8,
      },
    },
  ]);

  const top = SAFE_Y + resolveFontSize(theme, "heading") * 1.4 + 16;
  slide.addText(body, {
    x: inches(SAFE_X),
    y: inches(top),
    w: inches(SLIDE_W - SAFE_X * 2),
    h: inches(SLIDE_H - top - SAFE_Y),
    margin: 0,
    valign: "top",
    lineSpacingMultiple: 1.3,
    isTextBox: true,
    wrap: true,
    fit: "shrink",
  });

  slide.addNotes(`Answer key for "${lesson.title}". Not shown to the class.`);
}

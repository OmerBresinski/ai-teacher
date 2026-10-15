import {
  type RichDoc,
  type RichNode,
  type RunStyleAttrs,
  safeCssColor,
  safeHighlightSlot,
  safeRunFont,
  safeStrikeStep,
  type TextPreset,
  type TextStyle,
  type Theme,
} from "@tj/domain/documents";
import {
  BLOCK_GAP_EM,
  charAdvance,
  emWidth,
  isSpace,
  LIST_INDENT_EM,
  type LineType,
  ORDERED_INDENT_EM,
  quoteFamilyOf,
  type Run,
  runsOf,
  tablesFor,
  upperDoc,
  WRAP_SLACK,
} from "./text-measure";
import { resolveTextStyle } from "./text-style";

/**
 * Where each character landed (only when asked for): its line, its x and advance in ems from the
 * line's start. Offsets are UTF-16 indices into the runs' joined text, as ProseMirror counts them.
 */
type CharPlaces = { line: Int32Array; x: Float64Array; adv: Float64Array };

/** A paragraph broken into lines: each line's first offset and its set width in ems. */
type Broken = { starts: number[]; widths: number[]; places?: CharPlaces };

/**
 * Breaks a paragraph's runs into lines in a column `room` points wide: the one wrap rule every
 * count, line lookup and run rect uses. A bold run is measured at 700, as the renderer sets it: a
 * chunk's bold label is wider than the same words at 400. A hard break ("\n") starts a new line. A
 * word wider than the column breaks inside itself. `track` also records every character's place.
 */
export function breakRuns(
  runs: readonly Run[],
  type: LineType,
  room: number,
  track = false,
): Broken {
  const t = tablesFor(runs, type);
  const tracking = t.tracking;
  const ems = (room * (1 - WRAP_SLACK)) / type.fontSize;
  const total = track ? runs.reduce((n, r) => n + r.text.length, 0) : 0;
  const places: CharPlaces | undefined = track
    ? { line: new Int32Array(total), x: new Float64Array(total), adv: new Float64Array(total) }
    : undefined;
  const starts = [0];
  const widths: number[] = [];
  let used = 0;
  let word = 0;
  let space = 0;
  let wordStart = -1;
  // The current word's characters and the spaces before it, by offset (tracked runs only).
  const wordChars: number[] = [];
  const spaceChars: number[] = [];
  const newLine = (start: number) => {
    widths.push(used);
    starts.push(start);
  };
  const put = (i: number, line: number, x: number) => {
    if (!places) return;
    places.line[i] = line;
    places.x[i] = x;
  };
  const place = () => {
    if (word === 0) return;
    if (used === 0) used = word;
    else if (used + space + word <= ems) {
      for (const i of spaceChars) put(i, starts.length - 1, used);
      used += space + word;
    } else {
      for (const i of spaceChars) put(i, starts.length - 1, used);
      newLine(wordStart);
      used = word;
    }
    spaceChars.length = 0;
    // Where the word's first character sits on its (first) line.
    const line0 = starts.length - 1;
    const x0 = used - word;
    // A word wider than the column breaks inside itself.
    let cut = 0;
    while (used > ems) {
      cut += 1;
      used -= ems;
    }
    if (places) {
      let into = 0;
      for (const i of wordChars) {
        const k = cut === 0 ? 0 : Math.min(cut, Math.floor(into / ems));
        put(i, line0 + k, k === 0 ? x0 + into : into - k * ems);
        into += places.adv[i] ?? 0;
      }
    }
    for (let k = 1; k <= cut; k++) {
      widths.push(ems);
      // The line starts with the first character past k column widths into the word.
      let into = 0;
      let at = wordStart;
      for (const i of wordChars) {
        if (into >= k * ems) {
          at = i;
          break;
        }
        into += places?.adv[i] ?? 0;
      }
      starts.push(at);
    }
    wordChars.length = 0;
    word = 0;
    wordStart = -1;
  };
  let offset = 0;
  for (const run of runs) {
    const advances = t.of(run);
    const spaceWidth = emWidth(" ", advances, tracking);
    for (const ch of run.text) {
      const code = ch.codePointAt(0) ?? 0;
      const i = offset;
      offset += ch.length;
      if (code === 10) {
        place();
        for (const j of spaceChars) put(j, starts.length - 1, used);
        spaceChars.length = 0;
        put(i, starts.length - 1, used);
        newLine(offset);
        used = 0;
      } else if (isSpace(code, ch)) {
        place();
        space = spaceWidth;
        if (places) {
          places.adv[i] = spaceWidth;
          spaceChars.push(i);
        }
      } else {
        const adv = charAdvance(code, advances) + tracking;
        if (word === 0) wordStart = i;
        word += adv;
        if (places) {
          places.adv[i] = adv;
          wordChars.push(i);
        }
      }
    }
  }
  place();
  for (const j of spaceChars) put(j, starts.length - 1, used);
  widths.push(used);
  return places ? { starts, widths, places } : { starts, widths };
}

/**
 * Each slot's highlight fill until the theme carries its own (`--cat-n-fill`, layout batch A8):
 * Paper's r5 fills (`theming/slots.css`); `slide.css` holds the same hexes as its fallbacks.
 */
export const HIGHLIGHT_FALLBACK_FILLS = ["#F4D0D3", "#ADC0D6", "#F8E3BC", "#A8CFCD"] as const;

/** The validated run attributes on a node's `textStyle` mark (empty when it has none). */
export function runStyleOf(node: RichNode): RunStyleAttrs {
  const attrs = node.marks?.find((m) => m.type === "textStyle")?.attrs;
  const out: RunStyleAttrs = {};
  if (!attrs) return out;
  const color = safeCssColor(attrs.color);
  const font = safeRunFont(attrs.font);
  const highlight = safeHighlightSlot(attrs.highlight);
  const strikeStep = safeStrikeStep(attrs.strikeStep);
  if (color) out.color = color;
  if (font) out.font = font;
  if (highlight !== null) out.highlight = highlight;
  if (strikeStep !== null) out.strikeStep = strikeStep;
  return out;
}

/*
 * Line lookup and run rects (TEACH-205 part c, S-d2) on the headless ruler (`./text-measure.ts`,
 * the one wrap rule). A module of its own so the view and print chunks, which load the ruler for
 * `fittedFontSize`, do not carry it: its users are the PPTX export and the layout templates.
 */

/** What a measurement may override: a bold label's weight, a stepped-down size, the quote face. */
export type MeasureOpts = { weight?: number; fontSize?: number; font?: "quote" };

function plainLayout(
  text: string,
  preset: TextPreset,
  theme: Theme,
  width: number,
  opts: MeasureOpts,
  track: boolean,
): Broken {
  const r = resolveTextStyle({ preset }, theme);
  const type: LineType = {
    ...r,
    ...(opts.weight === undefined ? {} : { fontWeight: opts.weight }),
    ...(opts.fontSize === undefined ? {} : { fontSize: opts.fontSize }),
    quoteFamily: quoteFamilyOf(theme),
  };
  const shown = r.textTransform === "uppercase" ? text.toUpperCase() : text;
  return breakRuns(
    [{ text: shown, quote: opts.font === "quote" }],
    type,
    width - 2 * r.padding,
    track,
  );
}

/**
 * The offset each rendered line starts at (`[0, …]`), for `text` in a `preset` box `width` points
 * wide, by the same wrap rule as `countLines`: `lineBreaks(…).length === countLines(…)`.
 */
export function lineBreaks(
  text: string,
  preset: TextPreset,
  theme: Theme,
  width: number,
  opts: MeasureOpts = {},
): number[] {
  return plainLayout(text, preset, theme, width, opts, true).starts;
}

/**
 * Which rendered line (0-based) holds the character at `offset` (a UTF-16 index, as ProseMirror
 * and `String#slice` count). A space at a wrap belongs to the line it ends; an offset at or past
 * the end is on the last line. A source's anchor row and the slant check read it.
 */
export function lineOfOffset(
  text: string,
  offset: number,
  preset: TextPreset,
  theme: Theme,
  width: number,
  opts: MeasureOpts = {},
): number {
  const { starts, places } = plainLayout(text, preset, theme, width, opts, true);
  if (!places || offset >= text.length) return starts.length - 1;
  return places.line[Math.max(0, Math.floor(offset))] ?? 0;
}

/**
 * One rect per measured line of a run: element-local points. `x`/`w` span the run's glyph
 * advances on that line, `y`/`h` the line box, `baseline` the text baseline (approximated as
 * `BASELINE_EM` below the line box's middle, as a body face sits in CSS). `line` counts every
 * line of the doc from 0.
 */
export type RunRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  baseline: number;
  line: number;
  fontSize: number;
  attrs: RunStyleAttrs;
};

/** Text baseline below the middle of a line box, in ems: a body face's ascent less half its content. */
const BASELINE_EM = 0.35;

type LaidLine = { y: number; x: number; width: number; room: number; align: string };

/**
 * Where the runs `pick` selects sit in a text element (`doc` in a box `box.w` by `box.h`, styled
 * `style`): the PPTX export draws a highlight wash or a myth strike as a rect per measured line
 * (THEME-FIT PPTX mapping), and a writing form hangs its label chips off them. Lines, gaps,
 * indents, padding, alignment and vertical alignment follow `measureHeadless` and `slide.css`.
 * `fontSize` overrides the resolved size (a fitted box).
 */
export function runRects(
  doc: RichDoc,
  style: Partial<TextStyle> | undefined,
  theme: Theme,
  box: { w: number; h: number },
  pick: (attrs: RunStyleAttrs) => boolean,
  fontSize?: number,
): RunRect[] {
  const r = resolveTextStyle(style, theme, style?.preset ?? "body");
  const size = fontSize ?? r.fontSize;
  const type: LineType = { ...r, fontSize: size, quoteFamily: quoteFamilyOf(theme) };
  const lineH = size * r.lineHeight;
  const gap = BLOCK_GAP_EM * size;
  const shown = r.textTransform === "uppercase" ? upperDoc(doc) : doc;
  const out: RunRect[] = [];
  const lines: LaidLine[] = [];
  let y = 0;
  let first = true;
  const paragraph = (node: RichNode, indent: number) => {
    if (!first) y += gap;
    first = false;
    const runs = runsOf(node);
    const room = box.w - 2 * r.padding - indent;
    const broken = breakRuns(runs, type, room, true);
    const align = safeAlign(node.attrs?.textAlign) ?? r.align;
    const base = lines.length;
    broken.starts.forEach((_, k) => {
      lines.push({
        y: y + k * lineH,
        x: indent,
        width: (broken.widths[k] ?? 0) * size,
        room,
        align,
      });
    });
    y += broken.starts.length * lineH;
    let offset = 0;
    for (const run of runs) {
      const from = offset;
      offset += run.text.length;
      const attrs = run.node ? runStyleOf(run.node) : {};
      if (!pick(attrs) || !broken.places) continue;
      const byLine = new Map<number, [number, number]>();
      for (let i = from; i < offset; i++) {
        // Spaces never widen a rect: one at a wrap hangs past the line's end.
        const code = run.text.charCodeAt(i - from);
        if (code === 10 || code === 32 || code === 9) continue;
        const line = broken.places.line[i] ?? 0;
        const x0 = broken.places.x[i] ?? 0;
        const x1 = x0 + (broken.places.adv[i] ?? 0);
        const span = byLine.get(line);
        byLine.set(line, span ? [Math.min(span[0], x0), Math.max(span[1], x1)] : [x0, x1]);
      }
      for (const [line, [x0, x1]] of byLine) {
        out.push({
          x: x0 * size,
          y: 0,
          w: (x1 - x0) * size,
          h: lineH,
          baseline: 0,
          line: base + line,
          fontSize: size,
          attrs,
        });
      }
    }
  };
  const blocks = (nodes: RichNode[], indent: number) => {
    for (const node of nodes) {
      if (node.type === "bulletList" || node.type === "orderedList") {
        const inner =
          indent + (node.type === "orderedList" ? ORDERED_INDENT_EM : LIST_INDENT_EM) * size;
        for (const item of node.content ?? []) blocks(item.content ?? [], inner);
      } else paragraph(node, indent);
    }
  };
  blocks(shown.content ?? [], 0);
  const inner = box.h - 2 * r.padding;
  const top =
    r.padding + (r.valign === "middle" ? (inner - y) / 2 : r.valign === "bottom" ? inner - y : 0);
  for (const rect of out) {
    const line = lines[rect.line];
    if (!line) continue;
    const slack = line.room - line.width;
    const shift = line.align === "center" ? slack / 2 : line.align === "right" ? slack : 0;
    rect.x += r.padding + line.x + shift;
    rect.y = top + line.y;
    rect.baseline = rect.y + lineH / 2 + BASELINE_EM * size;
  }
  return out;
}

const safeAlign = (raw: unknown): string | undefined =>
  raw === "left" || raw === "center" || raw === "right" ? raw : undefined;

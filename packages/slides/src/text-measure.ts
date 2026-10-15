import {
  type RichDoc,
  type RichNode,
  type RunStyleAttrs,
  runStyleOf,
  type TextPreset,
  type TextStyle,
  type Theme,
} from "@tj/domain/documents";
import { ADVANCES } from "./font-metrics.generated";
import { FONT_STACKS, type FontKey } from "./fonts";
import type { MeasureInput, Measurer } from "./reflow";
import { floorBelow, type ResolvedText, resolveTextStyle } from "./text-style";
import { v2Profile } from "./theme-v2";
import { fontFloor } from "./themes";

/*
 * Line counts without a DOM, for the recipes that have to know how tall a text will be before
 * anything renders it (the `inset` image-text, TEACH-70). The editor's fitting engine measures in
 * the browser; this is its server-side twin, built on the advance widths of the same font files
 * (`font-metrics.generated.ts`). It ignores kerning, which almost only ever tightens a line, so
 * when it is wrong it is nearly always wrong by one line too many.
 */

/**
 * Checked against Chromium laying out random headings and bodies in all six themes (TEACH-70).
 * Ignoring kerning already errs wide, so no extra slack is taken: at the inset's 484-point column,
 * 3,600 samples gave 98-99% exact, the rest one line long, none short (at 556 points, 1 in 1,800
 * came out short). Every 1% of slack costs about 3% more headings with an empty line under them,
 * which is the gap the inset exists to avoid; a short count in a teacher's edit is caught by the
 * editor's own fitting engine.
 */
const WRAP_SLACK = 0;

const KEY_BY_STACK = new Map<string, FontKey>(
  Object.entries(FONT_STACKS).map(([key, stack]) => [stack, key as FontKey]),
);

function advancesFor(stack: string, weight: number): readonly number[] | undefined {
  const key = KEY_BY_STACK.get(stack);
  const table = key ? ADVANCES[key] : undefined;
  if (!table) return undefined;
  return weight >= 650 ? table[700] : weight >= 500 ? table[600] : table[400];
}

/** Width, in ems, of an unknown character: the widest capital, to stay on the safe side. */
const FALLBACK_EM = 1;

/**
 * The advance of one character in ems: the single place a character's width is read. Characters
 * outside printable ASCII have no table entry and count as `FALLBACK_EM`, which is why Arabic and
 * Hebrew lines over-count about 2x (RTL-ALL). The RTL fix (layout batch A7) replaces this
 * fallback with real metrics here; every count, line lookup and run rect follows.
 */
export function charAdvance(code: number, advances: readonly number[] | undefined): number {
  const adv = advances && code >= 32 && code <= 126 ? advances[code - 32] : undefined;
  return (adv === undefined ? FALLBACK_EM * 1000 : adv) / 1000;
}

function emWidth(word: string, advances: readonly number[] | undefined, tracking: number): number {
  let w = 0;
  for (const ch of word) w += charAdvance(ch.codePointAt(0) ?? 0, advances) + tracking;
  return w;
}

/** The resolved type a line count depends on. */
type LineType = Pick<ResolvedText, "fontFamily" | "fontWeight" | "fontSize" | "letterSpacing"> & {
  /** The stack a `font: "quote"` run is set in (the theme's quote face); body when absent. */
  quoteFamily?: string;
};

/** `/\s/` without the regex for ASCII, the hot case: space, tab and the other ASCII breaks. */
const isSpace = (code: number, ch: string): boolean =>
  code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(ch));

/** A run of text: set bold (a chunk's label) and/or in the quote face (`font: "quote"`). */
type Run = { text: string; bold?: boolean; quote?: boolean; attrs?: RunStyleAttrs };

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
function breakRuns(runs: readonly Run[], type: LineType, room: number, track = false): Broken {
  const regular = advancesFor(type.fontFamily, type.fontWeight);
  // The bold and quote tables only when a run needs them: most text has neither.
  const bold = runs.some((r) => r.bold)
    ? advancesFor(type.fontFamily, Math.max(700, type.fontWeight))
    : regular;
  const quoteFamily = type.quoteFamily ?? type.fontFamily;
  const quote = runs.some((r) => r.quote) ? advancesFor(quoteFamily, type.fontWeight) : regular;
  const quoteBold = runs.some((r) => r.quote && r.bold)
    ? advancesFor(quoteFamily, Math.max(700, type.fontWeight))
    : quote;
  const tracking = type.letterSpacing.endsWith("em") ? Number.parseFloat(type.letterSpacing) : 0;
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
    const advances = run.quote ? (run.bold ? quoteBold : quote) : run.bold ? bold : regular;
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

/** How many lines `text` takes in a column `room` points wide, set in `type`. */
function linesIn(text: string, type: LineType, room: number): number {
  return linesOfRuns([{ text }], type, room);
}

/** How many lines a paragraph's runs take in a column `room` points wide. */
function linesOfRuns(runs: readonly Run[], type: LineType, room: number): number {
  return breakRuns(runs, type, room).starts.length;
}

/**
 * How many lines `text` takes in a `preset` box `width` points wide, in `theme`. `weight`, when
 * given, overrides the preset's (a bold label is measured at 700); `fontSize` likewise (a text
 * stepped down one stop).
 */
export function countLines(
  text: string,
  preset: TextPreset,
  theme: Theme,
  width: number,
  weight?: number,
  fontSize?: number,
): number {
  const r = resolveTextStyle({ preset }, theme);
  const type = {
    ...r,
    ...(weight === undefined ? {} : { fontWeight: weight }),
    ...(fontSize === undefined ? {} : { fontSize }),
  };
  return linesIn(text, type, width - 2 * r.padding);
}

/**
 * How wide `text` is on one line in a `preset` box, in `theme`: a label's box, before any slack.
 * `weight`, when given, overrides the preset's.
 */
export function lineWidth(text: string, preset: TextPreset, theme: Theme, weight?: number): number {
  const r = resolveTextStyle({ preset }, theme);
  const tracking = r.letterSpacing.endsWith("em") ? Number.parseFloat(r.letterSpacing) : 0;
  const shown = r.textTransform === "uppercase" ? text.toUpperCase() : text;
  const advances = advancesFor(r.fontFamily, weight ?? r.fontWeight);
  return emWidth(shown, advances, tracking) * r.fontSize + 2 * r.padding;
}

/* ------------------------------------------------------------------ */
/* Line lookup and run rects (TEACH-205 part c, S-d2)                   */
/* ------------------------------------------------------------------ */

/** What a measurement may override: a bold label's weight, a stepped-down size, the quote face. */
export type MeasureOpts = { weight?: number; fontSize?: number; font?: "quote" };

/** The theme's quote face (its v2 age profile's; a v1 theme quotes in its body face). */
const quoteFamilyOf = (theme: Theme): string => v2Profile(theme).fonts.quote;

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
      if (!run.attrs || !pick(run.attrs) || !broken.places) continue;
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
          attrs: run.attrs,
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

/*
 * The headless ruler (TEACH-28): the `Measurer` the fitting engine (`./reflow.ts`) takes, built
 * on `linesIn` instead of the DOM, so `materialiseSlide` can fit a slide before anything renders
 * it. It follows `slide.css` for a rich doc: blocks and list items 0.35em apart, dot lists indented
 * 1.2em and numbered lists 1.45em. Line counts err one line long, never short (see `WRAP_SLACK`), so a box it sizes may
 * carry one empty line; the editor's DOM ruler tightens it the next time the slide is tidied.
 */

/**
 * `slide.css`: `.td-rt p, li, ul, ol { margin-bottom: 0.35em }`, `ul { padding-left: 1.2em }`,
 * `ol { padding-left: 1.45em }` (the number's disc and a clear gap before the words).
 */
const BLOCK_GAP_EM = 0.35;
const LIST_INDENT_EM = 1.2;
const ORDERED_INDENT_EM = 1.45;

/** A block's text as runs (bold, quote face, run attributes), a hard break as "\n". */
function runsOf(node: RichNode, bold = false): Run[] {
  const b = bold || !!node.marks?.some((m) => m.type === "bold");
  if (node.type === "text") {
    const attrs = runStyleOf(node);
    const run: Run = { text: node.text ?? "", bold: b };
    if (attrs.font === "quote") run.quote = true;
    if (Object.keys(attrs).length > 0) run.attrs = attrs;
    return [run];
  }
  if (node.type === "hardBreak") return [{ text: "\n" }];
  return (node.content ?? []).flatMap((n) => runsOf(n, b));
}

/** Line boxes and inter-block gaps of a doc's top-level blocks, in a column `room` wide. */
function blocksOf(
  nodes: RichNode[],
  type: LineType,
  room: number,
): { lines: number; gaps: number } {
  let lines = 0;
  let gaps = 0;
  nodes.forEach((node, i) => {
    if (i > 0) gaps += 1;
    if (node.type === "bulletList" || node.type === "orderedList") {
      const indent = node.type === "orderedList" ? ORDERED_INDENT_EM : LIST_INDENT_EM;
      const inner = room - indent * type.fontSize;
      const items = node.content ?? [];
      items.forEach((item, j) => {
        if (j > 0) gaps += 1;
        const nested = blocksOf(item.content ?? [], type, inner);
        lines += nested.lines;
        gaps += nested.gaps;
      });
      return;
    }
    lines += linesOfRuns(runsOf(node), type, room);
  });
  return { lines, gaps };
}

/** Height in points a rich doc needs in a box, chrome included: the fitting engine's `Measurer`. */
export const measureHeadless =
  (theme: Theme): Measurer =>
  (input: MeasureInput): number => {
    const r = resolveTextStyle(input.style, theme, input.preset, input.role);
    const fontSize = input.fontSize ?? r.fontSize;
    const type: LineType = { ...r, fontSize, quoteFamily: quoteFamilyOf(theme) };
    const upper = r.textTransform === "uppercase";
    const doc = upper ? upperDoc(input.doc) : input.doc;
    const { lines, gaps } = blocksOf(doc.content ?? [], type, input.width - input.inset);
    return lines * fontSize * r.lineHeight + gaps * BLOCK_GAP_EM * fontSize + input.chrome;
  };

function upperDoc(doc: RichDoc): RichDoc {
  const up = (node: RichNode): RichNode =>
    node.type === "text"
      ? { ...node, text: (node.text ?? "").toUpperCase() }
      : { ...node, content: node.content?.map(up) };
  return { ...doc, content: doc.content?.map(up) };
}

/**
 * Width a fitted box keeps spare. Measured in Chromium (Studio, 51pt): the ruler set "system today"
 * on one 300pt line that the browser broke, so a fit is measured 6% narrower than the box.
 */
const FIT_CUSHION = 0.94;

type FixedText = { doc: RichDoc; w: number; h: number; style?: Partial<TextStyle> };

/** How a fixed-height box fits: its stored size, its floor, and the height it needs at a size. */
function fitPlan(el: FixedText, theme: Theme) {
  const style = el.style ?? {};
  if (style.autoHeight !== false || style.autoFit === false) return undefined;
  const preset: TextPreset = style.preset ?? "body";
  const r = resolveTextStyle(style, theme, preset);
  const measure = measureHeadless(theme);
  const pad = 2 * r.padding;
  const need = (fontSize: number, width = el.w) =>
    measure({ doc: el.doc, width, style, preset, fontSize, inset: pad, chrome: pad });
  // Display type (a title, a subtitle) may come down to the heading's projector floor (26pt,
  // SPEC §7) rather than be cut: a smaller title is still read from the back of the room.
  const display = preset === "title" || preset === "subtitle";
  const floor = Math.min(
    r.fontSize,
    floorBelow(theme, preset),
    display ? fontFloor("heading") : Number.POSITIVE_INFINITY,
  );
  return { size: r.fontSize, floor, need };
}

/**
 * The size a fixed-height text box is drawn at so its words stay inside it, or `undefined` when
 * they already fit at the stored size. A box the generator sized exactly to its words (the title
 * slide's title stands on the foot of its box, `templates/index.ts`) has no room for one more line,
 * so a teacher's edit that adds a word ran out of the top of the box and the first line was cut off
 * (TEACH-75 part o). The type steps down 1pt at a time, never under the role's floor (`floorBelow`,
 * UX ruling 91; display type down to the heading's 26pt). Words that do not fit even at the floor
 * get a taller box from `growFixedText`. `autoFit: false` opts out, and an auto-height box grows
 * instead, so it is never fitted here. The renderer and the PPTX export both draw at this size.
 */
export function fittedFontSize(el: FixedText, theme: Theme): number | undefined {
  const plan = fitPlan(el, theme);
  if (!plan || plan.need(plan.size) <= el.h + 1) return undefined;
  for (let size = Math.floor(plan.size) - 1; size > plan.floor; size--) {
    if (plan.need(size, el.w * FIT_CUSHION) <= el.h) return size;
  }
  return plan.floor;
}

/** Top of the room a grown box may rise into, in slide points. */
const GROW_TOP = 24;

/**
 * Gives a fixed-height text box whose words do not fit even at the floor the height they need, so
 * nothing is clipped (TEACH-75 part o). A bottom-anchored box (the title) rises into the free room
 * above it first, down to `GROW_TOP`; the rest of the growth goes downward and pushes the elements
 * below it that share its column (the subtitle) down by the same amount. Boxes that fit, at their
 * own size or a fitted one, are returned as they are. Top-level elements only.
 */
export function growFixedText<
  E extends { type: string; x: number; y: number; w: number; h: number },
>(elements: readonly E[], theme: Theme): E[] {
  let out = elements as E[];
  for (let i = 0; i < out.length; i++) {
    const el = out[i] as E;
    if (el.type !== "text") continue;
    const text = el as unknown as E & FixedText;
    const plan = fitPlan(text, theme);
    if (!plan || fittedFontSize(text, theme) !== plan.floor) continue;
    const delta = Math.ceil(plan.need(plan.floor, el.w * FIT_CUSHION) - el.h);
    if (delta <= 0) continue;
    const bottom = text.style?.valign === "bottom" || text.style?.valign === "middle";
    const up = bottom ? Math.max(0, Math.min(delta, el.y - GROW_TOP)) : 0;
    const down = delta - up;
    const foot = el.y + el.h;
    out = out.map((o, j) => {
      if (j === i) return { ...o, y: o.y - up, h: o.h + delta };
      const below = o.y >= foot - 1 && o.x < el.x + el.w && o.x + o.w > el.x;
      return down > 0 && below ? { ...o, y: o.y + down } : o;
    });
  }
  return out;
}

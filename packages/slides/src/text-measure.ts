import type { RichDoc, RichNode, TextPreset, Theme } from "@tj/domain/documents";
import { ADVANCES } from "./font-metrics.generated";
import { FONT_STACKS, type FontKey } from "./fonts";
import type { MeasureInput, Measurer } from "./reflow";
import { type ResolvedText, resolveTextStyle } from "./text-style";

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

function emWidth(word: string, advances: readonly number[] | undefined, tracking: number): number {
  let w = 0;
  for (const ch of word) {
    const code = ch.codePointAt(0) ?? 0;
    const adv = advances && code >= 32 && code <= 126 ? advances[code - 32] : undefined;
    w += (adv === undefined ? FALLBACK_EM * 1000 : adv) / 1000 + tracking;
  }
  return w;
}

/** The resolved type a line count depends on. */
type LineType = Pick<ResolvedText, "fontFamily" | "fontWeight" | "fontSize" | "letterSpacing">;

/** `/\s/` without the regex for ASCII, the hot case: space, tab and the other ASCII breaks. */
const isSpace = (code: number, ch: string): boolean =>
  code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(ch));

/** A run of text and whether it is set bold (a chunk's label). */
type Run = { text: string; bold?: boolean };

/** How many lines `text` takes in a column `room` points wide, set in `type`. */
function linesIn(text: string, type: LineType, room: number): number {
  return linesOfRuns([{ text }], type, room);
}

/**
 * How many lines a paragraph's runs take in a column `room` points wide. A bold run is measured at
 * 700, as the renderer sets it: a chunk's bold label is wider than the same words at 400. A hard break ("\n") starts a new line.
 */
function linesOfRuns(runs: readonly Run[], type: LineType, room: number): number {
  const regular = advancesFor(type.fontFamily, type.fontWeight);
  // The bold table only when a run is bold: most text has none.
  const bold = runs.some((r) => r.bold)
    ? advancesFor(type.fontFamily, Math.max(700, type.fontWeight))
    : regular;
  const tracking = type.letterSpacing.endsWith("em") ? Number.parseFloat(type.letterSpacing) : 0;
  const ems = (room * (1 - WRAP_SLACK)) / type.fontSize;
  let lines = 1;
  let used = 0;
  let word = 0;
  let space = 0;
  const place = () => {
    if (word === 0) return;
    if (used === 0) used = word;
    else if (used + space + word <= ems) used += space + word;
    else {
      lines += 1;
      used = word;
    }
    // A word wider than the column breaks inside itself.
    while (used > ems) {
      lines += 1;
      used -= ems;
    }
    word = 0;
  };
  for (const run of runs) {
    const advances = run.bold ? bold : regular;
    const spaceWidth = emWidth(" ", advances, tracking);
    for (const ch of run.text) {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 10) {
        place();
        lines += 1;
        used = 0;
      } else if (isSpace(code, ch)) {
        place();
        space = spaceWidth;
      } else {
        const adv = advances && code >= 32 && code <= 126 ? advances[code - 32] : undefined;
        word += (adv === undefined ? FALLBACK_EM * 1000 : adv) / 1000 + tracking;
      }
    }
  }
  place();
  return Math.max(1, lines);
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

/** A block's text as runs, each bold or not, a hard break as "\n". */
function runsOf(node: RichNode, bold = false): Run[] {
  const b = bold || !!node.marks?.some((m) => m.type === "bold");
  if (node.type === "text") return [{ text: node.text ?? "", bold: b }];
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
    const type: LineType = { ...r, fontSize };
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

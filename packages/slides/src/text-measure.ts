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

/** How many lines `text` takes in a column `room` points wide, set in `type`. */
function linesIn(text: string, type: LineType, room: number): number {
  const advances = advancesFor(type.fontFamily, type.fontWeight);
  const tracking = type.letterSpacing.endsWith("em") ? Number.parseFloat(type.letterSpacing) : 0;
  const ems = (room * (1 - WRAP_SLACK)) / type.fontSize;
  const space = emWidth(" ", advances, tracking);
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    lines += 1;
    let used = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const w = emWidth(word, advances, tracking);
      if (used === 0) used = w;
      else if (used + space + w <= ems) used += space + w;
      else {
        lines += 1;
        used = w;
      }
      // A word wider than the column breaks inside itself.
      while (used > ems) {
        lines += 1;
        used -= ems;
      }
    }
  }
  return Math.max(1, lines);
}

/** How many lines `text` takes in a `preset` box `width` points wide, in `theme`. */
export function countLines(text: string, preset: TextPreset, theme: Theme, width: number): number {
  const r = resolveTextStyle({ preset }, theme);
  return linesIn(text, r, width - 2 * r.padding);
}

/*
 * The headless ruler (TEACH-28): the `Measurer` the fitting engine (`./reflow.ts`) takes, built
 * on `linesIn` instead of the DOM, so `materialiseSlide` can fit a slide before anything renders
 * it. It follows `slide.css` for a rich doc: blocks and list items 0.35em apart, lists indented
 * 1.2em. Line counts err one line long, never short (see `WRAP_SLACK`), so a box it sizes may
 * carry one empty line; the editor's DOM ruler tightens it the next time the slide is tidied.
 */

/** `slide.css`: `.td-rt p, li, ul, ol { margin-bottom: 0.35em }`, `ul, ol { padding-left: 1.2em }`. */
const BLOCK_GAP_EM = 0.35;
const LIST_INDENT_EM = 1.2;

function plainText(node: RichNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(plainText).join("");
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
      const inner = room - LIST_INDENT_EM * type.fontSize;
      const items = node.content ?? [];
      items.forEach((item, j) => {
        if (j > 0) gaps += 1;
        const nested = blocksOf(item.content ?? [], type, inner);
        lines += nested.lines;
        gaps += nested.gaps;
      });
      return;
    }
    lines += linesIn(plainText(node), type, room);
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

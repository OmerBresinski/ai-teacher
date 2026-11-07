/**
 * Where a slide's maths writes a fraction with a slash (`x/4 + 3 = 8`, `(x + 2)/3`, `3/4 of 20`),
 * so the renderer can set it stacked, numerator over a bar over denominator, the way a UK maths
 * textbook does. The writer keeps writing the slash and the document keeps it: this only finds the
 * ranges; `@tj/editor`'s `serialize.ts` draws them, the headless ruler (`text-measure.ts`) measures
 * them, and the editor (Tiptap) still shows and edits `x/4`.
 *
 * A side of the fraction is one atom: a number (`4`, `0.5`, `3x`), one letter (`x`, with `²`/`³`)
 * or a bracket of maths (`(x + 2)`). Multi-letter words never match, so `and/or`, `km/h`, `A/Bs`
 * stay as they are. A slash with a slash, a dot-letter or a colon beside it is a date or an
 * address (`2/9/1666`, `example.com/3`, `https://…`) and never matches.
 *
 * A match is stacked only when its text is certainly maths, one of:
 * - an operator beside it (`+ − × ÷ = < > ≤ ≥ ≠ ≈`, a spaced hyphen): `x/4 + 3 = 8`, `y = 20/4`;
 * - "of" after it: `3/4 of 20`;
 * - the whole paragraph is maths tokens and the fraction has a letter: a worked row's `x/4` cell.
 * Otherwise it stays a slash: `24/7`, `50/50`, `A/B testing`, `9/11`, `speed in m/s`.
 *
 * Units stay inline (`5 m/s`, `60 km/h`, `g/cm³`): a textbook prints a compound unit with a slash
 * or a negative index, never stacked. A letter fraction straight after a number is a unit.
 */

import type { TextPreset } from "@tj/domain/documents";

/*
 * How a stacked fraction is set (`@tj/editor` `slide.css` `.td-frac` draws these numbers; the
 * ruler measures them). Display type (a heading, a worked example's equations, which are set in
 * the heading preset) keeps the fraction inside its line: one line tall, the parts at 0.64 of the
 * line's size. Running text (body, small: a question, an answer) gives the fraction the room it
 * needs to be read from the back of a classroom: the parts at 0.8 of the line's size and the
 * fraction 1.6 em tall, so a line holding one is 1.6 em tall instead of its leading.
 */
/** The parts' size in the line's em: display type, running text. */
export const FRACTION_PART_EM = { compact: 0.64, tall: 0.8 } as const;
/** A running-text fraction's height in its line's em; a line holding one is at least this tall. */
export const FRACTION_TALL_EM = 1.6;
/** Each part's side padding, in the part's em. */
export const FRACTION_PAD_EM = 0.12;
/** The fraction's side margin, in the line's em. */
export const FRACTION_MARGIN_EM = 0.06;

/** Whether a preset's fractions are set tall (running text) rather than inside the line (display). */
export const fractionTall = (preset: TextPreset): boolean =>
  preset !== "title" && preset !== "subtitle" && preset !== "heading";

/** A stacked fraction's width in the line's em, from its two sides' widths at the line's size. */
export function fractionWidthEm(numEm: number, denEm: number, tall: boolean): number {
  const s = tall ? FRACTION_PART_EM.tall : FRACTION_PART_EM.compact;
  return Math.max(numEm, denEm) * s + 2 * FRACTION_PAD_EM * s + 2 * FRACTION_MARGIN_EM;
}

/** A side drawn without its brackets (`(x + 2)` stacks as x + 2): the shown range within it. */
export function shownSide(text: string, from: number, to: number): [number, number] {
  return to - from > 2 && text[from] === "(" && text[to - 1] === ")"
    ? [from + 1, to - 1]
    : [from, to];
}

export type FractionRange = {
  /** Index of the numerator's first character. */
  start: number;
  /** Index of the slash. */
  slash: number;
  /** Index one past the denominator's last character. */
  end: number;
};

const NUMBER = String.raw`\d+(?:\.\d+)?[a-zA-Z]?[²³]?`;
const LETTER = "[a-zA-Z][²³]?";
/** A bracket of maths only: digits, single letters, operators, spaces, no nested bracket or slash. */
const GROUP = String.raw`\((?:[\d.a-zA-Z²³+\-−×÷*^ ]){1,40}\)`;
const ATOM = `(?:${GROUP}|${NUMBER}|${LETTER})`;
/**
 * Before the numerator: not a letter, digit, dot, slash, colon or the like (a word, a decimal, a
 * path). After the denominator: not a letter, digit, slash, and no dot or colon leading into more.
 */
const FRACTION = new RegExp(
  String.raw`(?<![\p{L}\p{N}./:_@#&\\])(${ATOM})\/(${ATOM})(?![\p{L}\p{N}/_@]|[.:][\p{L}\p{N}])`,
  "gu",
);

const OPERATOR = /[+−×÷=<>≤≥≠≈]/;
/** A whole paragraph of maths: numbers, single letters, operators, brackets and fractions. */
const MATHS_TOKEN = /^[\p{N}a-zA-Z+\-−–×÷*/=<>≤≥≠≈().^²³√%,]+$/u;

const isMathsParagraph = (text: string): boolean => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => MATHS_TOKEN.test(w) && !/[a-zA-Z]{2,}/.test(w));
};

/** The operator beside `text[i]` going `dir` (-1 left, +1 right), skipping spaces. */
function operatorBeside(text: string, from: number, dir: -1 | 1): boolean {
  let i = from;
  let spaced = false;
  while (i >= 0 && i < text.length && text[i] === " ") {
    i += dir;
    spaced = true;
  }
  const c = text[i];
  if (c === undefined) return false;
  if (OPERATOR.test(c)) return true;
  // A hyphen is a minus only with a space on both sides ("x/4 - 3"), never "1/2-price".
  if (c === "-" && spaced) return text[i + dir] === " ";
  return false;
}

/** The fractions in `text` that are certainly maths, in order and not overlapping. */
export function findFractions(text: string): FractionRange[] {
  if (!text.includes("/")) return [];
  const out: FractionRange[] = [];
  let whole: boolean | undefined;
  const wholeMaths = () => {
    if (whole === undefined) whole = isMathsParagraph(text);
    return whole;
  };
  for (const m of text.matchAll(FRACTION)) {
    const num = m[1] ?? "";
    const den = m[2] ?? "";
    const start = m.index ?? 0;
    const slash = start + num.length;
    const end = slash + 1 + den.length;
    const letters = /[a-zA-Z]/.test(num + den);
    // A letter after a number is a unit ("5 m/s", "3 g/cm³"), never a fraction.
    if (/^[a-zA-Z]/.test(num) && /\d\s?$/.test(text.slice(0, start))) continue;
    const maths =
      operatorBeside(text, start - 1, -1) ||
      operatorBeside(text, end, 1) ||
      /^\s+of\s+[\p{N}a-zA-Z(]/u.test(text.slice(end)) ||
      (letters && wholeMaths());
    if (maths) out.push({ start, slash, end });
  }
  return out;
}

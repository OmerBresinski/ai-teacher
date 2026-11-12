/**
 * Where a slide's maths writes a fraction with a slash (`x/4 + 3 = 8`, `(x + 2)/3`, `3/4 of 20`),
 * so the renderer can set it stacked, numerator over a bar over denominator, the way a UK maths
 * textbook does. The writer keeps writing the slash and the document keeps it: this only finds the
 * ranges; `@tj/editor`'s `serialize.ts` draws them, the headless ruler (`text-measure.ts`) measures
 * them, and the editor (Tiptap) still shows and edits `x/4`.
 *
 * A side of the fraction is one atom: a number (`4`, `0.5`, `3x`), one letter (`x`, with `²`/`³`),
 * a bracket of maths (`(x + 2)`, `(distance travelled)`) or one word (`distance`, `Mr`, maths text
 * only, below). A slash with a slash, a dot-letter or a colon beside it is a date or an
 * address (`2/9/1666`, `example.com/3`, `https://…`) and never matches.
 *
 * A match is stacked only when its text is certainly maths, one of:
 * - an operator beside it (`+ − × ÷ = < > ≤ ≥ ≠ ≈`, a spaced hyphen): `x/4 + 3 = 8`, `y = 20/4`;
 * - "of" after it: `3/4 of 20`;
 * - a mixed number: a whole number of one to three digits, a space, then a proper number fraction
 *   (`10 1/2`, `6 4/5 m`, `= 7 1/2`). Not `24/7` or `50/50` (no whole number before them), not
 *   `3 24/7` (not a proper fraction), not `2001 9/11` (a year is not a whole part), not `5 m/s`;
 * - the whole paragraph is one proper number fraction, with at most a unit after it: a hinge
 *   option or an answer cell that reads `3/4` or `2/5 m` (v5.3-gold B6). `24/7` and `50/50` are
 *   not proper; a bare `9/11` would stack (accepted: an option is never only that date);
 * - the whole paragraph is maths tokens and the fraction has a letter: a worked row's `x/4` cell.
 * Otherwise it stays a slash: `24/7`, `50/50`, `A/B testing`, `9/11`, `speed in m/s`.
 *
 * Maths text (`{ maths: true }`: a text box whose job is maths, `maths-text.ts` `mathsElement`: a
 * worked example's equation cells, the equation slide's formula and steps) also stacks what the
 * rules above cannot vouch for: a bare `150/3` or `distance/time` in a worked row's right cell and
 * a word formula, `speed = distance/time`, `n = m/Mr`. Never a pair of units (`km/h`, `g/cm³`,
 * `J/kg`), a letter fraction after a number (`50 km/h`) or a prose pair (`and/or`, `true/false`).
 * Anywhere else a word side never stacks, so `colour = red/blue` and `and/or` stay as they are. A
 * longer word side takes brackets, which stack everywhere: `(distance travelled)/(time taken)`
 * (NOTATION-PLAN ticket 1).
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
/** A word side of a word formula (`distance`, `Mr`): stacked only in maths text. */
const WORD = "[a-zA-Z]{2,}[²³]?";
/** A bracket of maths only: digits, single letters, operators, spaces, no nested bracket or slash. */
const GROUP = String.raw`\((?:[\d.a-zA-Z²³+\-−×÷*^ ]){1,40}\)`;
const ATOM = `(?:${GROUP}|${NUMBER}|${WORD}|${LETTER})`;
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

const isWord = (side: string): boolean => /^[a-zA-Z]{2,}[²³]?$/.test(side);
/** Units: two of these either side of a slash are a compound unit (`km/h`, `g/cm³`), never stacked. */
const UNIT = new Set(
  "m s h g kg mg km cm mm dm m² m³ cm² cm³ dm³ mol l ml min hr N J kJ W kW kWh V A Pa kPa K C mph".split(
    " ",
  ),
);
/** Prose pairs written with a slash: never a word formula. */
const PROSE_PAIR = new Set(
  "and/or either/or yes/no true/false he/she his/her him/her s/he on/off in/out input/output pass/fail before/after male/female w/o n/a".split(
    " ",
  ),
);
/** The operator beside `text[i]` going `dir` (-1 left, +1 right), skipping spaces. */
function operatorBeside(text: string, from: number, dir: -1 | 1): boolean {
  let i = from;
  let spaced = false;
  // A space or a no-break space (`maths-text.ts` glues an operator to its term with one).
  while (i >= 0 && i < text.length && (text[i] === " " || text[i] === "\u00A0")) {
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

/** A mixed number's whole part straight before the fraction: `10 ` in `10 1/2`, `= 7 ` in `= 7 1/2`. */
/** A paragraph that is only a number fraction, a unit word after it at most (`3/4`, `2/5 m`). */
const BARE = /^\s*(\d{1,3})\/(\d{1,3})(?:\s+[a-zA-Z£]{1,3})?\s*[.?!]?\s*$/;

/** `text` is one proper fraction alone (`3/4`), never `24/7` or `50/50`. */
function bareProper(text: string): boolean {
  const m = BARE.exec(text);
  if (!m) return false;
  const n = Number(m[1]);
  const d = Number(m[2]);
  return n >= 1 && d >= 2 && n < d;
}

const MIXED_WHOLE = /(?:^|[^\p{L}\p{N}.,/:])\d{1,3}[ \u00A0]$/u;

/** `num/den` is the fraction of a mixed number: whole numbers, n ≤ d (a regrouped `7 3/3`), after a whole part. */
function mixedNumber(before: string, num: string, den: string): boolean {
  if (!/^\d+$/.test(num) || !/^\d+$/.test(den)) return false;
  const n = Number(num);
  const d = Number(den);
  return n >= 1 && d >= 2 && n <= d && MIXED_WHOLE.test(before);
}

/** Where the text sits: `maths` when its box is maths (a worked equation cell, a formula). */
export type FractionContext = { maths?: boolean };

/** The fractions in `text` that are certainly maths, in order and not overlapping. */
export function findFractions(text: string, context: FractionContext = {}): FractionRange[] {
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
      mixedNumber(text.slice(0, start), num, den) ||
      bareProper(text) ||
      (letters && wholeMaths());
    if (maths && !isWord(num) && !isWord(den)) out.push({ start, slash, end });
    else if (context.maths && !(UNIT.has(num) && UNIT.has(den))) {
      if (!PROSE_PAIR.has(`${num}/${den}`.toLowerCase())) out.push({ start, slash, end });
    }
  }
  return out;
}

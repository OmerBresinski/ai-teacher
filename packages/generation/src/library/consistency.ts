/**
 * A library drawing must say what its slide says (TEACH-247 part i). A model computes every number
 * it prints from its params, so a fill that left a number out (the model's default drew instead) or
 * chose the wrong case draws a true sum about the wrong amount: "Find one half of 16" drawn as
 * 4 ÷ 2 = 2, "Three fifths of 20" drawn as 5 × 4 = 20. Code compares the drawing's own text with
 * the slide's words; any disagreement sends the slide to the drawer.
 *
 * - Every number the slide's words use (digits, ⅗ or 3/5, and number words from "two" up, "half",
 *   "quarter", "fifths" …) must be printed somewhere on the drawing.
 * - Every number to the left of "=" in a drawn sum must be one the words use (the result is worked
 *   out by the model, so a question slide's hidden answer is allowed).
 * - Letters the words name as labels ("A, B and C") must be drawn.
 */
import { numbersIn } from "../writer/figure-sync";

/** Number words a slide uses for a number pupils must see. "one" is left out: "one half" says 2. */
const WORD_NUMBERS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  half: 2,
  halves: 2,
  third: 3,
  thirds: 3,
  quarter: 4,
  quarters: 4,
  fifth: 5,
  fifths: 5,
  sixth: 6,
  sixths: 6,
  seventh: 7,
  sevenths: 7,
  eighth: 8,
  eighths: 8,
  ninth: 9,
  ninths: 9,
  tenth: 10,
  tenths: 10,
};
const WORD_RE = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})\\b`, "gi");

/** The numbers some words use: digits and fractions (numbersIn) and number words. */
export function wordNumbers(text: string): number[] {
  const out = numbersIn(text);
  for (const m of text.matchAll(WORD_RE)) out.push(WORD_NUMBERS[m[1]?.toLowerCase() ?? ""] ?? 0);
  return out.filter((n) => n > 0);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(
          e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
        )
      : (ENTITIES[e.toLowerCase()] ?? m),
  );

/** Each `<text>` a drawn SVG prints, its tspans joined, entities decoded. */
export function drawnTexts(svg: string): string[] {
  const out: string[] = [];
  for (const m of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const t = decode((m[1] ?? "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (t) out.push(t);
  }
  return out;
}

const has = (xs: number[], v: number) => xs.some((x) => Math.abs(x - v) < 1e-9);

/** Labels the words name as a list of capital letters: "A, B and C", "A and B". */
function namedLetters(words: string): string[] {
  const m = /\b([A-H])((?:\s*,\s*[A-H]\b)*)\s*(?:,\s*)?(?:and|or)\s+([A-H])\b/.exec(words);
  if (!m) return [];
  return [m[1], ...(m[2] ?? "").split(",").map((s) => s.trim()), m[3]].filter(
    (s): s is string => !!s,
  );
}

/**
 * Why drawing `svg` disagrees with the slide's `words`, or undefined when it agrees. `svg` is the
 * full drawing (its last build), so a question slide's answer counts as drawn.
 */
export function drawingWordsMismatch(svg: string, words: string): string | undefined {
  const texts = drawnTexts(svg);
  const drawn = texts.flatMap((t) => numbersIn(t));
  const said = wordNumbers(words);
  const missing = [...new Set(said.filter((n) => !has(drawn, n)))];
  if (missing.length) return `the slide says ${missing.join(", ")}, which the drawing never shows`;
  // With no numbers in the words there is nothing for a sum to contradict.
  for (const t of said.length ? texts : []) {
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const stray = numbersIn(t.slice(0, eq)).filter((n) => !has(said, n));
    if (stray.length)
      return `the drawing works "${t}", but the slide never says ${stray.join(", ")}`;
  }
  const letters = namedLetters(words).filter((l) => !texts.some((t) => t === l));
  if (letters.length)
    return `the slide names ${letters.join(", ")}, which the drawing never labels`;
  return undefined;
}

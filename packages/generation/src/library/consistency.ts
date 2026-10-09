/**
 * A library drawing must not contradict the words that describe it (TEACH-247 part i): the slide's
 * heading and the model's caption, never the rest of the slide. A model computes every number it
 * prints from its params, so a fill that left a number out (the model's default drew instead) or
 * chose the wrong case draws a true sum about the wrong amount: "Find one half of 16" drawn as
 * 4 ÷ 2 = 2, "Three fifths of 20" drawn as 5 × 4 = 20. On a contradiction the drawer draws.
 *
 * Number models (`NUMBER_MODELS`) get the number checks; every model gets the label check.
 * - Each drawn sum ("a op b = c") is arithmetically right, and every number in it is one the words
 *   use or one worked from them in one step (16 ÷ 2 = 8, ⅗ of 20 = 12), so 8 + 8 = 16 is fine for
 *   "half of 16" and 4 ÷ 2 = 2 is not. Only a contradiction refuses, never an absence.
 * - A fraction the words name (⅗, 3/5, "three fifths", "a quarter") is drawn: its denominator, its
 *   numerator unless it is 1, or its decimal (0.3 for three tenths).
 * - Letters the words name as labels ("A, B and C") are drawn.
 * Numbers carry units: 20p is £0.20, 150 cm is 1.5 m; two numbers match when their values agree
 * and, if both carry a unit, the units are of one kind.
 */
import { numbersIn } from "../writer/figure-sync";

/** Models whose drawing is built from numbers the slide states: the number checks apply. */
export const NUMBER_MODELS = new Set([
  "counting_subitising",
  "number_bonds",
  "number_line",
  "place_value",
  "column_methods",
  "equal_groups",
  "balance_equations",
  "sequences_patterns",
  "fractions",
  "bar_model",
  "measuring_scales",
  "coins_money",
  "area_perimeter",
]);

/** A number with its unit kind ("£", "m", "kg", "l", "%", "°C"), the value in that kind's base. */
export type Q = { v: number; unit?: string };

const UNITS: Record<string, [string, number]> = {
  "£": ["£", 1],
  $: ["$", 1],
  "€": ["€", 1],
  p: ["£", 0.01],
  mm: ["m", 0.001],
  cm: ["m", 0.01],
  m: ["m", 1],
  km: ["m", 1000],
  g: ["kg", 0.001],
  kg: ["kg", 1],
  ml: ["l", 0.001],
  l: ["l", 1],
  "%": ["%", 1],
  "°C": ["°C", 1],
};

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
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
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const DENOMS: Record<string, number> = {
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
  hundredth: 100,
  hundredths: 100,
};
const NUM_WORD = `(?:${[...Object.keys(ONES), "hundred", "thousand"].join("|")})`;
/** "twenty-five", "two hundred and five", "one": a run of number words. */
const WORD_RUN = new RegExp(`\\b${NUM_WORD}(?:(?:[\\s-]+(?:and[\\s-]+)?)${NUM_WORD})*\\b`, "gi");
const FRACTION_WORDS = new RegExp(
  `\\b(?:(a|an|${NUM_WORD}(?:-${NUM_WORD})?)\\s+)?(${Object.keys(DENOMS).join("|")})\\b`,
  "gi",
);

/** The value of a run of number words ("twenty-five" 25, "two hundred and five" 205). */
export function wordValue(run: string): number | undefined {
  let total = 0;
  let cur = 0;
  let any = false;
  for (const w of run.toLowerCase().split(/[\s-]+/)) {
    if (w === "and" || !w) continue;
    if (w === "hundred") cur = (cur || 1) * 100;
    else if (w === "thousand") {
      total += (cur || 1) * 1000;
      cur = 0;
    } else if (w in ONES) cur += ONES[w] as number;
    else return undefined;
    any = true;
  }
  return any ? total + cur : undefined;
}

/** Every number in some words, with its unit: digits (£1.20, 20p, 150 cm, 3.5) and number words. */
export function quantities(text: string): Q[] {
  const out: Q[] = [];
  const re =
    /([£$€])?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(p|mm|cm|km|m|kg|g|ml|l|%|°C|st|nd|rd|th)?(?![A-Za-z0-9])/g;
  for (const m of text.matchAll(re)) {
    const n = Number((m[2] as string).replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const u = m[1] ?? (["st", "nd", "rd", "th"].includes(m[3] ?? "") ? undefined : m[3]);
    const k = u ? UNITS[u] : undefined;
    out.push(k ? { v: n * k[1], unit: k[0] } : { v: n });
  }
  for (const m of text.matchAll(WORD_RUN)) {
    const v = wordValue(m[0]);
    if (v !== undefined) out.push({ v });
  }
  // the parts of ⅗ and 3/5 (numbersIn reads vulgar fractions)
  for (const v of numbersIn(text.replace(/\d[\d,.]*/g, " "))) out.push({ v });
  return out;
}

/** Every fraction some words name: 3/5, ⅗, "three fifths", "a quarter", "half". */
export function fractionsNamed(text: string): { n: number; d: number }[] {
  const out: { n: number; d: number }[] = [];
  for (const m of text.matchAll(/(?<![\d.])(\d+)\s*\/\s*(\d+)(?![\d.])/g))
    out.push({ n: Number(m[1]), d: Number(m[2]) });
  const vulgar = numbersIn(text.replace(/\d[\d,./]*/g, " "));
  for (let i = 0; i + 1 < vulgar.length; i += 2)
    out.push({ n: vulgar[i] as number, d: vulgar[i + 1] as number });
  for (const m of text.matchAll(FRACTION_WORDS)) {
    const d = DENOMS[(m[2] as string).toLowerCase()] as number;
    const lead = (m[1] ?? "").toLowerCase();
    const n = !lead || lead === "a" || lead === "an" ? 1 : wordValue(lead);
    // "half" alone, "a half", "one half", "three fifths"; "the third group" is not a fraction
    if (n !== undefined && (lead || d === 2)) out.push({ n, d });
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a));
const same = (a: Q, b: Q) => close(a.v, b.v) && (!a.unit || !b.unit || a.unit === b.unit);
const inSet = (q: Q, set: Q[]) => set.some((s) => same(q, s));

/** The words' numbers and every number worked from two of them in one step. */
export function derivable(words: string): Q[] {
  const fr = fractionsNamed(words);
  const base: Q[] = [...quantities(words)];
  for (const f of fr) base.push({ v: f.n }, { v: f.d });
  const uniq: Q[] = [];
  for (const q of base) if (!uniq.some((u) => close(u.v, q.v) && u.unit === q.unit)) uniq.push(q);
  const out = [...uniq];
  for (const a of uniq)
    for (const b of uniq) {
      if (a === b) continue;
      const unit = a.unit && b.unit ? (a.unit === b.unit ? a.unit : undefined) : (a.unit ?? b.unit);
      if (a.unit && b.unit && a.unit !== b.unit) continue;
      out.push({ v: a.v + b.v, unit }, { v: a.v - b.v, unit });
      if (!(a.unit && b.unit)) out.push({ v: a.v * b.v, unit });
      if (b.v !== 0) out.push(a.unit && b.unit ? { v: a.v / b.v } : { v: a.v / b.v, unit });
    }
  // a fraction's value (0.5, 0.3) is known, but never a step to build others from
  for (const f of fr) out.push({ v: f.n / f.d });
  for (const f of fr)
    for (const N of uniq) if (f.d) out.push({ ...N, v: (N.v * f.n) / f.d }, { ...N, v: N.v / f.d });
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(
          e[1]?.toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
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

const OPS: Record<string, string> = {
  "×": "*",
  x: "*",
  "*": "*",
  "÷": "/",
  "/": "/",
  "+": "+",
  "−": "-",
  "-": "-",
  "–": "-",
};
const TOKEN =
  /\s*(?:([£$€]?\s*\d[\d,]*(?:\.\d+)?\s*(?:p|mm|cm|km|m|kg|g|ml|l|%|°C)?(?![A-Za-z0-9]))|([×x*÷/+−\-–]))/y;

/** One side of a drawn sum as numbers and operators, or undefined if it is not plain arithmetic. */
function tokens(side: string): { nums: Q[]; ops: string[] } | undefined {
  const nums: Q[] = [];
  const ops: string[] = [];
  const s = side.trim();
  TOKEN.lastIndex = 0;
  let expectNum = true;
  while (TOKEN.lastIndex < s.length) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(s);
    if (!m || m.index !== at) return undefined;
    if (m[1] && expectNum) {
      const q = quantities(m[1])[0];
      if (!q) return undefined;
      nums.push(q);
      expectNum = false;
    } else if (m[2] && !expectNum) {
      ops.push(OPS[m[2]] as string);
      expectNum = true;
    } else return undefined;
    if (!s.slice(TOKEN.lastIndex).trim()) break;
  }
  return nums.length && nums.length === ops.length + 1 ? { nums, ops } : undefined;
}

/** The value of numbers and operators, × and ÷ before + and −. */
function evaluate(nums: Q[], ops: string[]): number {
  const terms: number[] = [nums[0]?.v as number];
  const signs: string[] = [];
  for (const [i, op] of ops.entries()) {
    const n = nums[i + 1]?.v as number;
    if (op === "*") terms[terms.length - 1] = (terms.at(-1) as number) * n;
    else if (op === "/") terms[terms.length - 1] = (terms.at(-1) as number) / n;
    else {
      signs.push(op);
      terms.push(n);
    }
  }
  return terms.reduce((acc, t, i) => (i === 0 ? t : signs[i - 1] === "+" ? acc + t : acc - t), 0);
}

/** Labels the words name as a list of capital letters: "A, B and C", "A and B". */
function namedLetters(words: string): string[] {
  const m = /\b([A-H])((?:\s*,\s*[A-H]\b)*)\s*(?:,\s*)?(?:and|or)\s+([A-H])\b/.exec(words);
  if (!m) return [];
  return [m[1], ...(m[2] ?? "").split(","), m[3]]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
}

/**
 * Why model `id`'s drawing `svg` contradicts `about` (the slide's heading and the model's caption),
 * or undefined when it does not. `svg` is the full drawing, a question slide's answer included.
 */
export function drawingWordsMismatch(id: string, svg: string, about: string): string | undefined {
  const texts = drawnTexts(svg);
  const letters = namedLetters(about).filter((l) => !texts.includes(l));
  if (letters.length) return `the words name ${letters.join(", ")}, which the drawing never labels`;
  if (!NUMBER_MODELS.has(id)) return undefined;
  const drawn = texts.flatMap((t) => quantities(t));
  for (const f of fractionsNamed(about)) {
    const shown =
      (inSet({ v: f.d }, drawn) && (f.n === 1 || inSet({ v: f.n }, drawn))) ||
      inSet({ v: f.n / f.d }, drawn);
    if (!shown) return `the words name ${f.n}/${f.d}, which the drawing never shows`;
  }
  // A fraction of an amount ("one half of 16", "3/5 of £40") fixes the whole the drawing is about:
  // the whole is drawn, and every number in a drawn sum follows from the words.
  const wholes = fractionsNamed(about).length
    ? [
        ...about.matchAll(
          /\bof\s+([£$€]?\s*\d[\d,]*(?:\.\d+)?\s*(?:p|mm|cm|km|m|kg|g|ml|l)?)(?![A-Za-z0-9])/g,
        ),
      ].flatMap((m) => quantities(m[1] as string).slice(0, 1))
    : [];
  for (const w of wholes)
    if (!inSet(w, drawn))
      return `the words take a fraction of ${w.v}, which the drawing never shows`;
  const known = wholes.length ? derivable(about) : undefined;
  for (const t of texts) {
    const sides = t.split("=");
    if (sides.length < 2) continue;
    const parsed = sides.map(tokens);
    const left = parsed[0];
    const value = left ? evaluate(left.nums, left.ops) : undefined;
    for (const [i, p] of parsed.entries()) {
      // every side that is plain arithmetic must come to the same value: 23 × 14 = 200 + … = 322
      if (i > 0 && p && value !== undefined && !close(value, evaluate(p.nums, p.ops)))
        return `the drawing's sum "${t}" is wrong`;
      if (!known) continue;
      for (const q of p?.nums ?? quantities(sides[i] as string))
        if (!inSet(q, known) && !(value !== undefined && close(value, q.v)))
          return `the drawing works "${t}", but the words make ${q.v} neither given nor worked out`;
    }
  }
  return undefined;
}

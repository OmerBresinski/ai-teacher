/**
 * Round G quality gates that code can decide: arithmetic recomputed, a tested term taught on a
 * slide, and a photo's caption against what the photo's own source says it shows. Each returns the
 * field to write again and why; the caller re-asks once, then falls back (plan-write.ts).
 */

import { FIXED_SLIDES } from "./check";
import type { Written } from "./fit";
import { fieldOfEvidence, type PassSlide } from "./slide-check";

const textOf = (v: unknown): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v.map(textOf).join(" ")
      : v && typeof v === "object"
        ? Object.values(v).map(textOf).join(" ")
        : "";

/* ------------------------------------------------------------------ arithmetic */

const UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Number words (to ninety-nine, and "a hundred") as digits, so "three × five = fifteen" checks. */
function digits(s: string): string {
  return s
    .replace(
      new RegExp(
        `\\b(${TENS.slice(2).join("|")})(?:[- ](${UNITS.slice(1, 10).join("|")}))?\\b`,
        "gi",
      ),
      (_, t: string, u?: string) =>
        String(TENS.indexOf(t.toLowerCase()) * 10 + (u ? UNITS.indexOf(u.toLowerCase()) : 0)),
    )
    .replace(new RegExp(`\\b(${UNITS.join("|")})\\b`, "gi"), (w: string) =>
      String(UNITS.indexOf(w.toLowerCase())),
    )
    .replace(/\b(?:a|one) hundred\b/gi, "100");
}

/** A small expression (+ − × ÷, brackets) evaluated, or undefined when it is not one. */
function evaluate(src: string): number | undefined {
  const toks = src.match(/\d+(?:\.\d+)?|[-+*/()]/g);
  if (!toks || toks.join("") !== src.replace(/\s+/g, "")) return undefined;
  let i = 0;
  const peek = () => toks[i];
  const atom = (): number | undefined => {
    const t = toks[i++];
    if (t === "(") {
      const v = sum();
      if (toks[i++] !== ")") return undefined;
      return v;
    }
    if (t === "-") {
      const v = atom();
      return v === undefined ? undefined : -v;
    }
    return t !== undefined && /^\d/.test(t) ? Number(t) : undefined;
  };
  const product = (): number | undefined => {
    let v = atom();
    while (v !== undefined && (peek() === "*" || peek() === "/")) {
      const op = toks[i++];
      const r = atom();
      if (r === undefined) return undefined;
      v = op === "*" ? v * r : r === 0 ? undefined : v / r;
    }
    return v;
  };
  const sum = (): number | undefined => {
    let v = product();
    while (v !== undefined && (peek() === "+" || peek() === "-")) {
      const op = toks[i++];
      const r = product();
      if (r === undefined) return undefined;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return i === toks.length ? v : undefined;
}

/** The text with operators made plain: × x * as *, ÷ as /, the dashes between numbers as minus. */
function plainMaths(s: string): string {
  return digits(s)
    .replace(/[£$€°]/g, "")
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(/(\d)\s*[×xX*]\s*(?=[\d(])/g, "$1 * ")
    .replace(/÷/g, "/")
    .replace(/(\d)\s*[−–]\s*(?=\d)/g, "$1 - ")
    .replace(/[−–]/g, "-");
}

/**
 * Every stated calculation in `text` that does not hold: "a op b = c" chains (each side
 * recomputed), and ratio equalities ("2:3 = 4:6"). Text, units and percentages are left alone.
 */
export function wrongSums(text: string): string[] {
  const out: string[] = [];
  const t = plainMaths(text);
  // A run of numbers, operators, brackets, colons and "=", with at least one "=".
  for (const m of t.matchAll(/[\d(][\d\s.+\-*/():]*=[\d\s.+\-*/():=]*[\d)]/g)) {
    const run = m[0];
    const at = m.index ?? 0;
    if (t[at + run.length] === "%" || /%/.test(run)) continue;
    // A decimal point at the run's end is a sentence's full stop.
    const parts = run.split("=").map((p) => p.trim().replace(/\.$/, ""));
    if (parts.some((p) => p === "")) continue;
    if (parts.every((p) => /^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/.test(p))) {
      const r = parts.map((p) => p.split(":").map((x) => Number(x.trim())) as [number, number]);
      const [a, b] = r[0] as [number, number];
      if (r.some(([c, d]) => Math.abs(a * d - b * c) > 1e-9)) out.push(run.trim());
      continue;
    }
    if (parts.some((p) => p.includes(":"))) continue;
    if (!parts.some((p) => /[-+*/]/.test(p.replace(/^-/, "")))) continue;
    const vals = parts.map(evaluate);
    if (vals.some((v) => v === undefined)) continue;
    const first = vals[0] as number;
    if (vals.some((v) => Math.abs((v as number) - first) > 1e-6 * Math.max(1, Math.abs(first))))
      out.push(run.trim());
  }
  return out;
}

/**
 * `text` with each wrong "a op b = c" put right in place: c becomes the recomputed result when c
 * appears just once in the text, so nothing else leans on it. A result rounded to the decimals it
 * shows is not wrong. The sums that cannot be put right that way (a chain, a ratio, a result used
 * again, a number in words) are named in `unfixed` with their true result.
 */
export function recomputeSums(text: string): { text: string; fixed: number; unfixed: string[] } {
  let out = text;
  let fixed = 0;
  const unfixed: string[] = [];
  for (const run of wrongSums(text)) {
    const parts = run.split("=").map((p) => p.trim().replace(/\.$/, ""));
    const value = parts.length === 2 ? evaluate(parts[0] ?? "") : undefined;
    const stated = parts[1] ?? "";
    if (value === undefined || !/^\d+(?:\.\d+)?$/.test(stated)) {
      unfixed.push(run);
      continue;
    }
    const decimals = (stated.split(".")[1] ?? "").length;
    if (decimals > 0 && Math.abs(value - Number(stated)) <= 0.5 * 10 ** -decimals + 1e-9) continue;
    const shown = Number.isInteger(Number(value.toFixed(6)))
      ? String(Math.round(value))
      : String(Number(value.toFixed(Math.max(decimals, 2))));
    const at = new RegExp(`(?<![\\d.])${stated.replace(".", "\\.")}(?!\\d|\\.\\d)`, "g");
    if ((out.match(at) ?? []).length === 1) {
      out = out.replace(at, shown);
      fixed += 1;
    } else unfixed.push(`${parts[0]} = ${shown}, not ${stated}`);
  }
  return { text: out, fixed, unfixed };
}

/** The fields of a written slide whose stated arithmetic does not hold, with the sums named. */
export function arithmeticFaults(out: Written): { field: string; failure: string }[] {
  const faults: { field: string; failure: string }[] = [];
  for (const [field, v] of Object.entries(out)) {
    if (field === "diagram" || field === "imageBrief") continue;
    const wrong = wrongSums(textOf(v));
    if (wrong.length > 0) {
      faults.push({
        field,
        failure: `these calculations do not hold when worked out: ${wrong.map((w) => `"${w}"`).join(", ")}. Work each one out again and give the right result, and change any answer or reasoning that depends on it`,
      });
    }
  }
  return faults;
}

/* ------------------------------------------------------------------ taught on a slide */

// Round S: four-letter words count (S1 y5: a plan key's only content word had four letters, so
// questions on it were never checked); the common four-letter words are stopped instead.
const STOP = new Set(
  "the and for with that this from into their what when where which each they them than then does have more most some your will only also make show give take".split(
    " ",
  ),
);
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4 && !STOP.has(w));
/** Singular and plural, -ing and -ed forms meet at one stem. */
const stem = (w: string) => w.replace(/(?:ies|es|s|ing|ed)$/, "").slice(0, 8);

const TESTING = new Set([
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "check-set",
  "exit-ticket",
  // A discussion poses a question too (S1 y5: a teach slide whose writer failed was drawn as a
  // discussion of its purpose, a bare question on a term no slide had taught).
  "discussion",
]);

/**
 * A practice or check slide that asks about a term the lesson's plan names (its teaches and tests
 * keys) which no earlier slide shows on the slide itself, only in notes or nowhere (F1b y5: the
 * estuary, taught only in a slide's notes, then asked in practice). Per slide: the field that
 * holds the term and the terms. Only a slide that teaches counts as showing a term: a question
 * slide naming it has not taught it (round S, S1 y5: a bare discussion prompt counted as teaching
 * the term two later practice items asked about).
 */
export function untaughtTerms(
  slides: readonly PassSlide[],
  /** lab/cand-fix: the lesson's key terms (stream header), keys as much as the plan's. */
  keyTerms: readonly string[] = [],
): { number: number; field: string; terms: string[] }[] {
  const ordered = [...slides].sort((a, b) => a.number - b.number);
  const keys = new Set(
    [...ordered.flatMap((s) => [...s.row.teaches, ...s.row.tests]), ...keyTerms].flatMap((k) =>
      wordsOf(k.replace(/-/g, " ")),
    ),
  );
  const keyStems = new Map([...keys].map((k) => [stem(k), k]));
  const shown = new Set<string>();
  const out: { number: number; field: string; terms: string[] }[] = [];
  for (const s of ordered) {
    if (s.number <= FIXED_SLIDES) continue;
    const asks =
      (TESTING.has(s.row.form) || s.row.role === "practise") &&
      s.row.form !== "starter-set" &&
      s.row.role !== "retrieve";
    if (asks) {
      const byField = new Map<string, string[]>();
      for (const [field, v] of Object.entries(s.out)) {
        if (field === "notes" || field === "diagram" || field === "imageBrief") continue;
        for (const w of wordsOf(textOf(v))) {
          const k = keyStems.get(stem(w));
          if (!k || shown.has(stem(w))) continue;
          const list = byField.get(field) ?? [];
          if (!list.includes(w)) byField.set(field, [...list, w]);
        }
      }
      for (const [field, terms] of byField) out.push({ number: s.number, field, terms });
    }
    // What a teaching slide shows (not its notes) counts as taught for every later slide.
    if (asks) continue;
    const { notes: _n, imageBrief: _i, ...onSlide } = s.out;
    for (const w of wordsOf(textOf(onSlide))) shown.add(stem(w));
  }
  return out;
}

/**
 * The exit ticket's questions checked the same way, after every slide: per question that asks
 * about a planned term no teaching slide shows, its index and the terms.
 */
export function untaughtOnExit(
  slides: readonly PassSlide[],
  questions: readonly string[],
): { item: number; terms: string[] }[] {
  const after = Math.max(FIXED_SLIDES, ...slides.map((s) => s.number)) + 1;
  const keys = [...new Set(slides.flatMap((s) => [...s.row.teaches, ...s.row.tests]))];
  return questions.flatMap((question, item) => {
    const exit = {
      number: after,
      row: {
        ...(slides[0]?.row as PassSlide["row"]),
        form: "exit-ticket",
        role: "check",
        teaches: [],
        tests: keys,
      },
      out: { question },
    } as PassSlide;
    const terms = untaughtTerms([...slides, exit])
      .filter((u) => u.number === after)
      .flatMap((u) => u.terms);
    return terms.length > 0 ? [{ item, terms }] : [];
  });
}

/* ------------------------------------------------------------------ photo caption */

/**
 * Proper names in `text` (a capitalised word not opening a sentence or a label) that the photo's
 * own source does not name, leaving out names the lesson as a whole carries (`exempt`, the topic
 * and title: "Roman", "Britain"). Empty when the text names only what the photo shows (F1a y4: a
 * Pompeii street captioned "At Vindolanda", an El Jem mosaic captioned "At Fishbourne").
 */
export function namesNotShown(text: string, about: string, exempt: string): string[] {
  const near = (w: string, pool: string) => {
    const k = w.toLowerCase().slice(0, 5);
    return pool
      .toLowerCase()
      .split(/[^a-z]+/)
      .some((p) => p.length >= 3 && p.slice(0, 5) === k);
  };
  const names: string[] = [];
  for (const m of text.matchAll(/(^|[.!?:;]\s+|\s)([A-Z][a-z]+(?:['’]s)?)/g)) {
    const opener = m[1] !== " " && m[1] !== undefined && m[1].trim() !== "";
    if (opener || (m.index ?? 0) === 0) continue;
    const w = (m[2] ?? "").replace(/['’]s$/, "");
    if (w.length < 3 || near(w, exempt) || near(w, about) || names.includes(w)) continue;
    names.push(w);
  }
  return names;
}

/* ------------------------------------------------------------------ caption claims (round J) */

/** One claim a photo slide's text makes about its photograph, as the caption-claims check gave it. */
export type CaptionClaim = { slide: number; quote: string; supported: boolean; why: string };

const claimWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
    .join(" ");

/**
 * The claims the check could not support, each on the field (heading or body; never the notes)
 * whose text carries its quote, one per slide and field. A quote the slide does not carry is
 * dropped: the check must point at words that are there.
 */
export function unsupportedClaims(
  claims: CaptionClaim[],
  outOf: (slide: number) => Written | undefined,
): { slide: number; field: string; quote: string; why: string }[] {
  const found: { slide: number; field: string; quote: string; why: string }[] = [];
  for (const c of claims) {
    const out = outOf(c.slide);
    if (c.supported || !out || claimWords(c.quote).split(" ").length < 3) continue;
    const field = fieldOfEvidence(out, c.quote);
    if (!field || field === "notes") continue;
    const had = found.find((f) => f.slide === c.slide && f.field === field);
    if (had) {
      had.quote = `${had.quote}" and "${c.quote}`;
      had.why = `${had.why} ${c.why}`;
    } else found.push({ slide: c.slide, field, quote: c.quote, why: c.why });
  }
  return found;
}

/** Does `out[field]` still carry the claim's words? */
export function carriesClaim(out: Written, field: string, quote: string): boolean {
  const have = ` ${claimWords(textOf(out[field]))} `;
  return quote
    .split('" and "')
    .some((q) => claimWords(q) !== "" && have.includes(` ${claimWords(q)} `));
}

/**
 * The safe fallback when a re-write does not take an unsupported claim out: the sentences that carry
 * it are removed from the body, so the caption names only what the photograph shows. Undefined when
 * that would leave a chunk with no text after its label, or the claim is in the heading.
 */
export function withoutClaim(out: Written, field: string, quote: string): Written | undefined {
  const v = out[field];
  if (field === "heading" || !Array.isArray(v)) return undefined;
  let removed = false;
  const strip = (t: string): string | undefined => {
    const label = /^([^:]{1,40}:)\s*/.exec(t);
    const body = label ? t.slice(label[0].length) : t;
    const sentences = body.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((x) => !carriesClaim({ x }, "x", quote));
    if (kept.length === sentences.length) return t;
    removed = true;
    if (kept.length === 0) return undefined;
    return `${label ? `${label[1]} ` : ""}${kept.join(" ")}`;
  };
  const next: unknown[] = [];
  for (const item of v) {
    if (typeof item !== "string") {
      next.push(item);
      continue;
    }
    const t = strip(item);
    if (t === undefined) return undefined;
    next.push(t);
  }
  return removed ? { ...out, [field]: next } : undefined;
}

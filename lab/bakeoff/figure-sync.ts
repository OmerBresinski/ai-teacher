/**
 * A figure must say what its slide says (chalkie-gap Y5-B, b3-r2-1 y5 s7: the repair rewrote
 * "Find ⅗ of 20" to "Find ⅗ of 30 … = 18" and the bar kept its whole of 20).
 *
 * - `figureTextMismatch` reads the numbers a maths figure draws (a bar model's whole, a
 *   fraction-of-an-amount bar's parts, equal groups' total) and the numbers the slide's own words
 *   use, and names the first figure number the words never say.
 * - `rederiveFigure` rebuilds a bar model from the slide's words when they state exactly one
 *   "n/d of N" (the drawing then cannot disagree with the formula).
 * - `syncFigure` is what a repair applies to the slide it rewrites: the figure is kept when it
 *   still agrees, redrawn from the words when it can be, and dropped otherwise. Never stale.
 */

type J = Record<string, unknown>;

const VULGAR: Record<string, [number, number]> = {
  "¼": [1, 4],
  "½": [1, 2],
  "¾": [3, 4],
  "⅐": [1, 7],
  "⅑": [1, 9],
  "⅒": [1, 10],
  "⅓": [1, 3],
  "⅔": [2, 3],
  "⅕": [1, 5],
  "⅖": [2, 5],
  "⅗": [3, 5],
  "⅘": [4, 5],
  "⅙": [1, 6],
  "⅚": [5, 6],
  "⅛": [1, 8],
  "⅜": [3, 8],
  "⅝": [5, 8],
  "⅞": [7, 8],
};
const VULGAR_RE = new RegExp(`[${Object.keys(VULGAR).join("")}]`, "g");
const FIGURE_KEYS = new Set(["figure", "diagram", "picture"]);

/** Every string on the slide except its figures (the words pupils read). */
export function slideWords(slide: J | undefined): string {
  const out: string[] = [];
  const walk = (v: unknown, key = "") => {
    if (FIGURE_KEYS.has(key)) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as J)) walk(x, k);
  };
  walk(slide ?? {});
  return out.join("\n");
}

/** The numbers written in some words: digits (1,200, 2.5, £30) and the parts of ⅗ or 3/5. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(VULGAR_RE)) out.push(...(VULGAR[m[0]] as [number, number]));
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Every "n/d of N" in some words (⅗ of 30, 3/5 of £30, three fifths written as ⅗). */
export function fractionsOf(text: string): { n: number; d: number; N: number }[] {
  const out: { n: number; d: number; N: number }[] = [];
  const re = new RegExp(
    `(?:(\\d+)\\s*[/⁄]\\s*(\\d+)|(${VULGAR_RE.source}))\\s+of\\s+[£$€]?\\s*(\\d[\\d,]*(?:\\.\\d+)?)`,
    "g",
  );
  for (const m of text.matchAll(re)) {
    const [n, d] = m[3] ? (VULGAR[m[3]] as [number, number]) : [Number(m[1]), Number(m[2])];
    out.push({ n, d, N: Number((m[4] as string).replace(/,/g, "")) });
  }
  return out;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const leading = (v: unknown): number | undefined => {
  const m = typeof v === "string" ? /^\s*[£$€]?\s*(\d[\d,]*(?:\.\d+)?)/.exec(v) : null;
  return m ? Number((m[1] as string).replace(/,/g, "")) : undefined;
};

/** The figure's spec as drawn: the writer's form, the drawer's form, or a library model's params. */
type Drawn = { whole: number; parts?: number; shaded?: number }[];
export function figureAmounts(spec: unknown): { kind: string; bars: Drawn } | undefined {
  if (!spec || typeof spec !== "object") return undefined;
  const s = spec as J;
  // library model (lib arm): bar_model's params
  const lib = (s.libDrawn as J | undefined) ?? s;
  if (lib.model === "bar_model" && lib.params && typeof lib.params === "object") {
    const p = lib.params as J;
    const f = (p.fraction ?? {}) as J;
    const W = num(p.amount);
    if (p.type === "fraction" && W !== undefined)
      return { kind: "bar-model", bars: [{ whole: W, parts: num(f.d), shaded: num(f.n) }] };
    return undefined;
  }
  if (s.kind === "bar-model" && Array.isArray(s.bars)) {
    const bars: Drawn = [];
    for (const b of s.bars as J[]) {
      // writer form (meaning.ts): whole + parts (a count) + shaded
      const W = num(b.whole);
      if (W !== undefined) {
        bars.push({
          whole: W,
          ...(num(b.parts) !== undefined ? { parts: num(b.parts) } : {}),
          ...(num(b.shaded) !== undefined ? { shaded: num(b.shaded) } : {}),
        });
        continue;
      }
      // drawer form (schema.ts): total label + a parts array
      const T = leading(b.total);
      if (T !== undefined)
        bars.push({ whole: T, ...(Array.isArray(b.parts) ? { parts: b.parts.length } : {}) });
    }
    return bars.length ? { kind: "bar-model", bars } : undefined;
  }
  if (s.kind === "equal-groups") {
    const g = num(s.groups);
    const e = num(s.each);
    if (g !== undefined && e !== undefined)
      return { kind: "equal-groups", bars: [{ whole: g * e, parts: g }] };
  }
  return undefined;
}

const has = (xs: number[], v: number) => xs.some((x) => Math.abs(x - v) < 1e-9);

/**
 * Why a figure disagrees with its slide's words, or undefined when it agrees (or the check has
 * nothing to compare: a figure kind with no amounts, or words with no numbers).
 */
export function figureTextMismatch(spec: unknown, slide: J | undefined): string | undefined {
  const a = figureAmounts(spec);
  if (!a) return undefined;
  const words = slideWords(slide);
  const nums = numbersIn(words);
  if (!nums.length) return undefined;
  for (const b of a.bars)
    if (!has(nums, b.whole))
      return `${a.kind} draws ${b.whole}, a number the slide's words never use`;
  // a single fraction-of-an-amount bar must be the amount the words take the fraction of
  const fo = fractionsOf(words);
  const one = a.bars.length === 1 ? (a.bars[0] as Drawn[number]) : undefined;
  if (one && fo.length && a.kind === "bar-model") {
    const hit = fo.some((f) => f.N === one.whole && (one.parts === undefined || f.d === one.parts));
    if (!hit) {
      const f = fo[0] as { n: number; d: number; N: number };
      return `bar-model draws ${one.whole} in ${one.parts ?? "?"} parts; the words say ${f.n}/${f.d} of ${f.N}`;
    }
  }
  return undefined;
}

/**
 * A bar model rebuilt from the words: exactly one distinct "n/d of N" (n ≤ d, N shares into d
 * equal whole-number or 2dp parts) gives one bar of N in d parts with n shaded. The old figure's
 * other fields (label, unit, unknown) are kept; its stale alt is rewritten.
 */
export function rederiveFigure(fig: J, slide: J): J | undefined {
  if (fig.kind !== "bar-model") return undefined;
  const fo = fractionsOf(slideWords(slide));
  const distinct = [...new Map(fo.map((f) => [`${f.n}/${f.d}/${f.N}`, f])).values()];
  if (distinct.length !== 1) return undefined;
  const { n, d, N } = distinct[0] as { n: number; d: number; N: number };
  if (n > d || d < 2 || d > 12) return undefined;
  const part = N / d;
  if (Math.abs(Math.round(part * 100) - part * 100) > 1e-9) return undefined;
  const old = (Array.isArray(fig.bars) && (fig.bars[0] as J)) || {};
  const unit = typeof old.unit === "string" ? old.unit : null;
  const u = (v: number) => (unit && /^[£$€]/.test(unit) ? `${unit}${v}` : `${v}`);
  return {
    ...fig,
    bars: [
      {
        label: old.label ?? null,
        whole: N,
        parts: d,
        values: null,
        shaded: n,
        unknown: old.unknown ?? "none",
        unit,
      },
    ],
    combined: null,
    alt: `A bar of ${u(N)} split into ${d} equal parts of ${u(part)}; ${n} ${n === 1 ? "part is" : "parts are"} shaded.`,
  };
}

/** A figure written as a stub (kind, shows, labels: the repair schema's form) has no spec. */
const isStub = (f: J) =>
  Object.keys(f).every((k) => ["kind", "shows", "labels", "ask", "ask_without"].includes(k));

export type Sync =
  | { action: "kept" | "none"; slide: J }
  | { action: "redrawn"; slide: J; why: string }
  | { action: "drop"; slide: J; why: string };

/**
 * The figure on a slide a repair rewrote. A stub of the same kind as the old figure takes the old
 * spec (the repair only re-words); then the figure must agree with the new words: kept when it
 * does, redrawn from the words when it can be, dropped when it cannot.
 */
export function syncFigure(before: J | undefined, next: J): Sync {
  const key = ["figure", "diagram"].find(
    (k) => next[k] && typeof next[k] === "object" && "kind" in (next[k] as J),
  );
  if (!key) return { action: "none", slide: next };
  let fig = next[key] as J;
  const old = before?.[key] as J | undefined;
  if (isStub(fig) && old && typeof old === "object" && old.kind === fig.kind && !isStub(old)) {
    const { shows: _s, labels: _l, ...spec } = old;
    fig = { ...spec, ...fig, labels: undefined };
    delete fig.labels;
  }
  const why = figureTextMismatch(fig, next);
  if (!why) return { action: "kept", slide: { ...next, [key]: fig } };
  const re = rederiveFigure(fig, next);
  if (re && !figureTextMismatch(re, next)) {
    const shows = typeof fig.shows === "string" ? fig.shows : undefined;
    return {
      action: "redrawn",
      why,
      slide: { ...next, [key]: { ...re, ...(shows ? { shows } : {}) } },
    };
  }
  return { action: "drop", why, slide: next };
}

/** JSON with sorted keys: two specs are the same drawing when this matches. */
export const specKey = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as J).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  ) ?? "";

/**
 * lib arm (chalkie-gap fix 1b): a writer's fraction-of-an-amount bar (one bar: whole, parts,
 * shaded, equal parts) as library bar_model params, worked out in code. The library computes every
 * number from these, so the bar cannot show a false sum. Undefined for any other bar model.
 */
export function barModelParams(f: J): J | undefined {
  if (f.kind !== "bar-model" || !Array.isArray(f.bars) || f.bars.length !== 1) return undefined;
  const b = f.bars[0] as J;
  const W = num(b.whole);
  const d = num(b.parts);
  const n = num(b.shaded);
  if (W === undefined || d === undefined || n === undefined) return undefined;
  if (!Number.isInteger(d) || !Number.isInteger(n) || d < 2 || d > 12 || n < 1 || n > d)
    return undefined;
  if (Array.isArray(b.values) && b.values.some((v) => Math.abs(Number(v) - W / d) > 1e-9))
    return undefined;
  if (Math.abs(Math.round((W / d) * 100) - (W / d) * 100) > 1e-9) return undefined;
  const unit = typeof b.unit === "string" ? b.unit.trim() : "";
  return {
    type: "fraction",
    amount: W,
    fraction: { n, d },
    unknown: b.unknown === "whole" ? "whole" : "part",
    ...(unit ? { unit } : {}),
  };
}

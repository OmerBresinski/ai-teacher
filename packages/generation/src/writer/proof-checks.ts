/*
 * Counts the v5.2-gold and v5.3-gold proofs read off a written lesson (scratchpad/tuning/v5.2-gold BUILDER B7,
 * v5.3-gold CHANGES;
 * METHOD rule 8: checks in code, logged only, never a gate). Pure: the writer's raw output in,
 * numbers out; `runWriter` logs them as one `proof-checks` event per lesson, on every pack.
 */

type S = Record<string, unknown>;

/** Lower case, letters, digits and the maths signs a row's line uses; nothing else. */
const flat = (t: unknown) =>
  String(t ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9/÷×+−\-=.]/g, "")
    .replace(/\.$/, "");

/** The two sides of a row's line at its last "=" (undefined without one). */
function sides(eq: unknown): [string, string] | undefined {
  const t = String(eq ?? "");
  const at = t.lastIndexOf("=");
  return at < 0 ? undefined : [flat(t.slice(0, at)), flat(t.slice(at + 1))];
}

/**
 * Worked rows that only restate: a row whose line's left side is the heading's problem and whose
 * right side is the previous row's result ("1/3 of 21 = 7" after "21 ÷ 3 = 7" under "Find 1/3 of 21.").
 */
export function workedRestates(slide: S): number {
  if (slide.template !== "worked" || !Array.isArray(slide.lines)) return 0;
  const heading = flat(slide.heading);
  const rows = slide.lines as S[];
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const now = sides(rows[i]?.eq);
    const before = sides(rows[i - 1]?.eq);
    if (!now || !before || !now[0]) continue;
    if (heading.includes(now[0]) && now[1] === before[1]) n++;
  }
  return n;
}

// ─── v5.3-gold: a worked row's move against its line ────────────────────────────────────────

const UNITS: Record<string, number> = {
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
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
};
const PARTS: Record<string, number> = {
  half: 2,
  halve: 2,
  third: 3,
  quarter: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  twelfth: 12,
  hundredth: 100,
};
/** The operation a move's verb names, as the sign its line must use. */
const OPERATION: Record<string, string> = {
  multiply: "×",
  times: "×",
  divide: "÷",
  share: "÷",
  add: "+",
  subtract: "−",
};
const minus = (t: string) => t.replace(/[-–]/g, "−");
const part = (w: string) =>
  PARTS[w.replace(/s$/, "").replace(/ve$/, "f")] ?? PARTS[w.replace(/s$/, "")];

/** A number as written in digits ("7", "2.5", "3/4", "2 1/2"), or undefined. */
function digitsValue(t: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+))?/.exec(t.trim());
  if (!m) return undefined;
  if (m[2] && m[3]) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  return m[4] ? Number(m[1]) / Number(m[4]) : Number(m[1]);
}

/**
 * The number a phrase opens with, in digits or words: "3", "2 1/2", "three", "three quarters",
 * "a half", "one fifth". Undefined when it opens with anything else ("the denominator").
 */
export function leadingNumber(phrase: string): number | undefined {
  const t = phrase.trim().toLowerCase();
  const d = digitsValue(t);
  if (d !== undefined) return d;
  const w = t
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  const first = w[0] ?? "";
  const n = first === "a" || first === "an" ? 1 : UNITS[first];
  if (n === undefined) return part(first) ? 1 / (part(first) as number) : undefined;
  const p = w[1] ? part(w[1]) : undefined;
  if (p) return n / p;
  return first === "a" || first === "an" ? undefined : n;
}

/** The numbers a line works with: every operand left of its last "=" (the whole line without one). */
function operands(eq: string): number[] {
  const at = eq.lastIndexOf("=");
  const left = minus(at < 0 ? eq : eq.slice(0, at));
  return left
    .split(/[×÷+−()]/)
    .map((x) => digitsValue(x.replace(/^[^\d]+/, "")))
    .filter((v): v is number => v !== undefined);
}

/**
 * Why a worked row's move does not describe its own line, or undefined when it does or cannot be
 * told. Read only when the move opens with an operation's verb: the line must use that sign, and a
 * number named straight after the verb or its "by" must be one the line works with ("Multiply by
 * three quarters." over "2 1/2 × 3 = 7 1/2" names 3/4; the line multiplies by 3).
 */
export function workedCaptionFault(move: unknown, eq: unknown): string | undefined {
  if (typeof move !== "string" || typeof eq !== "string" || !eq.trim()) return undefined;
  const m = /^\s*([a-z]+)\b(.*)$/i.exec(move);
  const sign = m ? OPERATION[(m[1] as string).toLowerCase()] : undefined;
  if (!m || !sign) return undefined;
  const at = eq.lastIndexOf("=");
  if (!minus(at < 0 ? eq : eq.slice(0, at)).includes(sign))
    return `the move says ${m[1]?.toLowerCase()}; the line has no ${sign}`;
  const rest = (m[2] as string).trim();
  const by = /\bby\s+(.+)$/i.exec(rest);
  const named = leadingNumber(by ? (by[1] as string) : rest);
  if (named === undefined) return undefined;
  if (operands(eq).some((v) => Math.abs(v - named) < 1e-9)) return undefined;
  return `the move names ${Math.round(named * 1000) / 1000}; the line works with ${operands(eq).join(", ")}`;
}

/** Every worked row in the deck whose move does not describe its line (`workedCaptionFault`). */
export function workedCaptions(
  slides: S[],
): { slide: number; move: string; eq: string; why: string }[] {
  const out: { slide: number; move: string; eq: string; why: string }[] = [];
  slides.forEach((s, k) => {
    if (s.template !== "worked" || !Array.isArray(s.lines)) return;
    for (const r of s.lines as S[]) {
      const why = workedCaptionFault(r?.move, r?.eq);
      // `slides` starts at the deck's slide 3.
      if (why) out.push({ slide: k + 3, move: String(r.move), eq: String(r.eq), why });
    }
  });
  return out;
}

// ─── v5.3-gold: every point has a teaching slide ────────────────────────────────────────────

const CHECK_LAYOUT =
  /^(hinge|question-set|practice|exit-ticket|pair|group-sort|sequence|odd-one-out|title|objectives)\b/;

/**
 * The context's point labels no teaching flow entry lists (a check, an activity or a frame slide
 * does not teach one). Null when the lesson has no points.
 */
export function pointsUntaught(
  flow: unknown[] | undefined,
  labels: readonly string[],
): string[] | null {
  if (!labels.length) return null;
  const taught = new Set<string>();
  for (const f of (flow ?? []) as S[]) {
    if (CHECK_LAYOUT.test(String(f?.layout ?? ""))) continue;
    for (const l of Array.isArray(f?.points) ? f.points : [])
      taught.add(String(l).trim().toLowerCase());
  }
  return labels.filter((l) => !taught.has(l.toLowerCase()));
}

// ─── v5.3-gold: a check that brings no new case ─────────────────────────────────────────────

const STOP = new Set(
  "a an the this that these those it its they them their there here is are was were be been do does did can could would will might may must should has have had not no yes and or but so if then than as at by for from in into of on onto to towards with without about what which who whom whose when where why how explain describe name give write state find work out show one other both each more most some any all very also only".split(
    " ",
  ),
);
/** The content words of a text: lower case, no stop words, numbers kept. */
function contentWords(t: string): string[] {
  return (t.toLowerCase().match(/[a-z]+(?:'[a-z]+)?|\d+(?:[./]\d+)*/g) ?? []).filter(
    (w) => !STOP.has(w),
  );
}
/** Two words are one word when either starts the other (house, houses; gas, gases) from 3 letters. */
const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
/** Every string a pupil reads on a written slide (its picture asks, option notes and icons left out). */
function shownStrings(v: unknown, key = ""): string[] {
  if (typeof v === "string")
    return /^(template|fit|icon|why|subject|accentWord|kind|motif|shows|working)$/.test(key)
      ? []
      : [v];
  if (Array.isArray(v)) return key === "must_see" ? [] : v.flatMap((x) => shownStrings(x, key));
  if (v && typeof v === "object")
    return Object.entries(v as S).flatMap(([k, x]) => shownStrings(x, k));
  return [];
}
/** A check's questions with their answers: a hinge's heading and first option, else each item. */
function asked(s: S): string[] {
  if (s.template === "hinge") {
    const first = (Array.isArray(s.options) ? (s.options[0] as S | undefined) : undefined)?.text;
    return [`${String(s.heading ?? "")} ${String(first ?? "")}`];
  }
  if (!["question-set", "practice", "exit-ticket"].includes(String(s.template))) return [];
  return (Array.isArray(s.items) ? (s.items as S[]) : []).map(
    (i) => `${String(i?.question ?? "")} ${String(i?.answer ?? "")}`,
  );
}

/** At or above this share of a question's content words already on earlier slides, it brings no new case. */
export const READBACK_SHARE = 0.75;

/**
 * Checks that bring no new case: a question whose content words (its answer's included) are nearly
 * all on earlier slides already, so it can be answered by reading back ("What could wind blow
 * towards houses?" after "Wind blew flames towards other houses."). A word count, not a reading:
 * it misses a read-back in new words and flags a fair question that reuses the lesson's terms, so
 * it is a rate to compare between packs, never a verdict on one slide.
 */
export function checkReadbacks(slides: S[]): { slide: number; question: string; share: number }[] {
  const out: { slide: number; question: string; share: number }[] = [];
  const seen: string[] = [];
  slides.forEach((s, k) => {
    for (const q of asked(s)) {
      const words = [...new Set(contentWords(q))];
      if (words.length < 3) continue;
      const old = words.filter((w) => seen.some((x) => sameWord(w, x))).length;
      const share = Math.round((old / words.length) * 100) / 100;
      if (share >= READBACK_SHARE) out.push({ slide: k + 3, question: q.trim(), share });
    }
    seen.push(...shownStrings(s).flatMap(contentWords));
  });
  return out;
}

export type ProofChecks = {
  /** Slides the flow planned against the brief's range. */
  flowCount: { planned: number; min: number; max: number };
  /** Worked rows that only restate the answer, over every worked slide. */
  workedRestate: number;
  /** The exit ticket's questions against the lesson's objectives (null without an exit ticket on the slides). */
  exitObjectives: { questions: number; objectives: number } | null;
  /** v5.3-gold: the context's points no teaching flow entry lists (null without points). */
  pointsUntaught: string[] | null;
  /** v5.3-gold: worked rows whose move does not describe their own line. */
  workedCaption: { slide: number; move: string; eq: string; why: string }[];
  /** v5.3-gold: checks that bring no new case (a word-count rate, see `checkReadbacks`). */
  checkReadback: { slide: number; question: string; share: number }[];
};

export function proofChecks(
  out: { flow?: unknown[] | undefined; slides?: S[] | undefined },
  range: { min: number; max: number },
  objectives: number,
  pointLabels: readonly string[] = [],
): ProofChecks {
  const slides = out.slides ?? [];
  const exit = slides.find((s) => s.template === "exit-ticket");
  return {
    flowCount: { planned: out.flow?.length ?? 0, min: range.min, max: range.max },
    workedRestate: slides.reduce((n, s) => n + workedRestates(s), 0),
    exitObjectives: exit
      ? { questions: Array.isArray(exit.items) ? exit.items.length : 0, objectives }
      : null,
    pointsUntaught: pointsUntaught(out.flow, pointLabels),
    workedCaption: workedCaptions(slides),
    checkReadback: checkReadbacks(slides),
  };
}

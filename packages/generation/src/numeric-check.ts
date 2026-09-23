import type { Finding, LessonFacts } from "@tj/domain/documents";

/*
 * The numeric check (w0: the lab trig deck marked "sin(40°) = 6 cm ÷ 10 cm" correct and Luna
 * verify passed it). Code, no model: it finds equalities whose sides are both plain arithmetic —
 * numbers, + − × ÷ ^ √, sin/cos/tan in degrees, a small table of units — evaluates each side and
 * flags a pair that disagrees beyond the rounding its numbers show. It flags; it never rewrites.
 *
 * Structural only: a side with a word it does not know ("opposite", "x", "£") is not arithmetic
 * and is skipped, never guessed. Rounding is read from the digits written: a decimal literal is
 * taken as rounded to its last place (0.423 is 0.4225–0.4235), and so is a side that is one bare
 * number (the stated result; "= 6" is 5.5–6.5), everything else is exact; the sides agree when
 * their ranges meet. Units convert when both sides carry the same dimension ("150 cm = 1.5 m");
 * when only one side carries a unit ("12 × 0.423 = 5.07 cm") the numbers are compared as written.
 */

/** One equality whose two sides do not agree. */
export type NumericMismatch = {
  /** The equality as written, e.g. `sin(40°) = 6 cm ÷ 10 cm`. */
  text: string;
  left: number;
  right: number;
};

type Dims = Record<string, number>;
/** A value as an interval, in base units, with the same interval ignoring unit factors (`raw`). */
type Val = { lo: number; hi: number; rlo: number; rhi: number; dims: Dims };

type Unit = { factor: number; dims: Dims };
const L = (factor: number, power = 1): Unit => ({ factor, dims: { L: power } });
const UNITS: Record<string, Unit> = {
  mm: L(0.001),
  cm: L(0.01),
  m: L(1),
  km: L(1000),
  mg: { factor: 1e-6, dims: { M: 1 } },
  g: { factor: 0.001, dims: { M: 1 } },
  kg: { factor: 1, dims: { M: 1 } },
  s: { factor: 1, dims: { T: 1 } },
  min: { factor: 60, dims: { T: 1 } },
  h: { factor: 3600, dims: { T: 1 } },
  hr: { factor: 3600, dims: { T: 1 } },
  ml: L(1e-6, 3),
  l: L(1e-3, 3),
  pa: { factor: 1, dims: { P: 1 } },
  kpa: { factor: 1000, dims: { P: 1 } },
  n: { factor: 1, dims: { N: 1 } },
  j: { factor: 1, dims: { J: 1 } },
  kj: { factor: 1000, dims: { J: 1 } },
  "%": { factor: 0.01, dims: {} },
};

type Tok =
  | { t: "num"; v: number; decimals: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { t: "(" | ")" | "deg" | "sqrt" | "eq" }
  | { t: "fn"; v: "sin" | "cos" | "tan"; inverse: boolean }
  | { t: "pow"; v: number }
  | { t: "unit"; v: string }
  | { t: "x" }
  | { t: "word" };
/** A token with where it sits in the text. */
type Pos = { tok: Tok; from: number; to: number };

const SUPERSCRIPT: Record<string, number> = { "²": 2, "³": 3 };

function tokenize(text: string): Pos[] {
  const out: Pos[] = [];
  const re =
    /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)|(sin|cos|tan)(⁻¹|\^-1)?|([A-Za-zµ]+)|([=≈])|([+\-−–×*·÷/^()%°²³√])|(\s+)|(.)/gu;
  for (const m of text.matchAll(re)) {
    const [whole, num, fn, inv, word, eq, sym, space] = m;
    if (space) continue;
    let tok: Tok;
    if (num) {
      const clean = num.replace(/,/g, "");
      tok = { t: "num", v: Number(clean), decimals: clean.split(".")[1]?.length ?? 0 };
    } else if (fn) tok = { t: "fn", v: fn as "sin" | "cos" | "tan", inverse: Boolean(inv) };
    else if (word) {
      const lower = word.toLowerCase();
      tok =
        lower === "x"
          ? { t: "x" }
          : lower === "sqrt"
            ? { t: "sqrt" }
            : lower in UNITS
              ? { t: "unit", v: lower }
              : { t: "word" };
    } else if (eq) tok = { t: "eq" };
    else if (sym) {
      if (sym === "(" || sym === ")") tok = { t: sym };
      else if (sym === "°") tok = { t: "deg" };
      else if (sym === "√") tok = { t: "sqrt" };
      else if (sym === "%") tok = { t: "unit", v: "%" };
      else if (sym in SUPERSCRIPT) tok = { t: "pow", v: SUPERSCRIPT[sym] ?? 1 };
      else
        tok = {
          t: "op",
          v:
            sym === "×" || sym === "*" || sym === "·"
              ? "*"
              : sym === "÷" || sym === "/"
                ? "/"
                : sym === "^"
                  ? "^"
                  : sym === "+"
                    ? "+"
                    : "-",
        };
    } else if (whole) tok = { t: "word" };
    else continue;
    const from = m.index ?? 0;
    out.push({ tok, from, to: from + m[0].length });
  }
  // A letter x is multiplication only between two operands ("3 x 4"); anywhere else it is a name.
  const operandEnd = (t?: Tok) =>
    t !== undefined &&
    (t.t === "num" || t.t === ")" || t.t === "deg" || t.t === "unit" || t.t === "pow");
  const operandStart = (t?: Tok) =>
    t !== undefined && (t.t === "num" || t.t === "(" || t.t === "fn" || t.t === "sqrt");
  return out.map((p, i) =>
    p.tok.t !== "x"
      ? p
      : {
          ...p,
          tok:
            operandEnd(out[i - 1]?.tok) && operandStart(out[i + 1]?.tok)
              ? { t: "op", v: "*" }
              : { t: "word" },
        },
  );
}

const DIMLESS: Dims = {};
const sameDims = (a: Dims, b: Dims) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
};
const combine = (a: Dims, b: Dims, sign: 1 | -1): Dims => {
  const out: Dims = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + sign * v;
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
};
const scaleDims = (a: Dims, p: number): Dims =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v * p]));

function span(xs: number[]): [number, number] {
  return [Math.min(...xs), Math.max(...xs)];
}
function binary(a: Val, b: Val, op: "+" | "-" | "*" | "/" | "^"): Val | undefined {
  const f = (x: number, y: number) =>
    op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : x ** y;
  if ((op === "+" || op === "-") && !sameDims(a.dims, b.dims)) return undefined;
  if (op === "/" && b.lo <= 0 && b.hi >= 0) return undefined;
  if (op === "^" && (!sameDims(b.dims, DIMLESS) || b.lo !== b.hi)) return undefined;
  const conv = span([f(a.lo, b.lo), f(a.lo, b.hi), f(a.hi, b.lo), f(a.hi, b.hi)]);
  const raw = span([f(a.rlo, b.rlo), f(a.rlo, b.rhi), f(a.rhi, b.rlo), f(a.rhi, b.rhi)]);
  const dims =
    op === "*"
      ? combine(a.dims, b.dims, 1)
      : op === "/"
        ? combine(a.dims, b.dims, -1)
        : op === "^"
          ? scaleDims(a.dims, b.lo)
          : a.dims;
  if (![...conv, ...raw].every(Number.isFinite)) return undefined;
  return { lo: conv[0], hi: conv[1], rlo: raw[0], rhi: raw[1], dims };
}

/** Recursive descent over one side's tokens; `undefined` when the side is not plain arithmetic. */
function evaluate(toks: Tok[], bare: boolean): Val | undefined {
  let i = 0;
  const peek = () => toks[i];
  const exact = (v: number): Val => ({ lo: v, hi: v, rlo: v, rhi: v, dims: DIMLESS });
  const unitOf = (v: Val): Val => {
    let out = v;
    for (;;) {
      const t = peek();
      if (t?.t === "unit") {
        i++;
        const u = UNITS[t.v];
        if (!u) return out;
        let power = 1;
        const next = peek();
        if (next?.t === "pow") {
          power = next.v;
          i++;
        }
        const factor = u.factor ** power;
        out = {
          lo: out.lo * factor,
          hi: out.hi * factor,
          rlo: out.rlo,
          rhi: out.rhi,
          dims: combine(out.dims, scaleDims(u.dims, power), 1),
        };
        continue;
      }
      if (t?.t === "deg") {
        i++;
        out = { ...out, dims: combine(out.dims, { deg: 1 }, 1) };
        continue;
      }
      if (t?.t === "pow") {
        i++;
        const p = binary(out, exact(t.v), "^");
        if (!p) return out;
        out = p;
        continue;
      }
      return out;
    }
  };
  const primary = (): Val | undefined => {
    const t = peek();
    if (!t) return undefined;
    if (t.t === "num") {
      i++;
      const half = t.decimals > 0 || bare ? 0.5 * 10 ** -t.decimals : 0;
      return unitOf({
        lo: t.v - half,
        hi: t.v + half,
        rlo: t.v - half,
        rhi: t.v + half,
        dims: DIMLESS,
      });
    }
    if (t.t === "(") {
      i++;
      const v = expr();
      if (peek()?.t !== ")") return undefined;
      i++;
      return v && unitOf(v);
    }
    if (t.t === "op" && t.v === "-") {
      i++;
      const v = power();
      return v && { lo: -v.hi, hi: -v.lo, rlo: -v.rhi, rhi: -v.rlo, dims: v.dims };
    }
    if (t.t === "sqrt") {
      i++;
      const v = power();
      if (!v || v.lo < 0) return undefined;
      return {
        lo: Math.sqrt(v.lo),
        hi: Math.sqrt(v.hi),
        rlo: Math.sqrt(Math.max(0, v.rlo)),
        rhi: Math.sqrt(Math.max(0, v.rhi)),
        dims: scaleDims(v.dims, 0.5),
      };
    }
    if (t.t === "fn") {
      i++;
      const arg = power();
      if (!arg) return undefined;
      const RAD = Math.PI / 180;
      if (t.inverse) {
        if (!sameDims(arg.dims, DIMLESS) || arg.lo < -1 || arg.hi > 1) return undefined;
        const g = t.v === "sin" ? Math.asin : t.v === "cos" ? Math.acos : Math.atan;
        const [lo, hi] = span([g(arg.lo) / RAD, g(arg.hi) / RAD]);
        return unitOf({ lo, hi, rlo: lo, rhi: hi, dims: { deg: 1 } });
      }
      // Degrees, written or not (school trigonometry).
      if (!sameDims(arg.dims, { deg: 1 }) && !sameDims(arg.dims, DIMLESS)) return undefined;
      const g = t.v === "sin" ? Math.sin : t.v === "cos" ? Math.cos : Math.tan;
      if (arg.hi - arg.lo > 5) return undefined;
      const [lo, hi] = span([g(arg.lo * RAD), g(arg.hi * RAD)]);
      return { lo, hi, rlo: lo, rhi: hi, dims: DIMLESS };
    }
    return undefined;
  };
  const power = (): Val | undefined => {
    const base = primary();
    if (!base) return undefined;
    const t = peek();
    if (t?.t === "op" && t.v === "^") {
      i++;
      const e = power();
      return e && binary(base, e, "^");
    }
    return base;
  };
  const term = (): Val | undefined => {
    let v = power();
    for (let t = peek(); v && t?.t === "op" && (t.v === "*" || t.v === "/"); t = peek()) {
      i++;
      const r = power();
      v = r && binary(v, r, t.v);
    }
    return v;
  };
  const expr = (): Val | undefined => {
    let v = term();
    for (let t = peek(); v && t?.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      i++;
      const r = term();
      v = r && binary(v, r, t.v);
    }
    return v;
  };
  const v = expr();
  return i === toks.length ? v : undefined;
}

const meets = (a: [number, number], b: [number, number]) => {
  const slack = 1e-9 * Math.max(1, Math.abs(a[0]), Math.abs(b[0]));
  return a[0] <= b[1] + slack && b[0] <= a[1] + slack;
};

/** The equalities in `text` whose two sides are arithmetic and disagree. */
export function numericMismatches(text: string): NumericMismatch[] {
  const toks = tokenize(text);
  // Segments: maximal runs without a word; a side touching a word is not trusted to be whole.
  const out: NumericMismatch[] = [];
  const flush = (start: number, end: number) => {
    const sides: Pos[][] = [[]];
    for (const p of toks.slice(start, end)) {
      if (p.tok.t === "eq") sides.push([]);
      else sides[sides.length - 1]?.push(p);
    }
    if (sides.length < 2) return;
    const vals = sides.map((side, k) => {
      const s = side.map((p) => p.tok);
      const first = s[0];
      const last = s[s.length - 1];
      if (!first || !last) return undefined;
      // "a + 2 × 3 = 7": the side after a name starts mid-expression; so does one cut before a name.
      if (k === 0 && start > 0 && first.t === "op") return undefined;
      if (
        k === sides.length - 1 &&
        end < toks.length &&
        (last.t === "op" || last.t === "fn" || last.t === "sqrt")
      )
        return undefined;
      const bare = s.filter((t) => t.t === "num").length === 1 && s.every((t) => t.t !== "op");
      return evaluate(s, bare);
    });
    for (let k = 0; k + 1 < vals.length; k++) {
      const a = vals[k];
      const b = vals[k + 1];
      if (!a || !b) continue;
      const converted = sameDims(a.dims, b.dims);
      if (!converted && !sameDims(a.dims, DIMLESS) && !sameDims(b.dims, DIMLESS)) continue;
      const range = (v: Val): [number, number] => (converted ? [v.lo, v.hi] : [v.rlo, v.rhi]);
      if (meets(range(a), range(b))) continue;
      const mid = (v: Val) => (range(v)[0] + range(v)[1]) / 2;
      const from = sides[k]?.[0]?.from ?? 0;
      const to = sides[k + 1]?.at(-1)?.to ?? text.length;
      out.push({ text: text.slice(from, to).trim(), left: mid(a), right: mid(b) });
    }
  };
  let start = 0;
  toks.forEach((p, i) => {
    if (p.tok.t === "word") {
      flush(start, i);
      start = i + 1;
    }
  });
  flush(start, toks.length);
  return out;
}

/** Where a fact's checked text lives. */
export type NumericFactMismatch = NumericMismatch & {
  factId: string;
  field: string;
  index?: number;
};

/**
 * Every mismatch in the facts' authoritative text: worked examples (problem, steps, answer),
 * question answers and reasoning, key ideas, vocabulary definitions, misconception corrections.
 * Never a stem, a distractor or a misconception's belief: those may be wrong on purpose.
 */
export function numericFactMismatches(facts: LessonFacts): NumericFactMismatch[] {
  const out: NumericFactMismatch[] = [];
  const scan = (factId: string, field: string, text: string | undefined, index?: number) => {
    if (!text) return;
    for (const m of numericMismatches(text))
      out.push({ ...m, factId, field, ...(index === undefined ? {} : { index }) });
  };
  for (const x of facts.workedExamples) {
    scan(x.id, "problem", x.problem);
    x.steps.forEach((s, i) => {
      scan(x.id, "steps", s, i);
    });
    scan(x.id, "answer", x.answer);
  }
  for (const q of facts.questions) {
    scan(q.id, "answer", q.answer);
    scan(q.id, "reasoning", q.reasoning);
  }
  for (const k of facts.keyIdeas ?? []) {
    scan(k.id, "statement", k.statement);
    scan(k.id, "explanation", k.explanation);
    scan(k.id, "example", k.example);
  }
  for (const v of facts.vocabulary) scan(v.id, "definition", v.definition);
  for (const m of facts.misconceptions) scan(m.id, "correction", m.correction);
  return out;
}

/** The lab check's name for a mismatch. */
export const NUMERIC_CHECK = "numeric-mismatch";

/**
 * One warning per mismatch, on the fact, recorded by Verify under its own check name
 * (`fact-verify`) so Evaluate carries it through to the list Repair reads. The message is
 * content-free (ADR 0015); the equality itself is the `evidence`.
 */
export function numericFindings(facts: LessonFacts): Finding[] {
  return numericFactMismatches(facts).map((m) => ({
    check: "fact-verify",
    severity: "warning",
    target: { factId: m.factId },
    message: NUMERIC_MESSAGE,
    evidence: m.text,
  }));
}

/** The message every numeric finding carries; Evaluate recognises Verify's warnings by it. */
export const NUMERIC_MESSAGE =
  "A calculation in this fact does not work out: its two sides differ.";

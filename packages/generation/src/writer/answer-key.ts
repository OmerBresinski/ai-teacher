import { numericMismatches } from "../numeric-check";

type S = Record<string, unknown>;

/*
 * The answer-key check. Code, no model: a maths answer the code can work out itself is compared
 * with the key the writer or the notes call wrote (Y9 equations, 3 Nov: "Is x = 6 a solution to
 * 3x + 2 = 17?" keyed "Yes. Substitution gives 3 × 6 + 2 = 20, which is not 17; so x = 6 is not a
 * solution."). Three things are checked, and only when the code can read them with certainty:
 *
 * - "Solve <equation>" with one unknown, linear: the key must state the true solution;
 * - "Is x = k a solution to <equation>?": the key's yes/no must match substitution;
 * - plain arithmetic in a key or its working ("3 × 6 + 2 = 20"): each equality must hold
 *   (`numeric-check.ts`).
 *
 * Anything it cannot parse is skipped, never guessed: an equation with two letters, a square, a
 * word or a symbol inside it, two `=`, no unique solution, a key that states no value. A key that
 * states several values passes when one of them is the solution (an error-spotting answer names
 * the wrong value too). The only rewrite is the yes/no word, and only when the rest of the key
 * already says the right thing (its arithmetic holds and its conclusion agrees with substitution).
 */

/** a·x + c, the value of a linear expression in one unknown. */
type Lin = { a: number; c: number };
type Tok =
  | { t: "num"; v: number }
  | { t: "var"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "(" | ")" | "=" };

const OPS: Record<string, "+" | "-" | "*" | "/"> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "–": "-",
  "×": "*",
  "*": "*",
  "·": "*",
  "÷": "/",
  "/": "/",
};

function tokens(text: string): Tok[] | undefined {
  const out: Tok[] = [];
  const re = /\s+|(\d+(?:\.\d+)?)|([A-Za-z])(?![A-Za-z])|([+\-−–×*·÷/])|([()=])|(.)/gy;
  for (const m of text.matchAll(re)) {
    const [, num, letter, op, punct, other] = m;
    if (other !== undefined) return undefined;
    if (num !== undefined) out.push({ t: "num", v: Number(num) });
    else if (letter !== undefined) out.push({ t: "var", v: letter });
    else if (op !== undefined) out.push({ t: "op", v: OPS[op] ?? "+" });
    else if (punct !== undefined) out.push({ t: punct as "(" | ")" | "=" });
  }
  return out;
}

const tiny = (x: number) => Math.abs(x) < 1e-12;

/** One side, as a·x + c; `undefined` when it is not linear in one unknown or not well formed. */
function linear(toks: Tok[], vars: Set<string>): Lin | undefined {
  let i = 0;
  const peek = () => toks[i];
  const mul = (p: Lin, q: Lin): Lin | undefined =>
    !tiny(p.a) && !tiny(q.a) ? undefined : { a: p.a * q.c + q.a * p.c, c: p.c * q.c };
  const div = (p: Lin, q: Lin): Lin | undefined =>
    !tiny(q.a) || tiny(q.c) ? undefined : { a: p.a / q.c, c: p.c / q.c };
  const primary = (): Lin | undefined => {
    const t = peek();
    if (!t) return undefined;
    i++;
    if (t.t === "num") return { a: 0, c: t.v };
    if (t.t === "var") {
      vars.add(t.v);
      return { a: 1, c: 0 };
    }
    if (t.t === "(") {
      const v = expr();
      if (peek()?.t !== ")") return undefined;
      i++;
      return v;
    }
    if (t.t === "op" && (t.v === "-" || t.v === "+")) {
      const v = primary();
      return v && (t.v === "-" ? { a: -v.a, c: -v.c } : v);
    }
    return undefined;
  };
  // "2x", "3(x + 1)", "x(…)": a number, a letter or a bracket followed by a letter or a bracket.
  const implicit = () => {
    const t = peek();
    return t?.t === "var" || t?.t === "(";
  };
  const term = (): Lin | undefined => {
    let v = primary();
    let afterDivide = false;
    for (;;) {
      if (!v) return undefined;
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        i++;
        const r = primary();
        if (!r) return undefined;
        v = t.v === "*" ? mul(v, r) : div(v, r);
        afterDivide = t.v === "/";
      } else if (implicit()) {
        // "3/4x" is (3/4)x to one reader and 3/(4x) to another: not read.
        if (afterDivide) return undefined;
        const r = primary();
        if (!r) return undefined;
        v = mul(v, r);
      } else return v;
    }
  };
  const expr = (): Lin | undefined => {
    let v = term();
    for (let t = peek(); v && t?.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      i++;
      const r = term();
      if (!r) return undefined;
      v = t.v === "+" ? { a: v.a + r.a, c: v.c + r.c } : { a: v.a - r.a, c: v.c - r.c };
    }
    return v;
  };
  const v = expr();
  return i === toks.length ? v : undefined;
}

/** The value of a constant expression ("18 ÷ 3", "−2", "5/2"), or `undefined`. */
export function constantValue(text: string): number | undefined {
  const toks = tokens(text);
  if (!toks?.length || toks.some((t) => t.t === "=" || t.t === "var")) return undefined;
  const v = linear(toks, new Set());
  return v && Number.isFinite(v.c) ? v.c : undefined;
}

type Equation = { variable: string; left: Lin; right: Lin };

/** A linear equation in exactly one unknown, with exactly one `=`, or `undefined`. */
export function parseEquation(text: string): Equation | undefined {
  const toks = tokens(text);
  if (!toks) return undefined;
  const eq = toks.findIndex((t) => t.t === "=");
  if (eq <= 0 || toks.slice(eq + 1).some((t) => t.t === "=")) return undefined;
  const vars = new Set<string>();
  const left = linear(toks.slice(0, eq), vars);
  const right = linear(toks.slice(eq + 1), vars);
  if (!left || !right || vars.size !== 1) return undefined;
  return { variable: [...vars][0] as string, left, right };
}

/** The one solution of a linear equation in one unknown ("3x + 5 = 20" → x = 5). */
export function solveLinear(text: string): { variable: string; value: number } | undefined {
  const e = parseEquation(text);
  if (!e) return undefined;
  const a = e.left.a - e.right.a;
  const c = e.right.c - e.left.c;
  if (tiny(a)) return undefined;
  const value = c / a;
  return Number.isFinite(value) ? { variable: e.variable, value } : undefined;
}

const close = (x: number, y: number, tol = 0) =>
  Math.abs(x - y) <= tol + 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));

/** Whether `value` makes the equation true; `undefined` when the equation cannot be read. */
export function holdsAt(text: string, variable: string, value: number): boolean | undefined {
  const e = parseEquation(text);
  if (!e || e.variable !== variable) return undefined;
  return close(e.left.a * value + e.left.c, e.right.a * value + e.right.c);
}

/** The maths that may follow a cue: numbers, single letters, operators, brackets, `=`. */
const RUN = /(?:[ \t ]*(?:\d+(?:\.\d+)?|[A-Za-z](?![A-Za-z])|[()+\-−–×*·÷/=]))+/y;
/** What may come straight after an equation: nothing, a space or punctuation. */
const ENDS = /^(?:$|[.,;:?!)\]]|[ \t ]+(?:$|[A-Za-z.,;:?!)\]]))/;

/** The equation written at `from` in `text`, when it stands alone; `undefined` otherwise. */
function equationAt(text: string, from: number): string | undefined {
  RUN.lastIndex = from;
  const m = RUN.exec(text);
  if (!m) return undefined;
  // A bracket opened after the equation ("= 20 (to 1 d.p.)") is not part of it.
  const kept = m[0].replace(/[\s(]+$/, "");
  if (!ENDS.test(text.slice(from + kept.length))) return undefined;
  const run = kept.trim();
  return /[+\-−–×*·÷/=(]$/.test(run) ? undefined : run;
}

/** "Solve 3x + 5 = 20", an imperative at the start of a sentence (not "Sam solves …"). */
const SOLVE =
  /(?:^|[.!?:;]\s+|\(?[a-z0-9]\)\s*|\d+\.\s+)Solve(?:\s+the\s+equation)?(?:\s+for\s+([A-Za-z]))?\s*:?\s*/g;
/** "Is x = 6 a solution to …", "Does x = 4 satisfy …", "Check whether x = 2 is a solution of …". */
const IS_SOLUTION =
  /\b(?:[Ii]s|[Dd]oes|[Cc]heck (?:whether|if)|[Dd]ecide (?:whether|if)|[Ss]how whether)\s+([A-Za-z])\s*=\s*([−\-–]?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s+(?:(?:is\s+)?(?:a|the)\s+(?:solution|root)\s+(?:to|of|for)|satisf(?:y|ies)|works?\s+(?:in|for))\s+(?:the\s+equation\s+)?/g;

/** What a question asks that code can answer. */
export type Asked =
  | { kind: "solve"; variable: string; value: number }
  | { kind: "is-solution"; variable: string; value: number; holds: boolean };

/** The one thing a question asks that code can answer, or `undefined` (none, or more than one). */
export function askedOf(question: string): Asked | undefined {
  const found: Asked[] = [];
  for (const m of question.matchAll(IS_SOLUTION)) {
    const eq = equationAt(question, (m.index ?? 0) + m[0].length);
    const value = constantValue(m[2] ?? "");
    if (!eq || value === undefined) continue;
    const holds = holdsAt(eq, m[1] ?? "", value);
    if (holds !== undefined)
      found.push({ kind: "is-solution", variable: m[1] ?? "", value, holds });
  }
  for (const m of question.matchAll(SOLVE)) {
    const eq = equationAt(question, (m.index ?? 0) + m[0].length);
    const sol = eq ? solveLinear(eq) : undefined;
    if (!sol || (m[1] && m[1] !== sol.variable)) continue;
    found.push({ kind: "solve", ...sol });
  }
  return found.length === 1 ? found[0] : undefined;
}

type Stated = { value: number; tol: number };

/** A number as written, with the rounding its digits show. */
function statedFrom(text: string, approx: boolean): Stated | undefined {
  const value = constantValue(text);
  if (value === undefined) return undefined;
  const dec = /^\s*[−\-–]?\s*\d+\.(\d+)\s*$/.exec(text)?.[1]?.length ?? 0;
  return { value, tol: dec > 0 ? 0.5 * 10 ** -dec : approx ? 0.5 : 0 };
}

/**
 * The values a key states for `variable`: each "x = …" chain's constant parts ("x = 18 ÷ 3 = 6"
 * gives 6 twice), or the whole key when it is one number ("−2").
 */
export function statedValues(answer: string, variable: string): Stated[] {
  const whole = /^\s*([−\-–]?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*\.?\s*$/.exec(answer);
  if (whole) {
    const s = statedFrom(whole[1] ?? "", false);
    return s ? [s] : [];
  }
  const out: Stated[] = [];
  const at = new RegExp(`(?<![A-Za-z0-9])${variable}\\s*([=≈])`, "g");
  const CHAIN = /(?:[ \t ]*(?:\d+(?:\.\d+)?|[()+\-−–×*·÷/=≈]))+/y;
  for (const m of answer.matchAll(at)) {
    const from = (m.index ?? 0) + m[0].length;
    CHAIN.lastIndex = from;
    const c = CHAIN.exec(answer);
    if (!c) continue;
    const kept = c[0].replace(/[\s(]+$/, "");
    if (!ENDS.test(answer.slice(from + kept.length))) continue;
    let approx = m[1] === "≈";
    for (const piece of kept.split(/([=≈])/)) {
      if (piece === "=" || piece === "≈") {
        approx = piece === "≈";
        continue;
      }
      const s = statedFrom(piece, approx);
      if (!s) break;
      out.push(s);
    }
  }
  return out;
}

/**
 * The equalities in `text` that do not hold (`numericMismatches`), less any glued to what the
 * arithmetic reader cannot see: a ratio ("3:4 = 6:8"), a currency or a unit written on the number
 * ("£3.50 = 350p"), a letter on a number ("3n = 21"), a side cut by a word ("1/5 of 35 = 7").
 */
export function wrongSums(text: string): string[] {
  return numericMismatches(text).flatMap((m) => {
    const at = text.indexOf(m.text);
    if (at < 0) return [];
    const before = text.slice(0, at);
    const after = text.slice(at + m.text.length);
    if (/\d\s*:\s*$/.test(before) || /^\s*:\s*\d/.test(after)) return [];
    if (/[^\s(]$/.test(before) || /^[^\s.,;)!?]/.test(after)) return [];
    // "3n = 21": a letter on a number is an unknown to a pupil, a unit (newtons) to the reader.
    if (/\d[A-Za-z]/.test(m.text)) return [];
    // "1/5 of 35 = 7": the left side starts before the word.
    if (/\b(?:of|per|by|times)\s+$/i.test(before)) return [];
    return [m.text];
  });
}

/** A key's leading yes or no ("Yes.", "False: 20 ≠ 17"). */
const LEAD = /^(\s*)(yes|no|true|false)\b/i;
/** A conclusion that something does not hold. */
const DENIES = /\b(?:not|isn['’]t|doesn['’]t|cannot|can['’]t|fails?)\b|≠/i;
/** A conclusion that the value works. */
const AFFIRMS =
  /\b(?:is a solution|is the solution|works|satisfies|makes the equation true|balances)\b/i;
/** A question about someone's error: its key may quote the wrong working on purpose. */
const ERROR_SPOTTING =
  /\b(?:mistake|error|wrong|incorrect|spot|claims?|says|thinks|wrote|writes|gets|got)\b/i;

const SWAP: Record<string, string> = { yes: "no", no: "yes", true: "false", false: "true" };
function swapLead(answer: string): string {
  return answer.replace(LEAD, (_, space: string, word: string) => {
    const to = SWAP[word.toLowerCase()] ?? word;
    const cased =
      word === word.toUpperCase() && word.length > 1
        ? to.toUpperCase()
        : word[0] === word[0]?.toUpperCase()
          ? to[0]?.toUpperCase() + to.slice(1)
          : to;
    return `${space}${cased}`;
  });
}

/** What the check found in one key. */
export type KeyCatch = {
  kind: "yes-no" | "solution" | "arithmetic" | "step";
  /** The key with only its yes/no word changed, when that alone makes it right. */
  fixed?: string;
};

/** One question's key (and its working, when the writer gave one) against what code works out. */
export function checkKey(question: string, answer: string, working = ""): KeyCatch[] {
  if (!question.trim() || !answer.trim()) return [];
  const out: KeyCatch[] = [];
  const quoted = ERROR_SPOTTING.test(question);
  const sums = quoted ? 0 : wrongSums(answer).length + wrongSums(working).length;
  const asked = askedOf(question);
  if (asked?.kind === "is-solution") {
    const lead = LEAD.exec(answer);
    const said = lead ? /^(?:yes|true)$/i.test(lead[2] ?? "") : undefined;
    if (said !== undefined && said !== asked.holds) {
      const rest = answer.slice(lead?.[0].length ?? 0);
      const agrees = asked.holds ? !DENIES.test(rest) && AFFIRMS.test(rest) : DENIES.test(rest);
      out.push({
        kind: "yes-no",
        ...(agrees && wrongSums(answer).length + wrongSums(working).length === 0
          ? { fixed: swapLead(answer) }
          : {}),
      });
    }
  } else if (asked?.kind === "solve") {
    const stated = statedValues(answer, asked.variable);
    if (stated.length && !stated.some((s) => close(s.value, asked.value, s.tol)))
      out.push({ kind: "solution" });
  }
  if (sums) out.push({ kind: "arithmetic" });
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A finding with where it is on the writer's slide. */
export type SlideCatch = KeyCatch & { where: "item" | "worked" | "hinge"; index?: number };

/**
 * A writer slide's own keys: a question list's items (`{ question, answer, working }`), a worked
 * example's rows and check, a hinge's correct option.
 */
export function checkWriterSlide(s: S | undefined): SlideCatch[] {
  if (!s) return [];
  const out: SlideCatch[] = [];
  const t = str(s.template);
  if (["practice", "question-set", "exit-ticket"].includes(t) && Array.isArray(s.items))
    s.items.forEach((it0, index) => {
      const it = (it0 ?? {}) as S;
      for (const c of checkKey(str(it.question), str(it.answer), str(it.working)))
        out.push({ ...c, where: "item", index });
    });
  if (t === "worked") {
    const problem = str(s.problem) || str(s.heading);
    const asked = askedOf(problem);
    const rows = (Array.isArray(s.lines) ? s.lines : []) as (S | null)[];
    rows.forEach((r, index) => {
      const eq = str(r?.eq);
      if (!eq) return;
      const sol = solveLinear(eq);
      if (asked?.kind === "solve" && sol?.variable === asked.variable) {
        if (!close(sol.value, asked.value)) out.push({ kind: "step", where: "worked", index });
      } else if (!sol && wrongSums(eq).length)
        out.push({ kind: "arithmetic", where: "worked", index });
    });
    if (wrongSums(str(s.check)).length) out.push({ kind: "arithmetic", where: "worked" });
  }
  if (t === "hinge") {
    const asked = askedOf(str(s.stem) || str(s.heading));
    const options = (Array.isArray(s.options) ? s.options : []).map((o) =>
      typeof o === "string" ? o : str((o as S)?.text),
    );
    const correct = Number(s.correct);
    if (asked?.kind === "solve" && Number.isInteger(correct) && options[correct - 1]) {
      const values = options.map((o) => statedValues(o, asked.variable));
      const right = values[correct - 1] ?? [];
      // Only a set of value options ("x = 4", "7"), the correct one stating no true value.
      if (
        values.every((v) => v.length === 1) &&
        !right.some((v) => close(v.value, asked.value, v.tol))
      )
        out.push({ kind: "solution", where: "hinge", index: correct - 1 });
    }
  }
  return out;
}

/** The catches in one slide's notes answers (one per question, in order) and their repairs. */
export function checkNotesAnswers(
  questions: string[],
  answers: string[],
): { index: number; catches: KeyCatch[] }[] {
  if (!questions.length || questions.length !== answers.length) return [];
  return questions.flatMap((q, index) => {
    const catches = checkKey(q, answers[index] ?? "");
    return catches.length ? [{ index, catches }] : [];
  });
}

/**
 * `slide` with every string that holds `from` holding `to` there instead (a key the slide keeps in
 * its question data and may draw), or `undefined` when no string holds it.
 */
export function swapInSlide<T>(slide: T, from: string, to: string): T | undefined {
  if (!from) return undefined;
  let hit = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!v.includes(from)) return v;
      hit = true;
      return v.split(from).join(to);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(slide) as T;
  return hit ? out : undefined;
}

/** Whether a lesson's subject is maths (the check runs only there). */
export const isMaths = (subject: string | undefined) => /\bmath/i.test(subject ?? "");

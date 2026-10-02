/**
 * TEACH-179 flow round (lab only): plan the slides with the lesson's flow in mind, on a fixed count.
 *
 * Base (flow-base.v7), shared by F1 to F5: the requested slide count includes the title and objectives
 * slides, and the exit ticket comes after it, so code starts with exactly slideCount - 2 slots. An
 * opening slot when there is room for it, then the rest shared between objectives by Jev's modelling
 * score. Nothing is planned over and trimmed; the only rulings are assertions (each objective taught,
 * the count exact), kept as tests.
 *
 * Arms: F0 = structure-questions.v6 unchanged (independent per-slot choices) on the corrected count;
 * F1 = Luna arc (lesson-arc.v1), beats get slots by weight, Jev picks each slot's form with its beat and
 * the beats either side; F2 = Jev slot by slot per objective, objectives in parallel; F3 = Jev picks one
 * whole sequence per objective from a reviewed pattern table, then a lesson-level pass (opening,
 * practice, joins); F4 = one Luna call plans everything (plan-luna.v1, no Jev forms); F5 = F1 with a
 * backward-design arc (lesson-arc-backward.v1).
 */
import { type Answer, type Evaluator, type Question, yearOf } from "./lab-structure";
import {
  CHECK_INTENTS,
  type ContextV3,
  decideV3 as decideV6,
  OPENING_INTENTS,
  PRACTICE_INTENTS,
  stateV3,
  TEACH_INTENTS,
} from "./lab-structure-v6";

export const FLOW_BASE_VERSION = "flow-base.v7";
export const FLOW_QUESTIONS_VERSION = "flow-questions.v1";
export const LESSON_ARC_VERSION = "lesson-arc.v1";
export const LESSON_ARC_BACKWARD_VERSION = "lesson-arc-backward.v1";
export const PLAN_LUNA_VERSION = "plan-luna.v1";

/** Slides before the planned ones: title and objectives. The exit ticket is outside the count. */
export const FIXED_BEFORE = 2;
export const rowsFor = (slideCount: number): number => slideCount - FIXED_BEFORE;

export type Role = "retrieve" | "hook" | "teach" | "check" | "practise";
export type FlowSlot = {
  slide: number;
  role: Role;
  objective: number | null;
  idea: string;
  intent: string;
  /** The beat this slot belongs to (arc arms). */
  beat?: string;
};
export type FlowPlan = {
  arm: string;
  versions: string[];
  slots: FlowSlot[];
  /** Wall time of this arm's plan stage, including the shared modelling-score call. */
  ms: number;
  costUsd: number;
  calls: number;
  log: string[];
  extra?: unknown;
};

type Intent = { when: string; form: string; minYear?: number; subjects?: RegExp };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/* ------------------------------------------------------------------ base */

export type Budget = { rows: number; opening: 0 | 1; per: number[] };

/** Exactly `rows` slots: an opening when every objective can still have two, the rest by weight. */
export function budgets(rows: number, needs: number[]): Budget {
  const k = needs.length;
  if (rows < k) throw new Error(`${rows} planned slides cannot teach ${k} objectives`);
  const opening: 0 | 1 = rows >= 2 * k + 1 ? 1 : 0;
  const rest = rows - opening;
  const w = needs.map((n) => 1 + n);
  const raw = w.map((x) => (x / sum(w)) * rest);
  const per = raw.map((x) => Math.max(1, Math.floor(x)));
  while (sum(per) > rest) {
    let at = -1;
    for (let i = 0; i < k; i++)
      if (
        (per[i] ?? 0) > 1 &&
        (at < 0 || (raw[i] ?? 0) - (per[i] ?? 0) < (raw[at] ?? 0) - (per[at] ?? 0))
      )
        at = i;
    per[at] = (per[at] ?? 1) - 1;
  }
  while (sum(per) < rest) {
    let at = 0;
    for (let i = 1; i < k; i++)
      if ((raw[i] ?? 0) - (per[i] ?? 0) > (raw[at] ?? 0) - (per[at] ?? 0)) at = i;
    per[at] = (per[at] ?? 0) + 1;
  }
  return { rows, opening, per };
}

/** The modelling score per objective (v5/v6 wording), one Jev call. */
export function needQuestions(c: ContextV3): Record<string, Question> {
  return Object.fromEntries(
    c.objectives.map((o, i) => [
      `o${i + 1}_need`,
      {
        type: "score",
        instructions: `How much teaching and modelling does objective ${i + 1} need in this lesson: ${o.text}?`,
        criteria: [
          "light: familiar or simple for these pupils; a short explanation is enough",
          "standard: new but straightforward; teach it with its case",
          "heavy: hard for these pupils, or foundational: later objectives in this lesson build on it, so it needs teaching and a model",
          "heaviest: the lesson's core method or idea, hard and foundational; it needs teaching, a worked model and a second case",
        ],
      } satisfies Question,
    ]),
  );
}

export const readNeeds = (c: ContextV3, a: Record<string, Answer>): number[] =>
  c.objectives.map((_, i) => {
    const x = a[`o${i + 1}_need`];
    return x?.type === "score" && Number.isFinite(x.score) ? Math.max(0, Math.min(3, x.score)) : 1;
  });

/** Every objective taught and the count exact: the two rulings, asserted (tests call this). */
export function rulingFaults(c: ContextV3, slots: FlowSlot[]): string[] {
  const out: string[] = [];
  if (slots.length !== c.rows) out.push(`count: ${slots.length} slots for ${c.rows} rows`);
  c.objectives.forEach((_, i) => {
    if (!slots.some((s) => s.role === "teach" && s.objective === i + 1))
      out.push(`objective ${i + 1} not taught`);
  });
  return out;
}

const OPENING_ROLE: Record<string, "retrieve" | "hook"> = {
  "quick-questions": "retrieve",
  "match-terms": "retrieve",
  "odd-one-out": "retrieve",
  "picture-hook": "hook",
  "question-hook": "hook",
  prediction: "hook",
  discussion: "hook",
};

export function menuFor(role: Role, c: ContextV3): Record<string, string> {
  const m: Record<string, Intent> =
    role === "teach"
      ? TEACH_INTENTS
      : role === "check"
        ? CHECK_INTENTS
        : role === "practise"
          ? PRACTICE_INTENTS
          : OPENING_INTENTS;
  const y = yearOf(c.yearGroup);
  return Object.fromEntries(
    Object.entries(m)
      .filter(([k, i]) => (i.minYear ?? 0) <= y && (!i.subjects || i.subjects.test(c.subject)))
      .filter(([k]) => (role === "retrieve" || role === "hook" ? OPENING_ROLE[k] === role : true))
      .map(([k, i]) => [k, `${k}: ${i.when}`]),
  );
}

/** Ideas for slots that carry none: key ideas in order over each objective's teach slots. */
function fillIdeas(c: ContextV3, slots: FlowSlot[]): FlowSlot[] {
  const next = c.objectives.map(() => 0);
  return slots.map((s) => {
    if (s.idea) return s;
    if (s.role === "retrieve")
      return {
        ...s,
        idea: `earlier learning: ${c.priorKnowledge[0] ?? "what this lesson builds on"}`,
      };
    if (s.role === "hook") return { ...s, idea: `the lesson's question about ${c.topic}` };
    if (s.role === "practise") return { ...s, idea: "all the objectives" };
    const o = c.objectives[(s.objective ?? 1) - 1];
    const ideas = o?.keyIdeas.length ? o.keyIdeas : [o?.text ?? ""];
    if (s.role === "check") return { ...s, idea: "what the slides just before taught" };
    const n = next[(s.objective ?? 1) - 1] ?? 0;
    next[(s.objective ?? 1) - 1] = n + 1;
    const idea = ideas[n % ideas.length] ?? "";
    return { ...s, idea: n >= ideas.length ? `a second case: ${idea}` : idea };
  });
}

const number = (slots: Omit<FlowSlot, "slide">[]): FlowSlot[] =>
  slots.map((s, i) => ({ ...s, slide: i + FIXED_BEFORE + 1 }));

/* ------------------------------------------------------------------ F0 */

export async function planF0(c: ContextV3, evaluate: Evaluator, model: string): Promise<FlowPlan> {
  const t0 = Date.now();
  const p = await decideV6(c, evaluate, model);
  const slots: FlowSlot[] = p.slots.map((s) => ({
    slide: s.slide,
    role: (s.role === "hinge" ? "check" : s.role) as Role,
    objective: s.objective,
    idea: s.idea,
    intent: s.intent,
  }));
  return {
    arm: "F0",
    versions: [p.version],
    slots,
    ms: Date.now() - t0,
    costUsd: p.costUsd,
    calls: 2,
    log: p.r1.guards.map((g) => `guard ${g.guard}: ${g.what}`),
  };
}

/* ------------------------------------------------------------------ F2 */

/** Jev slot by slot inside each objective; objectives (and the opening) in parallel. */
export async function planF2(
  c: ContextV3,
  evaluate: Evaluator,
  b: Budget,
): Promise<Omit<FlowPlan, "ms">> {
  const state = `${stateV3(c)}\nSlides per objective: ${b.per.map((n, i) => `objective ${i + 1}: ${n}`).join("; ")}. The last slide of the last objective is pupils' practice alone.`;
  let cost = 0;
  let calls = 0;
  const ask = async (q: Record<string, Question>) => {
    const r = await evaluate(state, q);
    cost += r.costUsd ?? 0;
    calls++;
    return r.answers;
  };
  const opening = async (): Promise<Omit<FlowSlot, "slide">[]> => {
    if (!b.opening) return [];
    const crit = { ...menuFor("retrieve", c), ...menuFor("hook", c) };
    const a = await ask({
      open: {
        type: "choice",
        instructions:
          "The lesson's first slide after the objectives: recall the earlier learning it builds on, or a hook. Which fits best?",
        criteria: crit,
      },
    });
    const k = a.open?.type === "choice" ? a.open.choice : "quick-questions";
    return [{ role: OPENING_ROLE[k] ?? "retrieve", objective: null, idea: "", intent: k }];
  };
  const objective = async (i: number): Promise<Omit<FlowSlot, "slide">[]> => {
    const n = b.per[i] ?? 1;
    const last = i === c.objectives.length - 1;
    const o = c.objectives[i];
    const ideas = o?.keyIdeas.length ? o.keyIdeas : [o?.text ?? ""];
    const out: Omit<FlowSlot, "slide">[] = [];
    let taught = 0;
    for (let j = 0; j < n; j++) {
      const roles: Role[] =
        j === 0 ? ["teach"] : last && j === n - 1 && n >= 2 ? ["practise"] : ["teach", "check"];
      const crit: Record<string, string> = {};
      for (const r of roles)
        for (const [k, v] of Object.entries(menuFor(r, c))) crit[`${r}:${k}`] = `${r}: ${v}`;
      const done = out.map((s, m) => `slide ${m + 1} ${s.role} ${s.intent}`).join("; ");
      const nextIdea =
        taught < ideas.length
          ? `the next idea to teach is: ${ideas[taught]}`
          : "every key idea has been taught once";
      const a = await ask({
        s: {
          type: "choice",
          instructions: `Objective ${i + 1}: ${o?.text} It has ${n} slides. ${done ? `Its slides so far: ${done}.` : "This is its first slide."} This is slide ${j + 1} of ${n}; ${nextIdea}. What should this slide be?`,
          criteria: crit,
        },
      });
      const pick = a.s?.type === "choice" ? a.s.choice : `${roles[0]}:explain`;
      const [role, intent] = pick.split(":") as [Role, string];
      if (role === "teach") taught++;
      out.push({ role, objective: i + 1, idea: "", intent });
    }
    return out;
  };
  const parts = await Promise.all([opening(), ...c.objectives.map((_, i) => objective(i))]);
  return {
    arm: "F2",
    versions: [FLOW_BASE_VERSION, FLOW_QUESTIONS_VERSION],
    slots: fillIdeas(c, number(parts.flat())),
    costUsd: cost,
    calls,
    log: [],
  };
}

/* ------------------------------------------------------------------ F3 */

/**
 * Reviewed patterns for one objective's slides (practice is added by code after the last objective's
 * pattern). Each starts by teaching. `when` says which content the sequence suits.
 */
export const FLOW_PATTERNS: { id: string; when: string; steps: [Role, string][] }[] = [
  { id: "a", when: "one plain idea", steps: [["teach", "explain"]] },
  { id: "b", when: "one idea with a visual shape", steps: [["teach", "diagram"]] },
  { id: "c", when: "one method shown once", steps: [["teach", "worked-example"]] },
  { id: "d", when: "one thing pupils need to see", steps: [["teach", "photo"]] },
  { id: "e", when: "two things set side by side", steps: [["teach", "compare"]] },
  { id: "f", when: "one text read closely", steps: [["teach", "text-extract"]] },
  {
    id: "g",
    when: "a plain idea, then recall",
    steps: [
      ["teach", "explain"],
      ["check", "quick-questions"],
    ],
  },
  {
    id: "h",
    when: "a structure or process to label",
    steps: [
      ["teach", "diagram"],
      ["check", "label-diagram"],
    ],
  },
  {
    id: "i",
    when: "a method modelled, then tried together",
    steps: [
      ["teach", "worked-example"],
      ["teach", "guided-practice"],
    ],
  },
  {
    id: "j",
    when: "a method modelled, then an error to find",
    steps: [
      ["teach", "worked-example"],
      ["check", "spot-mistake"],
    ],
  },
  {
    id: "k",
    when: "something seen, then matched (young pupils)",
    steps: [
      ["teach", "photo"],
      ["check", "match-pictures"],
    ],
  },
  {
    id: "l",
    when: "a contrast, then a misconception judged",
    steps: [
      ["teach", "compare"],
      ["check", "true-false"],
    ],
  },
  {
    id: "m",
    when: "a text read, then answered in sentences",
    steps: [
      ["teach", "text-extract"],
      ["check", "short-answer"],
    ],
  },
  {
    id: "n",
    when: "new terms, then matched",
    steps: [
      ["teach", "vocabulary"],
      ["check", "match-terms"],
    ],
  },
  {
    id: "o",
    when: "a common mistake named, then judged",
    steps: [
      ["teach", "explain-mistake"],
      ["check", "true-false"],
    ],
  },
  {
    id: "p",
    when: "a model piece of writing, then a sentence of their own",
    steps: [
      ["teach", "model-text"],
      ["check", "short-answer"],
    ],
  },
  {
    id: "q",
    when: "a plain idea, a method on it, then recall",
    steps: [
      ["teach", "explain"],
      ["teach", "worked-example"],
      ["check", "quick-questions"],
    ],
  },
  {
    id: "r",
    when: "a structure drawn, explained, then labelled",
    steps: [
      ["teach", "diagram"],
      ["teach", "explain"],
      ["check", "label-diagram"],
    ],
  },
  {
    id: "s",
    when: "a method modelled, tried together, then checked",
    steps: [
      ["teach", "worked-example"],
      ["teach", "guided-practice"],
      ["check", "multiple-choice"],
    ],
  },
  {
    id: "t",
    when: "something seen, explained, then a misconception judged",
    steps: [
      ["teach", "photo"],
      ["teach", "explain"],
      ["check", "true-false"],
    ],
  },
  {
    id: "u",
    when: "terms introduced, used in an explanation, then matched",
    steps: [
      ["teach", "vocabulary"],
      ["teach", "explain"],
      ["check", "match-terms"],
    ],
  },
  {
    id: "v",
    when: "a text read, compared with another view, then answered",
    steps: [
      ["teach", "text-extract"],
      ["teach", "compare"],
      ["check", "short-answer"],
    ],
  },
  {
    id: "w",
    when: "a contrast, a mistake named, then a hinge question",
    steps: [
      ["teach", "compare"],
      ["teach", "explain-mistake"],
      ["check", "multiple-choice"],
    ],
  },
  {
    id: "x",
    when: "pupils reason first, then are taught, then judge statements",
    steps: [
      ["teach", "discussion"],
      ["teach", "explain"],
      ["check", "true-false"],
    ],
  },
  {
    id: "y",
    when: "steps in order, drawn, then put in order",
    steps: [
      ["teach", "sequence"],
      ["teach", "diagram"],
      ["check", "order"],
    ],
  },
  {
    id: "z",
    when: "a source examined, explained, then answered",
    steps: [
      ["teach", "artefact"],
      ["teach", "explain"],
      ["check", "short-answer"],
    ],
  },
  {
    id: "aa",
    when: "say, show, do together, check: a method",
    steps: [
      ["teach", "explain"],
      ["teach", "worked-example"],
      ["teach", "guided-practice"],
      ["check", "multiple-choice"],
    ],
  },
  {
    id: "ab",
    when: "a structure drawn, explained, used in a worked case, recalled",
    steps: [
      ["teach", "diagram"],
      ["teach", "explain"],
      ["teach", "worked-example"],
      ["check", "quick-questions"],
    ],
  },
  {
    id: "ac",
    when: "terms, a structure, its explanation, labelled",
    steps: [
      ["teach", "vocabulary"],
      ["teach", "diagram"],
      ["teach", "explain"],
      ["check", "label-diagram"],
    ],
  },
  {
    id: "ad",
    when: "seen, explained, contrasted, misconception judged",
    steps: [
      ["teach", "photo"],
      ["teach", "explain"],
      ["teach", "compare"],
      ["check", "true-false"],
    ],
  },
  {
    id: "ae",
    when: "a text read, explained, a model answer, then written",
    steps: [
      ["teach", "text-extract"],
      ["teach", "explain"],
      ["teach", "model-text"],
      ["check", "short-answer"],
    ],
  },
  {
    id: "af",
    when: "a method on two cases, tried together, an error found",
    steps: [
      ["teach", "worked-example"],
      ["teach", "worked-example"],
      ["teach", "guided-practice"],
      ["check", "spot-mistake"],
    ],
  },
  {
    id: "ag",
    when: "reason first, taught, mistake named, hinge",
    steps: [
      ["teach", "discussion"],
      ["teach", "explain"],
      ["teach", "explain-mistake"],
      ["check", "multiple-choice"],
    ],
  },
  {
    id: "ah",
    when: "a source, a contrast, an explanation, answered",
    steps: [
      ["teach", "artefact"],
      ["teach", "compare"],
      ["teach", "explain"],
      ["check", "short-answer"],
    ],
  },
  {
    id: "ai",
    when: "steps, drawn, a mistake named, put in order",
    steps: [
      ["teach", "sequence"],
      ["teach", "diagram"],
      ["teach", "explain-mistake"],
      ["check", "order"],
    ],
  },
  {
    id: "aj",
    when: "terms, explanation, method modelled, tried together, checked",
    steps: [
      ["teach", "vocabulary"],
      ["teach", "explain"],
      ["teach", "worked-example"],
      ["teach", "guided-practice"],
      ["check", "multiple-choice"],
    ],
  },
  {
    id: "ak",
    when: "explanation, a method on two cases, tried together, error found",
    steps: [
      ["teach", "explain"],
      ["teach", "worked-example"],
      ["teach", "worked-example"],
      ["teach", "guided-practice"],
      ["check", "spot-mistake"],
    ],
  },
  {
    id: "al",
    when: "seen, drawn, explained, contrasted, misconception judged",
    steps: [
      ["teach", "photo"],
      ["teach", "diagram"],
      ["teach", "explain"],
      ["teach", "compare"],
      ["check", "true-false"],
    ],
  },
  {
    id: "am",
    when: "a text, explained, modelled, tried together, written",
    steps: [
      ["teach", "text-extract"],
      ["teach", "explain"],
      ["teach", "model-text"],
      ["teach", "guided-practice"],
      ["check", "short-answer"],
    ],
  },
  {
    id: "an",
    when: "drawn, explained, mistake named, a worked case, recalled",
    steps: [
      ["teach", "diagram"],
      ["teach", "explain"],
      ["teach", "explain-mistake"],
      ["teach", "worked-example"],
      ["check", "quick-questions"],
    ],
  },
  {
    id: "ao",
    when: "reason first, a source, explained, contrasted, answered",
    steps: [
      ["teach", "discussion"],
      ["teach", "artefact"],
      ["teach", "explain"],
      ["teach", "compare"],
      ["check", "short-answer"],
    ],
  },
  {
    id: "ap",
    when: "terms, explanation, a method on two cases, together, checked",
    steps: [
      ["teach", "vocabulary"],
      ["teach", "explain"],
      ["teach", "worked-example"],
      ["teach", "worked-example"],
      ["teach", "guided-practice"],
      ["check", "multiple-choice"],
    ],
  },
  {
    id: "aq",
    when: "seen, drawn, explained, contrasted, mistake named, judged",
    steps: [
      ["teach", "photo"],
      ["teach", "diagram"],
      ["teach", "explain"],
      ["teach", "compare"],
      ["teach", "explain-mistake"],
      ["check", "true-false"],
    ],
  },
  {
    id: "ar",
    when: "a text, explained, modelled, contrasted, together, written",
    steps: [
      ["teach", "text-extract"],
      ["teach", "explain"],
      ["teach", "model-text"],
      ["teach", "compare"],
      ["teach", "guided-practice"],
      ["check", "short-answer"],
    ],
  },
];

const patternLine = (p: (typeof FLOW_PATTERNS)[number]) =>
  `${p.steps.map(([, k]) => k).join(" -> ")}: ${p.when}`;

/** Patterns of exactly `len` slides whose forms this class can use; longer budgets repeat a teach slide. */
export function patternsFor(c: ContextV3, len: number): (typeof FLOW_PATTERNS)[number][] {
  const ok = (r: Role, k: string) => k in menuFor(r, c);
  const usableP = FLOW_PATTERNS.filter((p) => p.steps.every(([r, k]) => ok(r, k)));
  const exact = usableP.filter((p) => p.steps.length === len);
  if (exact.length || len <= 0) return exact;
  // Longer than the table: the longest patterns with a second worked case or explanation before the check.
  return usableP
    .filter((p) => p.steps.length === 6)
    .map((p) => {
      const steps = [...p.steps];
      while (steps.length < len) steps.splice(steps.length - 1, 0, ["teach", "explain"]);
      return { ...p, id: `${p.id}+`, steps };
    });
}

export async function planF3(
  c: ContextV3,
  evaluate: Evaluator,
  b: Budget,
): Promise<Omit<FlowPlan, "ms">> {
  const k = c.objectives.length;
  const state = stateV3(c);
  const log: string[] = [];
  const lens = b.per.map((n, i) => (i === k - 1 && n >= 2 ? n - 1 : n));
  const cands = lens.map((n) => patternsFor(c, n));
  const q1: Record<string, Question> = {};
  cands.forEach((cs, i) => {
    if (cs.length > 1)
      q1[`o${i + 1}`] = {
        type: "choice",
        instructions: `Objective ${i + 1}: ${c.objectives[i]?.text} Key ideas: ${c.objectives[i]?.keyIdeas.join("; ")}. It has ${lens[i]} slides${i === k - 1 && (b.per[i] ?? 0) >= 2 ? ", then pupils practise alone" : ""}. Which sequence of slides teaches it best?`,
        criteria: Object.fromEntries(cs.map((p) => [p.id, patternLine(p)])),
      };
  });
  const r1 = await evaluate(state, q1);
  let cost = r1.costUsd ?? 0;
  const ranked = cands.map((cs, i) => {
    const a = r1.answers[`o${i + 1}`];
    if (a?.type !== "choice") return cs;
    return [...cs].sort((x, y) => (a.probabilities[y.id] ?? 0) - (a.probabilities[x.id] ?? 0));
  });
  const pick = ranked.map((cs) => cs[0]);
  const desc = (i: number) => pick[i]?.steps.map(([, s]) => s).join(" -> ") ?? "";
  const state2 = `${state}\nChosen sequences: ${pick.map((_, i) => `objective ${i + 1}: ${desc(i)}`).join("; ")}.`;
  const q2: Record<string, Question> = {};
  if (b.opening)
    q2.open = {
      type: "choice",
      instructions: `The lesson's first slide, before objective 1 (${desc(0)}): recall earlier learning, or a hook. Which fits best?`,
      criteria: { ...menuFor("retrieve", c), ...menuFor("hook", c) },
    };
  if ((b.per[k - 1] ?? 0) >= 2)
    q2.practise = {
      type: "choice",
      instructions:
        "The last slide: pupils practise alone on the whole lesson. Which form fits best?",
      criteria: menuFor("practise", c),
    };
  for (let i = 0; i + 1 < k; i++)
    q2[`join${i + 1}`] = {
      type: "boolean",
      instructions: `Objective ${i + 1} ends with ${pick[i]?.steps.at(-1)?.[1]} and objective ${i + 2} starts with ${pick[i + 1]?.steps[0]?.[1]}. Does the lesson flow well across this join, with no jarring repeat?`,
    };
  const r2 = await evaluate(state2, q2);
  cost += r2.costUsd ?? 0;
  for (let i = 0; i + 1 < k; i++) {
    const a = r2.answers[`join${i + 1}`];
    if (a?.type === "boolean" && a.probability < 0.5 && (ranked[i + 1]?.length ?? 0) > 1) {
      pick[i + 1] = ranked[i + 1]?.[1];
      log.push(
        `join ${i + 1}->${i + 2} judged rough (${a.probability.toFixed(2)}): objective ${i + 2} takes its next sequence`,
      );
    }
  }
  const slots: Omit<FlowSlot, "slide">[] = [];
  if (b.opening) {
    const kk = r2.answers.open?.type === "choice" ? r2.answers.open.choice : "quick-questions";
    slots.push({ role: OPENING_ROLE[kk] ?? "retrieve", objective: null, idea: "", intent: kk });
  }
  pick.forEach((p, i) => {
    for (const [role, intent] of p?.steps ?? [["teach", "explain"]])
      slots.push({ role, objective: i + 1, idea: "", intent });
  });
  if ((b.per[k - 1] ?? 0) >= 2) {
    const pr = r2.answers.practise?.type === "choice" ? r2.answers.practise.choice : "items";
    slots.push({ role: "practise", objective: k, idea: "", intent: pr });
  }
  return {
    arm: "F3",
    versions: [FLOW_BASE_VERSION, FLOW_QUESTIONS_VERSION],
    slots: fillIdeas(c, number(slots)),
    costUsd: cost,
    calls: 2,
    log,
    extra: { picks: pick.map((p) => p?.id) },
  };
}

/* ------------------------------------------------------------------ Luna calls */

export type Llm = (
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
) => Promise<{ json: unknown; ms: number; costUsd: number }>;

/** OpenAI Responses, strict json_schema, effort low. gpt-6-luna: $0.10 in, $0.01 cached, $0.50 out per 1M. */
export function openaiLlm(
  model: string,
  apiKey: string,
  price = { in: 0.1, cached: 0.01, out: 0.5 },
): Llm {
  return async (system, user, name, schema) => {
    const t0 = Date.now();
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        input: [
          { role: "developer", content: system },
          { role: "user", content: user },
        ],
        text: { format: { type: "json_schema", name, schema, strict: true }, verbosity: "low" },
        store: false,
      }),
    });
    const d = (await res.json()) as {
      error?: { message: string };
      output?: { type: string; content?: { type: string; text?: string }[] }[];
      usage?: {
        input_tokens: number;
        output_tokens: number;
        input_tokens_details?: { cached_tokens?: number };
      };
    };
    if (!res.ok || d.error) throw new Error(`openai ${res.status}: ${d.error?.message ?? ""}`);
    const text =
      d.output?.flatMap((o) => o.content ?? []).find((x) => x.type === "output_text")?.text ?? "{}";
    const u = d.usage;
    const cached = u?.input_tokens_details?.cached_tokens ?? 0;
    const costUsd = u
      ? ((u.input_tokens - cached) * price.in +
          cached * price.cached +
          u.output_tokens * price.out) /
        1e6
      : 0;
    return { json: JSON.parse(text), ms: Date.now() - t0, costUsd };
  };
}

function lessonLines(c: ContextV3, b: Budget): string[] {
  const y = yearOf(c.yearGroup);
  return [
    `Lesson: ${c.topic}`,
    `${c.yearGroup} (aged ${y + 4} to ${y + 5}), ${c.subject}, ${c.minutes} minutes. ${y >= 12 ? "These pupils sit A level in this subject." : y >= 10 ? "These pupils sit GCSE in this subject." : "No public exam this year."}`,
    `Pupils already know: ${c.priorKnowledge.join("; ") || "not stated"}`,
    `Misconception to confront: ${c.misconception || "none stated"}`,
    `Opening slide: ${b.opening ? "one" : "none (no room)"}`,
    "Objectives, in order, with their key ideas and slides:",
    ...c.objectives.map(
      (o, i) =>
        `${i + 1}. ${o.text} Key ideas: ${o.keyIdeas.join("; ") || "as stated"}. Slides: ${b.per[i]}.`,
    ),
  ];
}

/* ------------------------------------------------------------------ F1 / F5: arc, then Jev forms */

const BEAT_KINDS = ["teach", "model", "check", "apply"] as const;
type Beat = {
  kind: (typeof BEAT_KINDS)[number];
  subObjective: string;
  purpose: string;
  weight: number;
};
type Arc = {
  goals?: { exitQuestions: string[]; practiceTask: string };
  opening: { kind: "retrieve" | "hook" | "none"; subObjective: string; purpose: string };
  objectives: { objective: number; beats: Beat[] }[];
};

const BEAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "subObjective", "purpose", "weight"],
  properties: {
    kind: { type: "string", enum: [...BEAT_KINDS] },
    subObjective: { type: "string" },
    purpose: { type: "string" },
    weight: { type: "integer", enum: [1, 2, 3] },
  },
};
const ARC_BODY = {
  opening: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "subObjective", "purpose"],
    properties: {
      kind: { type: "string", enum: ["retrieve", "hook", "none"] },
      subObjective: { type: "string" },
      purpose: { type: "string" },
    },
  },
  objectives: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["objective", "beats"],
      properties: { objective: { type: "integer" }, beats: { type: "array", items: BEAT_SCHEMA } },
    },
  },
};
export const ARC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["opening", "objectives"],
  properties: ARC_BODY,
};
export const ARC_BACKWARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["goals", "opening", "objectives"],
  properties: {
    goals: {
      type: "object",
      additionalProperties: false,
      required: ["exitQuestions", "practiceTask"],
      properties: {
        exitQuestions: { type: "array", items: { type: "string" } },
        practiceTask: { type: "string" },
      },
    },
    ...ARC_BODY,
  },
};

const ARC_CORE = `A beat is one step in the lesson's flow. Each beat has:
- kind: teach (pupils meet an idea, explained, shown or compared), model (the teacher shows a method or a piece of writing step by step before pupils try it), check (pupils show they understood what the beats just before taught), or apply (pupils use what they learned on their own);
- subObjective: what pupils can do after this beat, in one short sentence;
- purpose: why this beat comes here, in one short sentence;
- weight: how many of its objective's slides the beat deserves, from 1 to 3, relative to that objective's other beats.

Opening: when the Opening slide line says one, write one beat before objective 1: retrieve (recall the earlier learning this lesson builds on) or hook (a question or case that makes pupils want the answer). When it says none, its kind is none and its two sentences are empty.

For each objective, in order, write its beats. An objective's beats share its slides, so it has at least one beat and no more beats than its Slides number. Its first beat is teach or model. An objective with two or more slides has a check beat after its teaching. The last objective's last beat is apply, on the whole lesson, when it has two or more slides; that is the only apply beat, so before it pupils use what they learned in check beats. Each beat follows from the one before it: an idea is built before pupils use it, and a method is modelled before pupils try it.`;

export const LESSON_ARC_SYSTEM = `You plan the flow of one school lesson as a sequence of beats, the way an experienced teacher sketches a lesson before making its slides. The user message gives the lesson, its objectives with their key ideas and how many slides each has, and whether there is an opening slide.

${ARC_CORE}`;

export const LESSON_ARC_BACKWARD_SYSTEM = `You plan the flow of one school lesson backwards from where it ends, the way an experienced teacher designs a lesson before making its slides. The user message gives the lesson, its objectives with their key ideas and how many slides each has, and whether there is an opening slide.

First write goals: for each objective, in order, the exit question that shows a pupil has met it (exitQuestions, one per objective), and the practice task pupils do alone at the end of the lesson (practiceTask). Then plan the beats that build up to them: every beat gives pupils something the practice task or an exit question needs.

${ARC_CORE}`;

/** Code gives beats slots by weight inside each objective's budget. */
export function allocateBeats(
  c: ContextV3,
  b: Budget,
  arc: Arc,
): { slots: FlowSlot[]; log: string[] } {
  const log: string[] = [];
  const k = c.objectives.length;
  const out: Omit<FlowSlot, "slide">[] = [];
  if (b.opening) {
    const kind = arc.opening.kind === "none" ? "retrieve" : arc.opening.kind;
    if (arc.opening.kind === "none") log.push("arc gave no opening beat; retrieve used");
    out.push({
      role: kind,
      objective: null,
      idea: arc.opening.subObjective,
      intent: "",
      beat: `${kind}: ${arc.opening.subObjective} (${arc.opening.purpose})`,
    });
  } else if (arc.opening.kind !== "none") log.push("opening beat unplaced: no room");
  for (let i = 0; i < k; i++) {
    const n = b.per[i] ?? 1;
    let beats = arc.objectives.find((o) => o.objective === i + 1)?.beats ?? [];
    if (!beats.length) {
      beats = [
        { kind: "teach", subObjective: c.objectives[i]?.text ?? "", purpose: "", weight: 1 },
      ];
      log.push(`objective ${i + 1}: arc gave no beats; one teach beat used`);
    }
    if (beats.length > n) {
      // The first teaching beat and the lesson's closing apply beat are kept; the rest by weight.
      const keep = new Set<number>([
        beats.findIndex((x) => x.kind === "teach" || x.kind === "model"),
      ]);
      const apply = beats.findLastIndex((x) => x.kind === "apply");
      if (i === k - 1 && apply >= 0 && n >= 2) keep.add(apply);
      const order = beats
        .map((x, j) => [x.weight, j] as const)
        .sort((x, y) => y[0] - x[0] || x[1] - y[1]);
      for (const [, j] of order) if (keep.size < n) keep.add(j);
      const dropped = beats.filter((_, j) => !keep.has(j));
      log.push(
        `objective ${i + 1}: ${beats.length} beats for ${n} slides; unplaced: ${dropped.map((x) => x.kind).join(", ")}`,
      );
      beats = beats.filter((_, j) => keep.has(j));
    }
    const w = beats.map((x) => Math.max(1, x.weight));
    const raw = w.map((x) => (x / sum(w)) * n);
    const per = raw.map(() => 1);
    while (sum(per) < n) {
      let at = 0;
      for (let j = 1; j < per.length; j++)
        if ((raw[j] ?? 0) - (per[j] ?? 0) > (raw[at] ?? 0) - (per[at] ?? 0)) at = j;
      per[at] = (per[at] ?? 0) + 1;
    }
    const last = i === k - 1;
    beats.forEach((x, j) => {
      const role: Role =
        x.kind === "check" ? "check" : x.kind === "apply" ? (last ? "practise" : "check") : "teach";
      for (let m = 0; m < (per[j] ?? 1); m++)
        out.push({
          role,
          objective: i + 1,
          idea: x.subObjective,
          intent: "",
          beat: `${x.kind}: ${x.subObjective} (${x.purpose})${(per[j] ?? 1) > 1 ? ` [slide ${m + 1} of ${per[j]}]` : ""}`,
        });
    });
    const mine = out.filter((s) => s.objective === i + 1);
    const firstMine = mine[0];
    if (firstMine && !mine.some((s) => s.role === "teach")) {
      firstMine.role = "teach";
      log.push(`objective ${i + 1}: no teach beat; first slot teaches`);
    }
  }
  return { slots: number(out), log };
}

/** Jev picks each slot's form, with its beat and the beats either side in the question. */
export async function formsForBeats(
  c: ContextV3,
  evaluate: Evaluator,
  slots: FlowSlot[],
): Promise<{ slots: FlowSlot[]; costUsd: number }> {
  const q: Record<string, Question> = {};
  slots.forEach((s, n) => {
    const prev = slots[n - 1]?.beat ?? "the objectives slide";
    const next = slots[n + 1]?.beat ?? "the exit ticket";
    q[`s${s.slide}`] = {
      type: "choice",
      instructions: `Slide ${s.slide}${s.objective ? ` (objective ${s.objective})` : ""}, a ${s.role} slide in the beat: ${s.beat}. The slide before: ${prev}. The slide after: ${next}. Which form fits this slide best?`,
      criteria: menuFor(s.role, c),
    };
  });
  const r = await evaluate(stateV3(c), q);
  return {
    slots: slots.map((s) => {
      const a = r.answers[`s${s.slide}`];
      return {
        ...s,
        intent: a?.type === "choice" ? a.choice : (Object.keys(menuFor(s.role, c))[0] ?? "explain"),
      };
    }),
    costUsd: r.costUsd ?? 0,
  };
}

export async function planArc(
  arm: "F1" | "F5",
  c: ContextV3,
  evaluate: Evaluator,
  llm: Llm,
  b: Budget,
): Promise<Omit<FlowPlan, "ms">> {
  const backward = arm === "F5";
  const a = await llm(
    backward ? LESSON_ARC_BACKWARD_SYSTEM : LESSON_ARC_SYSTEM,
    lessonLines(c, b).join("\n"),
    "lesson_arc",
    backward ? ARC_BACKWARD_SCHEMA : ARC_SCHEMA,
  );
  const arc = a.json as Arc;
  const { slots, log } = allocateBeats(c, b, arc);
  const f = await formsForBeats(c, evaluate, slots);
  return {
    arm,
    versions: [
      FLOW_BASE_VERSION,
      backward ? LESSON_ARC_BACKWARD_VERSION : LESSON_ARC_VERSION,
      FLOW_QUESTIONS_VERSION,
    ],
    slots: f.slots,
    costUsd: a.costUsd + f.costUsd,
    calls: 2,
    log,
    extra: { arc, arcMs: a.ms },
  };
}

/* ------------------------------------------------------------------ F4: Luna plans everything */

const ALL_FORMS = [
  ...new Set([
    ...Object.keys(TEACH_INTENTS),
    ...Object.keys(CHECK_INTENTS),
    ...Object.keys(PRACTICE_INTENTS),
    ...Object.keys(OPENING_INTENTS),
  ]),
];

export const PLAN_LUNA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slides"],
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objective", "beat", "role", "idea", "form"],
        properties: {
          objective: { type: "integer" },
          beat: { type: "string" },
          role: { type: "string", enum: ["retrieve", "hook", "teach", "check", "practise"] },
          idea: { type: "string" },
          form: { type: "string", enum: ALL_FORMS },
        },
      },
    },
  },
};

export function planLunaSystem(c: ContextV3): string {
  const block = (title: string, r: Role) =>
    [`${title}:`, ...Object.values(menuFor(r, c)).map((x) => `- ${x}`)].join("\n");
  return `You plan the slides of one school lesson the way an experienced teacher sketches it: as a flow, each slide following from the one before. The user message gives the lesson, its objectives with their key ideas and how many slides each has, and whether there is an opening slide.

Write the slides in order: the opening slide when there is one (objective 0), then each objective's slides in turn (its number), exactly as many as its Slides number. Each slide has:
- objective: 0 for the opening, otherwise the objective it serves;
- beat: what this slide does in the lesson's flow and why it comes here, in one short sentence;
- role: retrieve or hook for the opening; teach or check for an objective's slides; practise for the last objective's last slide when it has two or more slides;
- idea: the idea the slide teaches or checks;
- form: one form from the list for its role.

Each objective's first slide teaches, and an objective with two or more slides has a check after its teaching. An idea is built before pupils use it, and a method is modelled before pupils try it.

${block("Forms for retrieve", "retrieve")}
${block("Forms for hook", "hook")}
${block("Forms for teach", "teach")}
${block("Forms for check", "check")}
${block("Forms for practise", "practise")}`;
}

export async function planF4(c: ContextV3, llm: Llm, b: Budget): Promise<Omit<FlowPlan, "ms">> {
  const system = planLunaSystem(c);
  const user = lessonLines(c, b).join("\n");
  type S = { objective: number; beat: string; role: Role; idea: string; form: string };
  const faults = (ss: S[]): string[] => {
    const f: string[] = [];
    if (ss.length !== b.rows) f.push(`${ss.length} slides; the lesson needs exactly ${b.rows}`);
    b.per.forEach((n, i) => {
      const got = ss.filter((s) => s.objective === i + 1).length;
      if (got !== n) f.push(`objective ${i + 1} has ${got} slides; it needs exactly ${n}`);
    });
    ss.forEach((s, j) => {
      if (!(s.form in menuFor(s.role, c)))
        f.push(`slide ${j + 1}: form ${s.form} is not in the ${s.role} list`);
    });
    return f;
  };
  let r = await llm(system, user, "lesson_plan", PLAN_LUNA_SCHEMA);
  let cost = r.costUsd;
  let calls = 1;
  let ss = (r.json as { slides: S[] }).slides ?? [];
  const log: string[] = [];
  let f = faults(ss);
  if (f.length) {
    log.push(`retry: ${f.join("; ")}`);
    r = await llm(
      system,
      `${user}\n\nYour last plan had these problems; fix them: ${f.join("; ")}.`,
      "lesson_plan",
      PLAN_LUNA_SCHEMA,
    );
    cost += r.costUsd;
    calls++;
    ss = (r.json as { slides: S[] }).slides ?? [];
    f = faults(ss);
    if (f.length) log.push(`still: ${f.join("; ")}`);
  }
  return {
    arm: "F4",
    versions: [FLOW_BASE_VERSION, PLAN_LUNA_VERSION],
    slots: number(
      ss.map((s) => ({
        role: s.role,
        objective: s.objective > 0 ? s.objective : null,
        idea: s.idea,
        intent: s.form,
        beat: s.beat,
      })),
    ),
    costUsd: cost,
    calls,
    log,
  };
}

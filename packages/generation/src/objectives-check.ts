import type { ObjectiveVerb } from "./shapes";

/*
 * Deterministic check on a set of learning objectives (UX ruling 64; the "reach" decision of
 * 17 Sept 2026), split on 23 Sept 2026 into two kinds of result:
 *
 *  - ISSUES are structural and block: they fail the set, and a caller may retry on them. Code only
 *    ever judges shape here: an empty set, empty text, the literal banned openers (understand,
 *    know, learn…), the word limit, and an anchor present without an extract or missing with one.
 *  - METRICS are verb-level measurements for the lab: the Bloom level of the leading verb, the
 *    ladder to the lesson's reach (none above, none more than `LADDER_DEPTH` below, the last at
 *    the reach) and a verb the table does not know. They judge meaning, so they never block and
 *    never trigger a retry; a bench reports them, the prompt is what holds the ladder.
 *
 * The count (UX ruling 81, rewritten 23 Sept 2026): the objectives come from the topic, not the
 * deck's slide count, so the size is not checked here beyond an empty set; the schemas bound it at
 * 1 to 4 (ruling 64).
 */

/** Recall < Explain < Apply < Evaluate. */
export const LEVELS: readonly ObjectiveVerb[] = ["Recall", "Explain", "Apply", "Evaluate"];

const VERB_LEVEL: Record<string, ObjectiveVerb> = {
  // Recall: names, states, defines, describes what is there.
  recall: "Recall",
  remember: "Recall",
  name: "Recall",
  state: "Recall",
  define: "Recall",
  list: "Recall",
  identify: "Recall",
  label: "Recall",
  describe: "Recall",
  recognise: "Recall",
  recognize: "Recall",
  match: "Recall",
  locate: "Recall",
  order: "Recall",
  sequence: "Recall",
  spell: "Recall",
  read: "Recall",
  say: "Recall",
  give: "Recall",
  find: "Recall",
  // Explain: says how or why, relates ideas.
  explain: "Explain",
  compare: "Explain",
  contrast: "Explain",
  summarise: "Explain",
  summarize: "Explain",
  outline: "Explain",
  interpret: "Explain",
  classify: "Explain",
  group: "Explain",
  sort: "Explain",
  predict: "Explain",
  illustrate: "Explain",
  discuss: "Explain",
  suggest: "Explain",
  infer: "Explain",
  distinguish: "Explain",
  relate: "Explain",
  connect: "Explain",
  show: "Explain",
  // Apply: uses a method or makes something new with it.
  apply: "Apply",
  use: "Apply",
  solve: "Apply",
  calculate: "Apply",
  work: "Apply",
  construct: "Apply",
  build: "Apply",
  write: "Apply",
  draft: "Apply",
  create: "Apply",
  compose: "Apply",
  represent: "Apply",
  draw: "Apply",
  plot: "Apply",
  measure: "Apply",
  convert: "Apply",
  demonstrate: "Apply",
  perform: "Apply",
  practise: "Apply",
  practice: "Apply",
  complete: "Apply",
  check: "Apply",
  choose: "Apply",
  select: "Apply",
  plan: "Apply",
  design: "Apply",
  analyse: "Apply",
  analyze: "Apply",
  investigate: "Apply",
  test: "Apply",
  model: "Apply",
  estimate: "Apply",
  simplify: "Apply",
  rearrange: "Apply",
  add: "Apply",
  subtract: "Apply",
  multiply: "Apply",
  divide: "Apply",
  share: "Apply",
  partition: "Apply",
  round: "Apply",
  count: "Apply",
  factorise: "Apply",
  factorize: "Apply",
  expand: "Apply",
  substitute: "Apply",
  prove: "Apply",
  craft: "Apply",
  edit: "Apply",
  redraft: "Apply",
  revise: "Apply",
  punctuate: "Apply",
  annotate: "Apply",
  quote: "Apply",
  cite: "Apply",
  translate: "Apply",
  conjugate: "Apply",
  record: "Apply",
  observe: "Apply",
  present: "Apply",
  produce: "Apply",
  make: "Apply",
  carry: "Apply",
  set: "Apply",
  form: "Apply",
  balance: "Apply",
  tell: "Recall",
  retell: "Recall",
  answer: "Recall",
  point: "Recall",
  trace: "Explain",
  account: "Explain",
  link: "Explain",
  explore: "Explain",
  consider: "Explain",
  // Evaluate: judges and gives a reason.
  evaluate: "Evaluate",
  judge: "Evaluate",
  assess: "Evaluate",
  justify: "Evaluate",
  argue: "Evaluate",
  weigh: "Evaluate",
  decide: "Evaluate",
  critique: "Evaluate",
  criticise: "Evaluate",
  criticize: "Evaluate",
  recommend: "Evaluate",
  defend: "Evaluate",
  rank: "Evaluate",
  prioritise: "Evaluate",
  prioritize: "Evaluate",
  reach: "Evaluate",
  appraise: "Evaluate",
};

/** Openers that cannot be observed (ruling 64; Mager): a literal word ban, so a structural issue. */
const FORBIDDEN = new Set([
  "understand",
  "know",
  "learn",
  "appreciate",
  "be",
  "become",
  "familiarise",
  "familiarize",
  "grasp",
  "realise",
  "realize",
  "think",
  "enjoy",
]);

/** Structural: blocks the set and may be retried. Never a judgement of meaning. */
export type ObjectiveIssue =
  | { kind: "no-objectives" }
  | { kind: "empty-text"; index: number }
  | { kind: "forbidden-verb"; index: number; verb: string }
  | { kind: "too-long"; index: number; words: number }
  | { kind: "anchor-without-source"; index: number }
  | { kind: "anchor-missing"; index: number };

/** Verb-level: measured and reported in the lab, never blocking (23 Sept 2026). */
export type ObjectiveMetric =
  | { kind: "unknown-verb"; index: number; verb: string }
  | { kind: "below-ladder"; index: number; level: ObjectiveVerb; reach: ObjectiveVerb }
  | { kind: "above-reach"; index: number; level: ObjectiveVerb; reach: ObjectiveVerb }
  | { kind: "reach-missing"; reach: ObjectiveVerb }
  | { kind: "reach-not-last"; level: ObjectiveVerb; reach: ObjectiveVerb };

export type CheckedObjective = { text: string; verb: string; level?: ObjectiveVerb | undefined };

/** The first word of the objective, lower-cased, without punctuation. */
export function leadingVerb(text: string): string {
  return (
    text
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z-]/g, "") ?? ""
  );
}

/** The level a verb sits at, or `undefined` when it is not in the table. */
export function verbLevel(verb: string): ObjectiveVerb | undefined {
  return VERB_LEVEL[verb];
}

export function levelIndex(level: ObjectiveVerb): number {
  return LEVELS.indexOf(level);
}

export const MAX_OBJECTIVE_WORDS = 16;
/** How far below the reach an objective may sit before the ladder metric records it. */
export const LADDER_DEPTH = 2;

export type ObjectivesCheck = {
  /** Structural faults: `ok` is false when any is present. */
  issues: ObjectiveIssue[];
  /** Verb-level measurements for a bench report; they never change `ok`. */
  metrics: ObjectiveMetric[];
  objectives: CheckedObjective[];
  ok: boolean;
};

/**
 * Check a set of objectives against the lesson's reach. `hasSource` says whether a curriculum
 * extract was given: anchors are required with one and forbidden without. An empty set is failed.
 * `ok` reads the structural issues only; the ladder and the verb table land in `metrics`.
 */
export function checkObjectives(
  objectives: readonly { text: string; curriculumAnchor?: string | undefined }[],
  reach: ObjectiveVerb,
  options: { hasSource: boolean },
): ObjectivesCheck {
  const issues: ObjectiveIssue[] = [];
  const metrics: ObjectiveMetric[] = [];
  if (objectives.length === 0) issues.push({ kind: "no-objectives" });
  const checked: CheckedObjective[] = [];
  const reachIdx = levelIndex(reach);
  let reachSeen = false;
  let lastLevel: ObjectiveVerb | undefined;
  objectives.forEach((o, index) => {
    const text = o.text.trim();
    const verb = leadingVerb(text);
    const level = verbLevel(verb);
    checked.push({ text: o.text, verb, level });
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words === 0) issues.push({ kind: "empty-text", index });
    if (words > MAX_OBJECTIVE_WORDS) issues.push({ kind: "too-long", index, words });
    if (FORBIDDEN.has(verb)) issues.push({ kind: "forbidden-verb", index, verb });
    else if (words > 0 && !level) metrics.push({ kind: "unknown-verb", index, verb });
    else if (level) {
      const idx = levelIndex(level);
      if (idx === reachIdx) reachSeen = true;
      else if (idx > reachIdx) metrics.push({ kind: "above-reach", index, level, reach });
      else if (idx < reachIdx - LADDER_DEPTH)
        metrics.push({ kind: "below-ladder", index, level, reach });
      lastLevel = level;
    }
    if (o.curriculumAnchor && !options.hasSource)
      issues.push({ kind: "anchor-without-source", index });
    if (!o.curriculumAnchor && options.hasSource) issues.push({ kind: "anchor-missing", index });
  });
  if (!reachSeen && objectives.length > 0) metrics.push({ kind: "reach-missing", reach });
  else if (lastLevel && lastLevel !== reach)
    metrics.push({ kind: "reach-not-last", level: lastLevel, reach });
  return { issues, metrics, objectives: checked, ok: issues.length === 0 };
}

/** One line per structural issue, for a retry message or a bench report. */
export function describeIssues(issues: readonly ObjectiveIssue[]): string[] {
  return issues.map((i) => {
    switch (i.kind) {
      case "no-objectives":
        return "there are no objectives; give at least one";
      case "empty-text":
        return `objective ${i.index + 1} is empty`;
      case "forbidden-verb":
        return `objective ${i.index + 1} starts with "${i.verb}", which cannot be observed`;
      case "too-long":
        return `objective ${i.index + 1} is ${i.words} words, over ${MAX_OBJECTIVE_WORDS}`;
      case "anchor-without-source":
        return `objective ${i.index + 1} cites a curriculum anchor but no extract was given`;
      case "anchor-missing":
        return `objective ${i.index + 1} has no curriculum anchor although an extract was given`;
      default:
        return `objective issue ${(i as { kind: string }).kind}`;
    }
  });
}

/** One line per verb-level metric, for a bench report only; never sent back to the model. */
export function describeMetrics(metrics: readonly ObjectiveMetric[]): string[] {
  return metrics.map((m) => {
    switch (m.kind) {
      case "unknown-verb":
        return `objective ${m.index + 1} starts with "${m.verb}", not in the verb table`;
      case "below-ladder":
        return `objective ${m.index + 1} is at ${m.level}, more than ${LADDER_DEPTH} levels below the lesson's ${m.reach}`;
      case "above-reach":
        return `objective ${m.index + 1} is at ${m.level}, above the lesson's ${m.reach}`;
      case "reach-missing":
        return `no objective reaches ${m.reach}`;
      case "reach-not-last":
        return `the last objective is at ${m.level}; the objective at ${m.reach} should come last`;
      default:
        return `objective metric ${(m as { kind: string }).kind}`;
    }
  });
}

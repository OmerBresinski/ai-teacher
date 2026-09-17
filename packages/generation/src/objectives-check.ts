import type { ObjectiveVerb } from "./shapes";

/*
 * Deterministic check on a set of learning objectives (UX ruling 64; the "reach" decision of
 * 17 Sept 2026): every objective starts with one observable verb at a known level, the set climbs
 * to the lesson's reach (the brief's verb): none above the reach, none more than two levels below
 * it (Explain, Apply, Evaluate is the natural climb for an Evaluate lesson), the last one at the
 * reach, and no objective uses a verb that cannot be observed. Interior order is free: calculate,
 * explain, evaluate is as good a lesson as explain, calculate, evaluate. Runs on the model's answer
 * before it is accepted, so the prompt does not have to be trusted for these rules.
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

/** Verbs that cannot be observed (ruling 64; Mager). */
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

export type ObjectiveIssue =
  | { kind: "forbidden-verb"; index: number; verb: string }
  | { kind: "unknown-verb"; index: number; verb: string }
  | { kind: "below-ladder"; index: number; level: ObjectiveVerb; reach: ObjectiveVerb }
  | { kind: "above-reach"; index: number; level: ObjectiveVerb; reach: ObjectiveVerb }
  | { kind: "reach-missing"; reach: ObjectiveVerb }
  | { kind: "reach-not-last"; level: ObjectiveVerb; reach: ObjectiveVerb }
  | { kind: "too-long"; index: number; words: number }
  | { kind: "anchor-without-source"; index: number }
  | { kind: "anchor-missing"; index: number };

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
/** How far below the reach an objective may sit. */
export const LADDER_DEPTH = 2;

/**
 * Check a set of objectives against the lesson's reach. `hasSource` says whether a curriculum
 * extract was given: anchors are required with one and forbidden without.
 */
export function checkObjectives(
  objectives: readonly { text: string; curriculumAnchor?: string | undefined }[],
  reach: ObjectiveVerb,
  options: { hasSource: boolean },
): { issues: ObjectiveIssue[]; objectives: CheckedObjective[]; ok: boolean } {
  const issues: ObjectiveIssue[] = [];
  const checked: CheckedObjective[] = [];
  const reachIdx = levelIndex(reach);
  let reachSeen = false;
  let lastLevel: ObjectiveVerb | undefined;
  objectives.forEach((o, index) => {
    const verb = leadingVerb(o.text);
    const level = verbLevel(verb);
    checked.push({ text: o.text, verb, level });
    const words = o.text.trim().split(/\s+/).filter(Boolean).length;
    if (words > MAX_OBJECTIVE_WORDS) issues.push({ kind: "too-long", index, words });
    if (FORBIDDEN.has(verb)) issues.push({ kind: "forbidden-verb", index, verb });
    else if (!level) issues.push({ kind: "unknown-verb", index, verb });
    else {
      const idx = levelIndex(level);
      if (idx === reachIdx) reachSeen = true;
      else if (idx > reachIdx) issues.push({ kind: "above-reach", index, level, reach });
      else if (idx < reachIdx - LADDER_DEPTH)
        issues.push({ kind: "below-ladder", index, level, reach });
      lastLevel = level;
    }
    if (o.curriculumAnchor && !options.hasSource)
      issues.push({ kind: "anchor-without-source", index });
    if (!o.curriculumAnchor && options.hasSource) issues.push({ kind: "anchor-missing", index });
  });
  if (!reachSeen && objectives.length > 0) issues.push({ kind: "reach-missing", reach });
  else if (lastLevel && lastLevel !== reach)
    issues.push({ kind: "reach-not-last", level: lastLevel, reach });
  return { issues, objectives: checked, ok: issues.length === 0 };
}

/** One line per issue, for a retry message or a bench report. */
export function describeIssues(issues: readonly ObjectiveIssue[]): string[] {
  return issues.map((i) => {
    switch (i.kind) {
      case "forbidden-verb":
        return `objective ${i.index + 1} starts with "${i.verb}", which cannot be observed`;
      case "unknown-verb":
        return `objective ${i.index + 1} starts with "${i.verb}", not a recognised objective verb`;
      case "below-ladder":
        return `objective ${i.index + 1} is at ${i.level}, more than ${LADDER_DEPTH} levels below the lesson's ${i.reach}`;
      case "reach-not-last":
        return `the last objective is at ${i.level}; the objective at ${i.reach} should come last`;
      case "above-reach":
        return `objective ${i.index + 1} is at ${i.level}, above the lesson's ${i.reach}`;
      case "reach-missing":
        return `no objective reaches ${i.reach}`;
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

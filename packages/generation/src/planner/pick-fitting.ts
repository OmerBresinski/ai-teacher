import { fitSlide, getTheme, materialiseSlide, type SlideSpec, THEMES } from "@tj/slides";
import type {
  PlanTeachObjectiveCandidates,
  PlanTeachObjectiveOutput,
} from "../prompts/plan-teach-objective";

/*
 * Pick material that fits (lab fit-7, 29 Sept 2026). The teach call (v4) writes each key idea in
 * one to three framings and up to three worked examples. Each candidate is laid out as the slide
 * it will teach from, with the real layout and the headless measurer, on every theme (a teacher
 * can change the look later), and the first that fits, in the call's own order, is kept. Nothing
 * is rewritten or shortened: a candidate either fits or is passed over.
 *
 * - A key idea: a content slide with the statement as heading, the explanation then the example
 *   as the body, and the objective's misconception as the watch-out note (the callout the outline
 *   gives an objective's first content slide, and the longest it gives).
 * - A worked example: its problem as the question, its steps then its answer as the lines (the
 *   writer ends on the answer). More than four lines do not fit (the slide shows at most four).
 * - Two key ideas: every combination of framings, each alone (with the note, else without it) and
 *   then as a pair, since the outline pairs them when slides are short.
 * When no candidate fits, the one that misses on the fewest themes is kept (ties: the call's order).
 */

const META = { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" };
const STEPS_MAX = 4;

/** Themes the slide misses on: text overflowing, or the planned callout left off. */
export function missesOf(spec: SlideSpec): number {
  let misses = 0;
  for (const theme of THEMES) {
    let dropped = false;
    const slide = materialiseSlide(spec, theme.id, META, undefined, undefined, {}, () => {
      dropped = true;
    });
    if (dropped || fitSlide(slide, getTheme(theme.id)).overflow.length > 0) misses++;
  }
  return misses;
}

/** A content slide with this heading, body and callout fits every theme, the callout placed. */
export function calloutFits(
  heading: string,
  body: string,
  callout: { kind: string; text: string },
): boolean {
  return missesOf({ kind: "content", factRefs: [], heading, body, callout } as SlideSpec) === 0;
}

/** The first candidate with no misses, else the fewest; its index and misses. */
function pick<T>(candidates: readonly T[], misses: (c: T) => number) {
  let best = { index: 0, misses: Number.POSITIVE_INFINITY };
  for (const [index, candidate] of candidates.entries()) {
    const m = misses(candidate);
    if (m < best.misses) best = { index, misses: m };
    if (m === 0) break;
  }
  return best;
}

export type FitPick = {
  kind: "keyIdeas" | "workedExample";
  of: number;
  picked: number[];
  misses: number[];
};

type Idea = PlanTeachObjectiveCandidates["keyIdeas"][number];
type Framing = Idea["framings"][number];

const bodyOf = (f: Framing) => `${f.explanation} ${f.example}`;

/** Every combination of one framing per key idea, in the call's order (first framings first). */
function combinations(ideas: readonly Idea[]): number[][] {
  return ideas.reduce<number[][]>(
    (acc, idea) => acc.flatMap((c) => idea.framings.map((_, i) => [...c, i])),
    [[]],
  );
}

export function pickFitting(raw: PlanTeachObjectiveCandidates): {
  output: PlanTeachObjectiveOutput;
  picks: FitPick[];
} {
  const picks: FitPick[] = [];
  const watch = raw.misconceptions[0]?.belief;
  const callout = watch ? { callout: { kind: "watch-out", text: watch } } : {};
  const content = (heading: string, body: string, withCallout: boolean) =>
    ({
      kind: "content",
      factRefs: [],
      heading,
      body,
      ...(withCallout ? callout : {}),
    }) as SlideSpec;
  // A key idea alone on its slide: with the watch-out, else without it (the outline can move the
  // note elsewhere), else the fewest themes overflowing.
  const single = new Map<string, number>();
  const singleMisses = (k: number, f: number) => {
    const key = `${k}/${f}`;
    const idea = raw.keyIdeas[k] as Idea;
    const framing = idea.framings[f] as Framing;
    if (!single.has(key)) {
      const withNote = missesOf(content(idea.statement, bodyOf(framing), true));
      single.set(
        key,
        withNote === 0 ? 0 : 20 + missesOf(content(idea.statement, bodyOf(framing), false)),
      );
    }
    return single.get(key) as number;
  };
  // Two key ideas may share a slide (the outline pairs them when slides are short): the pair is
  // measured too, after each alone.
  const pairMisses = (combo: number[]) =>
    raw.keyIdeas.length < 2
      ? 0
      : missesOf(
          content(
            raw.keyIdeas.map((k) => k.statement).join(" "),
            raw.keyIdeas.map((k, i) => bodyOf(k.framings[combo[i] ?? 0] as Framing)).join("\n\n"),
            false,
          ),
        );
  let best = { combo: [] as number[], score: [Number.POSITIVE_INFINITY, 0] };
  for (const combo of combinations(raw.keyIdeas)) {
    const alone = combo.reduce((sum, f, k) => sum + singleMisses(k, f), 0);
    if (alone > best.score[0]!) continue;
    const pair = pairMisses(combo);
    if (alone < best.score[0]! || pair < best.score[1]!) best = { combo, score: [alone, pair] };
    if (alone === 0 && pair === 0) break;
  }
  picks.push({
    kind: "keyIdeas",
    of: raw.keyIdeas.map((k) => k.framings.length).reduce((a, b) => a * b, 1),
    picked: best.combo,
    misses: best.score,
  });
  const keyIdeas = raw.keyIdeas.map((idea, k) => {
    const framing = (idea.framings[best.combo[k] ?? 0] ?? idea.framings[0]) as Framing;
    return {
      statement: idea.statement,
      explanation: framing.explanation,
      example: framing.example,
      ...(idea.analogy ? { analogy: idea.analogy } : {}),
    };
  });
  // A worked example under a two-line heading (the writer's heading names the method).
  const heading = raw.keyIdeas[0]?.statement ?? "Worked example";
  let workedExamples = raw.workedExamples;
  if (raw.workedExamples.length > 0) {
    const chosen = pick(raw.workedExamples, (x) =>
      x.steps.length + 1 > STEPS_MAX
        ? THEMES.length + x.steps.length
        : missesOf({
            kind: "worked-example",
            factRefs: [],
            heading,
            question: x.problem,
            steps: [...x.steps, x.answer],
          } as SlideSpec),
    );
    picks.push({
      kind: "workedExample",
      of: raw.workedExamples.length,
      picked: [chosen.index],
      misses: [chosen.misses],
    });
    workedExamples = raw.workedExamples.slice(chosen.index, chosen.index + 1);
  }
  return { output: { ...raw, keyIdeas, workedExamples }, picks };
}

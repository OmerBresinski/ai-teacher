/**
 * End-of-deck Answers capacity (TEACH-191 part b; gold `answers/NOTES.md` "Fit and caps"): the most
 * answers of one kind a single group may hold on one Answers slide at the age's comfort size or
 * above, nothing over, on every live theme. Measured by the renderer (`answersSize`), so the
 * table and the layout cannot disagree; `end-answers.test.ts` proves renderer = table.
 * Regenerate: `bun packages/slides/src/templates/end-answers-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { type AnswerGroup, type AnswerItem, answersSize } from "./end-answers";
import type { Stage } from "./index";

export const CAPACITY_STAGES = ["ks1", "ks2", "ks3"] as const satisfies readonly Stage[];
const SENTENCE_12 = "Blood carries oxygen from the lungs to every muscle in the body.";
const SENTENCE_20 =
  "Russia mobilised to defend Serbia, so Germany declared war on Russia and then on France, its ally, that same week.";
/** The gold's six answer kinds, one typical item each. */
export const CAPACITY_KINDS: Record<string, (n: number) => AnswerItem> = {
  numbers: (n) => ({ n, a: "6,245" }),
  phrases: (n) => ({ n, a: "Water, light or warmth" }),
  worked: (n) => ({ n, a: "4,201", work: "2,395 + 1,806 = 4,201" }),
  "true/false + why": (n) => ({ n, tf: n % 2 === 0, why: "Warmth makes water evaporate faster." }),
  "12-word sentences": (n) => ({ n, s: SENTENCE_12 }),
  "20-word sentences": (n) => ({ n, s: SENTENCE_20 }),
};
export type AnswersCapacity = Record<(typeof CAPACITY_STAGES)[number], Record<string, number>>;

const group = (kind: string, n: number): AnswerGroup => ({
  kind: "practice",
  title: "Causes of the First World War",
  items: Array.from({ length: n }, (_, i) =>
    (CAPACITY_KINDS[kind] as (n: number) => AnswerItem)(i + 1),
  ),
});

/** The most answers of `kind` one slide holds at `stage` on every theme. */
export function measureAnswersCap(stage: Stage, kind: string): number {
  let n = 1;
  while (n < 40 && THEMES.every((t) => answersSize(t, stage, [group(kind, n + 1)]) !== undefined))
    n += 1;
  return n;
}

export function measureAnswersCapacity(): AnswersCapacity {
  return Object.fromEntries(
    CAPACITY_STAGES.map((stage) => [
      stage,
      Object.fromEntries(Object.keys(CAPACITY_KINDS).map((k) => [k, measureAnswersCap(stage, k)])),
    ]),
  ) as AnswersCapacity;
}

if (import.meta.main) {
  const table = measureAnswersCapacity();
  writeFileSync(
    new URL("./end-answers-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}

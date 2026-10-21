/**
 * Steps with a model (TEACH-75 part af): the most words the do line may have in 1 line and in 2
 * lines (the cap), measured by the renderer in the gold's filler wording (`caps.mjs`) on every
 * theme of the group. It feeds the writer's do-line cap. Regenerate:
 * `bun packages/slides/src/templates/steps-model-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage } from "./index";
import { STEP_NAMES } from "./steps-model";

export const STEP_GROUPS = {
  KS1: ["ks1"],
  KS2: ["ks2"],
  "KS3-5": ["ks3", "ks4", "ks5"],
} as const satisfies Record<string, Stage[]>;
export type StepGroup = keyof typeof STEP_GROUPS;

const POOL =
  "Pour the mixture slowly into the funnel and wait until the water has dripped through the paper into the beaker below then check the level again and write down what you see".split(
    " ",
  );
/** The gold's filler: the first `n` words of the pool as one sentence. */
export const stepWords = (n: number) => {
  const s = POOL.slice(0, n).join(" ");
  return `${s[0]?.toUpperCase()}${s.slice(1)}.`;
};

/** The do line's lines for `n` filler words, the most over every theme in the group. */
export function stepLines(stages: readonly Stage[], n: number): number {
  let most = 0;
  for (const theme of THEMES)
    for (const stage of stages) {
      const r = layoutTemplate(
        { template: "steps", heading: "Filter", step: { n: 1, do: stepWords(n) } },
        theme,
        stage,
      );
      const el = r.slide.elements.find((e) => e.name === STEP_NAMES.do) as
        | { h: number; style: { fontSize: number; lineHeight: number } }
        | undefined;
      if (el) most = Math.max(most, Math.round(el.h / (el.style.fontSize * el.style.lineHeight)));
    }
  return most;
}

export function measureStepCaps(): Record<StepGroup, { oneLine: number; twoLines: number }> {
  const out = {} as Record<StepGroup, { oneLine: number; twoLines: number }>;
  for (const [g, stages] of Object.entries(STEP_GROUPS) as [StepGroup, readonly Stage[]][]) {
    let oneLine = 0;
    let twoLines = 0;
    for (let n = 3; n <= POOL.length; n++) {
      const l = stepLines(stages, n);
      if (l <= 1) oneLine = n;
      if (l <= 2) twoLines = n;
    }
    out[g] = { oneLine, twoLines };
  }
  return out;
}

if (import.meta.main)
  writeFileSync(
    new URL("./steps-model-capacity.json", import.meta.url),
    `${JSON.stringify(measureStepCaps(), null, 2)}\n`,
  );

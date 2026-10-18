/**
 * The hinge's caps (TEACH-256 part b), measured by the renderer: per age, the longest option (in
 * words of a plain sample, and its characters) that four cards (three at KS1) hold at the age's
 * comfort size under a two-line question, and the longest they hold at all, on every theme.
 * `hinge-capacity.json` is this function's output; `hinge.test.ts` proves renderer = table.
 * Regenerate: `bun src/templates/hinge-capacity.ts > src/templates/hinge-capacity.json`.
 */
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import type { Age } from "./items-row-deps";

const POOL =
  "the water in the pond turned into vapour because the warm sun heated its surface all through the long summer afternoon and evening".split(
    " ",
  );
/** `n` words of the gold's cap-probe sentence, from word `at`, capitalised, with a full stop. */
export const hingeSample = (n: number, at = 0): string =>
  `${POOL.slice(at, at + n)
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase())}.`;
export const HINGE_CAP_QUESTION =
  "Why do the Vikings' longships tell us they were skilled sailors?";
export const HINGE_CAP_STAGE: Record<Age, Stage> = {
  early: "ks1",
  primary: "ks2",
  secondary: "ks3",
};
export const HINGE_CAP_OPTIONS: Record<Age, number> = { early: 3, primary: 4, secondary: 4 };

export const hingeCapInput = (
  age: Age,
  words: number,
  options = HINGE_CAP_OPTIONS[age],
): TemplateInput => ({
  template: "hinge",
  heading: HINGE_CAP_QUESTION,
  options: Array.from({ length: options }, (_, i) => hingeSample(words, i)),
  correct: 1,
});

/** Every theme holds `words` at comfort (not tight) or at all (not over). */
function holds(
  age: Age,
  words: number,
  comfort: boolean,
  options = HINGE_CAP_OPTIONS[age],
): boolean {
  return THEMES.every((theme) => {
    const r = layoutTemplate(hingeCapInput(age, words, options), theme, HINGE_CAP_STAGE[age]);
    return r.over.length === 0 && (!comfort || !r.tight);
  });
}

export type HingeCapCell = { words: number; maxWords: number; chars: number; maxChars: number };

/** One option count's caps at an age: comfortable, then at all. */
function measureAt(age: Age, options: number): HingeCapCell {
  let words = 0;
  while (words < 30 && holds(age, words + 1, true, options)) words += 1;
  let maxWords = words;
  while (maxWords < 30 && holds(age, maxWords + 1, false, options)) maxWords += 1;
  return {
    words,
    maxWords,
    chars: hingeSample(words).length,
    maxChars: hingeSample(maxWords).length,
  };
}

/**
 * Per age: the caps at the most options (top level, as before) and `byCount`, each count from 2 up
 * measured on its own (CAP-NEED-AUDIT.md row 2, 18 Oct 2026): fewer cards hold longer options.
 */
export function measureHingeCapacity() {
  const out: Record<
    string,
    HingeCapCell & { options: number; byCount: Record<string, HingeCapCell> }
  > = {};
  for (const age of ["early", "primary", "secondary"] as Age[]) {
    const most = HINGE_CAP_OPTIONS[age];
    const byCount: Record<string, HingeCapCell> = {};
    for (let n = 2; n <= most; n += 1) byCount[String(n)] = measureAt(age, n);
    out[age] = { ...(byCount[String(most)] as HingeCapCell), options: most, byCount };
  }
  return out;
}

if (import.meta.main) console.log(JSON.stringify(measureHingeCapacity(), null, 2));

/**
 * Quick check capacity (TEACH-101 part g, ruling 215): the published character limits, measured by
 * the renderer on every theme, never guessed. For each age (early KS1, primary KS2, secondary KS3)
 * and question count (3 to the age's maximum), each field gets a `cap` (the longest text that
 * stays comfortable: KS2 every question on one line, down to the gold's 33 px
 * rows: ruling 162 amended by Greg 18 Oct (item 31 A): KS2 reading text at the golds' 33-34px on
 * quick check, picture-with-points and split-compare; KS1 and KS3 on up to two lines, as their
 * golds lay out, TEACH-215 part j) and a
 * `hardMax` (the longest that still fits at the floor; past it the slide is over and the writer
 * splits it). Questions are
 * measured all long beside short answers; answers all long beside short questions. A cap of 0
 * means that count is never comfortable. Regenerate:
 * `bun packages/slides/src/templates/question-set-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import type { Theme } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { panelSample } from "./panel-list-capacity";

/**
 * Sample text of exactly `chars` characters (TEACH-215 part j): the passage cut to the character,
 * never ending on a space, so every row is measured at its real length and the cap is that length
 * (the word-at-a-time sample stepped 42 -> 48 and read the first row's length).
 */
export function exactSample(chars: number, seed = 0): string {
  const s = panelSample(chars + 40, seed).slice(0, chars);
  return s.endsWith(" ") ? `${s.slice(0, -1)}s` : s;
}
const sample = exactSample;

export type QuickAge = "early" | "primary" | "secondary";
export const QUICK_AGES: Record<QuickAge, Stage> = {
  early: "ks1",
  primary: "ks2",
  secondary: "ks3",
};
export type QuickCap = { cap: number; hardMax: number };
export type QuickCaps = { questions: QuickCap; answers: QuickCap };
/** The measured counts per age: the gold's maximum (early 4, primary and secondary 6). */
export const QUICK_COUNTS: Record<QuickAge, number[]> = {
  early: [3, 4],
  primary: [3, 4, 5, 6],
  secondary: [3, 4, 5, 6],
};

const SHORT_Q = "What is it?";
const SHORT_A = "Plasma";
const inputOf = (qs: string[], as: string[]): TemplateInput => ({
  template: "question-set",
  heading: "Quick check: the heart",
  questions: qs,
  answers: as,
});

/** Whether `input` fits (nothing over) and is comfortable (not tight) on every theme. */
export function quickFits(
  input: TemplateInput,
  stage: Stage,
  themes: readonly Theme[] = THEMES,
): { fits: boolean; comfortable: boolean } {
  let fits = true;
  let comfortable = true;
  for (const t of themes) {
    const r = layoutTemplate(input, t, stage);
    if (r.over.length) fits = false;
    if (r.over.length || r.tight) comfortable = false;
    if (!fits) break;
  }
  return { fits, comfortable };
}

/** The longest `chars` for which `ok` holds, by binary search on [1, max]. */
function longest(ok: (chars: number) => boolean, max = 200): number {
  if (!ok(1)) return 0;
  let lo = 1;
  let hi = max;
  if (ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function capOf(
  stage: Stage,
  make: (chars: number) => TemplateInput,
  themes: readonly Theme[],
): QuickCap {
  return {
    cap: longest((ch) => quickFits(make(ch), stage, themes).comfortable),
    hardMax: longest((ch) => quickFits(make(ch), stage, themes).fits),
  };
}

export function measureQuickCaps(
  age: QuickAge,
  n: number,
  themes: readonly Theme[] = THEMES,
): QuickCaps {
  const stage = QUICK_AGES[age];
  const ks = Array.from({ length: n }, (_, i) => i);
  return {
    questions: capOf(
      stage,
      (ch) =>
        inputOf(
          ks.map((i) => sample(ch, i * 3)),
          ks.map(() => SHORT_A),
        ),
      themes,
    ),
    answers: capOf(
      stage,
      (ch) =>
        inputOf(
          ks.map(() => SHORT_Q),
          ks.map((i) => sample(ch, i * 3)),
        ),
      themes,
    ),
  };
}

if (import.meta.main) {
  const table = Object.fromEntries(
    (Object.keys(QUICK_AGES) as QuickAge[]).map((age) => [
      age,
      Object.fromEntries(QUICK_COUNTS[age].map((n) => [String(n), measureQuickCaps(age, n)])),
    ]),
  );
  writeFileSync(
    new URL("./question-set-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}

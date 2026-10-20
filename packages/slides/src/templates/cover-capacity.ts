/**
 * The cover's caps (ruling 21 A, TEACH-215 part e), measured by the renderer: per stage group,
 * the most characters the title may have in the gold's three lines (`coverType().titleLines`) and
 * the question in its two (`questionLines`), with nothing over on every theme and stage of the
 * group, for several word mixes (`sample` seeds), so a cap holds whatever the words. "picture" is
 * the repo's probe photo (4:3), which leaves the cover its narrowest column (as landscape does);
 * "none" is the cover without one. Each field is probed beside the other at one line.
 * `cover-capacity.json` is this function's output; `gold-sizes.test.ts` proves renderer = table,
 * and the writer's fit table reads it (`cover-fits.ts` in `@tj/generation`).
 * Regenerate: `bun packages/slides/src/templates/cover-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import type { SlideElement, Theme } from "@tj/domain/documents";
import { coverType } from "../layout-sizes";
import { atKeyStage, THEMES } from "../themes";
import { sample } from "./capacity";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";

export const COVER_GROUPS = {
  KS1: ["ks1"],
  KS2: ["ks2"],
  "KS3-5": ["ks3", "ks4", "ks5"],
} as const satisfies Record<string, Stage[]>;
export type CoverGroup = keyof typeof COVER_GROUPS;

const PH = { photo: "x", aspect: 4 / 3, alt: "x" } as const;
/** The word mixes a cap must hold for: every rotation of the sample words. */
const SEEDS = Array.from({ length: 36 }, (_, k) => k);
/** The other field while one is probed: one short line. */
const OTHER = 16;

export const coverCapInput = (
  title: number,
  question: number,
  picture: boolean,
  seed = 0,
): TemplateInput => ({
  template: "title",
  heading: sample(title, seed),
  lead: `${sample(question - 1, seed + 5)}?`,
  ...(picture ? { figure: PH } : {}),
});

function holds(group: CoverGroup, input: (seed: number) => TemplateInput): boolean {
  return SEEDS.every((seed) =>
    THEMES.every((theme) =>
      COVER_GROUPS[group].every((stage) => {
        const laid = layoutTemplate(input(seed), theme, stage);
        const at = atKeyStage(theme, stage);
        return (
          laid.over.length === 0 &&
          questionLines(laid.slide.elements, at) <= coverType(at).questionLines
        );
      }),
    ),
  );
}

/** The lines the cover's question takes as laid (its box is lines x size x line height). */
function questionLines(els: readonly SlideElement[], theme: Theme): number {
  const q = els.find((e) => e.name === "Subtitle");
  if (q?.type !== "text") return 0;
  const cv = coverType(theme);
  return Math.round(q.h / (cv.question * cv.questionLineHeight));
}

type Cap = { title: number; question: number };

export function measureCoverCapacity(): Record<CoverGroup, Record<"picture" | "none", Cap>> {
  const out = {} as Record<CoverGroup, Record<"picture" | "none", Cap>>;
  for (const group of Object.keys(COVER_GROUPS) as CoverGroup[]) {
    const row = {} as Record<"picture" | "none", Cap>;
    for (const picture of [true, false]) {
      let title = OTHER;
      while (title < 300 && holds(group, (s) => coverCapInput(title + 2, OTHER, picture, s)))
        title += 2;
      let question = OTHER;
      while (question < 300 && holds(group, (s) => coverCapInput(OTHER, question + 2, picture, s)))
        question += 2;
      row[picture ? "picture" : "none"] = { title, question };
    }
    out[group] = row;
  }
  return out;
}

/**
 * The table checked where it binds (TEACH-215 part g, CI time): each cap holds on every seed,
 * theme and stage, and two characters more does not. That is the generator's own stopping rule at
 * its answer, without walking every 2-character step up to it (about 12k layouts, not 350k). The
 * full walk still runs in `caps:check` (scripts/caps-check.ts), which compares this generator's
 * output with the committed JSON.
 */
export function coverCapacityBinds(
  table: Record<CoverGroup, Record<"picture" | "none", Cap>>,
): string[] {
  const out: string[] = [];
  for (const group of Object.keys(COVER_GROUPS) as CoverGroup[])
    for (const picture of [true, false]) {
      const cap = table[group][picture ? "picture" : "none"];
      const at = {
        title: (n: number) => (s: number) => coverCapInput(n, OTHER, picture, s),
        question: (n: number) => (s: number) => coverCapInput(OTHER, n, picture, s),
      };
      for (const k of ["title", "question"] as const) {
        const where = `${group} ${picture ? "picture" : "none"} ${k} ${cap[k]}`;
        if (!holds(group, at[k](cap[k]))) out.push(`${where}: does not hold`);
        if (cap[k] < 300 && holds(group, at[k](cap[k] + 2))) out.push(`${where}: +2 still holds`);
      }
    }
  return out;
}

if (import.meta.main) {
  const table = measureCoverCapacity();
  writeFileSync(
    new URL("./cover-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}

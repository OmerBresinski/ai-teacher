/**
 * Cards grid capacity (UX ruling 203, P3; TEACH-75 part j): the writer's budget for a card's body,
 * in words, measured by the renderer the way `activity-capacity.ts` measures activities. For each
 * key-stage group, card count (2, 3, 4) and heading (none, one line), the cell is the most words a
 * body may have with nothing over on every theme and stage of the group, every card at that length
 * with a two-word label and an icon. The writer's `Fits:` clause is rendered from this table, never
 * hand-copied. Regenerate: `bun packages/slides/src/templates/cards-grid-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { sample } from "./capacity";
import type { GridCard } from "./cards-grid";
import { layoutTemplate, type Stage } from "./index";

export const GRID_GROUPS = {
  KS1: ["ks1"],
  KS2: ["ks2"],
  "KS3-5": ["ks3", "ks4", "ks5"],
} as const satisfies Record<string, Stage[]>;
export type GridGroup = keyof typeof GRID_GROUPS;
/** A cell: the most words and characters a body holds, and the label's characters beside it. */
export type GridFit = {
  cards: number;
  heading: boolean;
  words: number;
  chars: number;
  label: number;
};

/** The heading every "with a heading" cell is measured under: the writer's KS1 heading limit (34 characters), two lines at KS1 as the fit table measures headings. */
export const GRID_FIT_HEADING = "How a tiny seed grows into a plant";
const WORDS =
  "plants need light water and warm air to grow well and most of them make their own food in green leaves while strong roots hold them firmly in the ground and take up water";

/** `n` real words, each card starting at its own word, as a sentence. */
export function gridWords(n: number, seed = 0): string {
  const w = WORDS.split(" ");
  const out = Array.from({ length: n }, (_, k) => w[(seed * 5 + k) % w.length]).join(" ");
  return `${out.charAt(0).toUpperCase()}${out.slice(1)}.`;
}

/** Whether these cards fit on every theme and stage of the group. */
const allFit = (stages: readonly Stage[], heading: boolean, grid: GridCard[]) =>
  THEMES.every((theme) =>
    stages.every(
      (stage) =>
        layoutTemplate(
          { template: "cards-grid", heading: heading ? GRID_FIT_HEADING : "", grid },
          theme,
          stage,
        ).over.length === 0,
    ),
  );
const icon = { photo: "x", aspect: 1 };
/** The label every body cell is measured beside (the writer's label cap is measured on its own). */
const LABEL = "Green leaves";

/** Whether every card of `words` words fits on every theme and stage of the group. */
export const gridFitsAt = (
  stages: readonly Stage[],
  cards: number,
  heading: boolean,
  words: number,
) =>
  allFit(
    stages,
    heading,
    Array.from({ length: cards }, (_, k) => ({ label: LABEL, text: gridWords(words, k), icon })),
  );
/** Whether every card's body of `chars` characters (real words cut at a word) fits. */
export const gridFitsChars = (
  stages: readonly Stage[],
  cards: number,
  heading: boolean,
  chars: number,
) =>
  allFit(
    stages,
    heading,
    Array.from({ length: cards }, (_, k) => ({ label: LABEL, text: sample(chars, k), icon })),
  );
/** Whether a `label`-character label fits beside a body at the cell's characters. */
export const gridLabelFits = (
  stages: readonly Stage[],
  cards: number,
  heading: boolean,
  chars: number,
  label: number,
) =>
  allFit(
    stages,
    heading,
    Array.from({ length: cards }, (_, k) => ({
      label: sample(label, k + 3),
      text: sample(chars, k),
      icon,
    })),
  );

/** The measured table for one group: most words a body holds, per count and heading. */
export function measureGridFit(group: GridGroup): GridFit[] {
  const stages = GRID_GROUPS[group];
  const out: GridFit[] = [];
  for (const cards of [2, 3, 4])
    for (const heading of [false, true]) {
      let words = 0;
      while (words < 60 && gridFitsAt(stages, cards, heading, words + 1)) words++;
      let chars = 0;
      while (chars < 400 && gridFitsChars(stages, cards, heading, chars + 2)) chars += 2;
      let label = 0;
      while (label < 40 && gridLabelFits(stages, cards, heading, chars, label + 2)) label += 2;
      out.push({ cards, heading, words, chars, label });
    }
  return out;
}

if (import.meta.main) {
  const table = Object.fromEntries(
    (Object.keys(GRID_GROUPS) as GridGroup[]).map((g) => [g, measureGridFit(g)]),
  );
  writeFileSync(
    new URL("./cards-grid-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}

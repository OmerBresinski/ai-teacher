/**
 * Stages capacity (TEACH-75 part ac): the published limit (`cap`, still comfortable) and hard
 * maximum (`hardMax`, still fits at the floors) per age profile, stage count and visual (icons in
 * one strip, or picture tiles), for a stage's name and line, measured by the renderer the way the
 * gold's `slide.html?measure=1` measured `caps.json` (ruling 215): a name is one word; a line runs
 * to at most 4 lines (3 at early), more is a paragraph, not a stage. Each cell holds on every
 * theme at every key stage of the age, with every stage long and with one stage long beside short
 * siblings. Never hand-edit; regenerate: `bun packages/slides/src/templates/stages-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { sample } from "./capacity";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import type { Age } from "./items-row-deps";
import {
  STAGES_MAX,
  STAGES_MIN,
  STAGES_NAMES,
  type StageCell,
  type StageItem,
  type StageVis,
  withoutStageCaps,
} from "./stages";

export const STAGE_CAP_GROUPS: Record<Age, Stage[]> = {
  early: ["ks1"],
  primary: ["ks2"],
  secondary: ["ks3", "ks4", "ks5"],
};
/** Most lines a stage's line may take (gold: 3 at early, 4 otherwise). */
export const STAGE_LINE_MAX: Record<Age, number> = { early: 3, primary: 4, secondary: 4 };
const ICONS = ["wheat", "flour", "oven", "fish", "fossil", "crown"];
const WORD = "Transportations";
const NAME = 6;
const LINE = 16;
const LIMIT = 160;

type Fill = { name?: number; line?: number; only?: boolean };
/** The strip's input: every field at its default length unless `fill` sets it (`only`: stage 0 alone). */
export function stagesInput(n: number, vis: StageVis, f: Fill = {}): TemplateInput {
  const at = (k: number, v: number | undefined, d: number) =>
    v !== undefined && (!f.only || k === 0) ? v : d;
  const stages: StageItem[] = Array.from({ length: n }, (_, k) => ({
    name: WORD.slice(0, at(k, f.name, NAME)),
    line: sample(at(k, f.line, LINE), k),
    icon: ICONS[k % ICONS.length] as string,
    ...(vis === "pictures" ? { picture: { photo: "https://images.test/stage.jpg", alt: "" } } : {}),
  }));
  return { template: "stages", heading: "How a fossil forms", stages };
}

/** Whether the strip holds on every theme and stage of the age: `fit` nothing over, `comfort` also not tight. */
export function stagesHold(
  age: Age,
  n: number,
  vis: StageVis,
  fill: Fill,
  mode: "fit" | "comfort",
): boolean {
  const inp = stagesInput(n, vis, fill);
  return withoutStageCaps(() =>
    THEMES.every((theme) =>
      STAGE_CAP_GROUPS[age].every((stage) => {
        const r = layoutTemplate(inp, theme, stage);
        if (r.over.length) return false;
        // The hard maximum only has to fit; the cap is also comfortable and within the line count.
        if (mode === "fit") return true;
        if (r.tight) return false;
        return r.slide.elements
          .filter((e) => e.name === STAGES_NAMES.line && e.type === "text")
          .every((e) => {
            const st = (e as { style?: { fontSize?: number; lineHeight?: number } }).style;
            const lh = (st?.fontSize ?? 20) * (st?.lineHeight ?? 1.3);
            return Math.round(e.h / lh) <= STAGE_LINE_MAX[age];
          });
      }),
    ),
  );
}

const fitsAt = (
  age: Age,
  n: number,
  vis: StageVis,
  field: "name" | "line",
  chars: number,
  mode: "fit" | "comfort",
) =>
  stagesHold(age, n, vis, { [field]: chars }, mode) &&
  stagesHold(age, n, vis, { [field]: chars, only: true }, mode);

/** The longest `chars` (1-character steps for a name, 2 for a line) that holds, 0 when none does. */
function longest(ok: (chars: number) => boolean, from: number, to: number, step: number): number {
  let best = 0;
  for (let c = from; c <= to; c += step) {
    if (!ok(c)) break;
    best = c;
  }
  return best;
}

/** One cell: a name's and a line's cap and hard maximum, as characters. */
export function measureCell(age: Age, n: number, vis: StageVis): StageCell {
  const name = (mode: "fit" | "comfort") =>
    longest((c) => fitsAt(age, n, vis, "name", c, mode), 3, WORD.length, 1);
  const line = (mode: "fit" | "comfort") =>
    longest((c) => fitsAt(age, n, vis, "line", c, mode), 10, LIMIT, 2);
  return {
    n,
    vis,
    name: { cap: name("comfort"), hardMax: name("fit") },
    line: { cap: line("comfort"), hardMax: line("fit") },
  };
}

export function measureStages(): Record<Age, StageCell[]> {
  const out = {} as Record<Age, StageCell[]>;
  for (const age of ["early", "primary", "secondary"] as Age[]) {
    out[age] = [];
    for (let n = STAGES_MIN; n <= STAGES_MAX[age]; n++)
      for (const vis of ["icons", "pictures"] as StageVis[])
        out[age].push(measureCell(age, n, vis));
  }
  return out;
}

if (import.meta.main) {
  const table = measureStages();
  writeFileSync(
    new URL("./stages-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}

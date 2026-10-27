/**
 * The figure slide (TEACH-239 part b): the most characters the caption holds on one line, per age,
 * measured by the layout at the drawn (key-stage) size on every theme, in the gold's sentence
 * (`slide.html`, `?measure=1`). The writer's cap (`FIGURE_CAPTION_CAP`) sits at or under it.
 * Regenerate: `bun packages/slides/src/templates/figure-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { FIGURE_NAMES, type FigureAge } from "./figure";
import { layoutTemplate, type Stage } from "./index";

export const FIGURE_GROUPS = {
  early: ["ks1"],
  primary: ["ks2"],
  secondary: ["ks3", "ks4", "ks5"],
} as const satisfies Record<FigureAge, Stage[]>;

/** The gold's measuring sentence. */
const SRC =
  "Rome ruled Britain for almost four hundred years, from the invasion in AD 43 until the army left in AD 410, and many towns, roads and villas were built across the south of the island while the north stayed wild";

/** Whether the first `n` characters stay within `lines` caption lines on every theme at these stages. */
function fits(stages: readonly Stage[], n: number, lines = 1): boolean {
  const cap = SRC.slice(0, n).trim();
  for (const theme of THEMES)
    for (const stage of stages) {
      const r = layoutTemplate(
        { template: "figure", heading: "Roman Britain", lead: cap },
        theme,
        stage,
      );
      const el = r.slide.elements.find((e) => e.name === FIGURE_NAMES.caption) as
        | { h: number; style: { fontSize: number; lineHeight: number } }
        | undefined;
      if (!el || Math.round(el.h / (el.style.fontSize * el.style.lineHeight)) > lines) return false;
      if (r.over.some((o) => o.startsWith("figure caption"))) return false;
    }
  return true;
}

export function measureFigureCaps(lines = 1): Record<FigureAge, number> {
  const out = {} as Record<FigureAge, number>;
  for (const [age, stages] of Object.entries(FIGURE_GROUPS) as [FigureAge, readonly Stage[]][]) {
    let best = 0;
    for (let n = 10; n <= SRC.length; n++) {
      if (SRC[n - 1] === " ") continue;
      if (fits(stages, n, lines)) best = n;
      else break;
    }
    out[age] = best;
  }
  return out;
}

if (import.meta.main) {
  writeFileSync(
    new URL("./figure-capacity.json", import.meta.url),
    `${JSON.stringify(measureFigureCaps(), null, 2)}\n`,
  );
  // TEACH-247 part bi: the two-line fit beside it (caps:check reads both).
  writeFileSync(
    new URL("./figure-two-line-capacity.json", import.meta.url),
    `${JSON.stringify(measureFigureCaps(2), null, 2)}\n`,
  );
}

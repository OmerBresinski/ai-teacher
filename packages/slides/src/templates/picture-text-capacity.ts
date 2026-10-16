/**
 * Picture and text (TEACH-75 part ae): the most words lead + points may have, measured by the
 * renderer in the gold's sweep filler (the KS3 composite-volcano text, 3 points, 2 at KS1) on the
 * landscape field, on every theme of the group. `words` is the hard cap (fits on the last rung of
 * the ladder), `comfortable` fits on the first. Regenerate:
 * `bun packages/slides/src/templates/picture-text-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage } from "./index";

export const PT_GROUPS = {
  KS1: ["ks1"],
  KS2: ["ks2"],
  "KS3-5": ["ks3", "ks4", "ks5"],
} as const satisfies Record<string, Stage[]>;
type PtGroup = keyof typeof PT_GROUPS;

const SRC =
  "Composite volcanoes form where an oceanic plate sinks beneath a continental plate and melts. The magma that rises is rich in silica, so it is thick and sticky and traps gas as it climbs. Pressure builds beneath a plug of cooled rock until the vent gives way and the gas expands in an instant. The blast throws out ash, pumice and pyroclastic flows that race downhill at over 100 km/h.".split(
    " ",
  );
const ALL = [...SRC, ...SRC, ...SRC];

/** The gold's sweep: `n` words as a lead (at most 14) and `np` points. */
export function sweepInput(n: number, np: number) {
  const leadN = Math.min(14, Math.round(n / (np + 1)));
  const lead = `${ALL.slice(0, leadN).join(" ")}.`;
  const rest = n - leadN;
  const points: string[] = [];
  for (let i = 0; i < np; i++) {
    const a = leadN + Math.round((rest * i) / np);
    const b = leadN + Math.round((rest * (i + 1)) / np);
    points.push(`${ALL.slice(a, b).join(" ")}.`);
  }
  return {
    template: "picture-text" as const,
    heading: "Why composite volcanoes explode",
    lead,
    points,
    figure: { photo: "x.jpg", aspect: 1.5 },
    pictureText: {},
  };
}

/** Whether `n` sweep words lay out on every theme and stage of the group (`first`: on rung 1). */
export function sweepFits(stages: readonly Stage[], n: number, first: boolean): boolean {
  const np = stages.includes("ks1") ? 2 : 3;
  for (const theme of THEMES)
    for (const stage of stages) {
      const r = layoutTemplate(sweepInput(n, np), theme, stage);
      if (r.over.some((o) => o.startsWith("picture-text column "))) return false;
      if (first) {
        const lead = r.slide.elements.find((e) => e.name === "Lead") as
          | { style?: { fontSize?: number } }
          | undefined;
        const pts = r.slide.elements.filter((e) => e.name === "Point") as {
          style?: { fontSize?: number };
        }[];
        const gap = r.slide.elements.filter((e) => e.name === "Point");
        const body = lead?.style?.fontSize;
        if (pts.some((p) => p.style?.fontSize !== body)) return false;
        // Rung 1 keeps the full spacing: the second point starts 16pt under the first.
        const [a, b] = gap as { y: number; h: number }[];
        if (a && b && b.y - (a.y + a.h) < 16) return false;
      }
    }
  return true;
}

export function measurePictureTextCaps(): Record<PtGroup, { words: number; comfortable: number }> {
  const out = {} as Record<PtGroup, { words: number; comfortable: number }>;
  for (const [g, stages] of Object.entries(PT_GROUPS) as [PtGroup, readonly Stage[]][]) {
    let words = 0;
    let comfortable = 0;
    for (let n = 10; n <= 120; n++) {
      if (!sweepFits(stages, n, false)) break;
      words = n;
      if (sweepFits(stages, n, true)) comfortable = n;
    }
    out[g] = { words, comfortable };
  }
  return out;
}

if (import.meta.main)
  writeFileSync(
    new URL("./picture-text-capacity.json", import.meta.url),
    `${JSON.stringify(measurePictureTextCaps(), null, 2)}\n`,
  );

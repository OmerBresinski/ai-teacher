/**
 * Picture and text (TEACH-75 part ae): the most words lead + points may have, measured by the
 * renderer in the gold's sweep filler (the KS3 composite-volcano text, 3 points, 2 at KS1) on the
 * landscape field, on every theme of the group. `words` is the hard cap (fits on the last rung of
 * the ladder), `comfortable` fits on the first (KS2: on the gold's comfortable rungs, k >= .96). Regenerate:
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

/** `n` words as a lead of `leadN` words and points weighted by `weights` (an uneven split). */
export function mixInput(n: number, leadN: number, weights: readonly number[]) {
  const rest = n - leadN;
  const sum = weights.reduce((a, b) => a + b, 0);
  const points: string[] = [];
  let at = leadN;
  for (const [i, w] of weights.entries()) {
    const len = i === weights.length - 1 ? n - at : Math.round((rest * w) / sum);
    points.push(`${ALL.slice(at, at + len).join(" ")}.`);
    at += len;
  }
  return { ...sweepInput(n, weights.length), lead: `${ALL.slice(0, leadN).join(" ")}.`, points };
}

/**
 * KS2's realistic uneven splits beside the gold's even sweep: a full 16-word lead (the lead cap)
 * or a short 8-word one, then one long point and two short ones in each order. Ruling 162 amended
 * by Greg 18 Oct (item 31 A): at the golds' 33-34px a long point can take a line the even sweep
 * never does, so the cap holds for these too.
 */
const KS2_MIXES: { lead: number; weights: number[] }[] = [16, 8].flatMap((lead) =>
  [
    [2, 1, 1],
    [1, 2, 1],
    [1, 1, 2],
  ].map((weights) => ({ lead, weights })),
);
const inputsFor = (stages: readonly Stage[], n: number, np: number) => [
  sweepInput(n, np),
  ...(stages.includes("ks2")
    ? KS2_MIXES.filter((m) => n - m.lead >= 3 * np).map((m) => mixInput(n, m.lead, m.weights))
    : []),
];

/** Whether `n` sweep words lay out on every theme and stage of the group (`first`: on rung 1). */
export function sweepFits(stages: readonly Stage[], n: number, first: boolean): boolean {
  const np = stages.includes("ks1") ? 2 : 3;
  for (const theme of THEMES)
    for (const stage of stages)
      for (const input of inputsFor(stages, n, np)) {
        const r = layoutTemplate(input, theme, stage);
        if (r.over.some((o) => o.startsWith("picture-text column "))) return false;
        if (first && stage === "ks2") {
          // KS2: the gold's comfortable share, k >= .96, which the layout reports as not `tight` (ruling
          // 162 amended by Greg 18 Oct (item 31 A): KS2 reading text at the golds' 33-34px).
          if (r.tight) return false;
        } else if (first) {
          const lead = r.slide.elements.find((e) => e.name === "Lead") as
            | { style?: { fontSize?: number } }
            | undefined;
          const pts = r.slide.elements.filter((e) => e.name === "Point") as {
            style?: { fontSize?: number };
          }[];
          const gap = r.slide.elements.filter((e) => e.name === "Point");
          const body = lead?.style?.fontSize ?? 0;
          // Rung 1 keeps the lead at its own step, a step over the points.
          if (pts.some((p) => (p.style?.fontSize ?? 0) >= body)) return false;
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

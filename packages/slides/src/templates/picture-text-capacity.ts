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
import { KEY_CAPS, type KeyCard } from "./picture-text";

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

/*
 * The key card look (TEACH-247 part co): the lead and 1-2 sand cards beside the picture. The card
 * caps (`KEY_CAPS`) are the gold's, per field; nothing measured them together with a lead, so at
 * KS1 a 10-word lead and one 10-word meaning ran 32pt past the column's foot (genlab v4.21a Great
 * Fire s9, 529/497pt) with every field inside its cap. This sweep measures, per group and card
 * count, the most words the lead and each card's meaning may hold at the same time, every field
 * full at once, on the landscape field (the widest picture, so the narrowest column; the picture
 * is not known when the writer writes), on every theme and stage of the group, with each card
 * kind at its other caps: a word card (a 3-word term and the meaning), a fact card and an
 * examples card with every pair. A count with no room for a 4-word lead and 4-word meanings is
 * not offered (0).
 */
const KEY_TERM = "Thick sticky magma";
const KEY_FACT = { num: "100000", unit: "people" };
const KEY_PAIR: [string, string] = ["Thick magma", "Big blast"];
/** The fewest words a lead and a meaning hold for a card count to be offered. */
const KEY_MIN_WORDS = 4;
const words = (n: number) => (n > 0 ? `${ALL.slice(0, n).join(" ")}.` : "");

/** The key card look with a lead of `n` words and `count` cards of `kind`, each meaning `n` words. */
export function keyCardInput(n: number, count: number, kind: KeyCard["kind"]) {
  const card: KeyCard =
    kind === "fact"
      ? { kind, label: "Key fact", ...KEY_FACT }
      : kind === "examples"
        ? { kind, label: "For example", examples: Array(KEY_CAPS.pairs).fill(KEY_PAIR) }
        : { kind, label: "Key word", term: KEY_TERM, meaning: words(n) };
  return {
    ...sweepInput(n, 0),
    lead: words(n),
    points: [],
    pictureText: { cards: Array.from({ length: count }, () => card) },
  };
}

/** Whether `count` cards fit beside an `n`-word lead with `n`-word meanings on every theme and stage. */
export function keyCardFits(stages: readonly Stage[], n: number, count: number): boolean {
  for (const theme of THEMES)
    for (const stage of stages)
      for (const kind of ["word", "fact", "examples"] as const) {
        const r = layoutTemplate(keyCardInput(n, count, kind), theme, stage);
        if (r.over.some((o) => o.startsWith("picture-text column "))) return false;
      }
  return true;
}

/** Per group: the most cards offered and, per count, the words the lead and each meaning may hold. */
export function measureKeyCardCaps(): Record<
  PtGroup,
  { cards: number; words: Record<"1" | "2", number> }
> {
  const out = {} as Record<PtGroup, { cards: number; words: Record<"1" | "2", number> }>;
  for (const [g, stages] of Object.entries(PT_GROUPS) as [PtGroup, readonly Stage[]][]) {
    const at = (count: number) => {
      let w = 0;
      for (let n = KEY_MIN_WORDS; n <= KEY_CAPS.meaning; n++) {
        if (!keyCardFits(stages, n, count)) break;
        w = n;
      }
      return w;
    };
    const words = { "1": at(1), "2": at(2) };
    out[g] = { cards: words["2"] ? 2 : words["1"] ? 1 : 0, words };
  }
  return out;
}

if (import.meta.main) {
  writeFileSync(
    new URL("./picture-text-capacity.json", import.meta.url),
    `${JSON.stringify(measurePictureTextCaps(), null, 2)}\n`,
  );
  writeFileSync(
    new URL("./picture-text-key-capacity.json", import.meta.url),
    `${JSON.stringify(measureKeyCardCaps(), null, 2)}\n`,
  );
}

/**
 * Activity capacities (TEACH-101 part b), measured the way `capacity.ts` measures the writer
 * templates: each variant is laid out at full size with real words cut at a word boundary, and the
 * largest card word (characters, step 2) with nothing over is the cell. Kept apart from
 * `TEMPLATE_DOCS`, whose numbers the writer's prompts are pinned to; the writer does not choose
 * activities yet. Regenerate the table with `bun packages/slides/scripts/activity-capacity.ts`.
 */
import { getTheme } from "../themes";
import { ACTIVITY_LIMITS, type ActivityId } from "./activities";
import { PLANT_SVG } from "./activity-fixtures";
import { sample } from "./capacity";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";

export type ActivityVariant = { label: string; cards?: number; groups?: number; targets?: number };

const range = (r: [number, number] | undefined) =>
  r ? Array.from({ length: r[1] - r[0] + 1 }, (_, i) => r[0] + i) : [];

export const ACTIVITY_VARIANTS: Record<ActivityId, ActivityVariant[]> = {
  pair: range(ACTIVITY_LIMITS.pair.cards).map((n) => ({ label: `${n} cards`, cards: n })),
  "group-sort": [6, 8].flatMap((n) =>
    [2, 3].map((g) => ({ label: `${n} cards, ${g} groups`, cards: n, groups: g })),
  ),
  sequence: range(ACTIVITY_LIMITS.sequence.cards).map((n) => ({ label: `${n} cards`, cards: n })),
  choose: range(ACTIVITY_LIMITS.choose.cards).map((n) => ({ label: `${n} cards`, cards: n })),
  "odd-one-out": range(ACTIVITY_LIMITS["odd-one-out"].cards).map((n) => ({
    label: `${n} cards`,
    cards: n,
  })),
  label: range(ACTIVITY_LIMITS.label.targets).map((n) => ({ label: `${n} pointers`, targets: n })),
};

const PHOTO = { photo: "x", aspect: 4 / 3 };
const DRAWN = { drawn: { src: PLANT_SVG, aspect: 400 / 420 } };

/** The measuring input: `n`-character words on every card (or pointer). */
export function activityInput(id: ActivityId, v: ActivityVariant, n: number): TemplateInput {
  const groups = v.groups ?? 0;
  const cards = Array.from({ length: v.cards ?? 0 }, (_, i) => ({
    text: sample(n, i * 3 + 1),
    figure: PHOTO,
    ...(groups ? { group: i % groups } : {}),
  }));
  const base: TemplateInput = { template: id, heading: "Animals and their young" };
  if (id === "label")
    return {
      ...base,
      figure: DRAWN,
      targets: Array.from({ length: v.targets ?? 0 }, (_, i) => ({
        x: 0.2 + 0.6 * ((i * 7) % 5) * 0.25,
        y: 0.15 + (0.7 * i) / Math.max(1, (v.targets ?? 1) - 1),
        text: sample(n, i * 3 + 1),
      })),
      extra: [sample(n, 20)],
    };
  return {
    ...base,
    cards,
    ...(groups ? { groups: ["Living", "Not living", "Once living"].slice(0, groups) } : {}),
    ...(id === "choose" || id === "odd-one-out" ? { correct: 1 } : {}),
  };
}

export const ACTIVITY_STAGES = [
  { key: "KS1", stage: "ks1", theme: "splash" },
  { key: "KS2", stage: "ks2", theme: "splash" },
  { key: "KS3-5", stage: "ks3", theme: "studio" },
] as const;

/** Over marks at full size, the ladder off. */
export const activityOver = (
  id: ActivityId,
  v: ActivityVariant,
  n: number,
  stage: Stage,
  theme: string,
) => layoutTemplate(activityInput(id, v, n), getTheme(theme), stage, { fullSize: true }).over;

/** Every activity's cell: the longest card word that lays out with nothing over (0: none does). */
export function measureActivities(): Record<string, Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const [id, variants] of Object.entries(ACTIVITY_VARIANTS) as [
    ActivityId,
    ActivityVariant[],
  ][]) {
    out[id] = {};
    for (const { key, stage, theme } of ACTIVITY_STAGES) {
      const row: Record<string, number> = {};
      for (const v of variants) {
        let best = 0;
        for (let n = 2; n <= 60; n += 2)
          if (activityOver(id, v, n, stage, theme).length === 0) best = n;
        row[v.label] = best;
      }
      (out[id] as Record<string, Record<string, number>>)[key] = row;
    }
  }
  return out;
}

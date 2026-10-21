/**
 * Banner text capacity (UX ruling 203, P4; TEACH-75 part k): the writer's fit for a banner slide,
 * measured by the renderer the way `fit-table.ts` measures the pinned layouts. For each key-stage
 * group and bullet count (0-3), the cell is the most characters the lead and each bullet may have
 * at once (real words cut at a word, a 12-character bold label on each bullet, the heading at the
 * writer's 34-character limit), with nothing over on every theme and stage of the group, strip on
 * top and at the bottom. Regenerate: `bun packages/slides/src/templates/banner-text-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { sample } from "./capacity";
import { type Figure, layoutTemplate, type Stage } from "./index";

export const BANNER_GROUPS = {
  KS1: ["ks1"],
  KS2: ["ks2"],
  "KS3-5": ["ks3", "ks4", "ks5"],
} as const satisfies Record<string, Stage[]>;
export type BannerGroup = keyof typeof BANNER_GROUPS;
export type BannerFit = { points: number; chars: number; label: number };
export const BANNER_LABEL = 12;
const HEADING = 34;
/** A wide photo whose subject sits in a thin band: it fills both strip heights. */
const PHOTO: Figure = {
  photo: "x",
  aspect: 1.5,
  subjects: [{ name: "s", x: 0.3, y: 0.45, w: 0.4, h: 0.15 }],
};

/** Whether a lead and `points` bullets of `chars` characters fit on every theme and stage. */
export function bannerFitsAt(stages: readonly Stage[], points: number, chars: number): boolean {
  return (["top", "bottom"] as const).every((at) =>
    THEMES.every((theme) =>
      stages.every(
        (stage) =>
          layoutTemplate(
            {
              template: "banner-text",
              heading: sample(HEADING, 7),
              lead: sample(chars),
              points: Array.from({ length: points }, (_, k) => ({
                label: sample(BANNER_LABEL, k + 3),
                text: sample(chars, k + 1),
              })),
              figure: PHOTO,
              at,
            },
            theme,
            stage,
          ).over.length === 0,
      ),
    ),
  );
}

export function measureBannerFit(group: BannerGroup): BannerFit[] {
  const stages = BANNER_GROUPS[group];
  return [0, 1, 2, 3].map((points) => {
    let chars = 0;
    while (chars < 400 && bannerFitsAt(stages, points, chars + 2)) chars += 2;
    return { points, chars, label: BANNER_LABEL };
  });
}

if (import.meta.main) {
  const table = Object.fromEntries(
    (Object.keys(BANNER_GROUPS) as BannerGroup[]).map((g) => [g, measureBannerFit(g)]),
  );
  writeFileSync(
    new URL("./banner-text-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}

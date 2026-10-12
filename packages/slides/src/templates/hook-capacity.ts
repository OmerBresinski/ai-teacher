/**
 * Hook capacity (UX ruling 203, P5; TEACH-75 part l): the most characters the hook's words may
 * have, measured by the renderer: real words cut at a word, the heading at the writer's
 * 34-character limit, nothing over on every theme and stage of the group. It feeds the fit table
 * and the writer schema's cap. Regenerate: `bun packages/slides/src/templates/hook-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import { THEMES } from "../themes";
import { sample } from "./capacity";
import { layoutTemplate, type Stage } from "./index";

export const HOOK_GROUPS = {
  KS1: ["ks1"],
  KS2: ["ks2"],
  "KS3-5": ["ks3", "ks4", "ks5"],
} as const satisfies Record<string, Stage[]>;
export type HookGroup = keyof typeof HOOK_GROUPS;

/** Whether words of `chars` characters fit under a heading at its limit everywhere in the group. */
export function hookFitsAt(stages: readonly Stage[], chars: number): boolean {
  return THEMES.every((theme) =>
    stages.every(
      (stage) =>
        layoutTemplate(
          {
            template: "hook",
            heading: sample(34, 7),
            lead: sample(chars),
            figure: { photo: "x", aspect: 16 / 9 },
          },
          theme,
          stage,
          { fullSize: true },
        ).over.length === 0,
    ),
  );
}

export function measureHookFit(group: HookGroup): { chars: number } {
  let chars = 0;
  while (chars < 600 && hookFitsAt(HOOK_GROUPS[group], chars + 2)) chars += 2;
  return { chars };
}

if (import.meta.main) {
  const table = Object.fromEntries(
    (Object.keys(HOOK_GROUPS) as HookGroup[]).map((g) => [g, measureHookFit(g)]),
  );
  writeFileSync(
    new URL("./hook-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}

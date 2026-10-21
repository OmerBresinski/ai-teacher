import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FONT_LABELS, FONT_STACKS, type FontKey } from "@tj/slides/fonts";
import { atKeyStage, THEMES } from "@tj/slides/themes";
import { resolveTextStyle } from "../slide/elements/kit";

/*
 * The text ruler (`@tj/slides` `text-measure.ts`) measures each theme's faces by `FONT_STACKS`
 * key; the page draws whatever `--font-*` resolves to in the editor's font CSS. If a stack's
 * variable were missing from that CSS, the declaration would be invalid and the text would fall
 * back to the UI face, so the ruler would measure one font while the page draws another (found
 * while building TEACH-191 part b). For every theme, stage and text preset: the ruler's family is a
 * known stack, and the editor's CSS defines its variable as that same family.
 */
const css = ["fonts.css", "fonts-playful.css"]
  .map((f) => readFileSync(join(import.meta.dir, f), "utf8"))
  .join("\n");
const declared = new Map(
  [...css.matchAll(/(--font-[a-z0-9-]+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]] as const),
);
const keyOf = new Map(
  (Object.entries(FONT_STACKS) as [FontKey, string][]).map(([k, v]) => [v, k] as const),
);
const PRESETS = ["title", "subtitle", "heading", "body", "small", "caption"] as const;

describe("the ruler's font is the rendered font", () => {
  test("every theme face, at every stage and preset, is drawn in the family the ruler measures", () => {
    const misses: string[] = [];
    for (const theme of THEMES)
      for (const stage of ["ks1", "ks2", "ks3", "ks4", "ks5"] as const)
        for (const preset of PRESETS) {
          const family = resolveTextStyle({ preset }, atKeyStage(theme, stage)).fontFamily;
          const key = keyOf.get(family);
          const cssVar = /var\((--font-[a-z0-9-]+)\)/.exec(family)?.[1];
          const drawn = cssVar ? declared.get(cssVar) : undefined;
          if (!key || !drawn || !drawn.startsWith(FONT_LABELS[key].split(" ")[0] as string))
            misses.push(`${theme.id} ${stage} ${preset}: ${family} -> ${drawn ?? "undefined"}`);
        }
    expect(misses).toEqual([]);
  });
});

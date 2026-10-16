import { describe, expect, test } from "bun:test";
import type { TextElement } from "@tj/domain/documents";
import { countLines } from "../text-measure";
import { resolveTextStyle } from "../text-style";
import { atKeyStage, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { templateSamples } from "./samples";

/*
 * A heading never breaks inside a word (TEACH-75 part aq). Each adaptive template measures its
 * title in the theme's own heading face, longest word included, and steps the title down to the
 * theme's floor until every word sits on one line; past the floor it names the heading in `over`.
 * Seen live: Treehouse "Brother / s and sisters", Crayon "Find the resultan / t".
 */

const HEADINGS = [
  "Brothers and sisters",
  "Find the resultant",
  "Photosynthesis",
  "Electromagnetism",
  "Counterbalancing forces",
];
/** The adaptive templates with a display line: the title, or the hinge's stem. */
const TEMPLATES = ["panel-list", "items-row", "split-compare", "hinge"] as const;
const STAGES: Stage[] = ["ks2", "ks3", "ks4"];

/** Lines one word takes in `el` as the renderer draws it (the box's own padding and weight). */
function wordLines(el: TextElement, word: string, stage: Stage, themeId: string): number {
  const theme = atKeyStage(THEMES.find((t) => t.id === themeId)!, stage);
  const preset = el.style.preset ?? "heading";
  const drawn = resolveTextStyle(el.style, theme, preset);
  // countLines takes the preset's padding off the width; the box's own padding is what draws.
  const presetPad = resolveTextStyle({ preset }, theme).padding;
  const width = el.w - 2 * drawn.padding + 2 * presetPad;
  return countLines(word, preset, theme, width, drawn.fontWeight, drawn.fontSize);
}

describe("a template heading never breaks inside a word, on every live theme", () => {
  const samples = templateSamples();
  for (const id of TEMPLATES) {
    const sample = samples.find((s) => s.template === id) as TemplateInput;
    test(`${id}: every word on one line, or the heading is over`, () => {
      expect(sample).toBeDefined();
      const broken: string[] = [];
      let seen = 0;
      for (const theme of THEMES)
        for (const stage of STAGES)
          for (const heading of HEADINGS) {
            // A hinge has no title: its display line is the stem, in the heading face.
            const field = id === "hinge" ? "stem" : "heading";
            const input = { ...sample, [field]: heading } as TemplateInput;
            const r = layoutTemplate(input, theme, stage);
            const name = id === "hinge" ? "Stem" : "Heading";
            const el = r.slide.elements.find(
              (e): e is TextElement => e.type === "text" && e.name === name,
            );
            if (!el) continue;
            seen += 1;
            if ((r.over ?? []).some((o) => o.startsWith(field))) continue;
            for (const word of heading.split(" "))
              if (wordLines(el, word, stage, theme.id) > 1)
                broken.push(`${theme.id}/${stage} "${word}" at ${el.style.fontSize} in ${el.w}`);
          }
      expect(seen).toBe(THEMES.length * STAGES.length * HEADINGS.length);
      expect(broken).toEqual([]);
    });
  }
});

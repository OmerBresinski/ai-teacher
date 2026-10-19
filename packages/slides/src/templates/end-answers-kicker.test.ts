import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement, TextElement } from "@tj/domain/documents";
import { countLines } from "../text-measure";
import { resolveTextStyle } from "../text-style";
import { ALL_THEMES, atKeyStage } from "../themes";
import { ANSWERS_NAMES, type AnswerGroup, endAnswerSlides, KICKER } from "./end-answers";
import type { Stage } from "./index";

/*
 * ANSBUG a2 (19 Oct): at KS1 the group kicker was set as body, snapped up to 28, and the longest
 * kicker "EXIT TICKET" wrapped in the 190-wide rail. The source title sat one assumed kicker line
 * below, so the second line printed over it in 8 themes. The kicker is now a caption (the gold's
 * red caps label) and the title stacks under the kicker's measured lines, in every theme and stage.
 */
const GROUPS: AnswerGroup[] = [
  { kind: "practice", title: "Explain this street", items: [{ n: 1, a: "4 counters" }] },
  {
    kind: "exit",
    title: "Show what you know about the Great Fire",
    items: [{ n: 1, s: "Wood burned easily, and small gaps made it easier for fire to spread." }],
  },
];
const STAGES: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
/** Gold `answers-r2.html` `--kick-size`: 30px at KS1, 26px above, at 1440 (x 2/3 on 960). */
const GOLD_KICK: Record<Stage, number> = { ks1: 20, ks2: 17.3, ks3: 17.3, ks4: 17.3, ks5: 17.3 };
/** The caption step may sit this far from the gold's size (paper KS1 18, splash KS1 20). */
const GOLD_SLACK = 2.5;

const named = (els: SlideElement[], name: string) =>
  els.filter((e): e is TextElement => e.type === "text" && e.name === name);

describe("answers rail: the kicker never prints over the source title", () => {
  for (const base of ALL_THEMES)
    for (const ks of STAGES) {
      test(`${base.id} ${ks}`, () => {
        const t = atKeyStage(base, ks);
        const els = endAnswerSlides(GROUPS, t, ks).flatMap((s: Slide) => s.elements);
        const kickers = named(els, ANSWERS_NAMES.kicker);
        const titles = named(els, ANSWERS_NAMES.source);
        expect(kickers.map((k) => k.doc.content?.[0]?.content?.[0]?.text)).toEqual([
          "PRACTICE",
          "EXIT TICKET",
        ]);
        expect(titles.length).toBe(2);
        kickers.forEach((k, i) => {
          const drawn = resolveTextStyle(k.style, t);
          // Drawn as a caption at the gold's size for the stage, never re-snapped to body.
          expect(drawn.preset).toBe("caption");
          expect(drawn.textTransform).toBe("uppercase");
          expect(drawn.fontSize).toBe(k.style?.fontSize as number);
          expect(Math.abs(drawn.fontSize - GOLD_KICK[ks])).toBeLessThanOrEqual(GOLD_SLACK);
          // The box is at least one drawn line tall and ends above the title.
          expect(k.h).toBeGreaterThanOrEqual(Math.floor(drawn.fontSize * KICKER.lineHeight));
          expect(k.y + k.h).toBeLessThanOrEqual((titles[i] as TextElement).y);
        });
      });
    }

  test("EXIT TICKET fits the rail on one line at every theme and stage", () => {
    const wraps = ALL_THEMES.flatMap((base) =>
      STAGES.filter((ks) => {
        const t = atKeyStage(base, ks);
        const size = resolveTextStyle({ preset: KICKER.preset }, t).fontSize;
        return countLines("EXIT TICKET", KICKER.preset, t, 190, KICKER.weight, size) > 1;
      }).map((ks) => `${base.id}/${ks}`),
    );
    expect(wraps).toEqual([]);
  });
});

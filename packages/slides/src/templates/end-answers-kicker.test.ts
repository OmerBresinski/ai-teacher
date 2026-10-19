import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { resolveTextStyle } from "../text-style";
import { ALL_THEMES, atKeyStage } from "../themes";
import { ANSWERS_NAMES, type AnswerGroup, endAnswerSlides, kickerHeight } from "./end-answers";

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

const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);

describe("answers rail: the kicker never prints over the source title", () => {
  for (const base of ALL_THEMES)
    for (const ks of ["ks1", "ks2", "ks3"] as const) {
      test(`${base.id} ${ks}`, () => {
        const t = atKeyStage(base, ks);
        const els = endAnswerSlides(GROUPS, t, ks).flatMap((s) => s.elements);
        const kickers = named(els, ANSWERS_NAMES.kicker);
        const titles = named(els, ANSWERS_NAMES.source);
        expect(kickers.length).toBe(2);
        expect(titles.length).toBe(2);
        kickers.forEach((k, i) => {
          const title = titles[i] as SlideElement;
          const word = i === 0 ? "PRACTICE" : "EXIT TICKET";
          // The kicker's box holds every line it wraps to, and ends above the title.
          expect(k.h).toBeGreaterThanOrEqual(kickerHeight(t, word));
          expect(k.y + k.h).toBeLessThanOrEqual(title.y);
          // Drawn as the caption it was measured as: never re-snapped to the body step.
          const style = k.type === "text" ? k.style : undefined;
          const drawn = resolveTextStyle(style, t);
          expect(drawn.preset).toBe("caption");
          expect(drawn.fontSize).toBe(style?.fontSize as number);
        });
      });
    }

  test("EXIT TICKET fits the rail on one line at every theme and stage", () => {
    const wraps = ALL_THEMES.flatMap((base) =>
      (["ks1", "ks2", "ks3"] as const)
        .filter((ks) => {
          const t = atKeyStage(base, ks);
          return (
            kickerHeight(t, "EXIT TICKET") >
            Math.ceil(resolveTextStyle({ preset: "caption" }, t).fontSize * 1.2)
          );
        })
        .map((ks) => `${base.id}/${ks}`),
    );
    expect(wraps).toEqual([]);
  });
});

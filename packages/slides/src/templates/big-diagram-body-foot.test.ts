import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { layoutTemplate, MODEL_BODY, type Stage } from "./index";

/*
 * TEACH-247 part df: a library model drawn as the slide body is laid from the measured heading, so
 * the heading fit must not move it again. Y9 equations slide 5 set its caption at y 508, h 35 on a
 * 540-high slide: the fit took a smaller heading for room, which also moved the body up, and then
 * moved the body down by what the larger heading had needed. Text ran off the slide.
 */
const SVG = `<svg viewBox="17 194 1224 415" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="200" width="1200" height="400" fill="#eee"/><text x="40" y="240" font-size="30">In</text></svg>`;
const drawn = (aspect: number) => ({
  drawn: {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`,
    aspect,
    alt: "A function machine.",
    body: true,
  },
});
const named = (els: SlideElement[], name: string) => els.find((e) => e.name === name);
const stages: Stage[] = ["ks1", "ks2", "ks3", "ks4"];

describe("a library model as the slide body stays on the slide with its caption", () => {
  const cases = [
    [
      "the saved slide's words",
      "Reverse the machine",
      "Adding 3, then dividing by 2, gives x = 5.",
    ],
    [
      "a two-line caption",
      "Reverse the machine",
      "Adding 3, then dividing by 2, gives x = 5, and checking it in the first line gives 7 again, as the slide said it would.",
    ],
    [
      "a two-line heading",
      "Reverse the machine one step at a time, starting from the output it gives",
      "Adding 3, then dividing by 2, gives x = 5.",
    ],
  ] as const;
  for (const [label, heading, lead] of cases)
    for (const stage of stages)
      for (const aspect of [1224 / 415, 16 / 9, 1])
        test(`${label}, ${stage}, aspect ${aspect.toFixed(2)}`, () => {
          for (const theme of THEMES) {
            const els = layoutTemplate(
              { template: "big-diagram", heading, lead, figure: drawn(aspect) as never },
              theme,
              stage,
            ).slide.elements;
            const head = named(els, "Heading");
            const fig = named(els, "Diagram");
            const cap = named(els, "Caption");
            if (!head || !fig || !cap) throw new Error("heading, diagram and caption are all set");
            // The caption ends inside the body's foot, clear of the slide's bottom band.
            expect(cap.y + cap.h).toBeLessThanOrEqual(MODEL_BODY.foot);
            // Neither hides the other: heading, drawing and caption run down the slide in order.
            expect(fig.y).toBeGreaterThanOrEqual(head.y + head.h);
            expect(fig.y + fig.h).toBeLessThanOrEqual(cap.y);
          }
        });

  test("the heading keeps its full size: the body makes its own room", () => {
    const theme = THEMES[0];
    if (!theme) throw new Error("a theme");
    const lay = (lead?: string) =>
      layoutTemplate(
        {
          template: "big-diagram",
          heading: "Reverse the machine",
          ...(lead ? { lead } : {}),
          figure: drawn(1224 / 415) as never,
        },
        theme,
        "ks3",
      ).slide.elements;
    const plain = layoutTemplate(
      { template: "explain", heading: "Reverse the machine", lead: "Words." },
      theme,
      "ks3",
    ).slide.elements;
    const size = (els: SlideElement[]) =>
      (named(els, "Heading") as { style?: { fontSize?: number } }).style?.fontSize;
    expect(size(lay("Adding 3, then dividing by 2, gives x = 5."))).toBe(size(plain));
  });
});

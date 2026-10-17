import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement } from "@tj/domain/documents";
import { contrastRatio } from "@tj/slides";
import { dimInk } from "@tj/slides/surfaces";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { THEMES } from "@tj/slides/themes";
import { choiceMarks } from "./choice";
import { hingeDimParts } from "./HingeMarks";

/*
 * TEACH-256 part d (rulings 258, 248): the one-click reveal redraws each wrong hinge card with its
 * words, key and bars in the theme's dim tone, never an opacity wash; the right card is not dimmed.
 */
const LOOKS: [string, TemplateInput][] = [
  [
    "tiles",
    {
      template: "hinge",
      heading: "Which part makes seeds?",
      options: ["Leaf", "Root", "Flower"],
      choices: [
        { text: "Leaf", icon: "leaf" },
        { text: "Root", icon: "root" },
        { text: "Flower", icon: "flower" },
      ],
      correct: 2,
    },
  ],
  [
    "2x2",
    {
      template: "hinge",
      heading: "Which of these metals is magnetic?",
      options: ["Copper", "Iron", "Aluminium", "All of them"],
      correct: 2,
    },
  ],
  [
    "rows",
    {
      template: "hinge",
      heading: "Quick check",
      stem: "Which part of the blood carries oxygen around the body?",
      options: ["Red blood cells", "White blood cells", "Platelets", "Plasma"],
      correct: 1,
    },
  ],
];

const colourOf = (e: SlideElement): string | undefined =>
  e.type === "text" ? e.style.color : undefined;

describe("hinge reveal: wrong options in the dim tone", () => {
  for (const theme of THEMES)
    for (const [look, input] of LOOKS)
      test(`${theme.id}, ${look}: every wrong option's words read at 4.5:1 on its card`, () => {
        const r = layoutTemplate(input, theme, "ks2");
        const slide = { id: "s1", ...r.slide } as Slide;
        const marks = choiceMarks(slide, true, 0);
        const wrong = marks.filter((m) => m.state === "dim");
        const right = marks.filter((m) => m.state === "right");
        expect(right).toHaveLength(1);
        expect(wrong.length).toBe(marks.length - 1);
        const dim = dimInk(theme);
        for (const { id } of wrong) {
          const [card, ...parts] = hingeDimParts(slide, theme, id);
          const fill = card && "fill" in card ? (card.fill as string) : "";
          const words = parts.filter((p) => p.type === "text");
          expect(words.length).toBeGreaterThan(0);
          for (const w of words) {
            expect(colourOf(w)).toBe(dim);
            expect(w.opacity ?? 1).toBe(1);
            expect(contrastRatio(dim, fill)).toBeGreaterThanOrEqual(4.5);
          }
          // The key's letter (the card's fill) on the dim key reads as the words do on the card.
          const key = parts.find((p) => p.name === "Hinge key");
          expect(key && "fill" in key ? key.fill : null).toBe(dim);
          const letter = key?.type === "shape" ? key.textStyle?.color : undefined;
          expect(contrastRatio(letter as string, dim)).toBeGreaterThanOrEqual(4.5);
        }
      });
});

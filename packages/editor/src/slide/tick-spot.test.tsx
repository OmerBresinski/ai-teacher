import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { Slide } from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { THEMES } from "@tj/slides";
import {
  type ActivityCard,
  activityFixtures,
  layoutTemplate,
  type Stage,
  type TemplateInput,
} from "@tj/slides/templates";
import { choiceMarks } from "./elements/choice";
import { SlideView } from "./SlideView";
import { type Box, intersects, TICK_D, tickSpot, wordBoxes } from "./tick-spot";

/*
 * TEACH-101 part h. The tick on a revealed right card (choose, odd one out) never lands on words:
 * the option's own text, its letter badge, a neighbour's text, the heading or the lead. Every
 * fixture, plus word-only cards with long option text (the case the old top-right tick covered),
 * at every key stage on every theme.
 */

afterEach(cleanup);

const STAGES: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];

const LONG = [
  "Photosynthesis makes glucose in the leaves",
  "Respiration releases energy in every cell",
  "Transpiration pulls water up the stem",
  "Diffusion moves particles down a gradient",
];
const LONGER = [
  "Photosynthesis makes glucose from carbon dioxide and water",
  "Respiration releases energy from glucose in every cell",
  "Transpiration pulls water up the stem and out of the leaves",
  "Diffusion moves particles from high to low concentration",
];
const SHORT = ["Leaf", "Root hair cell", "Xylem", "Stomata"];

const words = (texts: string[]): ActivityCard[] => texts.map((text) => ({ text }));

function inputs(): { name: string; input: TemplateInput }[] {
  const fixtures = activityFixtures(() => ({ src: "" }))
    .filter((f) => f.name === "choose" || f.name === "odd-one-out")
    .map((f) => ({ name: `${f.name} fixture`, input: f.input }));
  const wordOnly: { name: string; input: TemplateInput }[] = [];
  for (const template of ["choose", "odd-one-out"] as const)
    for (const [kind, texts] of [
      ["long", LONG],
      ["long", LONGER],
      ["short", SHORT],
    ] as const)
      for (const n of [3, 4])
        for (let correct = 1; correct <= n; correct++)
          wordOnly.push({
            name: `${template} ${kind} ${n} cards, right ${correct}`,
            input: {
              template,
              heading: "Which process moves water up a plant?",
              lead: "Choose one and say why.",
              correct,
              cards: words(texts.slice(0, n)),
            } as TemplateInput,
          });
  return [...fixtures, ...wordOnly];
}

const corpus = (() => {
  const out: { label: string; slide: Slide }[] = [];
  for (const theme of THEMES)
    for (const { name, input } of inputs())
      for (const stage of STAGES) {
        const r = layoutTemplate(input, theme, stage);
        // A card the template marks over-full is sent back to the writer, never shown.
        if (r.over.length) continue;
        out.push({
          label: `${name} ${stage} ${theme.id}`,
          slide: { id: "s", ...r.slide } as Slide,
        });
      }
  return out;
})();

/** The right card's tick box in slide space, with the card's id, via `spot`. */
const ticks = (slide: Slide, spot: typeof tickSpot) =>
  choiceMarks(slide, true, 0)
    .filter((m) => m.state === "right")
    .flatMap(({ id }) => {
      const card = slide.elements.find((e) => e.id === id);
      if (!card) return [];
      const s = spot(slide, card);
      return [{ id, box: { x: card.x + s.left, y: card.y + s.top, w: TICK_D, h: TICK_D } }];
    });

/** The tick master drew: inside the card's top-right corner, inset 10. */
const oldSpot: typeof tickSpot = (_s, card) => ({ left: card.w - 10 - TICK_D, top: 10 });

const hits = (spot: typeof tickSpot) => {
  const out: string[] = [];
  let checked = 0;
  for (const { label, slide } of corpus)
    for (const { id, box } of ticks(slide, spot)) {
      checked++;
      for (const b of wordBoxes(slide, id)) if (intersects(box, b)) out.push(label);
    }
  return { checked, out: [...new Set(out)] };
};

describe("the revealed tick never covers words", () => {
  test("the corpus holds long word cards, and the old top-right tick covered their text", () => {
    const long = corpus.filter((c) => c.label.includes(" long "));
    expect(long.length).toBeGreaterThan(100);
    const { out } = hits(oldSpot);
    expect(out.filter((l) => l.includes(" long ")).length).toBeGreaterThan(50);
  });

  test("every choose and odd-one-out card, every key stage and theme", () => {
    const { checked, out } = hits(tickSpot);
    expect(checked).toBe(corpus.length);
    expect(out).toEqual([]);
  });

  test("the tick stays on the slide", () => {
    for (const { label, slide } of corpus)
      for (const { box } of ticks(slide, tickSpot)) {
        const on = box.x >= 0 && box.y >= 0 && box.x + box.w <= SLIDE_W && box.y + box.h <= SLIDE_H;
        if (!on) throw new Error(`${label}: tick off the slide`);
      }
  });

  test("a picture card keeps its tick inside the top-right corner, over the picture", () => {
    for (const { label, slide } of corpus.filter((c) => c.label.includes("fixture")))
      for (const { id } of ticks(slide, tickSpot)) {
        const card = slide.elements.find((e) => e.id === id) as Box;
        const s = tickSpot(slide, card);
        expect({ label, ...s }).toEqual({ label, left: card.w - 10 - TICK_D, top: 10 });
      }
  });
});

describe("SlideView draws the tick where tickSpot puts it", () => {
  test("a long word-only choose card", () => {
    const theme = THEMES.find((t) => t.id === "paper");
    if (!theme) throw new Error("no paper theme");
    const input = {
      template: "choose",
      heading: "Which process moves water up a plant?",
      correct: 1,
      cards: words(LONGER.slice(0, 3)),
    } as TemplateInput;
    const slide = { id: "s", ...layoutTemplate(input, theme, "ks2").slide } as Slide;
    const [tick] = ticks(slide, tickSpot);
    if (!tick) throw new Error("no right card");
    const { container } = render(
      <SlideView slide={slide} theme={theme} mode="present" revealAnswer answerProgress={99} />,
    );
    const mark = container.querySelector('[data-choice-mark="right"]') as HTMLElement;
    const badge = container.querySelector("[data-tick-spot]") as HTMLElement;
    expect(badge).not.toBeNull();
    const card = slide.elements.find((e) => e.id === tick.id) as Box;
    expect(Number.parseFloat(mark.style.left) + Number.parseFloat(badge.style.left)).toBe(
      tick.box.x,
    );
    expect(Number.parseFloat(mark.style.top) + Number.parseFloat(badge.style.top)).toBe(tick.box.y);
    // Off the old spot: the long word fills the top of the card.
    expect(Number.parseFloat(badge.style.top)).not.toBe(10);
    expect(card.w).toBeGreaterThan(0);
    // The tick is drawn, centred on its disc (#605), not a font's ✓.
    expect(badge.querySelector("svg polygon")).not.toBeNull();
    expect(badge.textContent).not.toContain("✓");
  });
});

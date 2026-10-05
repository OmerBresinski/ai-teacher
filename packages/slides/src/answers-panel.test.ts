import { describe, expect, it } from "bun:test";
import type { Theme } from "@tj/domain/documents";
import { fitsPlanned } from "./fit-check";
import { fitSlide } from "./fit-slide";
import { SAFE } from "./grid";
import { materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";
import { ROW_CARD_NAME, ROW_REVEAL_NAME, ROW_TEXT_NAME } from "./structure";
import { THEMES } from "./themes";

/*
 * A set of open questions as one numbered card per question, each answer revealed inside its own
 * card (layout audit, 30 Sep 2026). The card is measured with its answer in it, so the reveal can
 * never cover a question or run off the slide.
 */
const QUESTIONS = [
  "What is 3 × 4 equal to?",
  "Name the capital of France.",
  "What do plants need to grow?",
];
const meta = { promptVersion: "answers-panel", model: "test", at: "2026-09-30" };

function starter(answers: string[]): SlideSpec {
  return {
    kind: "starter",
    factRefs: [],
    heading: "Starter",
    items: QUESTIONS,
    footnote: `Answers: ${answers.map((a, i) => `${i + 1} ${a}`).join("  ·  ")}`,
  };
}

describe("a set's answers are revealed inside their own cards (layout audit #2)", () => {
  for (const [label, answers] of [
    ["one-word answers", ["12", "Paris", "Light"]],
    ["phrase answers", ["Twelve, three fours", "Paris, on the Seine", "Light, water and air"]],
  ] as const) {
    it.each(THEMES.map((t) => [t.id, t]))(`${label} on %s`, (_id, theme: Theme) => {
      const slide = fitSlide(materialiseSlide(starter([...answers]), theme.id, meta), theme).slide;
      // A plain numbered list (ruling 162): no cards; each answer revealed in its question's row.
      expect(slide.elements.filter((e) => e.name === ROW_CARD_NAME)).toHaveLength(0);
      const cards = slide.elements
        .filter((e) => e.name === ROW_TEXT_NAME)
        .sort((a, b) => a.y - b.y);
      const reveals = slide.elements.filter((e) => e.name === ROW_REVEAL_NAME);
      expect(cards).toHaveLength(3);
      expect(reveals).toHaveLength(3);
      reveals.forEach((r, i) => {
        const c = cards[i] as (typeof cards)[number];
        const next = cards[i + 1];
        expect(r.revealStep).toBe(1);
        expect(r.y).toBeGreaterThanOrEqual(c.y);
        if (next) expect(r.y + r.h).toBeLessThanOrEqual(next.y);
      });
      // Measured in the revealed state: nothing past the safe area with every answer shown.
      expect(fitSlide(slide, theme).overflow).toEqual([]);
      expect(Math.max(...cards.map((c) => c.y + c.h))).toBeLessThanOrEqual(SAFE.y + SAFE.h);
    });
  }
});

describe("a set whose answers sit in its cards keeps its questions at body size", () => {
  it.each([
    ["one question", [QUESTIONS[0] as string], ["12"]],
    ["three questions", QUESTIONS, ["12", "Paris", "Light"]],
  ] as const)("%s passes the save gate at stepDown 0 on every theme", (_l, items, answers) => {
    const spec = { ...starter([...answers]), items: [...items] } as SlideSpec;
    expect(fitsPlanned(spec, { stepDown: 0 }).failing.map((f) => f.theme)).toEqual([]);
  });
});

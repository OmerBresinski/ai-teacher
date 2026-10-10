import { describe, expect, it } from "bun:test";
import type { Slide, Theme } from "@tj/domain/documents";
import { materialiseSlide } from "./materialise";
import { ANSWERS_NAME } from "./reflow";
import type { SlideSpec } from "./specs";
import { answersOnOwnSlide } from "./structure";
import { getTheme, THEMES } from "./themes";

/*
 * prod-17: the production photosynthesis lesson's quick check (one generated slide, so no page can
 * be added) kept its answers panel as a reveal over questions 3 and 4. When the panel cannot clear
 * the questions on the one slide, the answers go on a slide of their own straight after, "Quick check: answers" (UX ruling,
 * Greg 10 Oct; `answersOnOwnSlide`, which generation's Repair applies to the finished deck).
 */

const ANSWERS = [
  "carbon dioxide + water → glucose + oxygen",
  "Light energy",
  "The atoms are rearranged to make glucose and oxygen; they are not created or destroyed.",
  "Chlorophyll absorbs and transfers light energy to the reactions that use carbon dioxide and water to make glucose and oxygen.",
];
const STEPS = [
  "State the word equation for photosynthesis.",
  "In a lettuce leaf, what does chlorophyll absorb?",
  "What happens to the atoms of carbon dioxide and water in photosynthesis?",
  "Explain how chlorophyll helps a leaf make glucose.",
];
const meta = { promptVersion: "answers-off", model: "test", at: "2026-10-10T10:00:00.000Z" };

const spec = (answers: string[]): SlideSpec => ({
  kind: "instructions",
  factRefs: [],
  heading: "Quick check",
  steps: STEPS,
  footnote: `Answers: ${answers.map((a, i) => `${i + 1} ${a}`).join("  ·  ")}`,
});

/** The foot of every box on the slide that is not the panel, the heading's chrome or a reveal. */
function questionsFoot(slide: Slide): number {
  return Math.max(
    ...slide.elements
      .filter((e) => e.type === "text" && !e.revealStep && e.name !== "Heading" && e.y > 120)
      .map((e) => e.y + e.h),
  );
}

describe("a quick check's answers never cover its questions", () => {
  it.each(THEMES.map((t) => [t.id, t]))(
    "long answers on %s get their own slide",
    (_id, theme: Theme) => {
      const pages = answersOnOwnSlide(materialiseSlide(spec(ANSWERS), theme.id, meta), theme);
      expect(pages).toHaveLength(2);
      const [questions, answers] = pages as [Slide, Slide];
      expect(questions.elements.some((e) => e.name === ANSWERS_NAME)).toBe(false);
      const words = JSON.stringify(answers.elements);
      expect(words).toContain("Quick check: answers");
      for (const [i, a] of ANSWERS.entries()) {
        expect(words).toContain(`"${i + 1} "`);
        expect(words).toContain(a);
      }
      expect(answers.elements.every((e) => !e.revealStep)).toBe(true);
      expect(questionsFoot(questions)).toBeGreaterThan(0);
    },
  );

  it("short answers that clear the questions keep their reveal on the slide", () => {
    const pages = answersOnOwnSlide(
      materialiseSlide(spec(["Yes", "Light", "Kept", "It absorbs light"]), "studio", meta),
      getTheme("studio"),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]?.elements.some((e) => (e.revealStep ?? 0) >= 1)).toBe(true);
  });
});

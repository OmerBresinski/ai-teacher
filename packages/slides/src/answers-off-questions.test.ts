import { describe, expect, it } from "bun:test";
import type { Slide, Theme } from "@tj/domain/documents";
import { materialiseSlide } from "./materialise";
import { ANSWERS_NAME } from "./reflow";
import type { SlideSpec } from "./specs";
import { answersOffQuestions } from "./structure";
import { getTheme, THEMES } from "./themes";

/*
 * prod-17: the production photosynthesis lesson's quick check (one generated slide, so no page can
 * be added) kept its answers panel as a reveal over questions 3 and 4. When the panel cannot clear
 * the questions on the one slide, the answers leave the face of the slide for the speaker notes (`answersOffQuestions`, which
 * generation's coded sets go through in `withAnswersReveal`).
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

describe("a quick check's answers never cover its questions on one slide", () => {
  it.each(THEMES.map((t) => [t.id, t]))("long answers on %s", (_id, theme: Theme) => {
    const slide = answersOffQuestions(materialiseSlide(spec(ANSWERS), theme.id, meta), theme);
    const panel = slide.elements.find((e) => e.name === ANSWERS_NAME);
    if (panel) expect(panel.y).toBeGreaterThanOrEqual(questionsFoot(slide));
    else for (const a of ANSWERS) expect(slide.notes ?? "").toContain(a);
  });

  it("short answers that clear the questions keep their reveal on the slide", () => {
    const slide = answersOffQuestions(
      materialiseSlide(spec(["Yes", "Light", "Kept", "It absorbs light"]), "studio", meta),
      getTheme("studio"),
    );
    expect(slide.elements.some((e) => (e.revealStep ?? 0) >= 1)).toBe(true);
  });
});

import { describe, expect, it } from "bun:test";
import type { Theme } from "@tj/domain/documents";
import { answersOverQuestions, fitsPlanned } from "./fit-check";
import { fitSlide } from "./fit-slide";
import { materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";
import { THEMES } from "./themes";

/*
 * A set of open questions with its answers on a reveal panel: the panel never covers a question,
 * however short the answers (oracle fault 2). The list's box used to keep the height the fit gave
 * it with the footnote in the flow, so a one-line footnote left a tall box that the panel
 * overlapped, and one-word answers failed on six themes where longer ones passed.
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

describe("a set's answers panel clears its questions", () => {
  for (const [label, answers] of [
    ["one-word answers", ["12", "Paris", "Light"]],
    ["phrase answers", ["Twelve, three fours", "Paris, on the Seine", "Light, water and air"]],
  ] as const) {
    it.each(THEMES.map((t) => [t.id, t]))(`${label} on %s`, (_id, theme: Theme) => {
      const slide = fitSlide(materialiseSlide(starter([...answers]), theme.id, meta), theme).slide;
      expect(slide.elements.some((e) => e.name === "Answers")).toBe(true);
      expect(answersOverQuestions(slide, theme)).toEqual([]);
    });
  }
});

describe("a set whose answers go to the panel keeps its questions at body size", () => {
  it.each([
    ["one question", [QUESTIONS[0] as string], ["12"]],
    ["three questions", QUESTIONS, ["12", "Paris", "Light"]],
  ] as const)("%s passes the save gate at stepDown 0 on every theme", (_l, items, answers) => {
    const spec = { ...starter([...answers]), items: [...items] } as SlideSpec;
    expect(fitsPlanned(spec, { stepDown: 0 }).failing.map((f) => f.theme)).toEqual([]);
  });
});

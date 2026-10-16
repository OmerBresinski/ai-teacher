import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { layoutTemplate } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import { withEndAnswers } from "./materialise";

/*
 * TEACH-191 part b (ruling 240): the shipped deck ends on the guard and its Answers slides, laid out
 * from the practice and exit slides' own answers; a worksheet answer sheet keeps them off the deck.
 */
const theme = atKeyStage(getTheme("splash", null), "ks2");
const deck = (): Slide[] =>
  [
    layoutTemplate({ template: "title", heading: "Column addition" }, theme, "ks2"),
    layoutTemplate(
      {
        template: "practice",
        heading: "Add using the column method",
        questions: ["2,345 + 3,900", "4,102 + 2,100"],
        answers: ["6,245", "6,202"],
      },
      theme,
      "ks2",
    ),
    layoutTemplate(
      {
        template: "exit-ticket",
        heading: "Column addition",
        questions: ["Why carry?"],
        answers: ["Because the column holds more than nine."],
      },
      theme,
      "ks2",
    ),
  ].map((r, i) => ({ id: `s${i}`, ...r.slide }) as Slide);

describe("withEndAnswers", () => {
  test("appends the guard and the Answers slides after the lesson, in that order", () => {
    const out = withEndAnswers(deck(), { theme, stage: "ks2", worksheetAnswerKey: false });
    expect(out.slice(0, 3).map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(out.slice(3).map((s) => s.answersRole)).toEqual(["guard", "answers"]);
  });

  test("a rebuild replaces the old end; a worksheet answer sheet keeps them (r3 gold)", () => {
    const once = withEndAnswers(deck(), { theme, stage: "ks2", worksheetAnswerKey: false });
    const twice = withEndAnswers(once, { theme, stage: "ks2", worksheetAnswerKey: false });
    expect(twice.map((s) => s.answersRole)).toEqual(once.map((s) => s.answersRole));
    // r3 gold (the default): a worksheet answer sheet still keeps the Answers slides.
    expect(
      withEndAnswers(once, { theme, stage: "ks2", worksheetAnswerKey: true }).map(
        (s) => s.answersRole,
      ),
    ).toEqual(once.map((s) => s.answersRole));
  });
});

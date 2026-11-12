import { describe, expect, test } from "bun:test";
import {
  answerLinesFor,
  answerSpace,
  DRAW_BOX_PT,
  WORKING_BOX_PT,
  workingBoxPt,
} from "./exit-sheet";

/*
 * R5 (12 Nov key check): answer space from the key. Items are real v5 Practice items
 * (scratchpad/tuning/e2e-11nov/out/ws-v5-rep*), as the model wrote them.
 */
const lines = (question: string, answer: string, year: string) => {
  const space = answerSpace(question, undefined);
  if (space !== "explain" && space !== "short") throw new Error(space);
  return answerLinesFor(space, answer, year, question);
};

describe("lines from the key", () => {
  test("Y8 rep4: a one-word answer gets one line, a two-part explanation three", () => {
    expect(
      lines(
        "In the food chain grass → rabbit → fox, which organism first makes glucose by photosynthesis?",
        "The grass.",
        "Year 8",
      ),
    ).toBe(1);
    expect(
      lines(
        "A pupil says, “Carbon dioxide supplies the energy for photosynthesis.” Is the pupil right? Explain why.",
        "No. Chlorophyll absorbs light energy for photosynthesis, and the energy is transferred to a chemical store in glucose.",
        "Year 8",
      ),
    ).toBe(3);
  });
  test("Y2 rep1: a picked option gets one line, a two-part answer more than one", () => {
    expect(
      lines(
        "Which would help stop flames reaching another house: leaving close wooden houses standing or pulling houses down to make gaps?",
        "Pulling houses down to make gaps.",
        "Year 2",
      ),
    ).toBe(1);
    expect(
      lines(
        "A dry summer and close wooden houses helped the fire spread. Name one more thing that helped it spread and one way people helped stop it.",
        "Strong winds carried flames between houses. People carried water in buckets or pulled down houses to make gaps.",
        "Year 2",
      ),
    ).toBe(3);
  });
  test("a short list fits one line, and no task passes the band's cap", () => {
    expect(
      lines(
        "Which two substances are the products of photosynthesis?",
        "Glucose and oxygen.",
        "Year 8",
      ),
    ).toBe(1);
    expect(lines("Explain everything.", "word ".repeat(200), "Year 2")).toBe(4);
    expect(lines("Explain everything.", "word ".repeat(200), "Year 9")).toBe(6);
  });
});

describe("boxes from the key", () => {
  test("a bar model gets a drawing box; working grows with its steps, within a third more", () => {
    expect(workingBoxPt("Draw a bar model to find 1¼ of 40.", "40 ÷ 4 = 10; 10 × 5 = 50")).toBe(
      DRAW_BOX_PT,
    );
    expect(workingBoxPt("What is 1/5 of 35?", "35 ÷ 5 = 7")).toBe(WORKING_BOX_PT);
    expect(
      workingBoxPt(
        "A piece of ribbon is 20 metres long. Find 3/4 of its length, then find 6/5 of that amount.",
        "20 ÷ 4 = 5; 5 × 3 = 15; 15 ÷ 5 = 3; 3 × 6 = 18",
      ),
    ).toBe(64);
  });
});

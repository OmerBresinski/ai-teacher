import { describe, expect, test } from "bun:test";
import { SAFE_BOTTOM } from "../metrics";
import { atKeyStage, getTheme } from "../themes";
import { ANSWER_GAP, answerHeight, G, layoutTemplate, shownMinFont, templateScale } from "./index";

const theme = getTheme("splash");
const scale = { s: templateScale(theme, "ks2"), t: atKeyStage(theme, "ks2") };
const bottomOf = (els: { name?: string; y: number; h: number }[], skip: string[] = []) =>
  Math.max(...els.filter((e) => !skip.includes(e.name ?? "")).map((e) => e.y + e.h));

/*
 * Question lists' revealed answers (LAYOUT-GALLERY A-practice: the answers' second line was cut
 * off and `over` was empty). The answers are measured with the questions: the questions lay out
 * above a lane at the foot that holds every answer line.
 */
describe("question lists lay out with their answers revealed", () => {
  const practice = {
    template: "practice" as const,
    heading: "Practice",
    instruction: "Work with a partner.",
    questions: [
      "Find your pulse on the inside of your wrist.",
      "Count the beats for 15 seconds.",
      "Multiply by 4 to find your heart rate.",
    ],
    answers: [
      "Use two fingers, below your thumb.",
      "For example, 20 beats.",
      "20 × 4 = 80 beats per minute.",
    ],
  };

  for (const template of ["practice", "exit-ticket", "question-set"] as const)
    test(`${template}: every answer line fits under the questions and the instruction`, () => {
      const r = layoutTemplate({ ...practice, template }, theme, "ks2");
      expect(r.over).toEqual([]);
      const answer =
        r.slide.question?.type === "open-response" ? (r.slide.question.modelAnswer ?? "") : "";
      expect(answer.split("\n")).toHaveLength(3);
      const below = bottomOf(r.slide.elements);
      expect(below + ANSWER_GAP + answerHeight(scale, answer)).toBeLessThanOrEqual(SAFE_BOTTOM);
    });

  test("with a figure, the figure panel also stops above the answers' lane", () => {
    const r = layoutTemplate(
      {
        ...practice,
        questions: ["Find your pulse.", "Count for 15 seconds.", "Multiply by 4."],
        answers: ["Two fingers.", "20 beats.", "80 a minute."],
        figure: { photo: "https://pics.test/run.jpg", aspect: 1, alt: "A boy running" },
      },
      theme,
      "ks2",
    );
    const answer =
      r.slide.question?.type === "open-response" ? (r.slide.question.modelAnswer ?? "") : "";
    expect(
      bottomOf(r.slide.elements) + ANSWER_GAP + answerHeight(scale, answer),
    ).toBeLessThanOrEqual(SAFE_BOTTOM);
  });

  test("answers too long for the lane: the questions keep the band (answers reveal on their sheet)", () => {
    const long =
      "Embalmers placed the preserved body in a coffin to protect it, because Egyptians believed the body was needed in the afterlife.";
    const r = layoutTemplate({ ...practice, answers: [long, long, long] }, theme, "ks2");
    expect(r.over).toEqual([]);
    // Type never steps below the floor to squeeze them in.
    for (const e of r.slide.elements)
      if (e.type === "text") expect(e.style.fontSize ?? 18).toBeGreaterThanOrEqual(18);
  });

  test("an answer too long even for the sheet is reported over, never cut in silence", () => {
    const huge = Array.from(
      { length: 14 },
      () => "A long model answer that runs on across the slide.",
    ).join(" ");
    const r = layoutTemplate({ ...practice, answers: [huge, huge, huge] }, theme, "ks2");
    expect(r.over.some((o) => o.startsWith("answers "))).toBe(true);
  });
});

/*
 * T2-CODE-RANK (maths s5): big-diagram skipped its type checks for an already-drawn figure, so a
 * drawn bar model came across the slide at 16 pt labels. The drawn figure now meets the 18 pt
 * floor and must be no smaller across than beside the words, or the slide is diagram + text.
 */
describe("big diagram checks an already-drawn figure's label size", () => {
  const tall = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><g><rect width="100" height="200" fill="#ddd"/><text x="10" y="40" font-size="20">Bar</text></g></svg>',
  )}`;
  test("a drawing that would show smaller across is laid beside the words", () => {
    const r = layoutTemplate(
      {
        template: "big-diagram",
        heading: "Bar model",
        points: ["The whole is 24.", "Each part is 8."],
        figure: { drawn: { src: tall, aspect: 0.5 } },
      },
      theme,
      "ks2",
    );
    const d = r.slide.elements.find((e) => e.name === "Diagram");
    expect(d).toBeDefined();
    expect(d?.w ?? 999).toBeLessThanOrEqual(G.panel.w);
    expect(shownMinFont(d as { w: number; h: number; src: string }) ?? 0).toBeGreaterThanOrEqual(
      18,
    );
  });
});

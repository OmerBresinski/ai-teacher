import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { DEMO_LESSON_FACTS, materialiseSlide } from "@tj/slides";
import {
  CLOSING_LINE_NAME,
  closingLine,
  closingSlideFits,
  closingSpec,
  exitTicketQuestions,
  withClosingLine,
} from "./closing";

const meta = { promptVersion: "test", model: "code", at: "2026-10-01T00:00:00.000Z" };

describe("the close (UX ruling 141)", () => {
  test("its own slide from 8 slides asked for; at 6 the line goes on the last slide", () => {
    expect(closingSlideFits(6)).toBe(false);
    expect([8, 10, 12].every(closingSlideFits)).toBe(true);
  });

  test("counts the worksheet exit ticket's questions, its model slot as one", () => {
    // The recipe asks three questions from the facts, and leaves one slot for a fourth.
    expect(exitTicketQuestions(DEMO_LESSON_FACTS)).toBe(4);
  });

  test("the closing slide points to the worksheet and says how many questions", () => {
    const slide = materialiseSlide(closingSpec(4, ["o1"]), "classic", meta);
    const words = JSON.stringify(slide.elements);
    expect(slide.kind).toBe("plenary");
    expect(words).toContain("Exit ticket");
    expect(words).toContain("Complete it on your worksheet.");
    expect(words).toContain("4 questions, on your own.");
  });

  test("the line on the last slide, once however often it is added", () => {
    expect(closingLine(1)).toBe("Exit ticket: complete it on your worksheet (1 question).");
    const base = { id: "s6", kind: "content", elements: [] } as unknown as Slide;
    const once = withClosingLine(withClosingLine(base, closingLine(4)), closingLine(4));
    const lines = once.elements.filter((e) => e.name === CLOSING_LINE_NAME);
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0])).toContain("(4 questions)");
  });
});

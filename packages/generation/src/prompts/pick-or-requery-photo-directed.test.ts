import { describe, expect, test } from "bun:test";
import {
  MADE_PICTURE_RULES,
  type PickOrRequeryInput,
  pickOrRequeryPrompt,
} from "./pick-or-requery-photo-directed";

const input: PickOrRequeryInput = {
  topic: "A past event",
  lessonTitle: "A past event",
  audience: { yearGroup: "Year 2", readingLevel: "Year 2", language: "en-GB" },
  objectives: [],
  vocabulary: [],
  slideBrief: "A painted scene of the event.",
  subject: "A painted scene of the event.",
  mustShow: ["a brick oven", "small flames"],
  period: "A city, 1600s",
  purpose: "context",
  queries: [],
  candidates: [{ id: "made", alt: "A painted scene of the event.", thumbnail: "data:" }],
} as PickOrRequeryInput;

describe("pick-or-requery v18: painted pictures (TEACH-251 part x)", () => {
  test("a real photograph's request carries none of the painted rules", () => {
    const text = pickOrRequeryPrompt.user(input);
    expect(text).not.toContain(MADE_PICTURE_RULES);
    expect(text).not.toContain("painting made for this slide");
  });

  test("a generated painting gets the painted rules after its period and items, before the searches", () => {
    const text = pickOrRequeryPrompt.user({ ...input, made: true });
    const at = text.indexOf(MADE_PICTURE_RULES);
    expect(at).toBeGreaterThan(text.indexOf("Period and place: A city, 1600s"));
    expect(at).toBeGreaterThan(text.indexOf("Required items"));
    expect(at).toBeLessThan(text.indexOf("Searches already tried:"));
  });

  test("a reused painting keeps the reuse line after the painted rules", () => {
    const text = pickOrRequeryPrompt.user({ ...input, made: true, reuse: true });
    expect(text.indexOf(MADE_PICTURE_RULES)).toBeLessThan(
      text.indexOf("This picture was made for another slide."),
    );
  });

  test("the painted rules refuse only wrong subject or period, unsuitable content, text or untruth", () => {
    expect(MADE_PICTURE_RULES).toContain("writing, letters or numbers");
    expect(MADE_PICTURE_RULES).toContain("belongs to another time or place");
    expect(MADE_PICTURE_RULES).toContain("unsuitable for this year group");
    expect(MADE_PICTURE_RULES).toContain("something untrue about the subject");
    expect(MADE_PICTURE_RULES).toContain("composition and style never count");
  });
});

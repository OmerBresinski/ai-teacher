import { describe, expect, test } from "bun:test";
import { entriesWritten, isContinuation, outlineIndexOf, outlineIndices } from "./continuation";
import { generatedLesson } from "./fixtures.test-helpers";
import type { Slide } from "./slide";

const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});
const slide = (id: string, kind: Slide["kind"], heading: string): Slide => ({
  id,
  kind,
  elements: [
    {
      id: `${id}h`,
      type: "text",
      name: "Heading",
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      doc: doc(heading),
      style: { preset: "heading" },
    },
  ],
});

describe("continuation slides (UX ruling 91)", () => {
  const slides = [
    slide("a", "title", "Rivers"),
    slide("b", "content", "Flood risk"),
    slide("c", "content", "Flood risk (continued)"),
    slide("d", "content", "Flood risk (continued)"),
    slide("e", "content", "Floods and people"),
    slide("f", "exit-ticket", "Floods and people (continued)"),
  ];

  test("a continuation is the same kind with the previous heading and (continued)", () => {
    expect(isContinuation(slides[2] as Slide, slides[1])).toBe(true);
    expect(isContinuation(slides[3] as Slide, slides[2])).toBe(true);
    expect(isContinuation(slides[4] as Slide, slides[3])).toBe(false);
    // Another kind, or another heading, is its own entry.
    expect(isContinuation(slides[5] as Slide, slides[4])).toBe(false);
    expect(isContinuation(slide("x", "content", "Other (continued)"), slides[1])).toBe(false);
    expect(isContinuation(slides[1] as Slide, undefined)).toBe(false);
  });

  test("slides map to the outline entries they were written from", () => {
    expect(outlineIndices(slides)).toEqual([0, 1, 1, 1, 2, 3]);
    expect(outlineIndexOf(slides, 4)).toBe(2);
    expect(outlineIndexOf(slides, 9)).toBe(-1);
    expect(entriesWritten(slides)).toBe(4);
  });

  test("a stored lesson without continuations is one slide per entry, unchanged", () => {
    const lesson = generatedLesson();
    expect(outlineIndices(lesson.slides)).toEqual(lesson.slides.map((_, i) => i));
    expect(entriesWritten(lesson.slides)).toBe(lesson.slides.length);
  });
});

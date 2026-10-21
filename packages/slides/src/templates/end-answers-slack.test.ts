import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { lineWidth } from "../text-measure";
import { resolveTextStyle } from "../text-style";
import { getTheme } from "../themes";
import { answerItem, endAnswerSlides } from "./end-answers";

/*
 * 18 Oct loop1b y3 lesson: "4 counters" and "10 crayons" sat in an answer column 2 px wider than
 * their measured line, so the browser wrapped them onto the next answer's row. The column keeps
 * room for a measurer a few percent off: at least 10% over the one-line width.
 */
const theme = getTheme("paper", "ks2");
const words = (el: SlideElement) =>
  "doc" in el ? (JSON.stringify(el.doc).match(/"text":"([^"]*)"/)?.[1] ?? "") : "";
const oneLine = (text: string, size: number) => {
  const r = resolveTextStyle({ preset: "body" }, theme);
  return ((lineWidth(text, "body", theme, 700) - 2 * r.padding) / r.fontSize) * size;
};

describe("a short worked answer never wraps into the next row", () => {
  const groups = [
    {
      kind: "practice" as const,
      title: "Draw equal groups to find each quarter",
      items: [answerItem(1, "4 counters — 16 ÷ 4 = 4"), answerItem(2, "6 counters — 24 ÷ 4 = 6")],
    },
    {
      kind: "exit" as const,
      title: "Show what you know",
      items: [answerItem(1, "10 crayons — 20 ÷ 2 = 10"), answerItem(2, "6 beads — 24 ÷ 4 = 6")],
    },
  ];
  test("each answer's box is at least 10% wider than its one line", () => {
    const answers = endAnswerSlides(groups, theme, "ks2")
      .filter((s) => s.answersRole === "answers")
      .flatMap((s) => s.elements)
      .filter((e) => e.name === "Answer");
    expect(answers.length).toBe(4);
    for (const a of answers) {
      const size = (a as { style?: { fontSize?: number } }).style?.fontSize ?? 0;
      expect(a.w).toBeGreaterThanOrEqual(oneLine(words(a), size) * 1.1);
    }
  });
});

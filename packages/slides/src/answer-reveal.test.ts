import { describe, expect, test } from "bun:test";
import type { Slide, Theme } from "@tj/domain/documents";
import { answerRevealLayout } from "./answer-reveal";
import { SAFE_BOTTOM } from "./metrics";
import { THEMES } from "./themes";

type El = Slide["elements"][number];
const text = (name: string, y: number, h: number, preset = "body"): El =>
  ({
    id: `${name}-${y}`,
    type: "text",
    name,
    x: name === "Heading" ? 64 : 120,
    y,
    w: name === "Heading" ? 832 : 704,
    h,
    doc: { type: "doc", content: [] },
    style: { preset },
  }) as unknown as El;

/** The exit ticket from the writer test (WRITERBENCH S, slide 12): three items and an instruction. */
const exitTicket: Pick<Slide, "elements"> = {
  elements: [
    text("Heading", 46, 54, "heading"),
    text("Item", 177, 41),
    text("Item", 252, 82),
    text("Item", 368, 41),
    text("Instruction", 434, 34, "small"),
  ],
};
const longAnswer = [
  "1. Heart, blood and blood vessels. The heart is a muscle that pumps blood around the body.",
  "2. Heart → lungs → heart → body → heart. Blood delivers oxygen and nutrients to body cells; it also carries oxygen to working muscles.",
  "3. The rate rose by 36 beats per minute (112 − 76). Exercise makes working muscles need more oxygen, so the heart pumps more blood each minute and the pulse rate rises.",
].join("\n");

const contentBottom = 368 + 41;
const headingBottom = 46 + 54;

describe("answerRevealLayout", () => {
  test.each(THEMES.map((t) => [t.id, t] as const))(
    "a long answer gets a sheet under the heading that holds every line, on %s",
    (_id, theme: Theme) => {
      const box = answerRevealLayout(exitTicket, theme, longAnswer);
      expect(box.mode).toBe("sheet");
      expect(box.y).toBeGreaterThan(headingBottom);
      expect(box.y + box.h).toBe(SAFE_BOTTOM);
      expect(box.overflowing).toBe(false);
      // Every line, the answer's own breaks included, inside the box.
      expect(box.lines).toBeGreaterThanOrEqual(3);
      expect(box.lines * box.fontSize * box.lineHeight).toBeLessThanOrEqual(box.h);
    },
  );

  test.each(THEMES.map((t) => [t.id, t] as const))(
    "a short answer sits under the questions, over the instruction, on %s",
    (_id, theme: Theme) => {
      const box = answerRevealLayout(exitTicket, theme, "Heart, blood and blood vessels.");
      expect(box.mode).toBe("under");
      expect(box.y).toBeGreaterThan(contentBottom);
      expect(box.y + box.h).toBe(SAFE_BOTTOM);
      expect(box.lines).toBe(1);
      expect(box.lines * box.fontSize * box.lineHeight).toBeLessThanOrEqual(box.h);
    },
  );

  test("an answer too long for any room is flagged rather than clipped in silence", () => {
    const box = answerRevealLayout(exitTicket, THEMES[0] as Theme, longAnswer.repeat(6));
    expect(box.mode).toBe("sheet");
    expect(box.overflowing).toBe(true);
  });
});

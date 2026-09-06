import { describe, expect, test } from "bun:test";
import type { Lesson, TextElement } from "@tj/domain/documents";
import { docFromText, newLesson, newSlide } from "../model/factories";
import { getTheme } from "../model/themes";
import { docToPlainText } from "../text/static";
import { lintSlide } from "./lint";
import { rulerFor } from "./test-ruler";
import { tidyMessage, tidySlide } from "./tidy";

/* `tidySlide` as a pure function over the lesson (TeachDeck's wrote the store). */

const theme = getTheme("chalk");
const ruler = rulerFor(theme);

const text = (
  id: string,
  y: number,
  h: number,
  words: string,
  preset: "heading" | "body" = "body",
): TextElement => ({
  id,
  type: "text",
  x: 58,
  y,
  w: 844,
  h,
  doc: docFromText(words),
  style: { preset, autoHeight: true },
});

function lessonWith(elements: TextElement[]): Lesson {
  const lesson = newLesson("Tidy", "chalk");
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  first.elements = elements;
  return lesson;
}

describe("tidySlide", () => {
  test("is idempotent: a second tidy returns the same lesson object and changed: false", () => {
    const lesson = lessonWith([
      text("a", 43, 60, "Heading", "heading"),
      text("b", 140, 200, "A short body."),
    ]);
    const sid = lesson.slides[0]?.id ?? "";
    const once = tidySlide(lesson, sid, ruler).lesson;
    const twice = tidySlide(once, sid, ruler);
    expect(twice.lesson).toBe(once);
    expect(twice.outcome.changed).toBe(false);
    expect(tidyMessage(twice.outcome)).toBe("Nothing to tidy");
  });

  test("a body pushed into by a grown heading is moved down; the outcome counts it", () => {
    // Two boxes 10pt apart; the heading is stored at 20pt but its two long lines need more.
    const long = "A heading that runs well past a single line of the slide at the projector size";
    const lesson = lessonWith([
      text("h", 43, 20, long, "heading"),
      text("b", 73, 200, "Body copy."),
    ]);
    const sid = lesson.slides[0]?.id ?? "";
    expect(lintSlide(lesson.slides[0] as never, ruler).ok).toBe(true);
    const out = tidySlide(lesson, sid, ruler);
    expect(out.lesson).not.toBe(lesson);
    expect(out.outcome.changed).toBe(true);
    const [h, b] = out.lesson.slides[0]?.elements ?? [];
    expect((h?.h ?? 0) > 20).toBe(true);
    expect((b?.y ?? 0) > (h?.y ?? 0) + (h?.h ?? 0) - 1).toBe(true);
    // Other slides keep their identity: one slide changed, one reducer step.
    expect(out.lesson.slides.length).toBe(lesson.slides.length);
    expect(tidyMessage(out.outcome)).toMatch(/^Tidied: /);
  });

  test("an overlong list continues on a new slide of the same kind, its heading marked", () => {
    const items = Array.from(
      { length: 40 },
      (_, i) => `Item number ${i + 1} on this very long list of things`,
    );
    const list = text("list", 120, 300, items.join("\n"));
    const lesson = lessonWith([text("h", 43, 60, "Learning objectives", "heading"), list]);
    const sid = lesson.slides[0]?.id ?? "";
    const out = tidySlide(lesson, sid, ruler);
    expect(out.outcome.changed).toBe(true);
    expect(out.outcome.continued).toBeGreaterThanOrEqual(1);
    expect(out.lesson.slides.length).toBe(lesson.slides.length + out.outcome.continued);
    const next = out.lesson.slides[1];
    expect(next?.kind).toBe(lesson.slides[0]?.kind);
    const heading = next?.elements.find((e) => e.type === "text" && e.style.preset === "heading");
    expect(docToPlainText((heading as TextElement).doc)).toBe("Learning objectives (continued)");
    expect(tidyMessage(out.outcome)).toContain("continued on");
  });

  test("an unknown slide id is a no-op", () => {
    const lesson = newLesson("X", "chalk");
    expect(tidySlide(lesson, "nope", ruler).lesson).toBe(lesson);
  });

  test("a recipe slide settles to its measured heights and then stays put", () => {
    const lesson = newLesson("Y", "chalk");
    lesson.slides = [newSlide("objectives", "chalk")];
    const sid = lesson.slides[0]?.id ?? "";
    const once = tidySlide(lesson, sid, ruler);
    expect(once.outcome.overflow).toEqual([]);
    expect(once.outcome.continued).toBe(0);
    expect(tidySlide(once.lesson, sid, ruler).outcome.changed).toBe(false);
  });
});

describe("tidyMessage", () => {
  test("names what happened, and what still will not fit", () => {
    expect(
      tidyMessage({
        moved: 2,
        stepped: 1,
        continued: 0,
        overflow: [],
        laneOverflow: [],
        changed: true,
      }),
    ).toBe("Tidied: 2 boxes moved, 1 size stepped down");
    expect(
      tidyMessage({
        moved: 0,
        stepped: 0,
        continued: 2,
        overflow: ["x"],
        laneOverflow: [],
        changed: true,
      }),
    ).toBe(
      "Tidied: list continued on 2 new slides. 1 box will not fit at the smallest readable size",
    );
    expect(
      tidyMessage({
        moved: 0,
        stepped: 0,
        continued: 0,
        overflow: [],
        laneOverflow: ["a", "b"],
        changed: false,
      }),
    ).toBe("Nothing left to tidy: 2 boxes still covers the room the reason needs");
  });
});

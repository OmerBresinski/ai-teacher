import { describe, expect, test } from "bun:test";
import { lesson, multipleChoiceSlide, titleSlide, trueFalseSlide } from "./fixtures.test-helpers";
import { GUARD_MESSAGE } from "./identifier-guard";
import { isLesson, LessonSchema, parseLesson } from "./lesson";
import { hasRevealableAnswer, SlideSchema, slideStepCount } from "./slide";

describe("parseLesson", () => {
  test("round-trips a TeachDeck-shaped lesson through JSON", () => {
    const input = lesson();
    const parsed = parseLesson(JSON.parse(JSON.stringify(input)));
    expect(parsed).toEqual(input);
  });

  test("defaults fitVersion to 0 and createdAt to now when missing", () => {
    const { fitVersion: _fit, createdAt: _created, ...input } = lesson();
    const before = Date.now();
    const parsed = parseLesson(input);
    expect(parsed.fitVersion).toBe(0);
    expect(Date.parse(parsed.createdAt)).toBeGreaterThanOrEqual(before);
  });

  test("accepts the TD item 5 fields and keeps everything else unchanged", () => {
    const input = { ...lesson(), reachedSlideId: "s-mc", taughtAt: "2026-09-06T10:00:00.000Z" };
    const parsed = parseLesson(input);
    expect(parsed.reachedSlideId).toBe("s-mc");
    expect(parsed.taughtAt).toBe("2026-09-06T10:00:00.000Z");
    const { reachedSlideId: _r, taughtAt: _t, ...rest } = parsed;
    expect(rest).toEqual(lesson());
  });

  test("a lesson without the TD item 5 fields still parses (optional means no migration)", () => {
    expect(LessonSchema.safeParse(lesson()).success).toBe(true);
    expect(isLesson(lesson())).toBe(true);
  });

  test("a TeachDeck fixture without a brief parses with brief undefined (ADR 0024 §1)", () => {
    expect(parseLesson(lesson()).brief).toBeUndefined();
  });

  test("a lesson with a brief round-trips through JSON unchanged", () => {
    const input = {
      ...lesson(),
      brief: {
        topic: "Fractions of amounts",
        durationMin: 60,
        classContext: { sizeBand: "25to30" as const, needs: { send: 2 } },
      },
    };
    expect(parseLesson(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  test("a brief holding a learner name is rejected at [brief, topic] with GUARD_MESSAGE", () => {
    const result = LessonSchema.safeParse({
      ...lesson(),
      brief: { topic: "Help Amir Khan with fractions", durationMin: 60 },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["brief", "topic"], message: GUARD_MESSAGE }),
    ]);
  });

  test("rejects rubbish with a readable message naming at most three problems", () => {
    expect(() => parseLesson({ version: 1, id: 1, slides: "no" })).toThrow(
      /^This file is not a valid TeachDeck lesson\. /,
    );
    let message = "";
    try {
      parseLesson({ version: 1 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.split(";").length).toBeLessThanOrEqual(3);
    expect(message).toMatch(/\(\+\d+ more\)$/);
  });

  test("isLesson is false for a worksheet-shaped or empty object", () => {
    expect(isLesson({})).toBe(false);
    expect(isLesson({ version: 1, id: "w", blocks: [] })).toBe(false);
  });
});

describe("SlideSchema referential integrity", () => {
  test("a multiple-choice option pointing at a missing element fails at its path", () => {
    const slide = multipleChoiceSlide();
    slide.question = {
      type: "multiple-choice",
      options: [{ id: "ghost", correct: true }],
    };
    const result = SlideSchema.safeParse(slide);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      expect.objectContaining({
        path: ["question", "options", 0, "id"],
        message: 'question references missing element "ghost"',
      }),
    ]);
  });

  test("duplicate element ids are reported, including inside groups", () => {
    const slide = titleSlide();
    slide.elements.push({
      id: "g",
      type: "group",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      children: [slide.elements[0] as (typeof slide.elements)[number]],
    });
    const result = SlideSchema.safeParse(slide);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]).toMatchObject({
      path: ["elements", 2, "children", 0, "id"],
      message: 'duplicate element id "t1"',
    });
  });

  test("matching pairs must point at text or option elements", () => {
    const slide = trueFalseSlide();
    slide.elements.push({ id: "sh", type: "shape", shape: "rect", x: 0, y: 0, w: 1, h: 1 });
    slide.question = {
      type: "matching",
      pairs: [{ id: "p", leftElementId: "o-true", rightElementId: "sh" }],
    };
    const result = SlideSchema.safeParse(slide);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]).toMatchObject({
      path: ["question", "pairs", 0, "rightElementId"],
      message: 'question expects text or option for "sh", found shape',
    });
  });

  test("a fill-gap answer needs its [[gap:id]] token in an element", () => {
    const slide = titleSlide();
    slide.question = { type: "fill-gap", gaps: [{ id: "g1", answer: "rain" }] };
    expect(SlideSchema.safeParse(slide).success).toBe(false);
    slide.elements.push({
      id: "gap",
      type: "gap-text",
      x: 0,
      y: 0,
      w: 100,
      h: 20,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "It [[gap:g1]]." }] }],
      },
      style: { preset: "body" },
    });
    expect(SlideSchema.safeParse(slide).success).toBe(true);
  });

  test("an image creditUrl must be an http(s) address", () => {
    const image = (creditUrl: string) => ({
      ...titleSlide(),
      elements: [
        { id: "i", type: "image", x: 0, y: 0, w: 1, h: 1, src: "a.png", fit: "cover", creditUrl },
      ],
    });
    expect(SlideSchema.safeParse(image("javascript:alert(1)")).success).toBe(false);
    expect(SlideSchema.safeParse(image("mailto:a@b.c")).success).toBe(false);
    expect(SlideSchema.safeParse(image("https://openverse.org/x")).success).toBe(true);
    expect(SlideSchema.safeParse(image("openverse.org/x")).success).toBe(true);
  });
});

describe("slide helpers", () => {
  test("slideStepCount is the max revealStep plus one for a revealable answer", () => {
    expect(slideStepCount(titleSlide())).toBe(0);
    // true-false: no reveal steps, but the answer adds one.
    expect(slideStepCount(trueFalseSlide())).toBe(1);
    // multiple-choice: revealStep 1 on an option, plus the answer.
    expect(slideStepCount(multipleChoiceSlide())).toBe(2);
  });

  test("reveal steps inside groups count", () => {
    const slide = titleSlide();
    slide.elements = [
      {
        id: "g",
        type: "group",
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        children: [{ id: "c", type: "timer", x: 0, y: 0, w: 1, h: 1, seconds: 60, revealStep: 3 }],
      },
    ];
    expect(slideStepCount(slide)).toBe(3);
  });

  test("hasRevealableAnswer: every question kind except a blank open response", () => {
    expect(hasRevealableAnswer(titleSlide())).toBe(false);
    expect(hasRevealableAnswer(trueFalseSlide())).toBe(true);
    const open = { ...titleSlide(), question: { type: "open-response" as const } };
    expect(hasRevealableAnswer(open)).toBe(false);
    expect(
      hasRevealableAnswer({ ...open, question: { ...open.question, modelAnswer: "  " } }),
    ).toBe(false);
    expect(
      hasRevealableAnswer({ ...open, question: { ...open.question, modelAnswer: "Rain" } }),
    ).toBe(true);
  });
});

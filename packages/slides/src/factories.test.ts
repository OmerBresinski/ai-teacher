import { describe, expect, test } from "bun:test";
import { parseLesson, SlideSchema } from "@tj/domain/documents";
import { codedSetSlide } from "@tj/domain/documents/fixtures";
import {
  cloneSlide,
  docFromBullets,
  docFromText,
  newLesson,
  newSlide,
  newText,
  uid,
} from "./factories";
import { FIT_VERSION } from "./themes";

describe("factories", () => {
  test("uid is a 10-character nanoid", () => {
    expect(uid()).toHaveLength(10);
    expect(uid()).not.toBe(uid());
  });

  test("newLesson: version 1, one title slide, chalk, already fitted", () => {
    const lesson = newLesson("T");
    expect(lesson.version).toBe(1);
    expect(lesson.title).toBe("T");
    expect(lesson.themeId).toBe("chalk");
    expect(lesson.slides).toHaveLength(1);
    expect(lesson.slides[0]?.kind).toBe("title");
    expect(lesson.id).toHaveLength(10);
    expect(lesson.fitVersion).toBe(FIT_VERSION);
    expect(parseLesson(lesson)).toEqual(lesson);
  });

  test("docFromText splits lines into paragraphs; docFromBullets makes a list", () => {
    expect(docFromText("a\nb").content).toHaveLength(2);
    expect(docFromText("").content?.[0]?.content).toBeUndefined();
    expect(docFromBullets(["x"]).content?.[0]?.type).toBe("bulletList");
  });

  test("newText is auto-height with the preset given", () => {
    const el = newText("heading", "Hi", { x: 1, y: 2, w: 3, h: 4 });
    expect(el.style).toEqual({ preset: "heading", autoHeight: true });
    expect(el.x).toBe(1);
  });

  test("cloneSlide gives fresh ids and re-points question references", () => {
    const slide = newSlide("multiple-choice", "chalk");
    const copy = cloneSlide(slide);
    expect(copy.id).not.toBe(slide.id);
    const oldIds = new Set(slide.elements.map((e) => e.id));
    for (const el of copy.elements) expect(oldIds.has(el.id)).toBe(false);
    if (copy.question?.type !== "multiple-choice") throw new Error("expected multiple-choice");
    const newIds = new Set(copy.elements.map((e) => e.id));
    for (const o of copy.question.options) expect(newIds.has(o.id)).toBe(true);
  });

  test("TEACH-101: cloneSlide re-points a set question at the copied answers box; without the box it drops it", () => {
    const slide = codedSetSlide();
    const copy = cloneSlide(slide);
    if (copy.question?.type !== "set") throw new Error("expected set");
    const box = copy.elements.find((e) => e.name === "Answers");
    expect(box?.id).not.toBe("set-answers");
    expect(copy.question.answersId).toBe(box?.id as string);
    expect(copy.question).toEqual({
      ...copy.question,
      items: slide.question?.type === "set" ? slide.question.items : [],
    });
    expect(SlideSchema.safeParse(copy).success).toBe(true);
    const part = cloneSlide({ ...slide, elements: slide.elements.slice(0, 2) });
    expect(part.question).toBeUndefined();
    expect(SlideSchema.safeParse(part).success).toBe(true);
  });
});

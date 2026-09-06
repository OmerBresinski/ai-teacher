import { describe, expect, it } from "bun:test";
import type { ImageElement, Lesson } from "@tj/domain/documents";
import { demoWorksheet, newLesson, newSlide } from "@tj/editor";
import { coverOf, summarise } from "./summarise";

const dataUrl = "data:image/png;base64,iVBORw0KGgo=";

function lessonWithImage(): Lesson {
  const lesson = newLesson("Pictures", "beacon");
  const slide = newSlide("image-text", "beacon");
  const image = slide.elements.find((e): e is ImageElement => e.type === "image");
  if (!image) throw new Error("image-text recipe has no image");
  image.src = dataUrl;
  lesson.slides = [slide];
  lesson.subject = "Art";
  return lesson;
}

describe("summarise", () => {
  it("derives the card fields from a lesson body and carries the first slide as cover", () => {
    const body = lessonWithImage();
    const summary = summarise({ body });
    expect(summary).toMatchObject({
      id: body.id,
      kind: "lesson",
      title: "Pictures",
      themeId: "beacon",
      subject: "Art",
      count: 1,
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
    });
    expect(summary.cover?.id).toBe(body.slides[0]?.id);
    expect(summary.cover?.elements).toHaveLength(body.slides[0]?.elements.length ?? -1);
    expect("deletedAt" in summary).toBe(false);
    expect("yearGroup" in summary).toBe(false);
  });

  it("strips data-URL image sources from the cover but not from the body", () => {
    const body = lessonWithImage();
    const cover = coverOf(body);
    const coverImage = cover?.elements.find((e) => e.type === "image");
    expect(coverImage?.type === "image" && coverImage.src).toBe("");
    const bodyImage = body.slides[0]?.elements.find((e) => e.type === "image");
    expect(bodyImage?.type === "image" && bodyImage.src).toBe(dataUrl);
  });

  it("the cover is a deep copy: mutating it never reaches the stored document", () => {
    const body = lessonWithImage();
    const summary = summarise({ body });
    const element = summary.cover?.elements[0];
    if (!element) throw new Error("cover has no elements");
    element.x = -999;
    (element as { extra?: string }).extra = "mutated";
    expect(body.slides[0]?.elements[0]?.x).not.toBe(-999);
    expect("extra" in (body.slides[0]?.elements[0] ?? {})).toBe(false);
  });

  it("a worksheet counts blocks and has no cover", () => {
    const body = demoWorksheet();
    const summary = summarise({ body, deletedAt: "2026-09-06T00:00:00.000Z" });
    expect(summary.kind).toBe("worksheet");
    expect(summary.count).toBe(body.blocks.length);
    expect(summary.cover).toBeNull();
    expect(summary.deletedAt).toBe("2026-09-06T00:00:00.000Z");
  });

  it("a lesson with no slides has a null cover", () => {
    const body = { ...newLesson("Empty"), slides: [] };
    expect(summarise({ body }).cover).toBeNull();
  });
});

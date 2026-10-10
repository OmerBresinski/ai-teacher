import { describe, expect, test } from "bun:test";
import type { ImageElement, Lesson } from "@tj/domain/documents";
import { LessonSchema } from "@tj/domain/documents";
import { replacementFields } from "../../images/image-source";
import { recolourSlide } from "../../layout/retheme";
import { newLesson } from "../factories";
import { THEMES } from "../themes";
import * as r from "./index";

/*
 * TEACH-97 part h: a drawn diagram's `diagram` source rides along every edit that keeps the
 * drawing (move, resize, duplicate, paste, save and load) and goes when the picture is replaced.
 */
const source = {
  kind: "library" as const,
  model: "number_line",
  params: { start: 0, end: 20, step: 5 },
  step: 1,
};
const diagram: ImageElement = {
  id: "dia",
  type: "image",
  name: "Diagram",
  x: 40,
  y: 120,
  w: 420,
  h: 300,
  src: "data:image/svg+xml,%3Csvg%2F%3E",
  alt: "A number line",
  fit: "contain",
  builds: 2,
  diagram: source,
};
const seeded = (): { lesson: Lesson; slideId: string } => {
  const lesson = newLesson();
  const slideId = lesson.slides[0]?.id ?? "";
  return { lesson: r.addElement(lesson, structuredClone(diagram), slideId), slideId };
};
const imageOf = (lesson: Lesson, slideId: string, id: string) =>
  lesson.slides.find((s) => s.id === slideId)?.elements.find((e) => e.id === id) as ImageElement;

describe("ImageElement.diagram through editor edits (TEACH-97 part h)", () => {
  test("move and resize keep it", () => {
    const { lesson, slideId } = seeded();
    const moved = r.updateElement<ImageElement>(lesson, slideId, "dia", { x: 60, w: 480 });
    expect(imageOf(moved, slideId, "dia").diagram).toEqual(source);
  });

  test("duplicate and paste copy it, as its own object", () => {
    const { lesson, slideId } = seeded();
    const dup = r.duplicateElements(lesson, slideId, ["dia"]);
    const copy = imageOf(dup.lesson, slideId, dup.ids[0] ?? "");
    expect(copy.diagram).toEqual(source);
    expect(copy.diagram).not.toBe(imageOf(dup.lesson, slideId, "dia").diagram);
    const pasted = r.pasteElements(lesson, [diagram], slideId);
    expect(imageOf(pasted.lesson, slideId, pasted.ids[0] ?? "").diagram).toEqual(source);
  });

  test("save and load keep it", () => {
    const { lesson, slideId } = seeded();
    const back = LessonSchema.parse(JSON.parse(JSON.stringify(lesson)));
    expect(imageOf(back, slideId, "dia").diagram).toEqual(source);
  });

  test("replacing the picture drops it, so a photo is never redrawn as the old diagram", () => {
    const { lesson, slideId } = seeded();
    const patch = replacementFields({ src: "/files/photo.jpg", natural: { w: 800, h: 600 } });
    const replaced = imageOf(
      JSON.parse(JSON.stringify(r.updateElement<ImageElement>(lesson, slideId, "dia", patch))),
      slideId,
      "dia",
    );
    expect(replaced.src).toBe("/files/photo.jpg");
    expect("diagram" in replaced).toBe(false);
    expect(replaced.authoredBy).toBe("teacher");
  });

  test("a theme switch never rewrites the stored source, even a value that reads like a palette colour", () => {
    const [from, to] = THEMES;
    if (!from || !to) throw new Error("two themes needed");
    const hex = from.colors.muted;
    const el: ImageElement = {
      ...diagram,
      diagram: { kind: "drawer", spec: { kind: "table", rows: [[hex, "Rain"]], colour: hex } },
    };
    const slide = { ...newLesson().slides[0], elements: [el] } as Lesson["slides"][number];
    const out = recolourSlide(slide, from, to).elements[0] as ImageElement;
    expect(out.diagram).toEqual(el.diagram);
  });
});

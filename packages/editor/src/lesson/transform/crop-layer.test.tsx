import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ImageElement, Lesson, SlideElement } from "@tj/domain/documents";
import { makeShape } from "../../model/insert";
import { getTheme } from "../../model/themes";
import { catcher, pointer, renderEditor, seededLesson } from "../test-harness";

/*
 * TEACH-153: a whole crop session is one undo step. The draft lives in the session while the mode
 * is open and `CropLayer` commits it once, as it unmounts; a session that changed nothing writes
 * nothing. happy-dom has no layout, so client coordinates are slide points and the bitmap never
 * measures (the box stands in for the natural size).
 */

afterEach(cleanup);

/** A lesson whose first slide holds one image at (100, 100), 400 by 300. */
function imageLesson(fit: ImageElement["fit"]): Lesson {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  first.elements = [
    {
      ...makeShape("rect", getTheme("chalk")),
      x: 100,
      y: 100,
      w: 400,
      h: 300,
      type: "image",
      src: "data:,",
      fit,
    } as SlideElement,
  ];
  return lesson;
}

const image = (lesson: Lesson) => lesson.slides[0]?.elements[0] as ImageElement;

function enterCrop(container: HTMLElement) {
  fireEvent.pointerDown(catcher(container), pointer(300, 250));
  fireEvent.pointerUp(window, pointer(300, 250));
  const bar = screen.getByRole("toolbar", { name: "Image" });
  fireEvent.click(within(bar).getByRole("button", { name: "Crop" }));
  expect(container.querySelector("[data-crop-layer]")).not.toBeNull();
}

describe("CropLayer commits once", () => {
  test("zoom then nudge, then Enter: one write carrying the final draft, one undo step", () => {
    const { container, client, read } = renderEditor(imageLesson("cover"));
    const before = image(read());
    enterCrop(container);
    const setQueryData = spyOn(client, "setQueryData");

    fireEvent.keyDown(window, { key: "+" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // Two draft updates, nothing in the document yet.
    expect(setQueryData).toHaveBeenCalledTimes(0);
    expect(image(read())).toBe(before);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(container.querySelector("[data-crop-layer]")).toBeNull();
    expect(setQueryData).toHaveBeenCalledTimes(1);
    const after = image(read());
    expect(after.crop).toBeDefined();
    // Zoom 1.25 from the cover window, then a nudge of 0.01 to the right.
    expect(after.crop?.w).toBeCloseTo(0.8, 6);
    expect(after.crop?.x).toBeCloseTo(0.1 + 0.01, 6);
    expect(after.fit).toBe("cover");

    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    expect(image(read()).crop).toBeUndefined();
    expect(undo).toBeDisabled();
  });

  test("Escape on an unchanged session writes nothing", () => {
    const { container, client, read } = renderEditor(imageLesson("cover"));
    const before = image(read());
    enterCrop(container);
    const setQueryData = spyOn(client, "setQueryData");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector("[data-crop-layer]")).toBeNull();
    expect(setQueryData).toHaveBeenCalledTimes(0);
    expect(image(read())).toBe(before);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  test("a Fit picture leaves the mode as Fill, in the same single write", () => {
    const { container, client, read } = renderEditor(imageLesson("contain"));
    enterCrop(container);
    const setQueryData = spyOn(client, "setQueryData");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(setQueryData).toHaveBeenCalledTimes(1);
    expect(image(read()).fit).toBe("cover");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(image(read()).fit).toBe("contain");
  });
});

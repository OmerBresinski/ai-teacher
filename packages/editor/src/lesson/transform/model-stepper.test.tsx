import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ImageElement } from "@tj/domain/documents";
import { uid } from "../../model/factories";
import { catcher, pointer, renderEditor, seededLesson } from "../test-harness";
import { moveBuild, stepOf } from "./ModelStepper";

/*
 * TEACH-247 part u (UX ruling 205): the editor shows a drawn model's whole, finished drawing; a
 * stepper on the model pages through the builds Present plays, and the model goes back to the
 * full view once it is neither hovered nor holding focus.
 */

afterEach(cleanup);

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/><g data-s="1"><circle/></g><g data-s="2"><path/></g></svg>';

const model = (overrides: Partial<ImageElement> = {}): ImageElement => ({
  id: uid(),
  type: "image",
  name: "Diagram",
  x: 100,
  y: 80,
  w: 300,
  h: 200,
  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  fit: "contain",
  builds: 2,
  ...overrides,
});

function seeded(el: ImageElement) {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (first) first.elements = [el];
  return lesson;
}

/** The SVG the editor canvas draws for the model right now. */
const canvasSvg = (container: HTMLElement, id: string) => {
  const src =
    container
      .querySelector(`[data-slide-mode="edit"] [data-element-id="${id}"] img`)
      ?.getAttribute("src") ?? "";
  return decodeURIComponent(src.split(",")[1] ?? "");
};

const HIDES_2 = '[data-s="2"]{opacity:0}';
const HIDES_1_2 = '[data-s="1"],[data-s="2"]{opacity:0}';

describe("stepOf / moveBuild", () => {
  test("the full view is the last of builds + 1 steps", () => {
    expect(stepOf(2, undefined)).toEqual({ n: 3, of: 3 });
    expect(stepOf(2, 0)).toEqual({ n: 1, of: 3 });
    expect(stepOf(2, 1)).toEqual({ n: 2, of: 3 });
  });

  test("back from the full view, on to the full view, clamped at the first frame", () => {
    expect(moveBuild(2, undefined, -1)).toBe(1);
    expect(moveBuild(2, 1, -1)).toBe(0);
    expect(moveBuild(2, 0, -1)).toBe(0);
    expect(moveBuild(2, 0, 1)).toBe(1);
    expect(moveBuild(2, 1, 1)).toBeUndefined();
    expect(moveBuild(2, undefined, 1)).toBeUndefined();
  });
});

describe("ModelStepper in the editor", () => {
  test("the canvas shows the whole model; the stepper pages through its builds", async () => {
    const el = model();
    const { container } = renderEditor(seeded(el));
    // The finished drawing, no build style, before anything is hovered.
    await waitFor(() => expect(canvasSvg(container, el.id)).toContain("<path/>"));
    expect(canvasSvg(container, el.id)).not.toContain("opacity:0");
    expect(screen.queryByRole("group", { name: "Build steps" })).toBeNull();

    fireEvent.pointerMove(catcher(container), pointer(200, 150));
    const group = await screen.findByRole("group", { name: "Build steps" });
    expect(group.textContent).toContain("Step 3 of 3");
    const next = screen.getByRole("button", { name: "Next build step" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Previous build step" }));
    await waitFor(() => expect(canvasSvg(container, el.id)).toContain(HIDES_2));
    expect(group.textContent).toContain("Step 2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous build step" }));
    await waitFor(() => expect(canvasSvg(container, el.id)).toContain(HIDES_1_2));
    expect(group.textContent).toContain("Step 1 of 3");

    // The pointer leaves the slide: the model is back to its finished drawing.
    fireEvent.pointerLeave(catcher(container), { relatedTarget: document.body });
    await waitFor(() => expect(canvasSvg(container, el.id)).not.toContain("opacity:0"));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Build steps" })).toBeNull());
  });

  test("keys step inside the stepper and never reach the canvas nudge", async () => {
    const el = model();
    const { container, read } = renderEditor(seeded(el));
    fireEvent.pointerMove(catcher(container), pointer(200, 150));
    const prev = await screen.findByRole("button", { name: "Previous build step" });
    act(() => prev.focus());
    fireEvent.keyDown(prev, { key: "ArrowLeft" });
    await waitFor(() => expect(canvasSvg(container, el.id)).toContain(HIDES_2));
    // Focus holds the preview even once the pointer has gone.
    fireEvent.pointerLeave(catcher(container), { relatedTarget: document.body });
    fireEvent.keyDown(prev, { key: "ArrowLeft" });
    await waitFor(() => expect(canvasSvg(container, el.id)).toContain(HIDES_1_2));
    const moved = read().slides[0]?.elements.find((e) => e.id === el.id);
    expect(moved?.x).toBe(100);
    fireEvent.keyDown(prev, { key: "Escape" });
    await waitFor(() => expect(canvasSvg(container, el.id)).not.toContain("opacity:0"));
  });

  test("a still (no builds) gets no stepper", async () => {
    const el = model({ builds: undefined });
    const { container } = renderEditor(seeded(el));
    fireEvent.pointerMove(catcher(container), pointer(200, 150));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("group", { name: "Build steps" })).toBeNull();
  });

  test("the thumbnails keep the finished drawing while the canvas steps", async () => {
    const el = model();
    const { container } = renderEditor(seeded(el));
    fireEvent.pointerMove(catcher(container), pointer(200, 150));
    fireEvent.click(await screen.findByRole("button", { name: "Previous build step" }));
    await waitFor(() => expect(canvasSvg(container, el.id)).toContain(HIDES_2));
    const thumbs = [
      ...container.querySelectorAll(`[data-slide-mode="thumb"] [data-element-id="${el.id}"] img`),
    ];
    for (const img of thumbs) expect(img.getAttribute("src") ?? "").not.toContain("opacity%3A0");
  });
});

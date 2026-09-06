import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { catcher, nextFrame, pointer, renderEditor } from "../test-harness";

/*
 * Rows 2, 6, 7 and 8 of TEACH-103 with synthetic pointer events on the real layer. happy-dom has no
 * layout, so every `getBoundingClientRect` is zero and the fit scale stays 1: client coordinates
 * are slide points.
 */

afterEach(cleanup);

const elementsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-slide-mode="edit"] [data-element-id]'));
const rectOf = (el: HTMLElement) => ({
  x: Number.parseFloat(el.style.left),
  y: Number.parseFloat(el.style.top),
  w: Number.parseFloat(el.style.width),
  h: Number.parseFloat(el.style.height),
});

async function drag(
  target: HTMLElement,
  from: [number, number],
  to: [number, number],
  steps = 10,
  extra: Record<string, unknown> = {},
) {
  fireEvent.pointerDown(target, pointer(from[0], from[1], extra));
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    fireEvent.pointerMove(window, pointer(x, y, extra));
    await act(nextFrame);
  }
  fireEvent.pointerUp(window, pointer(to[0], to[1], extra));
}

describe("SelectionLayer", () => {
  test("row 2: clicking an element draws a frame with 8 handles + 4 rotate zones; Escape clears it", async () => {
    const { container, read } = renderEditor();
    const first = read().slides[0]?.elements[0];
    if (!first) throw new Error("seed");
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));

    const frame = container.querySelector("[data-selection-frame]");
    expect(frame).not.toBeNull();
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(container.querySelectorAll("[data-rotate-handle]")).toHaveLength(4);
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("Shape selected");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector("[data-selection-frame]")).toBeNull();
    // Nothing was written: the cache still holds the seed object.
    expect(read().slides[0]?.elements[0]).toBe(first);
  });

  test("row 3/6: a 40pt drag over 30 moves writes the cache once, on release, as one undo step", async () => {
    const { container, client, read } = renderEditor();
    const setQueryData = spyOn(client, "setQueryData");
    const before = read();

    await drag(catcher(container), [150, 150], [190, 150], 30);

    expect(setQueryData).toHaveBeenCalledTimes(1);
    const after = read();
    expect(after).not.toBe(before);
    expect(after.slides[0]?.elements[0]?.x).toBe(140);
    expect(after.slides[0]?.elements[0]?.y).toBe(100);
    // Untouched slides keep their identity (TEACH-102 row 1), so the navigator rows stay memoised.
    expect(after.slides[1]).toBe(before.slides[1]);

    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).not.toBeDisabled();
    fireEvent.click(undo);
    expect(read().slides[0]?.elements[0]?.x).toBe(100);
    expect(undo).toBeDisabled();
  });

  test("the preview moves the painted element while the pointer is down and the cache is untouched", async () => {
    const { container, read } = renderEditor();
    const target = catcher(container);
    fireEvent.pointerDown(target, pointer(150, 150));
    fireEvent.pointerMove(window, pointer(170, 160));
    await act(nextFrame);
    const painted = rectOf(elementsOf(container)[0] as HTMLElement);
    expect(painted).toEqual({ x: 120, y: 110, w: 200, h: 100 });
    expect(read().slides[0]?.elements[0]?.x).toBe(100);
    fireEvent.pointerUp(window, pointer(170, 160));
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 120, y: 110 });
  });

  test("row 4: dragging near a sibling's edge snaps within the threshold and draws a guide; snap off does not", async () => {
    const { container, read } = renderEditor();
    // A's right edge (300) towards B's left edge (400): a 95pt move lands at 395, 5pt short.
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerMove(window, pointer(245, 150));
    await act(nextFrame);
    expect(container.querySelector('[data-guide="x"]')).not.toBeNull();
    fireEvent.pointerUp(window, pointer(245, 150));
    expect(read().slides[0]?.elements[0]?.x).toBe(200);

    // Snap off from the canvas shortcut, then the same drag lands where the pointer left it.
    fireEvent.keyDown(window, { key: ";", code: "Semicolon", metaKey: true, shiftKey: true });
    fireEvent.pointerDown(catcher(container), pointer(250, 150));
    fireEvent.pointerMove(window, pointer(255, 150));
    fireEvent.pointerMove(window, pointer(345, 150));
    await act(nextFrame);
    expect(container.querySelector('[data-guide="x"]')).toBeNull();
    fireEvent.pointerUp(window, pointer(345, 150));
    expect(read().slides[0]?.elements[0]?.x).toBe(295);
  });

  test("row 5: a corner handle resizes; Shift on a shape releases the aspect lock", async () => {
    const { container, read } = renderEditor();
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    const se = container.querySelector<HTMLElement>('[data-handle="se"]');
    if (!se) throw new Error("no se handle");

    // Shapes lock aspect by default: the corner to (400, 300) wants 300x200; the larger change
    // (x2 on the height) drives the ratio, so 200x100 → 400x200 about the nw anchor.
    await drag(se, [300, 200], [400, 300], 4);
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 100, w: 400, h: 200 });

    // Shift frees it: the box follows the pointer on both axes.
    const se2 = container.querySelector<HTMLElement>('[data-handle="se"]');
    if (!se2) throw new Error("no se handle");
    await drag(se2, [500, 300], [540, 380], 4, { shiftKey: true });
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 100, w: 440, h: 280 });
    // Two gestures, two undo steps.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().slides[0]?.elements[0]).toMatchObject({ w: 400, h: 200 });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().slides[0]?.elements[0]).toMatchObject({ w: 200, h: 100 });
  });

  test("row 7: marquee selects both; ⌘D duplicates, Delete removes, ⌘Z restores", async () => {
    const { container, read } = renderEditor();
    await drag(catcher(container), [50, 50], [650, 250], 3);
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(8);
    // Two member outlines plus the group frame.
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("2 elements selected");

    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(read().slides[0]?.elements).toHaveLength(4);
    expect(elementsOf(container)).toHaveLength(4);

    fireEvent.keyDown(window, { key: "Delete" });
    expect(read().slides[0]?.elements).toHaveLength(2);

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(read().slides[0]?.elements).toHaveLength(4);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(read().slides[0]?.elements).toHaveLength(2);
  });

  test("row 8: ↑×5 nudges by 5 in one undo step; Shift+↑ nudges by 10", async () => {
    const { container, read } = renderEditor();
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));

    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyUp(window, { key: "ArrowUp" });
    expect(read().slides[0]?.elements[0]?.y).toBe(95);

    fireEvent.keyDown(window, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyUp(window, { key: "ArrowUp", shiftKey: true });
    expect(read().slides[0]?.elements[0]?.y).toBe(85);

    // The held run was one step, the Shift nudge another.
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(read().slides[0]?.elements[0]?.y).toBe(95);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(read().slides[0]?.elements[0]?.y).toBe(100);
  });

  test("keys stay out of a text field, except Escape", async () => {
    const { container, read } = renderEditor();
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    fireEvent.click(screen.getByRole("button", { name: "Rename lesson" }));
    const input = screen.getByRole("textbox", { name: "Lesson title" });
    fireEvent.keyDown(input, { key: "Delete" });
    expect(read().slides[0]?.elements).toHaveLength(2);
  });
});

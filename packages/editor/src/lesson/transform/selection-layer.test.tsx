import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { GroupElement } from "@tj/domain/documents";
import { catcher, nextFrame, pointer, renderEditor, seededLesson, shape } from "../test-harness";

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

  test("row 5: a corner handle resizes; a shape is free by default and Shift locks the ratio on any handle", async () => {
    const { container, read } = renderEditor();
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    const se = container.querySelector<HTMLElement>('[data-handle="se"]');
    if (!se) throw new Error("no se handle");

    // Shapes resize freely: the corner follows the pointer on both axes, 200x100 → 300x200.
    await drag(se, [300, 200], [400, 300], 4);
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 100, w: 300, h: 200 });

    // Shift locks the ratio: the corner to (550, 380) wants 450x280; the larger change (x1.5 on
    // the width) drives the ratio, so 300x200 → 450x300 about the nw anchor.
    const se2 = container.querySelector<HTMLElement>('[data-handle="se"]');
    if (!se2) throw new Error("no se handle");
    await drag(se2, [400, 300], [550, 380], 4, { shiftKey: true });
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 100, w: 450, h: 300 });

    // Shift on a side handle scales both axes: the right edge to 700 makes 450x300 → 600x400, the
    // left edge stays at 100 and the height grows evenly about the midline (y 250 → 50..450).
    const e = container.querySelector<HTMLElement>('[data-handle="e"]');
    if (!e) throw new Error("no e handle");
    await drag(e, [550, 250], [700, 250], 4, { shiftKey: true });
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 50, w: 600, h: 400 });
    // Three gestures, three undo steps.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().slides[0]?.elements[0]).toMatchObject({ w: 450, h: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().slides[0]?.elements[0]).toMatchObject({ w: 300, h: 200 });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().slides[0]?.elements[0]).toMatchObject({ w: 200, h: 100 });
  });

  test("row 5: an image keeps its ratio from a corner without Shift, and Shift never unlocks it", async () => {
    const lesson = seededLesson();
    const first = lesson.slides[0];
    if (!first) throw new Error("seed");
    first.elements = [
      { id: "img", type: "image", x: 100, y: 100, w: 200, h: 100, src: "a.png", fit: "cover" },
    ];
    const { container, read } = renderEditor(lesson);
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    const handle = (id: string) => {
      const h = container.querySelector<HTMLElement>(`[data-handle="${id}"]`);
      if (!h) throw new Error(`no ${id} handle`);
      return h;
    };

    // No Shift: the corner to (400, 300) wants 300x200; the larger change (x2 on the height)
    // drives the ratio, so 200x100 → 400x200.
    await drag(handle("se"), [300, 200], [400, 300], 4);
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 100, w: 400, h: 200 });

    // Shift does not release it: the corner to (700, 380) wants 600x280 and gets 600x300.
    await drag(handle("se"), [500, 300], [700, 380], 4, { shiftKey: true });
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 100, w: 600, h: 300 });

    // A side handle without Shift is still one axis.
    await drag(handle("e"), [700, 250], [800, 250], 4);
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 100, w: 700, h: 300 });

    // With Shift it scales both, about the midline: 700x300 → 1050x450, top edge 100 → 25.
    await drag(handle("e"), [800, 250], [1150, 250], 4, { shiftKey: true });
    expect(read().slides[0]?.elements[0]).toMatchObject({ x: 100, y: 25, w: 1050, h: 450 });
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

  test("row 7b: a marquee from the canvas margin selects what it crosses; a margin click clears", async () => {
    const { container } = renderEditor();
    const margin = container.querySelector<HTMLElement>("[data-canvas-scroller]");
    if (!margin) throw new Error("no scroller");
    // The press lands left of and above the slide (negative slide coordinates) and sweeps over both.
    await drag(margin, [-60, -40], [650, 250], 3);
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("2 elements selected");

    // A plain click in the margin is ground: the selection goes.
    fireEvent.pointerDown(margin, pointer(-60, -40));
    fireEvent.pointerUp(window, pointer(-60, -40));
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(0);

    // The right button belongs to the context menu, not the marquee.
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    fireEvent.pointerDown(margin, pointer(-60, -40, { button: 2 }));
    fireEvent.pointerUp(window, pointer(-60, -40, { button: 2 }));
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(8);
  });

  test("row 7c: the marquee selects what it touches, outlines the candidates live, and misses what it does not", async () => {
    const { container, read } = renderEditor();
    const [a, b] = read().slides[0]?.elements ?? [];
    if (!a || !b) throw new Error("seed");
    const candidates = () =>
      Array.from(container.querySelectorAll("[data-marquee-candidate]")).map((n) =>
        n.getAttribute("data-marquee-candidate"),
      );

    // (50, 50) to (250, 250): the first shape (x 100..300) is half inside, the second (400..600)
    // is clear of it. Mid-drag the first is outlined and nothing is selected yet.
    fireEvent.pointerDown(catcher(container), pointer(50, 50));
    fireEvent.pointerMove(window, pointer(250, 250));
    await act(nextFrame);
    expect(candidates()).toEqual([a.id]);
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(0);
    fireEvent.pointerUp(window, pointer(250, 250));
    expect(candidates()).toEqual([]);
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("Shape selected");

    // A marquee in the gap between them touches neither, and clears.
    fireEvent.pointerDown(catcher(container), pointer(320, 50));
    fireEvent.pointerMove(window, pointer(380, 250));
    await act(nextFrame);
    expect(candidates()).toEqual([]);
    fireEvent.pointerUp(window, pointer(380, 250));
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(0);
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

  test("pointercancel (or a window blur) discards the preview and writes nothing", async () => {
    const { container, client, read } = renderEditor();
    const setQueryData = spyOn(client, "setQueryData");
    const before = read();
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerMove(window, pointer(190, 170));
    await act(nextFrame);
    expect(rectOf(elementsOf(container)[0] as HTMLElement)).toMatchObject({ x: 140, y: 120 });
    fireEvent.pointerCancel(window, pointer(190, 170));
    expect(rectOf(elementsOf(container)[0] as HTMLElement)).toMatchObject({ x: 100, y: 100 });
    expect(read()).toBe(before);
    expect(setQueryData).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerMove(window, pointer(160, 160));
    await act(nextFrame);
    fireEvent.blur(window);
    expect(read()).toBe(before);
    // The layer is not stranded: the next drag works and commits.
    await drag(catcher(container), [150, 150], [170, 150], 3);
    expect(read().slides[0]?.elements[0]?.x).toBe(120);
  });

  test("resizing a group previews and commits its children scaled with the frame", async () => {
    const lesson = seededLesson();
    const first = lesson.slides[0];
    if (!first) throw new Error("seed");
    const group: GroupElement = {
      id: "grp",
      type: "group",
      x: 100,
      y: 100,
      w: 200,
      h: 100,
      children: [shape(0, 0, 100, 50), shape(100, 50, 100, 50)],
    };
    first.elements = [group];
    const { container, read } = renderEditor(lesson);
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    const se = container.querySelector<HTMLElement>('[data-handle="se"]');
    if (!se) throw new Error("no se handle");
    // Groups are not aspect-locked: the corner to (500, 300) doubles both axes.
    fireEvent.pointerDown(se, pointer(300, 200));
    fireEvent.pointerMove(window, pointer(500, 300));
    await act(nextFrame);
    // Mid-gesture the children are painted at their scaled geometry, not their old one.
    const painted = container.querySelectorAll<HTMLElement>(
      '[data-slide-mode="edit"] [data-element-id="grp"] [data-element-id]',
    );
    expect(rectOf(painted[1] as HTMLElement)).toEqual({ x: 200, y: 100, w: 200, h: 100 });
    expect(read().slides[0]?.elements[0]).toBe(group);
    fireEvent.pointerUp(window, pointer(500, 300));
    const committed = read().slides[0]?.elements[0] as GroupElement;
    expect(committed).toMatchObject({ x: 100, y: 100, w: 400, h: 200 });
    expect(committed.children[1]).toMatchObject({ x: 200, y: 100, w: 200, h: 100 });
  });

  test("with Space held the stage pans: a press on an element starts no gesture", async () => {
    const { container, read } = renderEditor();
    // Focus the canvas first (a click does), then hold Space.
    fireEvent.pointerDown(catcher(container), pointer(50, 50));
    fireEvent.pointerUp(window, pointer(50, 50));
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await drag(catcher(container), [150, 150], [190, 150], 3);
    expect(read().slides[0]?.elements[0]?.x).toBe(100);
    expect(container.querySelector("[data-selection-frame]")).toBeNull();
    fireEvent.keyUp(window, { key: " ", code: "Space" });

    // From a handle too: with Space held the press bubbles to the scroller for the pan.
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    const se = container.querySelector<HTMLElement>('[data-handle="se"]');
    if (!se) throw new Error("no se handle");
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    const reached = mock(() => {});
    screen.getByRole("group", { name: "Slide canvas" }).addEventListener("pointerdown", reached);
    await drag(se, [300, 200], [400, 300], 3);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(read().slides[0]?.elements[0]).toMatchObject({ w: 200, h: 100 });
    fireEvent.keyUp(window, { key: " ", code: "Space" });
    await drag(catcher(container), [150, 150], [190, 150], 3);
    expect(read().slides[0]?.elements[0]?.x).toBe(140);
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

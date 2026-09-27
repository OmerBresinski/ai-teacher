import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { materialiseSlides, PHOTO_NAME, slotSideOf } from "@tj/slides";
import { catcher, nextFrame, pointer, renderEditor, seededLesson } from "../test-harness";

/*
 * R2: a teaching slide's photo picks its side from the picture toolbar (Left | Right) or by being
 * dragged over the midline, each one undo step. happy-dom has no layout, so client coordinates are
 * slide points.
 */

afterEach(cleanup);

const [slotSlide] = materialiseSlides(
  {
    kind: "content",
    heading: "Roman soldiers",
    body: "Roman soldiers carried a large shield and wore metal armour. Both kept them safe in battle.",
    factRefs: [],
  },
  "chalk",
  { promptVersion: "t", model: "m", at: "2026-09-27T00:00:00.000Z" },
  undefined,
  0,
  { photo: { subject: "Roman legionaries", mustShow: ["shields"] } },
);

function lesson(): Lesson {
  if (!slotSlide) throw new Error("no slide");
  const seeded = seededLesson();
  return { ...seeded, themeId: "chalk", slides: [structuredClone(slotSlide), ...seeded.slides] };
}

const photoOf = (l: Lesson) => {
  const photo = l.slides[0]?.elements.find((e) => e.name === PHOTO_NAME);
  if (!photo) throw new Error("no photo");
  return photo;
};

async function drag(target: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(target, pointer(from[0], from[1]));
  for (let i = 1; i <= 8; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / 8;
    const y = from[1] + ((to[1] - from[1]) * i) / 8;
    fireEvent.pointerMove(window, pointer(x, y));
    await act(nextFrame);
  }
  fireEvent.pointerUp(window, pointer(to[0], to[1]));
}

/** Where each element sits across the slide (happy-dom measures text heights as it likes). */
const xs = (l: Lesson | { slides: [unknown] }) =>
  ((l as Lesson).slides[0]?.elements ?? []).map((e) => [e.id, e.x]);

const centreOf = (e: { x: number; y: number; w: number; h: number }): [number, number] => [
  e.x + e.w / 2,
  e.y + e.h / 2,
];

describe("the picture's side (R2)", () => {
  test("selecting the photo shows Picture: Left | Right; Right moves it, one undo step", async () => {
    const { container, read } = renderEditor(lesson());
    const start = read().slides[0];
    expect(slotSideOf(start as never)).toBe("left");
    const [x, y] = centreOf(photoOf(read()));
    fireEvent.pointerDown(catcher(container), pointer(x, y));
    fireEvent.pointerUp(window, pointer(x, y));

    const sides = screen.getByRole("radiogroup", { name: "Picture side" });
    expect(sides.textContent).toBe("LeftRight");
    fireEvent.click(screen.getByRole("radio", { name: "Right" }));
    expect(slotSideOf(read().slides[0] as never)).toBe("right");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(xs(read())).toEqual(xs({ slides: [start] }));
  });

  test("the slide toolbar has no swap button", () => {
    renderEditor(lesson());
    expect(screen.queryByRole("button", { name: "Swap picture side" })).toBeNull();
  });

  test("dragging the photo's centre over the midline swaps sides on drop, one undo step", async () => {
    const { container, read } = renderEditor(lesson());
    const start = read().slides[0];
    const [x, y] = centreOf(photoOf(read()));
    // From the left column to just past the middle of the slide (960 wide).
    await drag(catcher(container), [x, y], [500, y + 30]);

    const after = read().slides[0];
    expect(slotSideOf(after as never)).toBe("right");
    // The swap, not the drag: the photo is level with where it was and the words sit left of it.
    expect(photoOf(read()).y).toBe(photoOf({ slides: [start] } as Lesson).y);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(xs(read())).toEqual(xs({ slides: [start] }));
  });

  test("a drag that stays on its side is an ordinary move", async () => {
    const { container, read } = renderEditor(lesson());
    const before = photoOf(read());
    const [x, y] = centreOf(before);
    await drag(catcher(container), [x, y], [x + 30, y]);

    expect(slotSideOf(read().slides[0] as never)).toBe("left");
    // Where the pointer left it, give or take a snap.
    expect(photoOf(read()).x).toBeGreaterThan(before.x + 20);
  });
});

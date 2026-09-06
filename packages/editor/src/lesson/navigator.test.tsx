import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { pointer, renderEditor } from "./test-harness";

/* Rows 9 and 10 of TEACH-103: keyboard reorder, pointer reorder, menu duplicate/delete, add. */

afterEach(cleanup);

const rail = () => screen.getByRole("listbox", { name: "Slides" });
const rows = () => within(rail()).getAllByRole("option");
const ids = (lesson: { slides: { id: string }[] }): string[] => lesson.slides.map((s) => s.id);
/** The three seeded slide ids, named. */
const abc = (lesson: { slides: { id: string }[] }) => {
  const [a, b, c] = ids(lesson);
  if (!a || !b || !c) throw new Error("seed has three slides");
  return { a, b, c };
};

describe("Navigator", () => {
  test("shows one numbered thumb per slide, the first active", () => {
    renderEditor();
    const options = rows();
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0]?.textContent).toContain("1");
    expect(rail()).toHaveAttribute("aria-activedescendant", options[0]?.id);
  });

  test("row 9: ⌘↓ on slide 2 swaps it with slide 3, one undo step", () => {
    const { read } = renderEditor();
    const { a, b, c } = abc(read());
    const second = rows()[1];
    if (!second) throw new Error("no row");
    fireEvent.pointerDown(second, pointer(20, 20));
    fireEvent.pointerUp(second, pointer(20, 20));
    expect(rail()).toHaveAttribute("aria-activedescendant", `slide-opt-${b}`);

    fireEvent.keyDown(rail(), { key: "ArrowDown", metaKey: true });
    expect(ids(read())).toEqual([a, c, b]);
    fireEvent.keyDown(rail(), { key: "ArrowUp", metaKey: true });
    expect(ids(read())).toEqual([a, b, c]);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(ids(read())).toEqual([a, c, b]);
  });

  test("row 9: dragging slide 1 below slide 3 with the pointer reorders", () => {
    const { read, container } = renderEditor();
    const { a, b, c } = abc(read());
    const first = rows()[0];
    if (!first) throw new Error("no row");
    // Rows are 102px tall (94 + 8); the insertion index is the row boundary nearest the pointer.
    fireEvent.pointerDown(first, pointer(20, 10));
    fireEvent.pointerMove(first, pointer(20, 60));
    fireEvent.pointerMove(first, pointer(20, 8 + 3 * 102));
    expect(container.querySelector("[data-drop-indicator]")).not.toBeNull();
    fireEvent.pointerUp(first, pointer(20, 8 + 3 * 102));
    expect(ids(read())).toEqual([b, c, a]);
    expect(container.querySelector("[data-drop-indicator]")).toBeNull();
  });

  test("row 10: the context menu duplicates and deletes; the canvas follows", async () => {
    const { read, container } = renderEditor();
    const before = read().slides.length;
    const second = rows()[1];
    if (!second) throw new Error("no row");
    fireEvent.contextMenu(second, { clientX: 40, clientY: 120 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Duplicate/ }));
    expect(read().slides).toHaveLength(before + 1);
    const copy = read().slides[2];
    expect(copy?.kind).toBe("content");
    // The canvas moved to the copy.
    expect(
      container.querySelector(`[data-slide-frame] [data-slide-id="${copy?.id}"]`),
    ).not.toBeNull();

    fireEvent.contextMenu(rows()[2] as HTMLElement, { clientX: 40, clientY: 220 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(read().slides).toHaveLength(before);
    expect(read().slides.map((s) => s.id)).not.toContain(copy?.id);
  });

  test("row 10: AddSlidePicker → Content inserts after the active slide and shows it", async () => {
    const { read, container } = renderEditor();
    const { a } = abc(read());
    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    const menu = await screen.findByRole("menu", { name: "Slide kinds" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Explanation" }));
    const slides = read().slides;
    expect(slides).toHaveLength(4);
    expect(slides[0]?.id).toBe(a);
    expect(slides[1]?.kind).toBe("content");
    expect(
      container.querySelector(`[data-slide-frame] [data-slide-id="${slides[1]?.id}"]`),
    ).not.toBeNull();
    expect(rail()).toHaveAttribute("aria-activedescendant", `slide-opt-${slides[1]?.id}`);
  });

  test("Delete on the rail removes the active slide and lands on its neighbour; the last slide stays", () => {
    const { read } = renderEditor();
    const { b, c } = abc(read());
    fireEvent.keyDown(rail(), { key: "Delete" });
    expect(ids(read())).toEqual([b, c]);
    expect(rail()).toHaveAttribute("aria-activedescendant", `slide-opt-${b}`);
    fireEvent.keyDown(rail(), { key: "Delete" });
    fireEvent.keyDown(rail(), { key: "Delete" });
    expect(read().slides).toHaveLength(1);
  });
});

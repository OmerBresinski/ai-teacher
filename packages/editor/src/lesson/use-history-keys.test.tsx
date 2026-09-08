import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { catcher, pointer, renderEditor } from "./test-harness";

afterEach(cleanup);

describe("useHistoryKeys", () => {
  test("⌘Z undoes once from inside an open menu, and not at all from a text field", () => {
    const { container, read } = renderEditor();
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    // Two nudges, two undo steps.
    for (let i = 0; i < 2; i++) {
      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyUp(window, { key: "ArrowUp" });
    }
    expect(read().slides[0]?.elements[0]?.y).toBe(98);

    // A bar menu takes focus out of the canvas region, which used to take the undo keys with it.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.tabIndex = -1;
    document.body.append(menu);
    menu.focus();
    fireEvent.keyDown(menu, { key: "z", metaKey: true });
    expect(read().slides[0]?.elements[0]?.y).toBe(99);
    fireEvent.keyDown(menu, { key: "z", metaKey: true, shiftKey: true });
    expect(read().slides[0]?.elements[0]?.y).toBe(98);
    fireEvent.keyDown(menu, { key: "z", ctrlKey: true });
    expect(read().slides[0]?.elements[0]?.y).toBe(99);
    menu.remove();

    // A text field keeps its native undo.
    const field = document.createElement("div");
    field.setAttribute("contenteditable", "true");
    field.tabIndex = -1;
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "z", metaKey: true });
    expect(read().slides[0]?.elements[0]?.y).toBe(99);
    field.remove();
  });
});

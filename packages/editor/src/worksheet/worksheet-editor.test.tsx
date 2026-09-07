import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { docFromText, uid } from "../model/factories";
import { newBlock, numberQuestions, starterWorksheet } from "../model/worksheet-factories";
import { pointer, renderWorksheetEditor, row } from "./editor-test-harness";
import { HEADER_KEY } from "./paginate";

/*
 * The worksheet editor on the real shell (TEACH-109 rows 3–8): the slash menu inserts a block, the
 * block toolbar writes type-specific fields, the header toolbar writes the sheet-wide switches,
 * the gutter handle reorders with one undo step. Tiptap caret/typing fidelity is Playwright's
 * (`worksheet-editor.spec.ts`).
 */

afterEach(cleanup);

const withBlocks = (blocks: WorksheetBlock[]): Worksheet => {
  const sheet = starterWorksheet("Seed sheet");
  sheet.blocks = numberQuestions(blocks);
  return sheet;
};

const select = (container: HTMLElement, id: string) =>
  fireEvent.pointerDown(row(container, id), pointer(10, 10));

const undo = () => fireEvent.keyDown(window, { key: "z", metaKey: true });

describe("WorksheetEditor", () => {
  test("mounts the header and every block; a click selects a block and shows its toolbar", () => {
    const { container, read } = renderWorksheetEditor();
    // On the pages, not counting the hidden measuring column's copies.
    expect(container.querySelectorAll(".ws-column .ws-block").length).toBe(read().blocks.length);
    expect(screen.getByRole("textbox", { name: "Sheet title" })).toHaveTextContent("Seed sheet");
    const first = read().blocks[1];
    if (!first) throw new Error("seed");
    select(container, first.id);
    expect(row(container, first.id).querySelector(".ws-selected-ring")).not.toBeNull();
    expect(screen.getByRole("toolbar", { name: "Question block" })).toBeInTheDocument();
    // The header's toolbar is its own.
    fireEvent.pointerDown(row(container, HEADER_KEY), pointer(10, 10));
    expect(screen.getByRole("toolbar", { name: "Worksheet header" })).toBeInTheDocument();
  });

  test("row 3: the gutter + opens the slash menu listing every block type; picking Question inserts one after", async () => {
    const { container, read } = renderWorksheetEditor();
    const anchor = read().blocks[0];
    if (!anchor) throw new Error("seed");
    const before = read().blocks.length;
    fireEvent.click(
      within(row(container, anchor.id)).getByRole("button", { name: "Insert a block below" }),
    );
    const list = await screen.findByRole("listbox", { name: "Block types" });
    const options = within(list).getAllByRole("option");
    // Every `WorksheetBlock["type"]`, headings twice (Heading and Subheading).
    expect(options.length).toBe(16);
    const input = screen.getByRole("combobox", { name: "Filter blocks" });
    fireEvent.change(input, { target: { value: "quest" } });
    const filtered = within(list).getAllByRole("option");
    expect(filtered.length).toBeLessThan(16);
    expect(filtered.every((o) => /quest/i.test(o.textContent ?? ""))).toBe(true);
    fireEvent.pointerDown(within(list).getByRole("option", { name: /^Question/ }));
    await waitFor(() => expect(read().blocks.length).toBe(before + 1));
    const inserted = read().blocks[1];
    expect(inserted?.type).toBe("question");
    if (inserted?.type === "question") {
      expect(inserted.answerLines).toBe(2);
      expect(inserted.number).toBe(1);
    }
    // One undo step.
    undo();
    expect(read().blocks.length).toBe(before);
  });

  test("row 4: setting marks on a question follows the AQA line rule and renumbers", () => {
    const { container, read } = renderWorksheetEditor();
    const q = read().blocks[1];
    if (q?.type !== "question") throw new Error("seed");
    select(container, q.id);
    const marks = screen.getByRole("spinbutton", { name: "Marks" });
    fireEvent.focus(marks);
    fireEvent.change(marks, { target: { value: "3" } });
    fireEvent.blur(marks);
    const after = read().blocks[1];
    expect(after?.type === "question" && after.marks).toBe(3);
    expect(after?.type === "question" && after.answerLines).toBe(6);
    // Numbers are derived by the reducer: still 1, 2, 3, 4 across the numbered blocks.
    expect(
      read()
        .blocks.filter((b) => "number" in b && b.number)
        .map((b) => ("number" in b ? b.number : 0)),
    ).toEqual([1, 2, 3, 4]);
  });

  test("row 5: a multiple-choice option can be added on the toolbar and marked correct on the sheet", () => {
    const { container, read } = renderWorksheetEditor();
    const mc = read().blocks.find((b) => b.type === "multiple-choice");
    if (mc?.type !== "multiple-choice") throw new Error("seed");
    select(container, mc.id);
    const count = mc.options.length;
    fireEvent.click(screen.getByRole("button", { name: "Option" }));
    const grown = read().blocks.find((b) => b.id === mc.id);
    expect(grown?.type === "multiple-choice" && grown.options.length).toBe(count + 1);
    // Tick B on the sheet: the teacher's own mark.
    const tickB = within(row(container, mc.id)).getByRole("button", {
      name: "Mark option B as correct",
    });
    fireEvent.click(tickB);
    const marked = read().blocks.find((b) => b.id === mc.id);
    expect(marked?.type === "multiple-choice" && marked.options[1]?.correct).toBe(true);
    expect(tickB).toHaveAttribute("aria-pressed", "true");
  });

  test("row 6: word-search size is clamped to 8–15 and the words come from the popover", async () => {
    const sheet = withBlocks([newBlock("word-search")]);
    const { container, read } = renderWorksheetEditor(sheet);
    const ws = read().blocks[0];
    if (ws?.type !== "word-search") throw new Error("seed");
    select(container, ws.id);
    const size = screen.getByRole("spinbutton", { name: "Size" });
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "40" } });
    fireEvent.blur(size);
    expect(read().blocks[0]?.type === "word-search" && (read().blocks[0] as typeof ws).size).toBe(
      15,
    );
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "2" } });
    fireEvent.blur(size);
    expect((read().blocks[0] as typeof ws).size).toBe(8);

    fireEvent.click(screen.getByRole("button", { name: /words$/ }));
    const words = await screen.findByRole("textbox", { name: "Words to hide" });
    fireEvent.change(words, { target: { value: "sun, moon\nstar" } });
    fireEvent.keyDown(words, { key: "Escape" });
    await waitFor(() =>
      expect((read().blocks[0] as typeof ws).words).toEqual(["sun", "moon", "star"]),
    );
  });

  test("row 7: dragging the handle of block 3 above block 1 moves it in one undo step", () => {
    const { container, read } = renderWorksheetEditor();
    const [a, b, c] = read().blocks;
    if (!a || !b || !c) throw new Error("seed");
    // happy-dom has no layout: give the three rows stacked boxes 100px tall.
    const tops = new Map([
      [a.id, 0],
      [b.id, 100],
      [c.id, 200],
    ]);
    for (const [id, top] of tops) {
      row(container, id).getBoundingClientRect = () =>
        ({
          top,
          bottom: top + 100,
          height: 100,
          left: 0,
          right: 500,
          width: 500,
          x: 0,
          y: top,
          toJSON() {},
        }) as DOMRect;
    }
    const handle = within(row(container, c.id)).getByRole("button", {
      name: "Drag to reorder this block",
    });
    fireEvent.pointerDown(handle, pointer(0, 250));
    fireEvent.pointerMove(window, pointer(0, 10));
    fireEvent.pointerUp(window, pointer(0, 10));
    expect(
      read()
        .blocks.map((x) => x.id)
        .slice(0, 3),
    ).toEqual([c.id, a.id, b.id]);
    undo();
    expect(
      read()
        .blocks.map((x) => x.id)
        .slice(0, 3),
    ).toEqual([a.id, b.id, c.id]);
  });

  test("row 8: the header toolbar sets Letter, the answer key, self-assessment and caps criteria at 4", () => {
    const { container, read } = renderWorksheetEditor();
    fireEvent.pointerDown(row(container, HEADER_KEY), pointer(10, 10));
    fireEvent.click(screen.getByRole("radio", { name: "Letter" }));
    fireEvent.click(screen.getByRole("switch", { name: "Answer key" }));
    fireEvent.click(screen.getByRole("switch", { name: "Self-assessment" }));
    expect(read().pageSize).toBe("Letter");
    expect(read().includeAnswerKey).toBe(true);
    expect(read().selfAssessment).toBe(true);
    const add = screen.getByRole("button", { name: "Criterion" });
    for (let i = 0; i < 5; i++) fireEvent.click(add);
    expect(read().header.criteria?.length).toBe(4);
    expect(add).toBeDisabled();
    // Blank rows go when focus leaves the header.
    const field = screen.getByRole("textbox", { name: "Success criterion 1" });
    field.textContent = "I can add fractions.";
    fireEvent.input(field);
    act(() => {
      fireEvent.blur(field, { relatedTarget: document.body });
    });
    expect(read().header.criteria).toEqual(["I can add fractions."]);
  });

  test("Backspace on a selected block deletes it; Escape clears the selection", () => {
    const sheet = withBlocks([
      { id: uid(), type: "paragraph", doc: docFromText("One") },
      { id: uid(), type: "divider" },
    ]);
    const { container, read } = renderWorksheetEditor(sheet);
    const divider = read().blocks[1];
    if (!divider) throw new Error("seed");
    select(container, divider.id);
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(read().blocks.length).toBe(1);
    const para = read().blocks[0];
    if (!para) throw new Error("seed");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".ws-selected-ring")).toBeNull();
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Lesson, RichDoc, TextElement } from "@tj/domain/documents";
import { EXPLANATION_PLACEHOLDER, explanationLayout } from "../layout/explanation";
import { newSlide } from "../model/factories";
import { getTheme } from "../model/themes";
import { docToPlainText } from "../text/static";
import { catcher, pointer, renderEditor, seededLesson } from "./test-harness";

/*
 * Text editing on the real shell (TEACH-104 rows 2, 4, 5, 6, 10): double-click opens Tiptap in
 * the element's box, the toolbar drives the open editor or the stored doc, the canvas keys stay
 * out of the way while typing. Pointer/selection fidelity is Playwright's (`editor-text.spec.ts`).
 */

afterEach(cleanup);

const para = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** A lesson whose first slide is one 400x100 text box at (100,100) reading "Hello". */
function textLesson(): Lesson {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  const text: TextElement = {
    id: "t1",
    type: "text",
    x: 100,
    y: 100,
    w: 400,
    h: 100,
    doc: para("Hello"),
    style: { preset: "body" },
  };
  first.elements = [text];
  return lesson;
}

const textOf = (lesson: Lesson) => {
  const el = lesson.slides[0]?.elements[0];
  return el?.type === "text" ? el : undefined;
};

const select = (container: HTMLElement) => {
  fireEvent.pointerDown(catcher(container), pointer(150, 150));
  fireEvent.pointerUp(window, pointer(150, 150));
};

/** ProseMirror's contenteditable (it carries no ARIA role of its own). */
const proseMirror = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".ProseMirror");

const openEditor = async (container: HTMLElement) => {
  select(container);
  fireEvent.doubleClick(catcher(container), { clientX: 150, clientY: 150 });
  await waitFor(() => expect(proseMirror(container)).not.toBeNull());
  const pm = proseMirror(container) as HTMLElement;
  expect(pm.closest("[data-element-id='t1']")).not.toBeNull();
  return pm;
};

const toolbar = (container: HTMLElement) => {
  const bar = container.querySelector<HTMLElement>("[data-text-toolbar]");
  if (!bar) throw new Error("no text toolbar");
  return { button: (name: string) => within(bar).getByRole("button", { name }) };
};

describe("text editing on the canvas", () => {
  test("double-click mounts a `td-rt` contenteditable inside the element's own box; the frame keeps its handles hidden", async () => {
    const { container } = renderEditor(textLesson());
    const pm = await openEditor(container);
    expect(pm.getAttribute("contenteditable")).toBe("true");
    expect(pm.classList.contains("td-rt")).toBe(true);
    // The catcher opens a hole over the element: it is no longer one full-stage div.
    expect(container.querySelector("[data-stage-catcher]")).toBeNull();
    expect(container.querySelectorAll("[data-handle]")).toHaveLength(0);
  });

  test("row 2: Escape leaves the editor and puts focus back on the stage; the doc is what was typed", async () => {
    const { container, read } = renderEditor(textLesson());
    const pm = await openEditor(container);
    // A synthetic keystroke through ProseMirror's own listener: `insertText` on a beforeinput is
    // not something happy-dom delivers, so drive the document through its DOM the way a paste does.
    fireEvent.keyDown(pm, { key: "Escape" });
    await waitFor(() => expect(proseMirror(container)).toBeNull());
    expect(document.activeElement).toBe(container.querySelector("[data-selection-layer]"));
    expect(docToPlainText(textOf(read())?.doc as RichDoc)).toBe("Hello");
  });

  test("row 10: while the editor has focus, Delete and ⌘D are the editor's, not the canvas's", async () => {
    const { container, read } = renderEditor(textLesson());
    const pm = await openEditor(container);
    pm.focus();
    fireEvent.keyDown(pm, { key: "Delete" });
    fireEvent.keyDown(pm, { key: "Backspace" });
    expect(read().slides[0]?.elements).toHaveLength(1);
    fireEvent.keyDown(pm, { key: "d", metaKey: true });
    expect(read().slides[0]?.elements).toHaveLength(1);
    fireEvent.keyDown(pm, { key: "a", metaKey: true });
    fireEvent.keyDown(pm, { key: "ArrowUp" });
    expect(textOf(read())?.y).toBe(100);
  });

  test("row 5: with the box selected and no editor open, Bold rewrites the whole doc; a second press undoes it in one step", () => {
    const { container, read } = renderEditor(textLesson());
    select(container);
    expect(container.querySelector('[role="toolbar"][aria-label="Text"]')).not.toBeNull();
    fireEvent.click(toolbar(container).button("Bold"));
    expect(textOf(read())?.doc.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
    expect(toolbar(container).button("Bold")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(textOf(read())?.doc.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  test("row 4: with the editor open, Bold toggles the mark in the live editor and it lands in the doc", async () => {
    const { container, read } = renderEditor(textLesson());
    const pm = await openEditor(container);
    const bold = toolbar(container).button("Bold");
    // Nothing selected in the editor: the mark is stored for the next keystroke, so select all.
    fireEvent.keyDown(pm, { key: "a", metaKey: true });
    fireEvent.click(bold);
    await waitFor(() =>
      expect(toolbar(container).button("Bold")).toHaveAttribute("aria-pressed", "true"),
    );
    await waitFor(() =>
      expect(textOf(read())?.doc.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]),
    );
  });

  test("row 6: the link popover refuses javascript: with TeachDeck's message and normalises a bare host", async () => {
    const { container, read } = renderEditor(textLesson());
    select(container);
    fireEvent.click(toolbar(container).button("Link"));
    const field = await screen.findByRole("textbox", { name: "Link address" });
    fireEvent.change(field, { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Links can only go to a web page or an email address.",
    );
    expect(textOf(read())?.doc.content?.[0]?.content?.[0]?.marks).toBeUndefined();

    fireEvent.change(field, { target: { value: "bbc.co.uk/bitesize" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(textOf(read())?.doc.content?.[0]?.content?.[0]?.marks).toEqual([
        { type: "link", attrs: { href: "https://bbc.co.uk/bitesize" } },
      ]),
    );
    expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull();
  });

  test("the size stepper and the preset menu write the style; the stepper stops at the floor", () => {
    const { container, read } = renderEditor(textLesson());
    select(container);
    fireEvent.click(toolbar(container).button("Larger"));
    const size = textOf(read())?.style.fontSize;
    expect(typeof size).toBe("number");
    fireEvent.click(toolbar(container).button("Larger"));
    expect(textOf(read())?.style.fontSize).toBe((size as number) + 2);
  });

  test("a click on the stage outside the editor leaves text editing", async () => {
    const { container } = renderEditor(textLesson());
    await openEditor(container);
    const catchers = container.querySelectorAll<HTMLElement>(
      "[data-selection-layer] > div[style*='touch-action']",
    );
    expect(catchers.length).toBeGreaterThan(1);
    fireEvent.pointerDown(catchers[0] as HTMLElement, pointer(700, 400));
    fireEvent.pointerUp(window, pointer(700, 400));
    await act(async () => {});
    await waitFor(() => expect(proseMirror(container)).toBeNull());
  });
});

describe("the explanation panel", () => {
  test("row 9: in the answer state, double-clicking the panel opens the editor; typing writes setExplanation; Escape closes it", async () => {
    const lesson = seededLesson();
    const tf = newSlide("true-false", lesson.themeId);
    lesson.slides = [tf, ...lesson.slides];
    const { container, read } = renderEditor(lesson);
    // Into the answer state through the tabs, the way a teacher does (Radix tabs act on mousedown).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Answer" }));
    await waitFor(() => expect(container.querySelector("[data-explanation-panel]")).not.toBeNull());

    const box = explanationLayout({
      slide: tf,
      theme: getTheme(lesson.themeId),
      text: EXPLANATION_PLACEHOLDER,
    });
    fireEvent.doubleClick(catcher(container), {
      clientX: box.x + box.w / 2,
      clientY: box.y + box.h / 2,
    });
    const field = await screen.findByRole("textbox", { name: "Why this is the answer" });
    expect(document.activeElement).toBe(field);

    field.textContent = "Because clouds are droplets";
    fireEvent.input(field);
    expect(read().slides[0]?.question).toMatchObject({
      explanation: "Because clouds are droplets",
    });

    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Why this is the answer" })).toBeNull(),
    );
    expect(document.activeElement).toBe(container.querySelector("[data-selection-layer]"));
    // The typing burst is one undo step.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect("explanation" in (read().slides[0]?.question ?? {})).toBe(false);
  });
});

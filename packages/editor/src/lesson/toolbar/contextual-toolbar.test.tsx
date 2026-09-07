import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Lesson, ShapeElement, SlideElement } from "@tj/domain/documents";
import { docFromText } from "../../model/factories";
import { makeLine, makeShape, makeTable, makeText, makeTimer } from "../../model/insert";
import { getTheme } from "../../model/themes";
import { docHasMark } from "../../text/doc-marks";
import { catcher, pointer, renderEditor, seededLesson } from "../test-harness";

/*
 * TEACH-105: which toolbar the selection routes to (TeachDeck `chrome.test.tsx` catalogue), and
 * rows 1, 2, 4, 5, 6 — every control writes one reducer, scrubs are one undo step.
 */

afterEach(cleanup);

const theme = getTheme("chalk");

/** A lesson whose first slide carries one element of each type at known spots. */
function chromeLesson(): Lesson {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  const at = (el: SlideElement, x: number, y: number): SlideElement => ({
    ...el,
    x,
    y,
    w: 100,
    h: 60,
  });
  first.elements = [
    at(makeShape("rect", theme), 100, 100),
    at(makeLine("line", theme), 300, 100),
    at(makeText("body", theme), 500, 100),
    at(makeTimer(), 100, 300),
    at(makeTable(theme), 300, 300),
    {
      ...at(makeShape("ellipse", theme), 500, 300),
      type: "image",
      src: "data:,",
      fit: "contain",
    } as SlideElement,
  ];
  return lesson;
}

const clickAt = (container: HTMLElement, x: number, y: number, extra = {}) => {
  fireEvent.pointerDown(catcher(container), pointer(x, y, extra));
  fireEvent.pointerUp(window, pointer(x, y, extra));
};
const toolbar = (name: string) => screen.getByRole("toolbar", { name });
/** Radix menus open from the keyboard on Enter; a `click` alone does not toggle them. */
const openMenu = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });
const idle = () => new Promise((r) => setTimeout(r, 600));
const first = (lesson: Lesson, i = 0) => lesson.slides[0]?.elements[i] as SlideElement;

describe("ContextualToolbar routing", () => {
  test("nothing selected → Slide; one of each type → its bar; two → Selection", () => {
    const { container } = renderEditor(chromeLesson());
    expect(toolbar("Slide")).toBeInTheDocument();
    clickAt(container, 150, 130);
    expect(toolbar("Shape")).toBeInTheDocument();
    clickAt(container, 350, 130);
    expect(toolbar("Line")).toBeInTheDocument();
    clickAt(container, 550, 130);
    expect(toolbar("Text")).toBeInTheDocument();
    clickAt(container, 150, 330);
    expect(toolbar("Element")).toBeInTheDocument();
    clickAt(container, 350, 330);
    expect(toolbar("Element")).toBeInTheDocument();
    clickAt(container, 550, 330);
    expect(toolbar("Image")).toBeInTheDocument();
    clickAt(container, 150, 130, { shiftKey: true });
    expect(toolbar("Selection")).toHaveTextContent("2 selected");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(toolbar("Slide")).toBeInTheDocument();
  });
});

describe("ShapeToolbar (row 1)", () => {
  test("fill from the palette is one write; a border width pick is one undo step", async () => {
    const { container, read } = renderEditor(chromeLesson());
    clickAt(container, 150, 130);
    fireEvent.click(within(toolbar("Shape")).getByRole("button", { name: "Fill" }));
    const swatch = await screen.findByRole("button", { name: theme.colors.correct });
    fireEvent.click(swatch);
    expect((first(read()) as { fill?: string }).fill).toBe(theme.colors.correct);

    // The menu marks the drawn width (none yet) and a pick writes width plus a first border colour.
    openMenu(within(toolbar("Shape")).getByRole("button", { name: /Border width/ }));
    expect(await screen.findByRole("menuitemradio", { name: "0 None" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "3" }));
    expect(first(read())).toMatchObject({ strokeWidth: 3, stroke: theme.colors.ink });
    await idle();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((first(read()) as { strokeWidth?: number }).strokeWidth ?? 0).toBe(0);
    expect((first(read()) as { fill?: string }).fill).toBe(theme.colors.correct);
  });

  test("opacity popover writes the element's opacity from the slider", async () => {
    const { container, read } = renderEditor(chromeLesson());
    clickAt(container, 150, 130);
    fireEvent.click(within(toolbar("Shape")).getByRole("button", { name: /Opacity/ }));
    const slider = await screen.findByRole("slider", { name: "Opacity" });
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect((first(read()) as { opacity?: number }).opacity).toBeCloseTo(0.99);
  });
});

describe("ShapeToolbar label text controls", () => {
  const openLabel = async () => {
    fireEvent.click(within(toolbar("Shape")).getByRole("button", { name: "Label" }));
    return await screen.findByRole("dialog", { name: "Label" });
  };

  test("a labelled shape's preset, size, colour and marks write it from the Label popover", async () => {
    const lesson = chromeLesson();
    const slide = lesson.slides[0];
    if (!slide) throw new Error("seed");
    slide.elements[0] = { ...(first(lesson) as ShapeElement), doc: docFromText("Go") };
    const { container, read } = renderEditor(lesson);
    clickAt(container, 150, 130);
    const panel = await openLabel();
    expect(within(panel).getByRole("button", { name: /^Label style/ })).toHaveAccessibleName(
      "Label style, Body",
    );

    openMenu(within(panel).getByRole("button", { name: /^Label style/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Heading" }));
    expect((first(read()) as ShapeElement).textStyle).toMatchObject({ preset: "heading" });

    const before = Number(within(panel).getByText(/^\d+$/).textContent);
    fireEvent.click(within(panel).getByRole("button", { name: "Larger" }));
    expect((first(read()) as ShapeElement).textStyle?.fontSize).toBe(before + 2);

    fireEvent.click(within(panel).getByRole("button", { name: "Label colour" }));
    fireEvent.click(await screen.findByRole("button", { name: theme.colors.accent }));
    expect((first(read()) as ShapeElement).textStyle?.color).toBe(theme.colors.accent);

    const bold = within(panel).getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bold);
    expect(docHasMark((first(read()) as ShapeElement).doc, "bold")).toBe(true);
    expect(within(panel).getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a shape with no label has only the label field", async () => {
    const { container } = renderEditor(chromeLesson());
    clickAt(container, 150, 130);
    const panel = await openLabel();
    expect(within(panel).getByRole("textbox")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /^Label style/ })).toBeNull();
  });
});

describe("LineToolbar (row 2)", () => {
  test("arrow heads and dash write the element", async () => {
    const { container, read } = renderEditor(chromeLesson());
    clickAt(container, 350, 130);
    openMenu(within(toolbar("Line")).getByRole("button", { name: /Arrows/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Arrows at both ends" }));
    expect(first(read(), 1)).toMatchObject({ arrowStart: true, arrowEnd: true });
    fireEvent.click(within(toolbar("Line")).getByRole("radio", { name: "Dashed" }));
    expect(first(read(), 1)).toMatchObject({ dash: "dashed" });
  });
});

describe("ImageToolbar (row 3)", () => {
  test("fit and alt text write the element; Replace opens the panel in replace mode", async () => {
    const { container, read } = renderEditor(chromeLesson());
    clickAt(container, 550, 330);
    const bar = toolbar("Image");
    fireEvent.click(within(bar).getByRole("radio", { name: "Fill" }));
    expect(first(read(), 5)).toMatchObject({ fit: "cover" });
    fireEvent.click(within(bar).getByRole("button", { name: /Replace/ }));
    const replace = await screen.findByRole("dialog", { name: "Replace image" });
    fireEvent.keyDown(replace, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Replace image" })).toBeNull());
    fireEvent.click(within(bar).getByRole("button", { name: "Alt" }));
    const alt = await screen.findByRole("textbox", { name: "Alt text" });
    fireEvent.change(alt, { target: { value: "A cloud" } });
    expect(first(read(), 5)).toMatchObject({ alt: "A cloud" });
  });
});

describe("MultiToolbar (row 4)", () => {
  test("align and group dispatch the arrange reducers", async () => {
    const { container, read } = renderEditor(chromeLesson());
    clickAt(container, 150, 130);
    clickAt(container, 350, 130, { shiftKey: true });
    openMenu(within(toolbar("Selection")).getByRole("button", { name: /Align/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Align top" }));
    expect(first(read(), 0).y).toBe(first(read(), 1).y);
    fireEvent.click(within(toolbar("Selection")).getByRole("button", { name: "Group" }));
    const els = read().slides[0]?.elements ?? [];
    expect(els.some((e) => e.type === "group")).toBe(true);
    expect(els).toHaveLength(5);
  });
});

describe("SlideToolbar (rows 5, 6)", () => {
  test("layout menu lists every kind; converting re-applies the recipe after confirming", async () => {
    const { read } = renderEditor(chromeLesson());
    openMenu(within(toolbar("Slide")).getByRole("button", { name: /Slide layout/ }));
    const items = await screen.findAllByRole("menuitemradio");
    expect(items.length).toBe(20);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "True or false" }));
    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));
    await waitFor(() => expect(read().slides[0]?.kind).toBe("true-false"));
    expect(read().slides[0]?.question?.type).toBe("true-false");
  });

  test("transition and notes write the slide; notes typing is one undo step", async () => {
    const { read } = renderEditor(chromeLesson());
    openMenu(within(toolbar("Slide")).getByRole("button", { name: /Transition/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Push" }));
    expect(read().slides[0]?.transition).toBe("push");
    // The closing menu hands focus back to its trigger on the next tick; a popover opened before
    // that lands would read the focus move as "outside" and close.
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(within(toolbar("Slide")).getByRole("button", { name: "Notes" }));
    const notes = await screen.findByRole("textbox", { name: "Presenter notes" });
    fireEvent.change(notes, { target: { value: "Ask" } });
    fireEvent.change(notes, { target: { value: "Ask why" } });
    fireEvent.blur(notes);
    expect(read().slides[0]?.notes).toBe("Ask why");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().slides[0]?.notes).toBeUndefined();
    expect(read().slides[0]?.transition).toBe("push");
  });

  test("row 6: a multiple-choice slide's options toggle correct; the multi switch works", async () => {
    const lesson = seededLesson();
    lesson.slides = [
      (await import("../../model/factories")).newSlide("multiple-choice", lesson.themeId),
      ...lesson.slides,
    ];
    const { read } = renderEditor(lesson);
    fireEvent.click(within(toolbar("Slide")).getByRole("button", { name: "Answer" }));
    const boxes = await screen.findAllByRole("checkbox", { name: /is correct/ });
    expect(boxes.length).toBeGreaterThan(1);
    fireEvent.click(boxes[1] as HTMLElement);
    const q = () =>
      read().slides[0]?.question as { options: { correct: boolean }[]; multi?: boolean };
    expect(q().options[1]?.correct).toBe(true);
    expect(q().options.filter((o) => o.correct)).toHaveLength(1);
    fireEvent.click(screen.getByRole("switch", { name: "Allow several correct answers" }));
    expect(q().multi).toBe(true);
    fireEvent.click(boxes[0] as HTMLElement);
    expect(q().options.filter((o) => o.correct)).toHaveLength(2);
    // Back to one answer: only the first tick survives.
    fireEvent.click(screen.getByRole("switch", { name: "Allow several correct answers" }));
    expect(q().multi).toBe(false);
    expect(q().options.map((o) => o.correct)).toEqual(
      [true, false, false, false].slice(0, q().options.length),
    );
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, within } from "@testing-library/react";
import { clearShift } from "./Canvas";
import { PANE_MIN, paneWidth } from "./shell-layout";
import { openLessonActions, renderEditor } from "./test-harness";

/*
 * Ruling 186: the editor layout. Slides in a bottom filmstrip, Text / Image / Shape / More on the
 * left, a top bar of Saved, the theme callout, ⋯, Export and Present, and the Dayback pane on the
 * right, sized and placed by the shell rules in `shell-layout.ts`.
 */

const realMatchMedia = window.matchMedia;
/** Pretends the window is `width` px wide for the editor's media queries. */
function windowWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = max ? width <= Number(max[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

const pane = (open = true) => ({
  open,
  label: "Dayback",
  content: <p>thread</p>,
});

describe("editor layout (ruling 186)", () => {
  test("slides sit in a filmstrip under the canvas, not in a column beside it", () => {
    windowWidth(1440);
    const { container } = renderEditor();
    const strip = container.querySelector("[data-navigator]");
    expect(strip).toHaveAttribute("data-navigator-mode", "strip");
    expect(strip?.tagName).toBe("NAV");
    // The strip and the canvas share one column; the strip (in the box that makes room for a
    // docked pane) comes after the canvas.
    const room = strip?.parentElement;
    const column = room?.parentElement;
    expect(column?.querySelector("[data-canvas]")).not.toBeNull();
    expect(column?.lastElementChild).toBe(room as Element);
  });

  test("the left side holds Text, Image, Shape and More; the rest is behind More", () => {
    windowWidth(1440);
    renderEditor();
    const rail = screen.getByRole("toolbar", { name: "Insert" });
    for (const name of ["Text", "Image", "Shape", "More"]) {
      expect(within(rail).getByRole("button", { name })).toBeInTheDocument();
    }
    for (const name of ["Line", "Icon", "Table", "Timer", "Activities", "Embed"]) {
      expect(within(rail).queryByRole("button", { name })).toBeNull();
    }
  });

  test("the top bar keeps the theme callout, Export and Present visible; ⋯ holds Share, Facts, Worksheet", () => {
    // The app's list-and-maker is the one Worksheet entry; the built-in button gives way to it.
    windowWidth(1440);
    const lesson = renderEditor(undefined, {
      exportSlot: <button type="button">Export</button>,
      worksheetsSlot: <button type="button">Worksheet</button>,
      onNewWorksheet: mock(() => {}),
    });
    const bar = lesson.container.querySelector<HTMLElement>("[data-topbar]");
    if (!bar) throw new Error("no top bar");
    // Ruling 123: the theme callout is never folded into ⋯.
    expect(within(bar).getByRole("button", { name: /^Theme:/ })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Present" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Worksheet" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "Share" })).toBeNull();
    openLessonActions();
    const menu = screen.getByLabelText("Lesson actions");
    expect(within(menu).getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(within(menu).getAllByRole("button", { name: "Worksheet" })).toHaveLength(1);
    expect(within(menu).queryByRole("button", { name: /^Theme:/ })).toBeNull();
    expect(within(menu).queryByRole("button", { name: "Export" })).toBeNull();
  });

  test("the pane lies at the right of the editor body at its fluid width", () => {
    windowWidth(1440);
    renderEditor(undefined, { sidePane: pane() });
    const aside = screen.getByRole("complementary", { name: "Dayback" });
    expect(aside.style.width).toBe(`${paneWidth(window.innerWidth)}px`);
    expect(aside.className).toContain("absolute");
    expect(aside.getAttribute("data-side-pane")).toMatch(/^(docked|overlay)$/);
  });

  test("a closed pane stays mounted, hidden, so its work carries on", () => {
    windowWidth(1440);
    const { container } = renderEditor(undefined, { sidePane: pane(false) });
    expect(screen.queryByRole("complementary", { name: "Dayback" })).toBeNull();
    const aside = container.querySelector("[data-side-pane]");
    expect(aside).toHaveAttribute("hidden");
    expect(aside?.textContent).toBe("thread");
  });

  test("the filmstrip toggle folds it to dots", () => {
    windowWidth(1440);
    localStorage.removeItem("tj:filmstrip-dots");
    const { container } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Collapse slide strip" }));
    expect(container.querySelector("[data-navigator]")).toHaveAttribute(
      "data-navigator-mode",
      "dots",
    );
    localStorage.removeItem("tj:filmstrip-dots");
  });
});

describe("clearShift: the slide moves left, never smaller, to clear a pane over the canvas", () => {
  // 1280 x 800: the canvas column is 1232 wide; the slide is bounded by height at 896 wide.
  const slideW = 896;
  const gutterX = 16;
  const contentW = slideW + gutterX * 2;

  test("nothing over the canvas: no shift", () => {
    expect(clearShift(1232, contentW, gutterX, 0)).toBe(0);
  });

  test("at 1280 the slide clears the narrowest pane with air to spare", () => {
    const shift = clearShift(1232, contentW, gutterX, PANE_MIN);
    const slack = (1232 - contentW) / 2;
    const rightGap = slack + gutterX + shift;
    expect(rightGap).toBeGreaterThanOrEqual(PANE_MIN + 16);
    expect(shift).toBeLessThanOrEqual(slack);
  });

  test("never more than the slack beside the slide, so it is never cut off on the left", () => {
    const narrow = clearShift(1052, contentW, gutterX, PANE_MIN);
    expect(narrow).toBe((1052 - contentW) / 2);
    expect(clearShift(contentW, contentW, gutterX, PANE_MIN)).toBe(0);
  });

  test("a wide margin already clear of the pane: no shift", () => {
    expect(clearShift(2000, contentW, gutterX, PANE_MIN)).toBe(0);
  });
});

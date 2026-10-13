import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { GroupElement, LayoutRef, Lesson } from "@tj/domain/documents";
import * as kit from "@tj/slides/relayout";
import * as reducers from "../../model/reducers";
import { syncLayoutGroups } from "../../model/reducers/layout-sync";
import { renderTheme } from "../../model/themes";
import { catcher, pointer, renderEditor, seededLesson } from "../test-harness";
import { clampToMin } from "./gesture-maths";
import { DETACH_NOTICE } from "./use-layout-detach-notice";

/*
 * TEACH-205 part b (UX rulings 215, 199): selecting an adaptive layout group shows its items; add,
 * remove and new words re-lay the group from its template; a field over its cap shows a counter,
 * one past the layout's hard maximum is marked over with Split and Shorten.
 */

const toastSpy = Object.assign(
  mock((..._args: unknown[]) => {}),
  { error: mock(), dismiss: mock() },
);
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

afterEach(() => {
  cleanup();
  toastSpy.mockReset();
});

const cards = (n: number, text = (l: string) => `The ${l.toLowerCase()} do one job.`) =>
  ["Roots", "Stem", "Leaves", "Flower"].slice(0, n).map((label) => ({ label, text: text(label) }));

function seeded(grid: { label: string; text: string }[]): Lesson {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  const theme = renderTheme(lesson);
  const ref: LayoutRef = { template: "cards-grid", input: { heading: "Parts of a plant", grid } };
  first.elements = [kit.layoutGroup(ref, theme, kit.stageOf(theme, lesson.ageBand), "g1")];
  return lesson;
}

const group = (lesson: Lesson, at = 0) =>
  lesson.slides[at]?.elements.find((e) => e.type === "group") as GroupElement;
const cardCount = (lesson: Lesson, at = 0) =>
  group(lesson, at).children.filter((c) => c.name === "Card").length;

async function selectLayout(container: HTMLElement) {
  // A point inside the first card, well under the heading.
  fireEvent.pointerDown(catcher(container), pointer(200, 300));
  fireEvent.pointerUp(window, pointer(200, 300));
  return screen.findByRole("region", { name: "Layout items" });
}

describe("LayoutPanel", () => {
  test("the panel docks in the right-hand pane, off the slide", async () => {
    const { container } = renderEditor(seeded(cards(3)));
    const panel = await selectLayout(container);
    expect(panel.closest("[data-layout-dock]")).not.toBeNull();
    expect(panel.closest("[data-selection-layer]")).toBeNull();
    // Clicking off the layout closes it.
    fireEvent.pointerDown(catcher(container), pointer(940, 530));
    fireEvent.pointerUp(window, pointer(940, 530));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Layout items" })).toBeNull());
  });

  test("add and remove re-lay the group from its template", async () => {
    const { container, read } = renderEditor(seeded(cards(3)));
    const panel = await selectLayout(container);
    expect(within(panel).getAllByRole("group", { name: /^Item \d$/ })).toHaveLength(3);

    fireEvent.click(within(panel).getByRole("button", { name: "Add item" }));
    await waitFor(() => expect(cardCount(read())).toBe(4));
    expect(kit.itemsOf(group(read()).layout as LayoutRef)).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Remove item 2" }));
    await waitFor(() => expect(cardCount(read())).toBe(3));
    const labels = kit
      .itemsOf(group(read()).layout as LayoutRef)
      .map((c) => (c as { label: string }).label);
    expect(labels).toEqual(["Roots", "Leaves", "New card"]);
  });

  test("words typed past the cap show a quiet counter and commit on blur", async () => {
    const { container, read } = renderEditor(seeded(cards(3)));
    await selectLayout(container);
    const box = screen.getByRole("textbox", { name: "Item 1 text" }) as HTMLTextAreaElement;
    expect(container.querySelector("[data-counter]")).toBeNull();
    const long = "Roots hold the plant firmly in the soil and take in water and minerals. ".repeat(
      3,
    );
    fireEvent.change(box, { target: { value: long } });
    const counter = await waitFor(() => {
      const el = container.querySelector("[data-field='grid.0.text'] [data-counter]");
      if (!el) throw new Error("no counter");
      return el;
    });
    expect(counter.textContent).toMatch(new RegExp(`^${long.trim().length}/\\d+$`));
    // Past the cap: amber, not grey; red is kept for past the hard maximum.
    expect(counter.getAttribute("data-state")).toBe("tight");
    expect(counter.className).toContain("text-warning");
    expect(box.className).toContain("border-warning");
    fireEvent.blur(box);
    await waitFor(() =>
      expect(kit.getAtPath(group(read()).layout as LayoutRef, "grid.0.text")).toBe(long),
    );
  });

  test("past the hard maximum: marked over, Split moves the trailing items to a new slide", async () => {
    const huge = (l: string) => `${l} ${"word ".repeat(80).trim()}`;
    const lesson = seeded(cards(4, huge));
    const { container, read } = renderEditor(lesson);
    await selectLayout(container);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("hidden on the slide");
    expect(alert.textContent).not.toContain("Nothing is cut");
    expect(container.querySelector("textarea[aria-invalid='true']")).not.toBeNull();
    const red = container.querySelector("[data-counter][data-state='over']");
    expect(red?.className).toContain("text-destructive");
    const before = read().slides.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Split onto a second slide" }));
    await waitFor(() => expect(read().slides.length).toBe(before + 1));
    expect(cardCount(read(), 0)).toBe(2);
    expect(cardCount(read(), 1)).toBe(2);
    const moved = kit.itemsOf(group(read(), 1).layout as LayoutRef);
    expect(moved).toEqual(cards(4, huge).slice(2));
    // Selection stays on the head: its panel is still open, now with the two items it kept.
    const panel = await screen.findByRole("region", { name: "Layout items" });
    await waitFor(() =>
      expect(within(panel).getAllByRole("group", { name: /^Item \d$/ })).toHaveLength(2),
    );
  });

  test("a layout too small to split offers Shorten only, which goes to the over field", async () => {
    const huge = (l: string) => `${l} ${"word ".repeat(120).trim()}`;
    const { container } = renderEditor(seeded(cards(3, huge)));
    await selectLayout(container);
    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button", { name: "Split onto a second slide" })).toBeNull();
    act(() => within(alert).getByRole("button", { name: "Shorten" }).click());
    expect(document.activeElement?.getAttribute("aria-invalid")).toBe("true");
  });

  test("Escape drops the draft; remove moves focus to the next item", async () => {
    const { container, read } = renderEditor(seeded(cards(3)));
    await selectLayout(container);
    const box = screen.getByRole("textbox", { name: "Item 1 text" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Something else" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("The roots do one job.");
    fireEvent.blur(box);
    expect(kit.getAtPath(group(read()).layout as LayoutRef, "grid.0.text")).toBe(
      "The roots do one job.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove item 2" }));
    await waitFor(() => expect(cardCount(read())).toBe(2));
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Item 2 /),
    );
  });

  test("a draft resets when undo changes the words under it", async () => {
    const { container, read } = renderEditor(seeded(cards(3)));
    await selectLayout(container);
    const box = () => screen.getByRole("textbox", { name: "Item 1 text" }) as HTMLTextAreaElement;
    fireEvent.change(box(), { target: { value: "First words." } });
    fireEvent.blur(box());
    await waitFor(() =>
      expect(kit.getAtPath(group(read()).layout as LayoutRef, "grid.0.text")).toBe("First words."),
    );
    fireEvent.change(box(), { target: { value: "A draft not yet kept" } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(box().value).toBe("The roots do one job."));
  });

  test("a template that cannot lay out yet: the commit is refused, the draft is kept", async () => {
    const lesson = seededLesson();
    const first = lesson.slides[0];
    if (!first) throw new Error("seed");
    const items = ["a", "b", "c"].map((title) => ({ title, text: "words" }));
    first.elements = [
      {
        id: "g1",
        type: "group",
        x: 100,
        y: 200,
        w: 300,
        h: 200,
        layout: { template: "items-row", input: { heading: "Row", items } },
        children: [{ id: "g1:0", type: "shape", shape: "rect", x: 0, y: 0, w: 300, h: 200 }],
      },
    ];
    const { container, read } = renderEditor(lesson);
    await selectLayout(container);
    const box = screen.getByRole("textbox", { name: "Item 1 text" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "New words" } });
    fireEvent.blur(box);
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0]?.[0]).toBe(reducers.NOT_LIVE_REASON);
    expect(box.value).toBe("New words");
    expect(kit.getAtPath(group(read()).layout as LayoutRef, "items.0.text")).toBe("words");
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(toastSpy).toHaveBeenCalledTimes(2);
  });

  test("an edit that fixes the layout tells the teacher once", async () => {
    const { container, read, client } = renderEditor(seeded(cards(3)));
    await selectLayout(container);
    const slideId = read().slides[0]?.id as string;
    const card = group(read()).children.find((c) => c.name === "Card")?.id as string;
    act(() => {
      client.setQueryData(
        ["library", "documents", "L1"],
        syncLayoutGroups(
          read(),
          reducers.updateElement(read(), slideId, card, { fill: "#00ff00" }),
        ),
      );
    });
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(DETACH_NOTICE));
    expect(group(read()).layout).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Layout items" })).toBeNull());
  });

  test("a layout group never draws outside its frame (words past it are hidden at the edge)", async () => {
    const { container } = renderEditor(seeded(cards(3)));
    await waitFor(() => expect(container.querySelector("[data-layout-frame]")).not.toBeNull());
    const frame = container.querySelector<HTMLElement>("[data-layout-frame]");
    expect(frame?.style.overflow).toBe("hidden");
  });
});

describe("clampToMin (the resize gesture on a layout group)", () => {
  const rect = { x: 100, y: 100, w: 50, h: 40 };
  test("the moving edges stop at the minimum; the fixed ones stay put", () => {
    expect(clampToMin(rect, { w: 80, h: 60 }, "se")).toEqual({ x: 100, y: 100, w: 80, h: 60 });
    expect(clampToMin(rect, { w: 80, h: 60 }, "nw")).toEqual({ x: 70, y: 80, w: 80, h: 60 });
    expect(clampToMin(rect, { w: 20, h: 20 }, "e")).toEqual(rect);
  });
});

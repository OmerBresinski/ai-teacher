import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { GroupElement, LayoutRef, Lesson } from "@tj/domain/documents";
import * as kit from "@tj/slides/relayout";
import { renderTheme } from "../../model/themes";
import { catcher, pointer, renderEditor, seededLesson } from "../test-harness";

/*
 * TEACH-205 part b (UX rulings 215, 199): selecting an adaptive layout group shows its items; add,
 * remove and new words re-lay the group from its template; a field over its cap shows a counter,
 * one past the layout's hard maximum is marked over with Split and Shorten.
 */

afterEach(cleanup);

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
    expect(alert.textContent).toContain("Nothing is cut");
    expect(container.querySelector("textarea[aria-invalid='true']")).not.toBeNull();
    const before = read().slides.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Split onto a second slide" }));
    await waitFor(() => expect(read().slides.length).toBe(before + 1));
    expect(cardCount(read(), 0)).toBe(2);
    expect(cardCount(read(), 1)).toBe(2);
    const moved = kit.itemsOf(group(read(), 1).layout as LayoutRef);
    expect(moved).toEqual(cards(4, huge).slice(2));
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
});

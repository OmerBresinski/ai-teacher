import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  type GroupElement,
  type LayoutRef,
  type Lesson,
  richDocToPlainText,
  type SlideElement,
} from "@tj/domain/documents";
import * as kit from "@tj/slides/relayout";
import { produce } from "immer";
import { setLayoutKit } from "../../model/layout-kit";
import * as reducers from "../../model/reducers";
import { syncLayoutGroups } from "../../model/reducers/layout-sync";
import { renderTheme } from "../../model/themes";
import { catcher, loadTextEditor, pointer, renderEditor, seededLesson } from "../test-harness";
import { itemRects } from "./LayoutCanvasControls";

/*
 * TEACH-205 part b, reworked after Greg's verdict (no side panel): a layout's words are typed on
 * the slide and re-flow it; add and delete sit on the item and re-flow it; over-long words get a
 * quiet mark on the slide; "Free layout" takes it apart into ordinary boxes and back.
 */

const plainTextToRichDoc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});
const sid = (lesson: Lesson) => lesson.slides[0]?.id as string;

const toastSpy = Object.assign(
  mock((..._args: unknown[]) => {}),
  { error: mock(), dismiss: mock() },
);
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

beforeAll(loadTextEditor);
afterEach(() => {
  cleanup();
  toastSpy.mockReset();
  setLayoutKit(null);
});

const cards = (n: number, text = (l: string) => `The ${l.toLowerCase()} do one job.`) =>
  ["Roots", "Stem", "Leaves", "Flower", "Seed", "Fruit"]
    .slice(0, n)
    .map((label) => ({ label, text: text(label) }));

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
  lesson.slides[at]?.elements.find((e) => e.type === "group") as GroupElement & {
    layout: LayoutRef;
  };
const labels = (lesson: Lesson) =>
  kit.itemsOf(group(lesson).layout).map((c) => (c as { label: string }).label);
const child = (lesson: Lesson, path: string) =>
  group(lesson).children.find((c) => c.id === `g1:${path}`) as SlideElement;
/** The middle of a layout child on the slide (the harness draws the slide at scale 1). */
const middleOf = (lesson: Lesson, path: string) => {
  const g = group(lesson);
  const c = child(lesson, path);
  // happy-dom measures text at no height, so stay within the box's first few points.
  return { x: g.x + c.x + c.w / 2, y: g.y + c.y + Math.min(c.h / 2, 4) };
};

async function selectLayout(container: HTMLElement, lesson: Lesson) {
  const at = middleOf(lesson, "grid.0.text");
  fireEvent.pointerDown(catcher(container), pointer(at.x, at.y));
  fireEvent.pointerUp(window, pointer(at.x, at.y));
  await waitFor(() => expect(container.querySelector("[data-layout-controls]")).not.toBeNull(), {
    timeout: 5_000,
  });
}

describe("a layout edited on the slide", () => {
  test("there is no side panel: selecting a layout shows controls on the slide only", async () => {
    const lesson = seeded(cards(3));
    const { container } = renderEditor(lesson);
    await selectLayout(container, lesson);
    expect(screen.queryByRole("region", { name: "Layout items" })).toBeNull();
    expect(container.querySelector("[data-layout-dock]")).toBeNull();
    const controls = container.querySelector("[data-layout-controls]") as HTMLElement;
    expect(controls.closest("[data-selection-layer]")).not.toBeNull();
  });

  test("double-clicking an item's words opens them for typing in place", async () => {
    const lesson = seeded(cards(3));
    const { container } = renderEditor(lesson);
    await selectLayout(container, lesson);
    const at = middleOf(lesson, "grid.1.label");
    fireEvent.doubleClick(catcher(container), { clientX: at.x, clientY: at.y });
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull(), {
      timeout: 5_000,
    });
    const pm = container.querySelector(".ProseMirror") as HTMLElement;
    expect(pm.closest("[data-element-id='g1:grid.1.label']")).not.toBeNull();
  });

  test("delete on an item re-flows the layout without it", async () => {
    const lesson = seeded(cards(3));
    const { container, read } = renderEditor(lesson);
    await selectLayout(container, lesson);
    fireEvent.click(screen.getByRole("button", { name: "Delete item 2" }));
    await waitFor(() => expect(labels(read())).toEqual(["Roots", "Leaves"]));
    expect(group(read()).children.filter((c) => c.name === "Card")).toHaveLength(2);
  });

  test("add after an item puts a new item in that gap and re-flows", async () => {
    const lesson = seeded(cards(3));
    const { container, read } = renderEditor(lesson);
    await selectLayout(container, lesson);
    fireEvent.click(screen.getByRole("button", { name: "Add item after item 1" }));
    await waitFor(() => expect(labels(read())).toEqual(["Roots", "New card", "Stem", "Leaves"]));
    expect(group(read()).children.filter((c) => c.name === "Card")).toHaveLength(4);
  });

  test("the controls follow the template's limits: no delete at the minimum", async () => {
    const lesson = seeded(cards(2));
    const { container } = renderEditor(lesson);
    await selectLayout(container, lesson);
    expect(screen.queryByRole("button", { name: /^Delete item/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Add item after/ })).toHaveLength(2);
  });

  test("pointing at an item shows its controls; the others stay hidden", async () => {
    const lesson = seeded(cards(3));
    const { container } = renderEditor(lesson);
    await selectLayout(container, lesson);
    const at = middleOf(lesson, "grid.2.text");
    fireEvent.pointerMove(window, pointer(at.x, at.y));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete item 3" }).getAttribute("data-shown")).toBe(
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Delete item 1" }).getAttribute("data-shown")).toBe(
      null,
    );
  });

  test("words past the hard maximum get a red mark and a small chip with Shorten and Split", async () => {
    const long = "Roots hold the plant firmly in the soil and take in water and minerals. ".repeat(
      6,
    );
    const lesson = seeded(cards(4, (l) => (l === "Roots" ? long : `The ${l} do one job.`)));
    const { container } = renderEditor(lesson);
    await selectLayout(container, lesson);
    await waitFor(() =>
      expect(container.querySelector("[data-layout-mark='over']")).not.toBeNull(),
    );
    const chip = container.querySelector("[data-layout-over]") as HTMLElement;
    expect(chip.textContent).toContain("Too long: the end is hidden");
    expect(chip.querySelector("button")?.textContent).toBe("Shorten");
    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull(), {
      timeout: 5_000,
    });
    expect(
      (container.querySelector(".ProseMirror") as HTMLElement).closest(
        "[data-element-id='g1:grid.0.text']",
      ),
    ).not.toBeNull();
  });

  test("item boxes run across a grid row in reading order", () => {
    const lesson = seeded(cards(3));
    const rects = itemRects(group(lesson));
    expect(rects.map((r) => r.n)).toEqual([0, 1, 2]);
    expect(rects[1]?.rect.x).toBeGreaterThan(rects[0]?.rect.x ?? 0);
  });
});

describe("typing re-flows the layout", () => {
  /** One edit as the inline editor makes it: only the typed box changes (immer, as history). */
  const typed = (lesson: Lesson, path: string, words: string): Lesson =>
    produce(lesson, (d) => {
      const c = group(d as Lesson).children.find((x) => x.id === `g1:${path}`) as { doc?: unknown };
      c.doc = plainTextToRichDoc(words);
    });

  test("with the template code loaded, new words re-lay the group in the same edit", () => {
    setLayoutKit(kit);
    const lesson = seeded(cards(3));
    const long = "Roots hold the plant in the soil and take in water and minerals from it.";
    const out = syncLayoutGroups(lesson, typed(lesson, "grid.0.text", long));
    expect((kit.itemsOf(group(out).layout)[0] as { text: string }).text).toBe(long);
    const fresh = kit.layoutGroup(
      {
        template: "cards-grid",
        input: {
          heading: "Parts of a plant",
          grid: [{ label: "Roots", text: long }, ...cards(3).slice(1)],
        },
      },
      renderTheme(lesson),
      kit.stageOf(renderTheme(lesson), lesson.ageBand),
      "g1",
    );
    // Every box sits where a fresh layout of the new words puts it.
    const boxes = (g: GroupElement) => g.children.map((c) => [c.id, c.x, c.y, c.w, c.h]);
    expect(boxes(group(out))).toEqual(boxes(fresh));
    // The box typed into keeps the teacher's own doc, so the caret never jumps.
    expect(richDocToPlainText((child(out, "grid.0.text") as unknown as { doc: never }).doc)).toBe(
      long,
    );
  });

  test("before the template code loads, the words still write through (no re-lay yet)", () => {
    const lesson = seeded(cards(3));
    const before = group(lesson).children.map((c) => c.h);
    const out = syncLayoutGroups(lesson, typed(lesson, "grid.1.label", "Trunk"));
    expect(labels(out)[1]).toBe("Trunk");
    expect(group(out).children.map((c) => c.h)).toEqual(before);
  });
});

describe("Free layout", () => {
  test("on: the layout becomes ordinary boxes exactly where they were, and is kept to tidy", () => {
    const lesson = seeded(cards(3));
    const g = group(lesson);
    const out = reducers.freeLayout(lesson, sid(lesson), "g1");
    const slide = out.lesson.slides[0];
    expect(slide?.elements.some((e) => e.type === "group")).toBe(false);
    expect(slide?.elements.map((e) => e.id)).toEqual(g.children.map((c) => c.id));
    for (const c of g.children) {
      const freed = slide?.elements.find((e) => e.id === c.id);
      expect([freed?.x, freed?.y, freed?.w, freed?.h]).toEqual([g.x + c.x, g.y + c.y, c.w, c.h]);
    }
    expect(slide?.freeLayout?.layout).toBe(g.layout);
    expect(out.ids).toHaveLength(g.children.length);
  });

  test("off: the layout comes back where it was, with the words typed into its freed boxes", () => {
    const lesson = seeded(cards(3));
    const freed = reducers.freeLayout(lesson, sid(lesson), "g1").lesson;
    const edited = structuredClone(freed);
    const s = edited.slides[0];
    if (!s) throw new Error("slide");
    for (const e of s.elements) {
      if (e.id === "g1:grid.1.label") (e as { doc?: unknown }).doc = plainTextToRichDoc("Trunk");
      if (e.id === "g1:grid.0.label") e.x += 120; // a move: not kept
    }
    s.elements.push({ ...(s.elements[0] as SlideElement), id: "mine", x: 10, y: 10 });
    const out = reducers.tidyLayout(edited, sid(lesson), kit);
    expect(out.id).toBe("g1");
    const back = out.lesson.slides[0];
    expect(back?.freeLayout).toBeUndefined();
    expect(labels(out.lesson)).toEqual(["Roots", "Trunk", "Leaves"]);
    expect(back?.elements.map((e) => e.id)).toEqual(["g1", "mine"]);
    // Nothing else changed: the layout is where it was, its boxes where the template puts them.
    const fresh = reducers.editLayoutItem(
      lesson,
      sid(lesson),
      "g1",
      "grid.1.label",
      "Trunk",
      kit,
    ).lesson;
    expect(group(out.lesson).children).toEqual(group(fresh).children);
    expect([group(out.lesson).x, group(out.lesson).y]).toEqual([group(lesson).x, group(lesson).y]);
  });

  test("on and straight off again gives back the same layout", () => {
    const lesson = seeded(cards(3));
    const round = reducers.tidyLayout(
      reducers.freeLayout(lesson, sid(lesson), "g1").lesson,
      sid(lesson),
      kit,
    );
    expect(round.lesson.slides[0]?.elements).toEqual(lesson.slides[0]?.elements as never);
  });

  test("the switch on the layout's toolbar frees it, and the slide toolbar's switch tidies it", async () => {
    const lesson = seeded(cards(3));
    const { container, read } = renderEditor(lesson);
    await selectLayout(container, lesson);
    const on = await screen.findByRole("switch", { name: "Free layout" });
    expect(on.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(on);
    await waitFor(() => expect(read().slides[0]?.freeLayout).toBeDefined());
    expect(read().slides[0]?.elements.some((e) => e.type === "group")).toBe(false);
    const off = await screen.findByRole("switch", { name: "Free layout" });
    expect(off.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(off);
    await waitFor(() => expect(read().slides[0]?.freeLayout).toBeUndefined());
    expect(group(read()).layout.template).toBe("cards-grid");
  });
});

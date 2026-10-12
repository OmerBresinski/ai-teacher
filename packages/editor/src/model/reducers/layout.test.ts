import { describe, expect, test } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import {
  type GroupElement,
  type LayoutRef,
  type Lesson,
  parseLesson,
  type ShapeElement,
  type TextElement,
} from "@tj/domain/documents";
import * as kit from "@tj/slides/relayout";
import { createElement, type ReactNode } from "react";
import { docFromText, newLesson } from "../factories";
import { renderTheme } from "../themes";
import { useDocumentHistory } from "../use-document-history";
import * as r from "./index";

/*
 * TEACH-205 part b: an adaptive layout (a group with a LayoutRef) is re-laid by its template when
 * an item is edited, added or removed, in one undo step, and nothing outside the group moves.
 */

notifyManager.setScheduler((callback) => callback());

const cards = (n: number) =>
  ["Roots", "Stem", "Leaves", "Flower"].slice(0, n).map((label) => ({
    label,
    text: `The ${label.toLowerCase()} do one job.`,
  }));
const ref = (n: number): LayoutRef => ({
  template: "cards-grid",
  input: { heading: "Parts of a plant", grid: cards(n) },
});

const teacherBox = (): ShapeElement => ({
  id: "mine",
  type: "shape",
  shape: "rect",
  x: 700,
  y: 20,
  w: 120,
  h: 40,
  fill: "#ff0000",
});

function seeded(n = 3): { lesson: Lesson; slideId: string } {
  const lesson = newLesson("Plants");
  const first = lesson.slides[0];
  if (!first) throw new Error("newLesson has a slide");
  const theme = renderTheme(lesson);
  const stage = kit.stageOf(theme, lesson.ageBand);
  first.elements = [kit.layoutGroup(ref(n), theme, stage, "g1"), teacherBox()];
  return { lesson, slideId: first.id };
}

const groupOf = (lesson: Lesson, slideId = lesson.slides[0]?.id): GroupElement => {
  const g = lesson.slides.find((s) => s.id === slideId)?.elements.find((e) => e.id === "g1");
  if (g?.type !== "group") throw new Error("no layout group");
  return g;
};
const named = (g: GroupElement, name: string) => g.children.filter((c) => c.name === name);
const words = (el: unknown) => JSON.stringify((el as TextElement).doc);

describe("addLayoutItem", () => {
  test("three cards become four, laid out by the template, the grid re-shaped", () => {
    const { lesson, slideId } = seeded(3);
    const out = r.addLayoutItem(lesson, slideId, "g1", 3, kit);
    expect(out.refused).toBeUndefined();
    const g = groupOf(out.lesson);
    const boxes = named(g, "Card");
    expect(boxes).toHaveLength(4);
    // 4 cards are a 2x2: two distinct columns and two distinct rows, evenly sized.
    expect(new Set(boxes.map((b) => b.x)).size).toBe(2);
    expect(new Set(boxes.map((b) => b.y)).size).toBe(2);
    expect(new Set(boxes.map((b) => b.w)).size).toBe(1);
    expect(kit.itemsOf(g.layout as LayoutRef)).toHaveLength(4);
    expect(g.layout?.frame).toEqual({ x: g.x, y: g.y, w: g.w, h: g.h });
  });

  test("refused at the template's max, with a reason in teacher words, lesson unchanged", () => {
    const { lesson, slideId } = seeded(4);
    const out = r.addLayoutItem(lesson, slideId, "g1", 4, kit);
    expect(out.lesson).toBe(lesson);
    expect(out.refused).toBe("This layout holds at most 4 cards.");
  });

  test("a plain group or a missing id is a no-op", () => {
    const { lesson, slideId } = seeded(3);
    expect(r.addLayoutItem(lesson, slideId, "mine", 0, kit).lesson).toBe(lesson);
    expect(r.addLayoutItem(lesson, slideId, "nope", 0, kit).lesson).toBe(lesson);
  });
});

describe("removeLayoutItem", () => {
  test("removing card 2 of 3 re-spaces the two left, no hole", () => {
    const { lesson, slideId } = seeded(3);
    const before = named(groupOf(lesson), "Card");
    const out = r.removeLayoutItem(lesson, slideId, "g1", 1, kit);
    const g = groupOf(out.lesson);
    const boxes = named(g, "Card");
    expect(boxes).toHaveLength(2);
    // Two cards share the width the three had: each is wider than before.
    expect(boxes[0]?.w ?? 0).toBeGreaterThan(before[0]?.w ?? 0);
    const labels = named(g, "Card label").map(words);
    expect(labels.join()).toContain("ROOTS");
    expect(labels.join()).toContain("LEAVES");
    expect(labels.join()).not.toContain("STEM");
  });

  test("refused at the min", () => {
    const { lesson, slideId } = seeded(3);
    const two = r.removeLayoutItem(lesson, slideId, "g1", 0, kit).lesson;
    const out = r.removeLayoutItem(two, slideId, "g1", 0, kit);
    expect(out.lesson).toBe(two);
    expect(out.refused).toBe("This layout needs at least 2 cards.");
  });
});

describe("editLayoutItem", () => {
  test("new words go into the ref and the re-laid text, the box ids stay put", () => {
    const { lesson, slideId } = seeded(3);
    const ids = groupOf(lesson).children.map((c) => c.id);
    const out = r.editLayoutItem(lesson, slideId, "g1", "grid.1.text", "Carries water up.", kit);
    const g = groupOf(out.lesson);
    expect(kit.getAtPath(g.layout as LayoutRef, "grid.1.text")).toBe("Carries water up.");
    const body = g.children.find((c) => c.id === "g1:grid.1.text");
    expect(words(body)).toContain("Carries water up.");
    expect(g.children.map((c) => c.id)).toEqual(ids);
  });

  test("the same words are a no-op", () => {
    const { lesson, slideId } = seeded(3);
    const same = r.editLayoutItem(lesson, slideId, "g1", "grid.0.label", "Roots", kit);
    expect(same.lesson).toBe(lesson);
  });
});

describe("what the re-lay leaves alone", () => {
  test("a teacher's element outside the group survives every change", () => {
    const { lesson, slideId } = seeded(3);
    let l = r.addLayoutItem(lesson, slideId, "g1", 0, kit).lesson;
    l = r.removeLayoutItem(l, slideId, "g1", 2, kit).lesson;
    l = r.editLayoutItem(l, slideId, "g1", "heading", "Plant parts", kit).lesson;
    const mine = l.slides[0]?.elements.find((e) => e.id === "mine");
    expect(mine).toEqual(teacherBox());
    expect(l.slides[0]?.elements.map((e) => e.id)).toEqual(["g1", "mine"]);
  });

  test("a group the teacher moved keeps its offset when it is re-laid", () => {
    const { lesson, slideId } = seeded(3);
    const moved = r.transformElements(lesson, slideId, ["g1"], { dx: 30, dy: 12 });
    const frame0 = groupOf(moved).layout?.frame;
    const out = r.addLayoutItem(moved, slideId, "g1", 3, kit).lesson;
    const g = groupOf(out);
    expect(g.x - (g.layout?.frame?.x ?? 0)).toBe(30);
    expect(g.y - (g.layout?.frame?.y ?? 0)).toBe(12);
    expect(frame0).toBeDefined();
  });

  test("the result is still a valid lesson", () => {
    const { lesson, slideId } = seeded(3);
    const out = r.addLayoutItem(lesson, slideId, "g1", 1, kit).lesson;
    expect(() => parseLesson(JSON.parse(JSON.stringify(out)))).not.toThrow();
  });

  test("ungrouping a layout group leaves plain elements and drops the ref", () => {
    const { lesson, slideId } = seeded(3);
    const { lesson: flat, ids } = r.ungroup(lesson, slideId, "g1");
    expect(ids.length).toBeGreaterThan(0);
    const els = flat.slides[0]?.elements ?? [];
    expect(els.some((e) => e.type === "group")).toBe(false);
    expect(JSON.stringify(els)).not.toContain('"layout"');
  });
});

describe("splitLayout (ruling 215)", () => {
  test("four cards: two stay, two move to a new slide right after, same template and heading", () => {
    const { lesson, slideId } = seeded(4);
    const out = r.splitLayout(lesson, slideId, "g1", kit);
    expect(out.refused).toBeUndefined();
    expect(out.lesson.slides).toHaveLength(lesson.slides.length + 1);
    const next = out.lesson.slides[1];
    expect(next?.id).toBe(out.id as string);
    const head = groupOf(out.lesson);
    const tail = next?.elements.find((e) => e.type === "group") as GroupElement;
    expect(kit.itemsOf(head.layout as LayoutRef)).toHaveLength(2);
    expect(kit.itemsOf(tail.layout as LayoutRef)).toHaveLength(2);
    expect(tail.layout?.template).toBe("cards-grid");
    expect(tail.layout?.input.heading).toBe("Parts of a plant");
    // Every word kept, in order, across the two slides.
    expect([
      ...kit.itemsOf(head.layout as LayoutRef),
      ...kit.itemsOf(tail.layout as LayoutRef),
    ]).toEqual(cards(4));
    // The teacher's own box stays on the first slide only.
    expect(next?.elements.some((e) => e.id === "mine")).toBe(false);
    expect(() => parseLesson(JSON.parse(JSON.stringify(out.lesson)))).not.toThrow();
  });

  test("too few items to split: refused, Shorten is the way", () => {
    const { lesson, slideId } = seeded(3);
    const out = r.splitLayout(lesson, slideId, "g1", kit);
    expect(out.lesson).toBe(lesson);
    expect(out.refused).toMatch(/shorten/i);
  });
});

describe("undo", () => {
  test("add is one undo step; undo restores the three cards exactly", () => {
    const { lesson: seed, slideId } = seeded(3);
    const KEY = ["library", "documents", "layout"] as const;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(KEY, seed);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(
      () => useDocumentHistory({ queryKey: KEY, queryFn: () => Promise.resolve(seed) }),
      { wrapper },
    );
    act(() => {
      result.current.dispatch(r.addLayoutItem, slideId, "g1", 3, kit);
    });
    expect(named(groupOf(result.current.lesson as Lesson), "Card")).toHaveLength(4);
    act(() => result.current.undo());
    expect(result.current.lesson).toBe(seed);
    act(() => result.current.redo());
    expect(named(groupOf(result.current.lesson as Lesson), "Card")).toHaveLength(4);
  });
});

describe("a template that is not live yet (never throws)", () => {
  const notLive = (): { lesson: Lesson; slideId: string } => {
    const lesson = newLesson("Row");
    const first = lesson.slides[0];
    if (!first) throw new Error("seed");
    const items = ["a", "b", "c", "d"].map((title) => ({ title, text: "words" }));
    first.elements = [
      {
        id: "g1",
        type: "group",
        x: 0,
        y: 0,
        w: 200,
        h: 100,
        layout: { template: "items-row", input: { heading: "Row", items } },
        children: [{ ...teacherBox(), id: "g1:0", x: 0, y: 0 }],
      },
    ];
    return { lesson, slideId: first.id };
  };

  test("edit, add, remove and split refuse and leave the lesson as it was", () => {
    const { lesson, slideId } = notLive();
    const outs = [
      r.editLayoutItem(lesson, slideId, "g1", "items.0.text", "new words", kit),
      r.addLayoutItem(lesson, slideId, "g1", 0, kit),
      r.removeLayoutItem(lesson, slideId, "g1", 0, kit),
      r.splitLayout(lesson, slideId, "g1", kit),
    ];
    for (const out of outs) {
      expect(out.lesson).toBe(lesson);
      expect(out.refused).toBe("This layout cannot be re-arranged yet.");
    }
  });
});

describe("teacher edits inside a layout group", () => {
  test("new words in a bound text write through to the ref; the group stays a layout", () => {
    const { lesson, slideId } = seeded(3);
    const out = r.updateElement(lesson, slideId, "g1:grid.1.text", {
      doc: docFromText("Carries water up the plant."),
    });
    const g = groupOf(out);
    expect(g.layout).toBeDefined();
    expect(kit.getAtPath(g.layout as LayoutRef, "grid.1.text")).toBe("Carries water up the plant.");
    expect(words(g.children.find((c) => c.id === "g1:grid.1.text"))).toContain("Carries water");
  });

  test("a restyle of a child detaches the group: no ref, every element kept as it is", () => {
    const { lesson, slideId } = seeded(3);
    const box = groupOf(lesson).children.find((c) => c.name === "Card") as ShapeElement;
    const out = r.updateElement(lesson, slideId, box.id, { fill: "#00ff00" });
    const g = groupOf(out);
    expect(g.layout).toBeUndefined();
    expect(g.children.find((c) => c.id === box.id)).toEqual({ ...box, fill: "#00ff00" });
    expect(g.children.map((c) => c.id)).toEqual(groupOf(lesson).children.map((c) => c.id));
    // Detached, it is plain elements: item changes are a no-op.
    expect(r.addLayoutItem(out, slideId, "g1", 0, kit).lesson).toBe(out);
  });

  test("deleting a child detaches the group", () => {
    const { lesson, slideId } = seeded(3);
    const out = r.deleteElements(lesson, slideId, ["g1:heading"]);
    expect(groupOf(out).layout).toBeUndefined();
  });

  test("moving the group keeps it a layout; resizing it detaches (it cannot lay into a box)", () => {
    const { lesson, slideId } = seeded(3);
    const moved = r.transformElements(lesson, slideId, ["g1"], { dx: 10 });
    expect(groupOf(moved).layout).toBeDefined();
    const resized = r.transformElements(lesson, slideId, ["g1"], { scale: 0.8 });
    expect(groupOf(resized).layout).toBeUndefined();
  });

  test("detaching is one undo step with the edit", () => {
    const { lesson: seed, slideId } = seeded(3);
    const KEY = ["library", "documents", "detach"] as const;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(KEY, seed);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(
      () => useDocumentHistory({ queryKey: KEY, queryFn: () => Promise.resolve(seed) }),
      { wrapper },
    );
    act(() => {
      result.current.dispatch(r.deleteElements, slideId, ["g1:heading"]);
    });
    expect(groupOf(result.current.lesson as Lesson).layout).toBeUndefined();
    act(() => result.current.undo());
    expect(result.current.lesson).toBe(seed);
  });
});

describe("the slide after a split", () => {
  test("notes stay with the head; the tail group is fresh: own frame, no lock, rotation or link", () => {
    const { lesson: l0, slideId } = seeded(4);
    const withNotes = r.setSlideNotes(l0, slideId, "Ask about roots first.");
    const locked = r.updateElement(withNotes, slideId, "g1", { locked: true, rotation: 3 });
    const out = r.splitLayout(locked, slideId, "g1", kit);
    const [head, tail] = out.lesson.slides;
    expect(head?.notes).toBe("Ask about roots first.");
    expect(tail?.notes).toBeUndefined();
    const g = tail?.elements[0] as GroupElement;
    expect(g.locked).toBeUndefined();
    expect(g.rotation).toBeUndefined();
    expect(g.layout?.frame).toEqual({ x: g.x, y: g.y, w: g.w, h: g.h });
  });
});

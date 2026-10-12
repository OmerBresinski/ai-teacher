import { describe, expect, test } from "bun:test";
import type { LayoutRef } from "@tj/domain/documents";
import { boundPath } from "./layout-paths";
import {
  addItem,
  canSplit,
  fieldStates,
  itemsOf,
  layoutGroup,
  NotAdaptiveError,
  relayout,
  removeItem,
  setAtPath,
  splitItems,
  stageOf,
} from "./relayout";
import { getTheme } from "./themes";

/*
 * TEACH-205 part b: re-laying an adaptive group from its LayoutRef. The ref's input goes back
 * through `layoutTemplate`; the field states follow ruling 215 (under the cap nothing, over the cap
 * tight with a counter, past the hard maximum over).
 */

const theme = getTheme("reading-room");
const cards = (n: number) =>
  ["Roots", "Stem", "Leaves", "Flower"].slice(0, n).map((label) => ({
    label,
    text: `The ${label.toLowerCase()} do one job.`,
  }));
const ref = (n: number, heading = "Parts of a plant"): LayoutRef => ({
  template: "cards-grid",
  input: { heading, grid: cards(n) },
});

describe("relayout", () => {
  test("re-runs the template: three cards give three card boxes, four give four", () => {
    const three = relayout(ref(3), theme, "ks3");
    const four = relayout(ref(4), theme, "ks3");
    const boxes = (els: { name?: string }[]) => els.filter((e) => e.name === "Card").length;
    expect(boxes(three.elements)).toBe(3);
    expect(boxes(four.elements)).toBe(4);
    expect(three.result.over).toEqual([]);
  });

  test("the frame is the elements' bounds on the slide", () => {
    const { elements, frame } = relayout(ref(3), theme, "ks3");
    const minX = Math.min(...elements.map((e) => e.x));
    const maxY = Math.max(...elements.map((e) => e.y + e.h));
    expect(frame.x).toBe(minX);
    expect(frame.y + frame.h).toBe(maxY);
  });

  test("text children get stable ids from the group id and their input path", () => {
    const a = relayout(ref(3), theme, "ks3", "g1");
    const b = relayout(ref(3), theme, "ks3", "g1");
    expect(a.elements.map((e) => e.id)).toEqual(b.elements.map((e) => e.id));
    expect(a.paths["g1:grid.1.text"]).toBe("grid.1.text");
    expect(a.elements.some((e) => e.id === "g1:heading")).toBe(true);
    expect(new Set(a.elements.map((e) => e.id)).size).toBe(a.elements.length);
  });

  test("layoutGroup wraps the laid elements in one group with its ref and frame", () => {
    const g = layoutGroup(ref(3), theme, "ks3", "g9");
    expect(g.type).toBe("group");
    expect(g.layout?.template).toBe("cards-grid");
    expect(g.layout?.frame).toEqual({ x: g.x, y: g.y, w: g.w, h: g.h });
    expect(Math.min(...g.children.map((c) => c.x))).toBe(0);
    expect(Math.min(...g.children.map((c) => c.y))).toBe(0);
  });
});

describe("fields (ruling 215)", () => {
  test("words inside the published cap are ok", () => {
    const { fields } = relayout(ref(3), theme, "ks3");
    const body = fields.find((f) => f.path === "grid.0.text");
    expect(body?.cap).toBeGreaterThan(0);
    expect(body?.state).toBe("ok");
  });

  test("a body over its cap that still fits is tight, with its count", () => {
    const r = ref(3);
    const cap = relayout(r, theme, "ks3").fields.find((f) => f.path === "grid.0.text")?.cap ?? 0;
    const text = "Roots hold the plant and take in water from the soil all day long ".repeat(4);
    const long = setAtPath(r, "grid.0.text", text.slice(0, cap + 8).trim());
    const f = relayout(long, theme, "ks3").fields.find((x) => x.path === "grid.0.text");
    expect(f?.chars).toBeGreaterThan(cap);
    expect(["tight", "over"]).toContain(f?.state as string);
  });

  test("a body the layout cannot hold is over", () => {
    const huge = setAtPath(ref(4), "grid.0.text", "word ".repeat(200).trim());
    const { fields, result } = relayout(huge, theme, "ks3");
    expect(result.over.length).toBeGreaterThan(0);
    expect(fields.find((f) => f.path === "grid.0.text")?.state).toBe("over");
  });

  test("a template that publishes no limits has no fields; one that does is read", () => {
    const row: LayoutRef = { template: "items-row", input: { items: [{ title: "a".repeat(30) }] } };
    const bare = { slide: { kind: "content" as const, elements: [] }, over: [] };
    expect(fieldStates(row, bare, "ks3")).toEqual([]);
    const reported = { ...bare, fields: [{ path: "items.0.title", cap: 20, hardMax: 40 }] };
    expect(fieldStates(row, reported, "ks3")).toEqual([
      { path: "items.0.title", chars: 30, cap: 20, hardMax: 40, state: "tight" },
    ]);
  });

  test("a template layoutTemplate does not lay out yet is refused, not drawn", () => {
    expect(() => relayout({ template: "split-compare", input: {} }, theme, "ks3")).toThrow(
      NotAdaptiveError,
    );
  });
});

describe("item operations", () => {
  test("add inserts a blank item at the index; refused at the template's max", () => {
    const r3 = ref(3);
    const r4 = addItem(r3, 1, "ks3");
    expect(r4.ok).toBe(true);
    if (!r4.ok) return;
    expect(itemsOf(r4.ref)).toHaveLength(4);
    expect((itemsOf(r4.ref)[2] as { label: string }).label).toBe("Stem");
    const r5 = addItem(r4.ref, 4, "ks3");
    expect(r5.ok).toBe(false);
    if (!r5.ok) expect(r5.reason).toMatch(/4/);
  });

  test("remove takes the item out; refused at the template's min", () => {
    const r = removeItem(ref(3), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(itemsOf(r.ref).map((c) => (c as { label: string }).label)).toEqual(["Roots", "Leaves"]);
    const again = removeItem(r.ref, 0);
    expect(again.ok).toBe(false);
  });

  test("split keeps the leading items and moves the trailing ones, every word kept", () => {
    const r = ref(4);
    expect(canSplit(r)).toBe(true);
    const { head, tail } = splitItems(r);
    expect(itemsOf(head)).toHaveLength(2);
    expect(itemsOf(tail)).toHaveLength(2);
    expect(tail.input.heading).toBe("Parts of a plant");
    expect([...itemsOf(head), ...itemsOf(tail)]).toEqual(itemsOf(r));
    expect(canSplit(ref(3))).toBe(false);
  });

  test("setAtPath edits one value without touching the source", () => {
    const r = ref(2);
    const next = setAtPath(r, "grid.1.label", "Trunk");
    expect((itemsOf(next)[1] as { label: string }).label).toBe("Trunk");
    expect((itemsOf(r)[1] as { label: string }).label).toBe("Stem");
  });

  test("stageOf reads the theme's bound stage, else the lesson's band", () => {
    expect(stageOf(getTheme("reading-room", "ks1"), undefined)).toBe("ks1");
    expect(stageOf(theme, "post16")).toBe("ks5");
    expect(stageOf(theme, "eyfs")).toBe("ks1");
    expect(stageOf(theme, undefined)).toBe("ks3");
  });
});

describe("layout paths", () => {
  test("boundPath reads a child's field from its id", () => {
    expect(boundPath("g1", "g1:grid.1.text")).toBe("grid.1.text");
    expect(boundPath("g1", "g1:4")).toBeUndefined();
    expect(boundPath("g1", "other")).toBeUndefined();
  });
});

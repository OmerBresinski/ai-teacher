import { describe, expect, test } from "bun:test";
import { lesson } from "./fixtures.test-helpers";
import { ADAPTIVE_TEMPLATE_IDS, isLayoutGroup, LayoutRefSchema } from "./layout-ref";
import { parseLesson } from "./lesson";
import { type SlideElement, SlideSchema } from "./slide";

/*
 * TEACH-205 part b: a laid-out adaptive layout keeps its template and input on its group (the
 * FigureRef pattern, ADR 0032 amendment), so the editor can re-lay it when an item changes.
 */

const group = (template: string) => ({
  id: "g",
  type: "group",
  x: 0,
  y: 0,
  w: 960,
  h: 540,
  name: "Cards grid",
  layout: {
    template,
    input: { heading: "Plants", grid: [{ label: "Roots", text: "Hold the plant." }] },
    frame: { x: 0, y: 0, w: 960, h: 540 },
  },
  children: [{ id: "c", type: "shape", shape: "rect", x: 40, y: 40, w: 400, h: 60 }],
});

const withGroup = (template: string) => ({
  ...lesson(),
  slides: [{ id: "s", kind: "content", elements: [group(template)] }],
});

describe("LayoutRef (TEACH-205 part b)", () => {
  test("a group carrying a layout ref round-trips at version 1", () => {
    const input = withGroup("cards-grid");
    const parsed = parseLesson(JSON.parse(JSON.stringify(input)));
    expect(parsed).toEqual(input as never);
    expect(parsed.version).toBe(1);
    const g = parsed.slides[0]?.elements[0];
    expect(g?.type === "group" && g.layout?.template).toBe("cards-grid");
  });

  test("an unknown adaptive template is rejected at its path", () => {
    const result = SlideSchema.safeParse(withGroup("pie-chart").slides[0]);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual([
      "elements",
      0,
      "layout",
      "template",
    ]);
  });

  test("the pilot layouts are named so they plug in without a schema change", () => {
    expect([...ADAPTIVE_TEMPLATE_IDS]).toEqual([
      "cards-grid",
      "items-row",
      "panel-list",
      "split-compare",
      // TEACH-230 part b (B2).
      "practice",
      "exit-ticket",
      "hinge",
      // TEACH-17 part b (C1).
      "worked",
      "stages",
      // TEACH-75 part ab (C2).
      "source",
    ]);
    expect(LayoutRefSchema.safeParse({ template: "items-row", input: {} }).success).toBe(true);
  });

  test("an old lesson and a plain group parse unchanged, with no layout", () => {
    const old = lesson();
    expect(parseLesson(JSON.parse(JSON.stringify(old)))).toEqual(old);
    const { layout: _dropped, ...plain } = group("cards-grid");
    const parsed = SlideSchema.parse({ id: "s", kind: "content", elements: [plain] });
    const el = parsed.elements[0] as SlideElement;
    expect(el.type === "group" && el.layout).toBeUndefined();
    expect(isLayoutGroup(el)).toBe(false);
  });

  test("isLayoutGroup is true only for a group with a ref", () => {
    const parsed = SlideSchema.parse(withGroup("cards-grid").slides[0]);
    expect(isLayoutGroup(parsed.elements[0] as SlideElement)).toBe(true);
  });

  test("an old lesson parses to the same document and re-serialises byte for byte", () => {
    // Zod writes keys in schema order (true before this change too), so byte identity is checked
    // on the stored form: a lesson saved once re-serialises to exactly the same bytes, no `layout`.
    const input = lesson();
    const stored = JSON.stringify(parseLesson(JSON.parse(JSON.stringify(input))));
    expect(JSON.parse(stored)).toEqual(input as never);
    expect(JSON.stringify(parseLesson(JSON.parse(stored)))).toBe(stored);
    expect(stored).not.toContain('"layout"');
  });
});

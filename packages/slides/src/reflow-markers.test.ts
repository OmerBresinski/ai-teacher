import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement } from "@tj/domain/documents";
import { docFromText } from "./factories";
import { type Measurer, reflowSlide } from "./reflow";
import { getTheme } from "./themes";

/*
 * A numbered or bulleted row is two elements: a marker shape in its own narrow column and the
 * item's text beside it. When an item above grows, the push-down moves the items under it (they
 * share its column); the markers share no column with any item, so nothing pushed them and they
 * stayed where the layout put them, a line or more above their text (layout-07: the d52 T5 Y5
 * objectives slide re-fitted on open drew numbers 2 and 3 on their own lines).
 */

const theme = getTheme("splash");
const LINE = 41;

function item(id: string, y: number, h: number, text: string): SlideElement {
  return {
    id,
    type: "text",
    name: "Item",
    x: 120,
    y,
    w: 664,
    h,
    doc: docFromText(text),
    style: { preset: "body", autoHeight: true, fontSize: 29, lineHeight: 1.4, padding: 0 },
    authoredBy: "ai",
  } as SlideElement;
}

function marker(id: string, y: number, n: number): SlideElement {
  return {
    id,
    type: "shape",
    shape: "ellipse",
    name: "Marker",
    x: 64,
    y,
    w: 36,
    h: 36,
    fill: "#0A5CA2",
    doc: docFromText(String(n)),
    textStyle: { preset: "body", fontSize: 25, align: "center", valign: "middle", padding: 0 },
    authoredBy: "ai",
  } as SlideElement;
}

/** Two lines for any item whose text says "long", one otherwise. */
const measure: Measurer = (input) => {
  const text = JSON.stringify(input.doc);
  return text.includes("long") ? LINE * 2 : LINE;
};

const slide = (elements: SlideElement[]): Slide =>
  ({ id: "s", kind: "objectives", elements }) as Slide;

describe("a list marker moves with the text beside it", () => {
  test("an item above grows: every marker keeps its offset from its own item", () => {
    const laid = slide([
      marker("m1", 184, 1),
      item("i1", 182, LINE, "a long first objective that now wraps"),
      marker("m2", 245, 2),
      item("i2", 243, 82, "second"),
      marker("m3", 347, 3),
      item("i3", 345, 82, "third"),
    ]);
    const out = reflowSlide(laid, theme, measure).elements;
    const at = (id: string) => out.find((e) => e.id === id) as SlideElement;
    // The first item grew, so the second was pushed down (the precondition of the defect).
    expect(at("i2").y).toBeGreaterThan(243);
    for (const [m, i] of [
      ["m1", "i1"],
      ["m2", "i2"],
      ["m3", "i3"],
    ] as const) {
      expect(at(m).y - at(i).y).toBe(2);
    }
  });

  test("a settled list is left exactly where it is", () => {
    const laid = slide([
      marker("m1", 184, 1),
      item("i1", 182, LINE, "first"),
      marker("m2", 245, 2),
      item("i2", 243, LINE, "second"),
    ]);
    const out = reflowSlide(laid, theme, measure);
    expect(out.moved).toEqual([]);
  });
});

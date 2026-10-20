import { describe, expect, test } from "bun:test";
import type { ShapeElement } from "@tj/domain/documents";
import { docFromText } from "@tj/slides";
import { getTheme } from "@tj/slides/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideView } from "../SlideView";

/*
 * Glyph centring (`badgeGlyph`): only a badge (a small, near-square shape with a one-to-three
 * character label) is re-centred, and its label always sits in one wrapper element, so a label
 * that grows past three characters changes a class, never the tree.
 */
const shape = (text: string, w: number, h: number): ShapeElement =>
  ({
    id: "b",
    type: "shape",
    shape: "ellipse",
    x: 100,
    y: 100,
    w,
    h,
    doc: docFromText(text),
  }) as ShapeElement;

const html = (el: ShapeElement) =>
  renderToStaticMarkup(
    <SlideView
      slide={{ id: "s", kind: "content", elements: [el] } as never}
      theme={getTheme("paper")}
      mode="view"
    />,
  );

/** The tag path from the element's frame down to its paragraph. */
const pathToText = (markup: string) => {
  const at = markup.indexOf('data-element-id="b"');
  const inner = markup.slice(at, markup.indexOf("<p", at));
  return [...inner.matchAll(/<(div|span|svg)\b/g)].map((m) => m[1]).join(">");
};

describe("badge glyphs in shape labels", () => {
  test("a badge's numeral is re-centred; a teacher's own short-label box is not", () => {
    expect(html(shape("1", 28, 28))).toContain("tj-badge-glyph");
    expect(html(shape("42", 28, 28))).toContain("tj-badge-glyph");
    expect(html(shape("OK", 160, 80))).not.toContain("tj-badge-glyph");
    expect(html(shape("42", 200, 200))).not.toContain("tj-badge-glyph");
  });

  test("typing 1, 12, 123, 1234 and back keeps the same tree: only the class changes", () => {
    const paths = ["1", "12", "123", "1234", "123", "1"].map((t) =>
      pathToText(html(shape(t, 40, 40))),
    );
    expect(new Set(paths).size).toBe(1);
    expect(html(shape("1234", 40, 40))).not.toContain("tj-badge-glyph");
  });
});

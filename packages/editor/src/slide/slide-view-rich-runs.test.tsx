import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ImageElement, Slide, TextElement } from "@tj/domain/documents";
import { svgOfDataUrl } from "@tj/slides/diagram-builds";
import { getTheme } from "../model/themes";
import { strikesAt } from "./elements/RichText";
import { SlideView } from "./SlideView";

/* TEACH-205 part c: run attributes and builds on rows in the slide renderer (Present and editor). */

const theme = getTheme("paper");
const claim: TextElement = {
  id: "claim",
  type: "text",
  x: 60,
  y: 60,
  w: 400,
  h: 120,
  style: { preset: "body" },
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "x", marks: [{ type: "textStyle", attrs: { font: "quote" } }] },
          { type: "text", text: " is ", marks: [{ type: "textStyle", attrs: { highlight: 3 } }] },
          {
            type: "text",
            text: "Bats are blind",
            marks: [{ type: "textStyle", attrs: { strikeStep: 2 } }],
          },
        ],
      },
    ],
  },
};
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-s="1"/><g data-s="2"/><g data-s="3"/></svg>';
const diagram: ImageElement = {
  id: "d",
  type: "image",
  x: 520,
  y: 60,
  w: 300,
  h: 200,
  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  fit: "contain",
  builds: 3,
  buildFrom: 1,
};
const row = (n: number): TextElement => ({
  ...claim,
  id: `row${n}`,
  y: 200 + n * 40,
  h: 36,
  revealStep: n,
  doc: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: `Row ${n}` }] }],
  },
});
const slide: Slide = {
  id: "s",
  kind: "content",
  elements: [claim, diagram, row(1), row(2), row(3)],
} as Slide;

const at = (mode: "present" | "edit", step: number) => {
  const { container } = render(<SlideView slide={slide} theme={theme} mode={mode} step={step} />);
  const strike = container.querySelector("[data-strike]");
  const img = container.querySelector(`[data-element-id="d"] img`) as HTMLImageElement | null;
  return { container, strike, src: svgOfDataUrl(img?.getAttribute("src") ?? "") ?? "" };
};

describe("rich runs on the slide", () => {
  test("quote, highlight and strike reach the markup; the root names the quote face", () => {
    const { container } = at("present", 2);
    expect(container.querySelector('[data-font="quote"]')?.textContent).toBe("x");
    expect(container.querySelector('[data-hl="3"]')?.textContent).toBe(" is ");
    const root = container.querySelector("[data-slide-root]") as HTMLElement;
    expect(root.style.getPropertyValue("--td-font-quote")).toContain("source-serif");
    expect(root.style.getPropertyValue("--td-quote-style")).toBe("italic");
  });

  test("the myth strike is absent at step 1 and present at step 2 (row 5)", () => {
    expect(at("present", 1).strike?.hasAttribute("data-strike-hidden")).toBe(true);
    expect(at("present", 2).strike?.hasAttribute("data-strike-hidden")).toBe(false);
  });

  test("strikesAt only touches attributes, never text", () => {
    const html = '<p><span data-strike="2">a</span> data-strike="2"</p>';
    expect(strikesAt(html, 1)).toBe(
      '<p><span data-strike="2" data-strike-hidden="">a</span> data-strike="2"</p>',
    );
    expect(strikesAt(html, 2)).toBe(html);
    expect(strikesAt(html, undefined)).toBe(html);
  });
});

describe("a drawn diagram's builds ride rows (row 2)", () => {
  for (const mode of ["present", "edit"] as const) {
    test(`${mode}: build i shows with row i`, () => {
      // Build k hides parts k+1.. with a style inside the drawing.
      expect(at(mode, 1).src).toContain('[data-s="2"],[data-s="3"]{opacity:0}');
      expect(at(mode, 2).src).toContain('[data-s="3"]{opacity:0}');
      expect(at(mode, 2).src).not.toContain('[data-s="2"],');
      expect(at(mode, 3).src).not.toContain("{opacity:0}");
    });
  }
});

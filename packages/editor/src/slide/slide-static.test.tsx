import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { Slide, SlideElement, SlideKind } from "@tj/domain/documents";
import { docFromText, newSlide, uid } from "../model/factories";
import { getTheme } from "../model/themes";
import { SlideStatic } from "./SlideStatic";
import { SlideView } from "./SlideView";

const theme = getTheme("chalk");

function element(extra: Partial<SlideElement> & { type: SlideElement["type"] }): SlideElement {
  return { id: uid(), x: 60, y: 60, w: 300, h: 100, ...extra } as SlideElement;
}

describe("SlideStatic", () => {
  test("scales the 960x540 slide to the width given and renders every element", () => {
    const slide = newSlide("title", "chalk");
    const { container } = render(<SlideStatic slide={slide} theme={theme} width={240} />);
    const root = container.querySelector("[data-slide-static]") as HTMLElement;
    expect(root.style.width).toBe("240px");
    expect(root.style.height).toBe("135px");
    const scaled = root.firstElementChild as HTMLElement;
    expect(scaled.style.transform).toBe("scale(0.25)");
    const slideRoot = container.querySelector("[data-slide-root]") as HTMLElement;
    expect(slideRoot.dataset.slideMode).toBe("thumb");
    expect(slideRoot.classList.contains("no-anim")).toBe(true);
    expect(container.querySelectorAll("[data-element-id]")).toHaveLength(slide.elements.length);
  });

  test("an image element renders an <img> with its src and alt", () => {
    const src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const slide: Slide = {
      id: "s",
      kind: "image-text",
      elements: [element({ type: "image", src, alt: "A dot", fit: "cover" })],
    };
    const { container } = render(<SlideStatic slide={slide} theme={theme} width={480} />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(src);
    expect(img.getAttribute("alt")).toBe("A dot");
  });

  test("renders every element type without throwing", () => {
    const doc = docFromText("Text");
    const child = element({ type: "shape", shape: "rect" });
    const elements: SlideElement[] = [
      element({ type: "text", doc, style: { preset: "body" } }),
      element({ type: "image", src: "x.png", fit: "contain" }),
      element({ type: "shape", shape: "ellipse", fill: "#fff", doc }),
      element({ type: "line", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, arrowEnd: true }),
      element({ type: "icon", icon: "lightbulb" }),
      element({
        type: "table",
        rows: [
          ["a", "b"],
          ["c", "d"],
        ],
        header: true,
      }),
      element({ type: "embed", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
      element({ type: "option", doc, label: "A" }),
      element({
        type: "gap-text",
        doc: docFromText("The [[gap:g1]] falls."),
        style: { preset: "body" },
      }),
      element({ type: "timer", seconds: 90 }),
      element({ type: "group", children: [child] }),
    ];
    const slide: Slide = {
      id: "all",
      kind: "content",
      elements,
      question: { type: "fill-gap", gaps: [{ id: "g1", answer: "rain" }] },
    };
    const { container } = render(<SlideView slide={slide} theme={theme} mode="view" />);
    expect(container.querySelectorAll("[data-element-id]").length).toBeGreaterThanOrEqual(
      elements.length,
    );
  });

  test("every slide kind renders in view mode with its answer revealed", () => {
    const kinds: SlideKind[] = [
      "true-false",
      "multiple-choice",
      "matching",
      "image-match",
      "fill-gap",
      "sort",
      "open-response",
    ];
    for (const kind of kinds) {
      const slide = newSlide(kind, "playground");
      expect(() =>
        render(
          <SlideView slide={slide} theme={getTheme("playground")} mode="present" revealAnswer />,
        ),
      ).not.toThrow();
    }
  });

  test("reveal steps hide later elements in view mode", () => {
    const slide: Slide = {
      id: "steps",
      kind: "content",
      elements: [
        element({ type: "text", doc: docFromText("first"), style: { preset: "body" } }),
        element({
          type: "text",
          doc: docFromText("second"),
          style: { preset: "body" },
          revealStep: 1,
        }),
      ],
    };
    const { container } = render(<SlideView slide={slide} theme={theme} mode="view" step={0} />);
    const frames = container.querySelectorAll("[data-element-id]");
    expect(frames).toHaveLength(2);
    // The second element is beyond the step: in the DOM, hidden and out of the a11y tree.
    expect((frames[0] as HTMLElement).style.visibility).not.toBe("hidden");
    expect((frames[1] as HTMLElement).style.visibility).toBe("hidden");
    expect(frames[1]?.getAttribute("aria-hidden")).toBe("true");
  });
});

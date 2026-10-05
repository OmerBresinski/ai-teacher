import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ImageElement } from "@tj/domain/documents";
import {
  DIAGRAM_DRAWN_NAME,
  diagramElement,
  svgFontFamily as family,
  svgDataUrl,
} from "@tj/slides/diagrams";
import { THEMES } from "@tj/slides/themes";
import { getTheme } from "../../model/themes";
import { ImageView } from "./ImageView";

/* TEACH-153: a crop implies Fill, so the bitmap is never letterboxed under a window. */

afterEach(cleanup);

const theme = getTheme("chalk");
const base: ImageElement = {
  id: "i1",
  type: "image",
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  src: "data:,",
  fit: "contain",
};

const imgOf = (element: ImageElement) => {
  const { container } = render(
    <ImageView
      element={element}
      theme={theme}
      mode="edit"
      slideId="s1"
      hidden={false}
      ghost={false}
      revealAnswer={false}
    />,
  );
  const img = container.querySelector("img");
  if (!img) throw new Error("no img");
  return img;
};

describe("ImageView", () => {
  test("Fit without adjustments renders contain", () => {
    expect(imgOf(base).style.objectFit).toBe("contain");
  });

  test("a crop, focal point or transform renders cover whatever `fit` says", () => {
    expect(imgOf({ ...base, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }).style.objectFit).toBe(
      "cover",
    );
    expect(imgOf({ ...base, focal: { x: 0.2, y: 0.8 } }).style.objectFit).toBe("cover");
    expect(imgOf({ ...base, imageTransform: { rotate: 90 } }).style.objectFit).toBe("cover");
  });
});

/* lab/cand: a drawn diagram renders inline, so the page's theme fonts reach its text (an SVG
   inside <img> cannot load a web font and falls back to a generic sans), and it sits on the
   slide's own ground, not on a surface-coloured box. */
const viewOf = (element: ImageElement, t = theme) =>
  render(
    <ImageView
      element={element}
      theme={t}
      mode="present"
      slideId="s1"
      hidden={false}
      ghost={false}
      revealAnswer={false}
    />,
  ).container;

describe("ImageView: a drawn diagram", () => {
  const spec = {
    kind: "flow",
    alt: "A chick grows into a hen.",
    layout: "chain",
    steps: [{ label: "Chick", arrow: "grows" }, { label: "Young chicken" }, { label: "Hen" }],
  };
  for (const t of THEMES) {
    test(`renders inline in the theme's body font on its own ground (${t.id})`, () => {
      const el = diagramElement(spec, t, { x: 0, y: 0, w: 600, h: 300 });
      if (!el) throw new Error("no diagram");
      const c = viewOf(el, t);
      expect(c.querySelector("img")).toBeNull();
      const svg = c.querySelector("svg");
      expect(svg).not.toBeNull();
      const fam = svg?.querySelector("text")?.getAttribute("font-family") ?? "";
      expect(fam.startsWith(family(t.fonts.body).split(",")[0] as string)).toBe(true);
      const box = c.firstElementChild as HTMLElement;
      expect(box.style.background).toBe("transparent");
    });
  }

  test("drops scripts and event handlers from the inlined drawing", () => {
    const bad =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><text x="1" y="5" onclick="alert(3)">hi</text></svg>';
    const c = viewOf({ ...base, name: DIAGRAM_DRAWN_NAME, src: svgDataUrl(bad) });
    expect(c.querySelector("script")).toBeNull();
    expect(c.innerHTML).not.toContain("alert");
    expect(c.querySelector("text")?.textContent).toBe("hi");
  });

  test("a photo keeps its <img> on the surface colour", () => {
    const c = viewOf({ ...base, src: "https://example.test/a.jpg" });
    expect(c.querySelector("img")).not.toBeNull();
    expect((c.firstElementChild as HTMLElement).style.background).not.toBe("transparent");
  });
});

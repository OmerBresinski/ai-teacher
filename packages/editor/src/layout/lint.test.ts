import { describe, expect, test } from "bun:test";
import {
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type SlideKind,
  type TextElement,
} from "@tj/domain/documents";
import { demoLessonSlides } from "@tj/slides";
import { docFromText } from "../model/factories";
import { LAYOUT_CATALOGUE, layoutSlide, variantsFor } from "../model/layouts";
import { THEMES } from "../model/themes";
import { findOverflow, findOverlaps, isBleed, isOffSlide, lintSlide } from "./lint";
import type { MeasureInput } from "./reflow";
import { rulerFor } from "./test-ruler";

/* TeachDeck `lib/__tests__/layout-lint.test.ts` (22 cases). */

const slideOf = (elements: SlideElement[]): Slide => ({ id: "sl", kind: "content", elements });

function textEl(
  id: string,
  box: { x: number; y: number; w: number; h: number },
  autoHeight = true,
): TextElement {
  return {
    id,
    type: "text",
    ...box,
    doc: docFromText("Some words on the slide"),
    style: { preset: "body", autoHeight },
  };
}

describe("findOverlaps", () => {
  test("finds two text boxes that intersect", () => {
    const slide = slideOf([
      textEl("a", { x: 58, y: 43, w: 400, h: 100 }),
      textEl("b", { x: 58, y: 100, w: 400, h: 100 }),
    ]);
    expect(findOverlaps(slide)).toEqual([["a", "b"]]);
  });

  test("ignores boxes that merely touch", () => {
    const slide = slideOf([
      textEl("a", { x: 58, y: 43, w: 400, h: 100 }),
      textEl("b", { x: 58, y: 143, w: 400, h: 100 }),
    ]);
    expect(findOverlaps(slide)).toEqual([]);
  });

  test("ignores a hairline rule drawn through the layout", () => {
    const rule: SlideElement = {
      id: "rule",
      type: "shape",
      shape: "rect",
      x: 58,
      y: 120,
      w: 844,
      h: 1,
    };
    const body = textEl("body", { x: 58, y: 100, w: 400, h: 100 });
    expect(findOverlaps(slideOf([rule, body]))).toEqual([]);
  });

  test("ignores a line element", () => {
    const line: SlideElement = {
      id: "line",
      type: "line",
      x: 58,
      y: 100,
      w: 400,
      h: 80,
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    };
    const body = textEl("body", { x: 58, y: 100, w: 400, h: 100 });
    expect(findOverlaps(slideOf([line, body]))).toEqual([]);
  });

  test("ignores a full-bleed backdrop image and shape", () => {
    const img: SlideElement = {
      id: "bg",
      type: "image",
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
      src: "x",
      fit: "cover",
    };
    const wash: SlideElement = {
      id: "wash",
      type: "shape",
      shape: "rect",
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H * 0.9,
    };
    const body = textEl("body", { x: 58, y: 100, w: 400, h: 100 });
    expect(findOverlaps(slideOf([img, wash, body]))).toEqual([]);
  });

  test("ignores deliberate layering: a label wholly inside a card", () => {
    const card: SlideElement = {
      id: "card",
      type: "shape",
      shape: "rounded",
      x: 58,
      y: 100,
      w: 400,
      h: 200,
    };
    const label = textEl("label", { x: 78, y: 120, w: 360, h: 60 });
    expect(findOverlaps(slideOf([card, label]))).toEqual([]);
  });

  test("still flags a label that hangs off the edge of its card", () => {
    const card: SlideElement = {
      id: "card",
      type: "shape",
      shape: "rounded",
      x: 58,
      y: 100,
      w: 400,
      h: 200,
    };
    const label = textEl("label", { x: 78, y: 280, w: 360, h: 60 });
    expect(findOverlaps(slideOf([card, label]))).toEqual([["card", "label"]]);
  });

  test("skips rotated elements, whose rect is not their footprint", () => {
    const a = { ...textEl("a", { x: 58, y: 43, w: 400, h: 100 }), rotation: 30 };
    const b = textEl("b", { x: 58, y: 100, w: 400, h: 100 });
    expect(findOverlaps(slideOf([a, b]))).toEqual([]);
  });
});

describe("findOverflow", () => {
  const tall = (_: MeasureInput) => 500;
  test("flags a fixed-height box whose content does not fit", () => {
    expect(
      findOverflow(slideOf([textEl("a", { x: 58, y: 43, w: 400, h: 100 }, false)]), tall),
    ).toEqual(["a"]);
  });
  test("leaves an auto-height box alone: the engine will grow it", () => {
    expect(
      findOverflow(slideOf([textEl("a", { x: 58, y: 43, w: 400, h: 100 }, true)]), tall),
    ).toEqual([]);
  });
  test("flags a box pushed off the printable slide", () => {
    expect(findOverflow(slideOf([textEl("a", { x: 58, y: 500, w: 400, h: 100 })]))).toEqual(["a"]);
  });
  test("does not flag a full-bleed backdrop for crossing the trim", () => {
    const img: SlideElement = {
      id: "bg",
      type: "image",
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
      src: "x",
      fit: "cover",
    };
    expect(findOverflow(slideOf([img]))).toEqual([]);
  });
  test("reports nothing without a measurer beyond the geometric checks", () => {
    expect(findOverflow(slideOf([textEl("a", { x: 58, y: 43, w: 400, h: 10 }, false)]))).toEqual(
      [],
    );
  });
});

describe("lintSlide", () => {
  test("is ok on a clean slide", () => {
    const slide = slideOf([
      textEl("a", { x: 58, y: 43, w: 844, h: 60 }),
      { id: "rule", type: "shape", shape: "rect", x: 58, y: 112, w: 844, h: 1 },
      textEl("b", { x: 58, y: 140, w: 844, h: 200 }),
    ]);
    expect(lintSlide(slide).ok).toBe(true);
  });
  test("is not ok when two blocks collide", () => {
    const slide = slideOf([
      textEl("a", { x: 58, y: 43, w: 844, h: 200 }),
      textEl("b", { x: 58, y: 140, w: 844, h: 200 }),
    ]);
    const result = lintSlide(slide);
    expect(result.ok).toBe(false);
    expect(result.overlaps).toEqual([["a", "b"]]);
  });
});

describe("isBleed", () => {
  const image = (box: { x: number; y: number; w: number; h: number }): SlideElement => ({
    id: "img",
    type: "image",
    ...box,
    src: "x",
    fit: "cover",
  });
  test("is the image-text recipe's half-bleed picture", () => {
    expect(isBleed(image({ x: 0, y: 0, w: 422, h: SLIDE_H }))).toBe(true);
  });
  test("is a picture flush with any one edge", () => {
    expect(isBleed(image({ x: 600, y: 100, w: SLIDE_W - 600, h: 200 }))).toBe(true);
    expect(isBleed(image({ x: 100, y: 0, w: 200, h: 200 }))).toBe(true);
  });
  test("is not a picture that sits inside the slide with room all round", () => {
    expect(isBleed(image({ x: 100, y: 100, w: 200, h: 200 }))).toBe(false);
  });
  test("is not a picture that has been pushed off the slide", () => {
    expect(isBleed(image({ x: 100, y: 400, w: 200, h: 200 }))).toBe(false);
  });
  test("is any element flush with an edge and inside the slide: a band under a title bleeds too", () => {
    const band: SlideElement = {
      id: "s",
      type: "shape",
      shape: "rect",
      x: 0,
      y: 340,
      w: SLIDE_W,
      h: SLIDE_H - 340,
    };
    expect(isBleed(band)).toBe(true);
    expect(isOffSlide(band)).toBe(true);
    expect(findOverflow(slideOf([band]))).toEqual([]);
    // Pushed past the trim without reaching an edge is still overflow, shape or text alike.
    const pushed: SlideElement = { ...band, x: 100, y: 400, w: 200, h: 200 };
    expect(isBleed(pushed)).toBe(false);
    expect(findOverflow(slideOf([pushed]))).toEqual(["s"]);
  });
  test("leaves the image-text recipe clean, so a fresh slide carries no warning dot", () => {
    const { elements } = layoutSlide("image-text", "chalk");
    const slide: Slide = { id: "it", kind: "image-text", elements };
    expect(findOverflow(slide)).toEqual([]);
    expect(lintSlide(slide).ok).toBe(true);
  });
  test("leaves every catalogue variant on every theme clean (TEACH-214)", () => {
    for (const theme of THEMES) {
      for (const kind of Object.keys(LAYOUT_CATALOGUE) as SlideKind[]) {
        for (const variant of variantsFor(kind)) {
          const { elements } = layoutSlide(kind, theme.id, variant);
          const slide: Slide = { id: `${kind}-${variant}`, kind, elements };
          const lint = lintSlide(slide, undefined, theme);
          expect(lint, `${kind}/${variant} on ${theme.id}`).toMatchObject({
            overlaps: [],
            overflow: [],
            laneOverflow: [],
            ok: true,
          });
        }
      }
    }
  });
  test("leaves the ten-slide fixture lesson clean under the ruler on two themes (TEACH-214)", () => {
    for (const themeId of ["chalk", "playground"] as const) {
      const theme = THEMES.find((t) => t.id === themeId);
      if (!theme) throw new Error(themeId);
      const { slides, variants } = demoLessonSlides(themeId, {
        personality: themeId === "playground" ? "playful" : undefined,
        titleImage: themeId === "playground",
      });
      slides.forEach((slide, i) => {
        const lint = lintSlide(slide, rulerFor(theme), theme);
        expect(lint, `${themeId} slide ${i + 1} ${slide.kind}/${variants[i]}`).toMatchObject({
          overlaps: [],
          overflow: [],
          laneOverflow: [],
          ok: true,
        });
      });
    }
  });
  test("still reports a picture pushed off the bottom of the slide", () => {
    expect(findOverflow(slideOf([image({ x: 100, y: 400, w: 200, h: 200 })]))).toEqual(["img"]);
  });
});

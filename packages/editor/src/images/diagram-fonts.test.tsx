import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { ImageElement, Lesson, SlideElement } from "@tj/domain/documents";
import { builtSvgDataUrl, svgOfDataUrl } from "@tj/slides/diagram-builds";
import { exportLessonPptx } from "../export/pptx";
import { demoLibrary } from "../model/starter";
import { getTheme } from "../model/themes";
import { ImageView } from "../slide/elements/ImageView";
import {
  diagramFontsNow,
  diagramFontsSettled,
  type FontSource,
  setDiagramFontSource,
  withDiagramFonts,
} from "./diagram-fonts";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text font-family="'Nunito Variable', Verdana, sans-serif">Marching 112</text></svg>`;
const SRC = builtSvgDataUrl(SVG);
const LATIN = "U+0000-00FF";

/** A page that loads Nunito (latin and cyrillic subsets) and Lexend; counts the fetches. */
function fakeSource(): FontSource & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    rules: () => [
      { family: "Nunito Variable", weight: "200 1000", unicodeRange: LATIN, url: "/n-latin.woff2" },
      { family: "Nunito Variable", unicodeRange: "U+0400-045F", url: "/n-cyr.woff2" },
      { family: "Lexend Variable", unicodeRange: LATIN, url: "/lexend.woff2" },
    ],
    fetchBase64: async (url) => {
      fetched.push(url);
      return btoa(url);
    },
  };
}

afterEach(() => {
  cleanup();
  setDiagramFontSource(undefined);
});

describe("withDiagramFonts", () => {
  test("embeds the page's face for the family the drawing names, fetched once", async () => {
    const source = fakeSource();
    setDiagramFontSource(source);
    const out = await withDiagramFonts(SRC);
    const svg = svgOfDataUrl(out) ?? "";
    expect(svg).toContain(`font-family:"Nunito Variable"`);
    expect(svg).toContain(`base64,${btoa("/n-latin.woff2")}`);
    expect(svg).not.toContain("Lexend");
    // Only the subset its words use: no cyrillic file for "Marching 112".
    expect(source.fetched).toEqual(["/n-latin.woff2"]);
    await withDiagramFonts(builtSvgDataUrl(SVG.replace("112", "113")));
    expect(source.fetched.length).toBe(1);
    // Once loaded, the fonted source is there synchronously (no flash between Present builds).
    expect(diagramFontsNow(SRC)).toBe(out);
  });

  test("leaves anything that is not a drawn SVG alone", async () => {
    setDiagramFontSource(fakeSource());
    expect(await withDiagramFonts("/files/abc.png")).toBe("/files/abc.png");
    expect(diagramFontsNow("/files/abc.png")).toBe("/files/abc.png");
  });

  test("a failed fetch leaves the drawing as it was, and never throws", async () => {
    setDiagramFontSource({
      rules: fakeSource().rules,
      fetchBase64: async () => {
        throw new Error("offline");
      },
    });
    expect(await withDiagramFonts(SRC)).toBe(SRC);
  });
});

describe("ImageView sets a drawn diagram's words in its own face", () => {
  const element: ImageElement = {
    id: "d1",
    type: "image",
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    src: SRC,
    fit: "contain",
  };

  for (const mode of ["edit", "present", "thumb", "capture"] as const)
    test(`in ${mode}`, async () => {
      setDiagramFontSource(fakeSource());
      const { container } = render(
        <ImageView
          element={element}
          theme={getTheme("splash")}
          mode={mode}
          slideId="s1"
          hidden={false}
          ghost={false}
          revealAnswer={false}
        />,
      );
      await act(async () => {
        await diagramFontsSettled();
      });
      const src = container.querySelector("img")?.getAttribute("src") ?? "";
      expect(svgOfDataUrl(src)).toContain("@font-face");
    });
});

test("PPTX draws a diagram from its fonted source", async () => {
  setDiagramFontSource(fakeSource());
  const [water] = demoLibrary();
  const first = water?.slides[0];
  if (!water || !first) throw new Error("fixture");
  const diagram = {
    ...({} as ImageElement),
    id: "d1",
    type: "image",
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    src: SRC,
    alt: "Marching",
    fit: "contain",
  } as SlideElement;
  const lesson: Lesson = { ...water, slides: [{ ...first, elements: [diagram] }] };
  const asked: string[] = [];
  await exportLessonPptx(lesson, getTheme("splash"), {
    rasteriseSvg: async (s) => {
      asked.push(s);
      return undefined;
    },
    onWarning: () => {},
  });
  expect(asked.length).toBe(1);
  expect(svgOfDataUrl(asked[0] ?? "")).toContain(`@font-face{font-family:"Nunito Variable"`);
}, 30_000);

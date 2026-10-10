import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { ImageElement, Lesson, SlideElement } from "@tj/domain/documents";
import { builtSvgDataUrl, svgOfDataUrl } from "@tj/slides/diagram-builds";
import { exportLessonPptx } from "../export/pptx";
import { demoLibrary } from "../model/starter";
import { getTheme } from "../model/themes";
import { ImageView } from "../slide/elements/ImageView";
import {
  diagramFontsNow,
  diagramImagesReady,
  type FontSource,
  prepareDiagramFonts,
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
  setSystemTime();
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

  test("a failed fetch leaves the drawing as it was, never throws, and is retried after a pause", async () => {
    let calls = 0;
    let offline = true;
    setDiagramFontSource({
      rules: fakeSource().rules,
      fetchBase64: async (url) => {
        calls += 1;
        if (offline) throw new Error("offline");
        return btoa(url);
      },
    });
    setSystemTime(new Date("2026-10-10T12:00:00Z"));
    expect(await withDiagramFonts(SRC)).toBe(SRC);
    // Inside the back-off: settled on the fallback, no second fetch.
    expect(diagramFontsNow(SRC)).toBe(SRC);
    expect(await withDiagramFonts(SRC)).toBe(SRC);
    expect(calls).toBe(1);
    offline = false;
    setSystemTime(new Date("2026-10-10T12:00:06Z"));
    expect(svgOfDataUrl(await withDiagramFonts(SRC))).toContain("@font-face");
    expect(calls).toBe(2);
  });
});

describe("capture before anything mounts", () => {
  test("prepareDiagramFonts fetches what the slides need, so the first render is fonted", async () => {
    const source = fakeSource();
    setDiagramFontSource(source);
    const group = { type: "group", children: [{ type: "image", src: SRC }] };
    await prepareDiagramFonts([{ elements: [group] }]);
    expect(source.fetched).toEqual(["/n-latin.woff2"]);
    const { container } = render(
      <ImageView
        element={{ id: "d1", type: "image", x: 0, y: 0, w: 200, h: 100, src: SRC, fit: "contain" }}
        theme={getTheme("splash")}
        mode="capture"
        slideId="s1"
        hidden={false}
        ghost={false}
        revealAnswer={false}
      />,
    );
    // No act, no wait: the very first commit already carries the theme face.
    expect(svgOfDataUrl(container.querySelector("img")?.getAttribute("src") ?? "")).toContain(
      `font-family:"Nunito Variable"`,
    );
  });

  test("diagramImagesReady starts the fetches itself from the DOM", async () => {
    const source = fakeSource();
    setDiagramFontSource(source);
    const root = document.createElement("div");
    root.innerHTML = `<img src="${SRC}">`;
    await diagramImagesReady(root, 2);
    expect(source.fetched).toEqual(["/n-latin.woff2"]);
    expect(svgOfDataUrl(diagramFontsNow(SRC) ?? "")).toContain("@font-face");
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
        await diagramImagesReady(container);
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

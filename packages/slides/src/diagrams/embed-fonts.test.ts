import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { svgFontFamilies, svgWithFonts } from "./builds";
import { renderDiagram } from "./index";

const FLOW = {
  kind: "flow",
  alt: "Blood leaves the heart",
  steps: [{ label: "Marching" }, { label: "Heart pumps" }, { label: "Blood returns" }],
} as const;

const face = (family: string, range?: string, data = "AAAA") => ({
  family,
  weight: "200 1000",
  style: "normal",
  ...(range ? { unicodeRange: range } : {}),
  woff2Base64: data,
});

const LATIN = "U+0000-00FF,U+2212";
const CYRILLIC = "U+0400-045F";

describe("svgFontFamilies", () => {
  test("names the theme's body family a drawn diagram sets its words in (Splash: Nunito)", () => {
    const svg = renderDiagram(FLOW, getTheme("splash"), { w: 600, h: 300 });
    expect(svg).toBeDefined();
    expect(svgFontFamilies(svg ?? "")).toContain("Nunito Variable");
  });

  test("reads attributes and CSS declarations, quoted or not, without fallbacks' quotes", () => {
    const svg = `<svg><style>text{font-family:"Lexend",sans-serif}</style><text font-family="'Fredoka Variable', 'Trebuchet MS', sans-serif">a</text></svg>`;
    expect(svgFontFamilies(svg)).toEqual([
      "Fredoka Variable",
      "Trebuchet MS",
      "sans-serif",
      "Lexend",
    ]);
  });

  test("never throws and gives nothing for markup without families", () => {
    expect(svgFontFamilies("")).toEqual([]);
    expect(svgFontFamilies("<svg><rect/></svg>")).toEqual([]);
  });
});

describe("svgWithFonts", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text font-family="'Nunito Variable', Verdana, sans-serif">Marching 112</text></svg>`;

  test("embeds an @font-face for each named family, right after the opening tag", () => {
    const out = svgWithFonts(svg, [face("Nunito Variable", LATIN, "Tk9OTw==")]);
    expect(out).toContain(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@font-face{font-family:"Nunito Variable";font-style:normal;font-weight:200 1000;src:url(data:font/woff2;base64,Tk9OTw==) format("woff2");unicode-range:U+0000-00FF,U+2212}</style>`,
    );
    expect(out).toContain("Marching 112");
  });

  test("leaves families the drawing does not name, and subsets no character uses, out", () => {
    const out = svgWithFonts(svg, [
      face("Nunito Variable", LATIN),
      face("Nunito Variable", CYRILLIC),
      face("Lexend Variable", LATIN),
    ]);
    expect(out.match(/@font-face/g)?.length).toBe(1);
    expect(out).not.toContain("Lexend");
    expect(out).not.toContain("U+0400");
  });

  test("a subset is kept for a character an entity spells (&#8722; is U+2212)", () => {
    const minus = svg.replace("Marching 112", "&#x2212;3");
    const out = svgWithFonts(minus, [face("Nunito Variable", "U+2212")]);
    expect(out).toContain("U+2212");
  });

  test("is a no-op with no faces, a family already embedded, or no <svg> tag", () => {
    expect(svgWithFonts(svg, [])).toBe(svg);
    const once = svgWithFonts(svg, [face("Nunito Variable", LATIN)]);
    expect(svgWithFonts(once, [face("Nunito Variable", LATIN)])).toBe(once);
    expect(svgWithFonts("not svg", [face("Nunito Variable")])).toBe("not svg");
  });

  test("a library drawing that carries its own Lexend is left as it is", () => {
    const lib = `<svg><style>@font-face{font-family:"Lexend";src:url(data:font/woff2;base64,AA)}</style><text font-family="Lexend">x</text></svg>`;
    expect(svgWithFonts(lib, [face("Lexend", LATIN)])).toBe(lib);
  });
});

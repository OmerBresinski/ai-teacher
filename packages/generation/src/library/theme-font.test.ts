import { describe, expect, test } from "bun:test";
import { textWidth } from "@tj/slides/diagrams";
import { FONT_STACKS } from "@tj/slides/fonts";
import { getTheme } from "@tj/slides/themes";
import { inspectDrawnSvg, kit, loadModel, renderLibraryModel } from "./render";

/*
 * TEACH-247 part o: a library model draws in the lesson theme's label face (its body font), measured
 * with that face's advances, and names it instead of embedding Lexend: the display and export
 * helper (`svgWithFonts`) embeds the page's own face, so a stored lesson stays small.
 */
const preset = async (id: string, n = 0) => {
  const m = await loadModel(id);
  if (!m) throw new Error(id);
  return (await kit()).withDefaults(m.params, (m.presets[n] ?? m.presets[0])?.params ?? {});
};

describe("theme font", () => {
  test("names the theme's body face, embeds no font and records the face it measured with", async () => {
    const splash = getTheme("splash", "ks2");
    const d = await renderLibraryModel("fractions", await preset("fractions"), {
      font: splash.fonts.body,
    });
    expect(d.svg).not.toContain("@font-face");
    expect(d.svg).not.toContain("base64");
    expect(d.svg).toContain("font-family:'Nunito Variable', Verdana, sans-serif");
    expect(d.svg).toContain('data-font="nunito"');
    // Digits render at the widths they were measured at, never a face's tabular figures.
    expect(d.svg).toContain(".slide.tk text,.slide.tk tspan{font-variant-numeric:normal}");
    expect(d.bytes).toBeLessThan(30_000);
  });

  test("without a theme the drawing names Lexend, still with no embedded font", async () => {
    const d = await renderLibraryModel("number_line", await preset("number_line"));
    expect(d.svg).not.toContain("@font-face");
    expect(d.svg).toContain("font-family:'Lexend Variable'");
    expect(d.svg).not.toContain("data-font=");
  });

  test("words are measured with the theme face, as they are read back", async () => {
    const P = await preset("timeline");
    const lex = await renderLibraryModel("timeline", P);
    const pub = await renderLibraryModel("timeline", P, { font: FONT_STACKS.publicSans });
    const a = inspectDrawnSvg(lex.svg).words;
    const b = inspectDrawnSvg(pub.svg).words;
    expect(b.length).toBe(a.length);
    // A word's read-back box is its width in the face it names: Public Sans is narrower than Lexend.
    const w = b.find((x) => x.words.length > 3);
    if (!w) throw new Error("no word");
    const ctx = { stack: FONT_STACKS.publicSans } as never;
    const lo = textWidth(w.words, ctx, w.fs, 400);
    const hi = textWidth(w.words, ctx, w.fs, 700);
    expect(w.x1 - w.x0).toBeGreaterThanOrEqual(lo - 1);
    expect(w.x1 - w.x0).toBeLessThanOrEqual(hi * 1.05 + 2);
    const same = a.find((x) => x.words === w.words);
    expect(same && same.x1 - same.x0).toBeGreaterThan(w.x1 - w.x0);
  });

  test("an old drawing with embedded Lexend reads back as Lexend", async () => {
    const d = await renderLibraryModel("bar_model", await preset("bar_model"));
    const old = d.svg.replace(
      "<style><![CDATA[",
      '<style><![CDATA[@font-face{font-family:"Lexend"}',
    );
    expect(inspectDrawnSvg(old).words).toEqual(inspectDrawnSvg(d.svg).words);
  });
});

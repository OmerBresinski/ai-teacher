import { describe, expect, it } from "bun:test";
// The layouts first: `./labels` is in the layouts ↔ figures import cycle (see `./right-triangle`).
import { boxH } from "../../layouts";
import { countLines, lineWidth } from "../../text-measure";
import { getTheme, THEMES } from "../../themes";
import { fitLabel, labelText, unicodeLabel } from "./labels";

/* TEACH-98 acceptance rows 13 and 14: Unicode and bold labels. */

describe("unicodeLabel", () => {
  it("row 13: maps each ASCII shorthand to the Unicode a label draws", () => {
    const cases: [string, string][] = [
      ["x^2", "x²"],
      ["10^-3", "10⁻³"],
      ["x_1", "x₁"],
      ["sqrt2", "√2"],
      ["sqrt(3)", "√3"],
      ["sqrt(x+1)", "√(x+1)"],
      ["20pi", "20π"],
      ["2 pi", "2 π"],
      ["pi", "π"],
      ["40deg", "40°"],
      ["40 degrees", "40°"],
      ["A'", "A′"],
      ["B''", "B″"],
      ["vec(AB)", "A⃗B⃗"],
    ];
    for (const [ascii, drawn] of cases) expect(unicodeLabel(ascii), ascii).toBe(drawn);
  });

  it("row 13: leaves plain labels alone", () => {
    for (const text of ["5 cm", "spin", "pie", "x - 5", "½", "x", "5x", "12.5 m", "Ea", "ΔH", "x²"])
      expect(unicodeLabel(text), text).toBe(text);
  });

  it("maps shorthands inside a longer label", () => {
    expect(unicodeLabel("2x^2 + 3")).toBe("2x² + 3");
    expect(unicodeLabel("angle 30deg")).toBe("angle 30°");
    expect(unicodeLabel("A'B'")).toBe("A′B′");
    expect(unicodeLabel("sqrt(pi)")).toBe("√(π)");
  });
});

describe("bold labels", () => {
  const t = getTheme("chalk");
  const box = { x: 0, y: 0, w: 60, h: 20 };

  it("row 14: a bold label's text carries the bold mark; a plain one carries none", () => {
    const bold = labelText(t, "a", box, "center", undefined, { bold: true });
    const node = bold.doc.content?.[0]?.content?.[0];
    expect(node).toEqual({ type: "text", text: "a", marks: [{ type: "bold" }] });
    expect(bold.style).toMatchObject({ preset: "small", align: "center", color: t.colors.ink });
    const plain = labelText(t, "a", box, "center");
    expect(plain.doc.content?.[0]?.content?.[0]).toEqual({ type: "text", text: "a" });
  });

  it("row 14: fitLabel measures a bold label at least as wide as a regular one, on every theme", () => {
    for (const theme of THEMES) {
      const regular = fitLabel(theme, "WWWW", { maxW: 400 });
      const bold = fitLabel(theme, "WWWW", { maxW: 400, bold: true });
      expect(bold.w, theme.id).toBeGreaterThanOrEqual(regular.w);
      expect(bold.h, theme.id).toBe(boxH(theme, "small"));
      // The ruler's weight argument, left out, is the preset's own weight.
      expect(lineWidth("WWWW", "small", theme, undefined)).toBe(lineWidth("WWWW", "small", theme));
      expect(countLines("WWWW WWWW", "small", theme, 200, undefined)).toBe(
        countLines("WWWW WWWW", "small", theme, 200),
      );
    }
    // Given, it picks the bold advances: a bold "WWWW" is not the regular one's width.
    const widths = (weight: number) => THEMES.map((th) => lineWidth("WWWW", "small", th, weight));
    expect(widths(700)).not.toEqual(widths(400));
  });

  it("measures Unicode labels wide, never short: an unknown character is a whole em", () => {
    for (const theme of THEMES)
      expect(lineWidth("x²", "small", theme), theme.id).toBeGreaterThan(
        lineWidth("x2", "small", theme),
      );
  });
});

import { describe, expect, test } from "bun:test";
import { XMLValidator } from "fast-xml-parser";
import { ICON_IDS, iconSvg } from "./library";
import { iconMedalSvg, type MedalThemeInput, medalColoursFor } from "./medal";
import { toOklch } from "./treatment";

// theming/final/tokens.json (15 Oct 2026): ground, surface, field a and b, accent, and the medal
// tokens the final token set computed for them
const SLATE: MedalThemeInput = {
  dark: true,
  colors: { background: "#1E232B", surface: "#262C35", accent: "#9DBBD0" },
  fields: ["#2A323C", "#262C35"],
};
const EMBER: MedalThemeInput = {
  dark: true,
  colors: { background: "#1B1B1E", surface: "#252528", accent: "#F2A08C" },
  fields: ["#2E2725", "#252528"],
};
const PAPER: MedalThemeInput = {
  colors: { background: "#FFFAF4", surface: "#FFFFFF", accent: "#D7263D" },
};

/** OKLab distance, a little over 0.01 is a just-visible difference. */
function distance(a: string, b: string): number {
  const [l1, c1, h1] = toOklch(a);
  const [l2, c2, h2] = toOklch(b);
  const ab = (c: number, h: number) => [
    c * Math.cos((h * Math.PI) / 180),
    c * Math.sin((h * Math.PI) / 180),
  ];
  const [a1, b1] = ab(c1, h1) as [number, number];
  const [a2, b2] = ab(c2, h2) as [number, number];
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe("medalColoursFor (rulings 211 and 247)", () => {
  test("dark themes: a deep face in the accent's hue and a quiet ring, as the final token set", () => {
    for (const [theme, fill, line] of [
      [SLATE, "#364753", "#445968"],
      [EMBER, "#4A3631", "#5F4640"],
    ] as const) {
      const m = medalColoursFor(theme);
      expect(distance(m.fill, fill), `${m.fill} vs ${fill}`).toBeLessThan(0.01);
      expect(m.tint).toBe(m.fill);
      expect(m.line).not.toBeNull();
      expect(distance(m.line as string, line), `${m.line} vs ${line}`).toBeLessThan(0.01);
      // deep: darker than the icon's lightest parts, just above the panels it sits on
      const L = toOklch(m.fill)[0];
      expect(L).toBeGreaterThan(toOklch(theme.colors.surface as string)[0]);
      expect(L).toBeLessThan(0.45);
    }
  });

  test("light themes: a white face, a pale accent tint, no ring", () => {
    const m = medalColoursFor(PAPER);
    expect(m.fill).toBe("#ffffff");
    expect(m.line).toBeNull();
    expect(toOklch(m.tint)[0]).toBeGreaterThan(0.9);
    expect(m.tint).not.toBe("#ffffff");
  });

  test("the theme's own medal tokens win; a transparent ring means none", () => {
    const own = medalColoursFor({
      ...PAPER,
      medal: { fill: "#FFFFFF", tint: "#F3EADB", line: "#00000000" },
    });
    expect(own).toEqual({ fill: "#ffffff", tint: "#f3eadb", line: null });
    expect(medalColoursFor({ ...SLATE, medal: { line: "#445968" } }).line).toBe("#445968");
    // a hostile token never reaches the markup
    const bad = medalColoursFor({ ...PAPER, medal: { fill: '"/><script>', line: "red" } });
    expect(bad.fill).toBe("#ffffff");
    expect(bad.line).toBeNull();
  });
});

describe("iconMedalSvg", () => {
  const medal = medalColoursFor(SLATE);

  test("every icon in a medal is a valid, literal, self-contained SVG", () => {
    for (const id of ICON_IDS) {
      const svg = iconMedalSvg(id, { medal, age: "secondary", idPrefix: "m" });
      expect(XMLValidator.validate(svg), id).toBe(true);
      expect(svg, id).not.toMatch(/var\(|href|<foreignObject|<script|\bclass=/);
      // the drawing is the icon's own, at 80% of the disc
      const body = iconSvg(id, { age: "secondary", idPrefix: "m" }).replace(
        /^<svg[^>]*>|<\/svg>$/g,
        "",
      );
      expect(svg, id).toContain(`<g transform="translate(24 24) scale(0.8)">${body}</g>`);
    }
  });

  test("the face is the medal fill or tint; the ring is the quiet line or a category colour", () => {
    const plain = iconMedalSvg("cat", { medal, px: 96 });
    expect(plain).toContain(`r="120" style="fill:${medal.fill}"`);
    expect(plain).toContain(`stroke:${medal.line};stroke-width:6`);
    expect(plain).toContain('width="96" height="96"');
    const paper = medalColoursFor(PAPER);
    expect(iconMedalSvg("cat", { medal: paper, face: "tint" })).toContain(`fill:${paper.tint}`);
    expect(iconMedalSvg("cat", { medal: paper })).not.toContain("stroke-width:6");
    const ring = iconMedalSvg("cat", { medal: paper, ring: "#2F7FD1" });
    expect(ring).toContain("stroke:#2f7fd1;stroke-width:14");
    expect(iconMedalSvg("cat", { medal: paper, ring: "url(javascript:x)" })).not.toContain(
      "javascript",
    );
  });

  test("outside the disc stays empty, so the PNG a rasteriser makes keeps its alpha", () => {
    const svg = iconMedalSvg("heart", { medal });
    expect(svg).not.toMatch(/<rect x="0" y="0"/);
    expect(svg).not.toMatch(/<svg[^>]*style=/);
    // the disc is the first thing drawn and nothing is drawn at the box's corners' size
    expect(svg.indexOf('<circle cx="120" cy="120" r="120"')).toBeGreaterThan(0);
  });

  test("an unknown id gives an empty string", () => {
    expect(iconMedalSvg("kitten", { medal })).toBe("");
    expect(iconMedalSvg("constructor", { medal })).toBe("");
  });
});

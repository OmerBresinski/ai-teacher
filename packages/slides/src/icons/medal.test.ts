import { describe, expect, test } from "bun:test";
import { XMLValidator } from "fast-xml-parser";
import { ICON_IDS, iconSignificantColours, iconSvg } from "./library";
import { iconMedalSvg, type MedalThemeInput, medalColoursFor, medalRim } from "./medal";
import { iconColoursFor } from "./theme-colours";
import { contrast, toOklch } from "./treatment";

// theming/final/tokens.json (15 Oct 2026), the token names TEACH-215 part b reads
const TOKENS = {
  "dark-slate": {
    mode: "dark",
    bg: "#1E232B",
    surface: "#262C35",
    "fa-fill": "#2A323C",
    "fb-fill": "#262C35",
    accent: "#9DBBD0",
    "medal-fill": "#364753",
    "medal-tint": "#364753",
    "medal-line": "#445968",
  },
  "dark-ember": {
    mode: "dark",
    bg: "#1B1B1E",
    surface: "#252528",
    "fa-fill": "#2E2725",
    "fb-fill": "#252528",
    accent: "#F2A08C",
    "medal-fill": "#4A3631",
    "medal-tint": "#4A3631",
    "medal-line": "#5F4640",
  },
  paper: {
    mode: "light",
    bg: "#FFFAF4",
    surface: "#FFFFFF",
    "fa-fill": "#F9D7D0",
    "fb-fill": "#F3EADB",
    accent: "#D7263D",
    "medal-fill": "#FFFFFF",
    "medal-tint": "#F3EADB",
    "medal-line": "#00000000",
  },
} as const;
const without = (t: Record<string, string>) =>
  Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith("medal-")));
const SLATE: MedalThemeInput = { tokens: TOKENS["dark-slate"] };
const EMBER: MedalThemeInput = { tokens: TOKENS["dark-ember"] };
const PAPER: MedalThemeInput = { tokens: TOKENS.paper };

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
  test("the theme's medal tokens come through as they are: dark Slate and Ember", () => {
    expect(medalColoursFor(SLATE)).toEqual({
      fill: "#364753",
      tint: "#364753",
      line: "#445968",
      dark: true,
    });
    expect(medalColoursFor(EMBER)).toEqual({
      fill: "#4a3631",
      tint: "#4a3631",
      line: "#5f4640",
      dark: true,
    });
    expect(medalColoursFor(PAPER)).toEqual({
      fill: "#ffffff",
      tint: "#f3eadb",
      line: null,
      dark: false,
    });
  });

  test("without medal tokens, the dark fallback derives the same deep face and ring", () => {
    for (const name of ["dark-slate", "dark-ember"] as const) {
      const m = medalColoursFor({ tokens: without(TOKENS[name]) });
      expect(distance(m.fill, TOKENS[name]["medal-fill"]), name).toBeLessThan(0.01);
      expect(distance(m.line as string, TOKENS[name]["medal-line"]), name).toBeLessThan(0.01);
      expect(m.tint).toBe(m.fill);
    }
  });

  test("without medal tokens, a light theme's face is its own surface, never a fixed white", () => {
    const m = medalColoursFor({ tokens: { ...without(TOKENS.paper), surface: "#F3F5F8" } });
    expect(m.fill).toBe("#f3f5f8");
    expect(m.line).toBeNull();
    expect(toOklch(m.tint)[0]).toBeGreaterThan(0.9);
  });

  test("a hostile token never reaches the markup; a transparent ring means none", () => {
    const bad = medalColoursFor({
      tokens: { ...TOKENS.paper, "medal-fill": '"/><script>', "medal-line": "red" },
    });
    expect(bad.fill).toBe("#ffffff"); // the surface
    expect(bad.line).toBeNull();
  });
});

describe("dark-on-dark: every icon reads on both dark medals (3:1)", () => {
  const themes = {
    slate: { accent: "#9DBBD0", ink: "#E8ECF0" },
    ember: { accent: "#F2A08C", ink: "#F1ECE8" },
  };
  test("the dominant shape reads at 3:1 on the face, or on the light rim the medal adds", () => {
    const rimmed: string[] = [];
    for (const [name, input] of [
      ["slate", SLATE],
      ["ember", EMBER],
    ] as const) {
      const medal = medalColoursFor(input);
      const colours = iconColoursFor({ colors: themes[name] });
      for (const id of ICON_IDS) {
        for (const age of ["primary", "secondary"] as const) {
          const opts = { medal, colours, age };
          const shapes = iconSignificantColours(id, opts);
          expect(shapes.length, id).toBeGreaterThan(0);
          const rim = medalRim(id, opts);
          for (const c of shapes) {
            // each large shape reads on the face, or on the rim right behind it
            const best = Math.max(contrast(c, medal.fill), rim ? contrast(c, rim) : 0);
            expect(
              best,
              `${id} ${name} ${age}: ${c} on ${medal.fill}/${rim}`,
            ).toBeGreaterThanOrEqual(3);
          }
          const svg = iconMedalSvg(id, { ...opts, idPrefix: "r" });
          expect(XMLValidator.validate(svg), id).toBe(true);
          if (rim) {
            expect(svg, id).toContain(`stroke:${rim}`);
            if (age === "secondary") rimmed.push(`${name}:${id}`);
          }
        }
      }
    }
    // the reviewer's dark-on-dark list gets the rim
    for (const k of [
      "slate:penguin",
      "ember:penguin",
      "slate:copper-oxide",
      "slate:moon-night",
      "ember:bat",
    ]) {
      expect(rimmed, k).toContain(k);
    }
  });

  test("light themes add no rim (the drawings are made for a light face)", () => {
    const medal = medalColoursFor(PAPER);
    for (const id of ICON_IDS) expect(medalRim(id, { medal }), id).toBeNull();
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
      expect(svg, id).toContain(`${body}</g></svg>`);
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

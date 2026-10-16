import { describe, expect, test } from "bun:test";
import type { Theme } from "@tj/domain/documents";
import v1 from "./fixtures/themes-v1.json";
import { ADVANCES } from "./font-metrics.generated";
import { FONT_STACKS } from "./fonts";
import { contrastRatio } from "./look";
import { ageProfileOf, v2Colors, v2Profile } from "./theme-v2";
import { pxToPt } from "./theme-v2-paper";
import { CALLOUT_TONES, getTheme, isThemeId, OPTION_TONES, THEMES } from "./themes";

/*
 * Theme v2 (TEACH-152 part b; UX rulings 211, 212, 213). Values come from the pilot's
 * `northstars/theme-v2.css` and `THEME.md`, which are in px on a 1440 slide; themes are in slide
 * points on a 960 slide, so every size is x2/3.
 */

const AA = 4.5;
const LARGE = 3;

describe("px to slide points", () => {
  test("x2/3 to one decimal, checked against two THEME.md rows", () => {
    // title/name/body px, primary 72/46/33 and early 80/54/38
    expect([72, 46, 33].map(pxToPt)).toEqual([48, 30.7, 22]);
    expect([80, 54, 38].map(pxToPt)).toEqual([53.3, 36, 25.3]);
  });
});

describe("ageProfileOf", () => {
  test("EYFS and KS1 read early, KS2 primary, KS3 to post-16 secondary", () => {
    expect(ageProfileOf("eyfs")).toBe("early");
    expect(ageProfileOf("ks1")).toBe("early");
    expect(ageProfileOf("ks2")).toBe("primary");
    for (const b of ["ks3", "ks4", "ks5", "post16"]) expect(ageProfileOf(b)).toBe("secondary");
  });

  test("no stage reads primary, the golds' own values", () => {
    expect(ageProfileOf(undefined)).toBe("primary");
    expect(ageProfileOf("nonsense")).toBe("primary");
  });
});

describe("the first v2 theme (paper)", () => {
  test("a live, selectable theme after the nine (no off switch, Greg 12 Oct)", () => {
    expect(THEMES.map((t) => t.id)).toEqual([...v1.catalogue.map((t) => t.id), "paper"]);
    expect(isThemeId("paper")).toBe(true);
    expect(getTheme("paper").id).toBe("paper");
    expect(getTheme("paper").v2?.supports).toEqual(["early", "primary", "secondary"]);
  });

  test("the gold's base colours", () => {
    const c = getTheme("paper").colors;
    expect(c.background).toBe("#FFFAF4");
    expect(c.ink).toBe("#22152B");
    expect(c.muted).toBe("#5E5066");
    expect(c.accent).toBe("#D7263D");
    expect(c.heading).toBe("#22152B");
  });

  test("ks1 reads early at THEME.md x2/3", () => {
    const p = v2Profile(getTheme("paper", "ks1"));
    expect(p.age).toBe("early");
    expect(p.sizes).toMatchObject({ title: pxToPt(80), name: pxToPt(54), body: pxToPt(38) });
    expect(p.floors).toMatchObject({ body: pxToPt(34), name: pxToPt(44) });
    expect([p.medal, p.disc, p.badge]).toEqual([288, 124, 62].map(pxToPt));
    expect(p.radius).toMatchObject({ picture: pxToPt(40), bubble: pxToPt(30), tail: pxToPt(8) });
    expect([p.band, p.wave]).toEqual([0.16, 0.3]);
    expect(p.fonts.display).toBe(FONT_STACKS.andika);
    expect(p.fonts.quote).toBe(FONT_STACKS.andika);
    expect(p.displayWeight).toBe(700);
    expect(p.quoteStyle).toBe("normal");
  });

  test("ks2 reads primary, the gold", () => {
    const p = v2Profile(getTheme("paper", "ks2"));
    expect(p.age).toBe("primary");
    expect(p.sizes).toMatchObject({ title: pxToPt(72), name: pxToPt(46), body: pxToPt(33) });
    expect(p.floors).toMatchObject({ body: pxToPt(28), name: pxToPt(32) });
    expect([p.medal, p.disc, p.badge]).toEqual([268, 112, 54].map(pxToPt));
    expect(p.radius).toMatchObject({ picture: pxToPt(20), bubble: pxToPt(26), tail: pxToPt(4) });
    expect([p.band, p.wave]).toEqual([0.127, 0.26]);
    expect(p.fonts).toEqual({
      display: FONT_STACKS.lexend,
      body: FONT_STACKS.lexend,
      quote: FONT_STACKS.sourceSerif,
    });
    expect(p.displayWeight).toBe(800);
    expect(p.quoteStyle).toBe("italic");
  });

  test("ks4 reads secondary, with Schibsted's word space", () => {
    const p = v2Profile(getTheme("paper", "ks4"));
    expect(p.age).toBe("secondary");
    expect(p.sizes).toMatchObject({ title: pxToPt(68), name: pxToPt(42), body: pxToPt(31) });
    expect(p.floors).toMatchObject({ body: pxToPt(28), name: pxToPt(32) });
    expect([p.medal, p.disc, p.badge]).toEqual([240, 100, 48].map(pxToPt));
    expect(p.radius).toMatchObject({ picture: pxToPt(8), bubble: pxToPt(12), tail: pxToPt(2) });
    expect([p.band, p.wave]).toEqual([0.1, 0.2]);
    expect(p.fonts.display).toBe(FONT_STACKS.schibsted);
    expect(p.fonts.body).toBe(FONT_STACKS.lexend);
    expect(p.wordSpace).toBe("0.12em");
  });

  test("no stage reads primary", () => {
    expect(v2Profile(getTheme("paper")).age).toBe("primary");
  });

  test("a stage the theme does not support reads the nearest supported profile", () => {
    const paper = getTheme("paper");
    const v2 = paper.v2;
    if (!v2) throw new Error("paper has no v2 block");
    const olderOnly: Theme = { ...paper, v2: { ...v2, supports: ["primary", "secondary"] } };
    expect(v2Profile({ ...olderOnly, keyStage: "ks1" } as Theme).age).toBe("primary");
    const youngOnly: Theme = { ...paper, v2: { ...v2, supports: ["early"] } };
    expect(v2Profile({ ...youngOnly, keyStage: "ks4" } as Theme).age).toBe("early");
  });

  test("the early profile retunes the neutrals; the others keep the theme's", () => {
    expect(v2Colors(getTheme("paper", "ks1")).background).toBe("#FFF7EC");
    expect(v2Colors(getTheme("paper", "ks1")).ink).toBe("#2A1A24");
    expect(v2Colors(getTheme("paper", "ks2")).background).toBe("#FFFAF4");
    expect(v2Colors(getTheme("paper", "ks4")).muted).toBe("#5A5060");
  });

  test("an accent family swaps the accent roles and nothing else", () => {
    const red = v2Colors(getTheme("paper"));
    const green = v2Colors(getTheme("paper"), "green");
    expect(red.accent).toBe("#D7263D");
    expect(red.soft).toBe("#F6C9C2");
    expect(red.connector).toEqual({ band: "#F6C9C2", dot: "#D7263D" });
    expect(green.accent).toBe("#2C8A43");
    expect(green.deep).toBe("#1F4A38");
    expect(green.heading).toBe("#22152B");
    expect(green.background).toBe(red.background);
    expect(green.category).toEqual(red.category);
    expect(v2Colors(getTheme("paper"), "no-such-family").accent).toBe("#D7263D");
  });

  test("icon colour slots follow the accent and the ink", () => {
    const s = v2Colors(getTheme("paper")).icon;
    expect(Object.keys(s).sort()).toEqual(
      ["ink", "primary", "primaryDark", "secondary", "secondaryDark", "stroke", "tint"].sort(),
    );
    expect(s.primary).toBe("#D7263D");
    expect(s.tint).toBe("#FCE3E0");
    expect(s.ink).toBe("#22152B");
  });
});

describe("contrast on the v2 theme, every accent family at every age (FR 5)", () => {
  const paper = getTheme("paper");
  const families = Object.keys(paper.v2?.accents ?? {});
  test("five accent families", () => {
    expect(families.sort()).toEqual(["blue", "green", "orange", "plum", "red"]);
  });
  for (const band of ["ks1", "ks2", "ks4"]) {
    for (const accent of families) {
      test(`${band} ${accent}`, () => {
        const c = v2Colors(getTheme("paper", band), accent);
        const grounds = { paper: c.background, medal: c.surface, disc: c.wash };
        for (const [name, g] of Object.entries(grounds)) {
          expect([name, contrastRatio(c.ink, g) >= AA]).toEqual([name, true]);
        }
        c.fields.forEach((f, i) => {
          expect([`field ${i + 1}`, contrastRatio(c.ink, f) >= AA]).toEqual([
            `field ${i + 1}`,
            true,
          ]);
        });
        expect(contrastRatio(c.muted, c.background)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(c.onDeep, c.deep)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(c.accent, c.background)).toBeGreaterThanOrEqual(LARGE);
        for (const cat of c.category) {
          expect([cat, contrastRatio(cat, c.background) >= LARGE]).toEqual([cat, true]);
        }
      });
    }
  }
});

describe("v1 themes", () => {
  test("deep-equal to master: catalogue, staged copies and the tone tables", () => {
    const old = THEMES.filter((t) => t.id !== "paper");
    const staged = Object.fromEntries(
      old.flatMap((t) => ["ks1", "ks2", "ks4"].map((b) => [`${t.id}@${b}`, getTheme(t.id, b)])),
    );
    expect(JSON.parse(JSON.stringify(old))).toEqual(v1.catalogue);
    expect(JSON.parse(JSON.stringify(staged))).toEqual(v1.staged);
    const { paper: _c, ...callouts } = CALLOUT_TONES;
    const { paper: _o, ...options } = OPTION_TONES;
    expect(JSON.parse(JSON.stringify(callouts))).toEqual(v1.callouts);
    expect(JSON.parse(JSON.stringify(options))).toEqual(v1.options);
    for (const t of old) expect(t.v2).toBeUndefined();
  });

  test("resolve to v2 tokens by derivation: the theme's own colours and fonts, v2 geometry", () => {
    const studio = getTheme("studio", "ks4");
    const p = v2Profile(studio);
    expect(p.age).toBe("secondary");
    expect(p.fonts.display).toBe(studio.fonts.title);
    expect(p.fonts.body).toBe(studio.fonts.body);
    expect(p.medal).toBe(pxToPt(240));
    const c = v2Colors(studio);
    expect(c.accent).toBe(studio.colors.accent);
    expect(c.background).toBe(studio.colors.background);
    expect(c.ink).toBe(studio.colors.ink);
    expect(c.rule).toBe(studio.colors.line);
    expect(contrastRatio(c.onDeep, c.deep)).toBeGreaterThanOrEqual(AA);
    expect(v2Profile(getTheme("playground", "ks1")).age).toBe("early");
  });

  test("every v1 theme resolves without throwing, dark ones included", () => {
    for (const t of THEMES.filter((x) => !x.v2)) {
      const c = v2Colors(t);
      expect(contrastRatio(c.onDeep, c.deep)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(c.ink, c.wash)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe("fonts", () => {
  test("Andika has a stack with Comic Sans MS as its fallback, and measured metrics", () => {
    expect(FONT_STACKS.andika).toBe('var(--font-andika), "Comic Sans MS", sans-serif');
    expect(ADVANCES.andika?.[400]).toHaveLength(95);
    expect(ADVANCES.andika?.[700]).toHaveLength(95);
  });
});

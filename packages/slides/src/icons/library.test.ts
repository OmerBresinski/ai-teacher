import { describe, expect, test } from "bun:test";
import { XMLValidator } from "fast-xml-parser";
import {
  COOL_ICON_COLOURS,
  DEFAULT_ICON_COLOURS,
  ICON_AGES,
  ICON_IDS,
  ICON_LIBRARY,
  ICON_SIZES,
  ICON_STYLES,
  iconColourSet,
  iconImageSrc,
  iconSizeFor,
  iconSvg,
} from "./library";

const THEMES = { warm: DEFAULT_ICON_COLOURS, cool: COOL_ICON_COLOURS };
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

describe("iconSvg: every drawing, size, age and theme", () => {
  test("is a parseable, self-contained SVG with literal colours from the theme's slots or #fff", () => {
    let n = 0;
    for (const id of ICON_IDS) {
      for (const size of ICON_SIZES) {
        for (const age of ICON_AGES) {
          for (const [name, colours] of Object.entries(THEMES)) {
            for (const style of ICON_STYLES) {
              const svg = iconSvg(id, { colours, age, size, style });
              const where = `${id} ${size} ${age} ${name} ${style}`;
              expect(svg.startsWith("<svg"), where).toBe(true);
              expect(XMLValidator.validate(svg), where).toBe(true);
              expect(svg.includes("var("), `${where}: var(`).toBe(false);
              expect(/\bclass=/.test(svg), `${where}: class`).toBe(false);
              expect(/--[a-z]/.test(svg), `${where}: custom property`).toBe(false);
              expect(/color-mix|calc\(|filter:/.test(svg), `${where}: css function`).toBe(false);
              const allowed = iconColourSet({ colours, age, style });
              for (const c of svg.match(HEX) ?? []) {
                expect(allowed.has(c.toLowerCase()), `${where}: stray colour ${c}`).toBe(true);
              }
              n++;
            }
          }
        }
      }
    }
    expect(n).toBe(122 * 3 * 3 * 2 * 2);
  }, 30_000);

  test("px sets an intrinsic size for rasterisers", () => {
    expect(iconSvg("heart", { px: 96 })).toMatch(/^<svg [^>]*width="96" height="96"/);
  });

  test("an unknown id gives an empty string", () => {
    expect(iconSvg("kitten")).toBe("");
    expect(iconImageSrc("kitten")).toBe("");
  });

  test("iconImageSrc is the same SVG as a data URL", () => {
    const src = iconImageSrc("heart", { idPrefix: "d", px: 96 });
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(src.split(",")[1] ?? "")).toBe(
      iconSvg("heart", { idPrefix: "d", px: 96 }),
    );
  });

  test("theme slots reach the drawing as literal colours", () => {
    const pink = { ...DEFAULT_ICON_COLOURS, primary: "#ff00aa" };
    // "quarter"-style slot users: the healthy-heart drawing uses the primary slot.
    // early: the one age with no colour filter, so a slot arrives as given
    const users = ICON_IDS.filter((id) =>
      iconSvg(id, { colours: pink, age: "early" }).includes("#ff00aa"),
    );
    expect(users.length).toBeGreaterThan(0);
    expect(iconSvg(users[0] as string)).not.toContain("#ff00aa");
  });

  test("ids inside one SVG never collide with another SVG's", () => {
    const a = iconSvg("heart");
    const b = iconSvg("heart");
    const ids = (s: string) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(a).length).toBeGreaterThan(0);
    for (const i of ids(a)) expect(ids(b)).not.toContain(i);
    expect(iconSvg("heart", { idPrefix: "p" })).toBe(iconSvg("heart", { idPrefix: "p" }));
  });
});

describe("hostile input", () => {
  test("bad colours, ids, sizes, ages and px never reach the markup", () => {
    const evil = '"/><script>alert(1)</script><x a="';
    const svg = iconSvg("heart", {
      colours: { primary: evil, ink: "red", stroke: "#12345", tint: "#ffffffzz" },
      idPrefix: evil,
      px: evil as unknown as number,
      age: "toddler" as unknown as "early",
      size: "xl" as unknown as "m",
    });
    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("alert(");
    expect(svg).not.toContain("width=");
    for (const id of [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])) {
      expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
    }
    // invalid slots fall back to the defaults; an unknown age and size read as primary, m
    expect(svg.replace(/ id="[^"]+"|url\(#[^)]+\)/g, "")).toBe(
      iconSvg("heart").replace(/ id="[^"]+"|url\(#[^)]+\)/g, ""),
    );
    expect(iconSvg("heart", { px: -5 })).not.toContain("width=");
    expect(iconSvg("heart", { px: Number.NaN })).not.toContain("width=");
  });
});

describe("soft style (the default)", () => {
  test("no dark outline at primary and secondary", () => {
    for (const age of ["primary", "secondary"] as const) {
      expect(iconSvg("volcano", { age })).not.toMatch(/paint-order/);
    }
  });

  test("early and primary: soft gradients and a highlight; primary's gradient is gentler", () => {
    for (const age of ["early", "primary"] as const) {
      const svg = iconSvg("blood-vessels", { age });
      expect(svg).toContain("<radialGradient");
      expect(svg).toMatch(/stroke:#ffffff/); // the highlight
    }
    const lightStop = (svg: string) =>
      /<stop offset="0" stop-color="(#[0-9a-f]{6})"/.exec(svg)?.[1];
    const flesh = "#e0343f";
    expect(lightStop(iconSvg("heart", { age: "early", idPrefix: "a" }))).not.toBe(
      lightStop(iconSvg("heart", { age: "primary", idPrefix: "a" })),
    );
    expect(iconSvg("heart", { age: "early" })).toContain(flesh); // early keeps the full palette
  });

  test("secondary (KS3 on) is flat and calm: no gradient, no gloss, muted colour, less detail", () => {
    for (const id of ICON_IDS) {
      const svg = iconSvg(id, { age: "secondary", idPrefix: "s" });
      expect(svg, id).not.toContain("radialGradient");
      expect(svg, id).not.toContain("url(#s-g");
    }
    const chroma = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      return (
        Math.max(r as number, g as number, b as number) -
        Math.min(r as number, g as number, b as number)
      );
    };
    // the first fill: a literal colour, or the colour a soft gradient is named after
    const mainFill = (svg: string) => {
      const m = /fill:(?:#([0-9a-f]{6})|url\(#[\w-]*-g([0-9a-f]{6})\))/.exec(svg);
      return `#${m?.[1] ?? m?.[2]}`;
    };
    const heart = (age: "early" | "primary" | "secondary") => mainFill(iconSvg("heart", { age }));
    expect(chroma(heart("secondary"))).toBeLessThan(chroma(heart("primary")));
    expect(chroma(heart("primary"))).toBeLessThan(chroma(heart("early")));
    // `dt` detail drops at size m: the artery's inner wall line is gone
    expect(iconSvg("artery", { age: "secondary" }).length).toBeLessThan(
      iconSvg("artery", { age: "primary" }).length,
    );
    expect(iconSvg("artery", { age: "secondary" })).not.toContain('opacity=".35"');
  });

  test("early years only: a faint thin outline", () => {
    const early = iconSvg("seedling", { age: "early" });
    expect(early).toMatch(/stroke-width:3\.2;/);
    expect(early).toContain("stroke-opacity:0.45");
  });

  test("core colours are natural and fixed; only accent parts take the theme (Greg: hearts aren't green)", () => {
    const red = { ...DEFAULT_ICON_COLOURS, primary: "#D7263D", secondary: "#2F7FD1" };
    const green = { ...COOL_ICON_COLOURS, primary: "#1F7A5C", secondary: "#E8A33A" };
    for (const id of [
      "heart",
      "blood",
      "lungs",
      "seedling",
      "lava",
      "pyramid",
      "mummy",
      "watering-can",
    ]) {
      expect(iconSvg(id, { colours: green, idPrefix: "t" }), id).toBe(
        iconSvg(id, { colours: red, idPrefix: "t" }),
      );
    }
    // symbolic parts (room-to-grow's arrows) follow the theme
    expect(iconSvg("room-to-grow", { colours: green, idPrefix: "t" })).not.toBe(
      iconSvg("room-to-grow", { colours: red, idPrefix: "t" }),
    );
  });

  test("the pilot style is still available", () => {
    expect(iconSvg("seedling", { style: "pilot" })).toMatch(/paint-order/);
    expect(iconSvg("seedling", { style: "pilot" })).not.toContain("radialGradient");
  });
});

describe("age treatment (pilot style)", () => {
  const at = (age: (typeof ICON_AGES)[number]) =>
    iconSvg("seedling", { age, idPrefix: "x", style: "pilot" });

  test("each age draws the same concept differently", () => {
    expect(new Set(ICON_AGES.map(at)).size).toBe(3);
  });

  test("early has a thick warm outline and a spark; secondary has no outline", () => {
    const early = at("early");
    const primary = at("primary");
    const secondary = at("secondary");
    expect(early).toMatch(/stroke-width:16(px)?\b/);
    expect(primary).toMatch(/stroke-width:7(px)?\b/);
    expect(secondary).not.toMatch(/paint-order/);
    expect(early).toContain("<circle"); // the spark dot
    expect((early.match(/<circle/g) ?? []).length).toBeGreaterThan(
      (primary.match(/<circle/g) ?? []).length,
    );
  });

  test("rounded corners follow the age radius", () => {
    // seedling's pot rim is an `rr` rect
    expect(iconSvg("seedling", { age: "early", style: "pilot" })).toContain('rx="30"');
    expect(iconSvg("seedling", { age: "primary", style: "pilot" })).toContain('rx="14"');
    expect(iconSvg("seedling", { age: "secondary", style: "pilot" })).toContain('rx="4"');
    expect(iconSvg("seedling", { age: "early" })).toContain('rx="26"');
  });
});

describe("size levels", () => {
  test("s, m and l differ: l adds the fine detail, s drops gloss, shade and outline", () => {
    const s = iconSvg("volcano", { size: "s", idPrefix: "x" });
    const m = iconSvg("volcano", { size: "m", idPrefix: "x" });
    const l = iconSvg("volcano", { size: "l", idPrefix: "x" });
    expect(new Set([s, m, l]).size).toBe(3);
    expect(l.length).toBeGreaterThan(m.length);
    expect(m.length).toBeGreaterThan(s.length);
    expect(s).not.toMatch(/paint-order/);
    expect(s).not.toContain("clip"); // the shade and its clip path are gone
  });

  test("s uses the separate small drawing when the concept has one", () => {
    const withSmall = ICON_IDS.filter((id) => ICON_LIBRARY[id]?.small);
    expect(withSmall.length).toBe(8);
    for (const id of withSmall) {
      const small = iconSvg(id, { size: "s", idPrefix: "x" });
      const medium = iconSvg(id, { size: "m", idPrefix: "x" });
      expect(small).not.toBe(medium);
    }
  });

  test("iconSizeFor picks s under about 47pt", () => {
    expect(iconSizeFor(28)).toBe("s");
    expect(iconSizeFor(46.9)).toBe("s");
    expect(iconSizeFor(47)).toBe("m");
    expect(iconSizeFor(160)).toBe("m");
  });
});

describe("snapshots", () => {
  for (const id of ["heart", "canopic-jar", "magma", "lava-layers"]) {
    test(id, () => {
      expect(iconSvg(id, { idPrefix: "snap" })).toMatchSnapshot();
      expect(iconSvg(id, { idPrefix: "snap", age: "early", size: "s" })).toMatchSnapshot();
      expect(iconSvg(id, { idPrefix: "snap", style: "pilot" })).toMatchSnapshot();
    });
  }
});

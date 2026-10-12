import { describe, expect, test } from "bun:test";
import { XMLValidator } from "fast-xml-parser";
import {
  COOL_ICON_COLOURS,
  DEFAULT_ICON_COLOURS,
  ICON_AGES,
  ICON_IDS,
  ICON_LIBRARY,
  ICON_SIZES,
  iconColourSet,
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
            const svg = iconSvg(id, { colours, age, size });
            const where = `${id} ${size} ${age} ${name}`;
            expect(svg.startsWith("<svg"), where).toBe(true);
            expect(XMLValidator.validate(svg), where).toBe(true);
            expect(svg.includes("var("), `${where}: var(`).toBe(false);
            expect(/\bclass=/.test(svg), `${where}: class`).toBe(false);
            expect(/--[a-z]/.test(svg), `${where}: custom property`).toBe(false);
            expect(/color-mix|calc\(|filter:/.test(svg), `${where}: css function`).toBe(false);
            const allowed = iconColourSet({ colours, age });
            for (const c of svg.match(HEX) ?? []) {
              expect(allowed.has(c.toLowerCase()), `${where}: stray colour ${c}`).toBe(true);
            }
            n++;
          }
        }
      }
    }
    expect(n).toBe(122 * 3 * 3 * 2);
  }, 30_000);

  test("px sets an intrinsic size for rasterisers", () => {
    expect(iconSvg("heart", { px: 96 })).toMatch(/^<svg [^>]*width="96" height="96"/);
  });

  test("an unknown id gives an empty string", () => {
    expect(iconSvg("kitten")).toBe("");
  });

  test("theme slots reach the drawing as literal colours", () => {
    const pink = { ...DEFAULT_ICON_COLOURS, primary: "#ff00aa" };
    // "quarter"-style slot users: the healthy-heart drawing uses the primary slot.
    const users = ICON_IDS.filter((id) => iconSvg(id, { colours: pink }).includes("#ff00aa"));
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

describe("age treatment", () => {
  const at = (age: (typeof ICON_AGES)[number]) => iconSvg("seedling", { age, idPrefix: "x" });

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
    expect(iconSvg("seedling", { age: "early" })).toContain('rx="30"');
    expect(iconSvg("seedling", { age: "primary" })).toContain('rx="14"');
    expect(iconSvg("seedling", { age: "secondary" })).toContain('rx="4"');
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
    });
  }
});

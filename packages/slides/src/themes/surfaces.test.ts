import { describe, expect, it } from "bun:test";
import { THEMES } from "../themes";
import {
  BANDED_ZONES,
  bandJoin,
  cornerRadii,
  EDGE_BUDGET,
  paintSurface,
  roundRectPoints,
  SHADOW_MAX,
  SURFACE_ROLES,
  SURFACE_TOKENS,
  SURFACES,
  type SurfaceRole,
  type SurfaceTokens,
  surfaceStyle,
  surfacesFromTokens,
  surfacesOf,
  TITLE_ZONES,
} from "./surfaces";

/* ---- colour maths, as the theming pass's contrast.mjs computes it ---- */
const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
const hex = (c: number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (h: string) => {
  const [r = 0, g = 0, b = 0] = rgb(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
/** OKLab lightness of an sRGB hex. */
const oklabL = (h: string) => {
  const [r = 0, g = 0, b = 0] = rgb(h).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
};
const over = (top: string, under: string) => {
  if (top.length === 7) return top;
  const a = Number.parseInt(top.slice(7), 16) / 255;
  const t = rgb(top);
  const u = rgb(under);
  return hex(t.map((v, i) => v * a + (u[i] ?? 0) * (1 - a)));
};
const blend = (mode: string, a: string, g: string) =>
  hex(
    rgb(a).map((v, i) => {
      const w = rgb(g)[i] ?? 0;
      return mode === "screen" ? 1 - (1 - v) * (1 - w) : v * w;
    }),
  );

type Ground = string | ((t: SurfaceTokens) => string);
/** Every text/ground pair (theming/final/contrast.mjs, unchanged). */
const PAIRS: [string, string, Ground][] = [
  ["body ink on ground", "ink", "bg"],
  ["body ink on surface", "ink", "surface"],
  ["muted on ground", "muted", "bg"],
  ["muted on surface", "muted", "surface"],
  ["dim on ground", "dim", "bg"],
  ["dim on surface", "dim", "surface"],
  ["accent text on ground", "accent", "bg"],
  ["title on band/ground", "title-ink", (t) => over(t["title-band"] as string, t.bg as string)],
  ["kicker on band/ground", "title-muted", (t) => over(t["title-band"] as string, t.bg as string)],
  [
    "title accent on band/ground",
    "title-accent",
    (t) => over(t["title-band"] as string, t.bg as string),
  ],
  ["ink on field-a", "fa-ink", "fa-fill"],
  ["ink on field-b", "fb-ink", "fb-fill"],
  ["ink on card", "card-ink", "card-fill"],
  ["ink on plate", "ink", "plate-fill"],
  ["ink on sand", "ink", "sand"],
  ["badge ink on badge", "badge-ink", "badge-fill"],
  ["now-ink on badge-now", "now-ink", "badge-now"],
  ["marker ink on marker", "marker-ink", "marker-fill"],
  ["chip ink on chip", "chip-ink", "chip-fill"],
  ["quiet chip ink", "chip-quiet-ink", "chip-quiet-fill"],
  ["track ink on track", "track-ink", "track-fill"],
  ["ink on hl-a", "ink", "hl-a"],
  ["ink on hl-b", "ink", "hl-b"],
  [
    "ink on set a",
    "ink",
    (t) => blend(t["set-blend"] as string, t["set-a"] as string, t.bg as string),
  ],
  [
    "ink on set b",
    "ink",
    (t) => blend(t["set-blend"] as string, t["set-b"] as string, t.bg as string),
  ],
  [
    "ink on set a+b",
    "ink",
    (t) =>
      blend(
        t["set-blend"] as string,
        t["set-b"] as string,
        blend(t["set-blend"] as string, t["set-a"] as string, t.bg as string),
      ),
  ],
  ["ink on bubble a", "ink", "bubble-a"],
  ["ink on bubble b", "ink", "bubble-b"],
  ...[1, 2, 3, 4].flatMap((n): [string, string, Ground][] => [
    [`ink on cat-${n} fill`, "ink", `cat-${n}-fill`],
    [`cat-${n} ink on ground`, `cat-${n}-ink`, "bg"],
    [`cat-${n} ink on surface`, `cat-${n}-ink`, "surface"],
    [`cat-${n} ink on own fill`, `cat-${n}-ink`, `cat-${n}-fill`],
  ]),
  ["scrim ink on scrim (over white photo)", "scrim-ink", (t) => over(t.scrim as string, "#FFFFFF")],
  ["correct verdict ink on ground", "sem-correct-ink", "bg"],
  ["correct verdict ink on surface", "sem-correct-ink", "surface"],
  ["incorrect verdict ink on ground", "sem-incorrect-ink", "bg"],
  ["incorrect verdict ink on surface", "sem-incorrect-ink", "surface"],
];
const LOCKED = new Set(["scrim ink on scrim (over white photo)"]);
/** Calm keeps its own 7:1 rule; everyone else AA. */
const MIN: Record<string, number> = { calm: 7 };
const THEME_IDS = Object.keys(SURFACE_TOKENS);
const tok = (id: string) => SURFACE_TOKENS[id] as SurfaceTokens;

describe("contrast: every text/ground pair in every theme meets AA (TEACH-215 part b row 3)", () => {
  for (const id of THEME_IDS) {
    it(id, () => {
      const t = tok(id);
      const fails: string[] = [];
      for (const [label, text, ground] of PAIRS) {
        const g =
          typeof ground === "function" ? ground(t) : over(t[ground] as string, t.bg as string);
        const x = over(t[text] as string, g);
        const need = LOCKED.has(label) ? 4.5 : (MIN[id] ?? 4.5);
        const r = cr(x, g);
        if (r < need) fails.push(`${label}: ${x} on ${g} = ${r.toFixed(2)} (needs ${need})`);
      }
      for (const k of ["sem-correct", "sem-incorrect"]) {
        const r = cr(t[k] as string, t.bg as string);
        if (r < 3) fails.push(`${k} mark on ground ${r.toFixed(2)} (needs 3)`);
      }
      expect(fails).toEqual([]);
    });
  }

  it("nowInk on badgeNow and track ink on track read through the typed surfaces", () => {
    for (const [id, s] of Object.entries(SURFACES)) {
      expect({ id, ok: cr(s.nowInk, s.badgeNow) >= 4.5 }).toEqual({ id, ok: true });
      expect({ id, ok: cr(s.track.ink, s.track.fill) >= 4.5 }).toEqual({ id, ok: true });
    }
  });

  it("medal tint is light (OKLab L > 0.8) in light themes; a deep tint 1.1-2.2:1 in dark ones", () => {
    for (const id of THEME_IDS) {
      const t = tok(id);
      const s = surfacesOf({ id, dark: t.mode === "dark" });
      if (s.mode === "light") {
        expect({ id, L: oklabL(s.medalTint) > 0.8 }).toEqual({ id, L: true });
      } else {
        for (const k of ["bg", "surface", "fa-fill"]) {
          const r = cr(t["medal-fill"] as string, t[k] as string);
          expect({ id, k, ok: r >= 1.1 && r <= 2.2 }).toEqual({ id, k, ok: true });
        }
      }
    }
  });

  it("patterns stay quiet (at most 1.3:1 against their fill); edges and offsets stay in budget", () => {
    for (const [id, s] of Object.entries(SURFACES)) {
      const styles = [...Object.entries(s.roles), ...Object.entries(s.states)];
      for (const [role, st] of styles) {
        if (!st) continue;
        if (st.pattern)
          expect({ id, role, r: cr(st.pattern, st.fill) <= 1.3 }).toEqual({ id, role, r: true });
        const budget = EDGE_BUDGET[role.split(":")[0] as SurfaceRole];
        if (st.edge != null)
          expect({ id, role, ok: budget != null && st.edge <= budget }).toEqual({
            id,
            role,
            ok: true,
          });
        if (st.shadow)
          expect({ id, role, ok: Math.hypot(st.shadow.x, st.shadow.y) <= SHADOW_MAX }).toEqual({
            id,
            role,
            ok: true,
          });
      }
    }
  });
});

describe("the token file and the side table (row 2)", () => {
  it("SURFACES has an entry for every live theme and every final theme", () => {
    for (const t of THEMES) expect(Object.hasOwn(SURFACES, t.id)).toBe(true);
    for (const id of THEME_IDS) expect(Object.hasOwn(SURFACES, id)).toBe(true);
  });

  it("every theme gives every new field a value", () => {
    for (const [id, s] of Object.entries(SURFACES)) {
      const fields = [
        s.titleMuted,
        s.nowInk,
        s.badgeNow,
        s.track.fill,
        s.track.ink,
        s.medalTint,
        s.chipQuiet.fill,
        s.chipQuiet.ink,
        s.cardFlat.line,
        s.scrim.fill,
        s.scrim.ink,
      ];
      expect({ id, missing: fields.filter((f) => !f) }).toEqual({ id, missing: [] });
      for (const role of SURFACE_ROLES) expect(s.roles[role]?.fill).toBeTruthy();
      expect(Number.isFinite(s.cardFlat.width)).toBe(true);
    }
  });

  it("the scrim is locked: the same in every theme", () => {
    const scrims = new Set(Object.values(SURFACES).map((s) => `${s.scrim.fill}/${s.scrim.ink}`));
    expect([...scrims]).toEqual(["#22152BA8/#FFFFFF"]);
  });

  it("a missing token is an error, not a silent default", () => {
    const { "now-ink": _gone, ...rest } = tok("paper");
    expect(() => surfacesFromTokens(rest)).toThrow(/now-ink/);
  });

  it("Paper's surfaces are Paper's own colours", () => {
    const paper = THEMES.find((t) => t.id === "paper");
    const s = SURFACES.paper;
    expect(s?.ground).toBe(paper?.colors.background as string);
    expect(s?.roles.rule.fill).toBe(paper?.colors.line as string);
    expect(s?.corner).toBeUndefined(); // Paper keeps each layout's own corners
    expect(s?.zones.top).toBeNull(); // and has no title band
  });

  it("a state the theme sets wins; one it does not set paints as the plain role", () => {
    const p = { id: "paper", dark: false };
    expect(surfaceStyle(p, "badge", "now").fill).toBe("#D7263D");
    expect(surfaceStyle(p, "chip", "quiet").fill).toBe("#F3EADB");
    expect(surfaceStyle(p, "frame", "now")).toBe(SURFACES.paper?.roles.frame as never);
  });
});

describe("painting a role", () => {
  const paper = { id: "paper", dark: false };
  const poster = { id: "poster", dark: false };

  it("a band is drawn only on a declared zone (top, top-box), never on hero or inline", () => {
    const box = { x: 0, y: 0, w: 960, h: 90 };
    for (const zone of TITLE_ZONES) {
      const el = paintSurface({ id: "t", role: "title", zone, box }, poster);
      expect({ zone, band: el != null }).toEqual({ zone, band: BANDED_ZONES.has(zone) });
    }
    expect(paintSurface({ id: "t", role: "title", box }, poster)).toBeNull();
    expect(paintSurface({ id: "t", role: "title", zone: "top", box }, paper)).toBeNull();
  });

  it("a band reaches down to the join", () => {
    const el = paintSurface(
      { id: "t", role: "title", zone: "top", box: { x: 0, y: 0, w: 960, h: 90 }, join: 36 },
      poster,
    );
    expect(el?.h).toBe(126);
  });

  it("badge is a disc, chip a pill, track a rect, scrim a translucent rounded rect", () => {
    const b = paintSurface({ id: "b", role: "badge", box: { x: 0, y: 0, w: 40, h: 40 } }, paper);
    expect(b).toMatchObject({ type: "shape", shape: "ellipse", fill: "#22152B" });
    const c = paintSurface(
      { id: "c", role: "chip", state: "quiet", box: { x: 0, y: 0, w: 120, h: 32 } },
      paper,
    );
    expect(c).toMatchObject({ type: "shape", shape: "pill", fill: "#F3EADB" });
    const t = paintSurface({ id: "k", role: "track", box: { x: 0, y: 0, w: 600, h: 40 } }, paper);
    expect(t).toMatchObject({ type: "shape", shape: "rect", fill: "#EFE6D8" });
    const s = paintSurface({ id: "s", role: "scrim", box: { x: 0, y: 0, w: 120, h: 28 } }, paper);
    expect(s).toMatchObject({ type: "shape", shape: "rounded", fill: "#22152B", opacity: 0.659 });
  });

  it("own corners that differ become one closed path; equal corners stay a native shape", () => {
    const box = { x: 480, y: 0, w: 480, h: 540 };
    const half = paintSurface({ id: "f", role: "field-b", box, own: [34, 0, 0, 34] }, paper);
    expect(half?.type).toBe("path");
    if (half?.type === "path") {
      expect(half.closed).toBe(true);
      expect(half.points[0]?.x).toBe(0);
      expect(half.points[0]?.y).toBeCloseTo(34 / 540, 3);
      expect(half.points).toContainEqual({ x: 1, y: 0 });
      expect(half.points).toContainEqual({ x: 1, y: 1 });
    }
    const card = paintSurface(
      { id: "c", role: "card", box: { x: 0, y: 0, w: 200, h: 120 }, own: [16, 16, 16, 16] },
      paper,
    );
    expect(card).toMatchObject({ type: "shape", shape: "rounded", radius: 16 });
  });

  it("a theme corner replaces only the corners the layout rounded", () => {
    const style = { fill: "#fff", corner: 12 } as const;
    expect(cornerRadii(style, { w: 100, h: 100 }, [34, 0, 0, 34])).toEqual([12, 0, 0, 12]);
    expect(cornerRadii(style, { w: 100, h: 100 })).toEqual([12, 12, 12, 12]);
    expect(cornerRadii({ fill: "#fff", corner: "own" }, { w: 100, h: 100 }, [1, 2, 3, 4])).toEqual([
      1, 2, 3, 4,
    ]);
    expect(cornerRadii({ fill: "#fff", corner: "full" }, { w: 100, h: 40 })).toEqual([
      20, 20, 20, 20,
    ]);
  });

  it("a round-rect path stays inside its box and closes on itself", () => {
    const pts = roundRectPoints(200, 100, [20, 0, 40, 10]);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("band join (the 24pt text rule)", () => {
  const title = { x: 40, y: 20, w: 880, h: 60 };
  const field = { x: 0, y: 116, w: 960, h: 424 };
  it("joins a field 36pt below when no text starts near its top", () => {
    expect(bandJoin(title, [field], [{ x: 60, y: 140, w: 300, h: 30 }])).toBe(36);
  });
  it("keeps the pad when text outside the field starts within 24pt of its top", () => {
    expect(
      bandJoin(title, [{ ...field, x: 480, w: 480 }], [{ x: 40, y: 100, w: 300, h: 30 }]),
    ).toBeNull();
  });
  it("does not reach a field more than 72pt below", () => {
    expect(bandJoin(title, [{ ...field, y: 200 }], [])).toBeNull();
  });
});

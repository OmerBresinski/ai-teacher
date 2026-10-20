import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement } from "@tj/domain/documents";
import { richDocToPlainText } from "@tj/domain/documents";
import { FONT_STACKS, type FontKey } from "./fonts";
import {
  badgeGlyph,
  CAP_BAND,
  crossPolygon,
  FONT_V_METRICS,
  fontKeyOf,
  GLYPH_CHARS,
  isBadgeBox,
  isBadgeGlyph,
  tickPolygon,
} from "./glyph-centre";
import { LAYOUT_CATALOGUE, layoutSlide } from "./layouts";
import { layoutTemplate } from "./templates";
import { templateSamples } from "./templates/samples";
import { resolveTextStyle } from "./text-style";
import { atKeyStage, THEMES } from "./themes";

/*
 * Glyph centring (Greg, 20 Oct 2026). Every badge's glyph is centred on the badge to within half
 * a pixel at 1440 wide (1.5px per slide unit), in every theme, in both render paths (the writer
 * templates and the legacy LAYOUT_CATALOGUE). Here: every badge takes `badgeGlyph` with a
 * measured face, only badges do, and the drawn ✓ and ✕ are centred by their own outline. The ink
 * itself is measured from pixels in Chromium by the opt-in
 * packages/editor/src/slide/badge-glyph-pixels.test.tsx (TEACH_GLYPH_PIXELS=1).
 */
const PX = 1.5; // screen px per slide unit at 1440 wide
const TOL_PX = 0.5;

type Badge = { where: string; shape: SlideElement; text: string };

const flat = (els: readonly SlideElement[]): SlideElement[] =>
  els.flatMap((e) =>
    e.type === "group" ? [e, ...flat((e as { children?: SlideElement[] }).children ?? [])] : [e],
  );

/** Every shape on a slide that carries a one-to-three character label: a badge. */
function badges(where: string, els: readonly SlideElement[]): Badge[] {
  return flat(els).flatMap((e) => {
    if (e.type !== "shape" || !e.doc) return [];
    const text = richDocToPlainText(e.doc).trim();
    return text && [...text].length <= 3 && !/\s/.test(text) ? [{ where, shape: e, text }] : [];
  });
}

function everyBadge(): { theme: (typeof THEMES)[number]; badge: Badge }[] {
  const out: { theme: (typeof THEMES)[number]; badge: Badge }[] = [];
  for (const t of THEMES) {
    const theme = atKeyStage(t, "ks2");
    for (const input of templateSamples(() => "x")) {
      const r = layoutTemplate(input, theme, "ks2");
      for (const badge of badges(`tpl:${input.template}`, r.slide.elements as SlideElement[]))
        out.push({ theme, badge });
    }
    for (const [kind, variants] of Object.entries(LAYOUT_CATALOGUE))
      for (const v of variants as readonly { name: string }[]) {
        const l = layoutSlide(kind as Slide["kind"], t.id, v.name);
        for (const badge of badges(`cat:${kind}/${v.name}`, l.elements as SlideElement[]))
          out.push({ theme, badge });
      }
  }
  return out;
}

describe("badge glyphs sit on the badge's centre", () => {
  const all = everyBadge();

  test("the inventory finds badges in both render paths and every theme", () => {
    expect(all.some((b) => b.badge.where.startsWith("tpl:"))).toBe(true);
    expect(all.some((b) => b.badge.where.startsWith("cat:"))).toBe(true);
    expect(new Set(all.map((b) => b.theme.id)).size).toBe(THEMES.length);
  });

  test("every theme face has measured metrics and glyph offsets", () => {
    for (const t of THEMES)
      for (const stack of Object.values(t.fonts)) expect(fontKeyOf(stack)).not.toBeNull();
    for (const k of Object.keys(FONT_STACKS) as FontKey[])
      expect(FONT_V_METRICS[k]).toHaveLength(4);
  });

  test("every label badge in every theme takes the glyph treatment, with its tables", () => {
    const off: string[] = [];
    for (const { theme, badge } of all) {
      const { shape, text } = badge;
      if (!isBadgeBox(shape.w, shape.h)) continue;
      const r = resolveTextStyle(
        {
          align: "center",
          valign: "middle",
          padding: 12,
          ...(shape as { textStyle?: object }).textStyle,
        },
        theme,
        (shape as { textStyle?: { preset?: "body" } }).textStyle?.preset ?? "body",
      );
      const g = badgeGlyph(text, r.fontFamily, r.fontSize);
      if (!g) off.push(`${theme.id} ${badge.where} "${text}": not a badge glyph`);
      else if (!fontKeyOf(r.fontFamily)) off.push(`${theme.id} ${badge.where}: unmeasured face`);
      else if ([...text].length === 1 && CAP_BAND.test(text) && !GLYPH_CHARS.includes(text))
        off.push(`${theme.id} ${badge.where} "${text}": no ink offsets`);
    }
    expect(off).toEqual([]);
    // The ink itself is measured in Chromium: packages/editor badge-glyph-pixels.test.tsx (opt-in).
  });

  test("only a badge is re-centred: a teacher's own short-label box keeps its layout", () => {
    expect(isBadgeBox(28, 28)).toBe(true); // a numeral disc
    expect(isBadgeBox(43, 43)).toBe(true); // a hinge key
    expect(isBadgeBox(160, 80)).toBe(false); // an "OK" button-sized box
    expect(isBadgeBox(200, 200)).toBe(false); // a big "42" square
    expect(isBadgeBox(70, 30)).toBe(false); // a short pill
    expect(isBadgeGlyph("42")).toBe(true);
    expect(isBadgeGlyph("Yes no")).toBe(false);
    expect(isBadgeGlyph("1234")).toBe(false);
  });

  test("the myth verdict's drawn ✓ and ✕ are centred on the disc in every theme", () => {
    const off: string[] = [];
    for (const t of THEMES)
      for (const input of templateSamples(() => "x").filter((s) => s.template === "myth")) {
        const els = flat(
          layoutTemplate(input, atKeyStage(t, "ks2"), "ks2").slide.elements as SlideElement[],
        );
        const disc = els.find(
          (e) => e.name?.includes("Verdict disc") || e.name?.includes("Stamp disc"),
        );
        const glyph = els.find((e) => e.name?.includes("Verdict glyph"));
        if (!disc || !glyph || glyph.type !== "path") {
          off.push(`${t.id}: no disc or glyph`);
          continue;
        }
        const xs = glyph.points.map((p) => glyph.x + p.x * glyph.w);
        const ys = glyph.points.map((p) => glyph.y + p.y * glyph.h);
        const dx = ((Math.min(...xs) + Math.max(...xs)) / 2 - (disc.x + disc.w / 2)) * PX;
        const dy = ((Math.min(...ys) + Math.max(...ys)) / 2 - (disc.y + disc.h / 2)) * PX;
        if (Math.hypot(dx, dy) > TOL_PX) off.push(`${t.id} ${dx.toFixed(2)},${dy.toFixed(2)}`);
      }
    expect(off).toEqual([]);
  });

  test("the tick and cross outlines are centred on their 24-unit box", () => {
    for (const pts of [tickPolygon(), crossPolygon(), tickPolygon(2.6), crossPolygon(3)]) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(12, 6);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(12, 6);
    }
  });
});

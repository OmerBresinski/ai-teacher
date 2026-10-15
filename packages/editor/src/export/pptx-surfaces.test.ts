import { beforeEach, describe, expect, it } from "bun:test";
import type { Lesson, Slide, SlideElement, Theme } from "@tj/domain/documents";
import { getTheme, slideArtLayers, slideBackground, THEMES } from "@tj/slides";
import { paintSurface, type SurfaceSpec, surfaceStyle } from "@tj/slides/surfaces";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";
import {
  clearGroundCache,
  GROUND_PX,
  groundArtSvg,
  groundRaster,
  SURFACE_PPTX,
} from "./pptx-surfaces";

/*
 * TEACH-215 part b rows 4 and 5: a fixture deck per role exports the shapes the build spec lists,
 * and the theme's ground art reaches PowerPoint as one PNG per theme (T10, from TEACH-152 part c).
 */

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const slide = (id: string, elements: SlideElement[], extra: Partial<Slide> = {}): Slide => ({
  id,
  kind: "content",
  elements,
  ...extra,
});

const paint = (
  theme: Theme,
  spec: Omit<SurfaceSpec, "id">,
  id: string = spec.role,
): SlideElement => {
  const el = paintSurface({ id, ...spec }, theme);
  if (!el) throw new Error(`${spec.role} painted nothing on ${theme.id}`);
  return el;
};

async function exportDeck(
  theme: Theme,
  slides: Slide[],
  rasterise?: (src: string, w: number, h: number) => Promise<string | undefined>,
) {
  const lesson = { id: "l1", title: "Surfaces", slides } as Lesson;
  groundRaster.rasterise = rasterise ?? (async () => undefined);
  const blob = await exportLessonPptx(lesson, theme, { includeAnswers: false });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = async (n: number) =>
    (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";
  return { zip, xml };
}

const geometries = (xml: string): string[] =>
  [...xml.matchAll(/<a:(prstGeom prst="([a-zA-Z0-9]+)"|custGeom)/g)].map((m) => m[2] ?? "custGeom");

beforeEach(clearGroundCache);

describe("a fixture deck per role exports the listed shapes (row 4)", () => {
  for (const id of ["paper", "beacon", "night-lab"]) {
    const theme = getTheme(id);
    it(id, async () => {
      const cases: [string, Omit<SurfaceSpec, "id">, string][] = [
        [
          "own corners",
          { role: "field-b", box: { x: 480, y: 0, w: 480, h: 540 }, own: [34, 0, 0, 34] },
          SURFACE_PPTX["own-corners"],
        ],
        ["badge", { role: "badge", box: { x: 100, y: 100, w: 44, h: 44 } }, SURFACE_PPTX.badge],
        [
          "badge now",
          { role: "badge", state: "now", box: { x: 100, y: 100, w: 44, h: 44 } },
          SURFACE_PPTX.badge,
        ],
        [
          "medal tint",
          { role: "medal", state: "tint", box: { x: 100, y: 100, w: 96, h: 96 } },
          SURFACE_PPTX.medal,
        ],
        [
          "chip quiet",
          { role: "chip", state: "quiet", box: { x: 100, y: 100, w: 140, h: 32 } },
          SURFACE_PPTX.chip,
        ],
        ["track", { role: "track", box: { x: 60, y: 300, w: 840, h: 44 } }, SURFACE_PPTX.track],
        ["scrim", { role: "scrim", box: { x: 100, y: 100, w: 120, h: 28 } }, SURFACE_PPTX.scrim],
      ];
      const { xml } = await exportDeck(
        theme,
        cases.map(([name, spec], i) => slide(`s${i}`, [paint(theme, spec, name)])),
      );
      for (const [i, [name, spec, want]] of cases.entries()) {
        const x = await xml(i + 1);
        expect({ name, geom: geometries(x) }).toEqual({ name, geom: [want] });
        // The scrim's locked ink is Paper's ink, which the export re-inks per theme like any Paper
        // literal; its alpha is what keeps it a scrim (checked below).
        if (name === "scrim") continue;
        const fill = surfaceStyle(theme, spec.role, spec.state).fill.slice(1, 7).toUpperCase();
        expect({ name, filled: x.includes(`<a:srgbClr val="${fill}"`) }).toEqual({
          name,
          filled: true,
        });
      }
      // The scrim keeps its alpha: a translucent fill, not a solid block over the photo.
      expect(await xml(7)).toMatch(/<a:srgbClr val="[0-9A-F]{6}"><a:alpha val="66000"\/>/);
    }, 30_000);
  }
});

describe("T10: PowerPoint keeps the theme's look (row 5)", () => {
  // The three pilot layouts' painted parts (items-row, panel-list, split-compare), as fixtures:
  // the templates themselves land with TEACH-75 parts u to w and paint through these roles.
  const pilot = (theme: Theme): Slide[] => [
    slide("items-row", [
      paint(theme, { role: "medal", box: { x: 80, y: 180, w: 120, h: 120 } }, "m1"),
      paint(theme, { role: "medal", box: { x: 420, y: 180, w: 120, h: 120 } }, "m2"),
      paint(theme, { role: "badge", box: { x: 80, y: 160, w: 36, h: 36 } }, "b1"),
    ]),
    slide("panel-list", [
      paint(theme, {
        role: "field-b",
        box: { x: 40, y: 120, w: 880, h: 380 },
        own: [24, 24, 24, 24],
      }),
      paint(theme, { role: "rule", box: { x: 80, y: 240, w: 800, h: 2 } }),
    ]),
    slide("split-compare", [
      paint(
        theme,
        { role: "field-a", box: { x: 0, y: 110, w: 480, h: 430 }, own: [0, 30, 0, 0] },
        "fa",
      ),
      paint(
        theme,
        { role: "field-b", box: { x: 480, y: 110, w: 480, h: 430 }, own: [30, 0, 0, 0] },
        "fb",
      ),
    ]),
  ];

  for (const id of ["paper", "splash", "beacon"]) {
    it(`${id}: every painted part and the ground art reach the file`, async () => {
      const theme = getTheme(id);
      const calls: string[] = [];
      const { zip, xml } = await exportDeck(theme, pilot(theme), async (src, w, h) => {
        calls.push(src);
        expect([w, h]).toEqual([GROUND_PX.w, GROUND_PX.h]);
        return PNG;
      });
      const s = [await xml(1), await xml(2), await xml(3)];
      const hex = (c: string) => c.slice(1, 7).toUpperCase();
      expect(s[0]).toContain(hex(surfaceStyle(theme, "medal").fill));
      expect(s[0]).toContain(hex(surfaceStyle(theme, "badge").fill));
      expect(s[1]).toContain(hex(surfaceStyle(theme, "field-b").fill));
      expect(geometries(s[2] ?? "")).toEqual(["custGeom", "custGeom"]);
      expect(s[2]).toContain(hex(surfaceStyle(theme, "field-a").fill));

      const art = pilot(theme).map((sl) => groundArtSvg(theme, sl));
      if (art.some(Boolean)) {
        // One rasterised ground per theme and art variant, laid under every slide that wears it.
        expect(calls.length).toBe(new Set(art.filter(Boolean)).size);
        for (const [i, a] of art.entries())
          if (a) expect(s[i]).toMatch(/<p:bg><p:bgPr><a:blipFill[ >]/);
        expect(Object.keys(zip.files).some((f) => /ppt\/media\/.*\.png$/.test(f))).toBe(true);
      } else {
        expect(calls).toEqual([]);
      }
    }, 30_000);
  }

  it("a theme with art (Splash) has ground art on a content slide; a teacher's own colour wins", () => {
    const theme = getTheme("splash");
    const svg = groundArtSvg(theme, slide("a", [], { kind: "title" }));
    expect(svg).toMatch(/^data:image\/svg\+xml,/);
    const body = decodeURIComponent(svg?.slice("data:image/svg+xml,".length) ?? "");
    expect(body).toContain(`fill="${theme.colors.background}"`);
    expect(body).toMatch(/<image href="data:image\/svg\+xml/);
    expect(
      groundArtSvg(theme, slide("b", [], { kind: "title", background: { color: "#123456" } })),
    ).toBeUndefined();
  });

  it("every live theme's art on every slide kind composes into the ground, layer for layer", () => {
    for (const t of THEMES) {
      for (const kind of ["title", "content", "multiple-choice", "image-text"] as const) {
        const sl = slide("k", [], { kind });
        const layers = slideArtLayers(t, sl);
        const svg = groundArtSvg(t, sl);
        expect({ id: t.id, kind, art: svg != null }).toEqual({
          id: t.id,
          kind,
          art: slideBackground(t, sl) != null,
        });
        if (!svg || !layers.length) continue;
        const body = decodeURIComponent(svg.slice("data:image/svg+xml,".length));
        const drawn = (body.match(/<(image|rect) /g) ?? []).length - 1; // less the ground rect
        expect({ id: t.id, kind, drawn }).toEqual({ id: t.id, kind, drawn: layers.length });
      }
    }
  });

  it("without a DOM to rasterise with, the slide keeps its plain ground and the export still works", async () => {
    const theme = getTheme("splash");
    const { xml } = await exportDeck(theme, [slide("t", [], { kind: "title" })]);
    expect(await xml(1)).not.toContain("<a:blipFill>");
  }, 30_000);
});

import { beforeEach, describe, expect, it } from "bun:test";
import type { Lesson, Slide, SlideElement, Theme } from "@tj/domain/documents";
import { atKeyStage, getTheme, slideArtLayers, slideBackground, THEMES } from "@tj/slides";
import {
  paintSurface,
  SURFACE_TOKEN_SETS,
  type SurfaceSpec,
  surfaceStyle,
  surfacesOf,
} from "@tj/slides/surfaces";
import { layoutTemplate } from "@tj/slides/templates";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/**
 * The themes whose gold draws the 14px foot accent bar (round 3 themes3.css `--foot-bar: on` and
 * round 5 themes5.css for the darks; `.footbar` 14px, `var(--accent)`, every slide but the cover).
 */
const FOOT_GOLD = new Set([
  "treehouse",
  "reading-room",
  "crayon",
  "exam-hall",
  "playground",
  "splash",
  "studio",
  "dark-slate",
  "dark-ember",
  "beacon",
  // Night Lab (retired from the picker, still exported for old lessons) is in round 3's list too.
  "night-lab",
]);

import {
  clearGroundCache,
  GROUND_PX,
  groundArtSvg,
  groundRaster,
  MARK_PPTX,
  SURFACE_PPTX,
  shareMedia,
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
  for (const id of ["paper", "beacon", "night-lab", "geometric"]) {
    const theme = getTheme(id);
    // Each theme's declared mark family, not a fixed "badge -> ellipse" (TICKETS-DRAFT 38-41 is
    // superseded by the approved shapes).
    const marks = surfacesOf(theme).marks;
    const mark = (f: "badge" | "medal" | "chip", wide = false) =>
      MARK_PPTX[marks[f]]?.[wide ? "wide" : "square"] ?? "";
    it(id, async () => {
      const cases: [string, Omit<SurfaceSpec, "id">, string][] = [
        [
          "own corners",
          { role: "field-b", box: { x: 480, y: 0, w: 480, h: 540 }, own: [34, 0, 0, 34] },
          SURFACE_PPTX["own-corners"],
        ],
        ["badge", { role: "badge", box: { x: 100, y: 100, w: 44, h: 44 } }, mark("badge")],
        [
          "badge now",
          { role: "badge", state: "now", box: { x: 100, y: 100, w: 44, h: 44 } },
          mark("badge"),
        ],
        [
          "medal tint",
          { role: "medal", state: "tint", box: { x: 100, y: 100, w: 96, h: 96 } },
          mark("medal"),
        ],
        [
          "chip quiet",
          { role: "chip", state: "quiet", box: { x: 100, y: 100, w: 140, h: 32 } },
          mark("chip", true),
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
        // The theme's foot strip (TEACH-215 part k) is the last shape on a slide that has one.
        const foot = FOOT_GOLD.has(theme.id) ? ["rect"] : [];
        expect({ name, geom: geometries(x) }).toEqual({ name, geom: [want, ...foot] });
        const fill = surfaceStyle(theme, spec.role, spec.state).fill.slice(1, 7).toUpperCase();
        expect({ name, filled: x.includes(`<a:srgbClr val="${fill}"`) }).toEqual({
          name,
          filled: true,
        });
      }
      // The scrim keeps its locked fill and its alpha: never re-inked to a theme's pale ink.
      expect(await xml(7)).toContain('<a:srgbClr val="22152B"><a:alpha val="66000"/>');
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
      const foot = FOOT_GOLD.has(theme.id) ? ["rect"] : [];
      expect(geometries(s[2] ?? "")).toEqual(["custGeom", "custGeom", ...foot]);
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

  it("decision 41 A: the PPTX ground draws the vine where the editor does, cut at the panel", () => {
    const t = atKeyStage(getTheme("treehouse"), "ks2");
    const { slide: laid } = layoutTemplate(
      {
        template: "question-set",
        heading: "Quick check: the heart",
        questions: ["Which organ pumps blood?", "Which vessels carry blood away?"],
        answers: ["The heart", "Arteries"],
      },
      t,
      "ks2",
    );
    const quick: Slide = { id: "q", ...laid };
    const [vine] = slideArtLayers(t, quick);
    expect(vine && vine.x === 906 && vine.y === 0 && vine.h < 330).toBe(true);
    const body = decodeURIComponent(
      (groundArtSvg(t, quick) ?? "").slice("data:image/svg+xml,".length),
    );
    expect(body).toContain(`x="906" y="0" width="54" height="${vine?.h}"`);
  });

  it("decision 41 A: a layer standing on the foot is cut from the top, in the PPTX as in the editor (Splash)", () => {
    const t = getTheme("splash");
    const card = {
      id: "c",
      type: "shape",
      shape: "rect",
      x: 860,
      y: 250,
      w: 100,
      h: 150,
      fill: "#FFFFFF",
    } as SlideElement;
    const sl = slide("f", [card], { kind: "starter" });
    const [bubbles] = slideArtLayers(t, sl);
    // The bubbles (908,300 48x226) keep the rows below the card plus the 6pt gap: 406 to 526.
    expect(bubbles && [bubbles.x, bubbles.y, bubbles.w, bubbles.h]).toEqual([908, 406, 48, 120]);
    const body = decodeURIComponent(
      (groundArtSvg(t, sl) ?? "").slice("data:image/svg+xml,".length),
    );
    expect(body).toContain(`x="908" y="406" width="48" height="120"`);
  });

  it("decision 41 A: Crayon's quick check exports its star top-right and the margin line, unmirrored", () => {
    const t = atKeyStage(getTheme("crayon"), "ks2");
    const { slide: laid } = layoutTemplate(
      {
        template: "question-set",
        heading: "Quick check: the heart",
        questions: ["Which organ pumps blood?", "Which vessels carry blood away?"],
        answers: ["The heart", "Arteries"],
      },
      t,
      "ks2",
    );
    const body = decodeURIComponent(
      (groundArtSvg(t, { id: "q", ...laid }) ?? "").slice("data:image/svg+xml,".length),
    );
    expect(body).toContain(`x="912" y="4" width="36" height="34"`);
    expect(body).toContain(`x="40" y="0" width="3" height="531"`);
    expect(body).not.toContain(`x="12" y="4"`);
  });

  it("without a DOM to rasterise with, the slide keeps its plain ground and the export still works", async () => {
    const theme = getTheme("splash");
    const { xml } = await exportDeck(theme, [slide("t", [], { kind: "title" })]);
    expect(await xml(1)).not.toContain("<a:blipFill>");
  }, 30_000);
});

/* ---- WCAG contrast of the exported pair ---- */
const lum = (h: string) => {
  const [r = 0, g = 0, b = 0] = [0, 2, 4]
    .map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const composite = (hex: string, alpha: number, under: string) =>
  [0, 2, 4]
    .map((i) => {
      const t = Number.parseInt(hex.slice(i, i + 2), 16);
      const u = Number.parseInt(under.slice(i, i + 2), 16);
      return Math.round(t * alpha + u * (1 - alpha))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")
    .toUpperCase();

describe("the scrim is locked in what ships", () => {
  it("every theme exports the same scrim fill and alpha, and its label ink reads AA on it over any photo", async () => {
    for (const theme of THEMES) {
      const el = paintSurface(
        { id: "s", role: "scrim", box: { x: 100, y: 100, w: 120, h: 28 } },
        theme,
      );
      if (!el) throw new Error("no scrim");
      const { xml } = await exportDeck(theme, [slide("s", [el])]);
      const m = /<a:srgbClr val="([0-9A-F]{6})"><a:alpha val="(\d+)"\/>/.exec(await xml(1));
      expect({ id: theme.id, fill: m?.[1], alpha: m?.[2] }).toEqual({
        id: theme.id,
        fill: "22152B",
        alpha: "66000",
      });
    }
    // The label colour comes from the same locked pair in all 16 final themes and every live one.
    for (const [id, t] of Object.entries(SURFACE_TOKEN_SETS)) {
      const fill = (t.scrim as string).slice(1, 7);
      const alpha = Number.parseInt((t.scrim as string).slice(7), 16) / 255;
      const ink = (t["scrim-ink"] as string).slice(1);
      for (const photo of ["FFFFFF", "000000", "808080"]) {
        const r = ratio(ink, composite(fill, alpha, photo));
        expect({ id, photo, aa: r >= 4.5 }).toEqual({ id, photo, aa: true });
      }
    }
  }, 60_000);
});

describe("ground art size and editability", () => {
  const words = (id: string, n: number): SlideElement =>
    ({
      id,
      type: "text",
      x: 80,
      y: 80,
      w: 600,
      h: 60,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: `Live words ${n}` }] }],
      },
      style: { preset: "body" },
    }) as unknown as SlideElement;
  const deck = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      slide(`s${i}`, [words(`w${i}`, i)], { kind: i === 0 ? "title" : "content" }),
    );

  for (const id of ["splash", "beacon", "playground"]) {
    it(`${id}: a 12-slide deck embeds each ground once, and every word stays live text`, async () => {
      const theme = getTheme(id);
      const seen: string[] = [];
      const { zip, xml } = await exportDeck(theme, deck(12), async (src) => {
        seen.push(decodeURIComponent(src));
        return PNG;
      });
      const pngs = Object.keys(zip.files).filter((f) => /^ppt\/media\/.*\.png$/.test(f));
      // One media part per distinct ground at most (the stub hands the same PNG for each, so they
      // share one), never one per slide.
      expect(seen.length).toBe(new Set(seen).size);
      expect(pngs.length).toBeGreaterThanOrEqual(1);
      expect(pngs.length).toBeLessThanOrEqual(new Set(seen).size);
      for (let i = 1; i <= 12; i++) {
        const x = await xml(i);
        expect(x).toContain(`<a:t>Live words ${i - 1}</a:t>`);
      }
      // Text is never baked into the ground.
      for (const svg of seen) expect(svg).not.toContain("Live words");
      // Every slide relationship that names a picture names one that exists.
      for (const f of Object.keys(zip.files).filter((p) =>
        /^ppt\/slides\/_rels\/.*\.rels$/.test(p),
      )) {
        const rels = (await zip.file(f)?.async("string")) ?? "";
        for (const [, t] of rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g))
          expect(zip.file(`ppt/media/${t}`)).not.toBeNull();
      }
    }, 60_000);
  }

  it("shareMedia leaves a file with no repeated pictures untouched", async () => {
    const zip = new JSZip();
    zip.file("ppt/media/a.png", "one");
    zip.file("ppt/media/b.png", "two");
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    expect(await shareMedia(buf)).toBe(buf);
  });
});

describe("the foot accent strip (TEACH-215 part k)", () => {
  it("reaches the file over the slide's shapes, in the accent, 14px at 1440; never on the cover", async () => {
    const theme = getTheme("treehouse");
    const { xml } = await exportDeck(theme, [slide("a", []), slide("b", [], { kind: "title" })]);
    const content = await xml(1);
    expect(geometries(content)).toEqual(["rect"]);
    expect(content).toContain(theme.colors.accent.slice(1).toUpperCase());
    expect(geometries(await xml(2))).toEqual([]);
  });
});

describe("the foot strip in PPTX (TEACH-215 part k, gold values)", () => {
  // Treehouse's gold: `.footbar` 14px at 1440 (9.3333pt) in `--accent` #245F28, never on the cover.
  it("a content slide ends with a full-width 9.3333pt #245F28 rect at the foot; the cover has none", async () => {
    const theme = getTheme("treehouse");
    const { xml } = await exportDeck(theme, [slide("c", []), slide("t", [], { kind: "title" })]);
    const content = await xml(1);
    const cover = await xml(2);
    expect(geometries(content)).toEqual(["rect"]);
    expect(content).toContain('<a:srgbClr val="245F28"');
    // 960 x 540 pt slide at 12700 EMU per pt: y 530.6667pt, h 9.3333pt, w 960pt.
    // The last transform on the slide is the strip's (the first is the shape tree's own).
    const off = [
      ...content.matchAll(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g),
    ].at(-1);
    const [x, y, w, h] = (off?.slice(1) ?? []).map(Number) as number[];
    expect(x).toBe(0);
    expect(Math.abs((y as number) / 12700 - 530.6667)).toBeLessThan(0.05);
    expect(Math.abs((w as number) / 12700 - 960)).toBeLessThan(0.05);
    expect(Math.abs((h as number) / 12700 - 9.3333)).toBeLessThan(0.05);
    expect(geometries(cover)).toEqual([]);
  });
});

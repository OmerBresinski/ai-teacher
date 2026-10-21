import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { richDocToPlainText, type SlideElement } from "@tj/domain/documents";
import { CAP_BAND, isBadgeBox, isBadgeGlyph } from "@tj/slides";
import { layoutSlide } from "@tj/slides/layouts";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { atKeyStage, THEMES } from "@tj/slides/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideView } from "./SlideView";

/*
 * Opt-in pixel check of badge glyph centring (Greg, 20 Oct 2026; `badgeGlyph` in @tj/slides).
 * Renders numbered badges from both render paths (the writer templates and the legacy
 * LAYOUT_CATALOGUE) in Chromium at 1440 wide, 4x device pixels, and measures each glyph's ink
 * box from the pixels against its shape's box: the centres must be within 0.5px.
 *
 *   TEACH_GLYPH_PIXELS=1 bun test src/slide/badge-glyph-pixels.test.tsx
 *
 * Needs Chromium for playwright-core (`bunx playwright install chromium`); never runs in CI.
 */
const ON = process.env.TEACH_GLYPH_PIXELS === "1";
const THEME_IDS = ["paper", "crayon", "calm", "studio", "beacon", "geometric"];
const TOL = 0.5;
const W = 1440;
const DSF = 4;

const objectives = (n: number): TemplateInput =>
  ({
    template: "objectives",
    heading: "Today we will",
    points: Array.from({ length: n }, (_, i) => `Objective number ${i + 1} for the lesson`),
  }) as unknown as TemplateInput;

type Badge = { slide: number; id: string; round: boolean; what: string };

describe.skipIf(!ON)("badge glyphs are centred in Chromium", () => {
  test(`numbered badges sit within ${TOL}px of their shape's centre`, async () => {
    const { chromium } = await import("playwright-core");
    const dir = mkdtempSync(join(tmpdir(), "tj-glyph-"));
    const css = await Bun.build({
      entrypoints: [join(import.meta.dir, "../styles/editor.css")],
      outdir: dir,
    });
    expect(css.success).toBe(true);

    const badges: Badge[] = [];
    let body = "";
    let n = 0;
    for (const id of THEME_IDS) {
      const theme = atKeyStage(
        THEMES.find((t) => t.id === id) ?? (THEMES[0] as (typeof THEMES)[number]),
        "ks2",
      );
      const slides = [
        layoutTemplate(objectives(3), theme, "ks2").slide.elements,
        layoutSlide("objectives", id, "stepped").elements,
      ];
      for (const elements of slides) {
        for (const e of elements as SlideElement[]) {
          if (e.type !== "shape" || !e.doc || !isBadgeBox(e.w, e.h)) continue;
          const text = richDocToPlainText(e.doc).trim();
          if (isBadgeGlyph(text) && CAP_BAND.test(text))
            badges.push({
              slide: n,
              id: e.id,
              round: e.shape === "ellipse",
              what: `${id} "${text}"`,
            });
        }
        const html = renderToStaticMarkup(
          <SlideView
            slide={{ id: `s${n}`, kind: "objectives", elements } as never}
            theme={theme}
            mode="capture"
            step={99}
          />,
        );
        body += `<section data-n="${n}" style="position:relative;width:${W}px;height:${(W * 9) / 16}px;overflow:hidden"><div style="width:960px;height:540px;transform:scale(${W / 960});transform-origin:0 0">${html}</div></section>`;
        n++;
      }
    }
    expect(badges.length).toBeGreaterThan(20);
    const page = join(dir, "page.html");
    writeFileSync(
      page,
      `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="editor.css"><style>*,::before,::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}body{background:#fff;line-height:1.5}</style>${body}`,
    );

    const browser = await chromium.launch();
    try {
      const p = await (
        await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: DSF })
      ).newPage();
      await p.goto(`file://${page}`);
      await p.evaluate(() => document.fonts.ready);
      const off: string[] = [];
      for (const b of badges) {
        const loc = p.locator(`section[data-n="${b.slide}"] [data-element-id="${b.id}"]`).first();
        await loc.evaluate((e) => e.scrollIntoView({ block: "center" }));
        const r = await loc.boundingBox();
        if (!r) throw new Error(`${b.what}: not drawn`);
        const clip = {
          x: Math.floor(r.x) - 1,
          y: Math.floor(r.y) - 1,
          width: Math.ceil(r.x + r.width) - Math.floor(r.x) + 2,
          height: Math.ceil(r.y + r.height) - Math.floor(r.y) + 2,
        };
        const png = (await p.screenshot({ clip })).toString("base64");
        const frame = {
          x: (r.x - clip.x) * DSF,
          y: (r.y - clip.y) * DSF,
          w: r.width * DSF,
          h: r.height * DSF,
        };
        const d = await p.evaluate(inkOffset, { png, frame, round: b.round });
        const dx = d[0] / DSF;
        const dy = d[1] / DSF;
        if (Math.hypot(dx, dy) > TOL) off.push(`${b.what} ${dx.toFixed(2)},${dy.toFixed(2)}`);
      }
      expect(off).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 300_000);
});

/**
 * In the page: the ink box's centre minus the frame's centre, in device pixels. The fill is the
 * commonest colour inside the shape; ink is whatever differs from it by over half the largest
 * difference, inside the inner 86% (disc) or 74% (tile) of the frame, away from its edge.
 */
async function inkOffset({
  png,
  frame,
  round,
}: {
  png: string;
  frame: { x: number; y: number; w: number; h: number };
  round: boolean;
}): Promise<[number, number]> {
  const img = new Image();
  img.src = `data:image/png;base64,${png}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0);
  const { data, width: iw } = g.getImageData(0, 0, img.width, img.height);
  const { w, h } = frame;
  const k = round ? 0.86 : 0.74;
  const inside = (x: number, y: number) => {
    const nx = (x + 0.5) / w - 0.5;
    const ny = (y + 0.5) / h - 0.5;
    return round
      ? nx * nx + ny * ny <= (k / 2) ** 2
      : Math.abs(nx) <= k / 2 && Math.abs(ny) <= k / 2;
  };
  const at = (x: number, y: number) => (Math.round(y + frame.y) * iw + Math.round(x + frame.x)) * 4;
  const counts = new Map<number, number>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const i = at(x, y);
      const key =
        ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const fill = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const rgb = [fill >> 16, (fill >> 8) & 255, fill & 255];
  const dist = new Float32Array(Math.ceil(w) * Math.ceil(h));
  let max = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const i = at(x, y);
      const d = Math.hypot(
        (data[i] as number) - (rgb[0] as number),
        (data[i + 1] as number) - (rgb[1] as number),
        (data[i + 2] as number) - (rgb[2] as number),
      );
      dist[y * Math.ceil(w) + x] = d;
      max = Math.max(max, d);
    }
  const th = Math.max(30, max * 0.5);
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if ((dist[y * Math.ceil(w) + x] as number) > th) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return [(x0 + x1 + 1) / 2 - w / 2, (y0 + y1 + 1) / 2 - h / 2];
}

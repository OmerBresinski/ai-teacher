import { describe, expect, test } from "bun:test";
import type { ImageElement, SlideElement, TextElement } from "@tj/domain/documents";
import { darkGround } from "../look";
import { getTheme, THEMES } from "../themes";
import { svgInkBox, svgText, themedCanvas, trimToInk } from "./figure-fit";
import { G, kit, layoutTemplate, type Stage, type TemplateInput } from "./index";
import { templateSamples } from "./samples";

/*
 * FIDELITY VT-1..3 and BV-1..3 (Greg, 12 Oct 2026: "full screen should be full screen. adding extra
 * cards is bad unless for contrast reasons"). A drawn figure beside the words or across the slide
 * stands on the slide, trimmed to its ink; the words and the figure share one top line; a photo
 * fills its panel; a big figure's caption sits on its edges; a library model's canvas takes the
 * slide's ground.
 */

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
// A drawer-style SVG: its ink (a block and a label) in the middle of a canvas with wide margins.
const DRAWER = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 348 284" width="348" height="284"><title>t</title><g transform="translate(4,0)"><rect x="100" y="90" width="140" height="80" fill="#d6c6f4"/><text font-size="20" x="170" y="200" text-anchor="middle">Magma</text></g></svg>`,
);
const WIDE = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 716 400" width="716" height="400"><g><rect x="40" y="150" width="200" height="60"/><rect x="480" y="150" width="200" height="60"/><line x1="240" y1="180" x2="480" y2="180" stroke-width="2"/></g></svg>`,
);
const LIBRARY = svgUri(
  `<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" class="slide tk" width="1280" height="720"><style>.tk { --bg: #fff8ee; --ink: #2a2019; }</style><g><rect x="0" y="0" width="1280" height="720" style="fill: var(--bg);"></rect><circle cx="640" cy="360" r="200"/></g></svg>`,
);

const SLIDE = 960 * 540;
const light = getTheme("splash");
const dark = THEMES.find((t) => darkGround(t));
const els = (input: TemplateInput, theme = light, stage: Stage = "ks2") =>
  layoutTemplate(input, theme, stage).slide.elements;
const named = (es: SlideElement[], n: string) => es.find((e) => e.name === n);
/** The share of the slide a contained drawing's ink takes. */
function inkShare(e: SlideElement | undefined): number {
  const img = e as ImageElement;
  const svg = svgText(String(img?.src ?? "")) ?? "";
  const vb =
    svg
      .match(/<svg[^>]*\sviewBox="([^"]+)"/)?.[1]
      ?.split(/[\s,]+/)
      .map(Number) ?? [];
  const ink = svgInkBox(svg);
  const [, , vw = 0, vh = 0] = vb;
  if (!ink || !vw || !vh) return 0;
  const k = Math.min(img.w / vw, img.h / vh);
  return (ink.w * k * ink.h * k) / SLIDE;
}
const words = (es: SlideElement[]) =>
  es
    .filter((e) => e.type === "text" && e.name !== "Heading")
    .map((e) => JSON.stringify((e as TextElement).doc))
    .join("|");
const top = (es: SlideElement[], names: string[]) =>
  Math.min(...es.filter((e) => names.includes(String(e.name))).map((e) => e.y));

const side = (
  figure: TemplateInput["figure"],
  extra: Partial<TemplateInput> = {},
): TemplateInput => ({
  template: figure && "photo" in figure ? "picture-text" : "diagram-text",
  heading: "Below and above the surface",
  lead: "The crust is the solid outer layer of the Earth.",
  points: ["Magma is molten rock below the surface.", "Lava is molten rock that reaches it."],
  figure,
  ...extra,
});

describe("svg ink trim (BV-1)", () => {
  test("the ink box of a drawer SVG; unsure drawings are not measured", () => {
    const b = svgInkBox(svgText(DRAWER) ?? "");
    expect(b).toBeDefined();
    expect(b?.x).toBeGreaterThan(100);
    expect(b?.x).toBeLessThan(106);
    expect(b?.y).toBeLessThan(91);
    expect((b?.y ?? 0) + (b?.h ?? 0)).toBeGreaterThan(205);
    expect(
      svgInkBox(
        `<svg viewBox="0 0 10 10"><g transform="rotate(30)"><rect width="5" height="5"/></g></svg>`,
      ),
    ).toBeUndefined();
  });
  test("the viewBox is cropped to the ink plus 4 %, never past its canvas", () => {
    const t = trimToInk({ src: DRAWER, aspect: 348 / 284 });
    const vb =
      svgText(t.src)
        ?.match(/viewBox="([^"]+)"/)?.[1]
        ?.split(" ")
        .map(Number) ?? [];
    expect(vb[0]).toBeGreaterThan(90);
    expect(vb[2]).toBeLessThan(160);
    expect(t.aspect).toBeCloseTo((vb[2] ?? 0) / (vb[3] ?? 1), 5);
    const full = svgUri(
      `<svg viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10"/></svg>`,
    );
    expect(trimToInk({ src: full, aspect: 1 }).src).toBe(full);
  });
});

describe("visual-text: a bare figure, one top line, a filled photo (VT-1..3)", () => {
  test("VT-1: a drawing beside the words loses its wash panel on a light slide and grows", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as const) {
      const input = side({ drawn: { src: DRAWER, aspect: 348 / 284 } });
      const laid = els(input, light, stage);
      expect(named(laid, "Panel")).toBeUndefined();
      // At the old 348 x 284 inset the drawing's ink took about 3 % of the slide.
      expect(inkShare(named(laid, "Diagram"))).toBeGreaterThanOrEqual(0.15);
      expect(layoutTemplate(input, light, stage).over).toEqual([]);
    }
  });
  test("VT-1: the gallery diagram-text fixture takes at least 22 % of the slide", () => {
    const input = templateSamples().find((s) => s.template === "diagram-text") as TemplateInput;
    const laid = els(input);
    const d = laid.find((e) => e.type === "image") as ImageElement;
    expect(named(laid, "Panel")).toBeUndefined();
    expect((d.w * d.h) / SLIDE).toBeGreaterThanOrEqual(0.22);
  });
  test("VT-1: a dark slide keeps the wash panel behind the drawing (contrast)", () => {
    expect(dark).toBeDefined();
    if (!dark) return;
    const laid = els(side({ drawn: { src: DRAWER, aspect: 348 / 284 } }), dark);
    expect(named(laid, "Panel")).toBeDefined();
  });
  test("VT-1: short words give a wide figure the 440 panel; the words are unchanged", () => {
    const input = side(
      { drawn: { src: WIDE, aspect: 716 / 400 } },
      { lead: "Two blocks.", points: ["A line joins them."] },
    );
    const laid = els(input);
    const d = named(laid, "Diagram") as ImageElement;
    expect(named(laid, "Lead")?.w).toBe(360);
    expect(d.w).toBeGreaterThan(G.panel.w);
    expect(d.x + d.w).toBe(G.right);
    expect(words(laid)).toBe(
      words(els(side(undefined, { lead: "Two blocks.", points: ["A line joins them."] }))),
    );
  });
  test("VT-2: the words and the figure share one top line at every stage and light theme", () => {
    for (const theme of THEMES.filter((t) => !darkGround(t)))
      for (const stage of ["ks1", "ks2", "ks3"] as const)
        for (const f of [
          { drawn: { src: DRAWER, aspect: 348 / 284 } },
          { photo: "https://x.test/p.jpg", aspect: 1.5 },
        ] as const) {
          const laid = els(side(f), theme, stage);
          const fig = laid.find((e) => e.type === "image") as ImageElement;
          const t = top(laid, ["Lead", "Point", "Key card"]);
          expect(Math.abs(t - fig.y)).toBeLessThanOrEqual(2);
        }
  });
  test("VT-3: a 3:2 photo fills its panel, cropped, and takes at least 24 % of the slide", () => {
    const laid = els(side({ photo: "https://x.test/p.jpg", aspect: 1.5 }));
    const p = named(laid, "Photo") as ImageElement;
    expect((p.w * p.h) / SLIDE).toBeGreaterThanOrEqual(0.24);
    expect(p.crop).toBeDefined();
    expect(named(laid, "Photo panel")).toBeUndefined();
  });
  test("VT-3: a portrait photo takes a narrower panel and the words take the freed width", () => {
    const laid = els(side({ photo: "https://x.test/p.jpg", aspect: 0.6 }));
    const p = named(laid, "Photo") as ImageElement;
    const lead = named(laid, "Lead") as TextElement;
    expect(p.w).toBeLessThan(G.panel.w);
    expect(lead.w).toBeGreaterThan(G.left.w);
    // The usual column gutter, no hole between the words and the photo.
    expect(p.x - (lead.x + lead.w)).toBe(G.panel.x - G.left.x - G.left.w);
    expect(p.x + p.w).toBe(G.right);
  });
});

describe("big-visual: full screen is full screen (BV-1..3)", () => {
  const big = (figure: TemplateInput["figure"]): TemplateInput => ({
    template: "big-diagram",
    heading: "Follow the plates",
    lead: "Different plate movements can produce magma that rises through the crust.",
    figure,
  });
  test("BV-1: a drawing across the slide has no card and grows (labels never shrink)", () => {
    const laid = els(big({ drawn: { src: WIDE, aspect: 716 / 400 } }));
    const d = named(laid, "Diagram") as ImageElement;
    expect(named(laid, "Panel")).toBeUndefined();
    const vb =
      svgText(d.src)
        ?.match(/viewBox="([^"]+)"/)?.[1]
        ?.split(" ")
        .map(Number) ?? [];
    const scale = d.w / (vb[2] ?? 1);
    // The old frame: the zone less the caption, with a 22 pt inset each side, round the whole canvas.
    const caption = named(laid, "Caption") as TextElement;
    const old = Math.min((G.width - 44) / 716, (G.band.h - caption.h - 14 - 44) / 400);
    expect(scale).toBeGreaterThanOrEqual(1);
    expect(scale).toBeGreaterThan(old * 1.1);
  });
  test("BV-2: the caption sits on the figure's edges, in ink", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as const)
      for (const f of [
        { drawn: { src: WIDE, aspect: 716 / 400 } },
        { drawn: { src: LIBRARY, aspect: 16 / 9, bare: true, body: true } },
      ]) {
        const laid = els(big(f), light, stage);
        const d = named(laid, "Diagram") as ImageElement;
        const c = named(laid, "Caption") as TextElement;
        expect(c.x).toBe(d.x);
        // A library model at its type floor keeps its size: its caption may run on to the margin.
        if (d.w >= G.width * 0.6 && !("bare" in f.drawn)) expect(c.w).toBe(d.w);
        expect(c.style?.color).toBe(light.colors.ink);
        expect(c.y).toBeGreaterThanOrEqual(d.y + d.h);
      }
  });
  test("BV-3: a library model's canvas takes the slide's ground, or the wash on a dark slide", () => {
    for (const theme of THEMES) {
      const src = themedCanvas(LIBRARY, theme, kit.wash(theme));
      const want = darkGround(theme) ? kit.wash(theme) : theme.colors.background;
      expect(svgText(src)).toContain(`--bg:${want} !important`);
      const laid = els(
        big({ drawn: { src: LIBRARY, aspect: 16 / 9, bare: true, body: true } }),
        theme,
      );
      expect((named(laid, "Diagram") as ImageElement).src).toBe(src);
    }
  });
});

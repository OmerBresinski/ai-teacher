/**
 * Diagrams from a JSON spec (quality PRD: replace "Diagram to add" with a drawing). The writer
 * fills a `DiagramSpec`; `renderDiagram` draws it as a self-contained SVG in the theme's colours
 * and families, sized in slide points; `diagramElement` wraps that as an image element for a slot.
 *
 * Never throws and never draws an error: a spec that does not parse, or a renderer that fails,
 * gives `undefined`, and the caller draws nothing.
 */
import type { ImageElement, Theme } from "@tj/domain/documents";
import { uid } from "../factories";
import { drawBarModel } from "./bar-model";
import { drawFlow } from "./flow";
import { drawLabelled } from "./labelled";
import { drawLineGraph } from "./line-graph";
import { drawNumberLine } from "./number-line";
import { type DiagramSpec, DiagramSpecSchema } from "./schema";
import { context, esc, n, text, wrap } from "./svg";
import { drawTable } from "./table";

export * from "./schema";

/** The drawn diagram's name in the layers list; present, export and print show it. */
export const DIAGRAM_DRAWN_NAME = "Diagram";

/** `spec` parsed, or `undefined` when it is not a diagram spec. */
export function parseDiagram(spec: unknown): DiagramSpec | undefined {
  const r = DiagramSpecSchema.safeParse(spec);
  return r.success ? r.data : undefined;
}

function body(s: DiagramSpec, t: Theme, w: number, h: number): string {
  const x = context(t, w, h);
  let top = 0;
  let head = "";
  if (s.title) {
    const fs = Math.round(x.fs * 1.1);
    const lines = wrap(s.title, x, w, 1, fs, 700);
    head = text(x, w / 2, 0, lines, {
      v: "top",
      fs,
      weight: 700,
      family: x.title,
      fill: t.colors.heading ?? t.colors.ink,
    });
    top = fs * 1.7;
  }
  const ih = h - top;
  const inner = (() => {
    switch (s.kind) {
      case "bar-model":
        return drawBarModel(s, x, w, ih);
      case "line-graph":
        return drawLineGraph(s, x, w, ih);
      case "flow":
        return drawFlow(s, x, w, ih);
      case "labelled-diagram":
        return drawLabelled(s, x, w, ih);
      case "number-line":
        return drawNumberLine(s, x, w, ih);
      case "table":
        return drawTable(s, x, w, ih);
    }
  })();
  return top ? `${head}<g transform="translate(0,${n(top)})">${inner}</g>` : inner;
}

/**
 * The spec drawn as an SVG document `w`×`h` slide points, or `undefined` when the spec does not
 * parse (or, defensively, a renderer throws). Pure and deterministic.
 */
export function renderDiagram(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number },
): string | undefined {
  const s = parseDiagram(spec);
  const w = Math.round(size.w);
  const h = Math.round(size.h);
  if (!s || !(w >= 80) || !(h >= 60)) return undefined;
  try {
    const inner = body(s, theme, w, h);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(s.alt)}"><title>${esc(s.alt)}</title>${inner}</svg>`;
  } catch {
    return undefined;
  }
}

/** An SVG document as a data URL an `<img>` (and so an image element) can show. */
export const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * The spec as an image element filling `rect`, or `undefined` when it does not draw. The element
 * is named `Diagram` (not the placeholder's name), so every surface shows it.
 */
export function diagramElement(
  spec: unknown,
  theme: Theme,
  rect: { x: number; y: number; w: number; h: number },
  ids: () => string = uid,
): ImageElement | undefined {
  const svg = renderDiagram(spec, theme, rect);
  const s = parseDiagram(spec);
  if (!svg || !s) return undefined;
  return {
    id: ids(),
    type: "image",
    name: DIAGRAM_DRAWN_NAME,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    src: svgDataUrl(svg),
    alt: s.alt,
    fit: "contain",
  } as ImageElement;
}

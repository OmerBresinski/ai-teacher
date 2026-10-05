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
import { THEMES } from "../themes";
import { drawBarModel } from "./bar-model";
import { drawBarChart, drawCarroll, drawPie, drawVenn } from "./charts";
import { drawFlow } from "./flow";
import { drawLabelled } from "./labelled";
import { drawLineGraph } from "./line-graph";
import { simplerDiagrams } from "./normalise";
import { drawNumberLine } from "./number-line";
import { type DiagramSpec, DiagramSpecSchema } from "./schema";
import { finished, laddered, look, WEIGHT } from "./style";
import { type Ctx, context, type DrawnText, esc, mix, n, text, wrap } from "./svg";
import { drawTable, tableHeight } from "./table";
import {
  drawCycle,
  drawHydrograph,
  drawLayers,
  drawParticles,
  drawRiver,
  drawTimeline,
} from "./templates";

export {
  energyProfileOf,
  isHydrograph,
  isParticleRow,
  normaliseDiagram,
  simplerDiagrams,
  withTangents,
} from "./normalise";
export * from "./schema";

/** The modern looks' inset between a drawing and its zone's left and right edges, in points. */
export const DRAW_INSET = 4;

/** The drawn diagram's name in the layers list; present, export and print show it. */
export const DIAGRAM_DRAWN_NAME = "Diagram";

/** `spec` parsed, or `undefined` when it is not a diagram spec. */
export function parseDiagram(spec: unknown): DiagramSpec | undefined {
  const r = DiagramSpecSchema.safeParse(spec);
  if (r.success) return r.data;
  return longLabels > 0 ? parseLong(spec, r.error.issues).spec : undefined;
}

/**
 * lab/t3: how far past its limit a label may run when the drawing is checked to fit it (wrapped
 * onto more lines, or the labels a step smaller). The limits stay the writer's contract; this is
 * the room the materialiser gives a label that misses by a few characters before rejecting it.
 */
export const LONG_LABEL_STRETCH = 1.5;
/** The smallest label size a long label may shrink to (the renderers' own floor). */
const LONG_LABEL_MIN_FS = 16;
let longLabels = 0;

/** Run `f` with labels up to `LONG_LABEL_STRETCH` times their limit parsing (synchronous). */
export function withLongLabels<T>(f: () => T): T {
  longLabels += 1;
  try {
    return f();
  } finally {
    longLabels -= 1;
  }
}

type Issue = {
  code: string;
  path: PropertyKey[];
  message: string;
  origin?: string;
  maximum?: unknown;
};
const at = (o: unknown, path: PropertyKey[]): unknown =>
  path.reduce<unknown>((v, k) => (v as Record<PropertyKey, unknown> | undefined)?.[k], o);
const put = (o: unknown, path: PropertyKey[], value: unknown) => {
  const parent = at(o, path.slice(0, -1)) as Record<PropertyKey, unknown> | undefined;
  const last = path[path.length - 1];
  if (parent && last !== undefined) parent[last] = value;
};

/**
 * A spec whose only faults are labels over their limit, by no more than the stretch: parsed with
 * each long label held at its limit, then the whole label put back. Anything else: the reasons.
 */
function parseLong(
  spec: unknown,
  issues: readonly Issue[],
): { spec?: DiagramSpec; reasons: string[] } {
  const long: { path: PropertyKey[]; text: string }[] = [];
  const reasons: string[] = [];
  for (const i of issues) {
    const value = at(spec, i.path);
    const max = typeof i.maximum === "number" ? i.maximum : Number(i.maximum);
    const where = i.path.join(".");
    if (i.code !== "too_big" || i.origin !== "string" || typeof value !== "string") {
      reasons.push(`${where}: ${i.message}`);
      continue;
    }
    const text = value.trim();
    if (text.length > Math.floor(max * LONG_LABEL_STRETCH))
      reasons.push(
        `${where}: ${text.length} characters, past ${Math.floor(max * LONG_LABEL_STRETCH)}`,
      );
    else long.push({ path: i.path, text });
  }
  if (reasons.length > 0 || long.length === 0) return { reasons };
  const held = structuredClone(spec);
  for (const l of long) {
    const max = issues.find((i) => i.path.join(".") === l.path.join("."))?.maximum as number;
    put(held, l.path, l.text.slice(0, max));
  }
  const r = DiagramSpecSchema.safeParse(held);
  if (!r.success)
    return { reasons: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  for (const l of long) put(r.data, l.path, l.text);
  return { spec: r.data, reasons: [] };
}

/**
 * lab/t3: the drawing for `spec` in `rect`, fitting labels a little over their limit before giving
 * up: the label is drawn whole (the renderers wrap it), at the slot's label size or a step smaller
 * down to the renderers' floor, and only when it draws with no label cut, off the drawing or
 * overlapping on EVERY theme. Nothing is shortened. A spec that already parses is drawn as before
 * (settled, unstretched). `reasons` says why one could not be fitted, for the log.
 */
export function fittedDiagramElement(
  spec: unknown,
  theme: Theme,
  rect: { x: number; y: number; w: number; h: number },
  ids: () => string = uid,
):
  | { ok: true; element: ImageElement; stretched: boolean; fs?: number }
  | { ok: false; reasons: string[] } {
  const strict = DiagramSpecSchema.safeParse(spec);
  if (strict.success) {
    const element = diagramElement(settleDiagram(strict.data, rect).spec, theme, rect, ids);
    return element
      ? { ok: true, element, stretched: false }
      : { ok: false, reasons: ["it does not draw"] };
  }
  const long = parseLong(spec, strict.error.issues);
  if (!long.spec) return { ok: false, reasons: long.reasons };
  const parsed = long.spec;
  const size = { w: rect.w, h: rect.h };
  const base = context(theme, Math.round(rect.w), Math.round(rect.h)).fs;
  let last: string[] = [];
  for (let fs = base; fs >= LONG_LABEL_MIN_FS; fs -= 2) {
    const faults = withLongLabels(() =>
      THEMES.flatMap((t) => diagramFaults(parsed, t, { ...size, fs })),
    );
    if (faults.length === 0) {
      const element = withLongLabels(() => diagramElement(parsed, theme, { ...rect, fs }, ids));
      if (element) return { ok: true, element, stretched: true, fs };
    }
    last = [...new Set(faults)];
  }
  return { ok: false, reasons: last.length > 0 ? last : ["it does not draw"] };
}

function body(
  s: DiagramSpec,
  t: Theme,
  w: number,
  h: number,
  probe?: {
    rec: DrawnText[];
    strokes: [number, number, number, number][];
    ih: number;
    faults: string[];
    arrows?: Ctx["arrows"];
    axes?: Ctx["axes"];
    leaders?: Ctx["leaders"];
  },
  fs?: number,
): string {
  const x = context(t, w, h, fs);
  let top = 0;
  let head = "";
  if (s.title) {
    // A title is never cut (C2, B0's y4 tables): one line at its own size, else two lines, else
    // two lines at the body size; only a title past all three keeps the ellipsis.
    const whole = (fs: number, n: number) => {
      const l = wrap(s.title as string, x, w, n, fs, 700);
      return l[l.length - 1]?.endsWith("…") ? undefined : l;
    };
    const big = Math.round(x.fs * 1.1);
    const fit = (whole(big, 1) && { fs: big, lines: whole(big, 1) as string[] }) ||
      (whole(big, 2) && { fs: big, lines: whole(big, 2) as string[] }) ||
      (whole(x.fs, 2) && { fs: x.fs, lines: whole(x.fs, 2) as string[] }) || {
        fs: x.fs,
        lines: wrap(s.title, x, w, 2, x.fs, 700),
      };
    const { fs, lines } = fit;
    head = text(x, w / 2, 0, lines, {
      v: "top",
      fs,
      weight: WEIGHT.title,
      family: x.title,
      fill: t.colors.heading ?? t.colors.ink,
    });
    top = fs * 1.7 + (lines.length - 1) * fs * 1.2;
  }
  const ih = h - top;
  if (probe) probe.ih = ih;
  const ix = probe
    ? {
        ...x,
        rec: probe.rec,
        strokes: probe.strokes,
        faults: probe.faults,
        arrows: probe.arrows,
        axes: probe.axes,
        leaders: probe.leaders,
      }
    : x;
  // Modern looks: the drawing keeps an inset from its zone's left and right edges, so no label,
  // axis title or bar name touches them.
  // A river scene places its names against its own drawn margins, so it keeps the full width.
  const inset = look().preset === "current" || s.kind === "river" ? 0 : DRAW_INSET;
  const wi = w - 2 * inset;
  const marks = probe
    ? {
        rec: probe.rec.length,
        strokes: probe.strokes.length,
        arrows: probe.arrows?.length ?? 0,
        leaders: probe.leaders?.length ?? 0,
      }
    : undefined;
  const inner = (() => {
    switch (s.kind) {
      case "bar-model":
        return drawBarModel(s, ix, wi, ih);
      case "line-graph":
        return drawLineGraph(s, ix, wi, ih);
      case "flow":
        return drawFlow(s, ix, wi, ih);
      case "labelled-diagram":
        return drawLabelled(s, ix, wi, ih);
      case "number-line":
        return drawNumberLine(s, ix, wi, ih);
      case "table":
        return drawTable(s, ix, wi, ih);
      case "particles":
        return drawParticles(s, ix, wi, ih);
      case "hydrograph":
        return drawHydrograph(s, ix, wi, ih);
      case "timeline":
        return drawTimeline(s, ix, wi, ih);
      case "layers":
        return drawLayers(s, ix, wi, ih);
      case "cycle":
        return drawCycle(s, ix, wi, ih);
      case "river":
        return drawRiver(s, ix, wi, ih);
      case "bar-chart":
        return drawBarChart(s, ix, wi, ih);
      case "pie":
        return drawPie(s, ix, wi, ih);
      case "venn":
        return drawVenn(s, ix, wi, ih);
      case "carroll":
        return drawCarroll(s, ix, wi, ih);
    }
  })();
  if (inset && probe && marks) {
    for (const r of probe.rec.slice(marks.rec)) {
      r.x0 += inset;
      r.x1 += inset;
    }
    for (const sg of probe.strokes.slice(marks.strokes)) {
      sg[0] += inset;
      sg[2] += inset;
    }
    for (const a of probe.arrows?.slice(marks.arrows) ?? []) {
      a.tip = [a.tip[0] + inset, a.tip[1]];
      a.target = { ...a.target, x0: a.target.x0 + inset, x1: a.target.x1 + inset };
    }
    for (const l of probe.leaders?.slice(marks.leaders) ?? []) {
      l[0] += inset;
      l[2] += inset;
    }
  }
  const fin = finished(laddered(inner), x.c, mix, x.dark);
  const drawn = inset ? `<g transform="translate(${n(inset)},0)">${fin}</g>` : fin;
  return top ? `${head}<g transform="translate(0,${n(top)})">${drawn}</g>` : drawn;
}

/**
 * The spec drawn as an SVG document `w`×`h` slide points, or `undefined` when the spec does not
 * parse (or, defensively, a renderer throws). Pure and deterministic.
 */
export function renderDiagram(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number; fs?: number },
): string | undefined {
  const s = parseDiagram(spec);
  const w = Math.round(size.w);
  const h = Math.round(size.h);
  if (!s || !(w >= 80) || !(h >= 60)) return undefined;
  try {
    const inner = body(s, theme, w, h, undefined, size.fs);
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
  rect: { x: number; y: number; w: number; h: number; fs?: number },
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

/**
 * What is wrong with a spec drawn `size` (round G quality gate), in words the writer can act on;
 * empty when nothing is. A diagram that draws is not a pass on its own: labels that collide, run
 * off the drawing or are cut short, and panels meant to differ that draw the same, are faults.
 */
/** What a renderer records about its own drawing when asked (`diagramFaults`, the geometry checks). */
export type DiagramProbe = {
  rec: DrawnText[];
  strokes: [number, number, number, number][];
  ih: number;
  faults: string[];
  arrows: NonNullable<Ctx["arrows"]>;
  axes: NonNullable<Ctx["axes"]>;
  leaders: NonNullable<Ctx["leaders"]>;
};
const diagramProbe = (h: number): DiagramProbe => ({
  rec: [],
  strokes: [],
  ih: h,
  faults: [],
  arrows: [],
  axes: [],
  leaders: [],
});
let lastProbe: DiagramProbe | undefined;
/** The probe of the last `diagramFaults` call (the geometry checks read arrows and axes from it). */
export const lastDiagramProbe = (): DiagramProbe | undefined => lastProbe;

export function diagramFaults(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number; fs?: number },
): string[] {
  const s = parseDiagram(spec);
  const w = Math.round(size.w);
  const h = Math.round(size.h);
  if (!s || !(w >= 80) || !(h >= 60)) return ["it does not draw"];
  const probe = diagramProbe(h);
  try {
    body(s, theme, w, h, probe, size.fs);
  } catch {
    return ["it does not draw"];
  }
  const { rec, strokes, ih } = probe;
  lastProbe = probe;
  const out: string[] = [...probe.faults];
  // A label set across a line of the drawing (an outline, a river, an arrow) reads as clutter and
  // hides what the line shows (F1 y8 drainage basin): its box, less a small margin, is crossed.
  const crosses = (b: DrawnText, [ax, ay, bx, by]: [number, number, number, number]) => {
    for (let t = 0; t <= 1; t += 1 / 40) {
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      if (px > b.x0 + 3 && px < b.x1 - 3 && py > b.y0 + 4 && py < b.y1 - 4) return true;
    }
    return false;
  };
  for (const b of rec) {
    if (strokes.some((sg) => crosses(b, sg)))
      out.push(`the label "${b.text}" sits across a line of the drawing`);
  }
  const area = (b: DrawnText) => Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  const over = (a: DrawnText, b: DrawnText) =>
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  for (const b of rec) {
    if (b.cut) out.push(`the label "${b.text}" is cut short`);
    if (b.x0 < -2 || b.x1 > w + 2 || b.y0 < -2 || b.y1 > ih + 2)
      out.push(`the label "${b.text}" runs off the drawing`);
  }
  for (let i = 0; i < rec.length; i++) {
    for (let j = i + 1; j < rec.length; j++) {
      const a = rec[i] as DrawnText;
      const b = rec[j] as DrawnText;
      if (over(a, b) > 0.15 * Math.min(area(a), area(b)))
        out.push(`the labels "${a.text}" and "${b.text}" overlap`);
    }
  }
  out.push(...samePanels(s));
  return [...new Set(out)];
}

/** Panels meant to differ that draw the same: two particle boxes alike, or two series alike. */
function samePanels(s: DiagramSpec): string[] {
  const out: string[] = [];
  if (s.kind === "labelled-diagram") {
    const boxes = s.shapes.flatMap((sh) => (sh.type === "particles" ? [sh] : []));
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.15 * Math.max(a, b);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a && b && a.arrangement === b.arrangement && near(a.w, b.w) && near(a.h, b.h)) {
          out.push(
            `two particle boxes draw exactly the same (${a.arrangement}, the same size), so the picture shows no difference between them`,
          );
        }
      }
    }
  }
  if (s.kind === "line-graph") {
    const key = (pts: unknown) => JSON.stringify(pts);
    const seen = new Set<string>();
    for (const series of s.series) {
      const k = key(series.points);
      if (seen.has(k)) out.push("two series draw the same line, so the graph shows no difference");
      seen.add(k);
    }
  }
  return [...new Set(out)];
}

/**
 * The spec code will draw (round H): normalised, then the first simpler form that draws without a
 * fault at `size` on EVERY theme (a teacher may switch theme later), else the normalised one.
 * `rung` says which form was taken (0 = as normalised); `clean` whether it passes everywhere.
 */
export function settleDiagram(
  spec: unknown,
  size: { w: number; h: number },
): { spec: unknown; rung: number; clean: boolean } {
  const forms = simplerDiagrams(spec);
  for (const [rung, f] of forms.entries()) {
    if (THEMES.every((t) => diagramFaults(f, t, size).length === 0))
      return { spec: f, rung, clean: true };
  }
  return { spec: forms[0] ?? spec, rung: 0, clean: false };
}

/** Kinds whose drawing fills whatever box it gets (a plot, a scene): kept, at most 0.85 as tall as wide. */
const FILLS_BOX = new Set([
  // Plots keep their box: a chart cut to its smallest clean height squashes its scale.
  "bar-chart",
  "venn",
  // A timeline keeps its box and stands in its middle: its type sized up to fill it.
  "timeline",
  "pie",
  "line-graph",
  "hydrograph",
  "labelled-diagram",
  "river",
  "cycle",
  "layers",
  "particles",
]);

/**
 * The height a spec needs drawn `size.w` wide, at the label size of its full `size` box (UX ruling
 * 155: the figure's card is sized to its drawing, not run to the foot of the slide). A table takes
 * its own rows; a plot or scene keeps its box, capped at 0.85 of its width; anything else takes the
 * smallest height at which it draws with no fault. Never more than `size.h`.
 */
export function drawingHeight(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number },
): { h: number; fs: number } {
  const s = parseDiagram(spec);
  const fs = context(theme, size.w, size.h).fs;
  if (!s) return { h: size.h, fs };
  if (FILLS_BOX.has(s.kind)) return { h: Math.min(size.h, Math.round(size.w * 0.85)), fs };
  if (s.kind === "table") {
    for (let h = 80; h < size.h; h += 8) {
      const probe = { rec: [] as DrawnText[], strokes: [], ih: h, faults: [] as string[] };
      body(s, theme, size.w, h, probe, fs);
      const x = context(theme, size.w, h, fs);
      if (
        tableHeight(s, x, size.w, size.h) <= probe.ih &&
        diagramFaults(spec, theme, { w: size.w, h, fs }).length === 0
      ) {
        return { h: h + 8, fs };
      }
    }
    return { h: size.h, fs };
  }
  for (let h = 120; h < size.h; h += 12) {
    if (diagramFaults(spec, theme, { w: size.w, h, fs }).length === 0) return { h, fs };
  }
  return { h: size.h, fs };
}
export { capacityLine, DIAGRAM_ZONES, diagramCapacities, itemCount, zoneShape } from "./capacity";

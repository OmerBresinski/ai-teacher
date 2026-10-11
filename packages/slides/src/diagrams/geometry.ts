/**
 * DIAGRAM-MODERN geometry checks: what a reader sees as "off" in a drawing, measured. A diagram's
 * labels must not overlap one another or sit across a line, must be set at the 18 pt floor or
 * above, every arrow must end a small gap from the box it points at, and every value axis must
 * reach its data. A figure's activation-energy arrows must each end on their own curve's peak.
 * The renderers record their own geometry when probed (`diagramFaults`); this reads it.
 */
import type {
  LineElement,
  PathElement,
  SlideElement,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { pathSegments, samplePath } from "../path";
import { diagramElement, diagramFaults, lastDiagramProbe } from "./index";
import { labelRule, segmentsCross } from "./label-rule";
import { TYPE_FLOOR } from "./style";

/** The least room between a label and the drawing's left or right edge, in points. */
export const EDGE_INSET = 3;

/** How far an arrow's tip may stand off the box it points at, in points. */
export const ARROW_GAP_MAX = 10;

/** Every geometry fault in `spec` drawn at `size` on `theme`; empty when it draws clean. */
export function diagramGeometryFaults(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number },
): string[] {
  const out = diagramFaults(spec, theme, size);
  const probe = lastDiagramProbe();
  if (!probe || out.includes("it does not draw")) return out;
  // Rendered size: a label's size in the drawing times the scale the slide shows the drawing at
  // (the placed image's width over the SVG's own viewBox).
  const scale = renderedScale(spec, theme, size);
  for (const b of probe.rec) {
    const pt = (b.fs ?? TYPE_FLOOR) * scale;
    if (pt < TYPE_FLOOR - 0.01)
      out.push(
        `the label "${b.text}" renders at ${Math.round(pt * 10) / 10} pt, under the ${TYPE_FLOOR} pt floor`,
      );
  }
  // A label keeps an inset from the drawing's left and right edges.
  for (const b of probe.rec)
    if (b.x0 < EDGE_INSET - 0.5 || b.x1 > size.w - EDGE_INSET + 0.5)
      out.push(`the label "${b.text}" touches the drawing's edge`);
  // Any two labels touching (diagramFaults allows a 15 % graze; the eye does not).
  const rec = probe.rec;
  for (let i = 0; i < rec.length; i++)
    for (let j = i + 1; j < rec.length; j++) {
      const a = rec[i];
      const b = rec[j];
      if (!a || !b) continue;
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox > 1 && oy > 1) out.push(`the labels "${a.text}" and "${b.text}" touch`);
    }
  const ls = probe.leaders;
  // A labelled diagram's leaders are recorded for `labelClashes` (a warning, register
  // diagrams-02), never as a reason to refuse it.
  const labelled = (spec as { kind?: unknown } | null)?.kind === "labelled-diagram";
  for (let i = 0; i < ls.length && !labelled; i++)
    for (let j = i + 1; j < ls.length; j++)
      if (segmentsCross(ls[i] as Seg, ls[j] as Seg)) out.push("two leader lines cross");
  for (const a of probe.arrows) {
    const [px, py] = a.tip;
    const { x0, y0, x1, y1 } = a.target;
    const dx = Math.max(x0 - px, 0, px - x1);
    const dy = Math.max(y0 - py, 0, py - y1);
    const off = Math.hypot(dx, dy);
    if (dx === 0 && dy === 0 && Math.min(px - x0, x1 - px, py - y0, y1 - py) > 1)
      out.push("an arrow runs into the box it points at");
    else if (off > ARROW_GAP_MAX)
      out.push(`an arrow stops ${Math.round(off)} pt short of the box it points at`);
  }
  for (const a of probe.axes)
    if (a.max < a.data - 1e-9)
      out.push(`the ${a.name} axis stops at ${a.max}, under its data (${a.data})`);
  return [...new Set(out)];
}

type Seg = [number, number, number, number];

export { segmentsCross };

/** How large the slide shows the drawing against its own units: the image width over the viewBox. */
export function renderedScale(spec: unknown, theme: Theme, size: { w: number; h: number }): number {
  const el = diagramElement(spec, theme, { x: 0, y: 0, ...size });
  if (!el) return 1;
  const svg = decodeURIComponent((el.src as string).replace(/^data:image\/svg\+xml[^,]*,/, ""));
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!vb) return 1;
  // An image fitted with "contain" scales by the tighter of its two ratios.
  return Math.min(el.w / Number(vb[1]), el.h / Number(vb[2]));
}

type Pt = { x: number; y: number };

/** A line element's two ends in the figure's points. */
function ends(l: LineElement): [Pt, Pt] {
  return [
    { x: l.x + l.from.x * l.w, y: l.y + l.from.y * l.h },
    { x: l.x + l.to.x * l.w, y: l.y + l.to.y * l.h },
  ];
}

/** A path's highest point as drawn. */
function topOf(p: PathElement): Pt {
  const ps = samplePath(pathSegments(p, p.w, p.h), 48);
  const q = ps.reduce((a, b) => (b.y < a.y ? b : a));
  return { x: p.x + q.x, y: p.y + q.y };
}

/** Every geometry fault in a drawn figure (its elements in the figure's points). */
/** The least share of a figure's height its plot keeps. */
export const PLOT_MIN = 0.6;

export function figureGeometryFaults(children: SlideElement[], theme: Theme): string[] {
  const out: string[] = [];
  const named = (n: string) => children.find((c) => c.name === n);
  for (const [arrowName, curveName] of [
    ["Activation energy", "Reaction profile"],
    ["Catalysed activation energy", "Catalysed profile"],
  ] as const) {
    const a = named(arrowName) as LineElement | undefined;
    const c = named(curveName) as PathElement | undefined;
    if (!a || !c) continue;
    const peak = topOf(c);
    const [p, q] = ends(a);
    const tip = p.y < q.y ? p : q;
    if (Math.abs(p.x - q.x) > 0.5) out.push(`the ${arrowName} arrow is not vertical`);
    if (Math.abs(tip.x - peak.x) > 1.5 || Math.abs(tip.y - peak.y) > 2)
      out.push(
        `the ${arrowName} arrow ends at (${Math.round(tip.x)}, ${Math.round(tip.y)}), not its peak (${Math.round(peak.x)}, ${Math.round(peak.y)})`,
      );
  }
  const texts = children.filter((c): c is TextElement => c.type === "text");
  for (const t of texts) {
    const style = t.style as { fontSize?: number; preset?: string } | undefined;
    const fs = style?.fontSize ?? theme.sizes[(style?.preset ?? "body") as keyof Theme["sizes"]];
    if (typeof fs === "number" && fs < TYPE_FLOOR) out.push(`a figure label is set at ${fs} pt`);
  }
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i] as TextElement;
      const b = texts[j] as TextElement;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) out.push("two figure labels overlap");
    }
  // FIX1 (y11 s7, render2): a plot squeezed to a strip by the rows under it. The energy axis runs
  // the plot's height; under PLOT_MIN of the figure's (FIX-ENERGY: 0.6, was 0.4, which passed the
  // y11 strip), the figure needs a taller or wider zone.
  const axis = named("Energy axis");
  if (axis) {
    const figH = Math.max(...children.map((c) => c.y + c.h));
    if (axis.h < figH * PLOT_MIN) out.push("the plot is squeezed to a strip");
  }
  // FIX1 (y11 s7): a label laid on a profile curve (the legend once landed on the hump). A label's
  // ink (its box less 2 pt a side and the top and bottom quarters of its line box) holds no sample.
  for (const c of children)
    if (c.type === "path" && /profile/i.test(c.name ?? "")) {
      // FIX-ENERGY: sampled as the renderer draws it (`pathSegments`: a monotone cubic for a
      // left-to-right graph). The Catmull-Rom model used before overshot each plateau, and on a
      // tall plot named a label hanging under the products' level as sitting on the curve.
      const p = c as PathElement;
      for (const q of samplePath(pathSegments(p, p.w, p.h), 24)) {
        const x = p.x + q.x;
        const y = p.y + q.y;
        if (
          texts.some(
            (t) => x > t.x + 2 && x < t.x + t.w - 2 && y > t.y + t.h * 0.25 && y < t.y + t.h * 0.75,
          )
        )
          out.push("a figure label sits on a curve");
      }
    }
  return [...new Set(out)];
}

/**
 * Register diagrams-02: `labelRule` on `spec` drawn at `size`; empty when every label reads clear.
 * A warning for logs and sweeps, never a reason to refuse a drawing (Greg, 10 Oct: checks must not
 * throw visuals away).
 */
export function labelClashes(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number; fs?: number },
): string[] {
  if (diagramFaults(spec, theme, size).includes("it does not draw")) return [];
  const probe = lastDiagramProbe();
  return probe ? [...new Set(labelRule(probe.rec, probe.strokes, probe.leaders, probe.parts))] : [];
}

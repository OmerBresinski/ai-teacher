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
import { diagramFaults, lastDiagramProbe } from "./index";
import { TYPE_FLOOR } from "./style";

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
  for (const b of probe.rec)
    if ((b.fs ?? TYPE_FLOOR) < TYPE_FLOOR - 0.01)
      out.push(`the label "${b.text}" is set at ${b.fs} pt, under the ${TYPE_FLOOR} pt floor`);
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
  return [...new Set(out)];
}

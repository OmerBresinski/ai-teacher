/**
 * Figure templates (ADR 0031) — TEACH-164 spike prototypes, not production code.
 *
 * A template takes the values and labels a model would supply and draws the geometry itself,
 * returning one `group` of native elements in a rect on the slide. Two templates:
 *
 * - `rightTriangleFigure`: three `line`s, a right-angle mark and three labels, all elements the
 *   slide model already has.
 * - `energyProfileFigure`: axes, a smooth `path` for the curve, and the activation-energy and
 *   energy-change arrows.
 *
 * Both draw in proportion to their values and clamp extreme ratios; a clamped figure carries a
 * "Not drawn to scale" caption. Labels always carry the values as given.
 */
import type {
  GroupElement,
  LineElement,
  PathElement,
  SlideElement,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { SLIDE_H } from "@tj/domain/documents";
import { newText, uid } from "./factories";
import { SAFE } from "./grid";
import { boxH } from "./layouts";

type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

export type Figure = { group: GroupElement; notToScale: boolean };

const STROKE = 3;
const THIN = 2.5;
/** A horizontal or vertical line still gets a box this tall (or wide) to select it by. */
const LINE_BOX = 16;

/* ------------------------------------------------------------------ */
/* Element helpers (group-local coordinates)                           */
/* ------------------------------------------------------------------ */

function line(a: Point, b: Point, props: Partial<LineElement> = {}): LineElement {
  let x = Math.min(a.x, b.x);
  let y = Math.min(a.y, b.y);
  let w = Math.abs(b.x - a.x);
  let h = Math.abs(b.y - a.y);
  if (w < LINE_BOX) {
    x -= (LINE_BOX - w) / 2;
    w = LINE_BOX;
  }
  if (h < LINE_BOX) {
    y -= (LINE_BOX - h) / 2;
    h = LINE_BOX;
  }
  return {
    id: uid(),
    type: "line",
    x,
    y,
    w,
    h,
    from: { x: (a.x - x) / w, y: (a.y - y) / h },
    to: { x: (b.x - x) / w, y: (b.y - y) / h },
    strokeWidth: STROKE,
    ...props,
  };
}

/** A line lengthened by half its stroke at both ends, so butt caps close a corner. */
function edge(a: Point, b: Point, props: Partial<LineElement> = {}): LineElement {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = ((b.x - a.x) / len) * (STROKE / 2);
  const uy = ((b.y - a.y) / len) * (STROKE / 2);
  return line({ x: a.x - ux, y: a.y - uy }, { x: b.x + ux, y: b.y + uy }, props);
}

/** The rendered size of a figure label: the `small` stop, never below its 24pt floor. */
const labelSize = (t: Theme) => Math.max(t.sizes.small, 24);
/** Rough advance width, for placing a label clear of a line; the box is wider than this. */
const textWidth = (t: Theme, text: string) => Math.ceil(text.length * labelSize(t) * 0.58);

function label(
  t: Theme,
  text: string,
  at: Point,
  align: "left" | "center" | "right" = "center",
  extra: Partial<TextElement> = {},
): TextElement {
  const h = boxH(t, "small");
  const w = Math.max(40, textWidth(t, text) + 16);
  const x = align === "center" ? at.x - w / 2 : align === "right" ? at.x - w : at.x;
  const el = newText("small", text, { x, y: at.y - h / 2, w, h }, extra);
  el.style = { ...el.style, align, valign: "middle", color: t.colors.ink, padding: 0 };
  return el;
}

function notToScaleCaption(t: Theme, rect: Rect): TextElement {
  const h = boxH(t, "small");
  const el = label(t, "Not drawn to scale", { x: 0, y: rect.h - h / 2 }, "left");
  el.style = { ...el.style, color: t.colors.muted };
  return el;
}

function group(rect: Rect, name: string, children: SlideElement[]): GroupElement {
  return { id: uid(), type: "group", name, ...rect, children };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* right-triangle                                                      */
/* ------------------------------------------------------------------ */

export type FigureSide = { length?: number; label: string };
export type RightTriangleValues = {
  /** The horizontal leg, the vertical leg and the hypotenuse; at least two carry a length. */
  base: FigureSide;
  height: FigureSide;
  hypotenuse: FigureSide;
};

/** Height over base is drawn between these; outside them the figure is not to scale. */
const TRIANGLE_RATIO = { min: 0.4, max: 2.5 } as const;

/** The two legs' lengths, from any two sides; three sides must satisfy a² + b² = c². */
export function rightTriangleLegs(v: RightTriangleValues): { base: number; height: number } {
  const a = v.base.length;
  const b = v.height.length;
  const c = v.hypotenuse.length;
  if (a && b) {
    if (c && Math.abs(a * a + b * b - c * c) > 0.01 * c * c)
      throw new Error(`right-triangle: ${a}² + ${b}² ≠ ${c}²`);
    return { base: a, height: b };
  }
  if (c && a && c > a) return { base: a, height: Math.sqrt(c * c - a * a) };
  if (c && b && c > b) return { base: Math.sqrt(c * c - b * b), height: b };
  throw new Error("right-triangle: needs two side lengths, and the hypotenuse is the longest");
}

export function rightTriangleFigure(t: Theme, v: RightTriangleValues, rect: Rect): Figure {
  const legs = rightTriangleLegs(v);
  const ratio = legs.height / legs.base;
  const drawn = clamp(ratio, TRIANGLE_RATIO.min, TRIANGLE_RATIO.max);
  const notToScale = drawn !== ratio;

  const labelH = boxH(t, "small");
  const heightLabelW = textWidth(t, v.height.label) + 24;
  const hypLabelW = textWidth(t, v.hypotenuse.label) + 24;
  const area = {
    x: heightLabelW,
    y: labelH,
    w: rect.w - heightLabelW - hypLabelW,
    h: rect.h - labelH - (labelH + 16) - (notToScale ? labelH + 8 : 0),
  };
  let W = area.w;
  let H = W * drawn;
  if (H > area.h) {
    H = area.h;
    W = H / drawn;
  }
  const A = { x: area.x + (area.w - W) / 2, y: area.y + (area.h + H) / 2 };
  const B = { x: A.x + W, y: A.y };
  const C = { x: A.x, y: A.y - H };

  const mark = clamp(Math.min(W, H) * 0.12, 14, 24);
  const L = Math.hypot(W, H);
  const normal = { x: H / L, y: -W / L }; // away from the right angle
  const hypMid = { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 };
  const hypOffset =
    14 +
    Math.abs(normal.x) * (textWidth(t, v.hypotenuse.label) / 2) +
    Math.abs(normal.y) * (labelH / 2);

  const children: SlideElement[] = [
    edge(A, B, { stroke: t.colors.ink, name: "Base" }),
    edge(A, C, { stroke: t.colors.ink, name: "Height" }),
    edge(C, B, { stroke: t.colors.ink, name: "Hypotenuse" }),
    line(
      { x: A.x, y: A.y - mark },
      { x: A.x + mark, y: A.y - mark },
      {
        stroke: t.colors.ink,
        strokeWidth: 2,
        name: "Right angle",
      },
    ),
    line(
      { x: A.x + mark, y: A.y - mark },
      { x: A.x + mark, y: A.y },
      {
        stroke: t.colors.ink,
        strokeWidth: 2,
        name: "Right angle",
      },
    ),
    label(t, v.base.label, { x: (A.x + B.x) / 2, y: A.y + 12 + labelH / 2 }),
    label(t, v.height.label, { x: A.x - 12, y: (A.y + C.y) / 2 }, "right"),
    label(t, v.hypotenuse.label, {
      x: hypMid.x + normal.x * hypOffset,
      y: hypMid.y + normal.y * hypOffset,
    }),
  ];
  if (notToScale) children.push(notToScaleCaption(t, rect));
  return { group: group(rect, "Right-angled triangle", children), notToScale };
}

/* ------------------------------------------------------------------ */
/* energy-profile                                                      */
/* ------------------------------------------------------------------ */

export type EnergyProfileValues = {
  reactants: string;
  products: string;
  /** From the reactants' level up to the peak; positive. */
  activationEnergy: number;
  /** Products minus reactants: negative for an exothermic reaction. */
  energyChange: number;
  activationLabel?: string;
  changeLabel?: string;
  energyAxis?: string;
  progressAxis?: string;
};

/** Shares of the level span the drawing keeps, so levels and the peak never merge. */
const LEVEL_GAP = 0.2;
const PEAK_GAP = 0.25;
/** Along the curve: the reactants' plateau ends, the peak, the products' plateau starts. */
const CURVE_X = { reactantsEnd: 0.24, peak: 0.45, productsStart: 0.66 } as const;

export function energyProfileFigure(t: Theme, v: EnergyProfileValues, rect: Rect): Figure {
  if (!(v.activationEnergy > 0) || v.activationEnergy <= v.energyChange)
    throw new Error("energy-profile: the peak must sit above both levels");

  // Levels as drawn: reactants at 0. Clamp a near-zero change and a shallow peak apart.
  const reactants = 0;
  let products = v.energyChange;
  let peak = v.activationEnergy;
  let notToScale = false;
  const span = () => peak - Math.min(reactants, products);
  if (Math.abs(products - reactants) < LEVEL_GAP * span()) {
    products = reactants + (products < reactants ? -1 : 1) * LEVEL_GAP * span();
    notToScale = true;
  }
  if (peak - Math.max(reactants, products) < PEAK_GAP * span()) {
    peak = Math.max(reactants, products) + PEAK_GAP * span();
    notToScale = true;
  }

  const labelH = boxH(t, "small");
  const axisX = labelH + 12;
  const axisY = rect.h - labelH - 16 - (notToScale ? labelH + 8 : 0);
  const plot = {
    left: axisX + 16,
    right: rect.w - 12,
    top: 20,
    // Room under the lower plateau for its name.
    bottom: axisY - labelH - 14,
  };
  const low = Math.min(reactants, products);
  const yOf = (e: number) => plot.bottom - ((e - low) / (peak - low)) * (plot.bottom - plot.top);
  const xOf = (f: number) => plot.left + f * (plot.right - plot.left);
  const yR = yOf(reactants);
  const yP = yOf(products);
  const yT = yOf(peak);

  const curve: Point[] = [
    { x: xOf(0), y: yR },
    { x: xOf(CURVE_X.reactantsEnd), y: yR },
    { x: xOf(CURVE_X.peak), y: yT },
    { x: xOf(CURVE_X.productsStart), y: yP },
    { x: xOf(1), y: yP },
  ];
  const box = {
    x: xOf(0),
    y: yT,
    w: xOf(1) - xOf(0),
    h: Math.max(yR, yP) - yT,
  };
  const path: PathElement = {
    id: uid(),
    type: "path",
    ...box,
    points: curve.map((p) => ({ x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h })),
    smooth: true,
    stroke: t.colors.accent,
    strokeWidth: 4,
    name: "Reaction profile",
  };

  const peakX = xOf(CURVE_X.peak);
  const changeX = xOf(0.94);
  const ea = v.activationLabel ?? "Ea";
  const dh = v.changeLabel ?? "ΔH";
  const guide = { stroke: t.colors.muted, strokeWidth: 2, dash: "dashed" as const };
  const arrow = { stroke: t.colors.ink, strokeWidth: THIN, arrowEnd: true };
  const energyAxis = label(t, v.energyAxis ?? "Energy", { x: labelH / 2, y: (axisY + 8) / 2 });
  energyAxis.rotation = 270; // [0, 360) as the editor stores it; PPTX readers ignore a negative angle

  const children: SlideElement[] = [
    line({ x: axisX, y: axisY }, { x: axisX, y: 4 }, { ...arrow, name: "Energy axis" }),
    line({ x: axisX, y: axisY }, { x: rect.w - 4, y: axisY }, { ...arrow, name: "Progress axis" }),
    energyAxis,
    label(t, v.progressAxis ?? "Progress of reaction", {
      x: (axisX + rect.w) / 2,
      y: axisY + 10 + labelH / 2,
    }),
    // Reactants' level carried across, for both arrows to start from.
    line({ x: xOf(CURVE_X.reactantsEnd), y: yR }, { x: changeX + 14, y: yR }, guide),
    path,
    line({ x: peakX, y: yR }, { x: peakX, y: yT }, { ...arrow, name: "Activation energy" }),
    // Left of the arrow, low down: the rising side is furthest from the arrow there.
    label(t, ea, { x: peakX - 8, y: yR - 0.25 * (yR - yT) }, "right"),
    line({ x: changeX, y: yR }, { x: changeX, y: yP }, { ...arrow, name: "Energy change" }),
    label(t, dh, { x: changeX - 8, y: (yR + yP) / 2 }, "right"),
    label(t, v.reactants, { x: xOf(0), y: yR + 10 + labelH / 2 }, "left"),
    // Under the plateau when it is the lower level; over it when higher, clear of the ΔH arrow.
    label(
      t,
      v.products,
      { x: xOf(1), y: yP < yR ? yP - 10 - labelH / 2 : yP + 10 + labelH / 2 },
      "right",
    ),
  ];
  if (notToScale) children.push(notToScaleCaption(t, rect));
  return { group: group(rect, "Energy profile", children), notToScale };
}

/* ------------------------------------------------------------------ */
/* The diagram slide (ADR 0031 item 2)                                 */
/* ------------------------------------------------------------------ */

/** Where a diagram slide puts its figure: the left of the slide, inside the safe area. */
export const FIGURE_RECT: Rect = { x: 40, y: SAFE.y, w: 520, h: SAFE.h };

/** A diagram slide's elements: the figure left, caption, heading and body right. */
export function diagramSlideElements(
  t: Theme,
  figure: Figure,
  copy: { caption?: string; heading: string; body: string },
): SlideElement[] {
  const X = 600;
  const W = SAFE.x + SAFE.w - X;
  const capH = boxH(t, "caption");
  const headH = boxH(t, "heading", 2);
  const bodyH = boxH(t, "body", 5);
  const top = Math.round((SLIDE_H - (capH + 12 + headH + 19 + bodyH)) / 2);
  const caption = newText("caption", copy.caption ?? "DIAGRAM", { x: X, y: top, w: W, h: capH });
  caption.style = { ...caption.style, color: t.colors.muted };
  return [
    figure.group,
    caption,
    newText("heading", copy.heading, { x: X, y: top + capH + 12, w: W, h: headH }),
    newText("body", copy.body, { x: X, y: top + capH + 12 + headH + 19, w: W, h: bodyH }),
  ];
}

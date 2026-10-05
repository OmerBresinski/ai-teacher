/**
 * The `energy-profile` Figure template (ADR 0032, TEACH-94): a reaction profile (energy level
 * diagram) as AQA 8464 §5.5.1.2 asks pupils to draw one, for an exothermic or an endothermic
 * reaction. The reactants' and products' levels and the curve over the peak between them are one
 * smooth `path` (a monotone cubic, so the plateaus stay flat and nothing is drawn above the peak);
 * the activation energy and the energy change are vertical arrows from the reactants' level, and
 * every label is `small` text. The levels are in proportion to the values, clamped so they stay
 * apart and the labels between them fit; a clamped drawing, or the fallback drawn from values it
 * cannot draw, is captioned "Not drawn to scale". No text is rotated: Apple's PPTX importer draws
 * a rotated text box flat (TEACH-164 spike, PR #317), so the energy axis is named above its arrow.
 *
 * Load it through `./index` or the package root, never first on its own (see `./right-triangle`).
 */

import type { PathElement, SlideElement, Theme } from "@tj/domain/documents";
import { z } from "zod";
import { STROKE as LADDER, look } from "../diagrams/style";
import { editorialIssue } from "../editorial";
import { uid } from "../factories";
import { boxH } from "../layouts";
import { pathSegments, samplePath } from "../path";
import type { FigureDrawing, FigureTemplate } from "./index";
import { type FittedLabel, fitLabel, type LabelFit, labelText, notToScaleCaption } from "./labels";
import { segment } from "./marks";

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/** Longest each label may be: the substances' names, the arrows' symbols and the axis names. */
export const ENERGY_PROFILE_LABEL_MAX = { name: 24, arrow: 8, axis: 24 } as const;

/** The two levels' names and energies, and the optional labels, with no rules. */
const energyProfileShape = z.object({
  reactants: z.string(),
  products: z.string(),
  /** From the reactants' level up to the peak. */
  activationEnergy: z.number(),
  /** Products minus reactants: negative for an exothermic reaction. */
  energyChange: z.number(),
  /** "Ea" when absent. */
  activationLabel: z.string().optional(),
  /** "ΔH" when absent. */
  changeLabel: z.string().optional(),
  /** "Energy" when absent. */
  energyAxis: z.string().optional(),
  /** "Progress of reaction" when absent. */
  progressAxis: z.string().optional(),
});

/**
 * Code-only extras (not on the writer's shape): a second, catalysed profile between the same two
 * levels with a lower peak, drawn dashed (DIAGRAM-AUDIT: every real energy-profile slide compared
 * catalysed and uncatalysed reactions).
 */
const energyProfileFull = energyProfileShape.extend({
  /** From the reactants' level up to the catalysed peak: above both levels, below the main peak. */
  catalysedActivationEnergy: z.number().optional(),
  /** "With catalyst" when absent. */
  catalysedLabel: z.string().optional(),
});
export type EnergyProfileValues = z.infer<typeof energyProfileFull>;

const LABEL_CAPS = [
  ["reactants", ENERGY_PROFILE_LABEL_MAX.name],
  ["products", ENERGY_PROFILE_LABEL_MAX.name],
  ["activationLabel", ENERGY_PROFILE_LABEL_MAX.arrow],
  ["changeLabel", ENERGY_PROFILE_LABEL_MAX.arrow],
  ["energyAxis", ENERGY_PROFILE_LABEL_MAX.axis],
  ["progressAxis", ENERGY_PROFILE_LABEL_MAX.axis],
] as const;

/** The peak sits above both levels: above the reactants' (0) and above the products'. */
const peakAboveLevels = (v: Pick<EnergyProfileValues, "activationEnergy" | "energyChange">) =>
  v.activationEnergy > Math.max(0, v.energyChange);

/**
 * What the model supplies for a reaction profile. Every rule is editorial: a miss becomes a
 * finding for Repair, never a failed Generate stage, and the drawing copes with it.
 */
export const energyProfileValuesSchema = energyProfileFull.superRefine((v, ctx) => {
  if (!peakAboveLevels(v))
    ctx.addIssue(
      editorialIssue(
        "The peak sits above both levels: make activationEnergy greater than 0 and greater than energyChange.",
        ["activationEnergy"],
      ),
    );
  for (const [key, max] of LABEL_CAPS) {
    if ((v[key]?.length ?? 0) > max)
      ctx.addIssue(editorialIssue(`Keep ${key} to ${max} characters or fewer.`, [key]));
  }
});

/** A number as the alt text says it, with a true minus sign. */
const spoken = (n: number) => (n < 0 ? `−${-n}` : `${n}`);

/**
 * What a screen reader hears for the figure: "Energy profile of an exothermic reaction from
 * methane and oxygen to carbon dioxide and water. Activation energy 50, energy change −90."
 * " Not drawn to scale." follows when it is not; values of the wrong shape say only that.
 */
export function energyProfileAlt(values: EnergyProfileValues | undefined, notToScale: boolean) {
  const scale = notToScale ? " Not drawn to scale." : "";
  if (!values) return `Energy profile.${scale}`;
  const kind = values.energyChange > 0 ? "endothermic" : "exothermic";
  const reactants = values.reactants.trim();
  const products = values.products.trim();
  const from = reactants ? ` from ${reactants}` : "";
  const to = products ? ` to ${products}` : "";
  const cat = values.catalysedActivationEnergy;
  const energies = `Activation energy ${spoken(values.activationEnergy)}, energy change ${spoken(values.energyChange)}.${cat !== undefined ? ` With a catalyst the activation energy is ${spoken(cat)}.` : ""}`;
  return `Energy profile of an ${kind} reaction${from}${to}. ${energies}${scale}`;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

type Box = { x: number; y: number; w: number; h: number };

/** Across the plot: the reactants' plateau ends, the peak, the products' plateau starts, ΔH. */
const CURVE_X = { reactantsEnd: 0.24, peak: 0.45, productsStart: 0.66, change: 0.94 } as const;
/** Shares of the drawn span (lowest level to peak) kept at least between the levels, and above. */
const LEVEL_GAP = 0.2;
const PEAK_GAP = 0.25;
/** The shape drawn from values whose peak is not above both levels: an exothermic profile. */
const FALLBACK = { activationEnergy: 2, energyChange: -3 };
/** The energy axis, and the plot's edges from it and from the box. */
const AXIS_X = 12;
const PLOT_LEFT = AXIS_X + 16;
const PLOT_RIGHT_INSET = 12;
/** The horizontal axis's arrow stops this far short of the box's right edge. */
const AXIS_END_INSET = 4;
/** From the energy axis's name down to its arrow's tip, and down to the peak. */
const AXIS_TOP_GAP = 4;
const PEAK_TOP_GAP = 20;
/** Under the horizontal axis, and from the lower plateau down to the axis, past its name. */
const AXIS_BOTTOM_GAP = 16;
const PLATEAU_AXIS_GAP = 14;
/** The catalysed peak stands this share of the curve's width right of the main one, so each Ea arrow has its own peak. */
const CAT_PEAK_SHIFT = 0.07;
const PROGRESS_GAP = 10;
/** Above the "Not drawn to scale" caption. */
const CAPTION_GAP = 8;
/** The reactants' level guide runs this far past the ΔH arrow. */
const GUIDE_OVERHANG = 14;
/** Between a level and the name hanging under it or standing on it. */
const NAME_GAP = 10;
/** Between an arrow and the label beside it. */
const ARROW_LABEL_GAP = 6;
/** Between a label and a line it runs along (a level, the guide) or the edge of its room. */
const CLEAR = 2;
/** The reactants' name ends, and the products' name starts, this far from the peak's x. */
const LANE_GAP = 4;
/**
 * An arrow label's box is only this much wider than its text: "Ea" sits in the narrow space
 * between the rising curve and its arrow, where the default slack would not fit.
 */
const ARROW_LABEL_SLACK = 4;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * The drawn shares of the span: between the two levels, and from the higher level up to the
 * peak. In proportion to the values unless one is under its minimum; it is then raised to that
 * minimum of the final span, which never pushes the other under its own while the two minimums
 * leave room for each other. When they do not, each gets its minimum's share of the whole, and
 * the caller cuts a label shorter and lays out again.
 */
function shares(
  activationEnergy: number,
  energyChange: number,
  min: { levels: number; peak: number },
): { levels: number; peak: number; clamped: boolean } {
  const total = min.levels + min.peak;
  if (total >= 1) return { levels: min.levels / total, peak: min.peak / total, clamped: true };
  let levels = Math.abs(energyChange);
  let peak = activationEnergy - Math.max(0, energyChange);
  let clamped = false;
  // L ≥ m·(L + P) ⟺ L ≥ P·m / (1 − m), and the same for P.
  if (levels < min.levels * (levels + peak)) {
    levels = (peak * min.levels) / (1 - min.levels);
    clamped = true;
  } else if (peak < min.peak * (levels + peak)) {
    peak = (levels * min.peak) / (1 - min.peak);
    clamped = true;
  }
  return { levels: levels / (levels + peak), peak: peak / (levels + peak), clamped };
}

type LabelKey = "energy" | "progress" | "reactants" | "products" | "activation" | "change";
const LABEL_KEYS: readonly LabelKey[] = [
  "energy",
  "progress",
  "reactants",
  "products",
  "activation",
  "change",
];
type Labels = Record<LabelKey, FittedLabel>;

function drawEnergyProfile(
  values: EnergyProfileValues | undefined,
  t: Theme,
  size: { w: number; h: number },
): FigureDrawing {
  const valid = values !== undefined && peakAboveLevels(values);
  const { activationEnergy, energyChange } = valid ? values : FALLBACK;
  const exothermic = energyChange <= 0;
  const labelH = boxH(t, "small");

  // Across: the plot, and where the plateaus, the peak and the ΔH arrow are on it.
  const plotRight = size.w - PLOT_RIGHT_INSET;
  const xOf = (f: number) => PLOT_LEFT + f * (plotRight - PLOT_LEFT);
  const reactantsEnd = xOf(CURVE_X.reactantsEnd);
  const peakX = xOf(CURVE_X.peak);
  const productsStart = xOf(CURVE_X.productsStart);
  const changeX = xOf(CURVE_X.change);

  // What each label says, and how wide its place lets it be. The names keep to their own side of
  // the peak, the products' name running to the box's right edge; standing on an endothermic
  // reaction's higher level, it keeps over its plateau. "Ea" keeps inside the room its fallback
  // place has (see `activationBox`). "ΔH" keeps between the levels right of the falling curve,
  // which is below the reactants' level only when exothermic; endothermic, the band between the
  // levels is clear back to the activation-energy arrow.
  const arrowFit = { slack: ARROW_LABEL_SLACK, minW: 0 };
  const wording: Record<LabelKey, { text: string; fit: LabelFit }> = {
    energy: { text: values?.energyAxis ?? "Energy", fit: { maxW: size.w } },
    progress: { text: values?.progressAxis ?? "Progress of reaction", fit: { maxW: size.w } },
    reactants: { text: values?.reactants ?? "", fit: { maxW: peakX - LANE_GAP - PLOT_LEFT } },
    products: {
      text: values?.products ?? "",
      fit: { maxW: size.w - (exothermic ? peakX + LANE_GAP : productsStart) },
    },
    activation: {
      text: values?.activationLabel ?? "Ea",
      fit: { ...arrowFit, maxW: reactantsEnd - CLEAR - (AXIS_X + ARROW_LABEL_GAP) },
    },
    change: {
      text: values?.changeLabel ?? "ΔH",
      fit: {
        ...arrowFit,
        maxW: changeX - ARROW_LABEL_GAP - (exothermic ? productsStart : peakX + ARROW_LABEL_GAP),
      },
    },
  };

  // Beside its arrow, "Ea" sits between the arrow and the rising curve. From the reactants'
  // plateau up to the peak the curve is one cubic with level ends and its control points a third
  // of the way along, so a fraction τ of the way across it has risen smoothstep(τ) of the way
  // up: the box clears the curve while its top is below that height at its left edge.
  const riseSpan = peakX - reactantsEnd;
  const reachOf = (a: FittedLabel) => (peakX - ARROW_LABEL_GAP - a.w - reactantsEnd) / riseSpan;
  const clearsRise = (a: FittedLabel, above: number, rise: number) =>
    reachOf(a) > 0 && above <= smoothstep(reachOf(a)) * rise;

  // Down: the energy axis's name, the plot, the lower plateau's names, the axis, its name, the
  // caption. A label standing on a level (the products' name when endothermic, "Ea" in its
  // fallback place over the reactants' plateau) needs room up to the energy axis's name.
  const frame = (labels: Labels, notToScale: boolean) => {
    const plotTop = labels.energy.h + PEAK_TOP_GAP;
    const standing = (h: number) => h + NAME_GAP + CLEAR - PEAK_TOP_GAP;
    const axisY =
      size.h - labels.progress.h - AXIS_BOTTOM_GAP - (notToScale ? labelH + CAPTION_GAP : 0);
    const hanging = exothermic
      ? Math.max(labels.reactants.h, labels.products.h)
      : labels.reactants.h;
    // Modern looks: the hanging names stand clear of the axis.
    const plotBottom = axisY - hanging - PLATEAU_AXIS_GAP - (look().preset === "current" ? 0 : 10);
    const height = Math.max(1, plotBottom - plotTop);
    const levelsMin = Math.max(LEVEL_GAP, (labels.change.h + 2 * CLEAR) / height);
    // The rise "Ea" needs beside its arrow as low as it goes, just over the guide. Exothermic, it
    // climbs only the peak's share; endothermic, the whole span.
    const reach = reachOf(labels.activation);
    const besideRise = reach > 0 ? (CLEAR + labels.activation.h) / smoothstep(reach) : Infinity;
    const beside = besideRise <= (exothermic ? height * (1 - levelsMin) : height);
    const peakNeed = exothermic
      ? beside
        ? besideRise
        : standing(labels.activation.h)
      : standing(labels.products.h);
    const peakMin = Math.max(PEAK_GAP, peakNeed / height);
    const drawn = shares(activationEnergy, energyChange, { levels: levelsMin, peak: peakMin });
    // Endothermic, "Ea" in its fallback place stands on the lower level: the whole span holds it.
    const activationFits = exothermic || beside || standing(labels.activation.h) <= height;
    const fits = levelsMin + peakMin <= 1 && activationFits;
    return { plotTop, axisY, plotBottom, height, beside, drawn, fits };
  };
  // The caption takes room from the plot, so a drawing the first pass clamps is laid out again.
  const layout = (labels: Labels) => {
    const first = frame(labels, !valid);
    const notToScale = !valid || first.drawn.clamped;
    return { ...(valid && first.drawn.clamped ? frame(labels, true) : first), notToScale };
  };

  // When the labels cannot all fit at full length, the one with the most lines loses a line,
  // until they fit or each is down to one; the alt text keeps every label whole.
  const maxLines: Partial<Record<LabelKey, number>> = {};
  const fitAll = () =>
    Object.fromEntries(
      LABEL_KEYS.map((key) => [
        key,
        fitLabel(t, wording[key].text, { ...wording[key].fit, maxLines: maxLines[key] }),
      ]),
    ) as Labels;
  let labels = fitAll();
  let plan = layout(labels);
  while (!plan.fits) {
    const tallest = LABEL_KEYS.reduce((a, b) => (labels[b].lines > labels[a].lines ? b : a));
    if (labels[tallest].lines === 1) break;
    maxLines[tallest] = labels[tallest].lines - 1;
    labels = fitAll();
    plan = layout(labels);
  }
  const { plotTop, axisY, plotBottom, height, beside, drawn, notToScale } = plan;

  const higher = plotBottom - drawn.levels * height;
  const yR = exothermic ? higher : plotBottom;
  const yP = exothermic ? plotBottom : higher;
  const rise = yR - plotTop;

  const activationBox = (): Box => {
    const a = labels.activation;
    const quarter = yR - rise / 4 - a.h / 2;
    if (beside) {
      // A quarter of the way up when that clears the curve, else as low as it goes.
      const lowest = yR - CLEAR - a.h;
      const y = Math.min(lowest, quarter);
      const x = peakX - ARROW_LABEL_GAP - a.w;
      return { x, y: clearsRise(a, yR - y, rise) ? y : lowest, w: a.w, h: a.h };
    }
    // Too wide to fit beside the arrow: over the reactants' plateau, clear of the curve.
    const lowest = yR - NAME_GAP - a.h;
    const y = Math.min(lowest, Math.max(labels.energy.h + CLEAR, quarter));
    return { x: reactantsEnd - CLEAR - a.w, y, w: a.w, h: a.h };
  };
  const box = (l: FittedLabel, x: number, y: number): Box => ({ x, y, w: l.w, h: l.h });
  const progressX = (AXIS_X + size.w) / 2 - labels.progress.w / 2;
  const placed = {
    energy: box(labels.energy, 0, 0),
    progress: box(
      labels.progress,
      Math.max(0, Math.min(size.w - labels.progress.w, progressX)),
      axisY + PROGRESS_GAP,
    ),
    reactants: box(labels.reactants, PLOT_LEFT, yR + NAME_GAP),
    products: box(
      labels.products,
      size.w - labels.products.w,
      exothermic ? yP + NAME_GAP : yP - NAME_GAP - labels.products.h,
    ),
    activation: activationBox(),
    change: box(
      labels.change,
      changeX - ARROW_LABEL_GAP - labels.change.w,
      (yR + yP) / 2 - labels.change.h / 2,
    ),
  };

  const curveBox = { x: xOf(0), y: plotTop, w: xOf(1) - xOf(0), h: height };
  const at = (y: number) => (y - plotTop) / height;
  const curve: PathElement = {
    id: uid(),
    type: "path",
    ...curveBox,
    points: [
      { x: 0, y: at(yR) },
      { x: CURVE_X.reactantsEnd, y: at(yR) },
      { x: CURVE_X.peak, y: 0 },
      { x: CURVE_X.productsStart, y: at(yP) },
      { x: 1, y: at(yP) },
    ],
    smooth: true,
    stroke: t.colors.accent,
    strokeWidth: LADDER.data,
    name: "Reaction profile",
  };
  const arrow = { stroke: t.colors.ink, strokeWidth: LADDER.line, arrowEnd: true };
  // The catalysed profile: the same levels, a lower peak (its share of the main hump kept between
  // 0.3 and 0.8 so the two read apart), dashed in the second colour and named under its peak.
  /** The catalysed peak's height, or undefined when no catalysed curve is drawn. */
  const catPeak = (() => {
    const cat = valid ? values?.catalysedActivationEnergy : undefined;
    if (cat === undefined || !(cat > Math.max(0, energyChange)) || !(cat < activationEnergy))
      return undefined;
    const k = Math.min(
      0.8,
      Math.max(
        0.3,
        (cat - Math.max(0, energyChange)) / (activationEnergy - Math.max(0, energyChange)),
      ),
    );
    return Math.min(yR, yP) - (Math.min(yR, yP) - plotTop) * k;
  })();
  /** The catalysed curve: the same levels, its lower peak a little right of the main one. */
  const catCurve: PathElement | undefined =
    catPeak === undefined
      ? undefined
      : ({
          ...curve,
          id: uid(),
          points: curve.points.map((p, i) =>
            i === 2 ? { x: p.x + CAT_PEAK_SHIFT, y: at(catPeak) } : p,
          ),
          stroke: t.colors.accent2,
          dash: "dashed",
          name: "Catalysed profile",
        } as PathElement);
  /** A curve's highest point as drawn (the smooth path sampled), in the figure's points. */
  const topOf = (el: PathElement) => {
    const ps = samplePath(pathSegments(el, el.w, el.h), 48);
    const p = ps.reduce((a, b) => (b.y < a.y ? b : a));
    return { x: el.x + p.x, y: el.y + p.y };
  };
  const mainTop = topOf(curve);
  const catTop = catCurve ? topOf(catCurve) : undefined;

  /**
   * The collision pass (DIAGRAM-AUDIT): every curve sampled as drawn (the smooth path's cubic
   * segments), the arrows, and the labels already set. `clearSpot` gives the first candidate that
   * clears them all and sits inside the figure with a margin; the first candidate otherwise.
   */
  const strokes = (): [{ x: number; y: number }, { x: number; y: number }][] => {
    const abs = (q: { x: number; y: number }) => ({
      x: curveBox.x + q.x * curveBox.w,
      y: curveBox.y + q.y * curveBox.h,
    });
    const smooth = (ps: { x: number; y: number }[]) => {
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i < ps.length - 1; i++) {
        const p0 = ps[i - 1] ?? ps[i];
        const p1 = ps[i] as { x: number; y: number };
        const p2 = ps[i + 1] as { x: number; y: number };
        const p3 = ps[i + 2] ?? p2;
        const c1 = {
          x: p1.x + (p2.x - (p0 as typeof p1).x) / 6,
          y: p1.y + (p2.y - (p0 as typeof p1).y) / 6,
        };
        const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
        for (let k = 0; k <= 16; k++) {
          const u = k / 16;
          const m = 1 - u;
          out.push({
            x: m * m * m * p1.x + 3 * m * m * u * c1.x + 3 * m * u * u * c2.x + u * u * u * p2.x,
            y: m * m * m * p1.y + 3 * m * m * u * c1.y + 3 * m * u * u * c2.y + u * u * u * p2.y,
          });
        }
      }
      return out;
    };
    const lines: [{ x: number; y: number }, { x: number; y: number }][] = [];
    const main = curve.points.map(abs);
    const curves = [smooth(main)];
    if (catCurve) curves.push(smooth(catCurve.points.map(abs)));
    for (const ps of curves)
      for (let i = 1; i < ps.length; i++) lines.push([ps[i - 1] as never, ps[i] as never]);
    lines.push(
      [{ x: mainTop.x, y: yR }, mainTop],
      [
        { x: changeX, y: yR },
        { x: changeX, y: yP },
      ],
      [
        { x: AXIS_X, y: axisY },
        { x: size.w, y: axisY },
      ],
    );
    if (catTop) lines.push([{ x: catTop.x, y: yR }, catTop]);
    return lines;
  };
  const MARGIN = 4;
  const inRoom = (b: Box) =>
    b.x >= MARGIN && b.y >= 0 && b.x + b.w <= size.w - MARGIN && b.y + b.h <= size.h;
  function clearSpot(candidates: Box[], taken: Box[]): Box {
    const lines = strokes();
    const hits = (b: Box) => {
      const pad = { x: b.x - 4, y: b.y - 2, w: b.w + 8, h: b.h + 4 };
      const inside = (x: number, y: number) =>
        x > pad.x && x < pad.x + pad.w && y > pad.y && y < pad.y + pad.h;
      for (const [p, q] of lines)
        for (let k = 0; k <= 8; k++)
          if (inside(p.x + ((q.x - p.x) * k) / 8, p.y + ((q.y - p.y) * k) / 8)) return true;
      return taken.some(
        (o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h,
      );
    };
    return candidates.find((b) => inRoom(b) && !hits(b)) ?? (candidates[0] as Box);
  }
  /** Every label kept inside the figure, `MARGIN` clear of its edges. */
  const inside = (b: Box): Box => ({
    ...b,
    // Flush left is allowed (the axis names start there); the right edge keeps a margin, which a
    // label wider than the room gives up before it would leave the box.
    x: Math.max(0, Math.min(size.w - Math.max(0, Math.min(MARGIN, size.w - b.w)) - b.w, b.x)),
    y: Math.max(0, Math.min(size.h - b.h, b.y)),
  });
  /**
   * The catalysed profile: the same levels, a lower peak, dashed in the second colour, with its own
   * Ea arrow beside the main one, and a legend with line samples naming both curves.
   */
  let legendBox: Box | undefined;
  function catalysed(): SlideElement[] {
    if (catPeak === undefined) return [];
    const name = (values?.catalysedLabel ?? "With catalyst").trim() || "With catalyst";
    const rows = [
      { text: "No catalyst", color: t.colors.accent, dash: undefined },
      { text: name, color: t.colors.accent2, dash: "dashed" as const },
    ].map((r) => ({
      ...r,
      l: fitLabel(t, r.text, {
        maxW: size.w * 0.6,
        slack: ARROW_LABEL_SLACK,
        minW: 0,
        maxLines: 1,
      }),
    }));
    const SAMPLE = 30;
    const rowH = Math.max(...rows.map((r) => r.l.h));
    const legend = { w: SAMPLE + 8 + Math.max(...rows.map((r) => r.l.w)), h: rowH * 2 };
    const taken = [
      placed.energy,
      placed.progress,
      placed.reactants,
      placed.products,
      placed.change,
    ];
    // Any free spot, scanned from the top right (where a legend is looked for first).
    const right = size.w - MARGIN - legend.w;
    const grid: Box[] = [];
    for (let y = 0; y + legend.h <= axisY; y += 8)
      for (let x = right; x >= PLOT_LEFT; x -= 12) grid.push({ x, y, ...legend });
    const spot = clearSpot(grid, taken);
    taken.push(spot);
    legendBox = spot;
    if (!catCurve || !catTop) return [];
    const out: SlideElement[] = [
      catCurve,
      segment({ x: catTop.x, y: yR }, catTop, {
        stroke: t.colors.accent2,
        strokeWidth: LADDER.line,
        arrowEnd: true,
        name: "Catalysed activation energy",
      }),
    ];
    rows.forEach((r, i) => {
      const cy = spot.y + rowH * (i + 0.5);
      out.push(
        segment(
          { x: spot.x, y: cy },
          { x: spot.x + SAMPLE, y: cy },
          {
            stroke: r.color,
            strokeWidth: LADDER.data,
            ...(r.dash ? { dash: r.dash } : {}),
            name: "Legend sample",
          },
        ),
        labelText(
          t,
          r.l.text,
          { x: spot.x + SAMPLE + 8, y: cy - r.l.h / 2, w: r.l.w, h: r.l.h },
          "left",
        ),
      );
    });
    return out;
  }
  /** "Ea" beside its arrow and clear of both curves, when a catalysed curve is drawn too. */
  const eaBox = (): Box => {
    const a = labels.activation;
    if (catPeak === undefined) return placed.activation;
    const taken = [
      placed.energy,
      placed.progress,
      placed.reactants,
      placed.products,
      placed.change,
    ];
    if (legendBox) taken.push(legendBox);
    // Nearest the arrow's middle first, either side, then a step further out.
    const mid = (yR + plotTop) / 2;
    const cands: Box[] = [];
    for (let d = 0; d <= (yR - plotTop) / 2; d += 6)
      for (const y of [mid - d, mid + d])
        for (const dx of [0, 10, 22, 36, 52])
          cands.push({ x: mainTop.x - ARROW_LABEL_GAP - a.w - dx, y: y - a.h / 2, w: a.w, h: a.h });
    // "Ea" names the main arrow from its left (the catalysed arrow stands to its right); else
    // right of it above the catalysed peak, where only the main arrow runs; else past both.
    if (catTop) {
      for (let y = catTop.y - a.h / 2 - CLEAR; y >= mainTop.y + a.h / 2; y -= 6)
        cands.push({ x: mainTop.x + ARROW_LABEL_GAP, y: y - a.h / 2, w: a.w, h: a.h });
      for (let d = 0; d <= (yR - plotTop) / 2; d += 6)
        for (const y of [mid - d, mid + d])
          cands.push({ x: catTop.x + ARROW_LABEL_GAP, y: y - a.h / 2, w: a.w, h: a.h });
    }
    return clearSpot(cands, taken);
  };
  // Modern looks: the axes recede (muted hairlines) so the curves lead.
  const axis =
    look().preset === "current"
      ? arrow
      : { ...arrow, stroke: t.colors.muted, strokeWidth: LADDER.hair };
  const children: SlideElement[] = [
    segment(
      { x: AXIS_X, y: axisY },
      { x: AXIS_X, y: labels.energy.h + AXIS_TOP_GAP },
      { ...axis, name: "Energy axis" },
    ),
    segment(
      { x: AXIS_X, y: axisY },
      { x: size.w - AXIS_END_INSET, y: axisY },
      { ...axis, name: "Progress axis" },
    ),
    // The reactants' level carried across, for both arrows to start from.
    segment(
      { x: reactantsEnd, y: yR },
      { x: changeX + GUIDE_OVERHANG, y: yR },
      {
        stroke: t.colors.muted,
        strokeWidth: LADDER.hair,
        dash: "dashed",
        name: "Reactants' level",
      },
    ),
    curve,
    ...catalysed(),
    segment({ x: mainTop.x, y: yR }, mainTop, { ...arrow, name: "Activation energy" }),
    segment({ x: changeX, y: yR }, { x: changeX, y: yP }, { ...arrow, name: "Energy change" }),
    labelText(t, labels.energy.text, inside(placed.energy), "left"),
    labelText(t, labels.progress.text, inside(placed.progress), "center"),
    labelText(t, labels.reactants.text, inside(placed.reactants), "left"),
    labelText(t, labels.products.text, inside(placed.products), "right"),
    labelText(t, labels.activation.text, inside(eaBox()), "right"),
    labelText(t, labels.change.text, inside(placed.change), "right"),
  ];
  if (notToScale) children.push(notToScaleCaption(t, size));
  return { children, alt: energyProfileAlt(values, notToScale) };
}

export const ENERGY_PROFILE: FigureTemplate<EnergyProfileValues> = {
  name: "Energy profile",
  shape: energyProfileFull,
  values: energyProfileValuesSchema,
  draw: drawEnergyProfile,
};

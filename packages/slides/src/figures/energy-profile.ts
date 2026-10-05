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
import { STROKE as LADDER } from "../diagrams/style";
import { editorialIssue } from "../editorial";
import { uid } from "../factories";
import { boxH } from "../layouts";
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
const PROGRESS_GAP = 10;
/** Above the "Not drawn to scale" caption. */
const CAPTION_GAP = 8;
const CURVE_STROKE = LADDER.data;
const ARROW_STROKE = LADDER.line;
const GUIDE_STROKE = LADDER.hair;
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
    const plotBottom = axisY - hanging - PLATEAU_AXIS_GAP;
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
    strokeWidth: CURVE_STROKE,
    name: "Reaction profile",
  };
  const arrow = { stroke: t.colors.ink, strokeWidth: ARROW_STROKE, arrowEnd: true };
  // The catalysed profile: the same levels, a lower peak (its share of the main hump kept between
  // 0.3 and 0.8 so the two read apart), dashed in the second colour and named under its peak.
  /**
   * The catalysed curve's name, through a small collision pass: the first candidate spot whose box
   * clears both curves (sampled), the arrows and every other label; the top right as a last resort.
   */
  function catalysedBox(l: { w: number; h: number }, yC: number): Box {
    const abs = (q: { x: number; y: number }, y?: number) => ({
      x: curveBox.x + q.x * curveBox.w,
      y: y ?? curveBox.y + q.y * curveBox.h,
    });
    const lines: [{ x: number; y: number }, { x: number; y: number }][] = [];
    const pts = curve.points.map((q) => abs(q));
    const cat = curve.points.map((q, i) => (i === 2 ? abs(q, yC) : abs(q)));
    for (const ps of [pts, cat])
      for (let i = 1; i < ps.length; i++) lines.push([ps[i - 1] as never, ps[i] as never]);
    lines.push(
      [
        { x: peakX, y: yR },
        { x: peakX, y: plotTop },
      ],
      [
        { x: changeX, y: yR },
        { x: changeX, y: yP },
      ],
    );
    const others = Object.values(placed) as Box[];
    const hits = (b: Box) => {
      const pad = { x: b.x - 6, y: b.y - 4, w: b.w + 12, h: b.h + 8 };
      const inside = (x: number, y: number) =>
        x > pad.x && x < pad.x + pad.w && y > pad.y && y < pad.y + pad.h;
      for (const [p, q] of lines)
        for (let k = 0; k <= 30; k++)
          if (inside(p.x + ((q.x - p.x) * k) / 30, p.y + ((q.y - p.y) * k) / 30)) return true;
      return others.some(
        (o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h,
      );
    };
    const inRoom = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= size.w && b.y + b.h <= size.h;
    const right = size.w - l.w - 4;
    const candidates: Box[] = [
      { x: right, y: plotTop, ...l },
      { x: right, y: plotTop + l.h + 6, ...l },
      { x: peakX + (changeX - peakX) * 0.5 - l.w / 2, y: plotTop, ...l },
      { x: PLOT_LEFT, y: plotTop + l.h, ...l },
      { x: PLOT_LEFT, y: Math.min(yR, yP) - l.h - 6, ...l },
      { x: right, y: Math.max(yR, yP) + l.h + 8, ...l },
    ];
    return candidates.find((b) => inRoom(b) && !hits(b)) ?? (candidates[0] as Box);
  }
  function catalysed(): SlideElement[] {
    const cat = valid ? values?.catalysedActivationEnergy : undefined;
    if (cat === undefined || !(cat > Math.max(0, energyChange)) || !(cat < activationEnergy))
      return [];
    const top = Math.max(yR, yP);
    const k = Math.min(
      0.8,
      Math.max(
        0.3,
        (cat - Math.max(0, energyChange)) / (activationEnergy - Math.max(0, energyChange)),
      ),
    );
    const yC = Math.min(yR, yP) - (Math.min(yR, yP) - plotTop) * k;
    void top;
    const name = (values?.catalysedLabel ?? "With catalyst").trim() || "With catalyst";
    const fitted = fitLabel(t, name, {
      maxW: size.w * 0.4,
      slack: ARROW_LABEL_SLACK,
      minW: 0,
      maxLines: 2,
    });
    return [
      {
        ...curve,
        id: uid(),
        points: curve.points.map((p, i) => (i === 2 ? { x: p.x, y: at(yC) } : p)),
        stroke: t.colors.accent2,
        dash: "dashed",
        name: "Catalysed profile",
      } as PathElement,
      labelText(t, fitted.text, catalysedBox(fitted, yC), "left", t.colors.accent2),
    ];
  }
  const children: SlideElement[] = [
    segment(
      { x: AXIS_X, y: axisY },
      { x: AXIS_X, y: labels.energy.h + AXIS_TOP_GAP },
      { ...arrow, name: "Energy axis" },
    ),
    segment(
      { x: AXIS_X, y: axisY },
      { x: size.w - AXIS_END_INSET, y: axisY },
      { ...arrow, name: "Progress axis" },
    ),
    // The reactants' level carried across, for both arrows to start from.
    segment(
      { x: reactantsEnd, y: yR },
      { x: changeX + GUIDE_OVERHANG, y: yR },
      {
        stroke: t.colors.muted,
        strokeWidth: GUIDE_STROKE,
        dash: "dashed",
        name: "Reactants' level",
      },
    ),
    curve,
    ...catalysed(),
    segment({ x: peakX, y: yR }, { x: peakX, y: plotTop }, { ...arrow, name: "Activation energy" }),
    segment({ x: changeX, y: yR }, { x: changeX, y: yP }, { ...arrow, name: "Energy change" }),
    labelText(t, labels.energy.text, placed.energy, "left"),
    labelText(t, labels.progress.text, placed.progress, "center"),
    labelText(t, labels.reactants.text, placed.reactants, "left"),
    labelText(t, labels.products.text, placed.products, "right"),
    labelText(t, labels.activation.text, placed.activation, "right"),
    labelText(t, labels.change.text, placed.change, "right"),
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

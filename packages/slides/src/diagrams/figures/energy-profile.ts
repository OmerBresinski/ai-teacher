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
import { editorialIssue } from "../../editorial";
import { uid } from "../../factories";
import { pathSegments, samplePath } from "../../path";
import { planLegend } from "../legend";
import { STROKE as LADDER, look } from "../style";
import type { FigureDrawing, FigureTemplate } from "./index";
import { type FittedLabel, fitLabel, type LabelFit, labelText } from "./labels";
import { segment } from "./marks";

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/**
 * Longest each label may be: the substances' names, the arrows' labels and the axis names. An
 * arrow's label up to `beside` characters sits beside its arrow; a longer one (LAYOUT-TEST: the
 * writer wrote "Energy change unchanged" in 3 of 3 runs and the figure was dropped) leaves the
 * arrow its symbol ("Ea", "ΔH") and is named in full in a key row under the plot, one line wide
 * across the figure, which holds `arrow` characters in the half-slide zone on every theme.
 */
export const ENERGY_PROFILE_LABEL_MAX = { name: 24, beside: 8, arrow: 40, axis: 24 } as const;

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
 * levels with a lower peak, drawn dashed (every real energy-profile slide compared
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
/** From the lower plateau down to the axis, past its name. */
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

/** A key row's lines, and its inset from the figure's sides. */
const KEY_LINES = 2;
const KEY_INSET = 4;
/** A legend row's line sample, the gap from it to its name, and the gap between items on a row. */
const LEGEND_SAMPLE = 30;
const SAMPLE_GAP = 8;
const LEGEND_GAP = 16;
/**
 * The extras (legend, key rows, caption) stand in a column beside the plot when the figure is wide
 * enough that the plot keeps at least `SIDE_MIN_PLOT` points and `SIDE_MIN_ASPECT` times the
 * figure's height across; the column is at most `SIDE_MAX_SHARE` of the width, `SIDE_GAP` off it.
 */
const SIDE_GAP = 16;
const SIDE_MIN_PLOT = 360;
const SIDE_MIN_ASPECT = 1.2;
const SIDE_MAX_SHARE = 0.4;
/** Under the progress axis's name. */
const BOTTOM_PAD = 2;
/** Between the energy axis's arrow and its name beside the tip. */
const TIP_NAME_GAP = 8;
/** The energy axis's name in the gutter left of the axis: at most this wide, and this many lines. */
const GUTTER_MAX = 150;
const GUTTER_LINES = 3;
const PEAK_TOP_GAP_GUTTER = 8;
const NOT_TO_SCALE = "Not drawn to scale";
/** The arrows' symbols, drawn on an arrow whose label is in the key. */
const ARROW_SYMBOL = { activation: "Ea", change: "ΔH" } as const;
type ArrowKey = keyof typeof ARROW_SYMBOL;

/**
 * An arrow label too long to sit beside its arrow, as its key row: "ΔH: Energy change unchanged",
 * or "Ea: Without catalyst" for "Ea without catalyst" (the symbol is not said twice).
 */
export function arrowKeyRow(key: ArrowKey, label: string): string {
  const sym = ARROW_SYMBOL[key];
  const rest = label
    .trim()
    .replace(new RegExp(`^${sym}(?=$|[\\s:,(-])[\\s:,-]*`, "i"), "")
    .trim();
  const said = rest || label.trim();
  return `${sym}: ${said.charAt(0).toUpperCase()}${said.slice(1)}`;
}

/** One of the extras: a legend row (with its line sample), a key row, or the caption. */
type Extra = {
  text: string;
  color: string;
  lines: number;
  sample?: { color: string; dash?: "dashed" };
};
type FittedExtra = Extra & { l: FittedLabel };

function drawEnergyProfile(
  values: EnergyProfileValues | undefined,
  t: Theme,
  size: { w: number; h: number },
): FigureDrawing {
  const valid = values !== undefined && peakAboveLevels(values);
  const { activationEnergy, energyChange } = valid ? values : FALLBACK;
  const exothermic = energyChange <= 0;
  // An arrow label longer than its place beside the arrow goes to a key row.
  const keyed = (["activation", "change"] as const).flatMap((key) => {
    const given = (key === "activation" ? values?.activationLabel : values?.changeLabel)?.trim();
    return given && given.length > ENERGY_PROFILE_LABEL_MAX.beside
      ? [{ key, text: arrowKeyRow(key, given) }]
      : [];
  });
  const isKeyed = (key: ArrowKey) => keyed.some((k) => k.key === key);
  const catValue = valid ? values?.catalysedActivationEnergy : undefined;
  const hasCat =
    catValue !== undefined && catValue > Math.max(0, energyChange) && catValue < activationEnergy;

  // FIX-ENERGY (y11 s7): the extras. With a catalysed curve the legend names both curves; the
  // writer's own name for the uncatalysed one ("Ea without catalyst") is kept, and its key row is
  // not said twice. Wide, they stand in a column beside the plot; else they pack into rows under it.
  const activationGiven = values?.activationLabel?.trim() ?? "";
  const solidName =
    isKeyed("activation") && /catalyst/i.test(activationGiven) ? activationGiven : "No catalyst";
  const catName = (values?.catalysedLabel ?? "With catalyst").trim() || "With catalyst";
  const specs: Extra[] = [
    ...(hasCat
      ? [
          { text: solidName, color: t.colors.ink, lines: 1, sample: { color: t.colors.accent } },
          {
            text: catName,
            color: t.colors.ink,
            lines: 1,
            sample: { color: t.colors.accent2, dash: "dashed" as const },
          },
        ]
      : []),
    ...keyed
      .filter((k) => !(hasCat && k.key === "activation"))
      .map((k) => ({ text: k.text, color: t.colors.ink, lines: KEY_LINES })),
  ];
  const caption: Extra = { text: NOT_TO_SCALE, color: t.colors.muted, lines: 1 };
  const sampleW = (e: Extra) => (e.sample ? LEGEND_SAMPLE + SAMPLE_GAP : 0);
  const fitExtra = (e: Extra, maxW: number): FittedExtra => ({
    ...e,
    l: fitLabel(t, e.text, {
      maxW: maxW - sampleW(e),
      slack: ARROW_LABEL_SLACK,
      minW: 0,
      maxLines: e.lines,
    }),
  });
  const itemW = (e: FittedExtra) => sampleW(e) + e.l.w;
  const colItems = specs.map((e) => fitExtra(e, size.w * SIDE_MAX_SHARE));
  const colCaption = fitExtra(caption, size.w * SIDE_MAX_SHARE);
  const wh = (e: FittedExtra) => ({ w: itemW(e), h: e.l.h });
  // Wide: a column beside the plot (it may hold only the caption). The shared legend plan decides.
  const besidePlan = planLegend({
    size,
    column: [...colItems, colCaption].map(wh),
    rows: [],
    reserved: 0,
    gap: SIDE_GAP,
    minPlotW: SIDE_MIN_PLOT,
    minAspect: SIDE_MIN_ASPECT,
  });
  const side = besidePlan.mode === "beside";
  const colW = side ? besidePlan.colW : 0;
  /**
   * Beside a column the figure is wide and short, so the energy axis's name moves off the top
   * into a gutter left of the axis (up to `GUTTER_LINES` lines), and the plot rises to the top.
   * The plot is laid out from 0 and shifted right past the gutter (`gx`) at the end.
   */
  const energyText = values?.energyAxis ?? "Energy";
  const gutterFit: LabelFit = { maxW: Math.min(GUTTER_MAX, size.w * 0.2), maxLines: GUTTER_LINES };
  const gutter = side ? fitLabel(t, energyText, gutterFit) : undefined;
  const gx = gutter ? gutter.w + TIP_NAME_GAP - AXIS_X : 0;
  /** The plot's width: the whole figure, or what the column and gutter beside it leave. */
  const plotW = (side ? size.w - colW - SIDE_GAP : size.w) - gx;
  const rowW = size.w - 2 * KEY_INSET;
  const flowItems = specs.map((e) => fitExtra(e, rowW));
  const flowCaption = fitExtra(caption, rowW);
  /**
   * The extras packed into rows under the plot by the shared legend plan; rows that would run
   * out of the figure are dropped (`none`) rather than clipped.
   */
  const pack = (items: FittedExtra[], reserved: number) => {
    const plan = planLegend({
      size,
      column: [],
      rows: items.map(wh),
      reserved,
      gap: LEGEND_GAP,
      inset: KEY_INSET,
      beside: false,
    });
    const rows = plan.mode === "below" ? plan.rows : [];
    return {
      rows: rows.map((r) => ({
        h: r.h,
        items: r.items.map(({ i, x }) => ({ e: items[i] as FittedExtra, x })),
      })),
      h: plan.mode === "below" ? plan.h : 0,
    };
  };

  // Across: the plot, and where the plateaus, the peak and the ΔH arrow are on it.
  const plotRight = plotW - PLOT_RIGHT_INSET;
  const xOf = (f: number) => PLOT_LEFT + f * (plotRight - PLOT_LEFT);
  const reactantsEnd = xOf(CURVE_X.reactantsEnd);
  const peakX = xOf(CURVE_X.peak);
  const productsStart = xOf(CURVE_X.productsStart);
  const changeX = xOf(CURVE_X.change);

  // What each label says, and how wide its place lets it be. The names keep to their own side of
  // the peak, the products' name running to the plot's right edge; standing on an endothermic
  // reaction's higher level, it keeps over its plateau. "Ea" keeps inside the room its fallback place has (see
  // `activationBox`). "ΔH" keeps between the levels right of the falling curve, which is below the
  // reactants' level only when exothermic; endothermic, the band between the levels is clear back
  // to the activation-energy arrow.
  const arrowFit = { slack: ARROW_LABEL_SLACK, minW: 0 };
  const wording: Record<LabelKey, { text: string; fit: LabelFit }> = {
    energy: { text: energyText, fit: gutter ? gutterFit : { maxW: plotW } },
    progress: { text: values?.progressAxis ?? "Progress of reaction", fit: { maxW: plotW } },
    reactants: {
      text: values?.reactants ?? "",
      fit: { maxW: peakX - LANE_GAP - PLOT_LEFT },
    },
    products: {
      text: values?.products ?? "",
      fit: { maxW: plotW - (exothermic ? peakX + LANE_GAP : productsStart) },
    },
    activation: {
      text: isKeyed("activation") ? ARROW_SYMBOL.activation : (values?.activationLabel ?? "Ea"),
      fit: { ...arrowFit, maxW: reactantsEnd - CLEAR - (AXIS_X + ARROW_LABEL_GAP) },
    },
    change: {
      text: isKeyed("change") ? ARROW_SYMBOL.change : (values?.changeLabel ?? "ΔH"),
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
  /**
   * the energy axis's name beside the arrow's tip, inside the plot's top left, when it
   * ends left of the rising curve's halfway point (the curve is still in the plot's lower half
   * there); the plot then rises to the top of the figure. Else it stands above the axis.
   */
  const tipName = (l: Labels) =>
    gutter !== undefined ||
    AXIS_X + TIP_NAME_GAP + l.energy.w + LANE_GAP <= reactantsEnd + 0.5 * riseSpan;

  // Down: the energy axis's name, the plot, the lower plateau's names, the axis, its name, and
  // (packed into rows) the extras. A label standing on a level (the products' name when
  // endothermic, "Ea" in its fallback place over the reactants' plateau) needs room up to the top.
  const frame = (labels: Labels, notToScale: boolean) => {
    const tip = tipName(labels);
    // The caption on the energy axis's row, at the right, when that row has room for it.
    const topCaption =
      notToScale &&
      !side &&
      !tip &&
      labels.energy.w + LEGEND_GAP + flowCaption.l.w <= size.w - 2 * KEY_INSET;
    const flow = side
      ? pack([], 0)
      : pack(
          [...flowItems, ...(notToScale && !topCaption ? [flowCaption] : [])],
          labels.energy.h + labels.progress.h + PROGRESS_GAP + CAPTION_GAP,
        );
    const belowH = flow.h > 0 ? flow.h + CAPTION_GAP : 0;
    // With the name in the gutter nothing stands over the peak but the arrow's head.
    const topGap = gutter ? PEAK_TOP_GAP_GUTTER : PEAK_TOP_GAP;
    const plotTop = (tip ? 0 : labels.energy.h) + topGap;
    const standing = (h: number) => h + NAME_GAP + CLEAR - topGap;
    const axisY = size.h - labels.progress.h - PROGRESS_GAP - BOTTOM_PAD - belowH;
    const hanging = exothermic
      ? Math.max(labels.reactants.h, labels.products.h)
      : labels.reactants.h;
    // Modern looks: the hanging names stand clear of the axis, unless rows under the plot
    // already took its height (the extra gap then pushes "ΔH" into the products' name).
    const modernGap = look().preset === "current" || flow.h > 0 ? 0 : 10;
    const plotBottom = axisY - hanging - PLATEAU_AXIS_GAP - modernGap;
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
    return {
      plotTop,
      axisY,
      plotBottom,
      height,
      beside,
      drawn,
      fits,
      tip,
      topCaption,
      flow,
      notToScale,
    };
  };
  // The caption takes room from the plot, so a drawing the first pass clamps is laid out again.
  const layout = (labels: Labels) => {
    const first = frame(labels, !valid);
    return valid && first.drawn.clamped ? frame(labels, true) : first;
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
    // The energy axis's name in the gutter keeps its lines: it takes no height from the plot.
    const cuttable = LABEL_KEYS.filter((k) => !(gutter && k === "energy"));
    const tallest = cuttable.reduce((a, b) => (labels[b].lines > labels[a].lines ? b : a));
    if (labels[tallest].lines === 1) break;
    const was = labels[tallest].lines;
    maxLines[tallest] = was - 1;
    labels = fitAll();
    plan = layout(labels);
    // a zone too narrow for even "…" on one line gives back as many lines as before;
    // cutting again would loop for ever (a 160-wide zone hung generation), so stop and draw.
    if (labels[tallest].lines >= was) break;
  }
  const { plotTop, axisY, plotBottom, height, beside, drawn, notToScale, tip, topCaption, flow } =
    plan;

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
    const y = Math.min(lowest, Math.max((tip ? 0 : labels.energy.h) + CLEAR, quarter));
    return { x: reactantsEnd - CLEAR - a.w, y, w: a.w, h: a.h };
  };
  const box = (l: FittedLabel, x: number, y: number): Box => ({ x, y, w: l.w, h: l.h });
  const progressX = (AXIS_X + plotW) / 2 - labels.progress.w / 2;
  const placed = {
    energy: box(labels.energy, gutter ? -gx : tip ? AXIS_X + TIP_NAME_GAP : 0, 0),
    progress: box(
      labels.progress,
      Math.max(0, Math.min(plotW - labels.progress.w, progressX)),
      axisY + PROGRESS_GAP,
    ),
    reactants: box(labels.reactants, PLOT_LEFT, yR + NAME_GAP),
    products: box(
      labels.products,
      plotW - labels.products.w,
      exothermic ? yP + NAME_GAP : yP - NAME_GAP - labels.products.h,
    ),
    activation: activationBox(),
    change: box(
      labels.change,
      changeX - ARROW_LABEL_GAP - labels.change.w,
      (yR + yP) / 2 - labels.change.h / 2,
    ),
  };

  // The extras' places: the column beside the plot (centred on it, the caption last), or the rows
  // packed under the progress axis's name (the caption maybe on the energy axis's row).
  const extras: { e: FittedExtra; x: number; y: number; rowH: number }[] = [];
  if (side) {
    const items = [...colItems, ...(notToScale ? [colCaption] : [])];
    const colH = items.reduce((s, e) => s + e.l.h, 0);
    let y = Math.max(0, Math.min(size.h - colH, (plotTop + axisY - colH) / 2));
    for (const e of items) {
      extras.push({ e, x: size.w - colW, y, rowH: e.l.h });
      y += e.l.h;
    }
  } else {
    let y = axisY + PROGRESS_GAP + labels.progress.h + CAPTION_GAP;
    for (const r of flow.rows) {
      for (const { e, x } of r.items) extras.push({ e, x: KEY_INSET + x, y, rowH: r.h });
      y += r.h;
    }
    if (topCaption)
      extras.push({
        e: flowCaption,
        x: size.w - KEY_INSET - flowCaption.l.w,
        y: 0,
        rowH: labels.energy.h,
      });
  }
  const extraBoxes = extras.map(({ e, x, y, rowH }) => ({ x, y, w: itemW(e), h: rowH }));

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
  // 0.3 and 0.8 so the two read apart), dashed in the second colour.
  /** The catalysed peak's height, or undefined when no catalysed curve is drawn. */
  const catPeak = (() => {
    if (!hasCat || catValue === undefined) return undefined;
    const k = Math.min(
      0.8,
      Math.max(
        0.3,
        (catValue - Math.max(0, energyChange)) / (activationEnergy - Math.max(0, energyChange)),
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
   * The collision pass: every curve sampled as drawn (the smooth path's cubic
   * segments), the arrows, and the labels already set. `clearSpot` gives the first candidate that
   * clears them all and sits inside the figure with a margin; the first candidate otherwise.
   */
  const strokes = (): [{ x: number; y: number }, { x: number; y: number }][] => {
    // Each curve sampled as the renderer draws it (`pathSegments`, a monotone cubic).
    const drawnCurve = (el: PathElement) =>
      samplePath(pathSegments(el, el.w, el.h), 24).map((q) => ({ x: el.x + q.x, y: el.y + q.y }));
    const lines: [{ x: number; y: number }, { x: number; y: number }][] = [];
    const curves = [drawnCurve(curve)];
    if (catCurve) curves.push(drawnCurve(catCurve));
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
        { x: plotW, y: axisY },
      ],
    );
    if (catTop) lines.push([{ x: catTop.x, y: yR }, catTop]);
    return lines;
  };
  const MARGIN = 4;
  const inRoom = (b: Box) =>
    b.x >= MARGIN && b.y >= 0 && b.x + b.w <= plotW - MARGIN && b.y + b.h <= size.h;
  function clearSpot(candidates: Box[], taken: Box[]): Box | undefined {
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
    const clear = candidates.find((b) => inRoom(b) && !hits(b));
    if (clear) return clear;
    // None clears everything: the one in the room that covers the least of the labels set.
    const covered = (b: Box) =>
      taken.reduce(
        (sum, o) =>
          sum +
          Math.max(0, Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x)) *
            Math.max(0, Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y)),
        0,
      );
    const room = candidates.filter(inRoom);
    return room.length
      ? room.reduce((best, b) => (covered(b) < covered(best) ? b : best))
      : candidates[0]; // None at all: undefined, and the caller keeps its own place.
  }
  /** Every label kept inside the figure, `MARGIN` clear of its edges. */
  const inside = (b: Box): Box => ({
    ...b,
    // Flush left is allowed (the axis names start there); the right edge keeps a margin, which a
    // label wider than the room gives up before it would leave the box.
    x: Math.max(
      -gx,
      Math.min(size.w - gx - Math.max(0, Math.min(MARGIN, size.w - b.w)) - b.w, b.x),
    ),
    y: Math.max(0, Math.min(size.h - b.h, b.y)),
  });
  /** "Ea" beside its arrow and clear of both curves, when a catalysed curve is drawn too. */
  const eaBox = (): Box => {
    const a = labels.activation;
    const taken = [
      placed.energy,
      placed.progress,
      placed.reactants,
      placed.products,
      placed.change,
      ...extraBoxes,
    ];
    // Without a catalysed curve, its own place unless that runs into another label (a short plot
    // can leave the reactants' plateau too near the energy axis's name).
    const meets = (b: Box, o: Box) =>
      b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h;
    if (catPeak === undefined && !taken.some((o) => meets(placed.activation, o)))
      return placed.activation;
    // Nearest the arrow's middle first, either side, then a step further out.
    const mid = (yR + plotTop) / 2;
    const cands: Box[] = [];
    for (let d = 0; d <= (yR - plotTop) / 2; d += 6)
      for (const y of [mid - d, mid + d])
        for (const dx of [0, 10, 22, 36, 52]) {
          cands.push({ x: mainTop.x - ARROW_LABEL_GAP - a.w - dx, y: y - a.h / 2, w: a.w, h: a.h });
          // Without a catalysed arrow, the right of the main arrow is free too.
          if (!catTop)
            cands.push({ x: mainTop.x + ARROW_LABEL_GAP + dx, y: y - a.h / 2, w: a.w, h: a.h });
        }
    // "Ea" names the main arrow from its left (the catalysed arrow stands to its right); else
    // right of it above the catalysed peak, where only the main arrow runs; else past both.
    if (catTop) {
      for (let y = catTop.y - a.h / 2 - CLEAR; y >= mainTop.y + a.h / 2; y -= 6)
        cands.push({ x: mainTop.x + ARROW_LABEL_GAP, y: y - a.h / 2, w: a.w, h: a.h });
      for (let d = 0; d <= (yR - plotTop) / 2; d += 6)
        for (const y of [mid - d, mid + d])
          cands.push({ x: catTop.x + ARROW_LABEL_GAP, y: y - a.h / 2, w: a.w, h: a.h });
    }
    // A plot too short for any place beside the arrows: over the reactants' plateau, left of the
    // rise, as low as it stands and then higher.
    for (let y = yR - NAME_GAP - a.h; y >= 0; y -= 6)
      for (let x = reactantsEnd - CLEAR - a.w; x >= PLOT_LEFT; x -= 12)
        cands.push({ x, y, w: a.w, h: a.h });
    return clearSpot(cands, taken) ?? placed.activation;
  };
  // Modern looks: the axes recede (muted hairlines) so the curves lead.
  const axis =
    look().preset === "current"
      ? arrow
      : { ...arrow, stroke: t.colors.muted, strokeWidth: LADDER.hair };
  const children: SlideElement[] = [
    segment(
      { x: AXIS_X, y: axisY },
      { x: AXIS_X, y: tip ? CLEAR : labels.energy.h + AXIS_TOP_GAP },
      { ...axis, name: "Energy axis" },
    ),
    segment(
      { x: AXIS_X, y: axisY },
      { x: plotW - AXIS_END_INSET, y: axisY },
      { ...axis, name: "Progress axis" },
    ),
    // The reactants' level carried across, for both arrows to start from.
    segment(
      { x: reactantsEnd, y: yR },
      { x: Math.min(plotW - MARGIN, changeX + GUIDE_OVERHANG), y: yR },
      {
        stroke: t.colors.muted,
        strokeWidth: LADDER.hair,
        dash: "dashed",
        name: "Reactants' level",
      },
    ),
    curve,
  ];
  if (catCurve && catTop)
    children.push(
      catCurve,
      segment({ x: catTop.x, y: yR }, catTop, {
        stroke: t.colors.accent2,
        strokeWidth: LADDER.line,
        arrowEnd: true,
        name: "Catalysed activation energy",
      }),
    );
  children.push(
    segment({ x: mainTop.x, y: yR }, mainTop, { ...arrow, name: "Activation energy" }),
    segment({ x: changeX, y: yR }, { x: changeX, y: yP }, { ...arrow, name: "Energy change" }),
    // In the gutter the name hugs the axis it names.
    labelText(t, labels.energy.text, inside(placed.energy), gutter ? "right" : "left"),
    labelText(t, labels.progress.text, inside(placed.progress), "center"),
    labelText(t, labels.reactants.text, inside(placed.reactants), "left"),
    labelText(t, labels.products.text, inside(placed.products), "right"),
    labelText(t, labels.activation.text, inside(eaBox()), "right"),
    labelText(t, labels.change.text, inside(placed.change), "right"),
  );
  // The plot shifted past the gutter; the extras are placed in the figure's own points.
  if (gx) for (const c of children) c.x += gx;
  // The extras: a legend row's line sample then its name; a key row; the caption, muted.
  for (const { e, x, y, rowH } of extras) {
    const cy = y + rowH / 2;
    if (e.sample)
      children.push(
        segment(
          { x, y: cy },
          { x: x + LEGEND_SAMPLE, y: cy },
          {
            stroke: e.sample.color,
            strokeWidth: LADDER.data,
            ...(e.sample.dash ? { dash: e.sample.dash } : {}),
            name: "Legend sample",
          },
        ),
      );
    children.push(
      labelText(
        t,
        e.l.text,
        { x: x + sampleW(e), y: cy - e.l.h / 2, w: e.l.w, h: e.l.h },
        "left",
        e.color,
      ),
    );
  }
  return { children, alt: energyProfileAlt(values, notToScale) };
}

export const ENERGY_PROFILE: FigureTemplate<EnergyProfileValues> = {
  name: "Energy profile",
  shape: energyProfileFull,
  values: energyProfileValuesSchema,
  draw: drawEnergyProfile,
};

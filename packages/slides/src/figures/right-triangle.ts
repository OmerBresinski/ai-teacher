/**
 * The `right-triangle` Figure template (ADR 0032, TEACH-77): a right-angled triangle drawn as one
 * closed `path`, the right-angle mark as an open one, and a `small` label outside each side. The
 * legs are in proportion to the lengths given, with height over base clamped for legibility; a
 * clamped or schematic drawing is captioned "Not drawn to scale". Labels always carry the values as
 * given. Label placement follows the TEACH-164 spike (PR #317).
 *
 * Load it through `./index` or the package root, never first on its own: `layouts.ts` draws its
 * placeholder through `drawFigure`, so this module sits in the layouts ↔ figures import cycle and
 * the registry in `./index` would read `RIGHT_TRIANGLE` before it exists.
 */

import type { PathElement, Theme } from "@tj/domain/documents";
import { z } from "zod";
import { figureLook, STROKE as LADDER } from "../diagrams/style";
import { mix } from "../diagrams/svg";
import { editorialIssue } from "../editorial";
import { uid } from "../factories";
import { boxH } from "../layouts";
import type { FigureDrawing, FigureTemplate, FigureUnknown } from "./index";
import { type FittedLabel, fitLabel, labelText, notToScaleCaption } from "./labels";
import { rightAngleMark } from "./marks";

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

const SIDES = ["base", "height", "hypotenuse"] as const;
type SideName = (typeof SIDES)[number];

/** Longest label a side may carry; a label is short: "3 cm", "x", "12.5 m". */
export const RIGHT_TRIANGLE_LABEL_MAX = 12;

const sideSchema = z.object({ length: z.number().optional(), label: z.string() });

/** The two legs (horizontal `base`, vertical `height`) and the hypotenuse, with no rules. */
const rightTriangleShape = z.object({
  base: sideSchema,
  height: sideSchema,
  hypotenuse: sideSchema,
});

export type RightTriangleSide = z.infer<typeof sideSchema>;
export type RightTriangleValues = z.infer<typeof rightTriangleShape>;

/** Three lengths fit a right angle when a² + b² = c², within 1 %. */
const isPythagorean = (a: number, b: number, c: number) =>
  Math.abs(a * a + b * b - c * c) <= 0.01 * c * c;

const given = (side: RightTriangleSide) =>
  side.length !== undefined && side.length > 0 ? side.length : undefined;

/**
 * What the model supplies for a right-angled triangle. Every rule is editorial: a miss becomes a
 * finding for Repair, never a failed Generate stage, and the drawing copes with it.
 */
export const rightTriangleValuesSchema = rightTriangleShape.superRefine((v, ctx) => {
  for (const name of SIDES) {
    const side = v[name];
    if (side.length !== undefined && !(side.length > 0))
      ctx.addIssue(editorialIssue("Each length is a positive number.", [name, "length"]));
    if (side.label.length > RIGHT_TRIANGLE_LABEL_MAX)
      ctx.addIssue(
        editorialIssue(`Keep each label to ${RIGHT_TRIANGLE_LABEL_MAX} characters or fewer.`, [
          name,
          "label",
        ]),
      );
  }
  const a = given(v.base);
  const b = given(v.height);
  const c = given(v.hypotenuse);
  if ([a, b, c].filter((l) => l !== undefined).length < 2)
    ctx.addIssue(editorialIssue("Give the length of at least two of the three sides."));
  if (c !== undefined && ((a !== undefined && c <= a) || (b !== undefined && c <= b))) {
    ctx.addIssue(
      editorialIssue(
        "The hypotenuse is the longest side: make it longer than the base and the height.",
        ["hypotenuse", "length"],
      ),
    );
  } else if (a !== undefined && b !== undefined && c !== undefined && !isPythagorean(a, b, c)) {
    ctx.addIssue(
      editorialIssue(
        "The three lengths do not make a right angle: base² + height² must equal hypotenuse².",
        ["hypotenuse", "length"],
      ),
    );
  }
});

/**
 * The legs the values give, or `undefined` when they cannot give two (fewer than two lengths, or a
 * hypotenuse no longer than a leg). `exact` is false when three lengths disagree.
 */
export function rightTriangleLegs(
  v: RightTriangleValues,
): { base: number; height: number; exact: boolean } | undefined {
  const a = given(v.base);
  const b = given(v.height);
  const c = given(v.hypotenuse);
  if (a !== undefined && b !== undefined)
    return { base: a, height: b, exact: c === undefined || isPythagorean(a, b, c) };
  if (a !== undefined && c !== undefined && c > a)
    return { base: a, height: Math.sqrt(c * c - a * a), exact: true };
  if (b !== undefined && c !== undefined && c > b)
    return { base: Math.sqrt(c * c - b * b), height: b, exact: true };
  return undefined;
}

/**
 * The length of the side that has a label and no length (TEACH-221), from the other two; the
 * answer the figure's question asks for. `undefined` unless exactly one side lacks a length and
 * the other two give the legs.
 */
export function rightTriangleUnknown(v: RightTriangleValues): FigureUnknown | undefined {
  const missing = SIDES.filter(
    (name) => v[name].label.trim() !== "" && given(v[name]) === undefined,
  );
  const [name] = missing;
  if (missing.length !== 1 || !name) return undefined;
  const legs = rightTriangleLegs(v);
  if (!legs) return undefined;
  const value = name === "hypotenuse" ? Math.hypot(legs.base, legs.height) : legs[name];
  return { value, unit: "length" };
}

/**
 * What a screen reader hears for the figure: "Right-angled triangle. Base 3 cm, height 4 cm,
 * hypotenuse x." A side with no label is left out; " Not drawn to scale." follows when it is not.
 */
export function rightTriangleAlt(values: RightTriangleValues | undefined, notToScale: boolean) {
  const sides = SIDES.flatMap((name) => {
    const label = values?.[name].label.trim();
    return label ? [`${name} ${label}`] : [];
  }).join(", ");
  const described = sides ? ` ${sides.charAt(0).toUpperCase()}${sides.slice(1)}.` : "";
  return `Right-angled triangle.${described}${notToScale ? " Not drawn to scale." : ""}`;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

type Box = { x: number; y: number; w: number; h: number };

/** Height over base is drawn between these; outside them the figure is not to scale. */
export const RIGHT_TRIANGLE_RATIO = { min: 0.4, max: 2.5 } as const;
/** The schematic triangle drawn when the values cannot give two legs: base 3, height 4. */
const SCHEMATIC_RATIO = 4 / 3;
const STROKE = LADDER.line;
/** Between a side and the nearest edge of its label's box. */
const GAP = 12;
/** Between the drawing and its box, so the round joins of the stroke stay inside. */
const INSET = 4;
/** Above the "Not drawn to scale" caption. */
const CAPTION_GAP = 8;
/**
 * The widest a label's box grows: a label within the editorial cap (12 characters, at most 159
 * points on any theme) stays on one line, and a longer one wraps rather than pushing the drawing
 * out of its box.
 */
const LABEL_MAX_W = 176;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The triangle with its right angle at the origin, base `w` to the right and height `h` up, and
 * the three label boxes placed outside their sides: base below, height to the left, hypotenuse
 * along its outward normal, each `GAP` clear of its side.
 */
function placement(w: number, h: number, size: Record<SideName, FittedLabel>) {
  const base: Box = { x: w / 2 - size.base.w / 2, y: GAP, w: size.base.w, h: size.base.h };
  const height: Box = {
    x: -GAP - size.height.w,
    y: -h / 2 - size.height.h / 2,
    w: size.height.w,
    h: size.height.h,
  };
  const length = Math.hypot(w, h) || 1;
  const normal = { x: h / length, y: -w / length };
  const hyp = size.hypotenuse;
  // Far enough along the normal that the box's nearest corner is GAP clear of the hypotenuse.
  const reach = GAP + Math.abs(normal.x) * (hyp.w / 2) + Math.abs(normal.y) * (hyp.h / 2);
  const centre = { x: w / 2 + normal.x * reach, y: -h / 2 + normal.y * reach };
  const hypotenuse: Box = { x: centre.x - hyp.w / 2, y: centre.y - hyp.h / 2, w: hyp.w, h: hyp.h };
  const boxes = [{ x: 0, y: -h, w, h }, base, height, hypotenuse];
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return {
    labels: { base, height, hypotenuse },
    extent: { x: left, y: top, w: right - left, h: bottom - top },
  };
}

const EMPTY: RightTriangleValues = {
  base: { label: "" },
  height: { label: "" },
  hypotenuse: { label: "" },
};

function drawRightTriangle(
  values: RightTriangleValues | undefined,
  t: Theme,
  size: { w: number; h: number },
): FigureDrawing {
  const v = values ?? EMPTY;
  const look = figureLook(t, mix);
  const legs = values ? rightTriangleLegs(values) : undefined;
  const ratio = legs ? legs.height / legs.base : SCHEMATIC_RATIO;
  const drawn = clamp(ratio, RIGHT_TRIANGLE_RATIO.min, RIGHT_TRIANGLE_RATIO.max);
  const notToScale = !legs?.exact || drawn !== ratio;

  const labelH = boxH(t, "small");
  const labels = {
    base: fitLabel(t, v.base.label, { maxW: LABEL_MAX_W, bold: true }),
    height: fitLabel(t, v.height.label, { maxW: LABEL_MAX_W, bold: true }),
    hypotenuse: fitLabel(t, v.hypotenuse.label, { maxW: LABEL_MAX_W, bold: true }),
  };
  const room = {
    w: size.w - 2 * INSET,
    h: size.h - 2 * INSET - (notToScale ? labelH + CAPTION_GAP : 0),
  };

  // The largest base whose drawing, labels included, fits the room. Every edge of the extent
  // moves monotonically with the base, so halving the interval finds it.
  const fits = (w: number) => {
    const { extent } = placement(w, w * drawn, labels);
    return extent.w <= room.w && extent.h <= room.h;
  };
  let lo = 0;
  let hi = Math.max(1, size.w + size.h);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const W = Math.max(1, Math.floor(lo));
  const H = Math.max(1, Math.round(W * drawn));
  const placed = placement(W, H, labels);
  const { extent } = placed;
  // The right angle's vertex, placed so the whole drawing is centred in the room.
  const A = {
    x: Math.round(INSET + (room.w - extent.w) / 2 - extent.x),
    y: Math.round(INSET + (room.h - extent.h) / 2 - extent.y),
  };
  const at = (b: Box): Box => ({
    x: Math.round(A.x + b.x),
    y: Math.round(A.y + b.y),
    w: b.w,
    h: b.h,
  });

  const triangle: PathElement = {
    id: uid(),
    type: "path",
    x: A.x,
    y: A.y - H,
    w: W,
    h: H,
    // The right angle, the end of the base, the top of the height.
    points: [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ],
    closed: true,
    fill: look.fill,
    stroke: t.colors.ink,
    strokeWidth: look.outline,
    name: "Triangle",
  };
  const m = Math.round(clamp(Math.min(W, H) * 0.12, 14, 24));
  // Up the height and along the base from the right angle, `m` along each.
  const mark = rightAngleMark(A, { x: A.x, y: A.y - H }, { x: A.x + W, y: A.y }, m, t, {
    fill: look.mark,
  });
  // The unknown side: the one with a label but no length, italic in the accent.
  const unknownSide = SIDES.find((n) => v[n].label.trim() !== "" && given(v[n]) === undefined);
  const side = (n: (typeof SIDES)[number], align: "center" | "right") =>
    labelText(
      t,
      labels[n].text,
      at(placed.labels[n]),
      align,
      n === unknownSide ? look.unknown : t.colors.ink,
      { bold: true, italic: n === unknownSide },
    );
  const children = [
    triangle,
    mark,
    side("base", "center"),
    side("height", "right"),
    side("hypotenuse", "center"),
  ];
  if (notToScale) children.push(notToScaleCaption(t, size));
  return { children, alt: rightTriangleAlt(values, notToScale) };
}

export const RIGHT_TRIANGLE: FigureTemplate<RightTriangleValues> = {
  name: "Right-angled triangle",
  shape: rightTriangleShape,
  values: rightTriangleValuesSchema,
  draw: drawRightTriangle,
  unknown: rightTriangleUnknown,
};

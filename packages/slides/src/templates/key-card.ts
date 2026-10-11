import type { ShapeElement, SlideElement } from "@tj/domain/documents";
import { uid } from "../factories";
import { POINT_KIND_ICONS, POINT_KIND_LABELS, pointTone } from "../point-kinds";
import { type Ctx, kit, pointKind, pointLabel, pointText, type TemplatePoint } from "./index";

/*
 * The key card, drawn once for the lead + points column and ruling 194's strip (TEACH-75 part e).
 * An untyped card is the washed card with an accent edge, its label in accent over the words in
 * ink, as before. A typed card (UX ruling 203, P1) takes its type's tone from `CALLOUT_TONES`, a
 * hairline, and an icon the height of its label line before the label.
 */

const BAR = 5;
const LABEL_GAP = 4;

function look(c: Ctx, p: TemplatePoint) {
  const kind = pointKind(p);
  if (!kind) {
    const a = c.t.colors.accent;
    return { fill: kit.wash(c.t), edge: a, label: a, body: c.t.colors.ink, icon: 0 };
  }
  const tone = pointTone(c.t, kind);
  const icon = Math.round(c.s.lead * kit.LH.lead);
  return { fill: tone.fill, edge: tone.icon, label: tone.ink, body: tone.ink, icon, tone, kind };
}

/** The card's label indent (the icon and its gap) and the inner text width at card width `w`. */
const inner = (c: Ctx, p: TemplatePoint, w: number, pad: number) => {
  const l = look(c, p);
  return { l, lx: l.icon ? l.icon + 8 : 0, iw: w - 2 * pad - BAR };
};

/** Height of the label row (with its gap), 0 for a card with no label. */
function labelH(c: Ctx, p: TemplatePoint, w: number, pad: number): number {
  const label = pointLabel(p);
  if (!label) return 0;
  const { lx, iw } = inner(c, p, w, pad);
  return kit.measure(c, label, "lead", iw - lx, 700) + LABEL_GAP;
}

/** Height of point `p`'s card `w` wide with inset `pad`, its words in `role`. */
export function keyCardHeight(c: Ctx, p: TemplatePoint, w: number, pad: number, role: "body") {
  const { iw } = inner(c, p, w, pad);
  return 2 * pad + labelH(c, p, w, pad) + kit.measure(c, pointText(p), role, iw);
}

/** Draws point `p`'s card at `rect`: the card, its edge, a typed card's hairline and icon, the words. */
export function drawKeyCard(
  c: Ctx,
  p: TemplatePoint,
  rect: { x: number; y: number; w: number; h: number },
  pad: number,
  role: "body",
) {
  const { l, lx, iw } = inner(c, p, rect.w, pad);
  const { x, y, w, h } = rect;
  const card: ShapeElement = kit.box(c, { x, y, w, h }, l.fill, {
    name: "Key card",
    radius: Math.min(c.t.radius, 12),
  });
  kit.box(c, { x, y, w: BAR, h }, l.edge, { name: "Key edge", shape: "rect", radius: 0 });
  const tx = x + BAR + pad;
  if (l.tone && l.kind) {
    card.stroke = l.tone.line;
    card.strokeWidth = 1.5;
    c.els.push({
      id: uid(),
      type: "icon",
      x: tx,
      y: Math.round(y + pad),
      w: l.icon,
      h: l.icon,
      icon: POINT_KIND_ICONS[l.kind],
      color: l.tone.icon,
      strokeWidth: 2.25,
      name: "Callout icon",
    } as SlideElement);
  }
  const label = pointLabel(p);
  if (label)
    kit.text(
      c,
      label,
      "lead",
      { x: tx + lx, y: y + pad, w: iw - lx },
      { color: l.label, weight: 700, name: "Key label" },
    );
  kit.text(
    c,
    pointText(p),
    role,
    { x: tx, y: y + pad + labelH(c, p, w, pad), w: iw },
    { color: l.body, name: "Point" },
  );
}

/**
 * A column's points with the typed card under the text (ruling 203, P1): the first typed point
 * moves to the end and keeps its type; any later typed point stays where it is as a labelled key
 * card named for its type ("Watch out: ..."), so no words or type are dropped and the column holds
 * one typed card.
 */
export function typedLast(points: TemplatePoint[]): TemplatePoint[] {
  const first = points.findIndex((p) => pointKind(p));
  if (first < 0) return points;
  const rest = points
    .filter((_, k) => k !== first)
    .map((p) => {
      const kind = pointKind(p);
      if (typeof p === "string" || !kind) return p;
      return { text: p.text, label: p.label?.trim() || POINT_KIND_LABELS[kind] };
    });
  return [...rest, points[first] as TemplatePoint];
}

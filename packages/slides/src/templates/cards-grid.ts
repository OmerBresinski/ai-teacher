/**
 * Cards grid (UX ruling 203, Chalkie layout parity P3; TEACH-75 part j): 2, 3 or 4 bordered
 * cards, each with an optional small icon top-left, a bold label and a short body. Copied from the
 * Chalkie heart deck's slide 8 (a 2x2 of icon cards, no slide heading).
 *
 * - The grid adapts to the count: 2 cards a 1x2 row, 3 cards three columns, 4 cards 2x2.
 * - The icon is a small square picture slot (`icon.n` on the writer's side), asked through the
 *   picture pipeline like any other picture. A planned icon whose picture failed shows the theme's
 *   glyph on a washed disc, never an empty box. A card with no icon planned gives its text the
 *   card's full width.
 * - A heading is optional: without one the grid takes the slide (Chalkie's heart slide 8).
 * - Fit on arrival (P6): the body sits beside the icon when it fits there, else under the icon at
 *   the card's full width, else one type step down. Words never move or go; a card that still does
 *   not fit is reported in `over`.
 */
import type { IconElement } from "@tj/domain/documents";
import { uid } from "../factories";
import { type Ctx, type Figure, G, kit, type TemplateInput } from "./index";

/** One card: a label (1-3 words), a body and an optional icon picture. */
export type GridCard = {
  label: string;
  text: string;
  /** The icon picture: a placed photo, or an open slot (`photo: ""`) while it is being found. */
  icon?: Figure;
  /** The icon was planned but its picture failed: the theme's glyph stands in its place. */
  iconLost?: boolean;
};

/** The glyph a lost icon shows (lucide), in the theme's accent on a washed disc. */
export const GRID_GLYPH = "sparkles";
export const GRID_NAMES = {
  card: "Card",
  icon: "Card icon",
  glyph: "Card glyph",
  label: "Card label",
  body: "Card body",
} as const;
/** Most cards a grid holds: 2x2. */
export const GRID_MAX = 4;

const FOOT = 512;
const GAP = 16;
const PAD = 18;
/** The gap between a measured heading and the grid: the band's one-line gap, closed up. */
const UNDER_HEADING = 24;
const ICON_GAP = 14;

/** Rows and columns for `n` cards: 4 is 2x2, otherwise one row. */
export function gridShape(n: number): { cols: number; rows: number } {
  if (n >= 4) return { cols: 2, rows: 2 };
  return { cols: Math.max(1, n), rows: 1 };
}

const caps = (label: string) =>
  label.trim().split(/\s+/).filter(Boolean).length <= 3 ? label.trim().toUpperCase() : label.trim();

export function layoutCardsGrid(c: Ctx, input: TemplateInput) {
  const head = input.heading.trim();
  let top = 40;
  if (head) {
    // The grid starts under the measured heading (ruling 198's gap), not at the band's fixed top:
    // a 2x2 needs every point of height the slide has.
    // A two-line heading is not over here: the grid starts under it, so its band check is dropped.
    const n0 = c.over.length;
    const el = kit.heading(c, head);
    c.over.length = n0;
    top = el.y + el.h + UNDER_HEADING;
    c.bodyFromHeading = true;
  }
  const lead = input.lead?.trim();
  if (lead) {
    const el = kit.text(
      c,
      lead,
      "body",
      { x: G.margin, y: top, w: G.width },
      { color: c.t.colors.ink, name: "Lead" },
    );
    top = el.y + el.h + GAP;
  }
  const all = input.grid ?? [];
  if (all.length > GRID_MAX) c.over.push(`cards ${all.length}/${GRID_MAX}`);
  const cards = all.slice(0, GRID_MAX);
  if (!cards.length) return;
  const { cols, rows } = gridShape(cards.length);
  const cardW = Math.floor((G.width - GAP * (cols - 1)) / cols);
  let cardH = Math.floor((FOOT - top - GAP * (rows - 1)) / rows);
  // Icon: about 0.1 of the slide's height in a 2x2 (Chalkie's 0.1 H), a little larger in a row.
  const icon = Math.min(rows === 2 ? 56 : 72, Math.round(cardH * 0.4));
  const inner = cardW - 2 * PAD;
  const full = c.s;

  type Plan = { beside: boolean; small: boolean };
  const plans: Plan[] = [
    { beside: true, small: false },
    { beside: false, small: false },
    { beside: true, small: true },
    { beside: false, small: true },
  ];
  const usable = c.fullSize ? plans.slice(0, 2) : plans;
  const hasIcon = (k: GridCard) => !!k.icon || !!k.iconLost;
  /** The card's content height under `p`; the text column's x offset and width. */
  const fit = (k: GridCard, p: Plan) => {
    c.s = p.small ? { ...full, body: full.small, lead: full.small } : full;
    const withIcon = hasIcon(k);
    const besideW = inner - icon - ICON_GAP;
    const labelX = withIcon ? icon + ICON_GAP : 0;
    const labelW = withIcon ? besideW : inner;
    const label = caps(k.label);
    const lh = label ? kit.measure(c, label, "lead", labelW) : 0;
    const bodyBeside = withIcon && p.beside;
    const bodyX = bodyBeside ? labelX : 0;
    const bodyW = bodyBeside ? besideW : inner;
    const gap = Math.round(c.s.body * 0.35);
    const bh = k.text.trim() ? kit.measure(c, k.text, "body", bodyW) : 0;
    // Beside: label then body in the column after the icon. Under: the label row is at least the
    // icon's height (label centred on it), then the body across the card.
    const rowH = withIcon && !p.beside ? Math.max(icon, lh) : lh;
    const textH = bodyBeside ? lh + (bh ? gap + bh : 0) : rowH + (bh ? gap + bh : 0);
    const h = Math.max(withIcon ? icon : 0, textH);
    const ok = bodyBeside
      ? kit.wordsFit(c, k.text, "body", bodyW, c.s.body) &&
        kit.wordsFit(c, label, "lead", labelW, c.s.lead)
      : kit.wordsFit(c, label, "lead", labelW, c.s.lead);
    c.s = full;
    return { h, ok, label, labelX, labelW, lh, rowH, bodyX, bodyW, gap };
  };
  const room = cardH - 2 * PAD;
  // One plan for every card, so the grid reads as one set (Chalkie's even cards).
  const plan =
    usable.find((p) =>
      cards.every((k) => {
        const f = fit(k, p);
        return f.ok && f.h <= room;
      }),
    ) ?? (usable[usable.length - 1] as Plan);

  // One row: the cards are as tall as the tallest card's words need, not the whole band.
  if (rows === 1) {
    const need = Math.max(...cards.map((k) => fit(k, plan).h));
    cardH = Math.min(cardH, Math.max(need + 2 * PAD + 12, Math.round(cardH * 0.5)));
  }
  cards.forEach((k, n) => {
    const col = n % cols;
    const row = Math.floor(n / cols);
    const x = G.margin + col * (cardW + GAP);
    const y = top + row * (cardH + GAP);
    kit.box(c, { x, y, w: cardW, h: cardH }, c.t.colors.surface, {
      stroke: c.t.colors.line,
      strokeWidth: 1.5,
      name: GRID_NAMES.card,
    });
    const f = fit(k, plan);
    if (f.h > room) c.over.push(`card ${n + 1} ${f.h}/${room}pt`);
    const ix = x + PAD;
    const iy = y + PAD;
    if (k.icon && "photo" in k.icon) {
      kit.photoBox(
        c,
        { ...k.icon, alt: k.icon.alt ?? k.label },
        { x: ix, y: iy, w: icon, h: icon },
      );
      const el = c.els[c.els.length - 1];
      if (el) el.name = GRID_NAMES.icon;
    } else if (k.icon || k.iconLost) glyph(c, ix, iy, icon);
    c.s = plan.small ? { ...full, body: full.small, lead: full.small } : full;
    const besideIcon = hasIcon(k);
    const labelY = besideIcon && !plan.beside ? iy + Math.round((f.rowH - f.lh) / 2) : iy;
    if (f.label)
      kit.text(
        c,
        f.label,
        "lead",
        { x: ix + f.labelX, y: labelY, w: f.labelW },
        { color: c.t.colors.heading ?? c.t.colors.ink, name: GRID_NAMES.label },
      );
    const bodyY =
      besideIcon && plan.beside ? iy + f.lh + f.gap : iy + (besideIcon ? f.rowH : f.lh) + f.gap;
    if (k.text.trim())
      kit.text(
        c,
        k.text,
        "body",
        { x: ix + f.bodyX, y: bodyY, w: f.bodyW },
        { color: c.t.colors.ink, name: GRID_NAMES.body },
      );
    c.s = full;
  });
}

/** The theme's glyph on a washed disc: what a planned icon shows when its picture failed. */
function glyph(c: Ctx, x: number, y: number, d: number) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x,
    y: Math.round(y),
    w: d,
    h: d,
    fill: kit.wash(c.t),
    name: GRID_NAMES.glyph,
  });
  const g = Math.round(d * 0.56);
  const el: IconElement = {
    id: uid(),
    type: "icon",
    x: x + Math.round((d - g) / 2),
    y: Math.round(y + (d - g) / 2),
    w: g,
    h: g,
    icon: GRID_GLYPH,
    color: c.t.colors.accent,
    strokeWidth: 2.25,
    name: GRID_NAMES.glyph,
  };
  c.els.push(el);
}

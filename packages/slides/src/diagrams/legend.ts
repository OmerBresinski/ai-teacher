/**
 * FIX-ENERGY: where a drawing's legend (and the key rows and caption that travel with it) goes,
 * shared by every drawing that has one (the line graph's series key, the energy profile's curves).
 * Pure arithmetic on measured widths and heights: it never throws and never returns nothing.
 *
 * The ordered fallback, first that holds:
 * 1. `beside`: a column right of the plot, when the figure is wide enough that the plot keeps
 *    `minPlotW` points and `minAspect` times the figure's height across;
 * 2. `below` (or wherever the caller stacks rows): packed into rows across the figure, when the
 *    rows fit inside the figure at all. Whether the plot left is tall enough is the geometry
 *    check's call (a squeezed plot is a fault, so the slide steps the drawing up to a bigger zone);
 * 3. `none`: the rows would run out of the figure, so no legend is drawn (the caller labels its
 *    curves another way or leaves them unnamed) rather than a clipped one.
 */

/** One legend entry as measured: its full width (sample and name) and its height. */
export type LegendItem = { w: number; h: number };
/** A row of entries: each entry's index and its x from the row's start, and the row's height. */
export type LegendRow = { items: { i: number; x: number }[]; h: number };

/**
 * Entries packed into rows `rowW` wide, in order, `gap` between neighbours. An entry wider than
 * the row takes a row of its own (the caller has already cut it to fit).
 */
export function packRows(items: readonly LegendItem[], rowW: number, gap: number): LegendRow[] {
  const rows: LegendRow[] = [];
  let x = 0;
  items.forEach((it, i) => {
    const last = rows[rows.length - 1];
    if (!last || x + gap + it.w > rowW) {
      rows.push({ items: [{ i, x: 0 }], h: it.h });
      x = it.w;
    } else {
      last.items.push({ i, x: x + gap });
      last.h = Math.max(last.h, it.h);
      x += gap + it.w;
    }
  });
  return rows;
}

export type LegendPlan =
  | { mode: "beside"; colW: number; plotW: number }
  | { mode: "below"; rows: LegendRow[]; h: number }
  | { mode: "none" };

export type LegendRoom = {
  /** The whole figure. */
  size: { w: number; h: number };
  /** The entries as they stand in a column (each at most `maxColShare` of the width). */
  column: readonly LegendItem[];
  /** The entries as they pack into rows across the figure. */
  rows: readonly LegendItem[];
  /** Height the drawing needs besides the legend rows (axis names, the least plot). */
  reserved: number;
  /** Between the plot and the column, and between entries on a row. */
  gap: number;
  /** Inset of the rows from each side. */
  inset?: number;
  minPlotW?: number;
  minAspect?: number;
  /** False keeps the legend out of a side column (a drawing that cannot narrow its plot). */
  beside?: boolean;
};

export const LEGEND_MIN_PLOT_W = 360;
export const LEGEND_MIN_ASPECT = 1.2;

/** Where the legend goes: beside, in rows, or not at all. Never throws. */
export function planLegend(room: LegendRoom): LegendPlan {
  const { size, column, rows, reserved, gap } = room;
  const inset = room.inset ?? 0;
  const colW = Math.max(0, ...column.map((c) => c.w));
  const plotW = size.w - colW - gap;
  if (
    room.beside !== false &&
    column.length > 0 &&
    plotW >=
      Math.max(room.minPlotW ?? LEGEND_MIN_PLOT_W, (room.minAspect ?? LEGEND_MIN_ASPECT) * size.h)
  )
    return { mode: "beside", colW, plotW };
  if (rows.length === 0) return { mode: "below", rows: [], h: 0 };
  const packed = packRows(rows, Math.max(1, size.w - 2 * inset), gap);
  const h = packed.reduce((s, r) => s + r.h, 0);
  if (Number.isFinite(h) && h + reserved <= size.h) return { mode: "below", rows: packed, h };
  return { mode: "none" };
}

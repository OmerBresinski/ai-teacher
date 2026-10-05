/**
 * Tables (UX ruling 154): no grid, no frame and no filled header. The header is bold ink on the
 * plain ground over a 2-point accent rule, rows are parted by 1-point hairlines, the first column is
 * set at weight 600. The table takes the full width of its box, columns shared out by their words,
 * cells wrapped to three lines, padded 0.5em across and 0.35em above and below. The type steps down only to the body floor (20): a table that does
 * not fit there is the planner's fit failure, never an 11-point table. It sits on the slide's own
 * ground (the drawing paints it), so no card shows behind it.
 */
import type { Table } from "./schema";
import { type Ctx, n, text, textWidth, wrap } from "./svg";

const CELL_LINES = 3;
/** The smallest size a table's cells are set at: the body floor (`MIN_FONT_SIZE.body`). */
export const TABLE_MIN_FS = 20;

type TableLayout = { fs: number; widths: number[]; lines: string[][][]; heights: number[] };

/** How the table sets in `w`x`h`: the largest size from the context's down to the floor. */
export function layoutTable(t: Table, x: Ctx, w: number, h: number): TableLayout {
  const cols = t.header?.length ?? t.rows[0]?.length ?? 1;
  const all = [...(t.header ? [t.header] : []), ...t.rows];
  const weightOf = (i: number, j: number) => (i === 0 && t.header ? 700 : j === 0 ? 600 : 400);
  let fs = Math.max(x.fs, TABLE_MIN_FS);
  for (;;) {
    const padX = fs * 0.5;
    const natural = Array.from({ length: cols }, (_, j) =>
      Math.max(fs * 2, ...all.map((r, i) => textWidth(r[j] ?? "", x, fs, weightOf(i, j)))),
    );
    const longest = Array.from({ length: cols }, (_, j) =>
      Math.max(
        fs * 2,
        ...all.flatMap((r, i) =>
          (r[j] ?? "").split(/\s+/).map((word) => textWidth(word, x, fs, weightOf(i, j))),
        ),
      ),
    );
    const full = natural.reduce((a, b) => a + b + 2 * padX, 0);
    const floor = longest.reduce((a, b) => a + b + 2 * padX, 0);
    // Under the box's width every column grows by the same share to fill it; past it, every
    // column keeps its longest word and the rest share what is left.
    const widths =
      full <= w
        ? natural.map((v) => ((v + 2 * padX) * w) / full)
        : natural.map((v, j) => {
            const share = Math.max(0, (w - floor) / Math.max(1, full - floor));
            const min = longest[j] ?? 0;
            return min + (v - min) * share + 2 * padX;
          });
    const tableW = widths.reduce((a, b) => a + b, 0);
    const lines = all.map((r, i) =>
      Array.from({ length: cols }, (_, j) =>
        wrap(r[j] ?? "", x, (widths[j] ?? 0) - 2 * padX, CELL_LINES, fs, weightOf(i, j)),
      ),
    );
    const lh = fs * 1.15;
    const heights = lines.map((r) => Math.max(1, ...r.map((cell) => cell.length)) * lh + fs * 0.7);
    const tableH = heights.reduce((a, b) => a + b, 0);
    const cut = lines.some((r, i) =>
      r.some((cell, j) => cell.join(" ") !== (all[i]?.[j] ?? "").trim().split(/\s+/).join(" ")),
    );
    if ((tableH <= h && !cut && tableW <= w + 0.5) || fs <= TABLE_MIN_FS) {
      return { fs, widths, lines, heights };
    }
    fs -= 1;
  }
}

/** The height the table takes drawn `w` wide (at most `h`), for sizing its box to the drawing. */
export function tableHeight(t: Table, x: Ctx, w: number, h: number): number {
  return Math.ceil(layoutTable(t, x, w, h).heights.reduce((a, b) => a + b, 0) + 2);
}

export function drawTable(t: Table, x: Ctx, w: number, h: number): string {
  const { c } = x;
  const { fs, widths, lines, heights } = layoutTable(t, x, w, h);
  const weightOf = (i: number, j: number) => (i === 0 && t.header ? 700 : j === 0 ? 600 : 400);
  const padX = fs * 0.5;
  const tableW = widths.reduce((a, b) => a + b, 0);
  // The slide's ground under the whole drawing: no card shows behind a table.
  const out: string[] = [`<rect x="0" y="0" width="${n(w)}" height="${n(h)}" fill="${c.bg}"/>`];
  let y = 0;
  lines.forEach((r, i) => {
    const rh = heights[i] ?? 0;
    const head = i === 0 && !!t.header;
    let cx = 0;
    r.forEach((cell, j) => {
      out.push(
        text(x, cx + padX, y + rh / 2, cell, {
          fs,
          anchor: "start",
          weight: weightOf(i, j),
          fill: c.ink,
        }),
      );
      cx += widths[j] ?? 0;
    });
    y += rh;
    if (i < lines.length - 1) {
      out.push(
        head
          ? `<line x1="0" y1="${n(y)}" x2="${n(tableW)}" y2="${n(y)}" stroke="${c.accent}" stroke-width="2"/>`
          : `<line x1="0" y1="${n(y)}" x2="${n(tableW)}" y2="${n(y)}" stroke="${c.line}" stroke-width="1"/>`,
      );
    }
  });
  return out.join("");
}

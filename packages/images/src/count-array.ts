/**
 * Countable maths quantities are drawn, never photographed (): asked for "24
 * identical counters in four equal groups of six", the image model drew about 30 in unequal groups
 * of 6, 6, 9 and 9, and equal grouping was the teaching point. A request that states how many
 * counters (dots, cubes, beads...) it wants, optionally in equal groups or rows, is drawn here as
 * an SVG at the zone's aspect: exact count, groups set apart, one colour, no scene.
 */

export interface CountArray {
  total: number;
  /** Equal groups (or rows) and how many in each; one group when the request names none. */
  groups: number;
  perGroup: number;
  /** "rows": one array, rows touching; "groups": clusters set apart. */
  arrangement: "groups" | "rows";
}

/** The grid (columns × rows) for `n` cells that best fills a box of aspect `a` (w/h). */
function grid(n: number, a: number): { cols: number; rows: number } {
  let best = { cols: n, rows: 1, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cell = Math.min(a / cols, 1 / rows);
    const score = cell - (cols * rows - n) * 1e-4;
    if (score > best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

const COLOUR = { fill: "#e0483e", rim: "#a92e27", plate: "#f3efe6", plateEdge: "#d9d2c3" };

/** The array as an SVG of width 1200 at `aspect` (width over height). */
export function countArraySvg(arr: CountArray, aspect = 1): string {
  const W = 1200;
  const H = Math.round(W / Math.max(0.4, Math.min(3, aspect)));
  const pad = 40;
  const lines: string[] = [];
  const draw = (cx: number, cy: number, r: number) =>
    lines.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.86).toFixed(1)}" fill="${COLOUR.fill}" stroke="${COLOUR.rim}" stroke-width="${(r * 0.12).toFixed(1)}"/>`,
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.5).toFixed(1)}" fill="none" stroke="${COLOUR.rim}" stroke-opacity="0.35" stroke-width="${(r * 0.06).toFixed(1)}"/>`,
    );
  if (arr.arrangement === "rows") {
    const cols = arr.perGroup;
    const rows = arr.groups;
    const cell = Math.min((W - 2 * pad) / cols, (H - 2 * pad) / rows);
    const x0 = (W - cell * cols) / 2;
    const y0 = (H - cell * rows) / 2;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) draw(x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell, cell / 2);
  } else {
    const inner = grid(arr.perGroup, 1.4);
    const plateA = (inner.cols + 0.6) / (inner.rows + 0.6);
    const outer = grid(arr.groups, (W - 2 * pad) / (H - 2 * pad) / plateA);
    const gap = arr.groups > 1 ? 36 : 0;
    const pw = Math.min(
      (W - 2 * pad - gap * (outer.cols - 1)) / outer.cols,
      ((H - 2 * pad - gap * (outer.rows - 1)) / outer.rows) * plateA,
    );
    const ph = pw / plateA;
    const cell = pw / (inner.cols + 0.6);
    const ox = (W - (pw * outer.cols + gap * (outer.cols - 1))) / 2;
    const oy = (H - (ph * outer.rows + gap * (outer.rows - 1))) / 2;
    for (let g = 0; g < arr.groups; g++) {
      const gx = ox + (g % outer.cols) * (pw + gap);
      const gy = oy + Math.floor(g / outer.cols) * (ph + gap);
      if (arr.groups > 1)
        lines.push(
          `<rect x="${gx.toFixed(1)}" y="${gy.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="${(cell * 0.4).toFixed(1)}" fill="${COLOUR.plate}" stroke="${COLOUR.plateEdge}" stroke-width="4"/>`,
        );
      for (let i = 0; i < arr.perGroup; i++) {
        const c = i % inner.cols;
        const r = Math.floor(i / inner.cols);
        const inRow = Math.min(inner.cols, arr.perGroup - r * inner.cols);
        const shift = ((inner.cols - inRow) * cell) / 2;
        draw(
          gx + cell * 0.3 + shift + (c + 0.5) * cell,
          gy + cell * 0.3 + (r + 0.5) * cell,
          cell / 2,
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${lines.join("")}</svg>`;
}

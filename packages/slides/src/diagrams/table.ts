/**
 * Tables: an accent header row and zebra rows, columns as wide as their words ask, cells wrapped
 * to two lines. The type steps down (never below 14) until the table fits its box.
 */
import type { Table } from "./schema";
import { type Ctx, n, text, textWidth, wrap } from "./svg";

export function drawTable(t: Table, x: Ctx, w: number, h: number): string {
  const { c } = x;
  const cols = t.header?.length ?? t.rows[0]?.length ?? 1;
  const all = [...(t.header ? [t.header] : []), ...t.rows];
  let fs = x.fs;
  const weightOf = (i: number, j: number) => (i === 0 && t.header ? 700 : j === 0 ? 600 : 400);
  for (;;) {
    const padX = fs * 0.6;
    const natural = Array.from({ length: cols }, (_, j) =>
      Math.max(fs * 2, ...all.map((r, i) => textWidth(r[j] ?? "", x, fs, weightOf(i, j)))),
    );
    // Past the box's width, every column keeps its longest word and the rest share what is left.
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
    const share = full <= w ? 1 : Math.max(0, (w - floor) / Math.max(1, full - floor));
    const widths = natural.map((v, j) => {
      const min = longest[j] ?? 0;
      return min + (v - min) * share + 2 * padX;
    });
    const tableW = widths.reduce((a, b) => a + b, 0);
    const lines = all.map((r, i) =>
      Array.from({ length: cols }, (_, j) =>
        wrap(r[j] ?? "", x, (widths[j] ?? 0) - 2 * padX, 2, fs, weightOf(i, j)),
      ),
    );
    const lh = fs * 1.2;
    const heights = lines.map((r) => Math.max(1, ...r.map((cell) => cell.length)) * lh + fs * 0.8);
    const tableH = heights.reduce((a, b) => a + b, 0);
    if (tableH <= h || fs <= 14) {
      const ox = (w - tableW) / 2;
      let y = Math.max(0, (h - tableH) / 2);
      const out: string[] = [];
      lines.forEach((r, i) => {
        const rh = heights[i] ?? 0;
        const head = i === 0 && !!t.header;
        const bodyIndex = t.header ? i - 1 : i;
        const fill = head ? c.accent : bodyIndex % 2 === 0 ? c.surface : c.tint;
        out.push(
          `<rect x="${n(ox)}" y="${n(y)}" width="${n(tableW)}" height="${n(rh)}" fill="${fill}"/>`,
        );
        let cx = ox;
        r.forEach((cell, j) => {
          const cw = widths[j] ?? 0;
          out.push(
            text(x, cx + padX, y + rh / 2, cell, {
              fs,
              anchor: "start",
              weight: weightOf(i, j),
              fill: head ? c.onAccent : c.ink,
            }),
          );
          cx += cw;
        });
        y += rh;
      });
      // Rules: column lines, row lines, and a frame.
      const top = Math.max(0, (h - tableH) / 2);
      let cx = ox;
      for (let j = 0; j < cols - 1; j++) {
        cx += widths[j] ?? 0;
        out.push(
          `<line x1="${n(cx)}" y1="${n(top)}" x2="${n(cx)}" y2="${n(top + tableH)}" stroke="${c.line}" stroke-width="1.5"/>`,
        );
      }
      let ry = top;
      for (let i = 0; i < heights.length - 1; i++) {
        ry += heights[i] ?? 0;
        out.push(
          `<line x1="${n(ox)}" y1="${n(ry)}" x2="${n(ox + tableW)}" y2="${n(ry)}" stroke="${c.line}" stroke-width="1.5"/>`,
        );
      }
      out.push(
        `<rect x="${n(ox)}" y="${n(top)}" width="${n(tableW)}" height="${n(tableH)}" fill="none" stroke="${c.ink}" stroke-width="2"/>`,
      );
      return out.join("");
    }
    fs -= 1;
  }
}

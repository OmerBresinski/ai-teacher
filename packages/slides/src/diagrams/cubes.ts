/**
 * r4: surface area. One large cube beside the same volume cut into small cubes, drawn in isometric
 * view with every exposed face tinted and gridded, so a class can count the squares each shows:
 * a cube `n` squares on an edge shows 6n² squares; cut into n³ unit cubes it shows 6n³.
 */
import type { Cubes } from "./schema";
import { STROKE, TYPE_FLOOR, WEIGHT } from "./style";
import { type Ctx, n, text, textWidth, wrap } from "./svg";

type P3 = [number, number, number];
const C30 = Math.cos(Math.PI / 6);

/** A cube's three visible faces (top, left-front, right-front) as SVG, at iso scale `e` per unit. */
function cube(x: Ctx, at: P3, a: number, e: number, ox: number, oy: number, grid: number): string {
  const P = ([px, py, pz]: P3): [number, number] => [
    ox + (px - py) * C30 * e,
    oy + (px + py) * 0.5 * e - pz * e,
  ];
  const [X0, Y0, Z0] = at;
  const face = (pts: P3[], fill: string, op: number) =>
    `<polygon points="${pts
      .map((p) => P(p).map(n).join(","))
      .join(
        " ",
      )}" fill="${fill}" fill-opacity="${op}" stroke="${x.c.ink}" stroke-width="${STROKE.line}" stroke-linejoin="round"/>`;
  const top: P3[] = [
    [X0, Y0, Z0 + a],
    [X0 + a, Y0, Z0 + a],
    [X0 + a, Y0 + a, Z0 + a],
    [X0, Y0 + a, Z0 + a],
  ];
  const left: P3[] = [
    [X0, Y0 + a, Z0],
    [X0 + a, Y0 + a, Z0],
    [X0 + a, Y0 + a, Z0 + a],
    [X0, Y0 + a, Z0 + a],
  ];
  const right: P3[] = [
    [X0 + a, Y0, Z0],
    [X0 + a, Y0 + a, Z0],
    [X0 + a, Y0 + a, Z0 + a],
    [X0 + a, Y0, Z0 + a],
  ];
  const out = [
    face(top, x.c.accent, 0.35),
    face(left, x.c.accent, 0.6),
    face(right, x.c.accent, 0.8),
  ];
  // Unit squares on each face, so the exposed area can be counted.
  const line = (p: P3, q: P3) => {
    const [a1, b1] = P(p);
    const [a2, b2] = P(q);
    return `<line x1="${n(a1)}" y1="${n(b1)}" x2="${n(a2)}" y2="${n(b2)}" stroke="${x.c.ink}" stroke-width="1" stroke-opacity="0.55"/>`;
  };
  for (let i = 1; i < grid; i++) {
    const t = (a * i) / grid;
    out.push(
      line([X0 + t, Y0, Z0 + a], [X0 + t, Y0 + a, Z0 + a]),
      line([X0, Y0 + t, Z0 + a], [X0 + a, Y0 + t, Z0 + a]),
      line([X0 + t, Y0 + a, Z0], [X0 + t, Y0 + a, Z0 + a]),
      line([X0, Y0 + a, Z0 + t], [X0 + a, Y0 + a, Z0 + t]),
      line([X0 + a, Y0 + t, Z0], [X0 + a, Y0 + t, Z0 + a]),
      line([X0 + a, Y0, Z0 + t], [X0 + a, Y0 + a, Z0 + t]),
    );
  }
  return out.join("");
}

/** The iso extent of a block `size` units on an edge: width and height per unit of scale. */
const extent = (size: number) => ({ w: 2 * C30 * size, h: 2 * size });

export function drawCubes(s: Cubes, x: Ctx, w: number, h: number): string {
  const k = s.split;
  const gap = 0.6;
  const big = k;
  const exploded = k + (k - 1) * gap;
  const caps = [s.captions?.[0] ?? "One cube", s.captions?.[1] ?? `${k ** 3} small cubes`];
  const notes = s.areas
    ? [
        s.notes?.[0] ?? `${6 * k * k} squares exposed`,
        s.notes?.[1] ?? `${6 * k ** 3} squares exposed`,
      ]
    : [s.notes?.[0], s.notes?.[1]];
  const colW = (w - w * 0.08) / 2;
  for (let fs = x.fs; fs >= Math.max(TYPE_FLOOR, x.minFs); fs -= 1) {
    const capL = caps.map((c) => wrap(c, x, colW, 2, fs, 700));
    const noteL = notes.map((t) => (t ? wrap(t, x, colW, 2, fs * 0.9, WEIGHT.label) : []));
    if ([...capL, ...noteL].some((l) => l[l.length - 1]?.endsWith("…"))) continue;
    if ([...capL].some((l) => l.some((t) => textWidth(t, x, fs, 700) > colW))) continue;
    const capH = Math.max(...capL.map((l) => l.length)) * fs * 1.2 + fs * 0.5;
    const noteH =
      Math.max(0, ...noteL.map((l) => l.length)) * fs * 1.08 + (s.areas || s.notes ? fs * 0.5 : 0);
    const room = h - capH - noteH - 6;
    // One scale for both, so the two volumes match: set by the larger (exploded) block.
    const ex = extent(exploded);
    const e = Math.min((colW * 0.92) / ex.w, room / ex.h);
    // A small cube needs an edge a class can see from the back: 12 px or more.
    if (e < 12 || room < 60) continue;
    const out: string[] = [];
    const cx = [colW / 2, w - colW / 2];
    capL.forEach((l, i) => {
      out.push(text(x, cx[i] as number, 0, l, { v: "top", fs, weight: 700 }));
    });
    const midY = capH + room / 2;
    // The big cube: its iso origin placed so the block is centred in its column.
    const place = (size: number, colX: number) => {
      const eh = extent(size);
      return { ox: colX, oy: midY - (eh.h * e) / 2 + size * e };
    };
    const pb = place(big, cx[0] as number);
    out.push(cube(x, [0, 0, 0], big, e, pb.ox, pb.oy, k));
    // The small cubes, far ones first, each a unit cube a gap apart.
    const pe = place(exploded, cx[1] as number);
    const cells: P3[] = [];
    for (let a = 0; a < k; a++)
      for (let b = 0; b < k; b++)
        for (let c = 0; c < k; c++) cells.push([a * (1 + gap), b * (1 + gap), c * (1 + gap)]);
    cells.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]) || p[2] - q[2]);
    for (const at of cells) out.push(cube(x, at, 1, e, pe.ox, pe.oy, 1));
    noteL.forEach((l, i) => {
      if (l.length)
        out.push(
          text(x, cx[i] as number, capH + room + fs * 0.4, l, {
            v: "top",
            fs: fs * 0.9,
            weight: WEIGHT.label,
          }),
        );
    });
    return out.join("");
  }
  x.faults?.push("the cubes do not fit the space at a readable size");
  return "";
}

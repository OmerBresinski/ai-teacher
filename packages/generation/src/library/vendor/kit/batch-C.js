// Batch C kit additions: geometry, nets, charts, sorting diagrams. Import from here:
//   import { polygon, shapeProps, ... } from '../kit/batch-C.js';
// Tokens only (colours are theme tokens or color-mix of tokens). All words are real SVG text,
// marked editable(path) or computed(path). Angles are in degrees, maths convention (0 = right,
// anticlockwise positive); screen y points down, so the code flips them.
//
// GEOMETRY
//   SHAPES                         names: circle, semicircle, oval, triangle (equilateral), right_triangle, isosceles,
//                                  scalene, square, rectangle, parallelogram, rhombus, trapezium, kite, pentagon,
//                                  hexagon, heptagon, octagon, irregular_pentagon, irregular_hexagon, l_shape, arrow_head
//   shapePts(shape, {sides, sizes:{w,h,skew}, regular})  unit vertices (y up) for a named shape or n sides
//   polygon(p, shape, {cx, cy, size, rotate, sizes, sides, regular, fill, stroke, a}) -> {g, el, pts, props}
//   shapeProps(pts, {curved})      computed {sides, vertices, rightAngles:[i], parallelPairs:[[i,j]], symmetry:[{p,a}],
//                                  regular, convex, equalSides, angles:[deg], irregular}
//   arcD(cx, cy, r, a0, a1)        SVG path for an arc (degrees, maths convention)
//   angleArc(p, at, a0, a1, label, {r, col, fill, labelR, computedPath, edit, a, right})  arc, or right-angle square at 90
//   rightAngleMark(p, at, a0, {size, col, a, turn})   square corner mark between a0 and a0+turn (turn 90 or -90)
//   mirrorLine(p, x1, y1, x2, y2, {col, a, extend})   dashed line of symmetry
//   reflectPt(pt, l0, l1)          reflect [x,y] in the line through l0 and l1
//   gridPaper(p, box, cell, {quadrants:1|4, xMin, xMax, yMin, yMax, axes, labels, xName, yName, computedPath, a})
//                                  -> {g, map(x,y)->[sx,sy], X(x), Y(y), cell, xMin, xMax, yMin, yMax, box}
//   plotPoint(p, [sx,sy], label, {col, r, side:'ne'|'nw'|'se'|'sw', computedPath, edit, a, ground}) -> g (g.box)
// NETS (2.5D fold: flat faces, one shade per face angle, painter's order, no lighting effects)
//   SOLIDS                         facts per solid {name, faces, edges, vertices, flat, curved, polyhedron, net}
//   eulerOK(solid)                 F + V - E = 2 for polyhedra (true for curved solids, which are not checked)
//   CUBE_NETS                      the 11 cube nets as cell lists
//   netDef(solid, {layout, l, w, h, s}) -> {faces:[[x,y]...], fold:[deg], root} or null (sphere, cylinder, cone)
//   netFolds(def)                  true if the net folds closed with no two faces on top of each other
//   net(p, solid, {cx, cy, unit, layout, dims, fill, yaw, pitch, a, u}) -> {g, def, set(u), centre(i)->[x,y], ok}
//                                  set(0) = flat net seen square on; set(1) = the solid in a three-quarter view
//   curvedNet(p, solid, {cx, cy, r, h, fill, a}) -> g    flat net of a cylinder or cone, true proportions
// CHARTS (all value axes come from axis(); zero baseline always)
//   barChart(p, box, data:[{label, value}], {max, step, block, col, focus:[i], sFrom, labelPath(i), valuePath(i),
//            yLabel, yLabelEdit, showValues, a}) -> {g, S, bars:[{el, x, w, top, value}], baseY}
//   pictogram(p, box, rows:[{label, value}], {key, symbol, sFrom, labelPath(i), keyPath, a}) -> {g, rows}
//   pictogramCheck(values, key)    -> indices whose value is not a whole or half multiple of key
//   lineChart(p, box, pts:[{x, y, label}], {xMin, xMax, yMax, step, xLabel, yLabel, col, draw, sFrom, a})
//                                  -> {g, path, set(u), S, X}   set(u) draws the line in real time (tick hook)
//   niceTop(max, step)             {step, top}: value-axis top at or above the largest value
//   pieAngles(values)              degrees per value, whole degrees summing to exactly 360
//   pie(p, cx, cy, r, data:[{label, value}], {sFrom, labelPath(i), valuePath(i), show:'angle'|'percent'|'value', a})
//                                  -> {g, angles, sectors, labelBoxes}  (check labelBoxes against the live area)
//   tally(p, x, y, n, {h, sFrom, a, col}) -> {g, w}      gates of five
//   PICTO_SYMBOLS, PICTO_TOPICS    pictogram symbols and their topic tags (disc, square, star: any; person: people;
//                                  apple: fruit; ball: sport; book: reading). pictoSymbol(p, kind, x, y, size, a)
// SORTING
//   numberRule(text)               parse "even", "odd", "multiple of 3", "> 20", "less than 10", "factor of 12",
//                                  "square number", "prime" -> {kind, n, test(v), label} or null (a word rule)
//   venn(p, box, sets:[{label}], {apart, labelPath(i), a}) -> {g, circles, regionOf([x,y]), slots(mem, k, rr, rw), labelBoxes}
//                                  slots returns fewer than k when the region is full: the model must ctx.warn
//                                  mem is an array of booleans per set; [] / all false = outside every hoop
//   carroll(p, box, rows:[label,label], cols:[label,label], {rowPath(i), colPath(i), a}) -> {g, cell(r,c), slots(r,c,k,r)}
//   flyItem(p, to, from, label, {s, edit, computedPath, col, r, delay}) -> g   an item that flies from `from` to `to`
//   trayPts(box, n)                start positions for n items in a row
import {
  h, T, measure, clamp, fmtInt, overlaps, GRID,
  axis, niceTicks, textBlock, lanePlace, editable, computed,
} from './index.js';

const R = Math.PI / 180;
const EPS = 1e-6;
const shadeOf = (fill, pct) => pct >= 100 ? fill : `color-mix(in oklab, ${fill} ${pct}%, var(--shade))`;
const ptsAttr = pts => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/* ================================================================== GEOMETRY */
const reg = (n, rot = 90) => Array.from({ length: n }, (_, i) => [Math.cos((rot + 360 * i / n) * R), Math.sin((rot + 360 * i / n) * R)]);
export const SHAPES = {
  circle: { curved: true }, semicircle: { curved: true }, oval: { curved: true },
  triangle: s => reg(3), right_triangle: s => [[0, 0], [s.w || 1.2, 0], [0, s.h || 1]],
  isosceles: s => [[-(s.w || 1) / 2, 0], [(s.w || 1) / 2, 0], [0, s.h || 1.5]],
  scalene: () => [[0, 0], [1.6, 0], [0.45, 1.05]],
  square: () => [[0, 0], [1, 0], [1, 1], [0, 1]],
  rectangle: s => [[0, 0], [s.w || 1.7, 0], [s.w || 1.7, s.h || 1], [0, s.h || 1]],
  parallelogram: s => { const w = s.w || 1.5, hh = s.h || 1, k = s.skew ?? .5; return [[0, 0], [w, 0], [w + k, hh], [k, hh]]; },
  rhombus: () => [[0, -0.7], [1, 0], [0, 0.7], [-1, 0]],
  trapezium: s => { const w = s.w || 1.8, hh = s.h || 1; return [[0, 0], [w, 0], [w * .72, hh], [w * .28, hh]]; },
  kite: () => [[0, 1], [0.6, 0.35], [0, -1.1], [-0.6, 0.35]],
  pentagon: () => reg(5), hexagon: () => reg(6), heptagon: () => reg(7), octagon: () => reg(8),
  irregular_pentagon: () => [[0, 0], [1.5, 0], [1.8, 0.9], [0.7, 1.5], [-0.2, 0.8]],
  irregular_hexagon: () => [[0, 0], [1.3, -0.2], [2, 0.6], [1.6, 1.4], [0.5, 1.5], [-0.3, 0.8]],
  l_shape: () => [[0, 0], [1.4, 0], [1.4, 0.6], [0.6, 0.6], [0.6, 1.6], [0, 1.6]],
  arrow_head: () => [[0, 0], [1, 0.5], [0, 1], [0.35, 0.5]],
};
/** Unit vertices (y up) for a named shape or a regular n-gon. Curved shapes return null. */
export function shapePts(shape, { sides, sizes = {}, regular = true } = {}) {
  if (typeof shape === 'number' || (!shape && sides)) { const n = typeof shape === 'number' ? shape : sides; return regular ? reg(n) : reg(n).map(([x, y], i) => [x * (1 + .18 * Math.sin(i * 2.3)), y * (1 + .15 * Math.cos(i * 1.7))]); }
  const f = SHAPES[shape]; if (!f || f.curved) return null; return f(sizes);
}

function polyAngles(pts) {
  const n = pts.length; let area = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
  const sgn = Math.sign(area) || 1;
  return pts.map((v, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const u = [a[0] - v[0], a[1] - v[1]], w = [b[0] - v[0], b[1] - v[1]];
    let ang = Math.acos(clamp((u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w)), -1, 1)) / R;
    const cr = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]);
    if (Math.sign(cr) !== sgn && Math.abs(cr) > EPS) ang = 360 - ang;
    return ang;
  });
}
export const reflectPt = ([x, y], [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = ((x - ax) * dx + (y - ay) * dy) / L;
  const fx = ax + t * dx, fy = ay + t * dy; return [2 * fx - x, 2 * fy - y];
};
/** Properties computed from the geometry, never typed in. Works in any coordinates. */
export function shapeProps(pts, { curved } = {}) {
  if (!pts || curved) return { curved: true, sides: 0, vertices: 0, rightAngles: [], parallelPairs: [], symmetry: [], regular: false, convex: true };
  const n = pts.length, L = pts.map((p, i) => Math.hypot(pts[(i + 1) % n][0] - p[0], pts[(i + 1) % n][1] - p[1]));
  const scaleK = Math.max(...L), tol = scaleK * 1e-3;
  const angles = polyAngles(pts);
  const rightAngles = angles.map((a, i) => Math.abs(a - 90) < .5 ? i : -1).filter(i => i >= 0);
  const dir = i => { const a = pts[i], b = pts[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; };
  const parallelPairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const u = dir(i), w = dir(j); if (Math.abs(u[0] * w[1] - u[1] * w[0]) / (Math.hypot(...u) * Math.hypot(...w)) < 2e-3) parallelPairs.push([i, j]);
  }
  const c = [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  const cands = [];
  pts.forEach((p, i) => { cands.push(p); cands.push([(p[0] + pts[(i + 1) % n][0]) / 2, (p[1] + pts[(i + 1) % n][1]) / 2]); });
  const symmetry = [];
  for (const q of cands) {
    if (Math.hypot(q[0] - c[0], q[1] - c[1]) < tol) continue;
    const a = ((Math.atan2(q[1] - c[1], q[0] - c[0]) / R) % 180 + 180) % 180;
    if (symmetry.some(s => Math.min(Math.abs(s.a - a), 180 - Math.abs(s.a - a)) < .5)) continue;
    const ok = pts.every(p => { const r = reflectPt(p, c, q); return pts.some(o => Math.hypot(o[0] - r[0], o[1] - r[1]) < tol * 4); });
    if (ok) symmetry.push({ p: c, a, through: q });
  }
  const equalSides = L.every(l => Math.abs(l - L[0]) < tol * 4), equalAngles = angles.every(a => Math.abs(a - angles[0]) < .5);
  const convex = angles.every(a => a < 180 - .01);
  return { sides: n, vertices: n, angles, lengths: L, rightAngles, parallelPairs, symmetry, equalSides, regular: equalSides && equalAngles, convex, irregular: !(equalSides && equalAngles) };
}

/** Draw a shape fitted into a size x size box centred on (cx,cy). Returns screen vertices and computed props. */
export function polygon(p, shape, { cx = 640, cy = 380, size = 220, rotate = 0, sizes, sides, regular = true, fill = 'var(--focus-pale)', stroke = 'var(--ink-2)', a = {} } = {}) {
  const g = h('g', a, p);
  const unit = shapePts(shape, { sides, sizes, regular });
  if (!unit) {
    const kind = SHAPES[shape] ? shape : 'circle'; const r = size / 2; let el;
    const at = { fill, stroke, 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' };
    if (kind === 'semicircle') el = h('path', Object.assign({ d: `M${cx - r} ${cy + r * .25} A ${r} ${r} 0 0 1 ${cx + r} ${cy + r * .25} Z`, transform: `rotate(${-rotate} ${cx} ${cy})` }, at), g);
    else if (kind === 'oval') el = h('ellipse', Object.assign({ cx, cy, rx: r, ry: r * .62, transform: `rotate(${-rotate} ${cx} ${cy})` }, at), g);
    else el = h('circle', Object.assign({ cx, cy, r }, at), g);
    return { g, el, pts: null, props: shapeProps(null, { curved: true }) };
  }
  const rot = unit.map(([x, y]) => [x * Math.cos(rotate * R) - y * Math.sin(rotate * R), x * Math.sin(rotate * R) + y * Math.cos(rotate * R)]);
  const xs = rot.map(q => q[0]), ys = rot.map(q => q[1]);
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), k = size / Math.max(bw, bh);
  const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
  const pts = rot.map(([x, y]) => [cx + (x - mx) * k, cy - (y - my) * k]);
  const el = h('polygon', { points: ptsAttr(pts), fill, stroke, 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' }, g);
  return { g, el, pts, props: shapeProps(pts) };
}

/** Arc path, degrees in maths convention, drawn the short or long way exactly from a0 to a1 (anticlockwise if a1 > a0). */
export function arcD(cx, cy, r, a0, a1) {
  const P = a => [cx + r * Math.cos(a * R), cy - r * Math.sin(a * R)];
  const [x0, y0] = P(a0), [x1, y1] = P(a1), sweep = a1 - a0;
  if (Math.abs(sweep) >= 359.99) { const [xm, ym] = P(a0 + 180); return `M${x0} ${y0} A${r} ${r} 0 1 ${sweep > 0 ? 0 : 1} ${xm} ${ym} A${r} ${r} 0 1 ${sweep > 0 ? 0 : 1} ${x0} ${y0}`; }
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 0 : 1} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
export function rightAngleMark(p, [x, y], a0, { size = 26, col = 'var(--focus)', a = {}, turn = 90 } = {}) {
  const u = [Math.cos(a0 * R), -Math.sin(a0 * R)], w = [Math.cos((a0 + turn) * R), -Math.sin((a0 + turn) * R)];
  const P1 = [x + u[0] * size, y + u[1] * size], P2 = [x + (u[0] + w[0]) * size, y + (u[1] + w[1]) * size], P3 = [x + w[0] * size, y + w[1] * size];
  return h('path', Object.assign({ d: `M${P1[0]} ${P1[1]} L${P2[0]} ${P2[1]} L${P3[0]} ${P3[1]}`, fill: 'none', stroke: col, 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, a), p);
}
/** Angle marker at `at` from ray a0 to ray a1 (anticlockwise when a1 > a0). A 90° angle gets the square mark. */
export function angleArc(p, at, a0, a1, label, { r = 56, col = 'var(--focus)', fill = 'var(--focus-pale)', labelR, computedPath, edit, a = {}, right = true } = {}) {
  const g = h('g', a, p); const [x, y] = at; const sweep = a1 - a0;
  if (right && Math.abs(Math.abs(sweep) - 90) < .01) rightAngleMark(g, at, a0, { size: r * .5, col, turn: Math.sign(sweep) * 90 });
  else {
    if (fill) h('path', { d: arcD(x, y, r, a0, a1) + ` L${x} ${y} Z`, fill, stroke: 'none' }, g);
    h('path', { d: arcD(x, y, r, a0, a1), fill: 'none', stroke: col, 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  }
  const mid = a0 + sweep / 2; let lab = null;
  if (label != null && label !== '') {
    const lr = labelR || r + 34; const lx = x + lr * Math.cos(mid * R), ly = y - lr * Math.sin(mid * R);
    const c = Math.cos(mid * R); lab = T(g, lx, ly + 10, label, 'ts-label', { 'text-anchor': c > .35 ? 'start' : c < -.35 ? 'end' : 'middle', cls: 'halo' });
    computed(lab, computedPath); editable(lab, edit);
  }
  g.label = lab; g.mid = mid; return g;
}
export function mirrorLine(p, x1, y1, x2, y2, { col = 'var(--focus)', a = {}, extend = 24 } = {}) {
  const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
  return h('line', Object.assign({ x1: x1 - ux * extend, y1: y1 - uy * extend, x2: x2 + ux * extend, y2: y2 + uy * extend, stroke: col, 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '14 10', 'stroke-linecap': 'round' }, a), p);
}

/** Squared grid with optional axes and numbered lines (x and y values sit on the lines, never between). */
export function gridPaper(p, box, cell, o = {}) {
  const g = h('g', o.a || {}, p); const q4 = o.quadrants === 4;
  const nx = Math.floor(box.w / cell), ny = Math.floor(box.h / cell);
  const xMin = o.xMin ?? (q4 ? -Math.floor(nx / 2) : 0), xMax = o.xMax ?? (q4 ? Math.floor(nx / 2) : nx);
  const yMin = o.yMin ?? (q4 ? -Math.floor(ny / 2) : 0), yMax = o.yMax ?? (q4 ? Math.floor(ny / 2) : ny);
  const W0 = (xMax - xMin) * cell, H0 = (yMax - yMin) * cell, ox = box.x + (box.w - W0) / 2, oy = box.y + (box.h - H0) / 2;
  const X = x => ox + (x - xMin) * cell, Y = y => oy + (yMax - y) * cell; const num = v => v < 0 ? '\u2212' + (-v) : String(v);
  h('rect', { x: ox, y: oy, width: W0, height: H0, fill: 'var(--paper)' }, g);
  for (let x = xMin; x <= xMax; x++) h('line', { x1: X(x), x2: X(x), y1: oy, y2: oy + H0, stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, g);
  for (let y = yMin; y <= yMax; y++) h('line', { x1: ox, x2: ox + W0, y1: Y(y), y2: Y(y), stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, g);
  if (o.axes !== false) {
    const ax0 = clamp(0, xMin, xMax), ay0 = clamp(0, yMin, yMax);
    h('line', { x1: ox, x2: ox + W0, y1: Y(ay0), y2: Y(ay0), stroke: 'var(--axis)', 'stroke-width': 'var(--sw-struct)' }, g);
    h('line', { x1: X(ax0), x2: X(ax0), y1: oy, y2: oy + H0, stroke: 'var(--axis)', 'stroke-width': 'var(--sw-struct)' }, g);
    if (o.labels !== false) {
      const wMax = Math.max(measure(g, String(xMin), 'ts-axis'), measure(g, String(xMax), 'ts-axis'), measure(g, String(yMin), 'ts-axis'));
      const every = Math.max(1, Math.ceil((wMax + 28) / cell));
      const lane = [];
      for (let x = xMin; x <= xMax; x++) {
        if (x % every || x === 0) continue; const w = measure(g, num(x), 'ts-axis');
        const bb = lanePlace(lane, w, X(x), { gap: 28, shift: 0, min: 0, max: 1280 }); if (!bb) continue;
        computed(T(g, X(x), Y(ay0) + 30, num(x), 'ts-axis', { 'text-anchor': 'middle' }), o.computedPath);
      }
      for (let y = yMin; y <= yMax; y++) {
        if (y % Math.max(1, Math.ceil(36 / cell)) || y === 0) continue;
        computed(T(g, X(ax0) - 10, Y(y) + 8, num(y), 'ts-axis', { 'text-anchor': 'end' }), o.computedPath);
      }
      if (xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0) computed(T(g, X(ax0) - 10, Y(ay0) + 30, '0', 'ts-axis', { 'text-anchor': 'end' }), o.computedPath);
      if (o.xName !== '') editable(T(g, ox + W0 + 14, Y(ay0) + 9, o.xName || 'x', 'ts-label', { cls: 'halo' }), o.xNameEdit);
      if (o.yName !== '') editable(T(g, X(ax0), oy - 14, o.yName || 'y', 'ts-label', { 'text-anchor': 'middle', cls: 'halo' }), o.yNameEdit);
    }
  }
  return { g, X, Y, map: (x, y) => [X(x), Y(y)], cell, xMin, xMax, yMin, yMax, box: { x: ox, y: oy, w: W0, h: H0 } };
}
/** A plotted point with an optional label (a coordinate pair is computed text). side picks the quadrant for the label. */
export function plotPoint(p, [x, y], label, { col = 'var(--focus)', r = 10, side = 'ne', computedPath, edit, a = {}, ground = true } = {}) {
  const g = h('g', a, p);
  h('circle', { cx: x, cy: y, r, fill: col, stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)' }, g);
  if (label != null && label !== '') {
    const w = measure(g, label, 'ts-label'), east = side.includes('e'), north = side.includes('n');
    const lx = east ? x + r + 10 : x - r - 10 - w, ly = north ? y - r - 10 : y + r + 34;
    const box = { x: lx - 6, y: ly - 28, w: w + 12, h: 36 };
    if (ground) h('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 'var(--r-mark)', fill: 'var(--paper)' }, g);
    const t = T(g, lx, ly, label, 'ts-label'); computed(t, computedPath); editable(t, edit); g.box = box;
  }
  return g;
}

/* ================================================================== SOLIDS AND NETS */
export const SOLIDS = {
  cube: { name: 'cube', faces: 6, edges: 12, vertices: 8, flat: 6, curved: 0, polyhedron: true, net: true },
  cuboid: { name: 'cuboid', faces: 6, edges: 12, vertices: 8, flat: 6, curved: 0, polyhedron: true, net: true },
  square_pyramid: { name: 'square-based pyramid', faces: 5, edges: 8, vertices: 5, flat: 5, curved: 0, polyhedron: true, net: true },
  triangular_pyramid: { name: 'triangular-based pyramid (tetrahedron)', faces: 4, edges: 6, vertices: 4, flat: 4, curved: 0, polyhedron: true, net: true },
  triangular_prism: { name: 'triangular prism', faces: 5, edges: 9, vertices: 6, flat: 5, curved: 0, polyhedron: true, net: true },
  pentagonal_prism: { name: 'pentagonal prism', faces: 7, edges: 15, vertices: 10, flat: 7, curved: 0, polyhedron: true, net: false },
  hexagonal_prism: { name: 'hexagonal prism', faces: 8, edges: 18, vertices: 12, flat: 8, curved: 0, polyhedron: true, net: false },
  cylinder: { name: 'cylinder', faces: 3, edges: 2, vertices: 0, flat: 2, curved: 1, polyhedron: false, net: 'curved' },
  cone: { name: 'cone', faces: 2, edges: 1, vertices: 1, flat: 1, curved: 1, polyhedron: false, net: 'curved' },
  sphere: { name: 'sphere', faces: 1, edges: 0, vertices: 0, flat: 0, curved: 1, polyhedron: false, net: false },
};
export const eulerOK = s => { const f = SOLIDS[s]; return !f || !f.polyhedron || f.faces + f.vertices - f.edges === 2; };
export const CUBE_NETS = [ // the 11 nets of a cube: six 1-4-1, three 2-3-1, one 2-2-2, one 3-3
  ...[[0, 0], [0, 1], [0, 2], [0, 3], [1, 1], [1, 2]].map(([t, b]) => [[t, 0], [0, 1], [1, 1], [2, 1], [3, 1], [b, 2]]),
  ...[1, 2, 3].map(b => [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [b, 2]]),
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]], [[0, 0], [1, 0], [2, 0], [2, 1], [3, 1], [4, 1]],
];
const rect = (x, y, w, hh) => [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]];
/** Net as flat polygons (net units), the fold turn of each face about its hinge, and the root face. */
export function netDef(solid, { layout, l = 1.4, w = 1, h: hh = 0.7, s = 1, ht = 0.9, len = 1.6 } = {}) {
  if (solid === 'cube') { const cells = layout || CUBE_NETS[0]; return { faces: cells.map(([x, y]) => rect(x, y, 1, 1)), fold: cells.map(() => 90) }; }
  if (solid === 'cuboid') return { faces: [rect(hh, hh, l, w), rect(hh, hh + w, l, hh), rect(hh, 0, l, hh), rect(hh, -w, l, w), rect(0, hh, hh, w), rect(hh + l, hh, hh, w)], fold: [0, 90, 90, 90, 90, 90], root: 0 };
  if (solid === 'square_pyramid') {
    const sl = Math.hypot(ht, s / 2), turn = 180 - Math.atan2(ht, s / 2) / R;
    return { faces: [rect(0, 0, s, s), [[0, 0], [s, 0], [s / 2, -sl]], [[s, 0], [s, s], [s + sl, s / 2]], [[s, s], [0, s], [s / 2, s + sl]], [[0, s], [0, 0], [-sl, s / 2]]], fold: [0, turn, turn, turn, turn], root: 0 };
  }
  if (solid === 'triangular_pyramid') {
    const t = Math.sqrt(3) / 2 * s, turn = 180 - Math.acos(1 / 3) / R;
    const A = [0, 0], B = [s, 0], C = [s / 2, -t];
    return { faces: [[A, B, C], [A, B, [s / 2, t]], [B, C, [s * 1.5, -t]], [C, A, [-s / 2, -t]]], fold: [0, turn, turn, turn], root: 0 };
  }
  if (solid === 'triangular_prism') {
    const t = Math.sqrt(3) / 2 * s;
    return { faces: [rect(s, 0, s, len), rect(0, 0, s, len), rect(2 * s, 0, s, len), [[s, 0], [2 * s, 0], [1.5 * s, -t]], [[s, len], [2 * s, len], [1.5 * s, len + t]]], fold: [0, 120, 120, 90, 90], root: 0 };
  }
  return null;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
function rotAxis(p, o, k, th) { // Rodrigues: rotate p about the axis through o with unit direction k
  const v = sub(p, o), c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v);
  return [0, 1, 2].map(i => o[i] + v[i] * c + kv[i] * s + k[i] * kd * (1 - c));
}
function netTree(def) {
  const F = def.faces, n = F.length, same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3;
  const root = def.root ?? F.map((f, i) => [i, F.filter((g, j) => j !== i && f.some((a, ai) => g.some((b, bi) => same(a, b) && (same(f[(ai + 1) % f.length], g[(bi + 1) % g.length]) || same(f[(ai + 1) % f.length], g[(bi + g.length - 1) % g.length]))))).length]).sort((a, b) => b[1] - a[1])[0][0];
  const par = Array(n).fill(-1), hinge = Array(n).fill(null), seen = new Set([root]), qu = [root];
  while (qu.length) { const i = qu.shift();
    for (let j = 0; j < n; j++) { if (seen.has(j)) continue;
      for (let a = 0; a < F[i].length && !hinge[j]; a++) { const p0 = F[i][a], p1 = F[i][(a + 1) % F[i].length];
        if (F[j].some(q => same(q, p0)) && F[j].some(q => same(q, p1))) { par[j] = i; hinge[j] = [p0, p1]; seen.add(j); qu.push(j); } } } }
  return { root, par, hinge, connected: seen.size === n };
}
/** Fold every face by fraction u of its turn (towards the viewer: x right, y down, z into the slide). Returns 3D vertices per face. */
function foldNet(def, tree, u) {
  const F = def.faces;
  const sign = F.map((f, j) => { // fold direction: the face's centre moves to -z
    if (!tree.hinge[j]) return 0; const [a, b] = tree.hinge[j]; const o = [a[0], a[1], 0], k = norm([b[0] - a[0], b[1] - a[1], 0]);
    const c = [f.reduce((s, q) => s + q[0], 0) / f.length, f.reduce((s, q) => s + q[1], 0) / f.length, 0];
    return rotAxis(c, o, k, .2)[2] < 0 ? 1 : -1;
  });
  return F.map((f, j) => f.map(([x, y]) => {
    let pt = [x, y, 0]; let i = j;
    while (i !== tree.root && i >= 0) { const [a, b] = tree.hinge[i]; pt = rotAxis(pt, [a[0], a[1], 0], norm([b[0] - a[0], b[1] - a[1], 0]), sign[i] * def.fold[i] * u * R); i = tree.par[i]; }
    return pt;
  }));
}
/** True if the net folds into a closed solid: connected, and no two faces land in the same place. */
export function netFolds(def) {
  if (!def) return false; const tree = netTree(def); if (!tree.connected) return false;
  const P = foldNet(def, tree, 1); const cs = P.map(f => [0, 1, 2].map(i => f.reduce((s, q) => s + q[i], 0) / f.length));
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (Math.hypot(...sub(cs[i], cs[j])) < 1e-2) return false;
  return true;
}
/** A net that folds (u 0 → 1) in 2.5D. The view turns from square-on (flat) to three-quarter (solid) as it folds. */
export function net(p, solid, { cx = 640, cy = 380, unit = 90, layout, dims = {}, fill = 'var(--compare-pale)', edge = 'var(--ink-2)', yaw = 34, pitch = 24, a = {}, u = 0 } = {}) {
  const g = h('g', a, p); const def = netDef(solid, Object.assign({ layout }, dims));
  if (!def) return { g, def: null, ok: false, set() {}, centre: () => [cx, cy] };
  const tree = netTree(def); const ok = netFolds(def);
  const els = def.faces.map(() => h('polygon', { fill, stroke: edge, 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' }, g));
  const L = norm([-0.45, -0.75, -0.5]); let proj = [];
  function set(uu) {
    uu = clamp(uu); const P3 = foldNet(def, tree, uu);
    const all = P3.flat(), c = [0, 1, 2].map(i => all.reduce((s, q) => s + q[i], 0) / all.length);
    // as it folds, the view tips the root face down onto the floor (seen `pitch` degrees from above) and turns by `yaw`
    const ya = yaw * uu * R, pa = -(90 - pitch) * uu * R;
    const view = q => { let [x, y, z] = sub(q, c); [y, z] = [y * Math.cos(pa) - z * Math.sin(pa), y * Math.sin(pa) + z * Math.cos(pa)]; [x, z] = [x * Math.cos(ya) + z * Math.sin(ya), -x * Math.sin(ya) + z * Math.cos(ya)]; return [x, y, z]; };
    const V = P3.map(f => f.map(view));
    proj = V.map(f => f.map(([x, y]) => [cx + x * unit, cy + y * unit]));
    const order = V.map((f, i) => [i, f.reduce((s, q) => s + q[2], 0) / f.length]).sort((a2, b2) => b2[1] - a2[1]);
    for (const [i] of order) {
      const f = V[i], nrm = norm(cross(sub(f[1], f[0]), sub(f[2], f[0]))); const d = Math.abs(dot(nrm, L));
      els[i].setAttribute('points', ptsAttr(proj[i])); els[i].style.setProperty('fill', shadeOf(fill, uu < .02 || d > .72 ? 100 : d > .42 ? 86 : 74));
      g.appendChild(els[i]);
    }
  }
  set(u);
  return { g, def, ok, set, faces: els, centre: i => { const f = proj[i]; return [f.reduce((s, q) => s + q[0], 0) / f.length, f.reduce((s, q) => s + q[1], 0) / f.length]; } };
}
/** Flat net of a cylinder (rectangle 2πr wide plus two circles) or a cone (sector plus circle), in true proportion. */
export function curvedNet(p, solid, { cx = 640, cy = 380, r = 40, h: hh = 120, fill = 'var(--compare-pale)', a = {} } = {}) {
  const g = h('g', a, p); const at = { fill, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' };
  if (solid === 'cylinder') {
    const w = 2 * Math.PI * r; h('rect', Object.assign({ x: cx - w / 2, y: cy - hh / 2, width: w, height: hh }, at), g);
    h('circle', Object.assign({ cx, cy: cy - hh / 2 - r, r }, at), g); h('circle', Object.assign({ cx, cy: cy + hh / 2 + r, r }, at), g);
  } else if (solid === 'cone') {
    const sl = Math.hypot(r, hh), th = 360 * r / sl, top = cy - sl / 2; // sector: radius = slant height, arc = base circumference
    h('path', Object.assign({ d: `M${cx} ${top} L` + arcD(cx, top, sl, 270 - th / 2, 270 + th / 2).slice(1) + ' Z' }, at), g);
    h('circle', Object.assign({ cx, cy: top + sl + r, r }, at), g);
  }
  return g;
}

/* ================================================================== CHARTS */
/** Top of a value axis: the first nice step at or above the largest value. */
export const niceTop = (max, step) => { step = step || (niceTicks(0, Math.max(1, max), 6)[1] || 1); return { step, top: Math.max(step, Math.ceil(max / step - 1e-9) * step) }; };
const pathFn = (f, i, fb) => typeof f === 'function' ? f(i) : f ? `${f}.${i}` : fb;
/** Bar or block chart from a zero baseline; bars rise one build each from sFrom. */
export function barChart(p, box, data, o = {}) {
  const g = h('g', o.a || {}, p); const vals = data.map(d => +d.value || 0);
  const nt = niceTop(Math.max(1, ...vals), o.step); const step = nt.step; const max = Math.max(o.max ?? nt.top, ...vals);
  const left = box.x + 70, baseY = box.y + box.h - 64, topY = box.y + (o.yLabel ? 46 : 12);
  const S = v => baseY - v / max * (baseY - topY);
  const ticks = Array.from({ length: Math.floor(max / step + 1e-9) + 1 }, (_, i) => i * step);
  for (const v of ticks) if (v > 0) h('line', { x1: left, x2: box.x + box.w, y1: S(v), y2: S(v), stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, g);
  axis(g, { x0: baseY, x1: topY, y: left, d0: 0, d1: max, step, vertical: true, computedPath: o.scalePath || 'scale' });
  h('line', { x1: left, x2: box.x + box.w, y1: baseY, y2: baseY, stroke: 'var(--axis)', 'stroke-width': 'var(--sw-struct)' }, g);
  if (o.yLabel) editable(T(g, left - 60, topY - 24, o.yLabel, 'ts-small'), o.yLabelEdit);
  const n = data.length, slot = (box.x + box.w - left) / n, bw = Math.min(110, slot * .62); const bars = []; const lane = [];
  data.forEach((d, i) => {
    const xc = left + slot * (i + .5), v = vals[i], focus = (o.focus || []).includes(i);
    const col = focus ? 'var(--focus)' : (o.col || 'var(--compare)');
    const bg = h('g', { s: o.sFrom != null ? o.sFrom + i : null, cls: o.sFrom != null ? 'rise' : null }, g); let el;
    if (o.block) { const u = (baseY - S(1)); el = h('g', {}, bg); for (let k = 0; k < v; k++) h('rect', { x: xc - bw / 2, y: baseY - (k + 1) * u, width: bw, height: u, fill: col, stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)', cls: 'body' }, el); }
    else el = h('rect', { x: xc - bw / 2, y: S(v), width: bw, height: baseY - S(v), fill: col, cls: 'body' }, bg);
    if (o.showValues) computed(T(bg, xc, S(v) - 12, fmtInt(v), 'ts-label', { 'text-anchor': 'middle' }), pathFn(o.valuePath, i, `data.${i}.value`));
    const lw = measure(g, d.label, 'ts-small'); const slotBox = lanePlace(lane, Math.min(lw, slot - 28), xc, { gap: 28, shift: 0, min: 0, max: 1280 });
    const tb = textBlock(bg, xc, baseY + 34, d.label, { cls: 'ts-small', maxW: slot - 28, maxLines: 2, lh: 26, anchor: 'middle', edit: pathFn(o.labelPath, i, `data.${i}.label`) });
    bars.push({ el: bg, x: xc, w: bw, top: S(v), value: v, labelBox: slotBox, label: tb });
  });
  return { g, S, bars, baseY, max };
}
/* pictogram symbols: flat, centred on (x,y), size = width. Topic tags say where each fits. */
export const PICTO_TOPICS = { disc: ['any'], square: ['any'], star: ['any'], person: ['people', 'survey', 'class'], apple: ['fruit', 'food'], ball: ['sport', 'games'], book: ['reading', 'books'] };
export const PICTO_SYMBOLS = Object.keys(PICTO_TOPICS);
export function pictoSymbol(p, kind, x, y, s = 40, a = {}) {
  const g = h('g', a, p); const r = s / 2;
  if (kind === 'square') h('rect', { x: x - r * .9, y: y - r * .9, width: r * 1.8, height: r * 1.8, rx: 'var(--r-mark)', fill: 'var(--counter)', cls: 'body' }, g);
  else if (kind === 'star') h('polygon', { points: ptsAttr(Array.from({ length: 10 }, (_, i) => { const rr = i % 2 ? r * .45 : r; const t = (90 + i * 36) * R; return [x + rr * Math.cos(t), y - rr * Math.sin(t)]; })), fill: 'var(--energy)', cls: 'body' }, g);
  else if (kind === 'person') { h('circle', { cx: x, cy: y - r * .52, r: r * .32, fill: 'var(--focus)' }, g); h('path', { d: `M${x - r * .62} ${y + r * .9} Q ${x - r * .62} ${y - r * .1} ${x} ${y - r * .1} Q ${x + r * .62} ${y - r * .1} ${x + r * .62} ${y + r * .9} Z`, fill: 'var(--focus)', cls: 'body' }, g); }
  else if (kind === 'apple') { h('circle', { cx: x, cy: y + r * .1, r: r * .8, fill: 'var(--berry)', cls: 'body' }, g); h('path', { d: `M${x} ${y - r * .55} q ${r * .1} ${-r * .3} ${r * .4} ${-r * .38}`, fill: 'none', stroke: 'var(--trunk)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g); h('ellipse', { cx: x + r * .32, cy: y - r * .72, rx: r * .22, ry: r * .1, fill: 'var(--leaf)' }, g); }
  else if (kind === 'ball') { h('circle', { cx: x, cy: y, r: r * .85, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, g); h('polygon', { points: ptsAttr(reg(5).map(([px, py]) => [x + px * r * .32, y - py * r * .32])), fill: 'var(--ink-2)' }, g); }
  else if (kind === 'book') { h('rect', { x: x - r * .8, y: y - r * .62, width: r * 1.6, height: r * 1.24, rx: 'var(--r-mark)', fill: 'var(--water)', cls: 'body' }, g); h('line', { x1: x, x2: x, y1: y - r * .62, y2: y + r * .62, stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)' }, g); }
  else h('circle', { cx: x, cy: y, r: r * .82, fill: 'var(--counter)', stroke: 'var(--counter-edge)', 'stroke-width': 'var(--sw-hair)', cls: 'body' }, g);
  return g;
}
export const pictogramCheck = (values, key) => values.map((v, i) => { const q = v / key; return Math.abs(q * 2 - Math.round(q * 2)) < 1e-9 ? -1 : i; }).filter(i => i >= 0);
let picN = 0;
/** Pictogram rows: one symbol = key; a half symbol only at key/2. The key sits under the rows. */
export function pictogram(p, box, rows, o = {}) {
  const g = h('g', o.a || {}, p); const key = o.key || 1, sym = o.symbol || 'disc';
  const labW = Math.min(260, Math.max(...rows.map(r => measure(g, r.label, 'ts-label'))) + 24);
  const rowH = Math.min(78, (box.h - 70) / rows.length), maxN = Math.max(1, ...rows.map(r => Math.ceil(r.value / key)));
  const s = Math.min(rowH * .78, (box.w - labW - 20) / maxN * .9), pitchX = s * 1.12; const out = [];
  rows.forEach((r, i) => {
    const y = box.y + rowH * (i + .5); const rg = h('g', { s: o.sFrom != null ? o.sFrom + i : null, cls: o.sFrom != null ? 'rise' : null }, g);
    editable(T(rg, box.x + labW - 24, y + 10, r.label, 'ts-label', { 'text-anchor': 'end' }), pathFn(o.labelPath, i, `rows.${i}.label`));
    const full = Math.floor(r.value / key + 1e-9), half = Math.abs(r.value / key - full - .5) < 1e-9;
    for (let k = 0; k < full; k++) pictoSymbol(rg, sym, box.x + labW + pitchX * (k + .5), y, s);
    if (half) { const id = `pic-half-${++picN}`; const x0 = box.x + labW + pitchX * (full + .5);
      h('rect', { x: x0 - s / 2 - 2, y: y - s, width: s / 2 + 2, height: s * 2 }, h('clipPath', { id }, h('defs', {}, rg)));
      pictoSymbol(rg, sym, x0, y, s, { 'clip-path': `url(#${id})` }); }
    if (i) h('line', { x1: box.x, x2: box.x + box.w, y1: y - rowH / 2, y2: y - rowH / 2, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, g);
    out.push({ g: rg, y, full, half });
  });
  const ky = box.y + rowH * rows.length + 46; const kg = h('g', { s: o.keyS ?? null, cls: o.keyS != null ? 'rise' : null }, g);
  pictoSymbol(kg, sym, box.x + labW + s / 2, ky - 8, s * .8);
  computed(T(kg, box.x + labW + s + 12, ky + 2, `= ${fmtInt(key)}`, 'ts-label'), o.keyPath || 'keyUnit');
  return { g, rows: out, symbolSize: s };
}
/** Line chart for continuous data. set(u) draws it in real time from the tick hook; or pass draw: build index. */
export function lineChart(p, box, pts, o = {}) {
  const g = h('g', o.a || {}, p); const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
  const xMin = o.xMin ?? Math.min(...xs), xMax = o.xMax ?? Math.max(...xs), nt = niceTop(Math.max(1, ...ys), o.step), yMax = o.yMax ?? nt.top;
  const left = box.x + 70, baseY = box.y + box.h - 70, topY = box.y + (o.yLabel ? 46 : 12), right = box.x + box.w - 20;
  const S = v => baseY - v / yMax * (baseY - topY), X = v => left + (v - xMin) / (xMax - xMin) * (right - left);
  const step = nt.step;
  for (let v = step; v <= yMax + 1e-9; v += step) h('line', { x1: left, x2: right, y1: S(v), y2: S(v), stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, g);
  axis(g, { x0: baseY, x1: topY, y: left, d0: 0, d1: yMax, step, vertical: true, computedPath: o.scalePath || 'scale' });
  axis(g, { x0: left, x1: right, y: baseY, d0: xMin, d1: xMax, step: o.xStep, count: 8, computedPath: o.xPath || 'xRange', fmt: o.xFmt });
  if (o.yLabel) editable(T(g, left - 60, topY - 24, o.yLabel, 'ts-small'), o.yLabelEdit);
  if (o.xLabel) editable(T(g, right, baseY + 66, o.xLabel, 'ts-small', { 'text-anchor': 'end' }), o.xLabelEdit);
  const P = pts.map(q => [X(q.x), S(q.y)]); const col = o.col || 'var(--focus)';
  const path = h('path', { d: 'M' + P.map(q => q.join(' ')).join(' L'), fill: 'none', stroke: col, 'stroke-width': 'var(--sw-data)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1,
    cls: o.draw != null ? 'draw' : null, s: o.draw ?? null, 'stroke-dasharray': o.draw != null ? null : '1 1' }, g);
  const segL = []; let Ltot = 0; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); Ltot += d; segL.push(Ltot); }
  const dots = P.map((q, i) => h('circle', { cx: q[0], cy: q[1], r: 9, fill: col, stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)', s: o.draw ?? null }, g));
  function set(u) { u = clamp(u); path.style.strokeDashoffset = String(1 - u); dots.forEach((d, i) => { d.style.opacity = (i === 0 ? 0 : segL[i - 1] / Ltot) <= u + 1e-6 ? '' : '0'; }); }
  if (o.draw == null) set(o.u ?? 1);
  return { g, path, set, S, X, dots };
}
/** Whole-degree angles that sum to exactly 360 (largest remainder). */
export function pieAngles(values) {
  const tot = values.reduce((s, v) => s + v, 0); if (!(tot > 0)) return values.map(() => 0);
  const raw = values.map(v => v / tot * 360), fl = raw.map(Math.floor); let left = 360 - fl.reduce((s, v) => s + v, 0);
  raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
  return fl;
}
const PIE_COLS = ['var(--water)', 'var(--energy)', 'var(--life)', 'var(--heat)', 'var(--part)', 'var(--compare)', 'var(--counter)', 'var(--neutral)'];
/** Pie chart from 12 o'clock, clockwise. Labels sit outside, de-collided per side; leaders end at the label edge. */
export function pie(p, cx, cy, r, data, o = {}) {
  const g = h('g', o.a || {}, p); const vals = data.map(d => +d.value || 0), angles = pieAngles(vals), tot = vals.reduce((s, v) => s + v, 0);
  let a = 0; const sectors = []; const labs = [];
  data.forEach((d, i) => {
    const a0 = 90 - a, a1 = 90 - a - angles[i]; const mid = (a0 + a1) / 2; a += angles[i];
    const sg = h('g', { s: o.sFrom != null ? o.sFrom + i : null, cls: o.sFrom != null ? 'pop' : null }, g);
    const dd = angles[i] >= 360 ? `M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx - .01} ${cy - r} Z` : `M${cx} ${cy} L${cx + r * Math.cos(a0 * R)} ${cy - r * Math.sin(a0 * R)} A${r} ${r} 0 ${angles[i] > 180 ? 1 : 0} 1 ${cx + r * Math.cos(a1 * R)} ${cy - r * Math.sin(a1 * R)} Z`;
    h('path', { d: dd, fill: (o.focus || []).includes(i) ? 'var(--focus)' : PIE_COLS[i % PIE_COLS.length], stroke: 'var(--paper)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, sg);
    sectors.push({ g: sg, a0, a1, mid, deg: angles[i] });
    labs.push({ i, mid, side: Math.cos(mid * R) >= 0 ? 1 : -1, y: cy - (r + 40) * Math.sin(mid * R), g: sg });
  });
  for (const side of [1, -1]) { // vertical de-collision per side, two-line labels 62 tall
    const L = labs.filter(l => l.side === side).sort((x, y) => x.y - y.y);
    for (let k = 1; k < L.length; k++) if (L[k].y - L[k - 1].y < 66) L[k].y = L[k - 1].y + 66;
  }
  for (const l of labs) {
    const ex = cx + l.side * (r + 46), d = data[l.i]; const rx = cx + r * Math.cos(l.mid * R), ry = cy - r * Math.sin(l.mid * R);
    const lab = editable(T(l.g, ex + l.side * 10, l.y, d.label, 'ts-label', { 'text-anchor': l.side > 0 ? 'start' : 'end' }), pathFn(o.labelPath, l.i, `data.${l.i}.label`));
    const show = o.show || 'angle'; const s2 = show === 'percent' ? `${Math.round(vals[l.i] / tot * 100)}%` : show === 'value' ? fmtInt(vals[l.i]) : `${angles[l.i]}°`;
    computed(T(l.g, ex + l.side * 10, l.y + 28, s2, 'ts-small', { 'text-anchor': l.side > 0 ? 'start' : 'end' }), pathFn(o.valuePath, l.i, `data.${l.i}.value`));
    h('path', { d: `M${rx} ${ry} L${ex} ${l.y - 8}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-lead)' }, l.g);
    const lw = lab.getComputedTextLength(); l.box = { x: l.side > 0 ? ex + 10 : ex - 10 - lw, y: l.y - 28, w: lw, h: 64 };
    l.label = lab;
  }
  return { g, angles, sectors, labelBoxes: labs.map(l => l.box) };
}
/** Tally marks in gates of five. */
export function tally(p, x, y, n, { h: hh = 44, sFrom, a = {}, col = 'var(--ink)' } = {}) {
  const g = h('g', a, p); const gap = 14, gateW = 4 * gap + 24; let k = 0;
  for (let i = 0; i < n; i++) {
    const gate = Math.floor(i / 5), j = i % 5, x0 = x + gate * gateW;
    const at = { stroke: col, 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', s: sFrom != null ? sFrom + k++ : null, cls: sFrom != null ? 'draw' : null, pathLength: sFrom != null ? 1 : null };
    if (j < 4) h('line', Object.assign({ x1: x0 + j * gap, x2: x0 + j * gap, y1: y - hh, y2: y }, at), g);
    else h('line', Object.assign({ x1: x0 - 8, x2: x0 + 3 * gap + 8, y1: y - hh * .2, y2: y - hh * .8 }, at), g);
  }
  return { g, w: Math.ceil(n / 5) * gateW - 24 + 8 };
}

/* ================================================================== SORTING */
/** Machine-checkable number rule, or null for a word rule (the teacher sorts those). */
export function numberRule(text) {
  const s = String(text || '').toLowerCase().trim(); let m;
  const R2 = (kind, n, test, label) => ({ kind, n, test, label });
  if (/^even( numbers?)?$/.test(s)) return R2('even', 2, v => v % 2 === 0, 'even');
  if (/^odd( numbers?)?$/.test(s)) return R2('odd', 2, v => Math.abs(v % 2) === 1, 'odd');
  if ((m = s.match(/^(?:a )?multiples? of (\d+)$/))) { const n = +m[1]; return R2('multiple', n, v => n > 0 && v % n === 0, `multiple of ${n}`); }
  if ((m = s.match(/^(?:a )?factors? of (\d+)$/))) { const n = +m[1]; return R2('factor', n, v => v > 0 && n % v === 0, `factor of ${n}`); }
  if ((m = s.match(/^(?:>|more than|greater than|bigger than)\s*(-?\d+)$/))) { const n = +m[1]; return R2('gt', n, v => v > n, `> ${n}`); }
  if ((m = s.match(/^(?:<|less than|smaller than|fewer than)\s*(-?\d+)$/))) { const n = +m[1]; return R2('lt', n, v => v < n, `< ${n}`); }
  if ((m = s.match(/^(?:>=|≥|at least)\s*(-?\d+)$/))) { const n = +m[1]; return R2('gte', n, v => v >= n, `≥ ${n}`); }
  if ((m = s.match(/^(?:<=|≤|at most)\s*(-?\d+)$/))) { const n = +m[1]; return R2('lte', n, v => v <= n, `≤ ${n}`); }
  if (/^square( numbers?)?$/.test(s)) return R2('square', 0, v => v >= 0 && Number.isInteger(Math.sqrt(v)), 'square number');
  if (/^prime( numbers?)?$/.test(s)) return R2('prime', 0, v => { if (v < 2 || !Number.isInteger(v)) return false; for (let d = 2; d * d <= v; d++) if (v % d === 0) return false; return true; }, 'prime');
  return null;
}
const VENN_COLS = [['var(--focus)', 'var(--focus-text)'], ['var(--compare)', 'var(--compare-text)'], ['var(--energy)', 'var(--energy-text)']];
/** Venn diagram (1–3 sets) or separate sorting hoops (apart). slots(mem, k, r) gives k free item centres in a region. */
export function venn(p, box, sets, o = {}) {
  const g = h('g', o.a || {}, p); const n = sets.length;
  h('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, g);
  const top = box.y + 60, cy = box.y + 60 + (box.h - 80) / 2; let circles;
  if (o.apart) { const r = Math.min((box.h - 100) / 2, box.w / n / 2 - 30); circles = sets.map((_, i) => ({ x: box.x + box.w * (i + .5) / n, y: cy, r })); }
  else if (n === 3) { const r = Math.min((box.h - 84) / 3, (box.w - 40) / 3.24); const d = r * .62; const cy3 = top + r + 2;
    circles = [{ x: box.x + box.w / 2 - d, y: cy3, r }, { x: box.x + box.w / 2 + d, y: cy3, r }, { x: box.x + box.w / 2, y: cy3 + d * 1.6, r }]; }
  else if (n === 2) { const r = Math.min((box.h - 100) / 2, box.w / 3.3); const d = r * .62; circles = [{ x: box.x + box.w / 2 - d, y: cy, r }, { x: box.x + box.w / 2 + d, y: cy, r }]; }
  else { const r = Math.min((box.h - 100) / 2, box.w / 3); circles = [{ x: box.x + box.w / 2, y: cy, r }]; }
  circles.forEach((c, i) => {
    const [col] = VENN_COLS[i % 3];
    h('circle', { cx: c.x, cy: c.y, r: c.r, fill: `color-mix(in oklab, ${col} 12%, transparent)`, stroke: col, 'stroke-width': 'var(--sw-arrow)' }, g);
  });
  const labelBoxes = []; // labels above (or below for the third circle), on a paper ground
  circles.forEach((c, i) => {
    const below = n === 3 && i === 2 && !o.apart; const ly = below ? c.y + c.r + 34 : c.y - c.r - 16;
    const maxW = o.apart ? box.w / n - 40 : n === 1 ? box.w - 80 : box.w / 2 - 40; const anchor = o.apart || n === 1 || below ? 'middle' : i === 0 ? 'end' : 'start';
    const lx = o.apart || n === 1 || below ? c.x : i === 0 ? c.x + c.r * .25 : c.x - c.r * .25;
    const tb = textBlock(g, lx, ly - (below ? 0 : 0), sets[i].label, { cls: 'ts-label', maxW, maxLines: 1, lh: 32, anchor, edit: pathFn(o.labelPath, i, `sets.${i}.label`), a: { cls: 'halo-paper' } });
    tb.el.style.setProperty('fill', VENN_COLS[i % 3][1]);
    labelBoxes.push({ x: anchor === 'middle' ? lx - tb.w / 2 : anchor === 'end' ? lx - tb.w : lx, y: ly - 28, w: tb.w, h: 36 });
  });
  const memOf = ([x, y]) => circles.map(c => Math.hypot(x - c.x, y - c.y) < c.r);
  const clear = ([x, y], rr) => circles.every(c => Math.abs(Math.hypot(x - c.x, y - c.y) - c.r) > rr + 6) && x > box.x + rr + 8 && x < box.x + box.w - rr - 8 && y > box.y + rr + 8 && y < box.y + box.h - rr - 8 && !labelBoxes.some(b => overlaps(b, { x: x - rr, y: y - rr, w: 2 * rr, h: 2 * rr }, 4));
  /** k item centres inside region `mem`, filled from the region's core outward; items are rw x rr half-sizes. */
  function slots(mem, k, rr = 26, rw = rr) {
    const want = circles.map((_, i) => !!(mem && mem[i])); const cand = [];
    const depth = q => Math.min(...circles.map(c => Math.abs(Math.hypot(q[0] - c.x, q[1] - c.y) - c.r)));
    for (let x = box.x; x < box.x + box.w; x += 6) for (let y = box.y; y < box.y + box.h; y += 6) { const q = [x, y]; if (memOf(q).every((v, i) => v === want[i]) && clear(q, Math.max(rr, rw * .8))) cand.push([x, y, depth(q)]); }
    cand.sort((a2, b2) => b2[2] - a2[2]); const out = [];
    for (const q of cand) { if (out.length >= k) break; if (out.every(o2 => Math.hypot((q[0] - o2[0]) / (rw * 2 + 12), (q[1] - o2[1]) / (rr * 2 + 10)) >= 1)) out.push(q); }
    return out.map(q => [q[0], q[1]]).sort((a2, b2) => a2[1] - b2[1] || a2[0] - b2[0]);
  }
  return { g, circles, regionOf: memOf, slots, labelBoxes };
}
/** Carroll diagram: 2 x 2 cells with row and column headings (rules and their opposites). */
export function carroll(p, box, rows, cols, o = {}) {
  const g = h('g', o.a || {}, p); const hw = Math.min(260, box.w * .26), hh = 64;
  const cw = (box.w - hw) / cols.length, ch = (box.h - hh) / rows.length;
  h('rect', { x: box.x + hw, y: box.y + hh, width: box.w - hw, height: box.h - hh, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, g);
  for (let i = 1; i < cols.length; i++) h('line', { x1: box.x + hw + cw * i, x2: box.x + hw + cw * i, y1: box.y, y2: box.y + box.h, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, g);
  for (let i = 1; i < rows.length; i++) h('line', { x1: box.x, x2: box.x + box.w, y1: box.y + hh + ch * i, y2: box.y + hh + ch * i, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, g);
  cols.forEach((c, i) => { const tb = textBlock(g, box.x + hw + cw * (i + .5), box.y + hh - 20, c, { cls: 'ts-label', maxW: cw - 24, maxLines: 1, anchor: 'middle', edit: pathFn(o.colPath, i, `cols.${i}`) }); tb.el.style.setProperty('fill', VENN_COLS[1][1]); });
  rows.forEach((r, i) => { const tb = textBlock(g, box.x + hw - 18, box.y + hh + ch * (i + .5) + 4, r, { cls: 'ts-label', maxW: hw - 30, maxLines: 2, lh: 30, anchor: 'end', edit: pathFn(o.rowPath, i, `rows.${i}`) }); tb.el.style.setProperty('fill', VENN_COLS[0][1]); });
  const cell = (ri, ci) => ({ x: box.x + hw + cw * ci, y: box.y + hh + ch * ri, w: cw, h: ch });
  function slots(ri, ci, k, rr = 26) {
    const c = cell(ri, ci), per = Math.max(1, Math.floor((c.w - 20) / (rr * 2 + 16))), out = [];
    for (let i = 0; i < k; i++) { const row = Math.floor(i / per), col = i % per; const y = c.y + 20 + rr + row * (rr * 2 + 14); if (y + rr > c.y + c.h - 8) break; const nIn = Math.min(per, k - row * per); out.push([c.x + c.w / 2 + (col - (nIn - 1) / 2) * (rr * 2 + 16), y]); }
    return out;
  }
  return { g, cell, slots };
}
/** An item that flies from `from` to `to` on its build (reduced motion: fades in place). */
export function flyItem(p, to, from, label, { s, edit, computedPath, col = 'var(--paper)', r = 26, delay } = {}) {
  const g = h('g', { s, cls: s != null ? 'fly' : null, delay, vars: { '--fx': `${from[0] - to[0]}px`, '--fy': `${from[1] - to[1]}px` } }, p);
  const t = T(g, to[0], to[1] + 9, label, 'ts-label', { 'text-anchor': 'middle' }); const w = Math.max(r * 2, t.getComputedTextLength() + 24);
  g.insertBefore(h('rect', { x: to[0] - w / 2, y: to[1] - r, width: w, height: r * 2, rx: r, fill: col, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', cls: 'lift body' }), t);
  editable(t, edit); computed(t, computedPath); g.box = { x: to[0] - w / 2, y: to[1] - r, w, h: r * 2 };
  return g;
}
export const trayPts = (box, n) => Array.from({ length: n }, (_, i) => [box.x + box.w * (i + .5) / n, box.y + box.h / 2]);

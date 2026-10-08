// Model-private geometry for shape_3d_nets. One source for every view: a solid IS its net folded
// closed (u = 1), so the turning solid, the counted faces, edges and vertices, and the unfolding
// net can never disagree. Fold maths ported from kit/batch-C.js net(), extended with prisms of
// any side count, an upright prism net, the folded 3D points, and a clash finder for cube nets.
import { netDef, CUBE_NETS } from '../../kit/batch-C.js';

const R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const mean = pts => [0, 1, 2].map(i => pts.reduce((s, q) => s + (q[i] || 0), 0) / pts.length);
function rotAxis(p, o, k, th) {
  const v = sub(p, o), c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v);
  return [0, 1, 2].map(i => o[i] + v[i] * c + kv[i] * s + k[i] * kd * (1 - c));
}

/* ---------------------------------------------------------------- nets */
/** Regular n-gon with one side on A→B, lying on the side of `out` (a unit 2D vector). */
function ngonOn(A, B, n, out) {
  const s = Math.hypot(B[0] - A[0], B[1] - A[1]), ap = s / (2 * Math.tan(Math.PI / n));
  const C = [(A[0] + B[0]) / 2 + out[0] * ap, (A[1] + B[1]) / 2 + out[1] * ap];
  const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]), aB = Math.atan2(B[1] - C[1], B[0] - C[0]);
  let st = 2 * Math.PI / n; const d = ((aB - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); if (Math.abs(d - st) > 1e-6) st = -st;
  const rr = Math.hypot(A[0] - C[0], A[1] - C[1]);
  return Array.from({ length: n }, (_, i) => i === 0 ? A : i === 1 ? B : [C[0] + rr * Math.cos(a0 + st * i), C[1] + rr * Math.sin(a0 + st * i)]);
}
const rect = (x, y, w, hh) => [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]];
/** Prism lying on a side: a strip of n rectangles, an end on each side of the middle one. */
function prismStrip(n, s = 1, len = 1.5) {
  const r = Math.floor(n / 2); const faces = [], fold = [];
  for (let i = 0; i < n; i++) { faces.push(rect(i * s, 0, s, len)); fold.push(i === r ? 0 : 360 / n); }
  faces.push(ngonOn([r * s, 0], [(r + 1) * s, 0], n, [0, -1])); fold.push(90);
  faces.push(ngonOn([r * s, len], [(r + 1) * s, len], n, [0, 1])); fold.push(90);
  return { faces, fold, root: r };
}
/** Prism standing on an end: the base with a rectangle on every side and the top on one of them. */
function prismUpright(n, s = 1, len = 1.3) {
  const base = ngonOn([0, 0], [s, 0], n, [0, -1]); const faces = [base], fold = [0];
  const c = mean(base.map(p => [p[0], p[1], 0]));
  let top = null;
  base.forEach((A, i) => {
    const B = base[(i + 1) % n]; const m = [(A[0] + B[0]) / 2 - c[0], (A[1] + B[1]) / 2 - c[1]]; const l = Math.hypot(...m); const o = [m[0] / l, m[1] / l];
    const A2 = [A[0] + o[0] * len, A[1] + o[1] * len], B2 = [B[0] + o[0] * len, B[1] + o[1] * len];
    faces.push([A, B, B2, A2]); fold.push(90);
    if (i === 0) top = ngonOn(A2, B2, n, o);
  });
  faces.push(top); fold.push(90);
  return { faces, fold, root: 0 };
}
export const PRISM_N = { triangular_prism: 3, pentagonal_prism: 5, hexagonal_prism: 6 };
export const POLY = ['cube', 'cuboid', 'square_pyramid', 'triangular_pyramid', 'triangular_prism', 'pentagonal_prism', 'hexagonal_prism'];

function tree(def) {
  const F = def.faces, n = F.length, same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3;
  const shares = (f, g) => f.some((a, ai) => g.some((b, bi) => same(a, b) && (same(f[(ai + 1) % f.length], g[(bi + 1) % g.length]) || same(f[(ai + 1) % f.length], g[(bi + g.length - 1) % g.length]))));
  const root = def.root ?? F.map((f, i) => [i, F.filter((g, j) => j !== i && shares(f, g)).length]).sort((a, b) => b[1] - a[1])[0][0];
  const par = Array(n).fill(-1), hinge = Array(n).fill(null), seen = new Set([root]), qu = [root];
  while (qu.length) {
    const i = qu.shift();
    for (let j = 0; j < n; j++) {
      if (seen.has(j)) continue;
      for (let a = 0; a < F[i].length && !hinge[j]; a++) {
        const p0 = F[i][a], p1 = F[i][(a + 1) % F[i].length];
        if (F[j].some(q => same(q, p0)) && F[j].some(q => same(q, p1))) { par[j] = i; hinge[j] = [p0, p1]; seen.add(j); qu.push(j); }
      }
    }
  }
  const sign = F.map((f, j) => {
    if (!hinge[j]) return 0; const [a, b] = hinge[j]; const o = [a[0], a[1], 0], k = norm([b[0] - a[0], b[1] - a[1], 0]);
    const c = [f.reduce((s, q) => s + q[0], 0) / f.length, f.reduce((s, q) => s + q[1], 0) / f.length, 0];
    return rotAxis(c, o, k, .2)[2] < 0 ? 1 : -1;
  });
  return { root, par, hinge, sign, connected: seen.size === n };
}

/** The net of a solid, ready to fold. upright: prisms stand on an end (for stacking). */
export function geoFor(solid, { layout, upright } = {}) {
  let def;
  if (PRISM_N[solid]) def = upright ? prismUpright(PRISM_N[solid]) : prismStrip(PRISM_N[solid]);
  else def = netDef(solid, { layout });
  if (!def) return null;
  return { def, t: tree(def) };
}
/** 3D points of every face with each fold at fraction u of its turn (z into the slide). */
export function foldAt(G, u) {
  const { def, t } = G;
  return def.faces.map((f, j) => f.map(([x, y]) => {
    let pt = [x, y, 0]; let i = j;
    while (i !== t.root && i >= 0) { const [a, b] = t.hinge[i]; pt = rotAxis(pt, [a[0], a[1], 0], norm([b[0] - a[0], b[1] - a[1], 0]), t.sign[i] * def.fold[i] * u * R); i = t.par[i]; }
    return pt;
  }));
}
/** View transform as in kit net(): the root face tips onto the floor as u → 1 and the view turns by yaw. */
export function viewer(u, yaw, pitch) {
  // turn about the solid's own upright (z, normal to the base) first, then tip the view: verticals stay vertical
  const ya = yaw * u * R, pa = -(90 - pitch) * u * R;
  return q => { let [x, y, z] = q; [x, y] = [x * Math.cos(ya) - y * Math.sin(ya), x * Math.sin(ya) + y * Math.cos(ya)]; [y, z] = [y * Math.cos(pa) - z * Math.sin(pa), y * Math.sin(pa) + z * Math.cos(pa)]; return [x, y, z]; };
}
export function view(P3, u, yaw, pitch) {
  const c = mean(P3.flat()); const v = viewer(u, yaw, pitch);
  return P3.map(f => f.map(q => v(sub(q, c))));
}
const LIGHT = norm([-0.45, -0.75, -0.5]);
/** Shade step (percent of the fill kept) for a face in view space: one flat tone per face angle. */
export function shadeStep(f) { const n = norm(cross(sub(f[1], f[0]), sub(f[2], f[0]))); const d = Math.abs(dot(n, LIGHT)); return d > .72 ? 100 : d > .42 ? 86 : 74; }

/** Unique vertices, edges and faces of the closed solid, with which ones face away in this view. */
export function topology(V) {
  const verts = [], key = q => verts.findIndex(w => Math.hypot(...sub(w, q)) < 1e-4);
  const faces = V.map(f => f.map(q => { let i = key(q); if (i < 0) { verts.push(q); i = verts.length - 1; } return i; }));
  const c = mean(verts);
  const hidden = V.map(f => { const fc = mean(f); let n = cross(sub(f[1], f[0]), sub(f[2], f[0])); if (dot(n, sub(fc, c)) < 0) n = n.map(v => -v); return n[2] > 1e-9; });
  const edges = []; const ek = new Map();
  faces.forEach((f, fi) => f.forEach((a, i) => { const b = f[(i + 1) % f.length]; const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (!ek.has(k)) { ek.set(k, edges.length); edges.push({ a, b, faces: [] }); } edges[ek.get(k)].faces.push(fi); }));
  edges.forEach(e => { e.hidden = e.faces.every(fi => hidden[fi]); });
  const vHidden = verts.map((_, vi) => faces.every((f, fi) => !f.includes(vi) || hidden[fi]));
  return { verts, faces, edges, hidden, vHidden, centres: V.map(mean) };
}
/** Screen offset (view units) of the world vector that lifts a solid by its own height, for stacking. */
export function stackVec(G, yaw, pitch) {
  const P = foldAt(G, 1).flat(); const H = Math.max(...P.map(q => -q[2])); return viewer(1, yaw, pitch)([0, 0, -H]);
}

/* ---------------------------------------------------------------- cube nets as squares */
export const cubeLayout = id => CUBE_NETS[Math.max(0, Math.min(10, (+String(id).slice(1) || 5) - 1))];
/** "X../XXX" style rows → cells [[col,row]]. X is a square; . - _ o or a space is a gap. */
export function parseSquares(s) {
  const rows = String(s || '').trim().split(/[\/\n|]+/).map(r => r.trim()).filter(r => r.length);
  const cells = []; let bad = null;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (/[xX#■]/.test(ch)) cells.push([x, y]); else if (!/[.\-_oO ]/.test(ch)) bad = ch; }));
  if (bad) return { error: `“${bad}” is not a square or a gap. Write rows of X (a square) and . (a gap), split by /, like .X../XXXX/.X..` };
  if (!cells.length) return { error: 'There are no squares. Write rows of X (a square) and . (a gap), split by /, like .X../XXXX/.X..' };
  return { cells, cols: Math.max(...cells.map(c => c[0])) + 1, rows: rows.length };
}
/** Does this set of unit squares fold into a cube? Returns {ok, connected, clash: cell indices to mark | null, corner: [x,y] grid point where four squares meet | null}. */
export function cubeCheck(cells) {
  const def = { faces: cells.map(([x, y]) => rect(x, y, 1, 1)), fold: cells.map(() => 90) };
  const t = tree(def); if (!t.connected) return { ok: false, connected: false, clash: null };
  const P = foldAt({ def, t }, 1); const cs = P.map(mean);
  const pairs = [];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (Math.hypot(...sub(cs[i], cs[j])) < 1e-2) pairs.push([i, j]);
  if (!pairs.length) return { ok: cells.length === 6, connected: true, clash: null };
  // show a pair the class can see cannot be folded flat onto each other: two squares that are not joined
  const joined = ([i, j]) => Math.abs(cells[i][0] - cells[j][0]) + Math.abs(cells[i][1] - cells[j][1]) === 1;
  const apart = pairs.find(p => !joined(p));
  if (apart) return { ok: false, connected: true, clash: apart, corner: null };
  // every clash is between joined squares: four squares meet round one corner (a 2 by 2 block)
  const at = (x, y) => cells.findIndex(c => c[0] === x && c[1] === y);
  for (const [i] of pairs) for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const x = cells[i][0] + dx, y = cells[i][1] + dy; const blk = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)];
    if (blk.every(v => v >= 0)) return { ok: false, connected: true, clash: blk, corner: [x + 1, y + 1] };
  }
  return { ok: false, connected: true, clash: pairs[0], corner: null };
}

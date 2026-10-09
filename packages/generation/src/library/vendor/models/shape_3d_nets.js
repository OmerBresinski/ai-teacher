// 3D shapes and nets: one shape studied closely (it turns, its faces, edges and vertices are
// counted from the geometry, then it unfolds into its net and arrangements of squares are tested),
// or up to four shapes side by side (names, counts, which roll and which stack).
// Every count is computed from the folded net, so the drawing and the numbers cannot disagree.
import {
  h, T, measure, clamp, lerp, eIO, GRID, panels, textBlock, arrow,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { SOLIDS, curvedNet } from '../kit/batch-C.js';
import { geoFor, foldAt, view, topology, shadeStep, stackVec, cubeLayout, parseSquares, cubeCheck, POLY } from './shape_3d_nets/geo.js';

export const meta = {
  id: 'shape_3d_nets', name: '3D shapes and nets', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Reception', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Naming 3D shapes, counting their faces, edges and vertices, which roll and which stack, and how a net folds into a solid.',
};

const SOLID_IDS = ['cube', 'cuboid', 'square_pyramid', 'triangular_pyramid', 'triangular_prism', 'pentagonal_prism', 'hexagonal_prism', 'cylinder', 'cone', 'sphere'];
const NAMES = { cube: 'cube', cuboid: 'cuboid', square_pyramid: 'square-based pyramid', triangular_pyramid: 'triangular-based pyramid', triangular_prism: 'triangular prism', pentagonal_prism: 'pentagonal prism', hexagonal_prism: 'hexagonal prism', cylinder: 'cylinder', cone: 'cone', sphere: 'sphere' };
const ROLLS = new Set(['cylinder', 'cone', 'sphere']);
const STACKS = new Set(['cube', 'cuboid', 'triangular_prism', 'pentagonal_prism', 'hexagonal_prism', 'cylinder']);
const NET_IDS = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11', 'custom'];
const NET_LABELS = ['1-4-1 (a)', '1-4-1 (b)', '1-4-1 (c)', '1-4-1 (d)', 'The cross, 1-4-1 (e)', '1-4-1 (f)', '2-3-1 (a)', '2-3-1 (b)', '2-3-1 (c)', 'Staircase, 2-2-2', '3-3', 'My own (under More settings)'];
const SQUARES = { type: 'string', title: 'Squares', description: 'Rows of X (a square) and . (a gap), split by /. Example: .X../XXXX/.X..', minLength: 1, maxLength: 60 };

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: '3D shapes and nets',
  properties: {
    title: TITLE_PARAM('3D shapes'),
    solids: {
      type: 'array', title: 'Shapes', description: 'One shape to look at closely, or up to four side by side to compare.', 'x-item': 'a shape', minItems: 1, maxItems: 4,
      default: [{ solid: 'cube', name: '' }],
      items: { type: 'object', required: ['solid'], default: { solid: 'cube', name: '' }, properties: {
        solid: { type: 'string', title: 'Shape', enum: SOLID_IDS, 'x-labels': ['Cube', 'Cuboid', 'Square-based pyramid', 'Triangular-based pyramid (tetrahedron)', 'Triangular prism', 'Pentagonal prism', 'Hexagonal prism', 'Cylinder', 'Cone', 'Sphere'], default: 'cube' },
        name: { type: 'string', title: 'Name on the slide', description: 'Leave empty for the mathematical name.', maxLength: 60, default: '' },
      } },
    },
    show: {
      type: 'object', title: 'What to show', default: { turn: true, faces: true, edges: true, vertices: true, net: false, rollStack: false },
      properties: {
        turn: { type: 'boolean', title: 'Turn the shape slowly at the start', description: 'One shape only.', default: true },
        faces: { type: 'boolean', title: 'Count the faces', default: true },
        edges: { type: 'boolean', title: 'Count the edges', default: true },
        vertices: { type: 'boolean', title: 'Count the vertices', default: true },
        net: { type: 'boolean', title: 'Unfold it into its net', description: 'One shape only. A sphere has no net.', default: false },
        rollStack: { type: 'boolean', title: 'Which roll and which stack', description: 'Two or more shapes.', default: false },
      },
    },
    netLayout: { type: 'string', title: 'Which net of a cube', description: 'A cube has 11 different nets.', enum: NET_IDS, 'x-labels': NET_LABELS, default: 'n5' },
    netSquares: Object.assign({}, SQUARES, { title: 'My own net of a cube', default: '.X../XXXX/.X..', 'x-panel': 'advanced' }),
    checkNets: {
      type: 'array', title: 'Does it fold into a cube?', description: 'Up to three arrangements of six squares. The slide works out whether each one folds.', 'x-item': 'an arrangement', maxItems: 3, default: [],
      items: { type: 'object', required: ['squares'], default: { squares: 'XXX../..XXX' }, properties: { squares: SQUARES } },
    },
    // count words and verdicts are labels; the reasons beside a failed arrangement are phrases
    text: TEXT_PARAM_FOR({ face: 'label', faces: 'label', edge: 'label', edges: 'label', vertex: 'label', vertices: 'label', rolls: 'label', stacks: 'label', folds: 'label', nofold: 'label', corner: 'phrase', sameface: 'phrase' }),
  },
};

export const presets = [
  { id: 'rec-roll-stack', name: 'Reception: shapes that roll and stack', params: {
    title: 'Which shapes roll? Which stack?',
    solids: [{ solid: 'sphere' }, { solid: 'cube' }, { solid: 'cylinder' }, { solid: 'cone' }],
    show: { turn: false, faces: false, edges: false, vertices: false, net: false, rollStack: true },
  } },
  { id: 'y2-cube', name: 'Year 2: faces, edges and vertices of a cube', params: {
    title: 'Faces, edges and vertices', solids: [{ solid: 'cube' }],
    show: { turn: true, faces: true, edges: true, vertices: true, net: false, rollStack: false },
  } },
  { id: 'y4-prisms-pyramids', name: 'Year 4: prisms and pyramids compared', params: {
    title: 'Prisms and pyramids', solids: [{ solid: 'triangular_prism' }, { solid: 'square_pyramid' }, { solid: 'hexagonal_prism' }],
    show: { turn: false, faces: true, edges: true, vertices: true, net: false, rollStack: false },
  } },
  { id: 'y6-cube-nets', name: 'Year 6: nets of a cube', params: {
    title: 'Nets of a cube', solids: [{ solid: 'cube' }], netLayout: 'n5',
    show: { turn: true, faces: false, edges: false, vertices: false, net: true, rollStack: false },
    checkNets: [{ squares: 'XXX../..XXX' }, { squares: 'XX../XXXX' }, { squares: 'X.../XXX./..XX' }],
  } },
];

/* ------------------------------------------------------------------ the data */
const an = s => /^[aeiou]/i.test(s) ? 'an' : 'a';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const listOf = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function model(P) {
  const S = (P.solids || []).map((s, i) => { const own = !!(s.name && s.name.trim()); const nm = own ? s.name.trim() : NAMES[s.solid]; return { ...s, i, f: SOLIDS[s.solid], nm, own, A: own ? nm : `${an(nm)} ${nm}` }; });
  const one = S.length === 1; const sh = P.show || {};
  const cube = one && S[0].solid === 'cube';
  const netCells = cube ? (P.netLayout === 'custom' ? (parseSquares(P.netSquares).cells || cubeLayout('n5')) : cubeLayout(P.netLayout)) : null;
  const checks = cube ? (P.checkNets || []).map((c, i) => { const q = parseSquares(c.squares); return { i, q, r: q.cells ? cubeCheck(q.cells) : { ok: false } }; }) : [];
  return { S, one, sh, cube, netCells, checks };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const M = model(P);
  M.S.forEach(s => { const f = s.f; if (f.polyhedron && f.faces + f.vertices - f.edges !== 2) R.push({ path: `solids.${s.i}.solid`, reason: `The counts for a ${s.nm} break Euler’s rule (faces + vertices − edges = 2).` }); });
  if (M.sh.net) {
    if (!M.one) W.push('Unfolding into a net shows with one shape only.');
    else if (M.S[0].solid === 'sphere') R.push({ path: 'show.net', reason: 'A sphere has no net: it is curved all over, so it cannot be opened out flat without stretching or tearing. Turn off the net, or choose a cylinder or cone.' });
  }
  if (M.cube && M.sh.net && P.netLayout === 'custom') {
    const q = parseSquares(P.netSquares);
    if (q.error) R.push({ path: 'netSquares', reason: q.error });
    else if (q.cells.length !== 6) R.push({ path: 'netSquares', reason: `A cube has 6 faces, so its net needs 6 squares. This one has ${q.cells.length}.` });
    else { const c = cubeCheck(q.cells); if (!c.ok) R.push({ path: 'netSquares', reason: c.connected ? (c.corner ? 'These six squares do not fold into a cube: four of them meet at one corner, but a cube corner has only three faces.' : 'These six squares do not fold into a cube: two of them land on the same face.') + ' Choose one of the 11 nets, or move a square.' : 'These squares are not all joined edge to edge, so they cannot fold into a cube.' }); }
  }
  if ((P.checkNets || []).length) {
    if (!M.cube) W.push('“Does it fold into a cube?” shows only when the shape is one cube.');
    else P.checkNets.forEach((c, i) => {
      const q = parseSquares(c.squares);
      if (q.error) R.push({ path: `checkNets.${i}.squares`, reason: q.error });
      else if (q.cells.length !== 6) R.push({ path: `checkNets.${i}.squares`, reason: `A cube has 6 faces, so each arrangement needs 6 squares. This one has ${q.cells.length}.` });
      else if (q.cols > 6 || q.rows > 6) R.push({ path: `checkNets.${i}.squares`, reason: 'This arrangement is too spread out to fit beside the net. Keep it within 6 squares across and 6 down.' });
    });
  }
  if (M.sh.rollStack && M.one) W.push('“Which roll and which stack” shows with two or more shapes.');
  if (!M.one && M.sh.turn) W.push('Turning shows with one shape only.');
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function facesCap(s) {
  const f = s.f; const A = cap(s.A);
  if (s.solid === 'sphere') return `${A} has 1 face, and it is curved all over.`;
  if (f.curved) return `${A} has ${f.faces} faces: ${f.flat} flat and ${f.curved} curved.`;
  return `${A} has ${f.faces} faces. Count the ones at the back too.`;
}
function plan(P) {
  const M = model(P); const { S, one, sh } = M; const items = [];
  if (one) {
    const s = S[0], f = s.f, poly = f.polyhedron;
    items.push({ key: 'solid', caption: sh.turn && poly ? `This is ${s.A}. Watch it turn: some faces are at the back.` : `This is ${s.A}, a 3D shape.` });
    if (sh.faces) items.push({ key: 'faces', caption: facesCap(s) });
    if (sh.edges) items.push({ key: 'edges', caption: f.edges ? `It has ${plural(f.edges, 'edge', 'edges')}, where two faces meet.` : 'It has no edges: there is nowhere two faces meet.' });
    if (sh.vertices) items.push({ key: 'vertices', caption: f.vertices === 0 ? 'It has no vertices: no corners and no point.' : s.solid === 'cone' ? 'It has 1 vertex: the point at the top.' : `It has ${f.vertices} vertices: the corners where edges meet.` });
    if (sh.net && poly) items.push({ key: 'unfold', caption: 'Cut along some edges and the faces swing open on the edges that are left.' });
    if (sh.net && s.solid !== 'sphere') items.push({ key: 'net', caption: poly ? `Unfold it and its ${f.faces} faces lie flat. This is a net of ${s.A}.` : s.solid === 'cylinder' ? 'Opened out, a cylinder is a rectangle and two circles. This is its net.' : 'Opened out, a cone is part of a circle and a whole circle. This is its net.' });
    M.checks.forEach(c => items.push({ key: `check:${c.i}`, caption: c.r.ok ? 'Does this fold into a cube? Yes: every square becomes a different face.' : c.r.corner ? 'No: four squares meet at one corner, but a cube corner has only three faces.' : c.r.connected ? 'Does this fold into a cube? No: the two red squares land on the same face.' : 'Does this fold into a cube? No: the squares are not all joined edge to edge.' }));
  } else {
    S.forEach(s => items.push({ key: `solid:${s.i}`, caption: `This is ${s.A}.` }));
    if (sh.faces) items.push({ key: 'faces', caption: S.some(s => s.f.curved) ? 'Count the faces on each shape. Some faces are curved.' : 'Count the faces on each shape, including the ones at the back.' });
    if (sh.edges) items.push({ key: 'edges', caption: 'Now count the edges, where two faces meet.' });
    if (sh.vertices) items.push({ key: 'vertices', caption: 'Now count the vertices: corners and points.' });
    if (sh.rollStack) {
      const r = S.filter(s => ROLLS.has(s.solid)).map(s => s.nm), st = S.filter(s => STACKS.has(s.solid)).map(s => s.nm);
      const rc = r.length ? `The ${listOf([...new Set(r)])} can roll: ${r.length === 1 ? 'it has' : 'each has'} a curved face.` : 'None of these can roll: they have no curved faces.';
      const sc = st.length ? `The ${listOf([...new Set(st)])} can stack: flat on the bottom and flat on top.` : 'None of these stack: each has a point or a curve on top.';
      items.push({ key: 'roll', caption: rc.length <= 110 ? rc : 'Shapes with a curved face can roll.' });
      items.push({ key: 'stack', caption: sc.length <= 110 ? sc : 'Shapes that are flat on the bottom and on top can stack.' });
    }
  }
  let summary;
  if (one) {
    const s = S[0], f = s.f; const parts = [];
    if (sh.faces) parts.push(plural(f.faces, 'face', 'faces')); if (sh.edges) parts.push(plural(f.edges, 'edge', 'edges')); if (sh.vertices) parts.push(plural(f.vertices, 'vertex', 'vertices'));
    if (M.checks.length) { const k = M.checks.filter(c => c.r.ok).length; summary = `Only some arrangements of six squares fold into a cube: ${k} of these ${M.checks.length} do.`; }
    else if (parts.length) summary = `${cap(`${s.A}`)} has ${listOf(parts)}.`;
    else if (sh.net && s.solid !== 'sphere') summary = `A net of ${s.A}: fold it up and it closes into the shape.`;
    else summary = `${cap(`${s.A}`)} is a 3D shape.`;
  } else if (sh.rollStack) summary = 'Curved faces roll. Flat tops and bottoms stack. Some shapes do both.';
  else if (sh.faces || sh.edges || sh.vertices) summary = 'Same idea, different shapes: count faces, edges and vertices to tell them apart.';
  else summary = `${S.length} 3D shapes, side by side.`;
  return { M, items, summary };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, items } = plan(P);
  const steps = items.map(it => {
    const s = M.S[0];
    if (it.key === 'solid') return s.solid === 'triangular_pyramid' ? 'A triangular-based pyramid is also called a tetrahedron: all four faces are triangles.' : s.f.polyhedron ? 'Ask: what do you think is at the back? How could we find out without turning it?' : 'Ask: is any of this shape flat? Where is it curved?';
    if (it.key === 'faces') return M.one ? 'Hidden faces are numbered in an outline. Some schemes count only flat faces and call the rest a curved surface: use your school’s words.' : 'Point to each face as the class counts. A curved face counts as one face here.';
    if (it.key === 'edges') return `An edge is where two faces meet. Hidden edges are dashed.${M.S.some(x => x.solid === 'cylinder' || x.solid === 'cone') ? ` A ${M.S.some(x => x.solid === 'cylinder') ? 'cylinder' : 'cone'}’s edges are curved.` : ''}`;
    if (it.key === 'unfold') return 'Each face stays joined to the next along one edge, like a hinge. Ask: which edges were cut?';
    if (it.key === 'vertices') return `A vertex is a corner where edges meet; more than one are vertices.${M.S.some(x => x.solid === 'cone') ? ' Some schemes call a cone’s point an apex rather than a vertex.' : ''}${M.one && s.f.polyhedron ? ` Check: faces + vertices − edges = ${s.f.faces} + ${s.f.vertices} − ${s.f.edges} = 2 (Euler’s rule).` : ''}`;
    if (it.key === 'net') return s.f.polyhedron ? 'A net is the flat shape that folds up into the solid, with every face once and no overlaps. Ask: which face will be the lid?' : s.solid === 'cylinder' ? 'The rectangle is as long as the circle’s circumference, so it wraps exactly once round the ends.' : 'The curved part is a sector: its arc is as long as the base circle’s circumference.';
    if (it.key.startsWith('check:')) { const c = M.checks[+it.key.slice(6)]; return c.r.ok ? 'Fold it in your head: pick a square to be the base, then fold up the sides.' : c.r.corner ? 'Four squares meet round the marked corner. A cube corner has only three faces, so two squares overlap and one face is left open.' : c.r.connected ? 'The two squares in red would fold onto the same face, so one face of the cube is left open.' : 'Every square must share a whole edge with another to fold.'; }
    if (it.key.startsWith('solid:')) { const x = M.S[+it.key.slice(6)]; return `Ask: where have you seen ${x.A} outside school?`; }
    if (it.key === 'roll') return 'A cylinder rolls on its curved face; a cone rolls round in a circle; a sphere rolls any way.';
    if (it.key === 'stack') return 'To stack, a shape needs a flat face to sit on and a flat face on top. A cylinder rolls and stacks.';
    return '';
  });
  return { steps, summary: M.one ? 'Ask the class to describe the shape to a partner using faces, edges and vertices.' : 'Ask: which shape is the odd one out, and why?' };
}

/* ------------------------------------------------------------------ drawing */
const YAW = 34, PITCH = 24, CP = Math.cos(PITCH * Math.PI / 180), EP = Math.sin(PITCH * Math.PI / 180);
const FILL = 'var(--compare-pale)';
const toneOf = pct => pct >= 100 ? FILL : `color-mix(in oklab, ${FILL} ${pct}%, var(--shade))`;
const ptsA = pts => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const bboxOf = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const x0 = Math.min(...xs), y0 = Math.min(...ys); return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0, cx: (x0 + Math.max(...xs)) / 2, cy: (y0 + Math.max(...ys)) / 2 }; };

/** A polyhedron that can turn and unfold. box: where the solid sits; netBox: where its flat net sits.
 *  bottom: align the solid's lowest point to this y instead of centring (for rows of shapes). */
function polySolid(p, solid, { box, netBox, layout, upright, cap: kCap = 150 }) {
  const G = geoFor(solid, { layout, upright }); const g = h('g', {}, p);
  const els = G.def.faces.map(() => h('polygon', { fill: FILL, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' }, g));
  const fitK = (V, bx) => { const bb = bboxOf(V.flat()); return Math.min(bx.w / bb.w, bx.h / bb.h, kCap); };
  // one scale for every turn angle, so the shape does not breathe as it turns
  const k1 = Math.min(...[YAW - 50, YAW - 25, YAW].map(y => fitK(view(foldAt(G, 1), 1, y, PITCH), box)));
  const k0 = netBox ? fitK(view(foldAt(G, 0), 0, 0, PITCH), netBox) : k1;
  const c1 = [box.x + box.w / 2, box.bottom != null ? null : box.y + box.h / 2], c0 = netBox ? [netBox.x + netBox.w / 2, netBox.y + netBox.h / 2] : c1;
  let last = null;
  function frame(u, yaw) {
    const V = view(foldAt(G, u), u, yaw, PITCH); const k = lerp(k0, k1, u);
    const bb = bboxOf(V.flat());
    const cy1 = box.bottom != null ? box.bottom - bb.h * k1 / 2 : c1[1];
    const cx = lerp(c0[0], c1[0], u), cy = lerp(c0[1], cy1, u);
    const proj = V.map(f => f.map(([x, y]) => [cx + (x - bb.cx) * k, cy + (y - bb.cy) * k]));
    const order = V.map((f, i) => [i, f.reduce((s, q) => s + q[2], 0) / f.length]).sort((a, b) => b[1] - a[1]);
    for (const [i] of order) { els[i].setAttribute('points', ptsA(proj[i])); els[i].style.setProperty('fill', toneOf(u < .02 ? 100 : shadeStep(V[i]))); g.appendChild(els[i]); }
    last = { V, proj, k }; return last;
  }
  const F1 = frame(1, YAW); const topo = topology(F1.V);
  const P2 = v => { const all = F1.proj.flat(), V3 = F1.V.flat(); const i = V3.findIndex(q => Math.hypot(q[0] - v[0], q[1] - v[1], q[2] - v[2]) < 1e-4); return all[i]; };
  const verts = topo.verts.map((v, i) => ({ p: P2(v), hidden: topo.vHidden[i] }));
  const faces = topo.centres.map((c, i) => ({ p: P2(c) || (() => { const f = F1.proj[i]; return [f.reduce((s, q) => s + q[0], 0) / f.length, f.reduce((s, q) => s + q[1], 0) / f.length]; })(), hidden: topo.hidden[i] }));
  const edges = topo.edges.map(e => ({ d: `M${verts[e.a].p[0].toFixed(1)} ${verts[e.a].p[1].toFixed(1)} L${verts[e.b].p[0].toFixed(1)} ${verts[e.b].p[1].toFixed(1)}`, hidden: e.hidden }));
  const bb = bboxOf(F1.proj.flat());
  const sv = stackVec(G, YAW, PITCH);
  return { g, frame, faces, edges, verts, bb, k: F1.k, stackDy: sv[1] * F1.k, counts: { F: topo.faces.length, E: topo.edges.length, V: topo.verts.length } };
}

/** Cylinder, cone or sphere seen from a little above: flat tones, hidden half-edges dashed. */
function curvedSolid(p, solid, { box, cap: kCap = 150 }) {
  const g = h('g', {}, p); const H = solid === 'cone' ? 1.8 : 1.7;
  const wU = 2, hU = solid === 'sphere' ? 2 : H * CP + (solid === 'cone' ? EP : 2 * EP);
  // radius 0.6 of a cube's edge, so curved and flat shapes in one row look like a matched set
  const kU = Math.min(box.w / (wU * .6), box.h / (hU * .6), kCap); const k = kU * .6; const rx = k, ry = EP * k;
  const cx = box.x + box.w / 2; const yb = box.bottom != null ? box.bottom - (solid === 'sphere' ? k : ry) : box.y + box.h / 2 + hU * k / 2 - (solid === 'sphere' ? k : ry);
  const at = { stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' };
  const faces = [], edges = [], verts = []; let top = yb;
  const backArc = (y) => `M${cx - rx} ${y} A${rx} ${ry} 0 0 1 ${cx + rx} ${y}`, frontArc = (y) => `M${cx - rx} ${y} A${rx} ${ry} 0 0 0 ${cx + rx} ${y}`;
  if (solid === 'sphere') {
    const cy = yb; h('circle', Object.assign({ cx, cy, r: k, fill: toneOf(86) }, at), g); top = cy - k;
    faces.push({ p: [cx, cy], hidden: false });
  } else if (solid === 'cylinder') {
    const yt = yb - H * CP * k; top = yt - ry;
    h('path', Object.assign({ d: `M${cx - rx} ${yt} L${cx - rx} ${yb} A${rx} ${ry} 0 0 0 ${cx + rx} ${yb} L${cx + rx} ${yt} Z`, fill: toneOf(86) }, at), g);
    h('ellipse', Object.assign({ cx, cy: yt, rx, ry, fill: FILL }, at), g);
    faces.push({ p: [cx, yt], hidden: false }, { p: [cx, (yt + yb) / 2 + ry * .6], hidden: false }, { p: [cx, yb], hidden: true });
    edges.push({ d: `${frontArc(yt)} A${rx} ${ry} 0 0 0 ${cx - rx} ${yt}`, hidden: false }, { d: frontArc(yb), hidden: false, back: backArc(yb) });
  } else {
    const ya = yb - H * CP * k; top = ya;
    h('path', Object.assign({ d: `M${cx} ${ya} L${cx - rx} ${yb} A${rx} ${ry} 0 0 0 ${cx + rx} ${yb} Z`, fill: toneOf(86) }, at), g);
    faces.push({ p: [cx, yb - (yb - ya) * .38], hidden: false }, { p: [cx, yb], hidden: true });
    edges.push({ d: frontArc(yb), hidden: false, back: backArc(yb) });
    verts.push({ p: [cx, ya], hidden: false });
  }
  const hiddenD = solid === 'sphere' ? null : backArc(yb);
  return { g, faces, edges, verts, hiddenD, bb: { x: cx - rx, y: top, w: 2 * rx, h: yb + (solid === 'sphere' ? k : ry) - top, cx }, stackDy: -H * CP * k, k: kU, frame() {} };
}

function drawSolid(p, solid, o) { return SOLIDS[solid].polyhedron ? polySolid(p, solid, o) : curvedSolid(p, solid, o); }

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { M, items } = plan(P); return M.one ? renderOne(root, P, ctx, M, items) : renderRow(root, P, ctx, M);
}
const WORDS = { faces: ['face', 'faces'], edges: ['edge', 'edges'], vertices: ['vertex', 'vertices'] };
const COUNT = { faces: 'faces', edges: 'edges', vertices: 'vertices' };

function renderOne(root, P, ctx, M) {
  const b = ctx.b, N = ctx.N, s = M.S[0], sh = M.sh; const poly = s.f.polyhedron;
  const has = k => b[k] != null; const kNet = has('net') ? b.net : null; const kOpen = has('unfold') ? b.unfold : kNet;
  // with arrangements to check, the net keeps one place and size and the right column holds the verdicts
  const RX = M.checks.length ? 712 : 872, RW = GRID.right - RX;
  const area = { x: GRID.left, y: 136, w: RX - GRID.left - 40, h: 640 - 136 };
  // with no counts beside it, the solid stands in the middle of the slide (and so does the net, unless verdicts need the right)
  const counting = ['faces', 'edges', 'vertices'].some(has), mid = (GRID.left + GRID.right) / 2;
  const box = { x: (counting ? area.x + area.w / 2 : mid) - (area.w - 120) / 2, y: area.y + 40, w: area.w - 120, h: area.h - 80 };
  const netBox = { x: (counting || M.checks.length ? area.x + area.w / 2 : mid) - (area.w - 20) / 2, y: area.y + 8, w: area.w - 20, h: area.h - 16 };
  const firstCount = ['faces', 'edges', 'vertices'].map(k => b[k]).filter(v => v != null);
  const kCount0 = firstCount.length ? Math.min(...firstCount) : null;

  // ground shadow, then the solid
  const shadowG = h('g', { s: 0, hide: kOpen }, root);
  const S = drawSolid(root, s.solid, { box, netBox: kNet != null && poly ? netBox : null, layout: M.netCells, cap: 320 });
  h('ellipse', { cx: S.bb.cx, cy: S.bb.y + S.bb.h - 2, rx: S.bb.w * .52, ry: 16, fill: 'var(--ground-shadow)' }, shadowG);
  S.g.dataset.s = 0; if (!poly && kNet != null) S.g.dataset.h = kNet;
  if (poly && S.counts && (S.counts.F !== s.f.faces || S.counts.E !== s.f.edges || S.counts.V !== s.f.vertices)) ctx.warn(`Geometry of the ${s.solid} does not match its counts.`);
  // hidden edges dashed once counting starts (they help count what is at the back)
  if (kCount0 != null) {
    const hg = h('g', { s: kCount0, hide: kOpen }, root);
    for (const e of S.edges) if (e.hidden) h('path', { d: e.d, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '8 8', 'stroke-linecap': 'round' }, hg);
    if (S.hiddenD) h('path', { d: S.hiddenD, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '8 8' }, hg);
  }

  // counting overlays, one build each, gone by the next build
  const durOf = n => clamp(400 * Math.max(1, n), 1200, 3600);
  const stepMs = (key, n) => n ? durOf(n) * .8 / n : 0;
  const ov = (key, list, draw) => { if (!has(key)) return; const g = h('g', { s: b[key], hide: b[key] + 1 }, root); const ord = [...list.filter(x => !x.hidden), ...list.filter(x => x.hidden)]; ord.forEach((x, i) => draw(g, x, i, stepMs(key, list.length))); };
  ov('faces', S.faces, (g, f, i, st) => {
    const gg = h('g', { s: b.faces, cls: 'pop', delay: i * st }, g);
    h('circle', { cx: f.p[0], cy: f.p[1], r: 27, fill: f.hidden ? 'var(--paper)' : 'var(--focus)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': f.hidden ? '7 5' : null }, gg);
    computed(T(gg, f.p[0], f.p[1] + 10, String(i + 1), 'ts-label', { cls: 'strong', 'text-anchor': 'middle', fill: f.hidden ? 'var(--focus-text)' : 'var(--on-hue)' }), 'solids.0.solid');
  });
  ov('edges', S.edges, (g, e, i, st) => {
    if (e.hidden) h('path', { d: e.d, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '10 8', 'stroke-linecap': 'round', s: b.edges, delay: i * st }, g);
    else h('path', { d: e.d, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-data)', 'stroke-linecap': 'round', cls: 'draw', pathLength: 1, s: b.edges, delay: i * st }, g);
    if (e.back) h('path', { d: e.back, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '10 8', s: b.edges, delay: i * st }, g);
  });
  ov('vertices', S.verts, (g, v, i, st) => h('circle', { cx: v.p[0], cy: v.p[1], r: 12, fill: v.hidden ? 'var(--paper)' : 'var(--focus)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', s: b.vertices, cls: 'pop', delay: i * st }, g));

  // curved nets appear in place of the solid
  if (!poly && kNet != null) {
    const ng = h('g', { s: kNet, cls: 'rise' }, root);
    if (s.solid === 'cylinder') { const r = Math.min(netBox.w / (2 * Math.PI), netBox.h / (1.7 + 4)) * .92; curvedNet(ng, 'cylinder', { cx: netBox.x + netBox.w / 2, cy: netBox.y + netBox.h / 2, r, h: 1.7 * r, fill: FILL }); }
    else { const sl = Math.hypot(1, 1.8); const r = Math.min(netBox.w / (2 * sl), netBox.h / (sl + 2)) * .92; curvedNet(ng, 'cone', { cx: netBox.x + netBox.w / 2, cy: netBox.y + netBox.h / 2 - r, r, h: 1.8 * r, fill: FILL }); }
  }

  // right column: the name, then the counts, then the arrangements to check
  let y = 176;
  if (kNet == null) { const nameB = textBlock(h('g', { s: 0 }, root), RX, y, s.nm, { cls: 'ts-label', maxW: RW, maxLines: 3, lh: 34, edit: 'solids.0.name', a: { cls: 'strong', fill: 'var(--ink)' } }); y += nameB.h + 30; }
  else y = 150;
  const counters = [];
  const numW = Math.max(0, ...['faces', 'edges', 'vertices'].filter(has).map(k => measure(root, String(s.f[k]), 'ts-big')));
  for (const key of ['faces', 'edges', 'vertices']) {
    if (!has(key)) continue; const n = s.f[key === 'faces' ? 'faces' : key];
    const g = h('g', { s: b[key], cls: 'rise', c: ctx.rc(key, null, 'soft') }, root);
    const numEl = computed(T(g, RX, y + 40, String(n), 'ts-big', { fill: 'var(--focus-text)' }), 'solids.0.solid');
    const nw = numW; numEl.setAttribute('x', RX + nw); numEl.setAttribute('text-anchor', 'end');
    const wordId = n === 1 ? WORDS[key][0] : WORDS[key][1];
    const word = textBlock(g, RX + nw + 14, y + 38, txt(P, `label:${wordId}`, wordId), { cls: 'ts-label', maxW: RW - nw - 14, maxLines: 3, lh: 30, edit: `text.label:${wordId}`, a: { fill: 'var(--ink)' } });
    counters.push({ k: b[key], n, el: numEl }); y += 66 + (word.lines.length - 1) * word.lh;
  }
  if (M.checks.length) {
    y += counters.length ? 18 : 0;
    const gap = 24, avail = 636 - y - gap * (M.checks.length - 1);
    const rowsTot = M.checks.reduce((t, c) => t + Math.max(c.q.rows, 2), 0);
    const cell = Math.min(56, Math.floor(avail / rowsTot), Math.floor((RW * .56) / Math.max(...M.checks.map(c => c.q.cols))));
    if (cell < 30) ctx.warn(`The arrangements to check are too big for the column (cell ${cell}).`);
    M.checks.forEach(c => {
      const key = `check:${c.i}`; const g = h('g', { s: b[key], cls: 'rise', c: ctx.rc(key, null, 'soft') }, root);
      const clash = new Set(c.r.clash || []);
      c.q.cells.forEach(([cx, cy], j) => h('rect', { x: RX + cx * cell, y: y + cy * cell, width: cell, height: cell, fill: clash.has(j) ? 'var(--heat)' : FILL, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', cls: 'body' }, g));
      if (c.r.corner) h('circle', { cx: RX + c.r.corner[0] * cell, cy: y + c.r.corner[1] * cell, r: 9, fill: 'var(--ink)', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)' }, g);
      const gw = c.q.cols * cell, tx = RX + gw + 20, hgt = Math.max(c.q.rows, 2) * cell;
      const verdict = c.r.ok ? txt(P, 'label:folds', 'Folds into a cube') : txt(P, 'label:nofold', 'Does not fold');
      const tg = h('g', {}, g);
      const tb = textBlock(tg, tx, 0, verdict, { cls: 'ts-label', maxW: GRID.right - tx, maxLines: 2, lh: 32, a: { cls: 'strong', fill: c.r.ok ? 'var(--focus-text)' : 'var(--heat-text)' } });
      computed(tb.el, `checkNets.${c.i}.squares`);
      let th = tb.h, why = null;
      if (!c.r.ok && c.r.connected) {
        const wid = c.r.corner ? 'corner' : 'sameface';
        why = textBlock(tg, tx, tb.h + 4, txt(P, `label:${wid}`, c.r.corner ? '4 squares meet at the dot' : 'Red squares: same face'), { cls: 'ts-cap', maxW: GRID.right - tx, maxLines: 4, lh: 30, edit: `text.label:${wid}`, a: { fill: 'var(--ink)' } });
        th += 4 + why.h;
      }
      tg.setAttribute('transform', `translate(0 ${(y + Math.max(0, hgt / 2 - th / 2) + 22).toFixed(1)})`);
      y += Math.max(hgt, th) + gap;
    });
    if (y - gap > 642) ctx.warn('The arrangements to check run past the bottom of the slide.');
  }

  const turnK = has('solid') && sh.turn && poly ? b.solid : null;
  const dur = {}; if (turnK != null) dur.solid = 1800; if (kNet != null) dur.net = 2000; if (has('unfold')) dur.unfold = 2000;
  const OPEN = .55; // how far open the faces are at the end of the unfold build
  for (const key of ['faces', 'edges', 'vertices']) if (has(key)) dur[key] = durOf(key === 'faces' ? S.faces.length : key === 'edges' ? S.edges.length : S.verts.length);
  const pose = (k, u) => {
    if (!poly) return;
    if (has('unfold') && k === b.unfold) S.frame(1 - (1 - OPEN) * eIO(u), YAW);
    else if (kNet != null && k >= kNet) S.frame(k === kNet ? (has('unfold') ? OPEN : 1) * (1 - eIO(u)) : 0, YAW);
    else if (k === turnK) S.frame(1, YAW - 50 * (1 - eIO(u)));
    else S.frame(1, YAW);
  };
  return {
    dur,
    reset() { if (poly) S.frame(1, turnK != null ? YAW - 50 : YAW); counters.forEach(c => c.el.textContent = '0'); },
    still() { if (poly) S.frame(kNet != null ? 0 : 1, YAW); counters.forEach(c => c.el.textContent = String(c.n)); },
    tick(k, u) {
      pose(k, u);
      for (const c of counters) c.el.textContent = String(k > c.k ? c.n : k === c.k ? Math.min(c.n, u >= 1 ? c.n : Math.floor(u / .8 * c.n) + (u > 0 ? 1 : 0)) : 0);
    },
  };
}

function renderRow(root, P, ctx, M) {
  const b = ctx.b, sh = M.sh; const n = M.S.length;
  const pans = panels(n, 140, 640, n === 4 ? 40 : 64);
  const counts = ['faces', 'edges', 'vertices'].filter(k => b[k] != null);
  const rollStack = b.roll != null;
  // the words under each shape (name, counts, rolls/stacks) are drawn once into a probe to measure
  // how tall they run, so long names and long labels wrap and the shapes shrink to make room
  const NAME0 = rollStack ? 74 : 44, ROW = 36;
  const words = (p, s, pn, y0, rcOn) => {
    let y = y0;
    const nb = textBlock(h('g', rcOn ? { s: b[`solid:${s.i}`], cls: 'rise' } : {}, p), pn.cx, y, s.nm, { cls: 'ts-label', maxW: pn.w - 8, maxLines: 4, lh: 32, anchor: 'middle', edit: `solids.${s.i}.name`, a: { cls: 'strong', fill: 'var(--ink)' } });
    y += nb.h + 6; let last = y0 + nb.h - nb.lh;
    for (const key of counts) {
      const v = s.f[key]; const wid = v === 1 ? WORDS[key][0] : WORDS[key][1]; const word = txt(P, `label:${wid}`, wid);
      const g2 = h('g', rcOn ? { s: b[key], cls: 'rise', c: ctx.rc(key, null, 'soft') } : {}, p); const g3 = h('g', {}, g2);
      const nwid = measure(g2, String(v), 'ts-label', { cls: 'strong' });
      computed(T(g3, 0, y, String(v), 'ts-label', { cls: 'strong', fill: 'var(--focus-text)' }), `solids.${s.i}.solid`);
      const tb = textBlock(g3, nwid + 10, y, word, { cls: 'ts-cap', maxW: pn.w - nwid - 20, maxLines: 3, lh: 28, edit: `text.label:${wid}` });
      g3.setAttribute('transform', `translate(${(pn.cx - (nwid + 10 + tb.w) / 2).toFixed(1)} 0)`);
      last = y + (tb.lines.length - 1) * tb.lh; y = last + ROW;
    }
    if (rollStack) {
      // rolls and stacks share one line, so a shape that does both keeps clear of the caption
      const ws = [['roll', ROLLS, 'rolls', 'var(--focus-text)'], ['stack', STACKS, 'stacks', 'var(--compare-text)']].filter(w => w[1].has(s.solid)).map(w => [...w, txt(P, `label:${w[2]}`, w[2])]);
      // two words side by side when both fit on one line; otherwise one under the other, full width
      const GAP = 28, wmax = (pn.w - 8 - GAP * (ws.length - 1)) / Math.max(1, ws.length);
      const side = ws.every(w => measure(p, w[4], 'ts-label', { cls: 'strong' }) <= wmax);
      const tbs = ws.map(([key, , id, col, word], i) => {
        const g4 = h('g', rcOn ? { s: b[key], cls: 'rise' } : {}, p); const g5 = h('g', {}, g4);
        const tb = textBlock(g5, 0, side ? y : 0, word, { cls: 'ts-label', maxW: side ? wmax : pn.w - 8, maxLines: 3, lh: 30, anchor: side ? 'start' : 'middle', edit: `text.label:${id}`, a: { cls: 'strong', fill: col } });
        if (!side) { if (i) y = last + ROW; g5.setAttribute('transform', `translate(${pn.cx.toFixed(1)} ${y.toFixed(1)})`); last = y + (tb.lines.length - 1) * tb.lh; }
        return [g5, tb];
      });
      if (side) {
        let x = pn.cx - (tbs.reduce((t, [, tb]) => t + tb.w, 0) + GAP * (tbs.length - 1)) / 2;
        tbs.forEach(([g5, tb]) => { g5.setAttribute('transform', `translate(${x.toFixed(1)} 0)`); x += tb.w + GAP; });
        last = y;
      }
    }
    return last - y0;
  };
  const probeW = h('g', {}, root);
  const runs = M.S.map((s, i) => words(probeW, s, pans[i], 0, false));
  probeW.remove();
  const below = NAME0 + Math.max(0, ...runs);
  const groundY = 618 - below;
  const solidTop = 136;
  const placed = M.S.map((s, i) => {
    const pn = pans[i]; const stacks = rollStack && STACKS.has(s.solid);
    const hAvail = groundY - solidTop - 16;
    return { s, pn, stacks, hAvail };
  });
  // one scale for the whole row, so a cube and a sphere look like a matched set
  const probe = h('g', {}, root);
  let kCap = 260;
  for (const q of placed) { const t = drawSolid(probe, q.s.solid, { box: { x: q.pn.x, y: solidTop, w: q.pn.w - 24, h: q.stacks ? q.hAvail / 2 : q.hAvail }, upright: true, cap: 260 }); kCap = Math.min(kCap, t.k); }
  probe.remove();
  placed.forEach(q => {
    const { s, pn } = q; const kb = b[`solid:${s.i}`];
    const g = h('g', { s: kb, cls: 'rise', c: ctx.rc(`solid:${s.i}`, (b.faces ?? b.roll ?? ctx.N), 'soft') }, root);
    const shadow = h('ellipse', { rx: 1, ry: 14, fill: 'var(--ground-shadow)' }, g);
    const S = drawSolid(g, s.solid, { box: { x: pn.x + 12, y: solidTop, w: pn.w - 24, h: groundY - solidTop, bottom: groundY }, upright: true, cap: kCap });
    shadow.setAttribute('cx', S.bb.cx); shadow.setAttribute('cy', groundY - 2); shadow.setAttribute('rx', S.bb.w * .5);
    if (q.stacks) {
      const gh = h('g', { s: b.stack, cls: 'rise' }, root);
      const copy = S.g.cloneNode(true); copy.removeAttribute('data-s'); copy.setAttribute('transform', `translate(0 ${S.stackDy.toFixed(1)})`); gh.appendChild(copy);
      if (S.bb.y + S.stackDy < 128) ctx.warn(`No room to stack the ${s.nm}.`);
    }
    if (rollStack && ROLLS.has(s.solid)) {
      const x0 = S.bb.cx - S.bb.w * .42, x1 = S.bb.cx + S.bb.w * .42, yy = groundY + 22;
      arrow(ctx, root, `M${x0} ${yy} Q ${S.bb.cx} ${yy + 22} ${x1} ${yy}`, x1, yy, Math.atan2(-22, x1 - S.bb.cx), 'var(--focus)', 'var(--sw-struct)', { draw: b.roll, k: .7, g: { c: ctx.rc('roll', null, 'soft') } });
    }
    // words under the shape
    const run = words(root, s, pn, groundY + NAME0, true);
    if (groundY + NAME0 + run > 630) ctx.warn(`The words under the ${s.nm} run past the bottom.`);
  });
  return {};
}

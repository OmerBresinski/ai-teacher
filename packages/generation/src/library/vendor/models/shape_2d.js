// 2D shapes and their properties: up to four shapes in a row, standard or turned, with a
// properties table underneath. Builds: the shapes -> count the sides as each lights up ->
// vertices -> right angles -> parallel sides -> lines of symmetry (a ghost folds over) ->
// (optional) the families each quadrilateral belongs to. Every count is computed from the
// geometry; a name that does not fit the shape is refused. One model for Reception to Year 6.
import {
  h, T, clamp, eIO, GRID, textBlock, measure, RM,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { shapePts, shapeProps, polygon, rightAngleMark, mirrorLine } from '../kit/batch-C.js';

export const meta = {
  id: 'shape_2d', name: '2D shapes and their properties', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Reception', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'A 2D shape is named by its properties (sides, vertices, right angles, parallel sides and lines of symmetry), and turning it does not change them.',
};

const KINDS = ['circle', 'oval', 'triangle', 'right_triangle', 'isosceles', 'scalene', 'square', 'rectangle', 'parallelogram', 'rhombus',
  'trapezium', 'kite', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'irregular_pentagon', 'irregular_hexagon', 'l_shape', 'arrow_head'];
const KIND_LABELS = ['Circle', 'Oval', 'Equilateral triangle', 'Right-angled triangle', 'Isosceles triangle', 'Scalene triangle', 'Square', 'Rectangle',
  'Parallelogram', 'Rhombus', 'Trapezium', 'Kite', 'Regular pentagon', 'Regular hexagon', 'Regular heptagon', 'Regular octagon',
  'Irregular pentagon', 'Irregular hexagon', 'L-shape (an irregular hexagon)', 'Arrowhead (a concave quadrilateral)'];
const DEFAULT_NAME = {
  circle: 'circle', oval: 'oval', triangle: 'equilateral triangle', right_triangle: 'right-angled triangle', isosceles: 'isosceles triangle',
  scalene: 'scalene triangle', square: 'square', rectangle: 'rectangle', parallelogram: 'parallelogram', rhombus: 'rhombus', trapezium: 'trapezium',
  kite: 'kite', pentagon: 'regular pentagon', hexagon: 'regular hexagon', heptagon: 'regular heptagon', octagon: 'regular octagon',
  irregular_pentagon: 'irregular pentagon', irregular_hexagon: 'irregular hexagon', l_shape: 'L-shape', arrow_head: 'arrowhead',
};
const POLY_NAME = { 3: 'triangle', 4: 'quadrilateral', 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon' };
const ROWS = ['sides', 'vertices', 'right', 'parallel', 'symmetry'];
const TURNS = [25, -20, 35, -15];

const SHAPE_ITEM = {
  type: 'object', title: 'Shape',
  properties: {
    shape: { type: 'string', title: 'Shape', enum: KINDS, 'x-labels': KIND_LABELS, default: 'square' },
    name: { type: 'string', title: 'Name on the slide', description: 'Leave empty to use the usual name. A usual name such as “square” follows the shape when you change it; any other name that does not fit the shape is refused.', maxLength: 36 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */, default: '' },
    turn: { type: 'integer', title: 'Extra turn (degrees)', description: 'Turns this shape on top of the orientation setting. Turning never changes its properties.', minimum: -180, maximum: 180, default: 0 },
  },
  default: { shape: 'square', name: '', turn: 0 },
};

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: '2D shapes',
  properties: {
    title: TITLE_PARAM('Properties of 2D shapes'),
    shapes: { type: 'array', title: 'Shapes', description: 'One to four shapes, side by side.', items: SHAPE_ITEM, minItems: 1, maxItems: 4, 'x-item': 'shape',
      default: [{ shape: 'square', name: '', turn: 0 }, { shape: 'triangle', name: '', turn: 0 }] },
    orientation: { type: 'string', title: 'Orientation', description: 'Turned shapes stop pupils thinking a square on its corner is a different shape.', enum: ['standard', 'rotated', 'mixed'],
      'x-labels': ['Standard (flat on the bottom)', 'All turned', 'Mixed (every other shape turned)'], default: 'standard' },
    properties: { type: 'object', title: 'Properties to count', properties: {
      sides: { type: 'boolean', title: 'Sides', default: true },
      vertices: { type: 'boolean', title: 'Vertices (corners)', default: true },
      right: { type: 'boolean', title: 'Right angles', default: false },
      parallel: { type: 'boolean', title: 'Pairs of parallel sides', default: false },
      symmetry: { type: 'boolean', title: 'Lines of symmetry', default: false },
    }, default: { sides: true, vertices: true, right: false, parallel: false, symmetry: false } },
    vertexWord: { type: 'string', title: 'Call the corners', enum: ['vertices', 'corners'], 'x-labels': ['vertices', 'corners'], default: 'vertices' },
    compare: { type: 'boolean', title: 'Compare two shapes', description: 'Needs exactly two shapes. The summary shows what is the same and what is different.', default: false },
    families: { type: 'boolean', title: 'Show quadrilateral families', description: 'Adds a build that shows, for example, that a square is also a rectangle.', default: false },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'reception-shapes', name: 'Reception: circle, triangle, square, rectangle', params: {
    title: 'Name the shapes', orientation: 'standard', vertexWord: 'corners',
    shapes: [{ shape: 'circle', name: 'circle' }, { shape: 'triangle', name: 'triangle' }, { shape: 'square', name: 'square' }, { shape: 'rectangle', name: 'rectangle' }],
    properties: { sides: true, vertices: true, right: false, parallel: false, symmetry: false } } },
  { id: 'y2-compare', name: 'Year 2: compare a square and a rectangle', params: {
    title: 'What is the same? What is different?', orientation: 'standard', vertexWord: 'vertices', compare: true,
    shapes: [{ shape: 'square', name: 'square' }, { shape: 'rectangle', name: 'rectangle' }],
    properties: { sides: true, vertices: true, right: false, parallel: false, symmetry: true } } },
  { id: 'y3-right-angles', name: 'Year 3: right angles in shapes', params: {
    title: 'Which shapes have right angles?', orientation: 'mixed', vertexWord: 'vertices',
    shapes: [{ shape: 'right_triangle', name: 'right-angled triangle' }, { shape: 'square', name: 'square' }, { shape: 'trapezium', name: 'trapezium' }, { shape: 'l_shape', name: 'L-shape' }],
    properties: { sides: true, vertices: false, right: true, parallel: false, symmetry: false } } },
  { id: 'y6-quadrilaterals', name: 'Year 6: the quadrilateral family', params: {
    title: 'The quadrilateral family', orientation: 'standard', vertexWord: 'vertices', families: true,
    shapes: [{ shape: 'square', name: 'square' }, { shape: 'rectangle', name: 'rectangle' }, { shape: 'rhombus', name: 'rhombus' }, { shape: 'parallelogram', name: 'parallelogram' }],
    properties: { sides: false, vertices: false, right: true, parallel: true, symmetry: true } } },
];

/* ------------------------------------------------------------------ geometry, in code */
const isCurved = k => k === 'circle' || k === 'oval';
const turnOf = (P, i) => {
  const base = P.orientation === 'rotated' || (P.orientation === 'mixed' && i % 2 === 1) ? TURNS[i % TURNS.length] : 0;
  return base + (P.shapes[i].turn || 0);
};
/** Facts about one shape, computed from its vertices (rotation never changes them). */
function factsOf(kind) {
  if (isCurved(kind)) return { curved: true, kind, sides: 0, vertices: 0, right: 0, parallel: 0, symmetry: kind === 'circle' ? Infinity : 2, regular: false, convex: true, n: 0 };
  const pr = shapeProps(shapePts(kind));
  return { curved: false, kind, props: pr, n: pr.sides, sides: pr.sides, vertices: pr.vertices, right: pr.rightAngles.length, parallel: pr.parallelPairs.length,
    parSets: parallelSets(pr.parallelPairs).map(c => c.size), symmetry: pr.symmetry.length, regular: pr.regular, convex: pr.convex, lengths: pr.lengths };
}
/** Sides that all run the same way, as sets: an L-shape has two sets of three, not six “pairs”. */
function parallelSets(pairs) {
  const cls = [];
  for (const [p1, p2] of pairs) { let c = cls.find(x => x.has(p1) || x.has(p2)); if (!c) { c = new Set(); cls.push(c); } c.add(p1); c.add(p2); }
  return cls;
}
/** The parallel cell: a count of pairs when every set is a pair, else the sets themselves (“2 sets of 3”). */
function parallelWord(F) {
  const S = F.parSets || [];
  if (S.every(z => z === 2)) return String(S.length);
  const by = {}; S.forEach(z => { by[z] = (by[z] || 0) + 1; });
  return Object.keys(by).sort((a, b) => b - a).map(z => +z === 2 ? `${by[z]} pair${by[z] > 1 ? 's' : ''}` : `${by[z]} set${by[z] > 1 ? 's' : ''} of ${z}`).join(' + ');
}
/* A stock shape name (one the panel or a preset filled in, such as “square”) belongs to the shape it was chosen for:
 * when the teacher picks a different shape, the name moves with it instead of blocking the change. */
const STOCK = new Set([...Object.values(DEFAULT_NAME), ...Object.values(POLY_NAME), 'oblong', 'ellipse', 'l shape', 'arrow head', 'shape']);
const rawName = (P, i) => (P.shapes[i].name || '').trim();
const staleName = (P, i) => { const r = rawName(P, i); return !!r && STOCK.has(r.toLowerCase()) && !!nameProblem(r, factsOf(P.shapes[i].shape)); };
const nameOf = (P, i) => (staleName(P, i) ? '' : rawName(P, i)) || DEFAULT_NAME[P.shapes[i].shape];
/** Families a convex quadrilateral also belongs to (inclusive definitions), never its own name. */
function familiesOf(F) {
  if (F.curved || F.n !== 4 || !F.convex) return [];
  const pg = F.parallel === 2, rect = pg && F.right === 4, rh = equalAll(F.lengths);
  return [['rectangle', rect], ['rhombus', rh], ['parallelogram', pg]].filter(([nm, ok]) => ok && nm !== F.kind).map(([nm]) => nm);
}
const eq = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, a, b);
const equalAll = L => L.every(l => eq(l, L[0]));

/** A name that does not fit the shape is false maths: return the reason, or null.
 *  Only the first shape word counts as the claim (so “an L-shape made of two rectangles” is fine),
 *  with the describing words (regular, equilateral, right-angled...) that come before it. */
function nameProblem(name, F) {
  const s = ` ${String(name).toLowerCase()} `;
  const L = F.lengths || [], n = F.n, poly = !F.curved;
  const fail = why => `“${name.trim()}” doesn’t fit this shape: ${why} Change the name, or choose a different shape.`;
  const sides = (k, w) => [poly && n === k, F.curved ? 'it is curved and has no straight sides.' : `it has ${n} sides, and ${art(w)} ${w} has ${k}.`];
  const quad = (ok, why) => [poly && n === 4 && ok, n !== 4 ? (F.curved ? 'it is curved and has no straight sides.' : `it has ${n} sides, and a quadrilateral has 4.`) : why];
  const NOUNS = [
    [/\bcircle\b/, () => [F.kind === 'circle', 'a circle is perfectly round, the same distance from the centre all the way round.']],
    [/\b(oval|ellipse)\b/, () => [F.kind === 'oval', F.kind === 'circle' ? 'this is a circle, not an oval.' : 'an oval is a curved shape with no straight sides.']],
    [/\btriangle\b/, () => sides(3, 'triangle')], [/\bquadrilateral\b/, () => sides(4, 'quadrilateral')],
    [/\bpentagon\b/, () => sides(5, 'pentagon')], [/\bhexagon\b/, () => sides(6, 'hexagon')],
    [/\bheptagon\b/, () => sides(7, 'heptagon')], [/\boctagon\b/, () => sides(8, 'octagon')],
    [/\bsquare\b/, () => quad(F.right === 4 && equalAll(L), 'a square has 4 equal sides and 4 right angles.')],
    [/\boblong\b/, () => quad(F.right === 4 && !equalAll(L), 'an oblong has 4 right angles and two pairs of sides of different lengths.')],
    [/\brectangle\b/, () => quad(F.right === 4, 'a rectangle has 4 right angles.')],
    [/\brhombus\b/, () => quad(equalAll(L), 'a rhombus has 4 equal sides.')],
    [/\bparallelogram\b/, () => quad(F.parallel === 2, 'a parallelogram has two pairs of parallel sides.')],
    [/\btrapezium\b/, () => quad(F.parallel >= 1, 'a trapezium has at least one pair of parallel sides.')],
    [/\bkite\b/, () => quad((eq(L[0], L[1]) && eq(L[2], L[3])) || (eq(L[1], L[2]) && eq(L[3], L[0])), 'a kite has two pairs of equal sides next to each other.')],
  ];
  let at = -1, noun = null;
  for (const [re, f] of NOUNS) { const i = s.search(re); if (i >= 0 && (at < 0 || i < at)) { at = i; noun = f; } }
  const before = re => { const i = s.search(re); return i >= 0 && (at < 0 || i < at); };
  const irr = before(/\birregular\b/);
  const MODS = [
    [irr, poly && !F.regular, 'all its sides and all its angles are equal, so it is regular, not irregular.'],
    [!irr && before(/\bregular\b/), poly && F.regular, F.curved ? 'it is curved, so it is not a regular polygon.' : 'its sides or angles are not all equal, so it is irregular.'],
    [before(/\bequilateral\b/), poly && n === 3 && equalAll(L), 'an equilateral triangle has 3 equal sides.'],
    [before(/\bisosceles\b/), poly && n === 3 && (eq(L[0], L[1]) || eq(L[1], L[2]) || eq(L[0], L[2])), 'an isosceles triangle has 2 equal sides.'],
    [before(/\bscalene\b/), poly && n === 3 && !eq(L[0], L[1]) && !eq(L[1], L[2]) && !eq(L[0], L[2]), 'a scalene triangle has no equal sides.'],
    [before(/\bright[- ]angled\b/), F.right > 0, 'it has no right angles.'],
  ];
  for (const [used, ok, why] of MODS) if (used && !ok) return fail(why);
  /* a count before the shape word is a claim too: “five-sided shape”, “4 right angles”, “6-gon” */
  const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
  const CLAIMS = [
    [new RegExp(`\\b${NUM}[- ]sided\\b`, 'g'), 'sides'], [new RegExp(`\\b${NUM}-gon\\b`, 'g'), 'sides'],
    [new RegExp(`\\b${NUM}[- ](?:straight )?sides?\\b`, 'g'), 'sides'],
    [new RegExp(`\\b${NUM}[- ](?:corners?|vertices|vertex)\\b`, 'g'), 'vertices'],
    [new RegExp(`\\b${NUM}[- ]right[- ]angles?\\b`, 'g'), 'right'],
  ];
  const CW = { sides: 'sides', vertices: 'vertices', right: 'right angles' };
  for (const [re, prop] of CLAIMS) for (const m of s.matchAll(re)) {
    if (at >= 0 && m.index >= at) continue;
    const c = /^\d+$/.test(m[1]) ? +m[1] : NUMW[m[1]];
    if (F.curved && prop === 'sides' && c > 0) return fail('it is curved and has no straight sides.');
    if (c !== F[prop]) return fail(`it has ${F[prop]} ${CW[prop]}, not ${c}.`);
  }
  if (noun) { const [ok, why] = noun(); if (!ok) return fail(why); }
  return null;
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  if (R.length) return result(R);
  const W = [];
  if (P.compare && P.shapes.length !== 2) W.push(`Comparing needs exactly two shapes, and there ${P.shapes.length === 1 ? 'is 1' : `are ${P.shapes.length}`}, so the summary does not compare. Remove or add shapes to compare two.`);
  P.shapes.forEach((s, i) => {
    if (staleName(P, i)) { W.push(`Shape ${i + 1} is now ${art(DEFAULT_NAME[s.shape])} ${DEFAULT_NAME[s.shape]}, so the slide calls it that instead of “${rawName(P, i)}”.`); return; }
    const why = nameProblem(nameOf(P, i), factsOf(s.shape));
    if (why) R.push({ path: `shapes.${i}.name`, reason: why });
  });
  if (P.families && !P.shapes.some(s => familiesOf(factsOf(s.shape)).length)) W.push('None of these shapes belongs to another quadrilateral family, so the families build is left out.');
  return result(R, W);
}

/* ------------------------------------------------------------------ builds and notes */
function rowsOf(P) { return ROWS.filter(r => P.properties[r]); }
const ROW_WORD = (P, r) => ({ sides: 'sides', vertices: P.vertexWord, right: 'right angles', parallel: 'pairs of parallel sides', symmetry: 'lines of symmetry' })[r];
const listWords = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const art = w => /^([aeiou]|[fhlmnrsx](?=[-\s]|$))/i.test(w) ? 'an' : 'a';
function cellText(P, r, F) {
  if (r === 'sides' && F.curved) return txt(P, 'label:curved', '1 curved');
  if (r === 'symmetry' && F.symmetry === Infinity) return txt(P, 'label:infinite', 'infinite');
  if (r === 'parallel' && !F.curved) return parallelWord(F);
  return String(F[r]);
}

function plan(P) {
  const Fs = P.shapes.map(s => factsOf(s.shape)), names = P.shapes.map((_, i) => nameOf(P, i));
  const rows = rowsOf(P), items = [], one = Fs.length === 1, vw = P.vertexWord;
  const add = (key, caption, note) => items.push({ key, caption, note });
  const turned = P.shapes.some((_, i) => turnOf(P, i) % 360 !== 0);
  const cap0 = one ? `Here is ${art(names[0])} ${names[0]}.` : `Here are ${Fs.length} shapes: ${listWords(names.map(n => `${art(n)} ${n}`))}.`;
  add('shapes', cap0.length <= 84 ? cap0 : `Here are ${Fs.length} shapes. Look carefully at each one.`,
    `Ask: what do you notice? Which shapes do you already know?${turned ? ' Some are turned: a shape keeps its name and its properties whichever way round it sits.' : ''}`);
  const solo = (r, word) => one ? ` The ${names[0]} has ${cellText(P, r, Fs[0])} ${word}.` : '';
  for (const r of rows) {
    if (r === 'sides') add('sides', `Count the sides. Each side lights up as we count it.${solo('sides', 'sides')}`.slice(0, 160),
      `Touch each side once as you count, starting from one corner, so none is missed or counted twice.${Fs.some(F => F.curved) ? ' Curved shapes: many schools say a circle has 1 curved side and no corners; others say it has no sides. Use your school’s wording (click “1 curved” in the table to change it).' : ''}`);
    if (r === 'vertices') add('vertices', vw === 'corners' ? 'Count the corners, where two straight sides meet.' : 'A vertex is a corner, where two sides meet. Count the vertices.',
      `${vw === 'corners' ? 'Corners' : 'Vertices (one vertex, two vertices)'}: a straight-sided shape has as many as it has sides. Ask: is that always true? Check each shape.`);
    if (r === 'right') add('right', 'A right angle is a square corner, like the corner of a page.',
      'Make a right-angle checker by folding a scrap of paper twice, and test each corner. Turned shapes still have the same right angles.');
    if (r === 'parallel') add('parallel', 'Parallel sides go the same way and never meet, like railway lines.',
      `Arrows with the same number of heads mark sides that are parallel to each other. Parallel sides stay the same distance apart, like railway lines.${Fs.some(F => (F.parSets || []).some(z => z > 2)) ? ' Where three or more sides run the same way (an L-shape has three going across and three going up), the table counts sets of parallel sides rather than pairs.' : ''}`);
    if (r === 'symmetry') add('symmetry', 'A line of symmetry folds a shape exactly onto itself.',
      `Fold a paper copy to check. A diagonal is not always a line of symmetry: try folding a rectangle corner to corner.${Fs.some(F => F.kind === 'circle') ? ' A circle folds onto itself along any line through its centre, so it has infinitely many.' : ''}${Fs.some(F => F.kind === 'parallelogram') ? ' A parallelogram has no lines of symmetry, though it looks the same after a half turn.' : ''}`);
  }
  const fams = Fs.map(familiesOf);
  if (P.families && fams.some(f => f.length)) {
    const sq = Fs.findIndex(F => F.kind === 'square');
    add('family', sq >= 0 && fams[sq].includes('rectangle') ? 'A square has 4 right angles, so it is also a rectangle.'
      : 'Each shape also belongs to every family whose rules it meets.',
      'A square is a special rectangle (4 right angles) and a special rhombus (4 equal sides). Rectangles and rhombuses are special parallelograms. With the inclusive definitions, a square and a rhombus are also kites, and every parallelogram is also a trapezium.');
  }
  let summary, summaryNote;
  /* the summary's one takeaway: the rows that differ (compare), else the row that tells the most shapes apart */
  const distinct = r => new Set(Fs.map(F => cellText(P, r, F))).size;
  let take = [];
  if (P.compare && Fs.length === 2) take = rows.filter(r => distinct(r) > 1);
  else if (rows.length && Fs.length > 1) { const best = Math.max(...rows.map(distinct)); if (best > 1) take = [rows.filter(r => distinct(r) === best).pop()]; }
  if (P.compare && Fs.length === 2 && rows.length) {
    const same = rows.filter(r => cellText(P, r, Fs[0]) === cellText(P, r, Fs[1])), diff = rows.filter(r => !same.includes(r));
    const w = r => ROW_WORD(P, r);
    summary = !diff.length ? `The ${names[0]} and the ${names[1]} have the same number of ${listWords(rows.map(w))}.`
      : !same.length ? `The ${names[0]} and the ${names[1]} differ in every property shown.`
        : `Same: ${listWords(same.map(w))}. Different: ${listWords(diff.map(w))}.`;
    summaryNote = `Ask: so what makes them different shapes? (Name the property that differs, then check it on the shapes.)`;
  } else {
    summary = turned ? 'Turning a shape never changes its properties.'
      : take.length ? `Look at the ${ROW_WORD(P, take[0])} row: it tells these shapes apart best.` : 'We name and sort shapes by counting their properties.';
    summaryNote = 'Ask: can you draw a different shape with the same properties? Sort the shapes by one property.';
  }
  return { Fs, names, rows, items, fams, take, summary: summary.length <= 120 ? summary : 'The table shows what is the same and what is different.', summaryNote };
}
export function builds(P) { P = withDefaults(params, P); const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }
export function notes(P) { P = withDefaults(params, P); const pl = plan(P); return { steps: pl.items.map(i => i.note), summary: pl.summaryNote }; }

/* ------------------------------------------------------------------ render */
const RAD = Math.PI / 180;
const SHAPE_FILL = 'color-mix(in oklab, var(--neutral) 16%, var(--paper))';

/** textBlock, then the token minimum when one word is wider than the box (wrap alone cannot fix that). */
function fitText(g, x, y, s, o) {
  let tb = textBlock(g, x, y, s, o);
  if (tb.w > o.maxW + .5 && tb.cls !== 'ts-tiny') { tb.el.remove(); tb = textBlock(g, x, y, s, Object.assign({}, o, { cls: 'ts-tiny' })); }
  return tb;
}

/* Fit, in order: the usual layout; a wider row-label column with tight rows and no centring squeeze; every wording at the
 * token minimum; then free wording held to two lines (cut with “…”), so the shapes and their counts always have room. */
export function render(root, P, ctx0) {
  P = withDefaults(params, P);
  let res, W;
  for (let lvl = 0; lvl <= 3; lvl++) {
    W = []; const g = h('g', {}, root);
    res = layout(g, P, Object.assign({}, ctx0, { warn: m => W.push(m) }), lvl);
    if (res.ok || lvl === 3) break;
    g.remove();
  }
  W.forEach(m => ctx0.warn(m));
  return res.hooks;
}

function layout(root, P, ctx, lvl) {
  const pl = plan(P), b = ctx.b, N = ctx.N, n = P.shapes.length, rows = pl.rows;
  const big = lvl >= 2 ? 'ts-tiny' : 'ts-label', ml = lvl >= 3 ? 2 : 4, miss = { n: 0 };
  const hooks = { dur: {} }, ticks = [], finals = [], resets = [];
  const k = key => b[key];
  const after = key => (b[key] == null ? null : b[key] + 1);
  const recede = (key, last = 'soft') => [ctx.rc(key), `${N}:${last}`].filter(Boolean).join(',') || null;

  /* table rows: labels measured first, so the shapes take whatever height is left */
  const tableG = h('g', {}, root), take = new Set(pl.take);
  const lowN = r => (take.size && !take.has(r) ? `${N}:quiet` : null); // the summary keeps one takeaway row
  /* columns: as wide as the longest word in any name, cell or family line needs, and centred on the stage when the label column allows */
  const live = GRID.right - GRID.left, vals = rows.map(r => pl.Fs.map(F => cellText(P, r, F)));
  const wordsW = (s, cls) => String(s).split(/\s+/).filter(Boolean).map(w => measure(root, w, cls));
  const famStr = i => `also ${listWords(pl.fams[i].map(f => `${art(f)} ${f}`))}`;
  const word = Math.max(0, ...pl.names.flatMap(s => wordsW(s, big)), ...vals.flatMap(vs => vs.flatMap(v => wordsW(v, big))),
    ...(b.family != null ? pl.fams.flatMap((f, i) => (f.length ? wordsW(famStr(i), 'ts-cap') : [])) : []));
  /* the row-label column: 230 wide, or (when height is short) as wide as the shape columns can spare, so long wording takes fewer lines */
  const labMax = lvl ? clamp(live - n * Math.max(word + 24, 200) - 32, 230, 440) : 230;
  let labW = 0; const rowBlocks = [];
  rows.forEach((r, ri) => {
    const g = h('g', { s: k(r), cls: 'rise', c: lowN(r) }, tableG);
    const tb = fitText(g, GRID.left, 0, txt(P, `label:row:${r}`, ROW_WORD(P, r)), { cls: big, maxW: labMax, maxLines: ml, lh: 30, edit: `text.label:row:${r}` });
    labW = Math.max(labW, tb.w); rowBlocks.push({ r, g, tb, vals: vals[ri] });
  });
  const gapL = rows.length ? 32 : 0, lab = rows.length ? labW + gapL : 0;
  const colW = Math.min(320, (live - lab) / n, Math.max(word + 24, lvl ? 200 : 0, (live - 2 * lab) / n));
  const x0 = clamp(GRID.W / 2 - n * colW / 2, GRID.left + lab, GRID.right - n * colW), x1 = x0 + n * colW, lx0 = x0 - lab;
  const cxOf = i => x0 + colW * (i + .5);

  /* cells: counts are computed; “1 curved” and “infinite” are a school's wording, so they wrap like any edit */
  rowBlocks.forEach(rb => {
    const { r, vals } = rb, differ = P.compare && n === 2 && vals[0] !== vals[1], hot = take.has(r) && !differ;
    rb.cells = vals.map((v, i) => {
      const F = pl.Fs[i], g = h('g', {}, tableG);
      const free = r === 'sides' && F.curved ? 'text.label:curved' : r === 'symmetry' && F.symmetry === Infinity ? 'text.label:infinite' : undefined;
      const draw = at => {
        const tb = fitText(g, cxOf(i), 0, v, { cls: free ? big : 'ts-label', maxW: colW - 12, maxLines: free ? ml : 4, lh: 30, anchor: 'middle', edit: free, a: at });
        if (!free) computed(tb.el, `shapes.${i}.shape`);
        if (tb.w > colW - 12) ctx.warn(`table value “${v}” is wider than its column`);
        return tb;
      };
      const at = { s: k(r), cls: 'pop', delay: DELAY[r] ? DELAY[r](pl.Fs) : 300, c: lowN(r), 'font-weight': 'var(--w-strong)', fill: differ ? 'var(--focus-text)' : 'var(--ink)' };
      const tb = draw(Object.assign(at, hot ? { hide: N } : {}));
      if (hot) draw({ s: N, 'font-weight': 'var(--w-strong)', fill: 'var(--focus-text)' });
      return { g, tb };
    });
    rb.need = Math.max(rb.tb.h, ...rb.cells.map(c => c.tb.h));
  });
  /* row heights: roomy when the shapes can afford it, tight when many rows (or long row wording) would shrink them */
  const roomFor = (min, pad, o) => GRID.bottom - rowBlocks.reduce((t, rb) => t + Math.max(min, rb.need + pad), 0) - 12 - 80 - 22 - o * 2 - GRID.top - 6;
  const roomy = !lvl && roomFor(52, 14, 36) >= 170, [rMin, rPad] = roomy ? [52, 14] : [42, 12];
  const out = b.sides == null ? 0 : roomy ? 36 : 28; // room for the counts that sit outside a top or bottom side
  rowBlocks.forEach(rb => { rb.h = Math.max(rMin, rb.need + rPad); });
  const tableH = rowBlocks.reduce((t, rb) => t + rb.h, 0), tableTop = GRID.bottom - tableH;

  /* header under each shape: its name, an "irregular" tag when needed, and (build) its families */
  const heads = [], soft = `${N}:soft`;
  for (let i = 0; i < n; i++) {
    const g = h('g', {}, root), F = pl.Fs[i], cx = cxOf(i); let y = 0;
    const nb = fitText(g, cx, y + 30, pl.names[i], { cls: big, maxW: colW - 16, maxLines: ml, lh: 34, anchor: 'middle', edit: `shapes.${i}.name`, a: { s: k('shapes'), cls: 'rise', c: soft } });
    y += nb.h + 4;
    if (!F.curved && F.n >= 5 && !F.regular && !/\birregular\b/i.test(pl.names[i])) {
      const tg = fitText(g, cx, y + 26, txt(P, 'label:irregular', `irregular ${POLY_NAME[F.n] || 'polygon'}`), { cls: 'ts-cap', maxW: colW - 12, maxLines: 2, lh: 28, anchor: 'middle', a: { s: k('shapes'), cls: 'rise', delay: 200, c: soft } });
      computed(tg.el, `shapes.${i}.shape`); y += tg.h + 4;
    }
    if (b.family != null && pl.fams[i].length) {
      const fb = fitText(g, cx, y + 28, famStr(i), { cls: 'ts-cap', maxW: colW - 12, maxLines: 4, lh: 28, anchor: 'middle', a: { s: k('family'), cls: 'rise', fill: 'var(--focus-text)', delay: 300, c: soft } });
      computed(fb.el, 'families'); y += fb.h + 4;
    }
    heads.push({ g, h: y });
  }
  const headH = Math.max(...heads.map(x => x.h));
  const headTop = (rows.length ? tableTop - 12 : GRID.bottom) - headH;
  heads.forEach(x => x.g.setAttribute('transform', `translate(0 ${headTop.toFixed(1)})`));

  /* the table itself: every block is centred on its row */
  const mid = (tb, rh) => (rh / 2 + (tb.lines.length > 1 ? 7 : 10) - (tb.lines.length - 1) * tb.lh / 2).toFixed(1);
  let y = tableTop;
  rowBlocks.forEach(({ r, g, tb, h: rh, cells }) => {
    g.setAttribute('transform', `translate(${(lx0 - GRID.left).toFixed(1)} ${(y + +mid(tb, rh)).toFixed(1)})`);
    h('line', { x1: lx0, x2: x1, y1: y, y2: y, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', s: k(r) }, tableG);
    cells.forEach(c => c.g.setAttribute('transform', `translate(0 ${(y + +mid(c.tb, rh) + 1).toFixed(1)})`));
    y += rh;
  });
  if (rows.length) h('line', { x1: lx0, x2: x1, y1: y, y2: y, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', s: k(rows[0]) }, tableG);

  /* the shapes: as large as the free height and the column allow (counts sit inside, so no outer margin) */
  const top = GRID.top + 6 + out, bot = headTop - 22 - out;
  const fit = Math.min(colW - 44, bot - top, 300), size = Math.max(fit, 48);
  if (fit < 110 && lvl === 3) ctx.warn('the shapes are too small to read: show fewer shapes or fewer properties');
  const cy = (top + bot) / 2;
  const shapeG = h('g', {}, root), markG = h('g', {}, root), numG = h('g', {}, root);
  for (let i = 0; i < n; i++) {
    const F = pl.Fs[i], kind = P.shapes[i].shape, rot = turnOf(P, i);
    const shp = polygon(shapeG, kind, { cx: cxOf(i), cy, size, rotate: rot, fill: SHAPE_FILL, stroke: 'var(--ink)', a: { s: k('shapes'), cls: 'pop', delay: i * 180 } });
    shp.el.style.setProperty('stroke-width', 'calc(var(--sw-struct) * 1.6)');
    drawMarks(markG, numG, shp, F, kind, rot, i, { P, ctx, k, after, recede, hooks, ticks, finals, resets, size, miss, cx: cxOf(i), cy });
  }
  return { ok: fit >= 110 && !miss.n, hooks: {
    dur: hooks.dur,
    reset() { resets.forEach(f => f()); },
    still() { finals.forEach(f => f()); },
    tick(kk, uu) { ticks.forEach(f => f(kk, uu)); },
  } };
}

/* when the counts appear: after the last side or vertex has lit up */
const stepFor = m => Math.min(380, 2400 / Math.max(1, m));
const maxN = Fs => Math.max(1, ...Fs.map(F => F.n || 1));
const DELAY = {
  sides: Fs => Math.round(maxN(Fs) * stepFor(maxN(Fs)) + 500),
  vertices: Fs => Math.round(maxN(Fs) * stepFor(maxN(Fs)) + 400),
  symmetry: () => 1500,
};

function drawMarks(markG, numG, shp, F, kind, rot, i, o) {
  const { P, ctx, k, after, recede, hooks, ticks, finals, resets, size, cx, cy } = o;
  const pts = shp.pts, m = F.n;
  const area = pts ? pts.reduce((t, p, j) => { const q = pts[(j + 1) % pts.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) : 0;
  const outSign = area > 0 ? 1 : -1; // screen y down: positive area = clockwise on screen

  /* sides: each lights up in turn, with its count beside it */
  if (k('sides') != null) {
    const kS = k('sides'), st = stepFor(maxN(o.P.shapes.map(s => factsOf(s.shape))));
    hooks.dur.sides = Math.round(maxN(o.P.shapes.map(s => factsOf(s.shape))) * st + 1100);
    if (F.curved) {
      const tr = shp.el.cloneNode(false); tr.removeAttribute('class'); tr.style.setProperty('fill', 'none'); tr.style.setProperty('stroke', 'var(--focus)'); tr.style.setProperty('stroke-width', 'var(--sw-data)');
      tr.setAttribute('pathLength', 1); tr.setAttribute('class', 'draw'); tr.dataset.s = kS; if (after('sides') <= ctx.N) tr.dataset.h = after('sides');
      markG.appendChild(tr);
    } else {
    /* each count takes the first free spot near its side: clear of every side and of the counts already placed
     * (at a concave notch the two short sides' counts would otherwise meet) */
    const segD = (x, y, A, B) => { const dx = B[0] - A[0], dy = B[1] - A[1], t = clamp(((x - A[0]) * dx + (y - A[1]) * dy) / (dx * dx + dy * dy || 1)); return Math.hypot(x - A[0] - t * dx, y - A[1] - t * dy); };
    const edgeD = (x, y) => Math.min(...pts.map((p, q) => segD(x, y, p, pts[(q + 1) % m])));
    const placed = [];
    pts.forEach((a, j) => {
      const bb = pts[(j + 1) % m];
      h('line', { x1: a[0], y1: a[1], x2: bb[0], y2: bb[1], stroke: 'var(--focus)', 'stroke-width': 'var(--sw-data)', 'stroke-linecap': 'round', pathLength: 1, s: kS, hide: after('sides'), cls: 'draw', delay: Math.round(j * st) }, markG);
      const L = Math.hypot(bb[0] - a[0], bb[1] - a[1]), nx = outSign * (bb[1] - a[1]) / L, ny = -outSign * (bb[0] - a[0]) / L;
      // top and bottom sides (and every side of a concave shape): the count sits outside; left and right sides inside,
      // so a count never sits beside a neighbour's
      const outside = !F.convex || Math.abs(ny) >= .5 || L < size * .3, off = outside ? 26 : -clamp(size * .13, 24, 34);
      const mx = (a[0] + bb[0]) / 2, my = (a[1] + bb[1]) / 2, tx = (bb[0] - a[0]) / L, ty = (bb[1] - a[1]) / L;
      let spot = null;
      for (const o2 of outside ? [off, off + 14, -26, -34, off + 28, off + 42] : [off, 26, 40]) {
        for (const sh of [0, .2, -.2, .32, -.32, .42, -.42]) {
          const x = mx + nx * o2 + tx * sh * L, y = my + ny * o2 + ty * sh * L;
          if (edgeD(x, y) >= 17 && placed.every(([px, py]) => Math.abs(px - x) >= 26 || Math.abs(py - y) >= 32)) { spot = [x, y]; break; }
        }
        if (spot) break;
      }
      if (!spot) { spot = [mx + nx * off, my + ny * off]; o.miss.n++; ctx.warn(`side count ${j + 1} of shape ${i + 1} has no clear spot`); }
      placed.push(spot);
      const [lx, ly] = spot;
      computed(T(numG, lx, ly + 11, String(j + 1), 'ts-label', { 'text-anchor': 'middle', s: kS, hide: after('sides'), cls: 'pop', delay: Math.round(j * st + 200), fill: 'var(--focus-text)', 'font-weight': 'var(--w-strong)' }), `shapes.${i}.shape`);
    });
    }
  }
  /* vertices: a dot at each corner, in turn */
  if (k('vertices') != null && !F.curved) {
    const kV = k('vertices'), st = stepFor(maxN(o.P.shapes.map(s => factsOf(s.shape))));
    hooks.dur.vertices = Math.round(maxN(o.P.shapes.map(s => factsOf(s.shape))) * st + 1000);
    pts.forEach(([x, y], j) => h('circle', { cx: x, cy: y, r: 9, fill: 'var(--focus)', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)', s: kV, hide: after('vertices'), cls: 'pop', delay: Math.round(j * st) }, markG));
  }
  if (F.curved && k('symmetry') == null) return;
  /* right angles: the square corner mark, inside the shape */
  if (k('right') != null && !F.curved) {
    const a = { s: k('right'), cls: 'pop', hide: after('right') };
    for (const j of F.props.rightAngles) {
      const v = pts[j], nx = pts[(j + 1) % m], pv = pts[(j + m - 1) % m];
      const angTo = q => Math.atan2(-(q[1] - v[1]), q[0] - v[0]) / RAD;
      const a0 = angTo(nx), a1 = angTo(pv); let d = ((a1 - a0) % 360 + 540) % 360 - 180;
      const sz = clamp(Math.min(Math.hypot(nx[0] - v[0], nx[1] - v[1]), Math.hypot(pv[0] - v[0], pv[1] - v[1])) * .22, 18, 34);
      const u = [Math.cos(a0 * RAD), -Math.sin(a0 * RAD)], tn = (a0 + (d > 0 ? 90 : -90)) * RAD, w = [Math.cos(tn), -Math.sin(tn)];
      h('path', Object.assign({ d: `M${v[0]} ${v[1]} L${v[0] + u[0] * sz} ${v[1] + u[1] * sz} L${v[0] + (u[0] + w[0]) * sz} ${v[1] + (u[1] + w[1]) * sz} L${v[0] + w[0] * sz} ${v[1] + w[1] * sz} Z`, fill: 'var(--focus)', stroke: 'none', opacity: .35, delay: 200 }, a), markG);
      rightAngleMark(markG, v, a0, { size: sz, col: 'var(--focus)', turn: d > 0 ? 90 : -90, a: Object.assign({ delay: 200 }, a) });
    }
  }
  /* parallel sides: sides parallel to each other share a number of arrowheads */
  if (k('parallel') != null && !F.curved && F.props.parallelPairs.length) {
    const cls = parallelSets(F.props.parallelPairs); // sets of sides parallel to each other
    const g = h('g', { s: k('parallel'), cls: 'pop', delay: 200, hide: after('parallel') }, markG);
    cls.forEach((set, ci) => {
      const first = [...set][0], A = pts[first], B = pts[(first + 1) % m], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, vx = -uy, vy = ux, heads = ci + 1, gap = 14, arm = 13;
      const col = ci % 2 ? 'var(--compare)' : 'var(--focus)';
      for (const sd of set) {
        const a = pts[sd], c = pts[(sd + 1) % m], mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2;
        h('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], stroke: col, 'stroke-width': 'var(--sw-data)', 'stroke-linecap': 'round' }, g);
        let d = '';
        for (let j = 0; j < heads; j++) {
          const off = (j - (heads - 1) / 2) * gap + 5, tx = mx + ux * off, ty = my + uy * off;
          d += `M${(tx - ux * arm + vx * arm * .8).toFixed(1)} ${(ty - uy * arm + vy * arm * .8).toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)} L${(tx - ux * arm - vx * arm * .8).toFixed(1)} ${(ty - uy * arm - vy * arm * .8).toFixed(1)} `;
        }
        h('path', { d, fill: 'none', stroke: col, 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      }
    });
  }
  /* lines of symmetry, then a ghost folds over the first one */
  if (k('symmetry') != null) {
    const kY = k('symmetry'), g = h('g', { s: kY, hide: after('symmetry') }, markG);
    let lines;
    if (F.kind === 'circle') lines = [0, 45, 90, 135].map(a => ({ p: [cx, cy], a: a * RAD, r: size / 2 }));
    else if (F.kind === 'oval') lines = [-rot, 90 - rot].map(a => ({ p: [cx, cy], a: a * RAD, r: size / 2 }));
    else lines = F.props.symmetry.length ? shapeProps(pts).symmetry.map(s => { const a = s.a * RAD, c = Math.cos(a), sn = Math.sin(a); return { p: s.p, a, r: Math.max(...pts.map(q => Math.abs((q[0] - s.p[0]) * c + (q[1] - s.p[1]) * sn))) }; }) : [];
    lines.forEach((L, j) => {
      const dx = Math.cos(L.a) * L.r, dy = Math.sin(L.a) * L.r;
      mirrorLine(h('g', { cls: 'rise', s: kY, delay: 200 + j * 160 }, g), L.p[0] - dx, L.p[1] - dy, L.p[0] + dx, L.p[1] + dy, { col: 'var(--focus)', extend: 6 });
    });
    hooks.dur.symmetry = 1800;
    if (lines.length && !RM.matches) {
      const L = lines[0], nx = -Math.sin(L.a), ny = Math.cos(L.a), [px, py] = L.p;
      const ghost = shp.el.cloneNode(false); ghost.removeAttribute('class');
      ghost.style.setProperty('fill', 'var(--focus-pale)'); ghost.style.setProperty('stroke', 'var(--focus)'); ghost.style.setProperty('opacity', '.7');
      ghost.style.setProperty('display', 'none'); markG.appendChild(ghost);
      const base = ghost.getAttribute('transform') || '';
      const set = u => {
        if (u == null) { ghost.style.setProperty('display', 'none'); return; }
        const s = Math.cos(Math.PI * eIO(u)), q = 1 - s;
        const A = 1 - q * nx * nx, B = -q * nx * ny, D = 1 - q * ny * ny;
        ghost.style.setProperty('display', '');
        ghost.setAttribute('transform', `matrix(${A} ${B} ${B} ${D} ${px - A * px - B * py} ${py - B * px - D * py}) ${base}`);
      };
      ticks.push((kk, uu) => set(kk === kY && uu > .02 && uu < .98 ? clamp((uu - .1) / .8) : null));
      finals.push(() => set(null)); resets.push(() => set(null));
    }
  }
}

// Area, perimeter and volume: a shape drawn to scale on a squared grid (or a cuboid of unit cubes).
// Builds: the shape -> (missing sides worked out) -> perimeter: walk the edge and count / area:
// fill with squares row by row, split and add, or cut and rearrange / volume: one layer, then
// stack the layers -> the formula. One model for Y3 counting to Y6 formulae.
import {
  h, T, clamp, lerp, eIO, GRID, textBlock, measure, overlaps, labelGround,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { fmtNum } from '../kit/batch-B.js';

export const meta = {
  id: 'area_perimeter', name: 'Area, perimeter and volume', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Perimeter is the distance around a shape, area is the squares inside it and volume is the cubes that fill it, found by counting and then by formula.',
};

const SHAPES = ['rectangle', 'compound', 'triangle', 'parallelogram', 'cuboid'];
const UNITS = ['cm', 'm', 'mm'];
const UNIT_WORD = { cm: 'centimetre', m: 'metre', mm: 'millimetre' };

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Area, perimeter and volume',
  properties: {
    title: TITLE_PARAM('What is the perimeter?'),
    shape: { type: 'string', title: 'Shape', enum: SHAPES, 'x-labels': ['Rectangle', 'L-shape (compound rectilinear)', 'Triangle', 'Parallelogram', 'Cuboid'], default: 'rectangle' },
    measure: { type: 'string', title: 'What to find', enum: ['perimeter', 'area', 'volume'], 'x-labels': ['Perimeter (distance around)', 'Area (space inside)', 'Volume (cubes that fill it)'], default: 'perimeter' },
    method: { type: 'string', title: 'Method', description: 'Count squares (or cubes), use a formula, or split an L-shape into rectangles and add.', enum: ['count', 'formula', 'split'], 'x-labels': ['Count', 'Use a formula', 'Split and add'], default: 'count' },
    unit: { type: 'string', title: 'Unit', enum: UNITS, 'x-labels': ['centimetres (cm)', 'metres (m)', 'millimetres (mm)'], default: 'cm' },
    length: { type: 'integer', title: 'Length (or base)', description: 'Along the bottom, in whole units.', minimum: 1, maximum: 20, default: 5 },
    width: { type: 'integer', title: 'Width (or perpendicular height)', description: 'Up the slide for a flat shape; going back for a cuboid.', minimum: 1, maximum: 20, default: 3 },
    height: { type: 'integer', title: 'Cuboid height', description: 'Only used by the cuboid.', minimum: 1, maximum: 12, default: 2 },
    cutLength: { type: 'integer', title: 'L-shape: corner cut away, across', description: 'The top-right corner removed from the rectangle to make the L.', minimum: 1, maximum: 19, default: 2 },
    cutWidth: { type: 'integer', title: 'L-shape: corner cut away, down', minimum: 1, maximum: 19, default: 2 },
    offset: { type: 'integer', title: 'Triangle or parallelogram: top shifted along by', description: 'Triangle: how far along the base the top corner sits (0 = a right angle on the left). Parallelogram: how far the top edge is shifted.', minimum: 0, maximum: 20, default: 2 },
    labelSides: { type: 'boolean', title: 'Label the side lengths', description: 'Off: pupils count the squares instead.', default: true },
    missingSides: { type: 'boolean', title: 'L-shape: hide two sides to work out', default: false },
    grid: { type: 'boolean', title: 'Draw on a squared grid', default: true },
    name: { type: 'string', title: 'What the shape is (optional)', description: 'Like “the garden” or “a photo frame”. Shown above the answer.', maxLength: 60, default: '' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y3-perimeter', name: 'Year 3: perimeter of a 5 cm by 3 cm rectangle', params: {
    title: 'What is the perimeter?', shape: 'rectangle', measure: 'perimeter', method: 'count', unit: 'cm', length: 5, width: 3, name: 'A photo frame' } },
  { id: 'y4-area-count', name: 'Year 4: area by counting squares', params: {
    title: 'How many squares cover the shape?', shape: 'compound', measure: 'area', method: 'count', unit: 'cm', length: 6, width: 4, cutLength: 2, cutWidth: 2, labelSides: false } },
  { id: 'y5-triangle', name: 'Year 5: a triangle is half its rectangle', params: {
    title: 'What is the area of the triangle?', shape: 'triangle', measure: 'area', method: 'formula', unit: 'cm', length: 8, width: 5, offset: 3 } },
  { id: 'y6-volume', name: 'Year 6: volume of a 4 × 3 × 2 cuboid', params: {
    title: 'What is the volume of the box?', shape: 'cuboid', measure: 'volume', method: 'formula', unit: 'cm', length: 4, width: 3, height: 2, name: 'A box of cubes' } },
];

/* ------------------------------------------------------------------ geometry, in code */
const near = (a, b) => Math.abs(a - b) < 1e-9;
const isWhole = v => near(v, Math.round(v));
// a side length as pupils would write it: whole, or measured to one decimal place
// drawn in 3D: a cuboid's volume or base area, or a rectangle's volume (a cuboid built on it). A cuboid's
// perimeter has twelve edges to choose from, so it is the perimeter of its base, laid flat as that rectangle.
const isSolid = P => (P.shape === 'cuboid' && P.measure !== 'perimeter') || P.measure === 'volume';
const r1 = v => (isWhole(v) ? Math.round(v) : Math.round(v * 10) / 10);
const sq = u => `${u}²`, cu = u => `${u}³`;
const MAX_CELL = 120, MIN_CELL = 26;
const DX = 0.42, DY = 0.3;
const REGION = { x: 64, y: 124, w: 680, h: 480 }; // oblique depth for the cuboid, per unit going back

/** The flat shape: corners clockwise on screen from the top left (shape units, y up), sides with sources. */
function geom(P) {
  const L = P.length, W = P.width, s = P.offset, cl = P.cutLength, cw = P.cutWidth;
  let pts, src;
  if (P.shape === 'compound') {
    pts = [[0, W], [L - cl, W], [L - cl, W - cw], [L, W - cw], [L, 0], [0, 0]];
    src = ['length', 'cutWidth', 'cutLength', 'width', 'length', 'width'];
  } else if (P.shape === 'triangle') {
    pts = [[s, W], [L, 0], [0, 0]]; src = ['offset', 'length', 'offset'];
  } else if (P.shape === 'parallelogram') {
    pts = [[s, W], [L + s, W], [L, 0], [0, 0]]; src = ['length', 'offset', 'length', 'offset'];
  } else { pts = [[0, W], [L, W], [L, 0], [0, 0]]; src = ['length', 'width', 'length', 'width']; }
  const sides = pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), path: src[i], i }; });
  const sw = Math.max(...pts.map(p => p[0])), sh = W;
  const area = P.shape === 'compound' ? L * W - cl * cw : P.shape === 'triangle' ? L * W / 2 : L * W;
  const perim = sides.reduce((t, x) => t + x.len, 0);
  // the L-shape's two inner sides are the ones to work out
  if (P.shape === 'compound' && P.missingSides) { sides[1].missing = true; sides[2].missing = true; }
  return { pts, sides, sw, sh, area, perim, L, W, s, cl, cw };
}
// a clear cell of grid all round the shape, so its side lengths sit on the grid
const cellFor = G => Math.min(MAX_CELL, Math.floor(REGION.w / (G.sw + 2)), Math.floor(REGION.h / (G.sh + 2)));
const cubeFor = P => Math.min(120, Math.floor(560 / (P.length + DX * P.width)), Math.floor(380 / (P.height + DY * P.width)));

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  if (R.length) return result(R);
  const u = P.unit, shp = P.shape, ms = P.measure;
  // volume needs a 3D shape: a cuboid, or a cuboid built up on the rectangle as its base
  if (ms === 'volume' && shp !== 'cuboid' && shp !== 'rectangle') R.push({ path: 'measure', reason: `Volume is the space inside a 3D shape, and this model fills cuboids with cubes. Choose a rectangle or a cuboid for volume, or find the area of the ${shp === 'compound' ? 'L-shape' : shp}.` });
  if (P.method === 'split' && !(shp === 'compound' && ms === 'area')) R.push({ path: 'method', reason: 'Split and add finds the area of an L-shape. Choose “Count” or “Use a formula” for this shape.' });
  if (shp === 'compound') {
    if (P.cutLength >= P.length) R.push({ path: 'cutLength', reason: `The corner cut away (${P.cutLength} ${u}) must be shorter than the length (${P.length} ${u}), or the L-shape falls apart.` });
    if (P.cutWidth >= P.width) R.push({ path: 'cutWidth', reason: `The corner cut away (${P.cutWidth} ${u}) must be shorter than the width (${P.width} ${u}), or the L-shape falls apart.` });
  }
  if (shp === 'triangle' && P.offset > P.length) R.push({ path: 'offset', reason: `The top corner has to sit above the base (0 to ${P.length} ${u} along), so the cut shows the triangle is half the rectangle.` });
  if (shp === 'parallelogram') {
    if (P.offset < 1) R.push({ path: 'offset', reason: 'With no shift the shape is a rectangle. Shift the top edge by at least 1, or choose Rectangle.' });
    else if (P.offset > P.length) R.push({ path: 'offset', reason: `Shift the top edge by no more than the base (${P.length} ${u}), so one cut turns it into a rectangle.` });
  }
  if (R.length) return result(R);
  if (isSolid(P)) {
    const V = P.length * P.width * P.height;
    if (V > 240) R.push({ path: 'height', reason: `${V} cubes are too many to count on one slide. Keep the volume to 240 cubes or fewer.` });
    else if (cubeFor(P) < 22) R.push({ path: 'length', reason: 'This cuboid is too big to draw on one slide with cubes you can see. Use smaller sides.' });
    return result(R);
  }
  const G = geom(P);
  // a sloping side is not a whole number of squares: it is measured to 0.1, so pupils need its length shown
  if (ms === 'perimeter' && !P.labelSides && G.sides.some(x => !isWhole(x.len))) R.push({ path: 'labelSides', reason: `A sloping side here is about ${fmtNum(r1(G.sides.find(x => !isWhole(x.len)).len))} ${u}, not a whole number of squares, so pupils can’t count it. Turn on “Label the side lengths”.` });
  if (cellFor(G) < MIN_CELL) R.push({ path: 'length', reason: `A shape ${G.sw} by ${G.sh} squares won’t fit on one slide with squares big enough to count. Use smaller sides.` });
  return result(R);
}

/* ------------------------------------------------------------------ builds and notes */
const n = v => fmtNum(v);
function plan(P) {
  const u = P.unit, shp = P.shape, ms = P.measure, items = [];
  const add = (key, caption, note) => items.push({ key, caption, note });
  const card = []; // rows on the answer card: {key, s, computed, cls}
  let G = null, big = null, countFrom = null;
  if (isSolid(P)) {
    const l = P.length, w = P.width, hh = P.height, lw = l * w, V = lw * hh;
    const shapeS = shp === 'rectangle' ? `A cuboid built up on the ${l} ${u} by ${w} ${u} rectangle, ${hh} ${u} high.` : `A cuboid ${l} ${u} long, ${w} ${u} wide and ${hh} ${u} high.`;
    if (ms === 'area') { // the area of its base: the bottom layer of cubes stands on it, one square per cube
      add('shape', `${shapeS} What is the area of its base?`, 'Ask: the base is the face the cuboid stands on. What shape is it?');
      add('layer', `Cover the base with 1 ${u} cubes: ${w} row${w > 1 ? 's' : ''} of ${l} = ${lw}. Each cube stands on 1 ${sq(u)}.`, `The base is a ${l} by ${w} rectangle, so its area is found like any rectangle's. Count in ${l}s: ${Array.from({ length: w }, (_, i) => (i + 1) * l).join(', ')}.`);
      card.push({ key: 'layer', s: `Base: ${w} row${w > 1 ? 's' : ''} of ${l} = ${lw}`, computed: 'length' });
      if (P.method === 'formula') { add('formula', `Area of the base = length × width = ${l} × ${w} = ${lw} ${sq(u)}.`, `The units are squared (${sq(u)}) because we count squares, even on a 3D shape.`); card.push({ key: 'formula', s: `${l} × ${w} = ${lw} ${sq(u)}`, computed: 'length', cls: 'ts-label', strong: true }); }
      big = { value: lw, unit: sq(u), key: 'layer', path: 'length' }; countFrom = 'layer';
      return { items, card, big, countFrom, summary: `The area of the base is ${lw} ${sq(u)}: ${lw} squares, one under each cube of the bottom layer.`, summaryNote: `Ask: how many cubes fill the whole cuboid? (${hh} layer${hh > 1 ? 's' : ''} of ${lw} = ${V}.)` };
    }
    add('shape', shapeS, 'Ask: how many 1 ' + u + ' cubes would fill it? Take guesses before you count.');
    add('layer', `Fill the bottom layer with 1 ${u} cubes: ${l} × ${w} = ${lw} cubes.`, `The bottom layer is a rectangle of cubes: ${w} row${w > 1 ? 's' : ''} of ${l}. Volume builds on area: the layer is the area of the base.`);
    card.push({ key: 'layer', s: `One layer: ${l} × ${w} = ${lw}`, computed: 'length' });
    add('stack', hh > 1 ? `Stack ${hh} layers of ${lw}: ${hh} × ${lw} = ${V} cubes in all.` : `One layer fills it: ${V} cubes in all.`, `Count in ${lw}s as each layer goes on: ${Array.from({ length: hh }, (_, i) => (i + 1) * lw).join(', ')}.`);
    card.push({ key: 'stack', s: `${hh} layer${hh > 1 ? 's' : ''}: ${hh} × ${lw} = ${V}`, computed: 'height' });
    if (P.method === 'formula') { add('formula', `Volume = length × width × height = ${l} × ${w} × ${hh} = ${V} ${cu(u)}.`, `The units are cubed (${cu(u)}) because we count cubes. Ask: does the order of multiplying matter?`); card.push({ key: 'formula', s: `${l} × ${w} × ${hh} = ${V} ${cu(u)}`, computed: 'height', cls: 'ts-label', strong: true }); }
    big = { value: V, unit: cu(u), key: 'layer', path: 'height' }; countFrom = 'layer';
    const summary = `The volume is ${V} ${cu(u)}: ${V} cubes of 1 ${u} fill the cuboid.`;
    return { items, card, big, countFrom, summary, summaryNote: `Ask: what other cuboids hold ${V} cubes? (Any three whole numbers that multiply to ${V}.)` };
  }
  G = geom(P);
  const L = P.length, W = P.width, A = G.area;
  const exact = G.sides.every(x => isWhole(x.len)); // every side a whole number of units, so the walk counts them
  const Per = Math.round(G.sides.reduce((t, x) => t + r1(x.len), 0) * 10) / 10;
  const gridWords = P.grid ? `, drawn on a grid of 1 ${u} squares` : '';
  const shapeCap = {
    rectangle: `A ${L} ${u} by ${W} ${u} rectangle${gridWords}.`,
    compound: `An L-shape: a ${L} by ${W} rectangle with a ${P.cutLength} by ${P.cutWidth} corner cut away.`,
    triangle: `A triangle with a base of ${L} ${u} and a perpendicular height of ${W} ${u}.`,
    parallelogram: `A parallelogram with a base of ${L} ${u} and a perpendicular height of ${W} ${u}.`,
    cuboid: `The base of the ${L} by ${W} by ${P.height} cuboid, laid flat: a ${L} ${u} by ${W} ${u} rectangle.`,
  }[shp];
  add('shape', shapeCap, ms === 'perimeter' ? 'Ask: if an ant walked all the way round the edge, how far would it go?' : 'Ask: how many squares do you think would cover it? Take guesses before you count.');
  const miss = G.sides.filter(s => s.missing);
  if (miss.length && P.labelSides) {
    add('missing', `Two sides have no length. Use the sides you know: ${L} − ${L - P.cutLength} = ${P.cutLength} and ${W} − ${W - P.cutWidth} = ${P.cutWidth}.`,
      `The two horizontal pieces on top add up to the bottom (${L}), and the two vertical pieces on the right add up to the left side (${W}).`);
    card.push({ key: 'missing', s: `${L} − ${L - P.cutLength} = ${P.cutLength} ${u}`, computed: 'cutLength', recede: true });
    card.push({ key: 'missing', s: `${W} − ${W - P.cutWidth} = ${P.cutWidth} ${u}`, computed: 'cutWidth', recede: true });
  }
  if (ms === 'perimeter') {
    const parts = G.sides.map(x => n(r1(x.len)));
    if (!exact) { // a sloping side is not whole squares: measure it to 0.1 and add, side by side
      add('walk', `Perimeter is the distance all the way round. Add the sides, with each sloping side measured to 0.1 ${u}.`, `A sloping side cuts across the squares, so it can’t be counted. Measure it with a ruler to the nearest 0.1 ${u} (here it is worked out for you).`);
      card.push({ key: 'walk', s: `${parts.join(' + ')} = ${n(Per)} ${u}`, computed: 'length', cls: 'ts-label', strong: true });
      big = { value: Per, unit: u, key: 'walk', path: 'length' }; countFrom = 'walk';
    } else {
    add('walk', `Perimeter is the distance all the way round. Walk the edge and count: ${n(Per)} ${u}.`, shp === 'triangle' || shp === 'parallelogram' ? `Each mark is 1 ${u} along the edge. Count every 1 ${u} step, including along the sloping sides.` : `Each mark is 1 ${u}. Start at a corner and count every side of every square on the edge, not the squares.`);
    big = { value: Per, unit: u, key: 'walk', path: 'length' }; countFrom = 'walk';
    if (P.method === 'formula') {
      const cap = shp === 'rectangle' || shp === 'cuboid' ? `Add the sides: ${parts.join(' + ')} = ${n(Per)} ${u}. That is 2 × (${L} + ${W}).` : `Add all the sides: ${parts.join(' + ')} = ${n(Per)} ${u}.`;
      add('formula', cap, shp === 'rectangle' || shp === 'cuboid' ? 'Opposite sides of a rectangle are equal, so add the length and width once and double it.' : 'Tick off each side as you add it, so none is missed or counted twice.');
      card.push({ key: 'formula', s: shp === 'rectangle' || shp === 'cuboid' ? `2 × (${L} + ${W}) = ${n(Per)} ${u}` : `${parts.join(' + ')} = ${n(Per)}`, computed: 'length', cls: 'ts-label', strong: true });
    }
    }
    return { G, items, card, big, countFrom, summary: `The perimeter is ${n(Per)} ${u}: the whole distance around the edge.`, summaryNote: 'Ask: can you draw a different shape with the same perimeter? Does it have the same area?' };
  }
  // area
  const summary = `The area is ${n(A)} ${sq(u)}: the space inside, measured in 1 ${u} squares.`;
  const summaryNote = `Area is in square units (${sq(u)}) because we count squares; perimeter is in ${u} because we measure a length.`;
  if (shp === 'rectangle' || (shp === 'compound' && P.method === 'count')) {
    add('fill', shp === 'rectangle' ? `Area is the space inside. Fill it with squares, row by row: ${W} rows of ${L}.` : `Area is the space inside. Count the squares that cover it, row by row: ${A}.`,
      shp === 'rectangle' ? `Count in ${L}s down the rows: ${Array.from({ length: W }, (_, i) => (i + 1) * L).join(', ')}.` : 'Count each row and add the rows. Ask: why is it not simply length × width?');
    big = { value: A, unit: sq(u), key: 'fill', path: 'length' }; countFrom = 'fill';
    if (P.method === 'formula') {
      add('formula', `${W} rows of ${L} is length × width: ${L} × ${W} = ${A} ${sq(u)}.`, `The formula counts the squares for us: ${W} rows of ${L}. The units are squared (${sq(u)}).`);
      card.push({ key: 'formula', s: `${L} × ${W} = ${A} ${sq(u)}`, computed: 'length', cls: 'ts-label', strong: true });
    }
  } else if (shp === 'compound' && P.method === 'formula') {
    const whole = L * W, cut = P.cutLength * P.cutWidth;
    add('whole', `Complete the rectangle around the L-shape: ${L} × ${W} = ${whole} ${sq(u)}.`, 'The L-shape is a rectangle with a corner missing. Ask: what would the area be with the corner filled in?');
    card.push({ key: 'whole', s: `Whole: ${L} × ${W} = ${whole}`, computed: 'length' });
    add('corner', `Take away the corner cut away: ${P.cutLength} × ${P.cutWidth} = ${cut} ${sq(u)}.`, 'The corner is a rectangle too, so its area is length × width.');
    card.push({ key: 'corner', s: `Corner: ${P.cutLength} × ${P.cutWidth} = ${cut}`, computed: 'cutLength', part: 'B' });
    add('take', `${whole} − ${cut} = ${A} ${sq(u)}.`, `Check by splitting into two rectangles: ${(L - P.cutLength) * W} + ${P.cutLength * (W - P.cutWidth)} = ${A}.`);
    card.push({ key: 'take', s: `${whole} − ${cut} = ${A} ${sq(u)}`, computed: 'length', cls: 'ts-label', strong: true });
    big = { value: A, unit: sq(u), key: 'take', path: 'length' };
  } else if (shp === 'compound') {
    const aL = L - P.cutLength, aW = W, bL = P.cutLength, bW = W - P.cutWidth, aA = aL * aW, bA = bL * bW;
    add('split', 'Split the L-shape into two rectangles, A and B.', 'There are two ways to split an L-shape. Ask: where else could we cut? Do we get the same total?');
    add('partA', `Rectangle A is ${aL} × ${aW} = ${aA} ${sq(u)}.`, `A is ${aL} across and the full ${aW} up.`);
    card.push({ key: 'partA', s: `A: ${aL} × ${aW} = ${aA}`, computed: 'cutLength', part: 'A' });
    add('partB', `Rectangle B is ${bL} × ${bW} = ${bA} ${sq(u)}.`, `B is ${bL} across (the corner cut away) and ${bW} up.`);
    card.push({ key: 'partB', s: `B: ${bL} × ${bW} = ${bA}`, computed: 'cutWidth', part: 'B' });
    add('add', `Add the two parts: ${aA} + ${bA} = ${A} ${sq(u)}.`, `Check: the big rectangle ${L} × ${W} = ${L * W}, take away the missing corner ${P.cutLength} × ${P.cutWidth} = ${P.cutLength * P.cutWidth}, gives ${A}.`);
    card.push({ key: 'add', s: `${aA} + ${bA} = ${A} ${sq(u)}`, computed: 'length', cls: 'ts-label', strong: true });
    big = { value: A, unit: sq(u), key: 'add', path: 'length' };
  } else if (shp === 'triangle') {
    add('rect', P.method === 'count' ? `Draw the rectangle around it and count its squares: ${W} rows of ${L} = ${L * W}.` : `Draw the rectangle around it: ${L} × ${W} = ${L * W} squares.`, 'The rectangle has the same base and the same perpendicular height as the triangle.');
    card.push({ key: 'rect', s: `Rectangle: ${L} × ${W} = ${L * W}`, computed: 'length' });
    add('cut', 'Each piece outside matches a piece inside, so the triangle is half the rectangle.', G.s > 0 && G.s < L ? 'The height line cuts the rectangle into two smaller rectangles. A sloping side cuts each one exactly in half.' : 'The sloping side is a diagonal, and a diagonal cuts a rectangle exactly in half.');
    card.push({ key: 'cut', s: `Half of ${L * W} = ${n(A)}`, computed: 'width' });
    if (P.method === 'formula') {
      add('formula', `Area of a triangle = ½ × base × height = ½ × ${L} × ${W} = ${n(A)} ${sq(u)}.`, 'The height must be perpendicular to the base (at a right angle), not the sloping side.');
      card.push({ key: 'formula', s: `½ × ${L} × ${W} = ${n(A)} ${sq(u)}`, computed: 'length', cls: 'ts-label', strong: true });
    }
    big = { value: A, unit: sq(u), key: 'cut', path: 'length' };
  } else if (shp === 'parallelogram') {
    add('cut', 'Cut a right-angled triangle off one end, along the perpendicular height.', 'Nothing is added or taken away: the cut piece is only moved, so the area stays the same.');
    add('move', `Slide it to the other end: the parallelogram becomes a ${L} by ${W} rectangle.`, 'Ask: what has changed and what has stayed the same? (The shape changes; the area and the base and height do not.)');
    if (P.method === 'count') {
      add('fill', `Count the squares in the rectangle, row by row: ${W} rows of ${L} = ${A}.`, `Count in ${L}s down the rows: ${Array.from({ length: W }, (_, i) => (i + 1) * L).join(', ')}.`);
      big = { value: A, unit: sq(u), key: 'fill', path: 'length' }; countFrom = 'fill';
    } else {
      add('formula', `Area of a parallelogram = base × height = ${L} × ${W} = ${A} ${sq(u)}.`, 'Use the perpendicular height, not the length of the sloping side.');
      card.push({ key: 'formula', s: `${L} × ${W} = ${A} ${sq(u)}`, computed: 'length', cls: 'ts-label', strong: true });
      big = { value: A, unit: sq(u), key: 'formula', path: 'length' };
    }
  }
  return { G, items, card, big, countFrom, summary, summaryNote };
}
export function builds(P) { P = withDefaults(params, P); const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }
export function notes(P) { P = withDefaults(params, P); const pl = plan(P); return { steps: pl.items.map(i => i.note), summary: pl.summaryNote }; }

/* ------------------------------------------------------------------ render */
const CARD = { x: 768, y: 124, w: 448 };
const MEASURE_WORD = { perimeter: 'Perimeter', area: 'Area', volume: 'Volume' };

export function render(root, P, ctx) {
  P = withDefaults(params, P);
  const pl = plan(P), b = ctx.b, N = ctx.N, u = P.unit;
  const kOf = key => (b[key] == null ? null : b[key]);
  const boxes = []; // label boxes, to check nothing collides
  const hooks = { dur: {} };
  const ticks = []; // functions (k, uu) for counters and moves
  let finals = [];

  const solid = isSolid(P);
  if (solid) drawCuboid(root, P, ctx, pl, boxes, hooks, ticks, finals);
  else drawFlat(root, P, ctx, pl, boxes, hooks, ticks, finals);

  /* the key: what one square or cube stands for */
  const keyS = solid ? `Each cube is 1 ${u} by 1 ${u} by 1 ${u}.` : P.grid ? `Each square is 1 ${u} by 1 ${u}.` : '';
  if (keyS) boxes.push({ id: 'key', x: REGION.x, y: 614, w: REGION.w, h: 34 });
  if (keyS) computed(T(root, REGION.x, 640, keyS + (u === 'm' ? ' Not to scale.' : ''), 'ts-small', { 'font-size': 'var(--fs-label)' }), 'unit');

  /* the answer card */
  const cg = h('g', {}, root);
  const bg = h('rect', { x: CARD.x, y: CARD.y, width: CARD.w, height: 10, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'lift' }, cg);
  let y = CARD.y + 20; const ix = CARD.x + 28, iw = CARD.w - 56;
  const name = (P.name || '').trim();
  if (name) { const tb = textBlock(cg, ix, y + 26, name, { cls: 'ts-label', maxW: iw, maxLines: 3, lh: 36, edit: 'name', a: { fill: 'var(--ink-2)' } }); y += tb.h + 8; }
  const mw = textBlock(cg, ix, y + 28, txt(P, 'label:measure', solid && P.measure === 'area' ? 'Area of the base' : MEASURE_WORD[P.measure]), { cls: 'ts-label', maxW: iw, maxLines: 3, lh: 36, edit: 'text.label:measure' }); y += mw.h + 4;
  const kBig = kOf(pl.big.key);
  const fmtBig = v => `${n(v)} ${pl.big.unit}`;
  computed(T(cg, ix, y + 60, '?', 'ts-big', { 'font-size': 'var(--fs-eq)', fill: 'var(--ink-3)', hide: kBig }), pl.big.path);
  const bigT = computed(T(cg, ix, y + 60, fmtBig(pl.big.value), 'ts-big', { 'font-size': 'var(--fs-eq)', fill: P.measure === 'perimeter' ? 'var(--focus-text)' : 'var(--compare-text)', s: kBig, cls: pl.countFrom ? null : 'rise' }), pl.big.path);
  if (measure(cg, fmtBig(pl.big.value), 'ts-big', { 'font-size': 'var(--fs-eq)' }) > iw) ctx.warn('answer wider than the card');
  y += 80;
  for (const r of pl.card) {
    const k = kOf(r.key); const fill = r.part === 'A' ? 'var(--compare-text)' : r.part === 'B' ? 'var(--part-text)' : r.strong ? 'var(--ink)' : 'var(--ink-2)';
    const c = r.recede ? [ctx.rc(r.key), `${ctx.N}:soft`].filter(Boolean).join(',') : null;
    // the final formula is the largest line on the card: --fs-num on one line, else --fs-h3 (still above the working lines)
    const fs = r.strong ? (measure(cg, r.s, 'ts-label', { 'font-size': 'var(--fs-num)', 'font-weight': 'var(--w-strong)' }) <= iw ? 'var(--fs-num)' : 'var(--fs-h3)') : null;
    const tb = textBlock(cg, ix, y + (r.strong ? 40 : 32), r.s, { cls: 'ts-label', maxW: iw, maxLines: 2, lh: r.strong ? 48 : 38, a: { 'font-size': fs, 'font-weight': r.strong ? 'var(--w-strong)' : null, fill, s: k, cls: 'rise', c, delay: r.key === 'missing' ? 0 : 200 } });
    computed(tb.el, r.computed); y += tb.h + 12;
  }
  bg.setAttribute('height', y - CARD.y + 12);
  if (y > GRID.bottom) ctx.warn('answer card runs past the bottom of the slide');

  /* counting in real time */
  if (pl.countFrom) {
    const setN = v => { bigT.textContent = fmtBig(v); };
    finals.push(() => setN(pl.big.value));
    ticks.push((k, uu) => {
      const c = hooks.counter; if (!c) return;
      const r = c(k, uu); if (r != null) setN(r);
    });
  }
  for (const bx of boxes) for (const o of boxes) if (bx !== o && overlaps(bx, o, 2)) { ctx.warn(`labels touch: ${bx.id} and ${o.id}`); break; }
  return {
    dur: hooks.dur,
    reset() { ticks.forEach(f => f(-1, 0)); },
    still() { finals.forEach(f => f()); },
    tick(k, uu) { ticks.forEach(f => f(k, uu)); },
  };
}

/* the flat shapes: rectangle, L-shape, triangle, parallelogram */
function drawFlat(root, P, ctx, pl, boxes, hooks, ticks, finals) {
  const G = pl.G, b = ctx.b, N = ctx.N, u = P.unit, c = cellFor(G);
  const nx = Math.floor(REGION.w / c), ny = Math.floor(REGION.h / c);
  const gx = REGION.x + (REGION.w - nx * c) / 2, gy = REGION.y + (REGION.h - ny * c) / 2;
  const ox = Math.floor((nx - G.sw) / 2), oy = Math.floor((ny - G.sh) / 2);
  const X0 = gx + ox * c, Y0 = gy + (ny - oy) * c;
  const S = ([x, y]) => [X0 + x * c, Y0 - y * c];
  const polyD = pts => 'M' + pts.map(p => S(p).map(v => v.toFixed(1)).join(' ')).join(' L') + ' Z';
  const k = key => b[key];

  /* grid paper, then the shape's fill, the area squares, the grid lines and the outline */
  const paper = h('g', {}, root), fills = h('g', {}, root), lines = h('g', {}, root), top = h('g', {}, root), labs = h('g', {}, root);
  if (P.grid) h('rect', { x: gx, y: gy, width: nx * c, height: ny * c, fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, paper);
  const shapeFill = h('path', { d: polyD(G.pts), fill: 'color-mix(in oklab, var(--neutral) 22%, var(--paper))' }, fills);
  const cellsIn = []; // unit squares inside the shape, row by row from the top
  if (P.shape === 'rectangle' || P.shape === 'compound') {
    for (let r = G.sh - 1; r >= 0; r--) { const row = []; for (let i = 0; i < G.sw; i++) { if (P.shape === 'compound' && i >= G.L - G.cl && r >= G.W - G.cw) continue; row.push([i, r]); } cellsIn.push(row); }
  }
  const sqr = (p, [i, r], fill, a) => { const [x, y] = S([i, r + 1]); return h('rect', Object.assign({ x, y, width: c, height: c, fill }, a), p); };

  let fillG = fills;
  if (P.shape === 'parallelogram') { // count: the rectangle it becomes, filled above the moved piece, cell edges drawn
    for (let r = G.sh - 1; r >= 0; r--) cellsIn.push(Array.from({ length: G.L }, (_, i) => [G.s + i, r]));
    fillG = h('g', { stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, top);
  }
  if (P.measure === 'area' && b.fill != null) {
    const cols = Math.max(...cellsIn.map(r => r.length)), rows = cellsIn.length;
    const colStep = Math.min(70, 500 / cols), rowStep = Math.min(cols * colStep + 160, 2400 / rows);
    let t = 0; const times = [];
    cellsIn.forEach((row, ri) => row.forEach(([i, r], ci) => { const d = Math.round(ri * rowStep + ci * colStep); times.push(d); sqr(fillG, [i, r], 'color-mix(in oklab, var(--compare) 42%, var(--paper))', { s: k('fill'), cls: 'pop', delay: d }); t = Math.max(t, d); }));
    hooks.dur.fill = t + 700;
    hooks.counter = (kk, uu) => kk === k('fill') ? times.filter(d => d + 250 <= uu * (t + 700)).length : null;
    if (P.shape === 'rectangle') { // running totals at the end of each row: counting in lengths
      cellsIn.forEach((row, ri) => { const [x, y] = S([G.sw, row[0][1] + .5]); const s = String((ri + 1) * G.L);
        computed(T(labs, x + 14, y + 8, s, 'ts-axis', { s: k('fill'), cls: 'rise', delay: Math.round(ri * rowStep + (cols - 1) * colStep + 200) }), 'length');
        boxes.push({ id: 'row ' + ri, x: x + 10, y: y - 14, w: measure(labs, s, 'ts-axis') + 8, h: 28 }); });
    }
  }
  if (P.shape === 'compound' && b.split != null) {
    const xs = G.L - G.cl; const [x1, y1] = S([xs, G.W - G.cw]), [, y2] = S([xs, 0]);
    h('line', { x1, x2: x1, y1, y2, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '10 8', s: k('split'), cls: 'draw', pathLength: 1 }, top);
    const parts = [{ id: 'A', key: 'partA', cells: cellsIn.flat().filter(([i]) => i < xs), col: 'var(--compare)', box: [[0, 0], [xs, G.W]] },
      { id: 'B', key: 'partB', cells: cellsIn.flat().filter(([i]) => i >= xs), col: 'var(--part)', box: [[xs, 0], [G.L, G.W - G.cw]] }];
    for (const pt of parts) {
      pt.cells.forEach(([i, r]) => sqr(fills, [i, r], `color-mix(in oklab, ${pt.col} 38%, var(--paper))`, { s: k(pt.key), cls: 'pop', delay: Math.round((G.sh - 1 - r) * 120 + (i - pt.box[0][0]) * 40) }));
      const [cx, cy] = S([(pt.box[0][0] + pt.box[1][0]) / 2, (pt.box[0][1] + pt.box[1][1]) / 2]);
      const lg = h('g', { s: k('split'), cls: 'pop', delay: 500 }, labs);
      const w = measure(lg, pt.id, 'ts-label') + 20; labelGround(lg, { x: cx - w / 2, y: cy - 20, w, h: 40 });
      computed(T(lg, cx, cy + 10, pt.id, 'ts-label', { 'text-anchor': 'middle', fill: pt.id === 'A' ? 'var(--compare-text)' : 'var(--part-text)' }), 'cutLength');
    }
    hooks.dur.partA = 1400; hooks.dur.partB = 1400;
  }
  if (P.shape === 'triangle' && P.measure === 'area') {
    const R0 = [[0, G.W], [G.L, G.W], [G.L, 0], [0, 0]];
    fills.insertBefore(h('path', { d: polyD(R0), fill: 'color-mix(in oklab, var(--part) 8%, var(--paper))', s: k('rect') }), shapeFill);
    h('path', { d: polyD(R0), fill: 'none', stroke: 'var(--part)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '12 9', s: k('rect') }, top);
    if (G.s > 0 && G.s < G.L) {
      const [hx, hy] = S([G.s, G.W]), [, by] = S([G.s, 0]);
      h('line', { x1: hx, x2: hx, y1: hy, y2: by, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '10 8', s: k('cut'), cls: 'draw', pathLength: 1 }, top);
      raMark(top, hx, by, c, { s: k('cut') });
    }
    // each outside piece is outlined with its matching inside piece's colour
    const outs = G.s > 0 && G.s < G.L ? [[[0, 0], [0, G.W], [G.s, G.W]], [[G.s, G.W], [G.L, G.W], [G.L, 0]]] : G.s === 0 ? [[[0, G.W], [G.L, G.W], [G.L, 0]]] : [[[0, 0], [0, G.W], [G.L, G.W]]];
    for (const o of outs) h('path', { d: polyD(o), fill: 'color-mix(in oklab, var(--part) 16%, var(--paper))', s: k('cut'), cls: 'pop' }, fills);
  }
  if (P.shape === 'triangle') {
    shapeFill.style.setProperty('fill', 'color-mix(in oklab, var(--compare) 30%, var(--paper))');
    if (G.s === 0) raMark(top, ...S([0, 0]), c, {});
    if (G.s === G.L) raMark(top, ...S([G.L, 0]), c, {}, -1);
  }
  let moveG = null;
  if (P.shape === 'parallelogram' && P.measure === 'area') { // the cut and move only belong to the area story
    shapeFill.remove();
    h('path', { d: polyD([[G.s, G.W], [G.L + G.s, G.W], [G.L, 0], [G.s, 0]]), fill: 'color-mix(in oklab, var(--compare) 30%, var(--paper))' }, fills);
    const tri = [[0, 0], [G.s, G.W], [G.s, 0]];
    h('path', { d: polyD(tri), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '8 8', s: k('move') }, top);
    moveG = h('g', {}, top);
    h('path', { d: polyD(tri), fill: 'color-mix(in oklab, var(--compare) 30%, var(--paper))' }, moveG);
    const tp = h('path', { d: polyD(tri), fill: 'color-mix(in oklab, var(--part) 34%, var(--paper))', s: k('cut'), stroke: 'var(--part)', 'stroke-width': 'var(--sw-struct)' }, moveG);
    const [hx, hy] = S([G.s, G.W]), [, by] = S([G.s, 0]);
    h('line', { x1: hx, x2: hx, y1: hy, y2: by, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '10 8', s: k('cut'), cls: 'draw', pathLength: 1 }, top);
    raMark(top, hx, by, c, { s: k('cut') });
    const dx = G.L * c, kM = k('move');
    const at = v => moveG.setAttribute('transform', `translate(${(dx * v).toFixed(1)} 0)`);
    hooks.dur.move = 1300;
    ticks.push((kk, uu) => at(kk < kM ? 0 : kk === kM ? eIO(uu) : 1)); finals.push(() => at(1));
    void tp;
    if (fillG !== fills) top.appendChild(fillG); // the counted squares sit over the moved piece
  }
  /* L-shape by formula: the whole rectangle, then the corner taken away */
  if (P.shape === 'compound' && b.whole != null) {
    const R0 = [[0, G.W], [G.L, G.W], [G.L, 0], [0, 0]];
    const C0 = [[G.L - G.cl, G.W], [G.L, G.W], [G.L, G.W - G.cw], [G.L - G.cl, G.W - G.cw]];
    h('path', { d: polyD(G.pts), fill: 'color-mix(in oklab, var(--compare) 30%, var(--paper))', s: k('whole'), cls: 'pop' }, fills);
    h('path', { d: polyD(C0), fill: 'color-mix(in oklab, var(--compare) 30%, var(--paper))', s: k('whole'), hide: k('corner'), cls: 'pop' }, fills);
    h('path', { d: polyD(C0), fill: 'color-mix(in oklab, var(--part) 38%, var(--paper))', s: k('corner'), hide: k('take'), cls: 'pop' }, fills);
    h('path', { d: polyD(R0), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '12 9', s: k('whole') }, top);
    h('path', { d: polyD(C0), fill: 'none', stroke: 'var(--part)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '10 8', s: k('corner'), hide: k('take') }, top);
  }

  /* grid lines over the fills, so the squares can be counted */
  if (P.grid) {
    for (let i = 0; i <= nx; i++) h('line', { x1: gx + i * c, x2: gx + i * c, y1: gy, y2: gy + ny * c, stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, lines);
    for (let j = 0; j <= ny; j++) h('line', { x1: gx, x2: gx + nx * c, y1: gy + j * c, y2: gy + j * c, stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, lines);
  }
  const outline = h('path', { d: polyD(G.pts), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, top);
  if (P.shape === 'parallelogram' && P.measure === 'area') {
    outline.dataset.h = b.move; outline.classList.add('snap');
    h('path', { d: polyD([[G.s, G.W], [G.L + G.s, G.W], [G.L + G.s, 0], [G.s, 0]]), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', s: b.move, delay: 1300 }, top);
  }

  /* perimeter: walk the edge, one dash per unit */
  if (P.measure === 'perimeter') {
    const dashes = [];
    for (const sd of G.sides) { if (!isWhole(sd.len)) { dashes.push([sd.a, sd.b, 0, 1, r1(sd.len)]); continue; } const m = Math.round(sd.len); for (let i = 0; i < m; i++) dashes.push([sd.a, sd.b, i / m, (i + 1) / m, 1]); }
    const step = Math.min(110, 1700 / dashes.length), brk = clamp(c * .1, 3, 7), kW = b.walk;
    const wg = h('g', {}, top);
    dashes.forEach(([a, bb, t0, t1], i) => {
      const [ax, ay] = S(a), [bx, by] = S(bb), L = Math.hypot(bx - ax, by - ay);
      const d = Math.round(i * step);
      h('line', { x1: lerp(ax, bx, t0), y1: lerp(ay, by, t0), x2: lerp(ax, bx, t1), y2: lerp(ay, by, t1), stroke: 'var(--focus)', 'stroke-width': 'var(--sw-data)', 'stroke-linecap': 'round', s: kW, cls: 'draw', pathLength: 1, delay: d }, wg);
      // a short mark across the edge between units (corners mark themselves), so every 1 unit step can be counted
      if (t1 > 1 - 1e-9) return;
      const ex = lerp(ax, bx, t1), ey = lerp(ay, by, t1), px = -(by - ay) / L * brk * 1.7, py = (bx - ax) / L * brk * 1.7;
      h('line', { x1: ex - px * .4, y1: ey - py * .4, x2: ex + px * 1.2, y2: ey + py * 1.2, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', s: kW, cls: 'pop', delay: d + Math.round(step * .8) }, wg);
    });
    const T1 = dashes.length * step + 500; hooks.dur.walk = T1;
    hooks.counter = (kk, uu) => kk === kW ? Math.round(dashes.reduce((t, d, i) => t + (i * step + 200 <= uu * T1 ? d[4] : 0), 0) * 10) / 10 : null;
    // a start marker: where the walk begins
    const [sx, sy] = S(G.pts[0]);
    h('circle', { cx: sx, cy: sy, r: 9, fill: 'var(--focus)', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)', s: kW, cls: 'pop' }, top);
  }

  /* side lengths, outside each side */
  const showSide = sd => {
    if (!P.labelSides) return false;
    if (P.measure !== 'area') return true;
    if (P.shape === 'rectangle') return sd.i === 2 || sd.i === 3; // area: length and width only
    if (P.shape === 'triangle' || P.shape === 'parallelogram') return sd.i === (P.shape === 'triangle' ? 1 : 2); // the base; the height is drawn
    return true;
  };
  const cx0 = G.pts.reduce((t, p) => t + p[0], 0) / G.pts.length;
  for (const sd of G.sides) {
    if (!showSide(sd)) continue;
    const [ax, ay] = S(sd.a), [bx, by] = S(sd.b), L = Math.hypot(bx - ax, by - ay);
    let nxv = (by - ay) / L, nyv = -(bx - ax) / L; // outward for a clockwise-on-screen outline
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const s = `${n(r1(sd.len))} ${u}`, w = measure(labs, s, 'ts-label');
    const ext = Math.abs(nxv) * w / 2 + Math.abs(nyv) * 15 + 12;
    const lx = mx + nxv * ext, ly = my + nyv * ext;
    const box = { id: 'side ' + sd.i, x: lx - w / 2, y: ly - 17, w, h: 34 };
    if (sd.missing) {
      computed(T(labs, lx, ly + 10, '?', 'ts-label', { 'text-anchor': 'middle', cls: 'halo', hide: b.missing }), sd.path);
      computed(T(labs, lx, ly + 10, s, 'ts-label', { 'text-anchor': 'middle', cls: 'halo pop', fill: 'var(--focus-text)', s: b.missing }), sd.path);
    } else computed(T(labs, lx, ly + 10, s, 'ts-label', { 'text-anchor': 'middle', cls: 'halo' }), sd.path);
    boxes.push(box);
  }
  // the perpendicular height of a triangle or parallelogram, labelled beside its line
  if ((P.shape === 'triangle' || P.shape === 'parallelogram') && P.labelSides && P.measure === 'area') {
    const xh = P.shape === 'triangle' ? (G.s > 0 && G.s < G.L ? G.s : G.s === 0 ? 0 : G.L) : G.s;
    const [hx, hy] = S([xh, G.W / 2]); const s = `${G.W} ${u}`, w = measure(labs, s, 'ts-label');
    const left = P.shape === 'triangle' && G.s === 0;
    const lx = left ? hx - 14 - w : hx + 14;
    const kH = P.shape === 'triangle' ? (G.s > 0 && G.s < G.L ? b.cut : 0) : b.cut;
    const lg = h('g', { s: kH, cls: 'rise' }, labs);
    if (!left) labelGround(lg, { x: lx - 6, y: hy - 22, w: w + 12, h: 40 });
    computed(T(lg, lx, hy + 10, s, 'ts-label', { cls: 'halo' }), 'width');
    boxes.push({ id: 'height', x: lx, y: hy - 17, w, h: 34 });
  }
  void cx0; void N;
  return { G, c };
}

/** Small right-angle mark at a foot (x, y) on the base, opening up and to the right. */
function raMark(p, x, y, c, a, dir = 1) {
  const s = clamp(c * .28, 12, 22);
  return h('path', Object.assign({ d: `M${x} ${y - s} h${dir * s} v${s}`, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-rule)' }, a), p);
}

/* the cuboid, filled with unit cubes layer by layer */
function drawCuboid(root, P, ctx, pl, boxes, hooks, ticks, finals) {
  const b = ctx.b, u = P.unit, l = P.length, w = P.width, hh = P.height, q = cubeFor(P);
  const dx = DX * q, dy = -DY * q;
  const totW = l * q + w * dx, totH = hh * q + w * -dy;
  const Ox = REGION.x + (REGION.w - totW) / 2, Oy = REGION.y + (REGION.h - 40 + totH) / 2 + 10; // front-bottom-left corner
  const at = (i, j, z) => [Ox + i * q + j * dx, Oy - z * q + j * dy];
  const pg = pts => 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L') + ' Z';
  const FRONT = 'color-mix(in oklab, var(--compare) 42%, var(--paper))', TOP = 'color-mix(in oklab, var(--compare) 22%, var(--paper))', SIDE = 'color-mix(in oklab, var(--compare) 56%, var(--paper))';
  const EDGE = 'var(--compare-text)';

  /* the empty box: three pale faces, then the cubes, then its edges on top */
  const box = h('g', {}, root);
  const F = [at(0, 0, 0), at(l, 0, 0), at(l, 0, hh), at(0, 0, hh)];
  const Tp = [at(0, 0, hh), at(l, 0, hh), at(l, w, hh), at(0, w, hh)];
  const Sd = [at(l, 0, 0), at(l, w, 0), at(l, w, hh), at(l, 0, hh)];
  h('path', { d: pg(F), fill: 'var(--paper)' }, box);
  h('path', { d: pg(Tp), fill: 'color-mix(in oklab, var(--neutral) 14%, var(--paper))' }, box);
  h('path', { d: pg(Sd), fill: 'color-mix(in oklab, var(--neutral) 30%, var(--paper))' }, box);
  // the hidden back edges, dashed, so the box reads as an open container
  const back = at(0, w, 0);
  for (const e of [[back, at(l, w, 0)], [back, at(0, w, hh)], [back, at(0, 0, 0)]]) h('line', { x1: e[0][0], y1: e[0][1], x2: e[1][0], y2: e[1][1], stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 7' }, box);

  const cubes = h('g', {}, root), kL = b.layer, kS = b.stack;
  const cube = (p, i, j, z) => {
    const [x, y] = at(i, j, z), g = h('g', {}, p);
    h('path', { d: pg([[x, y], [x + q, y], [x + q, y - q], [x, y - q]]), fill: FRONT, stroke: EDGE, 'stroke-width': 'var(--sw-hair)' }, g);
    h('path', { d: pg([[x, y - q], [x + q, y - q], [x + q + dx, y - q + dy], [x + dx, y - q + dy]]), fill: TOP, stroke: EDGE, 'stroke-width': 'var(--sw-hair)' }, g);
    h('path', { d: pg([[x + q, y], [x + q + dx, y + dy], [x + q + dx, y - q + dy], [x + q, y - q]]), fill: SIDE, stroke: EDGE, 'stroke-width': 'var(--sw-hair)' }, g);
    return g;
  };
  // bottom layer: rows from the back, so nearer cubes sit in front
  const rowStep = Math.min(260, 1100 / w), times0 = [];
  for (let j = w - 1; j >= 0; j--) for (let i = 0; i < l; i++) { const d = Math.round((w - 1 - j) * rowStep + i * Math.min(50, 300 / l)); times0.push(d); const g = cube(cubes, i, j, 0); g.dataset.s = kL; g.classList.add('pop'); g.style.setProperty('--d', `calc(${d}ms * var(--pace))`); }
  const T0 = Math.max(...times0) + 600; hooks.dur.layer = T0;
  // the other layers drop in one at a time
  const layStep = Math.min(700, 1800 / Math.max(1, hh - 1)), times1 = [];
  for (let z = 1; z < hh && kS != null; z++) {
    const d = Math.round((z - 1) * layStep); times1.push(d);
    const lg = h('g', { s: kS, cls: 'fly', delay: d, vars: { '--fx': '0px', '--fy': `${-Math.round(q * .9)}px` } }, cubes);
    for (let j = w - 1; j >= 0; j--) for (let i = 0; i < l; i++) cube(lg, i, j, z);
  }
  const T1 = (times1.length ? Math.max(...times1) : 0) + 900; hooks.dur.stack = T1;
  const lw = l * w;
  hooks.counter = (kk, uu) => kk === kL ? times0.filter(d => d + 250 <= uu * T0).length : kk === kS ? lw + lw * times1.filter(d => d + 500 <= uu * T1).length : null;

  /* the box edges, on top */
  const edges = h('g', {}, root);
  for (const pts of [F, Tp, Sd]) h('path', { d: pg(pts), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, edges);

  /* the three edge lengths */
  if (P.labelSides) {
    const labs = h('g', {}, root);
    const put = (s, x, y, anchor, path, id) => { const wd = measure(labs, s, 'ts-label'); computed(T(labs, x, y, s, 'ts-label', { 'text-anchor': anchor, cls: 'halo' }), path); const bx = anchor === 'middle' ? x - wd / 2 : anchor === 'end' ? x - wd : x; boxes.push({ id, x: bx, y: y - 26, w: wd, h: 34 }); };
    put(`${l} ${u}`, (F[0][0] + F[1][0]) / 2, F[0][1] + 40, 'middle', 'length', 'length');
    put(`${hh} ${u}`, F[0][0] - 16, (F[0][1] + F[3][1]) / 2 + 10, 'end', 'height', 'height');
    const m = [(Sd[0][0] + Sd[1][0]) / 2, (Sd[0][1] + Sd[1][1]) / 2];
    put(`${w} ${u}`, m[0] + 18, m[1] + 26, 'start', 'width', 'width');
  }
  return { q };
}

// The water cycle: one landscape (sea and hills, or a town by the sea) where the Sun warms the
// sea, vapour rises (invisible, drawn as dotted arrows), cools into a cloud of tiny drops, falls
// as rain and returns to the sea. Transpiration and run-off are optional flows.
// Ported from the north-star water cycle onto the kit.
import {
  h, T, bez, overlaps, measure, GRID,
  textBlock, arrow, wavyD, headD, object, sky,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { cloud } from '../kit/batch-F.js';

export const meta = {
  id: 'water_cycle', name: 'The water cycle', kind: 'scene', version: 1,
  subjects: ['Science', 'Geography'],
  years: ['Y4', 'Y5', 'Y6'],
  teaches: 'How the same water goes round and round: it evaporates from the sea, condenses into clouds, falls as rain and flows back to the sea.',
};

const FLOW_IDS = ['evaporation', 'transpiration', 'condensation', 'precipitation', 'runoff', 'collection'];
const CORE = ['evaporation', 'condensation', 'precipitation', 'collection'];
const flag = (title, def, description) => ({ type: 'boolean', title, default: def, description });

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'The water cycle',
  properties: {
    title: TITLE_PARAM('The water cycle'),
    vocabulary: { type: 'string', title: 'Words used', enum: ['everyday', 'science', 'explained'],
      'x-labels': ['Everyday words (vapour rises, rain falls)', 'Science words (evaporation, condensation…)', 'Science words, explained in the captions'], default: 'science' },
    landscape: { type: 'string', title: 'Landscape', enum: ['hills', 'town'], 'x-labels': ['Sea and hills', 'A town by the sea'], default: 'hills' },
    flows: {
      type: 'object', title: 'What the water does', description: 'The four main stages close the cycle. Turn one off to show only part of it. Plants and run-off are extra.',
      default: { evaporation: true, transpiration: false, condensation: true, precipitation: true, runoff: false, collection: true },
      properties: {
        evaporation: flag('Evaporation (water vapour rises from the sea)', true),
        transpiration: flag('Transpiration (water from plants’ leaves)', false),
        condensation: flag('Condensation (clouds form)', true),
        precipitation: flag('Precipitation (rain)', true),
        runoff: flag('Run-off (rain flows over the ground)', false),
        collection: flag('Collection (rivers return water to the sea)', true),
      },
    },
    sunStep: { type: 'boolean', title: 'Start with the Sun warming the sea', default: true },
    numbered: { type: 'boolean', title: 'Number the stages', default: true },
    // stage names are labels: their overrides take the label cap, so a renamed stage still fits as a card
    text: TEXT_PARAM_FOR(Object.fromEntries(FLOW_IDS.map(id => [id, 'label']))),
  },
};

export const presets = [
  { id: 'y4-where-rain-comes-from', name: 'Year 4: where rain comes from', params: {
    title: 'Where does rain come from?', vocabulary: 'everyday', landscape: 'hills',
  } },
  { id: 'y4-water-cycle', name: 'Year 4: the water cycle', params: {
    title: 'The water cycle', vocabulary: 'science', landscape: 'hills',
  } },
  { id: 'y6-town', name: 'Year 6: the water cycle in a town', params: {
    title: 'The water cycle in a town', vocabulary: 'explained', landscape: 'town',
    flows: { evaporation: true, transpiration: true, condensation: true, precipitation: true, runoff: true, collection: true },
  } },
];

/* ------------------------------------------------------------------ words */
const NAMES = {
  everyday: { evaporation: 'Water vapour rises', transpiration: 'Water from leaves', condensation: 'Clouds form', precipitation: 'Rain falls', runoff: 'Water runs off', collection: 'Back to the sea' },
  science: { evaporation: 'Evaporation', transpiration: 'Transpiration', condensation: 'Condensation', precipitation: 'Precipitation', runoff: 'Run-off', collection: 'Collection' },
};
const nameOf = (P, id) => txt(P, `label:${id}`, NAMES[P.vocabulary === 'everyday' ? 'everyday' : 'science'][id]);

function caps(P) {
  const town = P.landscape === 'town', ev = P.vocabulary === 'everyday', ex = P.vocabulary === 'explained';
  return {
    sun: 'The Sun warms the water in the sea.',
    evaporation: ev ? 'The warm water slowly turns into water vapour and rises. You can’t see it.'
      : ex ? 'Evaporation: warm water turns into water vapour, an invisible gas, without boiling.'
      : 'Evaporation: warm water turns into water vapour and rises. You can’t see it.',
    transpiration: ev ? 'Plants take up water through their roots and give it off from their leaves.'
      : 'Transpiration: plants take up water and give off water vapour from their leaves.',
    condensation: ev ? 'High up the air is cold, so the vapour turns into clouds of tiny drops.'
      : 'Condensation: high up, the cold air cools the vapour into clouds of tiny drops.',
    precipitation: ev ? 'The tiny drops join, get heavy and fall as rain.' : 'Precipitation: the drops join, get heavy and fall as rain.',
    runoff: town ? (ev ? 'Rain runs off roofs and roads into drains and rivers.' : 'Run-off: rain runs off roofs and roads into drains, because it can’t soak in.')
      : (ev ? 'Rain runs over the ground and downhill into streams.' : 'Run-off: rain runs over the ground and downhill into streams.'),
    collection: ev ? 'Rivers carry the water back to the sea, and it all starts again.' : 'Collection: rivers carry the water back to the sea, and the cycle starts again.',
  };
}

/* ------------------------------------------------------------------ validate */
const WHY = {
  evaporation: 'Without evaporation the slide does not show how water gets from the sea into the air, so the cycle is not closed.',
  condensation: 'Without condensation the slide does not show how clouds form, so the cycle is not closed. The cloud is still drawn if it rains.',
  precipitation: 'Without precipitation the slide does not show the water coming back down, so the cycle is not closed.',
  collection: 'Without collection the slide does not show the water getting back to the sea, so the cycle is not closed.',
};
const closed = P => CORE.every(id => P.flows && P.flows[id]);
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  // a missing main stage leaves the cycle open: allowed (part of the cycle is a fair lesson), but say so
  for (const id of CORE) if (!P.flows[id]) W.push({ path: `flows.${id}`, reason: WHY[id] });
  if (!FLOW_IDS.some(id => P.flows[id])) R.push({ path: 'flows.evaporation', reason: 'Turn on at least one thing the water does, such as evaporation, so there is something to show.' });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const C = caps(P); const on = id => !!(P.flows && P.flows[id]);
  const keys = [...(P.sunStep ? ['sun'] : []), ...FLOW_IDS.filter(on)];
  const procs = FLOW_IDS.filter(on);
  return { keys, procs, steps: keys.map(key => ({ key, caption: C[key] })),
    summary: !closed(P) ? 'This is part of the water cycle. Ask: where does the water go next?'
      : P.vocabulary === 'everyday' ? 'The same water goes round and round. It is never used up.' : 'The same water goes round and round: it is never made or used up.' };
}
export function builds(P) { const p = plan(P); return { steps: p.steps, summary: { caption: p.summary } }; }

export function notes(P) {
  const town = P.landscape === 'town';
  const N = {
    sun: 'The Sun’s heat is the energy that drives the whole cycle. Ask: what is the Sun doing to the sea?',
    evaporation: 'Water vapour is an invisible gas: the dotted arrows show where it goes, not what it looks like. Evaporation happens without boiling, faster when it is warm: puddles dry up on a sunny day.',
    transpiration: 'Plants draw water up from their roots and lose it as vapour through tiny holes in their leaves. Most of the vapour still comes from the sea.',
    condensation: 'Clouds are not vapour: they are billions of tiny drops of liquid water (or ice crystals), made as rising air cools. Link: breath on a cold window.',
    precipitation: 'Precipitation means water falling from clouds: rain, snow, sleet or hail. Drops fall when they join up and get too heavy to float.',
    runoff: town ? 'Roofs and roads don’t let water soak in, so more runs off into drains. Ask: why do towns flood after heavy rain?' : 'Some rain soaks into the ground; the rest runs downhill into streams and rivers.',
    collection: 'Rivers carry the water downhill to the sea; some is stored for a while in lakes, ice and underground. The picture is not to scale (clouds are really much higher): real trips round the cycle take from days to thousands of years.',
  };
  return { steps: plan(P).keys.map(k => N[k]), summary: !closed(P) ? 'Only part of the cycle is shown. Ask the class which stages are missing and what happens to the water there.' : 'Ask the class to follow one drop all the way round. None of the water is made or used up: the same water has gone round for millions of years.' };
}

/* ------------------------------------------------------------------ scene geometry */
// Vapour from the sea: cubic paths [start, c1, c2, end], ending at the cloud's right side.
const VAPOUR = [[[860, 536], [860, 420], [790, 304], [694, 268]], [[940, 540], [940, 400], [850, 282], [702, 242]], [[1020, 544], [1020, 380], [920, 252], [708, 214]]];
const LAND = {
  hills: {
    trees: [[64, 614, .95], [132, 604, 1], [198, 600, .9]],
    leafTops: [[64, 538], [132, 522], [198, 530]],
    river: 'M 470 470 C 510 530, 560 545, 600 575 S 690 640, 770 612',
    riverSegs: [[[470, 470], [510, 530], [560, 545], [600, 575]], [[600, 575], [640, 605], [690, 640], [770, 612]]],
    rain: { x0: 452, rows: 4, cols: 6, floor: x => Math.min(436, 290 + (x - 300) * .881 - 34) },
    runoff: [[[362, 470], [400, 500], [440, 532]], [[372, 552], [412, 584], [452, 616]]],
    cards: {
      evaporation: [[950, 600], [1010, 600], [1090, 610]],
      transpiration: [[176, 392], [190, 404], [200, 380]],
      condensation: [[850, 150], [880, 140], [860, 170]],
      precipitation: [[236, 210], [236, 180], [210, 250]],
      runoff: [[396, 604], [380, 610], [300, 604]],
      collection: [[724, 470], [700, 452], [560, 470]],
    },
  },
  town: {
    trees: [[44, 446, .8], [100, 430, .85], [156, 426, .8]],
    leafTops: [[44, 384], [100, 366], [156, 364]],
    // a simple river from the hill foot, passing left of the road, along the front and into the sea
    river: 'M 318 500 C 326 550, 332 600, 380 630 S 560 652, 690 640',
    riverSegs: [[[318, 500], [326, 550], [332, 600], [380, 630]], [[380, 630], [428, 660], [560, 652], [690, 640]]],
    // rain lands on the roofs: each drop stops at the roof line under it
    rain: { x0: 452, rows: 6, cols: 6, oh: 240, floor: x => { const r = roofY(x); return r == null ? 554 : r - 22; } },
    // run-off: down from the roofs to the road, then along the road to the drain by the river
    runoff: [[[366, 540], [366, 574]], [[455, 540], [455, 574]], [[545, 540], [545, 574]], [[600, 588], [364, 588]]],
    cards: {
      evaporation: [[1000, 600], [1090, 610], [1100, 430]],
      transpiration: [[160, 505], [170, 520], [180, 490]],
      condensation: [[850, 150], [880, 140], [860, 170]],
      precipitation: [[236, 168], [250, 180], [236, 200]],
      runoff: [[200, 592], [200, 616], [210, 570]],
      collection: [[744, 600], [800, 624], [724, 470]],
    },
  },
};

function drawLandscape(root, ctx, P, L) {
  const g = h('g', {}, root);
  sky(g, ctx, 660);
  h('circle', { cx: 1150, cy: 168, r: 54, fill: 'var(--sun)', cls: 'body' }, g);
  // far planes (towards haze)
  h('path', { d: 'M380 520 Q 520 470 640 498 Q 760 440 880 476 Q 1000 428 1120 466 Q 1210 444 1280 452 V 660 H 380 Z', fill: 'var(--hill-far)' }, g);
  h('path', { d: 'M0 420 L 110 340 L 200 392 L 0 560 Z', fill: 'var(--hill-far)' }, g);
  if (P.landscape === 'town') {
    h('path', { d: 'M0 446 Q 110 376 230 420 Q 330 458 430 548 L 430 660 H 0 Z', fill: 'var(--hill-mid)' }, g);
    h('path', { d: 'M0 446 Q 60 408 118 398 L 60 660 H 0 Z', fill: 'var(--hill-shade)' }, g);
    h('path', { d: 'M0 548 Q 300 536 560 540 Q 660 542 720 560 L 760 660 H 0 Z', fill: 'var(--hill-near)' }, g);
  } else {
    h('path', { d: 'M 420 660 Q 520 506 640 500 Q 700 498 760 505 V 660 Z', fill: 'var(--hill-mid)' }, g);
  }
  return g;
}
function drawSea(g, P) {
  h('path', { d: 'M 610 660 Q 660 520 740 505 H 1280 V 660 Z', fill: 'var(--sea-1)' }, g);
  h('path', { d: 'M 660 660 Q 700 566 790 556 H 1280 V 660 Z', fill: 'var(--sea-2)' }, g);
  h('path', { d: 'M 720 660 Q 750 616 830 608 H 1280 V 660 Z', fill: 'var(--sea-3)' }, g);
  for (const [x, y, w] of [[1060, 530, 56], [1190, 524, 40], [1000, 580, 48], [1150, 590, 54]]) h('line', { x1: x, y1: y, x2: x + w, y2: y, stroke: 'var(--sea-hi)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
}
function drawMountain(g) {
  // lit face and shaded face are two flat planes; snow on the top
  h('polygon', { points: '0,560 300,290 380,660 0,660', fill: 'var(--hill-shade)' }, g);
  h('polygon', { points: '300,290 720,660 380,660', fill: 'var(--hill-mid)' }, g);
  h('polygon', { points: '300,290 258,334 282,327 300,342', fill: 'var(--cloud-shade)' }, g);
  h('polygon', { points: '300,290 300,342 320,328 343,332', fill: 'var(--cloud)' }, g);
  h('path', { d: 'M0 612 Q 200 572 420 614 Q 520 634 590 660 H 0 Z', fill: 'var(--hill-near)' }, g);
}
const HOUSES = [410, 500, 590], HS = 1.15;
/* the roof line at x (null if no roof there) */
function roofY(x) { let y = null; for (const cx of HOUSES) { const d = Math.abs(x - cx); if (d <= 38 * HS) { const ry = 576 + (-70 + d * 32 / 38) * HS; y = y == null ? ry : Math.min(y, ry); } } return y; }
function drawTown(g) {
  // the road stops short of the sea; a drain at its left end lets water into the river
  h('rect', { x: 344, y: 578, width: 290, height: 20, fill: 'var(--road)' }, g);
  h('line', { x1: 380, x2: 626, y1: 588, y2: 588, stroke: 'var(--road-line)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '18 16' }, g);
  h('rect', { x: 346, y: 581, width: 16, height: 14, rx: 2, fill: 'var(--hull)' }, g);
  for (const yy of [585, 591]) h('line', { x1: 348, x2: 360, y1: yy, y2: yy, stroke: 'var(--road-line)', 'stroke-width': 'var(--sw-hair)' }, g);
  for (const x of HOUSES) object(g, 'house', x, 576, HS);
}

/* a cubic path sampled into small boxes, so labels keep off it */
const pathBoxes = (pts, n = 16) => Array.from({ length: n + 1 }, (_, i) => { const [x, y] = bez(...pts, i / n); return { x: x - 8, y: y - 8, w: 16, h: 16 }; });
const lineBoxes = (pts) => pts.slice(1).flatMap((q, i) => { const p = pts[i]; return Array.from({ length: 9 }, (_, j) => { const x = p[0] + (q[0] - p[0]) * j / 8, y = p[1] + (q[1] - p[1]) * j / 8; return { x: x - 8, y: y - 8, w: 16, h: 16 }; }); });

/** A stage label: paper card, optional number badge and the name (an optional gloss line is supported but unused).
 *  Wraps then shrinks on a long edit. Returns {g, place(cx, cy), w, h}. */
function card(ctx, root, { num, numPath, name, nameEdit, gloss, glossEdit, a, maxW = 320, maxLines = 3, cls = 'ts-label' }) {
  const outer = h('g', a, root); const g = h('g', {}, outer);
  // the minimum text size gets a slimmer card, so a busy slide has room for every stage
  const small = cls === 'ts-tiny', padX = small ? 14 : 18, padY = small ? 6 : 10, badge = num ? (small ? 34 : 38) : 0;
  // a long hyphenated word may break after a hyphen (the hyphen stays at the line end, nothing is lost)
  const raw = String(name).trim().replace(/\s+/g, ' '), hyph = !/- /.test(raw) && /-(?=\S)/.test(raw);
  const tn = textBlock(g, 0, 0, hyph ? raw.replace(/-(?=\S)/g, '- ') : raw, { cls, maxW, maxLines, lh: cls === 'ts-label' ? 34 : 28, a: { fill: 'var(--ink)' }, edit: nameEdit });
  if (hyph) { tn.lines = tn.lines.map(l => l.replace(/- /g, '-')); const ts = tn.el.querySelectorAll('tspan');
    if (ts.length) ts.forEach((t, i) => { t.textContent = tn.lines[i]; }); else tn.el.textContent = tn.lines[0];
    tn.w = Math.max(0, ...tn.lines.map(l => measure(g, l, tn.cls, { fill: 'var(--ink)' }))); }
  const tg = gloss ? textBlock(g, 0, 0, gloss, { cls: 'ts-small', maxW: 360, maxLines: 2, lh: 28, edit: glossEdit }) : null;
  const w = Math.max(badge + tn.w, tg ? tg.w : 0) + padX * 2, hh = padY * 2 + tn.h + (tg ? tg.h + 2 : 0);
  const bg = h('rect', { x: 0, y: 0, width: w, height: hh, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)', cls: 'lift body' });
  g.insertBefore(bg, g.firstChild);
  const base = padY + (tn.cls === 'ts-tiny' ? 19 : 25);
  tn.el.setAttribute('x', padX + badge); tn.el.setAttribute('y', base); tn.el.querySelectorAll('tspan').forEach(s => s.setAttribute('x', padX + badge));
  if (tg) { const y = padY + tn.h + 22; tg.el.setAttribute('x', padX); tg.el.setAttribute('y', y); tg.el.querySelectorAll('tspan').forEach(s => s.setAttribute('x', padX)); }
  if (num) { const cy = padY + (tn.cls === 'ts-tiny' ? 12 : 17); h('circle', { cx: padX + 14, cy, r: small ? 13 : 15, fill: 'var(--water)' }, g); computed(T(g, padX + 14, cy + 7.5, num, 'ts-badge', { 'text-anchor': 'middle' }), numPath); }
  const trunc = /…$/.test(tn.lines[tn.lines.length - 1]) && !/…$/.test(raw);
  // a word broken between letters (not after a hyphen) counts as cut: the fit tries a wider card first
  const joined = tn.lines.join(' ').replace(hyph ? /- /g : /$^/, '-');
  return { g: outer, w, h: hh, trunc, cut: trunc || joined !== raw, cls: tn.cls, place(cx, cy) { const x = cx - w / 2, y = cy - hh / 2; g.setAttribute('transform', `translate(${x} ${y})`); return { x, y, w, h: hh }; } };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { procs } = plan(P); const b = ctx.b; const town = P.landscape === 'town'; const L = LAND[P.landscape] || LAND.hills;
  const on = id => procs.includes(id); const bi = k => b[k];
  // after its build a flow steps back to soft (still readable), including the summary, so the recap is calm
  const soft = id => ctx.rc(id, ctx.N + 1, 'soft');
  const g = drawLandscape(root, ctx, P, L);
  if (!town) drawMountain(g);
  const obstacles = [];

  // the river (collection) is drawn under the sea, so it reads as flowing into it
  if (on('collection')) {
    const k = bi('collection');
    const rv = h('g', { c: soft('collection') }, g);
    h('path', { d: L.river, fill: 'none', stroke: 'var(--water)', 'stroke-width': 12, 'stroke-linecap': 'round', cls: 'draw', pathLength: 1, s: k }, rv);
    h('path', { d: L.river, fill: 'none', stroke: 'var(--water-hi)', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': '14 26', cls: 'rflow', s: k, delay: 500 }, rv);
  }
  if (town) drawTown(g);
  drawSea(g, P);

  // trees for transpiration (only when plants are part of the lesson)
  if (on('transpiration')) for (const [x, y, s] of L.trees) object(g, 'tree', x, y, s);

  // the Sun warms the sea: wavy heat arrows; they step back once evaporation starts
  if (P.sunStep) {
    const k = bi('sun');
    for (const [x1, y1, x2, y2] of [[1112, 236, 1062, 526], [1166, 244, 1160, 530]])
      arrow(ctx, g, wavyD(x1, y1, x2, y2, 7, 4), x2, y2, Math.atan2(y2 - y1, x2 - x1), 'var(--heat)', 'var(--sw-struct)', { draw: k, k: .8, g: { c: soft('sun') } });
    obstacles.push({ x: 1050, y: 236, w: 130, h: 300 });
  }
  obstacles.push({ x: 1086, y: 104, w: 128, h: 128 });

  // vapour: invisible, so it is drawn as dotted arrows (where it goes, not what it looks like)
  const vapour = (paths, id) => {
    const vg = h('g', { s: bi(id), cls: 'rise', c: soft(id) }, g);
    for (const [a0, c1, c2, d] of paths) {
      h('path', { d: `M${a0} C${c1} ${c2} ${d}`, fill: 'none', stroke: 'var(--vapour)', 'stroke-width': 'calc(var(--sw-arrow) + 2px)', 'stroke-linecap': 'round', 'stroke-dasharray': '0.1 18', cls: 'vflow' }, vg);
      { const ang = Math.atan2(d[1] - c2[1], d[0] - c2[0]); h('path', { d: headD(d[0] + Math.cos(ang) * 4, d[1] + Math.sin(ang) * 4, ang, ctx.tk.head * .9), fill: 'var(--vapour)' }, vg); }
      obstacles.push(...pathBoxes([a0, c1, c2, d]));
    }
  };
  if (on('evaporation')) vapour(VAPOUR, 'evaporation');
  if (on('transpiration')) vapour(L.leafTops.map(([x, y]) => [[x, y], [x - 12, y - 24], [x + 12, y - 46], [x, y - 70]]), 'transpiration');

  // rain under the cloud (drawn before the cloud so the cloud sits on top)
  if (on('precipitation')) {
    const rain = h('g', { s: bi('precipitation'), cls: 'rise', c: soft('precipitation') }, g); const R = L.rain;
    for (let c = 0; c < R.cols; c++) for (let r = 0; r < R.rows; r++) {
      const x = R.x0 + c * 30, y = 290 + r * 44 + (c % 2) * 22;
      if (y > R.floor(x)) continue;
      h('line', { x1: x, y1: y, x2: x - 4, y2: y + 22, stroke: 'var(--water)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', cls: 'drop', vars: { '--rd': ((c * .37 + r * .21) % .85).toFixed(2) + 's' } }, rain);
    }
    obstacles.push({ x: R.x0 - 12, y: 280, w: R.cols * 30 + 8, h: R.oh || 160 });
  }
  // run-off: short arrows over the ground
  if (on('runoff')) {
    const rg = h('g', { s: bi('runoff'), cls: 'rise', c: soft('runoff') }, g);
    L.runoff.forEach((pts, i) => {
      const n = pts.length, [xa, ya] = pts[n - 2], [xb, yb] = pts[n - 1], ang = Math.atan2(yb - ya, xb - xa);
      arrow(ctx, rg, 'M' + pts.map(p => p.join(' ')).join(' L '), xb, yb, ang, 'var(--water)', 'var(--sw-arrow)', { draw: bi('runoff'), delay: 200 + i * 200, k: .8 });
      obstacles.push(...lineBoxes(pts));
    });
  }
  // the cloud (condensation): two flat planes
  if (on('condensation') || on('precipitation')) {
    cloud(g, 558, 214, 1.45, { s: bi(on('condensation') ? 'condensation' : 'precipitation'), cls: 'pop' });
    obstacles.push({ x: 428, y: 112, w: 266, h: 172 });
  }

  // not to scale: the explanation lives in the notes (the tag was chrome that did not teach)
  if (P.title) obstacles.push({ x: 56, y: 30, w: measure(root, P.title, 'ts-title') + 16, h: 64 });

  // things a card must not hide (cards are opaque): the flows, the rain, the cloud, the river, the Sun,
  // and the scenery the lesson draws on purpose (trees for transpiration, the houses, the snowy peak).
  // Plain hillside and sea are ground, so a card may sit on them.
  if (on('collection')) for (const seg of L.riverSegs) obstacles.push(...pathBoxes(seg, 12));
  if (town) for (const x of HOUSES) obstacles.push({ x: x - 40, y: 498, w: 80, h: 74 });
  else obstacles.push({ x: 252, y: 282, w: 96, h: 66 });
  if (on('transpiration')) for (const [x, y, s] of L.trees) obstacles.push({ x: x - 34 * s, y: y - 96 * s, w: 68 * s, h: 96 * s });

  // where each card points: points on the mark it names (a leader line runs to the nearest one when
  // the card cannot sit right beside its mark, so every card is tied to its own flow)
  const R = L.rain, rainBottom = town ? 470 : 400;
  const ANCHORS = {
    evaporation: VAPOUR.flatMap(pts => [.12, .3, .5].map(t => bez(...pts, t))),
    transpiration: L.leafTops.flatMap(([x, y]) => [[x, y - 70], [x, y - 36]]),
    condensation: [[686, 232], [640, 170], [590, 150], [500, 142], [446, 200], [434, 236]],
    precipitation: [[R.x0, 320], [R.x0, 360], [R.x0 + 150, 320], [R.x0 + 150, 360], [R.x0 + 60, rainBottom], [R.x0, rainBottom - 40]],
    runoff: L.runoff.map(pts => { const a = pts[0], z = pts[pts.length - 1]; return [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2]; }),
    collection: L.riverSegs.flatMap(seg => [.2, .5, .8].map(t => bez(...seg, t))),
  };
  const gapTo = (bx, [ax, ay]) => Math.hypot(Math.max(bx.x - ax, 0, ax - bx.x - bx.w), Math.max(bx.y - ay, 0, ay - bx.y - bx.h));
  const nearestAnchor = (id, bx) => { let best = null, bd = Infinity; for (const a of ANCHORS[id]) { const d = gapTo(bx, a); if (d < bd) { bd = d; best = a; } } return [best, bd]; };
  const TOUCH = 30, HAND = 60; // closer than this, the card reads as beside its mark and needs no leader
  // the leader: from the nearest point of the card's edge to the anchor, as sample boxes
  const leaderOf = (bx, a) => { const ex = Math.min(bx.x + bx.w, Math.max(bx.x, a[0])), ey = Math.min(bx.y + bx.h, Math.max(bx.y, a[1])); return [[ex, ey], a]; };
  // two leaders that cross read as a tangle: a spot whose leader would cross another is not used
  const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const crosses = ([a, b], [c, d]) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  const leaderBoxes = ([[x1, y1], [x2, y2]]) => { const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 10)); return Array.from({ length: n - 1 }, (_, i) => { const u = (i + 1) / n; return { x: x1 + (x2 - x1) * u - 3, y: y1 + (y2 - y1) * u - 3, w: 6, h: 6 }; }); };

  // stage cards. Every card on a slide uses one text size (the full label size, or the minimum size for
  // all of them if the full size cannot fit). The fit for each card, in order: its own spots (nudged), then
  // the free spot closest to its mark, with a leader line when it is not right beside it. A card never
  // covers a flow, the rain, the cloud, the river, the trees, the houses, another card or another card's
  // leader, and its leader never crosses another card. Each pass is scored (cards without room, cards far
  // from their mark, then total distance) and the best pass is kept.
  const X0 = GRID.left, X1 = GRID.right, Y0 = 96, Y1 = GRID.bottom, REACH = 240, STEP = 12;
  const NUDGE = [[0, 0], [0, -24], [0, 24], [-40, 0], [40, 0], [-80, 0], [80, 0], [0, -48], [0, 48], [-120, 0], [120, 0], [-40, -48], [40, -48], [-40, 48], [40, 48]];
  // [maxW, maxLines]: the card wraps at its tier's size; a size that would need shrinking is skipped
  const SIZES = [[320, 3], [260, 3], [420, 2], [220, 4], [520, 2], [420, 1], [180, 5], [520, 1], [800, 1]];
  const COMPACT = [[420, 1], [320, 2], [520, 1], [260, 3], [220, 4], [800, 1], [180, 5]];
  // narrower wraps for the keyed last resort (whole words only: a word is never broken between letters)
  const NARROW = [[240, 4], [200, 5], [160, 6]];
  const inLive = bx => bx.x >= X0 && bx.x + bx.w <= X1 && bx.y >= Y0 && bx.y + bx.h <= Y1;
  const clampC = (cx, cy, c) => [Math.min(X1 - c.w / 2, Math.max(X0 + c.w / 2, cx)), Math.min(Y1 - c.h / 2, Math.max(Y0 + c.h / 2, cy))];
  const boxAt = (cx, cy, c) => ({ x: cx - c.w / 2, y: cy - c.h / 2, w: c.w, h: c.h });
  const make = (id, [maxW, maxLines], cls, num = P.numbered) => Object.assign(card(ctx, root, { num: num ? String(procs.indexOf(id) + 1) : null, numPath: `flows.${id}`, name: nameOf(P, id), nameEdit: `text.label:${id}`,
    a: { s: bi(id), cls: 'rise', delay: 300, c: ctx.rc(id, null, 'quiet') }, maxW, maxLines, cls }), { id, num: String(procs.indexOf(id) + 1) });
  // gap: clear air between two cards (wide first, so six stages read as six cards; narrower only if needed)
  const placeAll = (order, sizes, cls, GAP = 24) => {
    const placed = [], cards = [], leads = [], segs = [], stuck = [], far = [], keyed = []; let total = 0, cut = 0;
    // a spot: free of marks, cards and leaders; its leader (if any) crosses no card. Returns its cost or null.
    // the point on the mark this spot ties to: the nearest one whose leader keeps clear of every card
    // placed so far (a far point on the same flow beats no leader at all). Returns [anchor, gap, cost] or null.
    const pick = (id, bx) => {
      const byGap = ANCHORS[id].map(a => [a, gapTo(bx, a)]).sort((p, q) => p[1] - q[1]);
      if (byGap[0][1] <= TOUCH) return [byGap[0][0], byGap[0][1], byGap[0][1]];
      for (const [a, d] of byGap) {
        const ln = leaderOf(bx, a), lb = leaderBoxes(ln);
        if (lb.some(q => placed.some(p => overlaps(q, p, 10)) || leads.some(p => overlaps(q, p, 8))) || segs.some(sg => crosses(sg, ln))) continue;
        // a leader may pass over scenery, but one that runs across other flows is a poorer choice
        return [a, d, d + 30 * lb.filter(q => obstacles.some(o => overlaps(q, o, 0))).length];
      }
      return null;
    };
    const costAt = (id, bx) => {
      if (!inLive(bx) || placed.some(q => overlaps(bx, q, GAP)) || obstacles.some(o => overlaps(bx, o, 2)) || leads.some(q => overlaps(bx, q, 10))) return null;
      const pk = pick(id, bx); return pk ? pk[2] : null;
    };
    for (const id of order) {
      const near = c => { for (const [cx, cy] of L.cards[id]) for (const [dx, dy] of NUDGE) { const [x, y] = clampC(cx + dx, cy + dy, c); if (costAt(id, boxAt(x, y, c)) != null) { c.hand = true; return [x, y]; } } return null; };
      const scan = c => { let best = null, bk = Infinity;
        for (let x = X0 + c.w / 2; x <= X1 - c.w / 2; x += STEP) for (let y = Y0 + c.h / 2; y <= Y1 - c.h / 2; y += STEP) {
          const k = costAt(id, boxAt(x, y, c)); if (k != null && k < bk) { bk = k; best = [x, y]; } }
        return best; };
      let c = null, at = null;
      for (const [finder, tiers, split] of [[near, sizes, false], [scan, sizes, false]]) {
        for (const sz of tiers) { c && c.g.remove(); c = make(id, sz, cls); if (c.cls !== cls || c.trunc || (c.cut && !split)) continue; at = finder(c); if (at) break; }
        if (at) break;
      }
      // no spot whose leader is clear: the card goes in the free spot nearest its mark and carries its
      // stage number, and the same number sits on the mark as a badge (a key, so it still reads as tied)
      if (!at) {
        const free = bx => inLive(bx) && !placed.some(q => overlaps(bx, q, GAP)) && !obstacles.some(o => overlaps(bx, o, 2)) && !leads.some(q => overlaps(bx, q, 10));
        const spots = ANCHORS[id].filter(([ax, ay]) => !placed.some(q => overlaps({ x: ax - 18, y: ay - 18, w: 36, h: 36 }, q, 4)));
        if (spots.length) for (const sz of [...sizes, ...NARROW]) {
          c && c.g.remove(); c = make(id, sz, cls, true); if (c.cls !== cls || c.cut) continue;
          let bk = Infinity;
          for (let x = X0 + c.w / 2; x <= X1 - c.w / 2; x += STEP) for (let y = Y0 + c.h / 2; y <= Y1 - c.h / 2; y += STEP) {
            const bx = boxAt(x, y, c); if (spots.some(([ax, ay]) => overlaps(bx, { x: ax - 18, y: ay - 18, w: 36, h: 36 }, 6)) || !free(bx)) continue;
            const d = Math.min(...spots.map(a => gapTo(bx, a))); if (d < bk) { bk = d; at = [x, y]; } }
          if (at) { const bx = boxAt(at[0], at[1], c); c.key = spots.reduce((m, a) => gapTo(bx, a) < gapTo(bx, m) ? a : m); keyed.push(id); break; }
        }
      }
      if (!at) { // nothing is clear: the least crowded spot over every whole-word size (a warning says so)
        const hits = bx => (placed.filter(q => overlaps(bx, q, GAP)).length + leads.filter(q => overlaps(bx, q, 4)).length) * 1e3 + obstacles.filter(o => overlaps(bx, o, 2)).length + (inLive(bx) ? 0 : 1e6);
        let best = null, bh = Infinity, bsz = sizes[0];
        for (const sz of [...sizes, ...NARROW]) {
          c && c.g.remove(); c = make(id, sz, cls); if (c.cls !== cls || c.cut) continue;
          for (let x = X0 + c.w / 2; x <= X1 - c.w / 2; x += STEP) for (let y = Y0 + c.h / 2; y <= Y1 - c.h / 2; y += STEP) { const bx = boxAt(x, y, c), n = hits(bx) * 1e4 + nearestAnchor(id, bx)[1]; if (n < bh) { bh = n; best = [x, y]; bsz = sz; } }
        }
        c && c.g.remove(); c = make(id, bsz, cls);
        at = best || clampC(L.cards[id][0][0], L.cards[id][0][1], c);
        // a clear spot whose leader is merely long or crowded still reads; only a covering card is stuck
        if (!best || bh >= 1e4) stuck.push(id); else far.push(id);
      }
      const bx = c.place(at[0], at[1]); const pk = pick(id, bx), [a, d] = pk || nearestAnchor(id, bx);
      if (d > REACH && !c.key && !far.includes(id)) far.push(id);
      total += pk ? pk[2] : d; // a leader across the rain or another flow counts against the layout
      if (c.cut) cut++;
      // a hand-picked spot sits beside its mark already; any other spot farther than a touch gets a leader
      if (c.key) leads.push({ x: c.key[0] - 18, y: c.key[1] - 18, w: 36, h: 36 });
      else if (d > (c.hand ? HAND : TOUCH)) { const ln = leaderOf(bx, a); leads.push(...leaderBoxes(ln)); segs.push(ln); c.lead = ln; }
      placed.push(bx); cards.push(c);
    }
    return { cards, stuck, far, score: (GAP < 24 ? 3e3 : 0) + stuck.length * 1e6 + far.length * 1e4 + keyed.length * 5e4 + cut * 2e4 + (cls === 'ts-label' ? 0 : 5e3) + total / 10 };
  };
  // greedy order at full size first; while any card lacks room or sits far from its mark, retry with
  // each card first and the reverse order, compact sizes, then the same at the minimum size; keep the best
  let run = placeAll(procs, SIZES, 'ts-label');
  const good = r => !r.stuck.length && !r.far.length && !r.cards.some(c => c.cut || c.key);
  // plus the most hemmed-in marks first (run-off, rain and river sit among the scenery)
  const TIGHT = ['runoff', 'precipitation', 'collection', 'transpiration', 'condensation', 'evaporation'];
  const orders = [...procs.map((id, i) => [...procs.slice(i), ...procs.slice(0, i)]), [...procs].reverse(), TIGHT.filter(on)];
  if (!good(run)) for (const cls of ['ts-label', 'ts-tiny']) for (const gap of [24, 18]) for (const sizes of [SIZES, COMPACT]) {
    if (cls === 'ts-tiny' && good(run)) break; // the full size already fits: keep it on every card
    for (const order of orders) {
      run.cards.forEach(c => c.g.setAttribute('display', 'none'));
      const t = placeAll(order, sizes, cls, gap);
      if (t.score < run.score) { run.cards.forEach(c => c.g.remove()); run = t; } else { t.cards.forEach(c => c.g.remove()); }
      run.cards.forEach(c => c.g.removeAttribute('display'));
    }
  }
  // leaders: a thin line from the card's edge to a dot on its mark, under the card, built with it
  for (const c of run.cards) if (c.key) {
    const [x, y] = c.key;
    const kg = h('g', {}, c.g); h('circle', { cx: x, cy: y, r: 15, fill: 'var(--water)', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)' }, kg);
    computed(T(kg, x, y + 7.5, c.num, 'ts-badge', { 'text-anchor': 'middle' }), `flows.${c.id}`);
  }
  for (const c of run.cards) if (c.lead) {
    const [[x1, y1], [x2, y2]] = c.lead; const lg = h('g', {}, c.g); c.g.insertBefore(lg, c.g.firstChild);
    h('line', { x1, y1, x2, y2, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)', 'stroke-linecap': 'round' }, lg);
    h('circle', { cx: x2, cy: y2, r: 5, fill: 'var(--ink-2)' }, lg);
  }
  for (const id of run.stuck) ctx.warn(`No clear room for the label “${nameOf(P, id)}”. Shorten it or turn a stage off.`);
  return {};
}

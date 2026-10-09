// Colour mixing and tone: painting (subtractive) mixes on a painter's colour wheel, tints and
// shades as a paint-chart strip, and warm and cool halves of the wheel. One wheel layout serves
// mixing and warm/cool, so a class sees the same picture across years. Built on the kit and the
// batch H paint parts (PAINT, mix, swatch, paintFill). Paint only: light mixes differently.
import {
  h, GRID,
  textBlock, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { PAINT_PRIMARIES, WARM, COOL, mix, swatch, paintFill } from '../kit/batch-H.js';

export const meta = {
  id: 'colour_mixing', name: 'Colour mixing and tone', kind: 'info', version: 1,
  subjects: ['Art and design'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'How primary paints mix to make secondary colours, how adding white or black makes tints and shades, and which colours are warm or cool.',
};

const NAMES = { red: 'red', yellow: 'yellow', blue: 'blue', orange: 'orange', green: 'green', purple: 'purple', brown: 'brown', white: 'white', black: 'black' };
// a mix is one of the three pairs of different primaries, so a pair can never be a paint with itself
const PAIRS = ['red+yellow', 'yellow+blue', 'red+blue'];
const pairOf = s => (PAIRS.includes(s) ? s : PAIRS[0]).split('+');
// every label id's lane, so each override gets its kit word cap
const ROLES = Object.assign({ medium: 'label', 'mix:0': 'label', 'mix:1': 'label', 'mix:2': 'label', warm: 'label', cool: 'label', warmWhy: 'phrase', coolWhy: 'phrase', tints: 'phrase', shades: 'phrase' },
  Object.fromEntries(Object.keys({ red: 1, yellow: 1, blue: 1, orange: 1, green: 1, purple: 1, brown: 1, white: 1, black: 1 }).map(c => [`paint:${c}`, 'label'])));
const TONE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Colour mixing and tone',
  properties: {
    title: TITLE_PARAM('Mixing colours'),
    mode: { type: 'string', title: 'What the slide shows', enum: ['mix', 'tints-shades', 'warm-cool'],
      'x-labels': ['Mixing primary colours', 'Tints and shades', 'Warm and cool colours'], default: 'mix' },
    mixes: { type: 'array', title: 'Mixes', description: 'Two primary paints in each mix, shown one at a time. Used when the slide shows mixing.',
      minItems: 1, maxItems: 3,
      items: { type: 'object', title: 'Mix', default: { pair: 'red+yellow' }, properties: {
        pair: { type: 'string', title: 'Paints mixed', description: 'The colour they make is worked out from real paint.', enum: PAIRS,
          'x-labels': ['Red and yellow (makes orange)', 'Yellow and blue (makes green)', 'Red and blue (makes purple)'], default: 'red+yellow' },
      } },
      default: [{ pair: 'red+yellow' }, { pair: 'yellow+blue' }, { pair: 'red+blue' }] },
    allThree: { type: 'boolean', title: 'Then mix all three primaries (brown)', description: 'Two more steps after the mixes, used when the slide shows mixing.', default: false },
    colour: { type: 'string', title: 'Colour for tints and shades', enum: TONE, 'x-labels': ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Brown'], default: 'blue' },
    steps: { type: 'integer', title: 'Tint and shade steps', description: 'How many times a little more white (or black) is added.', minimum: 1, maximum: 4, default: 3 },
    strip: { type: 'string', title: 'Tints, shades or both', enum: ['both', 'tints', 'shades'], 'x-labels': ['Tints and shades', 'Tints only (add white)', 'Shades only (add black)'], default: 'both' },
    text: TEXT_PARAM_FOR(ROLES),
  },
};

export const presets = [
  { id: 'y1-orange-green-purple', name: 'Year 1: making orange, green and purple', params: {
    title: 'Making orange, green and purple', mode: 'mix',
    mixes: [{ pair: 'red+yellow' }, { pair: 'yellow+blue' }, { pair: 'red+blue' }] } },
  { id: 'y4-tints-shades', name: 'Year 4: tints and shades', params: {
    title: 'Tints and shades', mode: 'tints-shades', colour: 'blue', steps: 3, strip: 'both' } },
  { id: 'y6-warm-cool', name: 'Year 6: warm and cool colours', params: {
    title: 'Warm and cool colours', mode: 'warm-cool' } },
];

/* ------------------------------------------------------------------ wording */
const up = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const nm = (P, c) => txt(P, `label:paint:${c}`, NAMES[c]);
const listAnd = a => a.length < 2 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

function model(P) {
  const mode = P.mode || 'mix';
  // a pair already mixed is shown once (validate warns), so no slot is drawn twice
  const seen = new Set();
  const mixes = mode === 'mix' ? (P.mixes || []).map(m => pairOf(m.pair)).filter(([a, b]) => { const k = [a, b].sort().join('+'); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(([a, b]) => ({ a, b, res: mix(a, b) })) : [];
  const brown = mode === 'mix' && !!P.allThree;
  const n = P.steps || 3, strip = P.strip || 'both';
  return { mode, mixes, brown, n, tints: strip !== 'shades', shades: strip !== 'tints', colour: P.colour || 'blue' };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const Wn = [];
  if (R.length) return result(R);
  if (P.mode === 'mix') {
    const seen = {};
    P.mixes.forEach((m, i) => {
      const [a, b] = pairOf(m.pair);
      if (seen[m.pair] != null) Wn.push({ path: `mixes.${i}.pair`, reason: `${up(a)} and ${b} are already mixed in mix ${seen[m.pair] + 1}, so that mix is shown once. Choose a different pair, or take this mix out.` });
      else seen[m.pair] = i;
    });
  } else {
    if (P.allThree) Wn.push({ path: 'allThree', reason: 'Mixing all three primaries only shows when the slide shows mixing, so it is left out.' });
  }
  return result(R, Wn);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P); const items = [];
  if (M.mode === 'mix') {
    const prim = listAnd(PAINT_PRIMARIES.map(c => nm(P, c)));
    items.push({ key: 'primaries', caption: `${up(prim)} are the primary colours in paint. You cannot mix them from other paints.` });
    M.mixes.forEach((m, i) => {
      items.push({ key: `pour:${i}`, caption: `Mix ${nm(P, m.a)} paint with ${nm(P, m.b)} paint. What will it make?` });
      items.push({ key: `make:${i}`, caption: `${up(nm(P, m.a))} and ${nm(P, m.b)} paint make ${nm(P, m.res)}.` });
    });
    if (M.brown) {
      items.push({ key: 'pour:all', caption: `Now mix all three primary colours together.` });
      items.push({ key: 'brown', caption: `${up(prim)} together make ${nm(P, 'brown')}.` });
    }
    const made = M.mixes.map(m => nm(P, m.res));
    const summary = made.length > 1 ? `Two primary colours mixed together make a secondary colour: ${listAnd(made)}.`
      : `${up(nm(P, M.mixes[0].a))} and ${nm(P, M.mixes[0].b)} are primary colours. Mixed together they make ${made[0]}.`;
    return { M, items, summary };
  }
  if (M.mode === 'tints-shades') {
    const c = nm(P, M.colour);
    items.push({ key: 'base', caption: `Start with ${c} paint.` });
    if (M.tints) items.push({ key: 'tints', caption: `Add a little ${nm(P, 'white')} each time to make tints: lighter and lighter ${c}.` });
    if (M.shades) items.push({ key: 'shades', caption: `Add a little ${nm(P, 'black')} each time to make shades: darker and darker ${c}.` });
    const summary = M.tints && M.shades ? `Tints have ${nm(P, 'white')} added, so they are lighter. Shades have ${nm(P, 'black')} added, so they are darker.`
      : M.tints ? `Each tint has a little more ${nm(P, 'white')} than the one before, so it is lighter.` : `Each shade has a little more ${nm(P, 'black')} than the one before, so it is darker.`;
    return { M, items, summary };
  }
  items.push({ key: 'wheel', caption: 'A colour wheel: each secondary colour sits between the two primaries that make it.' });
  items.push({ key: 'warm', caption: `${up(listAnd(WARM.map(c => nm(P, c))))} are warm colours.` });
  items.push({ key: 'cool', caption: `${up(listAnd(COOL.map(c => nm(P, c))))} are cool colours.` });
  return { M, items, summary: 'Warm colours sit on one side of the colour wheel and cool colours on the other.' };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, items } = plan(P);
  const steps = items.map(it => {
    const k = it.key;
    if (k === 'primaries') return 'These are the painting primaries. Coloured light has different primaries (red, green and blue), so keep this to paint. Ask: can anyone make red by mixing?';
    if (k.startsWith('pour:') && k !== 'pour:all') return 'Pause here and ask the class to predict the colour before you show it. Mix roughly equal amounts.';
    if (k.startsWith('make:')) { const m = M.mixes[+k.split(':')[1]]; return `Real paints vary: more ${m.a} gives a ${m.a}dish ${m.res}, more ${m.b} a ${m.b}dish ${m.res}. Let children try different amounts.`.replace('reddish', 'redder').replace('yellowdish', 'yellower').replace('bluedish', 'bluer'); }
    if (k === 'pour:all') return 'Ask: what do you think happens when all three go in?';
    if (k === 'brown') return 'All three primaries make a brown or muddy colour. This is why mixing too many paints turns them dull.';
    if (k === 'base') return 'Start with the pure colour straight from the pot.';
    if (k === 'tints') return 'Add white a tiny bit at a time and mix well. Each chip outwards has a little more white than the one before. Pastel colours are tints.';
    if (k === 'shades') return 'Black is strong, so add only a speck at a time. Each chip outwards has a little more black than the one before.';
    if (k === 'wheel') return 'This is the painter’s wheel of primary and secondary colours. Opposite colours (like red and green) are complementary.';
    if (k === 'warm') return 'Warm colours remind us of fire and sunshine. Artists use them to make things feel close, hot or lively.';
    if (k === 'cool') return 'Cool colours remind us of water, grass and ice. They make things feel calm or far away. Some purples and greens can lean warm: this is the simple rule.';
    return '';
  });
  const summary = M.mode === 'mix' ? 'Ask: which colours could you mix if you only had red, yellow and blue?'
    : M.mode === 'tints-shades' ? 'Ask the class to paint a strip of their own, from the lightest tint to the darkest shade.'
      : 'Ask: which colours would you use to paint a hot desert? A frozen lake?';
  return { steps, summary };
}

/* ------------------------------------------------------------------ render */
// The wheel: warm colours on the upper left, cool on the lower right; each secondary between its two primaries.
// Flat-sided so every name sits beside its dab and nothing stacks above or below the wheel.
const ANG = { red: 180, orange: -120, yellow: -60, green: 0, blue: 60, purple: 120 };
const CY = 385, RW = 180, RD = 76, GAP = 20;
const BAND = 56; // half the width of the warm / cool band, centred on the dabs' ring
const at = (cx, c) => { const a = ANG[c] * Math.PI / 180; return { x: cx + RW * Math.cos(a), y: CY + RW * Math.sin(a), a: ANG[c] }; };
// the painter's palette in the mixing slide: a plain rounded board (no thumb hole: it read as a stray dot)
const BOARD = { x0: 170, x1: 1150, y0: CY - 255, y1: CY + 255, r: 200 };
const BOARD_FILL = 'color-mix(in oklab,var(--hue-brown) 26%,var(--paper))';
const HOLE = { dx: BOARD.x1 - 1082, y: CY + 98, r: 28 }; // legacy: kept only as the board's right-end reference for the label dry run
const boardEdge = (B, y, right) => {
  const dy = Math.max(0, Math.abs(y - CY) - (B.y1 - CY - B.r));
  const inset = B.r - Math.sqrt(Math.max(0, B.r * B.r - dy * dy));
  return right ? B.x1 - inset : B.x0 + inset;
};

/** Name (and an optional recipe line) beside a wheel dab, outward from the centre, clear of the dab and any band. */
function wheelLabel(g, P, c, sub, subEdit, cx, band, lim) {
  const p = at(cx, c); const dx = p.x - cx, left = dx < -1;
  const dy = p.y - CY; const bandX = band ? Math.sqrt(Math.max(0, (RW + BAND) ** 2 - dy * dy)) : 0;
  const off = Math.max(Math.abs(dx) + RD, bandX) + GAP;
  const tx = left ? cx - off : cx + off;
  // the block is centred on its dab; its width is checked over the block's real height (it may wrap, then it is measured again)
  let H = sub == null ? 32 : 62;
  for (let pass = 0; ; pass++) {
    const maxW = Math.max(80, lim(tx, p.y - H / 2, p.y + H / 2, left));
    const gg = h('g', {}, g);
    const name = textBlock(gg, tx, 0, nm(P, c), { cls: 'ts-label', maxW, maxLines: sub == null ? 3 : 2, lh: 32, anchor: left ? 'end' : 'start', edit: `text.label:paint:${c}`, a: { fill: 'var(--ink)' } });
    const r = sub == null ? null : textBlock(gg, tx, 0, sub, { cls: 'ts-cap', maxW, maxLines: 2, lh: 30, anchor: left ? 'end' : 'start', edit: subEdit });
    const H2 = name.h + (r ? r.h : 0);
    if (H2 > H && pass < 2) { gg.remove(); H = H2; continue; }
    const top = p.y - H2 / 2;
    name.el.setAttribute('transform', `translate(0 ${(top + name.lh * .8).toFixed(1)})`);
    if (r) r.el.setAttribute('transform', `translate(0 ${(top + name.h + r.lh * .8).toFixed(1)})`);
    return { left, trunc: [name, r].some(t => t && t.lines.some(l => l.endsWith('…'))) };
  }
}

export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b, N = ctx.N; const bi = k => b[k];
  const defMedium = M.mode === 'warm-cool' ? 'A painter’s colour wheel' : M.mode === 'mix' ? 'Mixing paint, not light' : 'Mixing paint';
  textBlock(root, GRID.right, GRID.subY - 8, txt(P, 'label:medium', defMedium), { cls: 'ts-cap', maxW: 520, maxLines: 1, anchor: 'end', edit: 'text.label:medium' });

  if (M.mode === 'tints-shades') return renderStrip(root, P, ctx, M);

  const G = h('g', {}, root);
  if (M.mode === 'mix') {
    const CX = 620;
    /* the palette: the dabs sit on it like paint. A side whose names would not fit grows out to the grid edge. */
    const B = Object.assign({}, BOARD);
    const limFor = (B, HX) => (tx, y0, y1, left) => {
      const yy = Math.abs(y0 - CY) > Math.abs(y1 - CY) ? y0 : y1;
      let w = left ? tx - boardEdge(B, yy, false) - 16 : boardEdge(B, yy, true) - 16 - tx;
      return w;
    };
    // dry run on the usual board: a side whose names would be cut grows out to the grid edge
    const named = [...PAINT_PRIMARIES.map(c => [c, null, null]), ...M.mixes.map((m, i) => [m.res, txt(P, `label:mix:${i}`, `${nm(P, m.a)} + ${nm(P, m.b)}`), `text.label:mix:${i}`])];
    const tmp = h('g', {}, root);
    for (const [c, sub, ed] of named) {
      const t = wheelLabel(tmp, P, c, sub, ed, CX, false, limFor(BOARD, BOARD.x1 - HOLE.dx));
      if (t.trunc) { if (t.left) B.x0 = GRID.left; else B.x1 = GRID.right; }
    }
    tmp.remove();
    const HX = B.x1 - HOLE.dx;
    h('rect', { x: B.x0, y: B.y0, width: B.x1 - B.x0, height: B.y1 - B.y0, rx: B.r, fill: BOARD_FILL, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)', cls: 'lift' }, G);
    // the wheel itself: a ring through every dab, so the empty slots read as places waiting for a colour
    h('circle', { cx: CX, cy: CY, r: RW, fill: 'none', stroke: `color-mix(in oklab,var(--ink) 20%,${BOARD_FILL})`, 'stroke-width': 14 }, G);
    const lim = limFor(B, HX);
    for (const c of PAINT_PRIMARIES) {
      const p = at(CX, c);
      const g = h('g', { s: bi('primaries'), cls: 'pop', delay: PAINT_PRIMARIES.indexOf(c) * 160 }, G);
      swatch(g, c, { x: p.x, y: p.y, r: RD });
      wheelLabel(g, P, c, null, null, CX, false, lim);
    }
    // each mix: a drop of each paint travels from its pot to the empty slot between them; then the new colour is there
    M.mixes.forEach((m, i) => {
      const kp = bi(`pour:${i}`), km = bi(`make:${i}`); const S = at(CX, m.res);
      for (const [c, j] of [[m.a, 0], [m.b, 1]]) {
        const A = at(CX, c); const dx = (A.x - S.x) * .2, dy = (A.y - S.y) * .2;
        const fl = h('g', { s: kp, hide: km, cls: 'fly', delay: j * 160, vars: { '--fx': `${(A.x - S.x - dx).toFixed(1)}px`, '--fy': `${(A.y - S.y - dy).toFixed(1)}px` } }, G);
        swatch(fl, c, { x: S.x + dx, y: S.y + dy, r: RD * .8 });
      }
      const g = h('g', { s: km, cls: 'pop' }, G);
      swatch(g, m.res, { x: S.x, y: S.y, r: RD });
      wheelLabel(g, P, m.res, txt(P, `label:mix:${i}`, `${nm(P, m.a)} + ${nm(P, m.b)}`), `text.label:mix:${i}`, CX, false, lim);
    });
    if (M.brown) {
      const kp = bi('pour:all'), kb = bi('brown');
      PAINT_PRIMARIES.forEach((c, j) => {
        const A = at(CX, c); const dx = (A.x - CX) * .16, dy = (A.y - CY) * .16;
        const fl = h('g', { s: kp, hide: kb, cls: 'fly', delay: j * 140, vars: { '--fx': `${(A.x - CX - dx).toFixed(1)}px`, '--fy': `${(A.y - CY - dy).toFixed(1)}px` } }, G);
        swatch(fl, c, { x: CX + dx, y: CY + dy, r: 30 });
      });
      const g = h('g', { s: kb, cls: 'pop' }, G);
      swatch(g, 'brown', { x: CX, y: CY - 14, r: 46 });
      // name just below the centre dab, one line: it must stay clear of the dabs around it
      textBlock(g, CX, CY + 66, nm(P, 'brown'), { cls: 'ts-label', maxW: 130, maxLines: 1, anchor: 'middle', edit: 'text.label:paint:brown', a: { fill: 'var(--ink)' } });
    }
    return {};
  }

  /* warm and cool */
  let CX = 470, PX = 862;
  {
    const tmp = h('g', {}, root); let SL = -Infinity, SR = -Infinity, slackL = Infinity;
    for (const c of [...WARM, ...COOL]) {
      const p = at(0, c); const left = p.x < -1; const dy = p.y - CY;
      const off = Math.max(Math.abs(p.x) + RD, Math.sqrt(Math.max(0, (RW + BAND) ** 2 - dy * dy))) + GAP;
      const w = textBlock(tmp, 0, 0, nm(P, c), { cls: 'ts-label', maxW: 4000, maxLines: 1 }).w;
      const need = Math.min(w, Math.max(80, w / 3 * 1.25));
      if (left) { const room = CX - off - GRID.left; SL = Math.max(SL, need - room); slackL = Math.min(slackL, room - need); }
      else SR = Math.max(SR, need - (PX - 28 - CX - off));
    }
    tmp.remove();
    if (SR > 0) { const dp = Math.min(SR, 94); PX += dp; SR -= dp; } // the key keeps at least 260 wide
    if (SR > 0 && slackL > 0) CX -= Math.min(SR, slackL);
    else if (SL > 0) { const d = Math.min(SL, Math.max(0, -SR) + (956 - PX)); CX += d; PX += Math.max(0, d - Math.max(0, -SR)); }
  }
  const PW = GRID.right - PX;
  const kW = bi('wheel'), kWarm = bi('warm'), kCool = bi('cool');
  const Ro = RW + BAND, Ri = RW - BAND;
  // the wheel as a ring from the first build, then warm and cool grounds over its two halves (split on the -30° / 150° line)
  h('circle', { cx: CX, cy: CY, r: RW, fill: 'none', stroke: 'color-mix(in oklab,var(--ink) 10%,var(--bg))', 'stroke-width': 2 * BAND, s: kW, cls: 'rise' }, G);
  const ca = Math.cos(-Math.PI / 6), sa = Math.sin(-Math.PI / 6);
  const P1o = [CX + Ro * ca, CY + Ro * sa], P2o = [CX - Ro * ca, CY - Ro * sa], P1i = [CX + Ri * ca, CY + Ri * sa], P2i = [CX - Ri * ca, CY - Ri * sa];
  const f = v => v.toFixed(1);
  const half = (warm, col, k, c) => h('path', { d: warm
    ? `M${f(P2o[0])} ${f(P2o[1])} A${Ro} ${Ro} 0 0 1 ${f(P1o[0])} ${f(P1o[1])} L${f(P1i[0])} ${f(P1i[1])} A${Ri} ${Ri} 0 0 0 ${f(P2i[0])} ${f(P2i[1])} Z`
    : `M${f(P1o[0])} ${f(P1o[1])} A${Ro} ${Ro} 0 0 1 ${f(P2o[0])} ${f(P2o[1])} L${f(P2i[0])} ${f(P2i[1])} A${Ri} ${Ri} 0 0 0 ${f(P1i[0])} ${f(P1i[1])} Z`,
    fill: `color-mix(in oklab,${col} 32%,var(--bg))`, stroke: `color-mix(in oklab,${col} 55%,var(--bg))`, 'stroke-width': 'var(--sw-hair)', s: k, cls: 'rise', c }, G);
  half(true, 'var(--heat)', kWarm, `${kCool}-${N}:soft`);
  half(false, 'var(--water)', kCool, null);
  const lim = (tx, y0, y1, left) => left ? tx - GRID.left : PX - 28 - tx;
  [...WARM, ...COOL].forEach(c => {
    const p = at(CX, c); const warm = WARM.includes(c); const order = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].indexOf(c);
    const g = h('g', { s: kW, cls: 'pop', delay: order * 140 }, G);
    // the dab recedes while the other half is the point; its name stays full strength
    swatch(g, c, { x: p.x, y: p.y, r: RD, a: { c: warm ? `${kCool}-${kCool + 1}:quiet` : `${kWarm}-${kWarm + 1}:quiet` } });
    wheelLabel(g, P, c, null, null, CX, true, lim);
  });
  // the key beside the wheel: a heading and a reason for each half
  const right = h('g', {}, root);
  const block = (yMid, head, headId, why, whyId, col, k) => {
    const g = h('g', { s: k, cls: 'rise' }, right);
    const tmp = h('g', {}, root);
    const hh = textBlock(tmp, 0, 0, head, { cls: 'ts-h3', maxW: PW, maxLines: 2, lh: 38 }).h;
    const wh = textBlock(tmp, 0, 0, why, { cls: 'ts-label', maxW: PW, maxLines: 3, lh: 36 }).h; tmp.remove();
    const y0 = yMid - (hh + 12 + wh) / 2;
    textBlock(g, PX, y0 + 30, head, { cls: 'ts-h3', maxW: PW, maxLines: 2, lh: 38, edit: `text.${headId}`, a: { fill: col } });
    textBlock(g, PX, y0 + hh + 12 + 26, why, { cls: 'ts-label', maxW: PW, maxLines: 3, lh: 36, edit: `text.${whyId}`, a: { fill: 'var(--ink)' } });
  };
  block(CY - 110, txt(P, 'label:warm', 'Warm colours'), 'label:warm', txt(P, 'label:warmWhy', 'like fire and sunshine'), 'label:warmWhy', 'var(--heat-text)', kWarm);
  block(CY + 110, txt(P, 'label:cool', 'Cool colours'), 'label:cool', txt(P, 'label:coolWhy', 'like water, grass and ice'), 'label:coolWhy', 'var(--water-text)', kCool);
  return {};
}

/* tints and shades: a paint chart, white paint at one end and black at the other */
function renderStrip(root, P, ctx, M) {
  const b = ctx.b; const n = M.n; const c = M.colour;
  const items = [];
  if (M.tints) { items.push({ kind: 'white' }); for (let i = n; i >= 1; i--) items.push({ kind: 'tint', i }); }
  items.push({ kind: 'base' });
  if (M.shades) { for (let i = 1; i <= n; i++) items.push({ kind: 'shade', i }); items.push({ kind: 'black' }); }
  const m = items.length;
  const sp = Math.min(170, (1120 - 160) / Math.max(1, m - 1)); const span = sp * (m - 1); const xs = (GRID.W - span) / 2;
  const cw = Math.min(140, sp - 14), ch = 220, top = 258, Y = top + ch / 2, nameY = top + ch + 50;
  items.forEach((it, j) => { it.x = xs + j * sp; });
  const cx0 = xs - cw / 2 - 30, cx1 = xs + span + cw / 2 + 30;
  const kBase = b.base, kT = b.tints, kS = b.shades;
  const G = h('g', {}, root);
  // the paint chart card the strip is printed on
  h('rect', { x: cx0, y: 150, width: cx1 - cx0, height: 446, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)', cls: 'lift' }, G);
  const ring = { stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' };
  const chip = (g, x, w, hh, fill) => h('rect', Object.assign({ x: x - w / 2, y: Y - hh / 2, width: w, height: hh, rx: 'var(--r-mark)', fill }, ring), g);
  const nameBelow = (g, x, name, maxW, anchor = 'middle') => textBlock(g, x, nameY, nm(P, name), { cls: 'ts-label', maxW, maxLines: 2, lh: 32, anchor, edit: `text.label:paint:${name}`, a: { fill: 'var(--ink)' } });
  // the order things appear: within a build, from the colour outwards
  const tintOrder = it => it.kind === 'white' ? 0 : it.i;
  const baseX = items.find(it => it.kind === 'base').x;
  // the colour's name may spread over the unnamed chips beside it, but stays inside the card
  const baseW = Math.max(120, Math.min(3 * sp - 20, 400, 2 * Math.min(baseX - cx0 - 16, cx1 - 16 - baseX)));
  items.forEach(it => {
    if (it.kind === 'base') {
      const g = h('g', { s: kBase, cls: 'pop' }, G);
      chip(g, it.x, cw + 12, ch + 16, paintFill(c));
      nameBelow(g, it.x, c, baseW);
    } else if (it.kind === 'white' || it.kind === 'black') {
      const tint = it.kind === 'white'; const k = tint ? kT : kS;
      const g = h('g', { s: k, cls: 'pop' }, G);
      swatch(g, it.kind, { x: it.x, y: Y, r: Math.min(cw / 2 + 4, 62) });
      // centred under its pot while it fits inside the card; a longer name runs from the card's end towards the colour's name
      const edgeW = Math.max(80, Math.min(2 * Math.min(it.x - cx0 - 16, cx1 - 16 - it.x), 2 * sp - 40));
      const tmp = h('g', {}, G); const w = textBlock(tmp, 0, 0, nm(P, it.kind), { cls: 'ts-label', maxW: 4000, maxLines: 1 }).w; tmp.remove();
      if (w <= edgeW) nameBelow(g, it.x, it.kind, edgeW);
      else if (tint) nameBelow(g, cx0 + 16, it.kind, baseX - baseW / 2 - 28 - (cx0 + 16), 'start');
      else nameBelow(g, cx1 - 16, it.kind, (cx1 - 16) - (baseX + baseW / 2 + 28), 'end');
    } else {
      const tint = it.kind === 'tint'; const k = tint ? kT : kS; const fr = it.i / (n + 1);
      const g = h('g', { s: k, cls: 'pop', delay: 500 + tintOrder(it) * 380 }, G);
      chip(g, it.x, cw, ch, paintFill(c, { tint: tint ? fr : 0, shade: tint ? 0 : fr * .9 }));
    }
  });
  // group labels above each half: what was added
  const group = (kind, k) => {
    const xsG = items.filter(it => it.kind === kind || it.kind === (kind === 'tint' ? 'white' : 'black')).map(it => it.x);
    const a = Math.min(...xsG), z = Math.max(...xsG); const gx = (a + z) / 2, maxW = Math.max(z - a + cw, 200);
    const def = kind === 'tint' ? `Tints: add ${nm(P, 'white')}` : `Shades: add ${nm(P, 'black')}`;
    const id = kind === 'tint' ? 'label:tints' : 'label:shades';
    const g = h('g', { s: k, cls: 'rise' }, G);
    const tb = textBlock(g, gx, top - 30, txt(P, id, def), { cls: 'ts-h3', maxW, maxLines: 2, lh: 38, anchor: 'middle', edit: `text.${id}`, a: { fill: 'var(--ink)' } });
    if (tb.lines.length > 1) tb.el.setAttribute('transform', `translate(0 ${-(tb.lines.length - 1) * tb.lh})`);
  };
  if (M.tints) group('tint', kT);
  if (M.shades) group('shade', kS);
  return {};
}

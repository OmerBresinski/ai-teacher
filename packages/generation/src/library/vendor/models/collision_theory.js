// Collision theory (KS3/KS4 rates of reaction). Particles of two reactants move about in a box and
// collide; only a collision with enough energy reacts, and those are highlighted. Each factor the
// teacher picks gets its own box beside the start: higher concentration (more particles in the same
// space), higher temperature (faster particles, more collisions with enough energy), a bigger surface
// area (a solid lump broken into pieces) or a catalyst (less energy needed). A counter under each
// box gives collisions a second and how many succeed, worked out from the settings in proportion.
// Builds: the particles, the collisions, one box per factor, then the answer (the counts and what
// each factor does). A question slide stops before the answer.
// Reduced motion: static frames, each particle with an arrow for its direction and speed.
import {
  h, T, clamp, rng, GRID, textBlock, arrow, RM, LABEL_PARAM,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';

export const meta = {
  id: 'collision_theory', name: 'Collision theory', kind: 'scene', version: 1,
  subjects: ['Science'],
  years: ['KS3', 'KS4'],
  teaches: 'Particles react only when they collide with enough energy; concentration, temperature, surface area and a catalyst change how often that happens.',
};

const FACTORS = ['concentration', 'temperature', 'surface-area', 'catalyst'];
const FACTOR_LABELS = ['Higher concentration', 'Higher temperature', 'Bigger surface area', 'Add a catalyst'];
const EFFECT = {
  concentration: 'More particles in the same space: more collisions.',
  temperature: 'Faster particles: more collisions, more with enough energy.',
  'surface-area': 'More particles exposed: more collisions.',
  catalyst: 'Less energy needed: more collisions succeed.',
};

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Collision theory',
  properties: {
    title: TITLE_PARAM('Why do reactions speed up?'),
    factors: {
      type: 'array', title: 'Factors to show', description: 'Each one gets its own box beside the start, in this order.',
      'x-item': 'a factor', minItems: 1, maxItems: 3, default: ['concentration', 'temperature'],
      items: { type: 'string', enum: FACTORS, 'x-labels': FACTOR_LABELS, default: 'concentration' },
    },
    particles: { type: 'integer', title: 'Particles of each reactant at the start', minimum: 3, maximum: 8, default: 5 },
    moreParticles: { type: 'integer', title: 'Particles of the first reactant at higher concentration', description: 'Higher concentration only. More than at the start.', minimum: 4, maximum: 12, default: 10 },
    reactantA: LABEL_PARAM('First reactant (moving particles)', 'Acid particle'),
    reactantB: LABEL_PARAM('Second reactant', 'Magnesium particle', { description: 'With a bigger surface area, this one is the solid.' }),
    showCounter: { type: 'boolean', title: 'Show collisions each second', default: true },
    text: TEXT_PARAM_FOR({
      start: 'label', concentration: 'label', temperature: 'label', 'surface-area': 'label', catalyst: 'label',
      success: 'label', bounce: 'label', counter: 'label', succeeded: 'label', catalystName: 'label',
      'eff:concentration': 'phrase', 'eff:temperature': 'phrase', 'eff:surface-area': 'phrase', 'eff:catalyst': 'phrase',
    }),
  },
};

export const presets = [
  { id: 'ks4-conc-temp', name: 'KS4: concentration and temperature', params: {
    title: 'Why do reactions speed up?', factors: ['concentration', 'temperature'], particles: 5, moreParticles: 10,
    reactantA: 'Acid particle', reactantB: 'Magnesium particle',
  } },
  { id: 'ks4-all-four', name: 'KS4: concentration, surface area and a catalyst', params: {
    title: 'Four ways to speed up a reaction', factors: ['concentration', 'surface-area', 'catalyst'], particles: 6, moreParticles: 11,
    reactantA: 'Acid particle', reactantB: 'Marble (calcium carbonate)',
  } },
  { id: 'ks3-temperature', name: 'KS3: temperature only', params: {
    title: 'Hotter means faster', factors: ['temperature'], particles: 6, moreParticles: 10,
    reactantA: 'Particle A', reactantB: 'Particle B',
  } },
];

/* ------------------------------------------------------------------ the numbers */
// Illustrative, in proportion: collisions a second ∝ moving particles × particles they can reach ×
// speed; the share with enough energy rises with temperature and with a catalyst.
const K = 0.4, SHARE = 0.2, SHARE_UP = 0.5, FAST = 1.6;
function lumpCells(n) { // a solid lump on the floor: two rows, the bottom one full
  const c = Math.ceil(n / 2), cells = [];
  for (let i = 0; i < n; i++) cells.push(i < c ? [i, 0] : [i - c + (c - (n - c)) / 2, 1]);
  return cells;
}
function exposedOf(cells) { // a lump particle is exposed when its left, right or top side is open
  const at = (x, y) => cells.some(([a, b]) => Math.abs(a - x) < .6 && b === y);
  return cells.filter(([x, y]) => !at(x - 1, y) || !at(x + 1, y) || !at(x, y + 1)).length;
}
function model(P) {
  const solid = P.factors.includes('surface-area');
  const n = P.particles;
  const lumpExp = solid ? exposedOf(lumpCells(n)) : n;
  const panel = (key, f) => {
    const nA = f === 'concentration' ? P.moreParticles : n;
    const speed = f === 'temperature' ? FAST : 1;
    const share = f === 'temperature' || f === 'catalyst' ? SHARE_UP : SHARE;
    const shape = !solid ? 'free' : f === 'surface-area' ? 'pieces' : 'lump';
    const reach = shape === 'lump' ? lumpExp : n;
    const coll = Math.max(1, Math.round(K * nA * reach * speed));
    return { key, f, nA, nB: n, speed, share, shape, coll, succ: Math.max(1, Math.round(coll * share)) };
  };
  return { solid, panels: [panel('start', null), ...P.factors.map(f => panel(`f:${f}`, f))] };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  if (R.length) return result(R);
  const seen = new Set();
  P.factors.forEach((f, i) => { if (seen.has(f)) R.push({ path: `factors.${i}`, reason: `“${FACTOR_LABELS[FACTORS.indexOf(f)]}” is in the list twice. Pick each factor once.` }); seen.add(f); });
  if (P.factors.includes('concentration') && P.moreParticles <= P.particles)
    R.push({ path: 'moreParticles', reason: `Higher concentration needs more particles than the start (${P.particles}) in the same space. Use ${P.particles + 1} or more.` });
  if (P.factors.includes('surface-area') && P.particles < 4)
    R.push({ path: 'particles', reason: 'A lump of 3 particles has every particle on its surface, so breaking it up changes nothing. Use 4 or more.' });
  return result(R);
}

/* ------------------------------------------------------------------ builds */
const FCAP = {
  concentration: 'Raise the concentration: more particles in the same space.',
  temperature: 'Raise the temperature: the particles move faster.',
  'surface-area': 'Break the lump into pieces: more of its particles are exposed.',
  catalyst: 'Add a catalyst: a collision needs less energy to react.',
};
export function builds(P) {
  return {
    steps: [
      { key: 'particles', caption: 'Particles move all the time, in every direction.' },
      { key: 'collide', caption: 'They collide. Only a collision with enough energy reacts: those are highlighted.' },
      ...P.factors.map(f => ({ key: `f:${f}`, caption: FCAP[f] })),
      { key: 'answer', caption: 'More successful collisions each second means a faster reaction.' },
    ],
    summary: { caption: 'A reaction speeds up when successful collisions happen more often.' },
  };
}
export function notes(P) {
  const FN = {
    concentration: 'Same space, more particles: ask what happens to the number of collisions. Not the speed: the particles move as fast as before.',
    temperature: 'Two effects: more collisions (faster particles) and a bigger share with enough energy. The second matters more.',
    'surface-area': 'Only particles on the surface of a solid can be hit. Breaking it up exposes the inside ones.',
    catalyst: 'A catalyst gives a route with a lower activation energy. It is not used up, and the particles move no faster.',
  };
  return {
    steps: [
      'The particles never stop. The arrows show direction and speed in the still picture.',
      'Activation energy: the least energy a collision needs to react. Most collisions here just bounce.',
      ...P.factors.map(f => FN[f]),
      'The counts are illustrative, in proportion to the settings, not measured. Ask which factor changed the share that succeed.',
    ],
    summary: 'Rate depends on how often successful collisions happen. Ask pupils to explain each box with “more collisions” or “more energetic collisions”.',
  };
}

/* ------------------------------------------------------------------ render */
const A_FILL = 'var(--particle)', A_EDGE = 'var(--particle-edge)';
const B_FILL = 'color-mix(in oklab,var(--hue-grey) 45%,var(--paper))', B_EDGE = 'var(--ink-2)';
const GOLD = 'var(--energy)', GOLD_T = 'var(--energy-text)';

function burst(p, x, y, r, a = {}) { // a successful collision: a flat gold ring with short rays
  const g = h('g', Object.assign({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, a), p);
  h('circle', { r, fill: 'none', stroke: GOLD, 'stroke-width': 'var(--sw-data)' }, g);
  for (let i = 0; i < 8; i++) {
    const t = i * Math.PI / 4, c = Math.cos(t), s = Math.sin(t);
    h('line', { x1: c * (r + 4), y1: s * (r + 4), x2: c * (r + 11), y2: s * (r + 11), stroke: GOLD, 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  }
  return g;
}
function bounceMark(p, x, y, r, a = {}) { // a collision without enough energy: a dashed grey ring
  const g = h('g', Object.assign({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, a), p);
  h('circle', { r, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '5 5' }, g);
  return g;
}

export function render(root, P, ctx) {
  const M = model(P), b = ctx.b, N = ctx.N;
  const n = M.panels.length, gap = 28;
  const pw = (GRID.right - GRID.left - (n - 1) * gap) / n;
  const R = n >= 4 ? 10 : 12;
  const HEAD_Y = GRID.top + 30, BOX_T = GRID.top + 74, BOX_H = 200, BOX_B = BOX_T + BOX_H;
  const CNT_Y = BOX_B + 38, EFF_Y = BOX_B + (P.showCounter ? 108 : 40);
  const LEG1 = GRID.bottom - 46, LEG2 = GRID.bottom - 8;
  const live = [], statics = [];

  M.panels.forEach((pn, j) => {
    const k = pn.f ? b[pn.key] : b.particles;
    const x0 = GRID.left + j * (pw + gap), x1 = x0 + pw;
    const g = h('g', { s: k, cls: 'rise' }, root);
    // heading
    const head = pn.f ? txt(P, `label:${pn.f}`, FACTOR_LABELS[FACTORS.indexOf(pn.f)]) : txt(P, 'label:start', 'At the start');
    const hb = textBlock(g, (x0 + x1) / 2, HEAD_Y, head, { cls: 'ts-label', maxW: pw - 8, maxLines: 2, lh: 30, anchor: 'middle', a: { fill: 'var(--ink)', 'font-weight': 'var(--w-label)' }, edit: `text.label:${pn.f || 'start'}` });
    if (hb.lines.length > 1) hb.el.setAttribute('y', HEAD_Y - 15);
    // the box
    h('rect', { x: x0, y: BOX_T, width: pw, height: BOX_H, rx: 'var(--r-mark)', fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)' }, g);
    let floor = BOX_B - 6, floorY = floor;
    if (pn.f === 'catalyst') { // a flat grey catalyst surface on the floor, its name written on it
      h('rect', { x: x0 + 8, y: floor - 34, width: pw - 16, height: 34, rx: 'var(--r-mark)', fill: 'color-mix(in oklab,var(--hue-grey) 34%,var(--paper))', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
      textBlock(g, (x0 + x1) / 2, floor - 9, txt(P, 'label:catalystName', 'catalyst'), { cls: 'ts-small', maxW: pw - 32, maxLines: 1, anchor: 'middle', a: { fill: 'var(--ink-2)' }, edit: 'text.label:catalystName' });
      floor -= 36; floorY = floor;
    }
    const rnd = rng(31 + j * 7);
    const parts = [];
    const free = (x, y, d, but) => parts.every(q => q === but || Math.hypot(q.x - x, q.y - y) >= (q.solid ? Math.min(d, 2 * R + 4) : d));
    const top = BOX_T + R + 8, bot = floorY - R - 2, lft = x0 + R + 8, rgt = x1 - R - 8;
    // B: free particles, or a solid lump / its pieces on the floor
    if (pn.shape !== 'free') {
      const cells = pn.shape === 'lump' ? lumpCells(pn.nB) : null;
      const S = 2 * R + 1;
      if (cells) {
        const w = Math.ceil(pn.nB / 2) * S, cx0 = (x0 + x1) / 2 - w / 2 + R;
        for (const [cx, cy] of cells) parts.push({ t: 'B', solid: true, x: cx0 + cx * S, y: floor - R - cy * S });
      } else {
        const pieces = Math.ceil(pn.nB / 2), span = (pw - 24) / pieces;
        for (let i = 0; i < pn.nB; i++) { const pc = Math.floor(i / 2), side = i % 2; parts.push({ t: 'B', solid: true, x: x0 + 12 + span * (pc + .5) + (side ? R : -R) * (pn.nB - i === 1 && side === 0 ? 0 : 1), y: floor - R }); }
      }
    }
    // the still's collisions: touching pairs, the gold ones with enough energy
    const contacts = clamp(Math.round(pn.coll / 6), 1, 4);
    const succ = Math.min(contacts, Math.max(1, Math.round(contacts * pn.share * 1.6)));
    const sg = h('g', pn.f ? {} : { s: b.collide, cls: 'pop' }, g);
    statics.push(sg);
    const marks = [];
    let placedA = 0;
    for (let c = 0; c < contacts; c++) {
      const solids = parts.filter(q => q.solid && !q.hit);
      for (let tries = 0; tries < 80; tries++) {
        let ax, ay, bx, by, bq = null;
        if (solids.length) { bq = solids[Math.floor(rnd() * solids.length)]; const ang = -Math.PI * (.15 + .7 * rnd()); bx = bq.x; by = bq.y; ax = bx + Math.cos(ang) * 2 * R; ay = by + Math.sin(ang) * 2 * R; }
        else { bx = lft + R + rnd() * (rgt - lft - 2 * R); by = top + rnd() * (bot - top); const ang = rnd() * Math.PI * 2; ax = bx + Math.cos(ang) * 2 * R; ay = by + Math.sin(ang) * 2 * R; }
        if (ax < lft || ax > rgt || ay < top || ay > bot || (!bq && (bx < lft || bx > rgt))) continue;
        if (!free(ax, ay, 2 * R + 14, bq) || (!bq && !free(bx, by, 2 * R + 14)) || marks.some(m => Math.hypot(m.x - (ax + bx) / 2, m.y - (ay + by) / 2) < 5 * R)) continue;
        if (bq) bq.hit = true; else if (parts.filter(q => q.t === 'B').length < pn.nB) parts.push({ t: 'B', x: bx, y: by, pair: true });
        parts.push({ t: 'A', x: ax, y: ay, pair: true }); placedA++;
        marks.push({ x: (ax + bx) / 2, y: (ay + by) / 2, ok: c < succ });
        break;
      }
    }
    for (const m of marks) (m.ok ? burst : bounceMark)(sg, m.x, m.y, R + 3);
    const place = (t, count) => {
      for (let i = 0; i < count; i++) {
        let ok = false;
        for (let tries = 0; tries < 300 && !ok; tries++) {
          const x = lft + rnd() * (rgt - lft), y = top + rnd() * (bot - top);
          if (free(x, y, 2 * R + 10)) { parts.push({ t, x, y }); ok = true; }
        }
        if (!ok) ctx.warn(`No room for every particle in “${head}”.`);
      }
    };
    place('A', pn.nA - placedA);
    place('B', pn.shape === 'free' ? pn.nB - parts.filter(q => q.t === 'B').length : 0);
    // velocities (seeded) and the still's arrows: direction and speed
    const ag = h('g', {}, g); statics.push(ag);
    const pg = h('g', {}, g);
    for (const q of parts) {
      q.hx = q.x; q.hy = q.y;
      const th = rnd() * Math.PI * 2; q.vx = Math.cos(th); q.vy = Math.sin(th);
      if (!q.solid && !q.pair) {
        const L = (2 * R + 4) * pn.speed, ex = q.x + q.vx * (R + 2 + L), ey = q.y + q.vy * (R + 2 + L);
        if (ex > x0 + 6 && ex < x1 - 6 && ey > BOX_T + 6 && ey < floorY - 2)
          arrow(ctx, ag, `M${(q.x + q.vx * (R + 3)).toFixed(1)} ${(q.y + q.vy * (R + 3)).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`, ex, ey, th, 'var(--ink-3)', 'var(--sw-struct)', { k: .55 });
        else { q.vx = -q.vx; q.vy = -q.vy; const fx = q.x + q.vx * (R + 2 + L), fy = q.y + q.vy * (R + 2 + L); if (fx > x0 + 6 && fx < x1 - 6 && fy > BOX_T + 6 && fy < floorY - 2) arrow(ctx, ag, `M${(q.x + q.vx * (R + 3)).toFixed(1)} ${(q.y + q.vy * (R + 3)).toFixed(1)} L${fx.toFixed(1)} ${fy.toFixed(1)}`, fx, fy, Math.atan2(q.vy, q.vx), 'var(--ink-3)', 'var(--sw-struct)', { k: .55 }); }
      }
      q.el = h('circle', { cx: q.x.toFixed(1), cy: q.y.toFixed(1), r: R, fill: q.t === 'A' ? A_FILL : B_FILL, stroke: q.t === 'A' ? A_EDGE : B_EDGE, 'stroke-width': 'var(--sw-hair)' }, pg);
    }
    // flashes for the moving picture (hidden in the still)
    const fg = h('g', {}, g);
    const flashes = Array.from({ length: 6 }, (_, i) => ({ el: (i % 2 ? bounceMark : burst)(fg, 0, 0, R + 3, { opacity: 0 }), ok: !(i % 2), t0: -9 }));
    // the counter and what the factor does
    const kc = pn.f ? b.answer : b.collide;
    if (P.showCounter) {
      const cg = h('g', { s: kc, cls: 'rise' }, root);
      computed(T(cg, (x0 + x1) / 2, CNT_Y, `${pn.coll} ${txt(P, 'label:counter', 'collisions a second')}`, n >= 4 ? 'ts-small' : 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink)' }), pn.f === 'concentration' ? 'moreParticles' : 'particles');
      computed(T(cg, (x0 + x1) / 2, CNT_Y + 34, `${pn.succ} ${txt(P, 'label:succeeded', 'with enough energy')}`, n >= 4 ? 'ts-small' : 'ts-label', { 'text-anchor': 'middle', fill: GOLD_T, 'font-weight': 'var(--w-label)' }), 'factors');
    }
    if (pn.f) textBlock(root, (x0 + x1) / 2, EFF_Y, txt(P, `label:eff:${pn.f}`, EFFECT[pn.f]), { cls: 'ts-small', maxW: pw - 8, maxLines: 3, lh: 28, anchor: 'middle', a: { fill: 'var(--ink-2)', s: b.answer, cls: 'rise' }, edit: `text.label:eff:${pn.f}` });
    live.push({ k, collideK: pn.f ? k : b.collide, pn, parts, flashes, box: { lft, rgt, top, bot }, pairs: new Map(), nth: 0 });
  });

  // the key: the two reactants, then the two kinds of collision
  const lg = h('g', { s: b.particles, cls: 'rise' }, root), kg = h('g', { s: b.collide, cls: 'rise' }, root);
  const colW = (GRID.right - GRID.left) / 2;
  const keyItem = (p, x, y, draw, words, edit) => { draw(p, x + 14, y - 9); textBlock(p, x + 40, y, words, { cls: 'ts-small', maxW: colW - 56, maxLines: 1, a: { fill: 'var(--ink-2)' }, edit }); };
  keyItem(lg, GRID.left, LEG1, (p, x, y) => h('circle', { cx: x, cy: y, r: 11, fill: A_FILL, stroke: A_EDGE, 'stroke-width': 'var(--sw-hair)' }, p), P.reactantA, 'reactantA');
  keyItem(lg, GRID.left + colW, LEG1, (p, x, y) => h('circle', { cx: x, cy: y, r: 11, fill: B_FILL, stroke: B_EDGE, 'stroke-width': 'var(--sw-hair)' }, p), P.reactantB, 'reactantB');
  keyItem(kg, GRID.left, LEG2, (p, x, y) => burst(p, x, y, 8), txt(P, 'label:success', 'Enough energy: they react'), 'text.label:success');
  keyItem(kg, GRID.left + colW, LEG2, (p, x, y) => bounceMark(p, x, y, 10), txt(P, 'label:bounce', 'Not enough energy: they bounce'), 'text.label:bounce');

  let moving = false;
  const set = q => { q.el.setAttribute('cx', q.x.toFixed(1)); q.el.setAttribute('cy', q.y.toFixed(1)); };
  const home = () => {
    moving = false;
    for (const s of statics) s.style.display = '';
    for (const L of live) { for (const q of L.parts) { q.x = q.hx; q.y = q.hy; set(q); } for (const f of L.flashes) { f.el.setAttribute('opacity', 0); f.t0 = -9; } L.pairs.clear(); }
  };
  const SP = 60; // slide units a second at the start: calm
  return {
    dur: Object.fromEntries(builds(P).steps.map(s => [s.key, s.key === 'answer' ? 2500 : 5000])),
    reset: home, still: home,
    tick(k, u, t, dt = 0) {
      // reduced motion, and the engine's one instant call (dt 0) when a build is jumped to: the
      // static frame with arrows stays; the picture moves only once frames really run
      if (RM.matches || t == null || k >= N || !(dt > 0)) return;
      if (!moving) { moving = true; for (const s of statics) s.style.display = 'none'; }
      const d = clamp(dt, 0, .05);
      for (const L of live) {
        if (k < L.k) continue;
        const { lft, rgt, top, bot } = L.box, sp = SP * L.pn.speed;
        for (const q of L.parts) {
          if (q.solid) continue;
          q.x += q.vx * sp * d; q.y += q.vy * sp * d;
          if (q.x < lft) { q.x = lft; q.vx = Math.abs(q.vx); } if (q.x > rgt) { q.x = rgt; q.vx = -Math.abs(q.vx); }
          if (q.y < top) { q.y = top; q.vy = Math.abs(q.vy); } if (q.y > bot) { q.y = bot; q.vy = -Math.abs(q.vy); }
        }
        // A–B collisions bounce; from the collisions build on, each one flashes (gold: enough energy)
        const As = L.parts.filter(q => q.t === 'A'), Bs = L.parts.filter(q => q.t === 'B');
        for (let i = 0; i < As.length; i++) for (let j = 0; j < Bs.length; j++) {
          const a = As[i], c = Bs[j], dx = a.x - c.x, dy = a.y - c.y, dd = Math.hypot(dx, dy);
          if (dd >= 2 * R || dd === 0) continue;
          const nx = dx / dd, ny = dy / dd, rel = a.vx * nx + a.vy * ny;
          if (rel < 0) { a.vx -= 2 * rel * nx; a.vy -= 2 * rel * ny; if (!c.solid) { const r2 = c.vx * nx + c.vy * ny; if (r2 > 0) { c.vx -= 2 * r2 * nx; c.vy -= 2 * r2 * ny; } } }
          a.x = c.x + nx * 2 * R; a.y = c.y + ny * 2 * R;
          const key = i * 64 + j, last = L.pairs.get(key) || -9;
          if (t - last < .6) continue;
          L.pairs.set(key, t);
          if (k < L.collideK) continue;
          const ok = ((L.nth++ * 0.618034) % 1) < L.pn.share; // a fixed share of collisions succeed
          const f = L.flashes.filter(z => z.ok === ok).sort((p, q) => p.t0 - q.t0)[0];
          f.t0 = t; f.x = (a.x + c.x) / 2; f.y = (a.y + c.y) / 2;
          f.el.setAttribute('transform', `translate(${f.x.toFixed(1)} ${f.y.toFixed(1)})`);
        }
        for (const f of L.flashes) { const e = t - f.t0; f.el.setAttribute('opacity', e >= 0 && e < .7 ? (1 - e / .7).toFixed(2) : 0); }
        for (const q of L.parts) set(q);
      }
    },
  };
}

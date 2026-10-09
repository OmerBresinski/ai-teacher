// States of matter: one substance on a bench in up to three states, each under a lens that shows
// its particles. Heating and cooling arrows between them carry the change and its temperature.
// Ported from the north star "Heating one substance" (v2): real objects, a lens grown from a
// spot on each, one particle size in every state. Built only on the kit.
import {
  h, T, measure, clamp, eIO, rng, GRID, W,
  textBlock, magnifier, pill, arrow,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, wrap, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { apparatus, particleLayout, PARTICLE_R } from '../kit/batch-E.js';
import { SUBSTANCE_COLS, solidBlock, liquidBowl, panOnHob, dish, kettle, coldWindow } from './states_of_matter/objects.js';

export const meta = {
  id: 'states_of_matter', name: 'States of matter', kind: 'scene', version: 1,
  subjects: ['Science'],
  years: ['Y4', 'Y5'],
  teaches: 'Solids, liquids and gases are the same particles arranged and moving differently, and heating or cooling changes one state into another at a set temperature.',
};

const SUBS = ['water', 'chocolate', 'butter', 'wax'];
// what each change does to the state
const CH = {
  melting: { from: 'solid', to: 'liquid', heat: true },
  freezing: { from: 'liquid', to: 'solid', heat: false },
  evaporating: { from: 'liquid', to: 'gas', heat: true },
  boiling: { from: 'liquid', to: 'gas', heat: true },
  condensing: { from: 'gas', to: 'liquid', heat: false },
};
// Melting, freezing and boiling happen at the substance's own temperature, so the model sets them
// (`at`: melting point, about the middle of the range for mixtures; `boil` where it can be shown).
// Only evaporating and condensing take a temperature from the teacher.
const PROPS = {
  water: { name: 'Water', at: 0, boil: 100, gas: true },
  chocolate: { name: 'Chocolate', at: 34, gas: false, why: 'Chocolate burns before it boils, so it cannot be shown as a gas.' },
  butter: { name: 'Butter', at: 32, gas: false, why: 'Butter burns before it boils, so it cannot be shown as a gas.' },
  wax: { name: 'Wax', at: 60, gas: false, why: 'Wax only becomes a gas inside a candle flame, where it burns, so this model shows wax as a solid and a liquid.' },
};
// What happens, as one choice: the state it starts in, then up to two changes. Each change starts
// from the state the last one made, so every choice here is a possible chain.
const SEQS = {
  melt: ['solid', 'melting'], freeze: ['liquid', 'freezing'], boil: ['liquid', 'boiling'], evaporate: ['liquid', 'evaporating'], condense: ['gas', 'condensing'],
  'melt-boil': ['solid', 'melting', 'boiling'], 'melt-evaporate': ['solid', 'melting', 'evaporating'], 'melt-freeze': ['solid', 'melting', 'freezing'],
  'freeze-melt': ['liquid', 'freezing', 'melting'], 'boil-condense': ['liquid', 'boiling', 'condensing'], 'evaporate-condense': ['liquid', 'evaporating', 'condensing'],
  'condense-freeze': ['gas', 'condensing', 'freezing'], 'condense-boil': ['gas', 'condensing', 'boiling'], 'condense-evaporate': ['gas', 'condensing', 'evaporating'],
  solid: ['solid'], liquid: ['liquid'], gas: ['gas'],
};
const CH_WORD = { melting: 'Melting', freezing: 'Freezing', evaporating: 'Evaporating', boiling: 'Boiling', condensing: 'Condensing' };
const seqLabel = id => {
  const [st, ...cs] = SEQS[id]; if (!cs.length) return `Just a ${st}, no change`;
  const states = [st]; cs.forEach(c => states.push(CH[c].to));
  const w = cs.map((c, i) => (i ? CH_WORD[c].toLowerCase() : CH_WORD[c]) + (c === 'freezing' ? ' (setting)' : ''));
  return `${w.join(', then ')}: ${states.join(' → ')}`;
};
const statesOf = seq => { const out = [seq[0]]; seq.slice(1).forEach(c => out.push(CH[c].to)); return out; };
const LABEL_IDS = ['obj0', 'obj1', 'obj2', 'state0', 'state1', 'state2', 'ch0', 'ch1', 'holds', 'cold', 'scale'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'States of matter',
  properties: {
    title: TITLE_PARAM('Heating one substance'),
    substance: { type: 'string', title: 'Substance', enum: SUBS, 'x-labels': ['Water', 'Chocolate', 'Butter', 'Candle wax'], default: 'water' },
    sequence: { type: 'string', title: 'What happens', description: 'The state it starts in, then up to two changes. Melting, freezing and boiling happen at the substance’s own temperature, so the model shows that temperature.', enum: Object.keys(SEQS), 'x-labels': Object.keys(SEQS).map(seqLabel), default: 'melt' },
    evapTemp: { type: 'number', title: 'Evaporating: temperature (°C)', description: 'Water evaporates at any temperature up to 100 °C, for example a puddle at 20 °C.', minimum: -50, maximum: 400, default: 20 },
    condTemp: { type: 'number', title: 'Condensing: temperature of the cold surface (°C)', description: 'Condensation needs a surface colder than the warm, damp air: choose 1 to 35 °C.', minimum: -50, maximum: 400, default: 8 },
    showParticles: { type: 'boolean', title: 'Zoom in on the particles', description: 'A lens on each object shows its particles.', default: true },
    text: TEXT_PARAM_FOR(Object.fromEntries(LABEL_IDS.map(id => [id, 'label']))),
  },
};

export const presets = [
  { id: 'y4-ice-water-steam', name: 'Year 4: ice to water to water vapour', params: {
    title: 'Heating water', substance: 'water', sequence: 'melt-boil', showParticles: true,
  } },
  { id: 'y4-chocolate', name: 'Year 4: chocolate melting', params: {
    title: 'Melting chocolate', substance: 'chocolate', sequence: 'melt', showParticles: true,
  } },
  { id: 'y5-condensation', name: 'Year 5: condensation on a cold window', params: {
    title: 'Condensation on a cold window', substance: 'water', sequence: 'condense', condTemp: 8, showParticles: true,
  } },
  { id: 'y4-puddle', name: 'Year 4: a puddle dries up (no particles)', params: {
    title: 'Where does the water go?', substance: 'water', sequence: 'evaporate', evapTemp: 20, showParticles: false,
  } },
];

/* ------------------------------------------------------------------ model of the data */
const degC = v => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v * 10) / 10)} °C`;
const STATE_WORD = { solid: 'Solid', liquid: 'Liquid', gas: 'Gas' };
function objName(sub, state, via) {
  if (sub === 'water') {
    if (state === 'solid') return 'Ice';
    if (state === 'liquid') return via === 'condensing' ? 'Droplets on cold glass' : 'Water';
    return via === 'boiling' ? 'Water boiling' : via === 'evaporating' ? 'Water drying up' : 'Warm, damp air';
  }
  const n = PROPS[sub].name;
  return state === 'solid' ? `Solid ${n.toLowerCase()}` : `Melted ${n.toLowerCase()}`;
}
function changeTemp(P, change) {
  const pr = PROPS[P.substance];
  if (change === 'evaporating') return { t: P.evapTemp, src: 'evapTemp' };
  if (change === 'condensing') return { t: P.condTemp, src: 'condTemp' };
  return { t: change === 'boiling' ? pr.boil : pr.at, src: 'substance' };
}
function model(P) {
  const sub = P.substance, seq = SEQS[P.sequence] || SEQS.melt, cols = [{ state: seq[0], via: null }];
  const changes = seq.slice(1);
  changes.forEach((c, i) => cols.push({ state: CH[c].to, via: c, i }));
  cols.forEach((c, j) => {
    c.j = j;
    c.kind = c.state === 'solid' ? 'block' : c.state === 'liquid' ? (c.via === 'condensing' ? 'window' : 'bowl') : (c.via === 'boiling' ? 'pan' : c.via === 'evaporating' ? 'dish' : 'kettle');
    c.name = txt(P, `label:obj${j}`, objName(sub, c.state, c.via));
  });
  const chs = changes.map((change, i) => ({ change, i, ...changeTemp(P, change), temp: changeTemp(P, change).t, ...CH[change], word: txt(P, `label:ch${i}`, sub !== 'water' && change === 'freezing' ? 'Setting' : CH_WORD[change]) }));
  return { sub, cols, chs, approx: sub !== 'water' };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const pr = PROPS[P.substance], seq = SEQS[P.sequence];
  if (statesOf(seq).includes('gas') && !pr.gas) R.push({ path: 'sequence', reason: `${pr.why} Choose changes without a gas, or choose water.` });
  if (seq.includes('evaporating')) {
    const t = P.evapTemp;
    if (t > 100) R.push({ path: 'evapTemp', reason: `At sea level liquid water cannot be hotter than 100 °C: at ${degC(t)} it has all boiled away. Choose 1 to 100 °C.` });
    else if (t <= 0) R.push({ path: 'evapTemp', reason: `At ${degC(t)} the water would be ice. Choose a temperature between 1 and 100 °C.` });
  }
  if (seq.includes('condensing')) {
    const t = P.condTemp;
    if (t > 35) R.push({ path: 'condTemp', reason: 'Condensation happens on a surface colder than the warm, damp air, for example a window at 8 °C. Choose 1 to 35 °C.' });
    else if (t <= 0) R.push({ path: 'condTemp', reason: 'Below 0 °C water vapour turns straight into frost (ice), not liquid droplets. Choose a temperature above 0 °C.' });
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
const LOOK = {
  solid: n => `${n} is a solid: it keeps its shape.`,
  liquid: n => `${n} is a liquid: it flows and takes the shape of its container.`,
  gas: n => `${n}: the water vapour is a gas. It spreads out, and you cannot see it.`,
};
const ZOOM = {
  solid: 'Zoom in: the particles sit in a regular pattern, touching, and vibrate on the spot.',
  liquid: 'Zoom in: the particles still touch, but they are jumbled and slide past each other.',
  gas: 'Zoom in: the particles are far apart and move quickly in every direction.',
};
function plan(P) {
  const M = model(P); const items = [];
  const c0 = M.cols[0];
  items.push({ key: 'obj', caption: LOOK[c0.state](c0.name) });
  if (P.showParticles) items.push({ key: 'lens:0', caption: ZOOM[c0.state] });
  M.chs.forEach(c => {
    const nx = M.cols[c.i + 1], t = (M.approx ? 'about ' : '') + degC(c.temp);
    const cap = {
      melting: `Heat it to ${t} and it melts: the solid becomes a liquid.`,
      freezing: `Cool it to ${t} and it ${M.sub === 'water' ? 'freezes' : 'sets'}: the liquid becomes a solid.`,
      boiling: `Heat it to ${t} and it boils: the liquid becomes a gas, water vapour.`,
      evaporating: c.temp >= 100 ? `At ${t} the water boils, and it also evaporates from its surface into the air as water vapour.` : `At ${t}, ${c.temp <= 60 ? 'well ' : ''}below boiling, the water slowly evaporates into the air as water vapour.`,
      condensing: `The water vapour touches cold glass at ${t} and condenses into liquid droplets.`,
    }[c.change];
    items.push({ key: `ch:${c.i}`, caption: cap, col: nx });
    if (P.showParticles) items.push({ key: `lens:${c.i + 1}`, caption: ZOOM[nx.state] });
  });
  const summary = P.showParticles
    ? (M.cols.length > 1 ? 'Same particles, same size, in every state. Only their arrangement and movement change.' : ZOOM[c0.state].replace('Zoom in: t', 'T'))
    : (M.chs.length ? 'Heating or cooling changes the state. It is still the same stuff.' : LOOK[c0.state](c0.name));
  return { M, items, summary };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, items } = plan(P);
  const steps = items.map(it => {
    if (it.key === 'obj') return M.cols[0].state === 'gas' ? 'Water vapour is invisible. The white cloud above a kettle is tiny droplets of liquid water, already condensed.' : 'Ask: how do you know this is a ' + M.cols[0].state + '? Can you hold it, pour it, squash it?';
    if (it.key.startsWith('lens:')) {
      const c = M.cols[+it.key.slice(5)];
      return 'Not to scale: real particles are far too small to see, even with a microscope. The particles are the same size in every lens; only how close they are and how they move changes.' + (c.state === 'gas' ? ' Gas particles are far apart, not bigger.' : '');
    }
    const c = M.chs[+it.key.slice(3)];
    return {
      melting: M.sub === 'water' ? 'While ice melts, its temperature stays at 0 °C: the heat goes into breaking up the pattern.' : `${PROPS[M.sub].name} is a mixture, so it softens over a few degrees rather than at one exact temperature.`,
      freezing: M.sub === 'water' ? 'Water freezes at the same temperature ice melts: 0 °C.' : 'Setting is freezing: a liquid turning solid as it cools.',
      boiling: 'While water boils, it stays at 100 °C (at sea level). The bubbles are water vapour. The white cloud you see is droplets, not vapour.',
      evaporating: 'Evaporation happens at the surface at any temperature, even far below boiling. Warmth, wind and a wide surface make it faster.',
      condensing: `Condensation is the reverse of evaporating. Ask: where else do you see it? (Bathroom mirror, a cold can.) Below 0 °C the vapour becomes frost instead.`,
    }[c.change];
  });
  return { steps, summary: 'Ask: is it still the same substance? What would make it change back?' };
}

/* ------------------------------------------------------------------ render */
const LY = 256, LR = 114;    // lens centre line and radius
const R = PARTICLE_R;        // one particle size for this substance, every state
const COLX = { 1: [640], 2: [400, 880], 3: [210, 610, 1010] };
// objects are drawn at this scale on their base line; with lenses the scene sits under them, without it is centred
const SCALE = { 1: 2.2, 2: 2, 3: 1.7 };

export function render(root, P, ctx) {
  const { M, items } = plan(P); const b = ctx.b, N = ctx.N; const bi = k => b[k] ?? 0;
  const n = M.cols.length, lensOn = !!P.showParticles;
  const xs = !lensOn && n === 2 ? [360, 920] : COLX[n];
  const SC = lensOn ? Math.min(2, SCALE[n]) : SCALE[n];
  const at = j => j === 0 ? bi('obj') : bi(`ch:${j - 1}`);
  // a column recedes once the next state's particles are on (or, without lenses, once the next change is done)
  const quietFrom = j => j < n - 1 ? (lensOn ? bi(`lens:${j + 1}`) + 1 : bi(`ch:${j}`) + 1) : N;
  const rcj = j => quietFrom(j) < N ? `${quietFrom(j)}-${N}:quiet` : null;
  const offj = j => quietFrom(j) < N ? `${quietFrom(j)}-${N}:off` : null;   // text and links of a receded column hide, not fade
  const ASC = { 'ts-label': 24, 'ts-num': 31, 'ts-tiny': 18 };            // ascent above the baseline, per type class
  const FOOT = GRID.foot - 6;                                                  // lowest a descender may reach

  // How many lines a wording needs in a lane, the way textBlock fits it (wrap, then one size smaller).
  // A wording in a lane, the way textBlock fits it (wrap, then one size smaller), except that a size
  // which would break a word in two gives way to the smaller size that keeps every word whole.
  const wholeWords = (s, cls, w) => String(s).split(/\s+/).every(wd => measure(root, wd, cls) <= w);
  const linesIn = (s, cls, w) => {
    if (cls !== 'ts-tiny' && !wholeWords(s, cls, w) && wholeWords(s, 'ts-tiny', w)) cls = 'ts-tiny';
    const L = wrap(root, s, cls, w).length; if (L <= 1 || cls === 'ts-tiny') return { n: L, cls };
    const Lt = wrap(root, s, 'ts-tiny', w).length; return Lt < L ? { n: Lt, cls: 'ts-tiny', from: cls } : { n: L, cls };
  };

  /* object names: their lane is the column, inside the grid; they sit under the objects, so a
     two-line name lifts the whole bench row rather than running into the foot rule */
  const spacing = n > 1 ? xs[1] - xs[0] : Infinity;
  const nameW = j => Math.min(n > 1 ? spacing - 40 : 600, 2 * (xs[j] - GRID.left), 2 * (GRID.right - xs[j]));
  let nameLines = 1, nameLh = 30;
  M.cols.forEach((c, j) => { const f = linesIn(c.name, 'ts-label', nameW(j)); const nl = Math.min(2, f.n); if (nl > 1) { nameLines = 2; if (f.cls === 'ts-tiny') nameLh = Math.min(nameLh, 26); } });
  const BY = Math.min(lensOn ? 568 : 540, Math.floor(FOOT - 8 - 19 * SC - 24 - (nameLines - 1) * nameLh - 6));
  const nameY = BY + 19 * SC + 6 + 24;

  /* obstacles for the change labels: every drawn part of every object, the names, and the lenses */
  const OBS = [], PAD = 12;
  const addBox = (x0, y0, x1, y1, pad = PAD) => OBS.push({ x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad });
  function partBoxes(sg, x) {
    const walk = (el, m) => { for (const c of el.children) {
      if (c.tagName === 'defs') continue;
      const tl = c.transform && c.transform.baseVal.numberOfItems ? c.transform.baseVal.consolidate().matrix : null;
      const mm = tl ? m.multiply(new DOMMatrix([tl.a, tl.b, tl.c, tl.d, tl.e, tl.f])) : m;
      if (c.tagName === 'g') { walk(c, mm); continue; }
      const bb = c.getBBox(); if (!bb.width && !bb.height) continue;
      const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]
        .map(([px, py]) => mm.transformPoint(new DOMPoint(px, py))).map(q => [x + (q.x - x) * SC, BY + (q.y - BY) * SC]);
      const X = pts.map(q => q[0]), Y = pts.map(q => q[1]);
      addBox(Math.min(...X) - 3, Math.min(...Y) - 3, Math.max(...X) + 3, Math.max(...Y) + 3);
    } };
    walk(sg, new DOMMatrix());
  }
  /* the free stretch of a row between L and R at heights y0..y1: the gap holding cx, else the widest */
  function lane(cx, L, R, y0, y1) {
    let iv = [[L, R]];
    for (const q of OBS) {
      // a lens is a circle: at these heights it is only as wide as its chord
      let o = q;
      if (q.r) { const dy = Math.abs(clamp(q.cy, y0, y1) - q.cy); if (dy >= q.r) continue; const hw = Math.sqrt(q.r * q.r - dy * dy); o = { x0: q.cx - hw, x1: q.cx + hw, y0, y1 }; }
      if (!(o.y1 > y0 && o.y0 < y1)) continue;
      iv = iv.flatMap(([a, c]) => o.x1 <= a || o.x0 >= c ? [[a, c]] : [[a, Math.min(c, o.x0)], [Math.max(a, o.x1), c]].filter(([p, q]) => q > p));
    }
    return iv.find(([a, c]) => a <= cx && cx <= c) || iv.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0] || [cx, cx];
  }
  /* fit a wording into the free space from baseline y: downwards (dir 1) or upwards from its last
     line (dir -1), taking as many lines as the space allows; returns where it went */
  function fitText(g, s, cx, L, R, y, { cls = 'ts-label', lh = 30, dir = 1, maxN = 4, top = GRID.top - 4, a = {}, edit } = {}) {
    // every number of lines the free space allows, each with the lane its height leaves
    const cand = [];
    for (let k = 1; k <= maxN; k++) {
      const y0 = dir > 0 ? y - ASC[cls] : y - (k - 1) * lh - ASC[cls], y1 = dir > 0 ? y + (k - 1) * lh + 8 : y + 8;
      if (y1 > FOOT || y0 < top) break;
      const [l, r] = lane(cx, L, R, y0, y1); if (r - l < 60) break;
      cand.push({ k, l, r, w: r - l });
    }
    // the given size with whole words if any count of lines takes it; then one size smaller with whole
    // words; only then the roomiest space, cut short (with a warning)
    const fits = (c, z) => wholeWords(s, z, c.w) && wrap(root, s, z, c.w).length <= c.k;
    let pick = cand.find(c => fits(c, cls)); if (pick) pick.use = cls;
    if (!pick) { pick = cand.find(c => fits(c, 'ts-tiny')); if (pick) pick.use = 'ts-tiny'; }
    if (!pick && cand.length) { const whole = cand.filter(c => wholeWords(s, 'ts-tiny', c.w)); pick = (whole.length ? whole : cand).reduce((m, c) => c.k * c.w > m.k * m.w ? c : m); pick.use = 'ts-tiny'; }
    if (!pick) { const [l, r] = lane(cx, L, R, y - ASC[cls], y + 8); pick = { k: 1, l, r: Math.max(r, l + 60), use: 'ts-tiny' }; }
    const useCls = pick.use;
    const nb = textBlock(g, (pick.l + pick.r) / 2, y, s, { cls: useCls, maxW: pick.r - pick.l, maxLines: pick.k, lh, anchor: 'middle', a, edit });
    if (nb.lines.join(' ').endsWith('…') && !String(s).endsWith('…')) ctx.warn(`“${String(s).slice(0, 24)}…” is too long for the space beside the lenses, so its end is cut. Shorten it.`);
    if (dir < 0 && nb.lines.length > 1) nb.el.setAttribute('y', y - (nb.lines.length - 1) * nb.lh);
    const yTop = dir < 0 ? y - (nb.lines.length - 1) * nb.lh : y;
    addBox((pick.l + pick.r - nb.w) / 2, yTop - (ASC[nb.cls] ?? 24), (pick.l + pick.r + nb.w) / 2, yTop + (nb.lines.length - 1) * nb.lh + 8, 4);
    return { ...nb, last: yTop + (nb.lines.length - 1) * nb.lh };
  }

  /* objects: one per state, with its name right under it */
  const DRAW = { block: solidBlock, bowl: liquidBowl, window: coldWindow, pan: panOnHob, dish, kettle };
  M.cols.forEach((c, j) => {
    const g = h('g', { s: at(j), cls: 'rise', c: [rcj(j), lensOn ? `${N}:soft` : null].filter(Boolean).join(',') || null }, root);
    const x = xs[j], sg = h('g', { transform: `translate(${x} ${BY}) scale(${SC}) translate(${-x} ${-BY})` }, g);
    const info = DRAW[c.kind](sg, x, BY, M.sub);
    c.info = { spot: [x + (info.spot[0] - x) * SC, BY + (info.spot[1] - BY) * SC] };
    partBoxes(sg, x);
    const tg = h('g', { c: offj(j) }, g);
    const nb = textBlock(tg, x, nameY, c.name, { cls: 'ts-label', maxW: nameW(j), maxLines: nameLines, lh: nameLh, anchor: 'middle', a: { fill: 'var(--ink)' }, edit: `text.label:obj${j}` });
    addBox(x - nb.w / 2, nameY - ASC[nb.cls], x + nb.w / 2, nameY + nb.h);
  });

  /* lenses take their place first, so the change labels fit around them */
  const LT = LY - LR - ctx.tk.pillH / 2;     // top of a state tag
  if (lensOn) for (const x of xs) { OBS.push({ cx: x, cy: LY, r: LR + 10 }); addBox(x - LR + 8, LT, x + LR - 8, LY); }

  /* changes: a heating (warm) or cooling (cool) arrow between neighbours, the change and its temperature */
  const aY = lensOn ? LY - 4 : BY - 210;
  M.chs.forEach(c => {
    const k = bi(`ch:${c.i}`), x0 = xs[c.i], x1 = xs[c.i + 1];
    const gap = lensOn ? LR + 14 : 128, ax0 = x0 + gap, ax1 = x1 - gap, cx = (ax0 + ax1) / 2;
    const col = c.heat ? 'var(--heat)' : 'var(--water)', tcol = c.heat ? 'var(--heat-text)' : 'var(--water-text)';
    const qa = bi(lensOn ? `lens:${c.i + 1}` : `ch:${c.i}`) + 1;
    const g = h('g', { c: qa < N ? `${qa}-${N}:off` : null }, root);
    arrow(ctx, g, `M${ax0} ${aY} Q ${cx} ${aY - 58} ${ax1} ${aY}`, ax1, aY, Math.atan2(58, (ax1 - ax0) / 2), col, 'var(--sw-arrow)', { draw: k, k: .9 });
    OBS.push({ x0: ax0, y0: aY - 32, x1: ax1, y1: aY + 14 });   // the arrow's own sweep (the labels sit just clear of it)
    // the change's name stacks upwards from just over the arrow; the temperature and its note go down
    fitText(g, c.word, cx, ax0, ax1, aY - 50, { dir: -1, maxN: 3, a: { fill: tcol, s: k, delay: 300 }, edit: `text.label:ch${c.i}` });
    const tt = fitText(g, (M.approx ? 'about ' : '') + degC(c.temp), cx, x0, x1, aY + 62, { cls: M.approx ? 'ts-label' : 'ts-num', lh: M.approx ? 30 : 40, maxN: 1, a: { fill: tcol, s: k, delay: 500, cls: 'strong' } });
    computed(tt.el, c.src);
    // a pure substance holds its temperature while it changes state; evaporation is not at one temperature
    const note = M.sub === 'water' && c.change !== 'evaporating' && c.change !== 'condensing' ? ['holds', 'temperature holds'] : c.change === 'condensing' ? ['cold', 'cold surface'] : null;
    if (note) fitText(g, txt(P, `label:${note[0]}`, note[1]), cx, x0, x1, tt.last + 40, { lh: 32, maxN: 5, a: { s: k, delay: 700, fill: 'var(--ink-2)' }, edit: `text.label:${note[0]}` });
  });

  /* lenses: the same particles, the same size, in every state */
  const L = [];
  if (lensOn) {
    // "not to scale" sits at the right of the title band; the engine keeps the title short of it
    const note = txt(P, 'label:scale', 'Zoomed in. Not to scale.');
    const sb = textBlock(root, GRID.right, GRID.titleY, note, { cls: 'ts-label', maxW: 380, maxLines: 2, lh: 30, anchor: 'end', a: { fill: 'var(--ink-2)', s: bi('lens:0') }, edit: 'text.label:scale' });
    if (sb.lines.length > 1) sb.el.setAttribute('y', GRID.titleY - (sb.lines.length - 1) * sb.lh);
    const rnd = rng(21);
    M.cols.forEach((c, j) => {
      const cx = xs[j], k = bi(`lens:${j}`); const [sx, sy] = c.info.spot;
      const bg = c.state === 'solid' ? SUBSTANCE_COLS[M.sub].lens : c.state === 'liquid' ? 'var(--liquid-bg)' : 'var(--air)';
      const m = magnifier(ctx, root, { id: `s${j}`, sx, sy, sr: 14, cx, cy: LY, r: LR, bg, a: { s: k, cls: 'pop', c: rcj(j) } });
      // the cone and spot ring link a lens to its object only while that lens is taught
      const qj = quietFrom(j); for (const el of [...m.g.children].slice(0, 3)) if (el.tagName !== 'defs') el.dataset.c = `${Math.min(qj, N)}:off`;
      // the state's name sits on the lens top: a pill, or a card of up to three lines inside the lens width
      const tagBottom = stateTag(m.g, cx, txt(P, `label:state${j}`, STATE_WORD[c.state]), `text.label:state${j}`, { c: offj(j) });
      // particles stay a radius plus the rim inside the lens, and clear of the state's name
      const top = tagBottom + 4;
      const inside = ([x, y]) => Math.hypot(x - cx, y - LY) < LR - R - 8 && y - R > top;
      let pts;
      if (c.state === 'solid') pts = particleLayout('solid', { x: cx - LR - R, y: LY - LR - R, w: 2 * LR + 2 * R, h: 2 * LR + 2 * R }).filter(inside);
      else if (c.state === 'liquid') {
        const surf = Math.max(LY - 38, top + 6);
        h('rect', { x: cx - LR, y: LY - LR, width: 2 * LR, height: surf - (LY - LR), fill: 'var(--air)' }, m.inner);
        pts = particleLayout('liquid', { x: cx - LR - R, y: surf, w: 2 * LR + 2 * R, h: LY + LR - surf + R }, { seed: 3 + j }).filter(inside);
        h('line', { x1: cx - LR, x2: cx + LR, y1: surf - 1, y2: surf - 1, stroke: 'var(--water)', 'stroke-width': 'var(--sw-rule)' }, m.inner);
      } else {
        pts = []; for (let tries = 0; pts.length < 8 && tries < 5000; tries++) {
          const a = rnd() * 6.283, d = Math.sqrt(rnd()) * (LR - R - 12), q = [cx + d * Math.cos(a), LY + d * Math.sin(a)];
          if (q[1] - R > top + 6 && pts.every(o => Math.hypot(o[0] - q[0], o[1] - q[1]) > 4 * R + 14)) pts.push(q);
        }
      }
      // particles go under the rim and the name, which were drawn into the lens group after its clip
      const parts = pts.map(([x, y], i) => {
        const va = rnd() * 6.283; const p = { hx: x, hy: y, x, y, vx: Math.cos(va), vy: Math.sin(va), ph: rnd() * 6.28, ph2: rnd() * 6.28, w1: 15 + rnd() * 9, w2: 15 + rnd() * 9, row: Math.round((LY + LR - y) / 21) };
        // a gas particle leaves a short trail in the still, showing it was moving
        if (c.state === 'gas') h('line', { x1: x - p.vx * 38, y1: y - p.vy * 38, x2: x, y2: y, stroke: 'var(--vapour)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', opacity: .4, cls: 'ghost' }, m.inner);
        p.el = h('circle', { cx: x, cy: y, r: R, fill: 'var(--particle)', stroke: 'var(--particle-edge)', 'stroke-width': 'var(--sw-hair)' }, m.inner);
        return p;
      });
      L.push({ j, cx, state: c.state, parts, k, quiet: quietFrom(j), top: top + R });
    });
  }
  /* a state name on the lens top: the kit pill when it fits the lens width, else a paper card that
     wraps it (up to three lines, then one size smaller) and grows down into the lens */
  function stateTag(p, cx, s, edit, a) {
    const ph = ctx.tk.pillH, pad = ctx.tk.pillPad, maxW = 2 * LR - 2 * pad - 16;
    const rim = () => h('circle', { cx, cy: LY, r: LR, fill: 'none', stroke: 'var(--lens-rim)', 'stroke-width': 'var(--sw-lens)' }, p);
    rim();
    if (measure(root, s, 'ts-label') <= maxW) { const pg = pill(ctx, p, cx, LY - LR, s, { edit, a }); return pg.box.y + pg.box.h; }
    const g = h('g', a, p);
    const nb = textBlock(g, cx, 0, s, { cls: 'ts-label', maxW, maxLines: 3, lh: 30, anchor: 'middle', a: { fill: 'var(--ink)' }, edit });
    const vp = 10, hh = nb.h + 2 * vp;
    g.insertBefore(h('rect', { x: cx - nb.w / 2 - pad, y: LT, width: nb.w + 2 * pad, height: hh, rx: 'var(--r-mark)', fill: 'var(--paper)', cls: 'lift body' }), nb.el);
    nb.el.setAttribute('y', LT + vp + ASC[nb.cls] + (nb.lh - ASC[nb.cls]) / 2 - 3);
    return LT + hh;
  }

  const set = (p, x, y) => { p.el.setAttribute('cx', x.toFixed(1)); p.el.setAttribute('cy', y.toFixed(1)); };
  const home = () => { for (const l of L) for (const p of l.parts) { p.x = p.hx; p.y = p.hy; set(p, p.hx, p.hy); } };
  return {
    dur: Object.fromEntries(items.map(it => [it.key, it.key.startsWith('lens') ? 3200 : 2600])),
    reset: home, still: home,
    tick(k, u, t, dt = 0) {
      if (t == null) return;
      for (const l of L) {
        if (k < l.k || k >= l.quiet) continue;
        // during the change that starts from this state, heating shakes it harder and cooling calms it
        const ch = M.chs.find(c => c.i === l.j && bi(`ch:${c.i}`) === k); const grow = ch ? (ch.heat ? 1 + eIO(u) : 1 - .5 * eIO(u)) : 1;
        if (l.state === 'solid') { const A = 1.6 * grow; for (const p of l.parts) set(p, p.hx + A * Math.sin(p.w1 * t + p.ph), p.hy + A * Math.cos(p.w2 * t + p.ph2)); }
        else if (l.state === 'liquid') { const S = 7 * grow; for (const p of l.parts) set(p, p.hx + S * Math.sin(.9 * t + p.row * 2.3) + 1.4 * Math.sin(p.w1 * t + p.ph), p.hy + 1.4 * Math.cos(p.w2 * t + p.ph2)); }
        else {
          const sp = 110 * grow, mx = LR - R - 8;
          for (const p of l.parts) {
            p.x += p.vx * sp * clamp(dt, 0, .05); p.y += p.vy * sp * clamp(dt, 0, .05);
            const dx = p.x - l.cx, dy = p.y - LY, d = Math.hypot(dx, dy);
            if (d > mx) { const nx = dx / d, ny = dy / d, dot = p.vx * nx + p.vy * ny; if (dot > 0) { p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny; } p.x = l.cx + nx * mx; p.y = LY + ny * mx; }
            if (p.y < l.top + 4) { p.y = l.top + 4; if (p.vy < 0) p.vy = -p.vy; }   // keep clear of the pill
            set(p, p.x, p.y);
          }
        }
      }
    },
  };
}

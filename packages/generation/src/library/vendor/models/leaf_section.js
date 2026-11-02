// Leaf cross-section (KS3, KS4): a leaf cut across, its layers named one build at a time from the top
// down: the upper epidermis (and, for KS4, the waxy cuticle), the palisade layer packed with
// chloroplasts, the spongy layer with its air spaces, a vein, and a stoma in the lower epidermis
// between two guard cells; then, optionally, the gases through the stoma. Every part is drawn where
// it is in a real leaf (truth by construction): chloroplasts in the palisade, spongy and guard cells
// only, never in the epidermis; stomata in the lower epidermis; carbon dioxide in, oxygen and water
// vapour out. Each name first shows as a letter on its leader (A, B, C ...), so a question slide
// asks pupils to name the parts and the names arrive at the reveal.
import {
  h, T, textBlock, arrow, rng,
  txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';

export const meta = {
  id: 'leaf_section', name: 'Leaf cross-section', kind: 'scene', version: 1,
  subjects: ['Science'],
  years: ['KS3', 'KS4'],
  teaches: 'Inside a leaf, cut across: the upper epidermis, the palisade layer full of chloroplasts, the spongy layer with air spaces, a vein, and stomata with guard cells in the lower epidermis, and how gases pass through a stoma.',
};

const PARTS = ['cuticle', 'epidermis', 'palisade', 'spongy', 'vein', 'guard', 'stoma'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Leaf cross-section',
  properties: {
    title: TITLE_PARAM('Inside a leaf'),
    level: { type: 'string', title: 'Key stage', enum: ['ks3', 'ks4'], 'x-labels': ['KS3: the layers and stomata', 'KS4: adds the waxy cuticle, mesophyll, xylem and phloem'], default: 'ks3' },
    labels: { type: 'string', title: 'Label wording', enum: ['jobs', 'names'], 'x-labels': ['Says what each part does (Spongy layer: air spaces let gases move)', 'Names only (Spongy layer)'], default: 'jobs' },
    vein: { type: 'boolean', title: 'Name the vein', default: true,
      description: 'A build naming the vein that brings water to the leaf (KS4: xylem and phloem).' },
    gases: { type: 'boolean', title: 'Show gases through the stoma', default: true,
      description: 'A last build: carbon dioxide diffuses in through the stoma; oxygen and water vapour diffuse out.' },
    // a name with its job is a phrase (60 letters): a teacher may reword it, never drop the part
    text: TEXT_PARAM_FOR(Object.fromEntries([...PARTS, 'co2', 'o2', 'water'].map(id => [id, 'phrase']))),
  },
};

export const presets = [
  { id: 'ks3-leaf-section', name: 'KS3: inside a leaf', params: { title: 'Inside a leaf' } },
  { id: 'ks3-name-the-parts', name: 'KS3: name the parts of a leaf', params: {
    title: 'Name the parts of a leaf', labels: 'names', gases: false,
  } },
  { id: 'ks4-leaf-tissues', name: 'KS4: leaf tissues and gas exchange', params: {
    title: 'Leaf tissues', level: 'ks4',
  } },
];

/* ------------------------------------------------------------------ words */
const WORDS = {
  ks3: {
    jobs: {
      cuticle: 'Waxy cuticle: cuts water loss', epidermis: 'Upper epidermis: thin and clear, lets light through',
      palisade: 'Palisade layer: packed with chloroplasts', spongy: 'Spongy layer: air spaces let gases move',
      vein: 'Vein: brings water to the leaf', guard: 'Guard cells open and close the stoma',
      stoma: 'Stoma: a pore that lets gases in and out',
      co2: 'Carbon dioxide in', o2: 'Oxygen out', water: 'Water vapour out',
    },
    names: {
      cuticle: 'Waxy cuticle', epidermis: 'Upper epidermis', palisade: 'Palisade layer', spongy: 'Spongy layer',
      vein: 'Vein', guard: 'Guard cells', stoma: 'Stoma', co2: 'Carbon dioxide', o2: 'Oxygen', water: 'Water vapour',
    },
  },
  ks4: {
    jobs: {
      cuticle: 'Waxy cuticle: cuts water loss', epidermis: 'Upper epidermis: thin and clear, lets light through',
      palisade: 'Palisade mesophyll: packed with chloroplasts', spongy: 'Spongy mesophyll: air spaces for diffusion',
      vein: 'Vein: xylem brings water, phloem takes sugars away', guard: 'Guard cells open and close the stoma',
      stoma: 'Stoma: lets gases diffuse in and out',
      co2: 'Carbon dioxide diffuses in', o2: 'Oxygen diffuses out', water: 'Water vapour diffuses out',
    },
    names: {
      cuticle: 'Waxy cuticle', epidermis: 'Upper epidermis', palisade: 'Palisade mesophyll', spongy: 'Spongy mesophyll',
      vein: 'Xylem and phloem', guard: 'Guard cells', stoma: 'Stoma', co2: 'Carbon dioxide', o2: 'Oxygen', water: 'Water vapour',
    },
  },
};
const label = (P, id) => txt(P, `label:${id}`, WORDS[P.level][P.labels][id]);

// a reworded label must still name its part (the science is in the name)
const MUST_NAME = {
  cuticle: /cuticle|wax/i, epidermis: /epiderm/i, palisade: /palisade/i, spongy: /spongy/i,
  vein: /vein|xylem|phloem|vascular/i, guard: /guard/i, stoma: /stom|pore/i,
  co2: /carbon dioxide|CO2|CO₂/i, o2: /oxygen|O2|O₂/i, water: /water/i,
};
const NAME = { cuticle: 'the cuticle', epidermis: 'the epidermis', palisade: 'the palisade layer', spongy: 'the spongy layer', vein: 'the vein', guard: 'the guard cells', stoma: 'the stoma', co2: 'carbon dioxide', o2: 'oxygen', water: 'water vapour' };
// What a part is not, read from a reworded label's words. Only a claim is refused: a match that a
// negation qualifies ("no chloroplasts", "not gases", "few air spaces") states the truth, so it stands.
const NEGATED = /\b(no|not|never|none|without|lacks?|lacking|isn't|doesn't|don't|does not|do not|free of)\b[^.;:]{0,24}$/i;
const SCARCE = /\b(few|little|small|tiny|hardly any|very few|no)\s+$/i;
/** Whether `t` claims `re`: some match of it that no negation (or, with `scarce`, no "few") qualifies. */
function claims(t, re, scarce) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of t.matchAll(g)) {
    const before = t.slice(0, m.index);
    if (NEGATED.test(before) || (scarce && SCARCE.test(before))) continue;
    return true;
  }
  return false;
}
const WRONG = {
  epidermis: [[[/chloroplasts?|photosynthes\w*|chlorophyll/i]], 'The upper epidermis has no chloroplasts and does not photosynthesise: it is thin and clear to let light through to the palisade cells.'],
  spongy: [[[/most (of the )?(chloroplasts|photosynthes\w*)|packed with chloroplasts/i]], 'Most photosynthesis happens in the palisade layer, not the spongy layer: spongy cells have fewer chloroplasts and air spaces between them.'],
  palisade: [[[/air spaces?/i, true], [/loosely/i], [/\b(no|few|fewest|hardly any)\s+chloroplasts/i, false, true]], 'Palisade cells are tightly packed with the most chloroplasts; the air spaces are in the spongy layer.'],
  stoma: [[[/water (comes )?(in|enters)|absorbs? water|takes? in water/i]], 'Water does not come in through the stomata: it comes up from the roots in the xylem. Stomata let gases in and out.'],
  vein: [[[/oxygen|carbon dioxide|\bair\b|gases/i]], 'The vein carries water (xylem) and sugars (phloem), not gases: gases move through the stomata and air spaces.'],
};
// A direction is read from direction words: "in" counts only as "in through", "in via" or at the
// end ("Oxygen in"), never in "made in photosynthesis".
const LEAVING = /\b(out|escap\w*|leav\w*|exit\w*|releas\w*|given off|gives? off|evaporat\w*)\b/i;
const ENTERING = /\b(into|enter\w*|absorb\w*|taken in|tak(e|es|ing) in|com(e|es|ing) in|go(es)? in|diffus\w* in|in (through|via|by))\b|\bin\s*$/i;
const GAS_WAY = {
  co2: ['in', 'Carbon dioxide diffuses into the leaf through the stoma, not out of it.'],
  o2: ['out', 'Oxygen made in photosynthesis diffuses out of the leaf through the stoma, not in.'],
  water: ['out', 'Water vapour diffuses out of the leaf through the stoma (transpiration), not in.'],
};

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  if (R.length) return result(R);
  for (const [id, re] of Object.entries(MUST_NAME)) {
    const t = P.text && P.text[`label:${id}`];
    if (t == null || t === '') continue;
    if (!re.test(t)) { R.push({ path: `text.label:${id}`, reason: `The label “${t}” no longer names ${NAME[id]}. Keep that word in it.` }); continue; }
    const w = WRONG[id];
    // a rule is [pattern, scarce, plain]: plain rules (a shortage stated as fact) skip the negation read
    if (w && w[0].some(([re, scarce, plain]) => (plain ? re.test(t) : claims(t, re, scarce)))) R.push({ path: `text.label:${id}`, reason: w[1] });
    const g = GAS_WAY[id];
    if (g && (g[0] === 'in' ? LEAVING.test(t) : ENTERING.test(t) && !LEAVING.test(t))) R.push({ path: `text.label:${id}`, reason: g[1] });
  }
  return result(R);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const ks4 = P.level === 'ks4';
  const S = [];
  S.push({ key: 'section', caption: 'A leaf cut across. It is only a few cells thick, in layers, and each layer has a job.',
    note: 'Ask what each letter might be before naming it. A leaf is thin so that gases have only a short way to diffuse and light reaches every layer.' });
  S.push({ key: 'epidermis', caption: ks4 ? 'On top: a waxy cuticle that cuts water loss, over the upper epidermis, thin and clear to let light through.' : 'On top: the upper epidermis, a thin, clear layer that lets light through.',
    note: 'Epidermis cells have no chloroplasts. The waxy cuticle on the outside is not made of cells; it stops the leaf drying out.' });
  S.push({ key: 'palisade', caption: 'Under it, the palisade layer: tall cells packed with chloroplasts, near the top where the light is brightest.',
    note: 'Most photosynthesis happens here. Chloroplasts contain chlorophyll, which absorbs light energy.' });
  S.push({ key: 'spongy', caption: 'Then the spongy layer: rounder cells with air spaces between them, so gases can move through the leaf.',
    note: 'Carbon dioxide diffuses from the air spaces into the cells. Spongy cells have fewer chloroplasts than palisade cells.' });
  if (P.vein) S.push({ key: 'vein', caption: ks4 ? 'A vein: xylem brings water to the leaf and phloem carries sugars away.' : 'A vein brings water to the leaf, and carries sugars away.',
    note: ks4 ? 'Xylem is dead, hollow and stiffened with lignin; phloem is living tissue that moves sucrose both ways (translocation).' : 'Veins also hold the leaf flat, like a skeleton.' });
  S.push({ key: 'stomata', caption: 'Underneath, the lower epidermis has tiny pores called stomata. Two guard cells open and close each one.',
    note: 'Most stomata are on the underside of a leaf, out of direct sun, so less water is lost. Guard cells are the only epidermis cells with chloroplasts.' });
  if (P.gases) S.push({ key: 'gases', caption: 'Carbon dioxide diffuses in through the stoma; oxygen and water vapour diffuse out.',
    note: 'Gases diffuse from where they are more concentrated to where they are less. Losing water vapour this way is transpiration.' });
  return { S, ks4, summary: 'A leaf is thin and layered: light reaches the palisade cells, gases move through the air spaces and in and out through the stomata.' };
}
export function builds(P) { const p = plan(P); return { steps: p.S.map(({ key, caption }) => ({ key, caption })), summary: { caption: p.summary } }; }
export function notes(P) {
  const p = plan(P);
  return { steps: p.S.map(s => s.note), summary: 'Ask: which layer does most photosynthesis, and why is it near the top? How does carbon dioxide reach it?' };
}

/* ------------------------------------------------------------------ render */
// The section sits left (x 96-640, y 150-450), its layers as horizontal bands; the names sit in a lane
// on the right (x 712 on), one per band, on straight leaders. Under the section: the guard cells and
// the stoma are named on the left, the gases on the right, fanning from the pore. Every name has its
// own lane, so none sits on another; a reworded name wraps in its lane and a cut is warned.
const X0 = 96, X1 = 640;
const Y = { cutTop: 148, epiTop: 156, palTop: 196, spoTop: 302, lowTop: 410, lowBot: 446, cutBot: 451 };
// the stoma takes the place of two epidermis cells, so no sliver of a cell is left beside it
const CELL = (X1 - X0) / 12, PORE = X0 + 9 * CELL, VEIN = { x: 250, y: 358, r: 40 };
const COLS = '--lf-cell:color-mix(in oklab, var(--life) 22%, var(--paper));--lf-wall:var(--life-shade);' +
  '--lf-chl:var(--life);--lf-epi:var(--paper);--lf-wax:color-mix(in oklab, var(--hue-gold) 45%, var(--paper));' +
  '--lf-air:color-mix(in oklab, var(--hue-blue) 8%, var(--paper));--lf-xy:color-mix(in oklab, var(--hue-blue) 30%, var(--paper));' +
  '--lf-ph:color-mix(in oklab, var(--hue-orange) 30%, var(--paper));--lf-co2:var(--ink-2);--lf-o2:var(--hue-teal);--lf-o2-text:var(--teal-text);' +
  '--lf-h2o:var(--hue-blue);--lf-h2o-text:var(--water-text)';

export function render(root, P, ctx) {
  const { ks4 } = plan(P); const b = ctx.b;
  const g0 = h('g', { style: COLS }, root);
  const cells = h('g', {}, g0);
  const marks = h('g', {}, g0);
  const tb = (p, x, y, s, o) => {
    const r = textBlock(p, x, y, s, o); const last = r.lines[r.lines.length - 1] || '';
    if (last.endsWith('…') && !String(s).trim().endsWith('…')) ctx.warn(`“${String(s).slice(0, 40)}” is too long for its space, so it is cut short. Shorten it.`);
    return r;
  };
  const wall = { stroke: 'var(--lf-wall)', 'stroke-width': 'var(--sw-rule)' };
  const chl = (p, x, y, rot = 0) => h('ellipse', { cx: x, cy: y, rx: 5.5, ry: 3.6, fill: 'var(--lf-chl)', transform: rot ? `rotate(${rot} ${x} ${y})` : null }, p);
  const sec = h('g', { s: b.section, cls: 'pop' }, cells);
  const spongy = [];

  /* the leaf's ground: air spaces show through where there are no cells */
  h('rect', { x: X0, y: Y.palTop, width: X1 - X0, height: Y.lowTop - Y.palTop, fill: 'var(--lf-air)' }, sec);
  /* waxy cuticle, top and bottom */
  h('rect', { x: X0, y: Y.cutTop, width: X1 - X0, height: Y.epiTop - Y.cutTop, rx: 3, fill: 'var(--lf-wax)' }, sec);
  h('rect', { x: X0, y: Y.lowBot, width: X1 - X0, height: Y.cutBot - Y.lowBot, rx: 2, fill: 'var(--lf-wax)' }, sec);
  /* upper epidermis: one row of flat, clear cells (no chloroplasts) */
  const epi = (y0, y1, gap) => {
    const n = 12, w = (X1 - X0) / n;
    for (let i = 0; i < n; i++) {
      const x = X0 + i * w;
      if (gap && x + w > gap[0] && x < gap[1]) {
        // cells either side of the stoma stop at the guard cells
        if (x < gap[0]) h('rect', { x: x + 1, y: y0 + 1, width: gap[0] - x - 2, height: y1 - y0 - 2, rx: 6, fill: 'var(--lf-epi)', ...wall }, sec);
        if (x + w > gap[1]) h('rect', { x: gap[1] + 1, y: y0 + 1, width: x + w - gap[1] - 2, height: y1 - y0 - 2, rx: 6, fill: 'var(--lf-epi)', ...wall }, sec);
        continue;
      }
      h('rect', { x: x + 1, y: y0 + 1, width: w - 2, height: y1 - y0 - 2, rx: 6, fill: 'var(--lf-epi)', ...wall }, sec);
    }
  };
  epi(Y.epiTop, Y.palTop);
  /* palisade: tall, tightly packed cells, chloroplasts lining their walls */
  {
    const n = 15, w = (X1 - X0) / n, y0 = Y.palTop + 3, y1 = Y.spoTop - 3;
    for (let i = 0; i < n; i++) {
      const x = X0 + i * w;
      h('rect', { x: x + 2, y: y0, width: w - 4, height: y1 - y0, rx: 12, fill: 'var(--lf-cell)', ...wall }, sec);
      for (let j = 0; j < 5; j++) { const cy = y0 + 14 + j * ((y1 - y0 - 28) / 4); chl(sec, x + 9, cy, 90); chl(sec, x + w - 9, cy, 90); }
    }
  }
  /* spongy: rounded cells, loosely packed, air spaces between; a gap above the stoma */
  {
    const r = rng(7); spongy.length = 0;
    const rows = [Y.spoTop + 22, Y.spoTop + 54, Y.spoTop + 86];
    rows.forEach((cy0, ri) => {
      for (let x = X0 + 26 + (ri % 2) * 26; x < X1 - 20; x += 54) {
        const cx = x + (r() - 0.5) * 8, cy = cy0 + (r() - 0.5) * 6;
        if (Math.hypot(cx - VEIN.x, cy - VEIN.y) < VEIN.r + 22) continue;
        if (Math.abs(cx - PORE) < 44 && ri === 2) continue;
        h('ellipse', { cx, cy, rx: 22, ry: 13, fill: 'var(--lf-cell)', ...wall, transform: `rotate(${Math.round((r() - 0.5) * 30)} ${cx} ${cy})` }, sec);
        chl(sec, cx - 9, cy - 3); chl(sec, cx + 8, cy + 4);
        if (ri === 0) spongy.push([cx, cy]);
      }
    });
  }
  /* vein: xylem (wide tubes) over phloem (small cells), in a ring of cells */
  const vg = h('g', {}, sec);
  h('circle', { cx: VEIN.x, cy: VEIN.y, r: VEIN.r, fill: 'var(--lf-cell)', ...wall }, vg);
  for (const [dx, dy, rr] of [[-14, -14, 8], [2, -18, 9], [17, -10, 8], [-4, -2, 7]]) h('circle', { cx: VEIN.x + dx, cy: VEIN.y + dy, r: rr, fill: 'var(--lf-xy)', ...wall }, vg);
  for (const [dx, dy] of [[-14, 16], [-2, 20], [10, 15], [20, 6], [-20, 6]]) h('circle', { cx: VEIN.x + dx, cy: VEIN.y + dy, r: 5, fill: 'var(--lf-ph)', ...wall }, vg);
  /* lower epidermis with a stoma: a pore between two guard cells (the only epidermis cells with chloroplasts) */
  const gap = [PORE - CELL, PORE + CELL];
  epi(Y.lowTop, Y.lowBot, gap);
  for (const side of [-1, 1]) {
    const cx = PORE + side * 22, cy = (Y.lowTop + Y.lowBot) / 2;
    h('ellipse', { cx, cy, rx: 15, ry: 19, fill: 'var(--lf-cell)', ...wall }, sec);
    chl(sec, cx + side * 3, cy - 7, 90); chl(sec, cx + side * 3, cy + 7, 90);
  }

  /* names: a leader from each part to its lane; a letter on the leader until the name is given */
  // a right-hand name never starts above the line under the one before it (`next`), so a name that
  // wraps pushes the ones below it down; its leader angles to keep its part
  let next = 0;
  const lane = (key, id, tx, want, px, py, opts = {}) => {
    const k = b[key]; if (k === undefined) return;
    const end = opts.anchor === 'end';
    const ty = end ? want : Math.max(want, next);
    const letter = String.fromCharCode(65 + lanes.length); lanes.push(id);
    const lx = end ? tx + 22 : tx - 22, ly = ty - 10;
    h('line', { x1: end ? lx + 18 : lx - 18, y1: ly, x2: px, y2: py, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)', s: b.section }, marks);
    h('circle', { cx: px, cy: py, r: 4, fill: 'var(--ink-2)', s: b.section }, marks);
    const lg = h('g', { s: b.section, hide: k }, marks);
    h('circle', { cx: lx, cy: ly, r: 17, fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-rule)' }, lg);
    T(lg, lx, ly + 8, letter, 'ts-small', { 'text-anchor': 'middle', fill: 'var(--ink)', cls: 'strong' });
    h('circle', { cx: lx, cy: ly, r: 5, fill: 'var(--ink-2)', s: k }, marks);
    const r = tb(h('g', { s: k, cls: 'rise' }, marks), tx, ty, label(P, id), { cls: 'ts-label', maxW: opts.maxW || 480, maxLines: 2, lh: 32, anchor: end ? 'end' : 'start', a: { fill: 'var(--ink)', cls: 'strong' }, edit: `text.label:${id}` });
    if (!end) next = ty + r.h + 10;
  };
  const lanes = [];
  const RX = 712;
  if (ks4) lane('epidermis', 'cuticle', RX, 150, X1 - 30, Y.cutTop + 4);
  lane('epidermis', 'epidermis', RX, 190, X1 - 30, (Y.epiTop + Y.palTop) / 2);
  lane('palisade', 'palisade', RX, 268, X1 - 28, 262);
  // the spongy leader ends on the right-most cell of its top row
  const sp = spongy.reduce((a, c) => (c[0] > a[0] ? c : a), [X0, Y.spoTop + 22]);
  lane('spongy', 'spongy', RX, 340, sp[0] + 6, sp[1]);
  lane('vein', 'vein', RX, 410, VEIN.x + 34, VEIN.y + 20);
  lane('stomata', 'guard', PORE - 84, 512, PORE - 30, Y.lowBot - 10, { anchor: 'end', maxW: PORE - 84 - X0 + 20 });
  lane('stomata', 'stoma', PORE - 84, 588, PORE, (Y.lowTop + Y.lowBot) / 2, { anchor: 'end', maxW: PORE - 84 - X0 + 20 });

  /* gases: fanning from the pore to their names on the right */
  if (b.gases !== undefined) {
    const k = b.gases; const gg = h('g', { s: k }, marks);
    const gas = (id, ty, col, txtCol, inward, delay, at) => {
      // each arrow meets the pore at its own point, so the heads do not pile up
      const ex = RX - 22, ey = ty - 10, sx = PORE + 10 + (at + 1) * 14, sy = Y.cutBot + 12 + (at + 1) * 4;
      const [ax, ay, bx, by] = inward ? [ex, ey, sx, sy] : [sx, sy, ex, ey];
      arrow(ctx, gg, `M${ax} ${ay} L ${bx} ${by}`, bx, by, Math.atan2(by - ay, bx - ax), col, 'var(--sw-arrow)', { draw: k, delay, dash: '2 14' });
      tb(h('g', { cls: 'rise', delay: delay + 200 }, gg), RX, ty, label(P, id), { cls: 'ts-label', maxW: 480, maxLines: 1, lh: 32, a: { fill: txtCol, cls: 'strong' }, edit: `text.label:${id}` });
    };
    // under the last name, one line apart, never past the foot of the stage
    const y0 = Math.min(Math.max(486, next + 8), 640 - 2 * 58);
    gas('co2', y0, 'var(--lf-co2)', 'var(--ink-2)', true, 0, -1);
    gas('o2', y0 + 58, 'var(--lf-o2)', 'var(--lf-o2-text)', false, 300, 0);
    gas('water', y0 + 116, 'var(--lf-h2o)', 'var(--lf-h2o-text)', false, 500, 1);
  }
  return {};
}

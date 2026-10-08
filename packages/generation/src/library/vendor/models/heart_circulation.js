// Heart, blood and exercise: where the heart is, the loop (or the double loop through the lungs),
// oxygen-rich and oxygen-poor blood in two meaning colours, what blood carries, and the pulse at
// rest and when running. Arteries always lead away from the heart and veins back: the code draws
// the direction, so the names can never be on the wrong vessel.
import {
  h, T, measure, clamp, eIO, lerp, scale, GRID, textBlock, editable, computed, arrow,
  txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { bodyOutline, organ } from '../kit/batch-D.js';

export const meta = {
  id: 'heart_circulation', name: 'Heart, blood and exercise', kind: 'scene', version: 1,
  subjects: ['Science', 'PE'],
  years: ['Y2', 'Y6'],
  teaches: 'The heart pumps blood round the body in vessels, to the lungs for oxygen and out to the body, and beats faster when we exercise.',
};

const CARRY = ['oxygen', 'food', 'water', 'carbonDioxide'];
const CARRY_WORDS = { oxygen: 'Oxygen', food: 'Food (nutrients)', water: 'Water', carbonDioxide: 'Carbon dioxide' };
const CARRY_LOWER = { oxygen: 'oxygen', food: 'food', water: 'water', carbonDioxide: 'carbon dioxide' };

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Heart, blood and exercise',
  properties: {
    title: TITLE_PARAM('How blood travels round the body'),
    detail: { type: 'string', title: 'How much to show', enum: ['double', 'simple'], 'x-labels': ['Heart and lungs loop (Year 6)', 'Simple loop: heart and body'], default: 'double',
      description: 'The heart and lungs loop shows blood going to the lungs to pick up oxygen.' },
    exercise: { type: 'string', title: 'Exercise', enum: ['rest', 'running'], 'x-labels': ['At rest only', 'At rest, then exercising'], default: 'rest',
      description: 'Exercising adds a step where the pulse rises.' },
    showPulse: { type: 'boolean', title: 'Show the pulse', description: 'Always shown when exercise is on.', default: true },
    pulse: {
      type: 'object', title: 'Pulse (beats a minute)', default: { rest: 85, active: 150 },
      properties: {
        rest: { type: 'integer', title: 'At rest', description: 'A child’s resting pulse is usually about 70 to 110.', minimum: 1, maximum: 400, default: 85 },
        active: { type: 'integer', title: 'When exercising', description: 'Higher than at rest; for a child, at most about 200.', minimum: 1, maximum: 400, default: 150 },
      },
    },
    vesselNames: { type: 'boolean', title: 'Name the arteries and veins', default: true },
    carries: {
      type: 'object', title: 'What blood carries', description: 'Adds a step listing what blood carries round the body.', default: {},
      properties: Object.fromEntries(CARRY.map(k => [k, { type: 'boolean', title: CARRY_WORDS[k], default: false }])),
    },
    showBody: { type: 'boolean', title: 'Show where the heart is in the body', default: true, 'x-panel': 'advanced' },
    // names on the slide are labels (40 letters); the body card holds a short phrase (60)
    text: TEXT_PARAM_FOR(Object.assign({ body: 'phrase' }, Object.fromEntries(
      ['heart', 'lungs', 'artery', 'vein', 'artery-lungs', 'vein-lungs', 'rich', 'poor', 'o2in', 'co2out', 'pulse', 'rest', 'running', 'carries']
        .concat(CARRY.map(c => 'carry-' + c)).map(id => [id, 'label'])))),
  },
};

export const presets = [
  { id: 'y2-exercise', name: 'Year 2: exercise and my heart', params: {
    title: 'Exercise and my heart', detail: 'simple', exercise: 'running', showPulse: true, vesselNames: false,
    pulse: { rest: 90, active: 150 }, carries: {},
  } },
  { id: 'y6-circulatory', name: 'Year 6: the circulatory system', params: {
    title: 'The circulatory system', detail: 'double', exercise: 'rest', showPulse: false, vesselNames: true,
    pulse: { rest: 80, active: 140 }, carries: { oxygen: true, food: true, water: true, carbonDioxide: true },
  } },
  { id: 'y6-running', name: 'Year 6: what happens when we run', params: {
    title: 'What happens when we run?', detail: 'double', exercise: 'running', showPulse: true, vesselNames: true,
    pulse: { rest: 80, active: 160 }, carries: {},
  } },
];

/* ------------------------------------------------------------------ the data */
function model(P) {
  const dbl = P.detail !== 'simple', run = P.exercise === 'running';
  const pulse = run || !!P.showPulse;
  const carries = CARRY.filter(k => P.carries && P.carries[k]);
  const rest = (P.pulse && P.pulse.rest) ?? 85, active = (P.pulse && P.pulse.active) ?? 150;
  const L = id => txt(P, 'label:' + id, DEF[id]);
  return { dbl, run, pulse, carries, rest, active, names: P.vesselNames !== false, L };
}
const DEF = {
  heart: 'Heart', lungs: 'Lungs', body: 'The rest of the body', artery: 'Artery', vein: 'Vein', 'artery-lungs': 'Artery', 'vein-lungs': 'Vein',
  rich: 'Oxygen-rich blood', poor: 'Oxygen-poor blood', o2in: 'Oxygen in', co2out: 'Carbon dioxide out',
  pulse: 'Beats a minute', rest: 'At rest', running: 'Running', carries: 'Blood carries',
};
const listWords = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const M = model(P);
  if (M.pulse || M.run) {
    if (M.rest < 60 || M.rest > 120) R.push({ path: 'pulse.rest', reason: `${M.rest} beats a minute is not a real resting pulse for a child. Use a number between about 60 and 120 (most children are 70 to 110).` });
    if (M.run) {
      if (M.active <= M.rest) R.push({ path: 'pulse.active', reason: `Exercise makes the heart beat faster, so the exercising pulse (${M.active}) has to be higher than the resting pulse (${M.rest}).` });
      else if (M.active > 200) R.push({ path: 'pulse.active', reason: `${M.active} beats a minute is too fast: a child’s heart rarely goes above about 200. Try 140 to 180.` });
      else if (M.active < M.rest + 20) R.push({ path: 'pulse.active', reason: `Running raises the pulse a lot, not just a few beats. Make it at least ${M.rest + 20} (most children reach 140 to 180).` });
    }
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P); const S = [];
  const art = M.names ? ' in arteries' : '', vn = M.names ? ' in veins' : '';
  S.push({ key: 'heart', caption: 'Your heart is a muscle in your chest. It pumps blood all the way round your body.',
    note: 'Ask pupils to put a hand on the middle of their chest, a little to the left. The heart is about the size of their fist.' });
  S.push({ key: 'out', caption: `Blood leaves the heart${art} and carries oxygen out to every part of the body.`,
    note: M.names ? 'Arteries always carry blood away from the heart. A way to remember it: A for artery, A for away.' : 'Blood travels in tubes called blood vessels. It never leaves them.' });
  S.push({ key: 'back', caption: `The body uses up the oxygen. Oxygen-poor blood comes back to the heart${vn}.`,
    note: (M.names ? 'Veins carry blood back to the heart. ' : '') + 'Oxygen-poor blood is dark red, not blue. Veins only look blue through the skin. The colours here are a key, not real colours.' });
  if (M.dbl) {
    S.push({ key: 'lungs', caption: `The heart pumps the oxygen-poor blood to the lungs${art ? ', in an artery' : ''}.`,
      note: 'The heart is two pumps side by side: one side sends blood to the lungs, the other to the body. The two sides never mix.' });
    S.push({ key: 'oxygen', caption: 'In the lungs, blood picks up oxygen and gets rid of carbon dioxide.',
      note: 'We breathe in air with oxygen and breathe out carbon dioxide. Blood goes through the heart twice on every trip round the body.' });
  }
  if (M.carries.length) S.push({ key: 'carries', caption: `Blood carries ${listWords(M.carries.map(k => CARRY_LOWER[k]))} round the body.`,
    note: 'Food (nutrients) is taken into the blood from the gut, and water too. Carbon dioxide is a waste gas taken back to the lungs.' });
  if (M.pulse) S.push({ key: 'pulse', caption: `Each squeeze of the heart is a beat, felt as your pulse: about ${M.rest} a minute at rest.`,
    note: 'Find the pulse on the inside of the wrist or the side of the neck. Count for 15 seconds and multiply by 4.' });
  if (M.run) S.push({ key: 'run', caption: `${M.L('running')}: muscles need more oxygen, so the heart beats faster, about ${M.active} a minute.`,
    note: `Pupils can measure their own pulse before and after a minute of exercise, then see how long it takes to fall back to about ${M.rest}. Breathing gets faster too.` });
  const summary = M.run ? `Exercise makes the heart beat faster (${M.rest} to ${M.active} a minute) to get more oxygen to muscles.`
    : M.dbl ? 'Two loops: the heart sends blood to the lungs to pick up oxygen, then out to the body.'
      : 'The heart pumps blood out to the body and back again, round and round, all day and all night.';
  return { M, S, summary };
}
export function builds(P) { const { S, summary } = plan(P); return { steps: S.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }
export function notes(P) {
  const { M, S } = plan(P);
  return { steps: S.map(s => s.note), summary: M.run ? 'Ask: why does your heart beat faster when you run? Why does it slow down again afterwards?' : 'Ask pupils to trace one drop of blood all the way round, naming each place it passes.' };
}

/* ------------------------------------------------------------------ render */
// layout: the lungs (top), a big two-sided heart with its vessel stubs (middle), the body card (bottom),
// with the key, pulse and "blood carries" in the right column. A small "where is it" figure shows in
// the first build only. Beads flow along every vessel so the loop reads as moving blood.
const COLX = 975, COLW = GRID.right - COLX;
const OL = 150, OR = 920;
const BODY = { x: 110, w: 850, y: 588, h: 52 };
const LY = 186;                       // lung centre line
const heartD = (x, y, k) => `M${x - k} ${y - 13 * k} C ${x + 5 * k} ${y - 18 * k} ${x + 19 * k} ${y - 15 * k} ${x + 19 * k} ${y - 3 * k} C ${x + 19 * k} ${y + 8 * k} ${x + 9 * k} ${y + 15 * k} ${x + 2 * k} ${y + 19 * k} C ${x - 6 * k} ${y + 15 * k} ${x - 18 * k} ${y + 6 * k} ${x - 18 * k} ${y - 4 * k} C ${x - 18 * k} ${y - 14 * k} ${x - 7 * k} ${y - 17 * k} ${x - k} ${y - 13 * k} Z`;
// one lung; s = +1 when its outer side faces right
const lungD = (cx, s) => { const y = LY; return `M${cx - s * 8} ${y - 60} C ${cx + s * 40} ${y - 56} ${cx + s * 66} ${y + 2} ${cx + s * 62} ${y + 52} Q ${cx + s * 20} ${y + 70} ${cx - s * 48} ${y + 60} C ${cx - s * 56} ${y + 30} ${cx - s * 38} ${y + 14} ${cx - s * 42} ${y - 14} C ${cx - s * 44} ${y - 42} ${cx - s * 30} ${y - 60} ${cx - s * 8} ${y - 60} Z`; };

export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b, N = ctx.N; const bi = k => b[k];
  const g0 = h('g', { style: '--o2-rich:var(--heat);--o2-rich-text:var(--heat-text);--o2-poor:var(--focus);--o2-poor-text:var(--focus-text)' }, root);
  const RICH = 'var(--o2-rich)', POOR = 'var(--o2-poor)';
  const VW = 'calc(var(--sw-arrow) * 3.2)', SW = 'calc(var(--sw-arrow) * 4.4)';
  const recede = k => ctx.rc(k, null, 'soft');
  // every label: wraps, then shrinks; if it still has to be cut, say so
  const tb = (p, x, y, s, o) => {
    const r = textBlock(p, x, y, s, o); const last = r.lines[r.lines.length - 1] || '';
    if (last.endsWith('…') && !String(s).trim().endsWith('…')) ctx.warn(`“${String(s).slice(0, 40)}” is too long for its space, so it is cut short. Shorten it.`);
    return r;
  };
  // a label in colour while its build is the point, then back to a readable ink (not faded)
  const phased = (k, x, y, s, o, col) => {
    textBlock(h('g', { s: bi(k) + 1 }, g0), x, y, s, Object.assign({}, o, { a: { fill: 'var(--ink-2)', cls: 'halo' } }));
    tb(h('g', { s: bi(k), hide: bi(k) + 1, cls: 'rise', style: 'pointer-events:none' }, g0), x, y, s, Object.assign({}, o, { a: { fill: col, cls: 'strong halo' } }));
  };

  /* geometry: the heart is the focal point and fills the middle */
  const dbl = M.dbl;
  const k = dbl ? 6.2 : 7.2, HX = 540, HY = dbl ? 454 : 392;
  const heartTop = HY - 16 * k, stubTop = heartTop - 12, TOPY = stubTop - 42;
  const vc = HX - 10.5 * k, pa = HX - 3 * k, pv = HX + 4.5 * k, ao = HX + 12 * k;
  const LXL = HX - 120, LXR = HX + 120, LB = LY + 60;

  /* where the heart is: a small figure, first build only */
  if (P.showBody !== false) {
    const fig = h('g', { s: bi('heart'), hide: bi('heart') + 1, cls: 'rise' }, g0);
    const body = bodyOutline(fig, { age: 'child', x: COLX + COLW / 2, top: 150, height: 420 });
    organ(fig, body, 'heart', { s: bi('heart'), cls: 'pop', delay: 300 });
  }

  /* the body: where blood delivers oxygen (flat card, plain outline) */
  const bodyG = h('g', { s: bi('out'), cls: 'rise' }, g0);
  const tmp = h('g', {}, g0); const one = textBlock(tmp, 0, 0, M.L('body'), { cls: 'ts-label', maxW: BODY.w - 40, maxLines: 1 }); tmp.remove();
  const bo = one.lines.length === 1 && !one.lines[0].endsWith('…') ? { cls: 'ts-label', maxLines: 1 } : { cls: 'ts-tiny', maxLines: 2, lh: 26 };
  const BY = BODY.y, nb = bo.maxLines === 1 ? 1 : 2, bh = nb === 1 ? BODY.h : 2 * 26 + 20;
  h('rect', { x: BODY.x, y: BY, width: BODY.w, height: bh, rx: 'var(--r-mark)', fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, bodyG);
  tb(bodyG, BODY.x + BODY.w / 2, nb === 1 ? BY + BODY.h / 2 + 10 : BY + 33, M.L('body'), Object.assign({ maxW: BODY.w - 40, anchor: 'middle', a: { fill: 'var(--ink)' }, edit: 'text.label:body' }, bo));

  /* lungs: lobed, with the windpipe and airways */
  if (dbl) {
    const lg = h('g', { s: bi('lungs'), cls: 'pop' }, g0);
    h('path', { d: `M${HX} ${GRID.top - 2} V ${LY - 34} M${HX} ${LY - 34} Q ${LXL + 70} ${LY - 34} ${LXL + 36} ${LY - 6} M${HX} ${LY - 34} Q ${LXR - 70} ${LY - 34} ${LXR - 36} ${LY - 6}`, fill: 'none', stroke: 'var(--ear)', 'stroke-width': 'calc(var(--sw-arrow) * 2.6)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, lg);
    for (const [cx, s] of [[LXL, -1], [LXR, 1]]) {
      h('path', { d: lungD(cx, s), fill: 'var(--ear)', cls: 'body' }, lg);
      h('path', { d: `M${cx - s * 36} ${LY - 6} L ${cx + s * 8} ${LY - 30} M${cx - s * 36} ${LY - 6} L ${cx + s * 30} ${LY + 4} M${cx - s * 36} ${LY - 6} L ${cx - s * 4} ${LY + 38} M${cx + s * 8} ${LY + 18} L ${cx + s * 22} ${LY + 40}`, fill: 'none', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, lg);
      h('path', { d: `M${cx + s * 58} ${LY + 4} Q ${cx + s * 8} ${LY + 8} ${cx - s * 26} ${LY + 52}`, fill: 'none', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)' }, lg);
    }
    const lo = { cls: 'ts-label', maxW: COLX - 24 - (LXR + 82), maxLines: 4, lh: 32 };
    const tl = h('g', {}, g0); const lm = textBlock(tl, 0, 0, M.L('lungs'), lo); tl.remove();
    tb(lg, LXR + 82, LY + 10 - (lm.lines.length - 1) * lm.lh / 2, M.L('lungs'), Object.assign({ a: { fill: 'var(--ink)' }, edit: 'text.label:lungs' }, lo));
    // gas exchange: oxygen in, carbon dioxide out (its own build)
    const gx = h('g', { s: bi('oxygen'), cls: 'rise', c: recede('oxygen') }, g0);
    const ax0 = LXL - 158, ax1 = LXL - 72;
    arrow(ctx, gx, `M${ax0} ${LY - 22} L ${ax1 - 12} ${LY - 22}`, ax1 - 12, LY - 22, 0, 'var(--ink-2)', 'var(--sw-struct)', { k: .9 });
    arrow(ctx, gx, `M${ax1} ${LY + 22} L ${ax0 + 12} ${LY + 22}`, ax0 + 12, LY + 22, Math.PI, 'var(--ink-2)', 'var(--sw-struct)', { k: .9 });
    const gw = ax0 - 12 - GRID.left;
    const tq = h('g', {}, g0); const om = textBlock(tq, 0, 0, M.L('o2in'), { cls: 'ts-label', maxW: gw, maxLines: 2, lh: 28 }); tq.remove();
    phased('oxygen', ax0 - 12, LY - 14 - (om.lines.length - 1) * om.lh, M.L('o2in'), { cls: 'ts-label', maxW: gw, maxLines: 2, lh: 28, anchor: 'end', edit: 'text.label:o2in' }, 'var(--o2-rich-text)');
    phased('oxygen', ax0 - 12, LY + 34, M.L('co2out'), { cls: 'ts-label', maxW: gw, maxLines: 2, lh: 28, anchor: 'end', edit: 'text.label:co2out' }, 'var(--ink)');
  }

  /* vessels: each draws in its own build, arrowhead at the destination; earlier ones step back */
  const flows = [];
  const vessel = (kk, d, ex, ey, ang, col) => {
    arrow(ctx, g0, d, ex, ey, ang, col, VW, { draw: bi(kk), k: 1.5, g: { c: recede(kk) } });
    const mp = h('path', { d, fill: 'none', stroke: 'none' }, g0); const L = mp.getTotalLength();
    const gap = 46, n = Math.max(1, Math.floor((L - 30) / gap));
    const g = h('g', { s: bi(kk), delay: 900, c: recede(kk) }, g0);
    const dots = Array.from({ length: n }, () => h('circle', { r: 4, fill: 'var(--paper)' }, g));
    const place = off => dots.forEach((c, i) => { const p = mp.getPointAtLength((i * gap + off) % (n * gap)); c.setAttribute('cx', p.x.toFixed(1)); c.setAttribute('cy', p.y.toFixed(1)); });
    place(gap / 2); flows.push({ place, gap });
  };
  vessel('back', `M${OL} ${BY - 2} L ${OL} ${TOPY + 24} Q ${OL} ${TOPY} ${OL + 24} ${TOPY} L ${vc - 24} ${TOPY} Q ${vc} ${TOPY} ${vc} ${TOPY + 24} L ${vc} ${stubTop - 16}`, vc, stubTop - 16, Math.PI / 2, POOR);
  vessel('out', `M${ao} ${stubTop} L ${ao} ${TOPY + 24} Q ${ao} ${TOPY} ${ao + 24} ${TOPY} L ${OR - 24} ${TOPY} Q ${OR} ${TOPY} ${OR} ${TOPY + 24} L ${OR} ${BY - 18}`, OR, BY - 18, Math.PI / 2, RICH);
  if (dbl) {
    vessel('lungs', `M${pa} ${stubTop} L ${pa} ${TOPY - 10} C ${pa} ${TOPY - 34} ${LXL + 52} ${LB + 30} ${LXL + 46} ${LB + 6}`, LXL + 46, LB + 6, Math.atan2(-24, -6), POOR);
    vessel('oxygen', `M${LXR - 46} ${LB + 6} C ${LXR - 52} ${LB + 30} ${pv} ${TOPY - 34} ${pv} ${TOPY - 10} L ${pv} ${stubTop - 16}`, pv, stubTop - 16, Math.PI / 2, RICH);
  }

  /* the heart: a muscle with two sides that never mix, and the big vessels leaving its top */
  const hg = h('g', { s: bi('heart'), cls: 'pop' }, g0);
  // the great vessels leave the top as hollow tubes, filled with blood once their vessel has been shown
  const stubs = [[vc, 'back', POOR], [ao, 'out', RICH]].concat(dbl ? [[pa, 'lungs', POOR], [pv, 'oxygen', RICH]] : []);
  for (const [sx, kk, col] of stubs) {
    const ln = (st, w, a) => h('line', Object.assign({ x1: sx, x2: sx, y1: stubTop - 2, y2: HY - 8 * k, stroke: st, 'stroke-width': w }, a), hg);
    ln('var(--berry-shade)', SW); ln('var(--ear)', VW); ln(col, VW, { s: bi(kk), delay: 700 });
  }
  h('path', { d: heartD(HX, HY, k), fill: 'var(--berry-shade)', cls: 'body' }, hg);
  const cid = `${ctx.uid}-hc`; const cp = h('clipPath', { id: cid }, h('defs', {}, hg));
  h('path', { d: heartD(HX + .6 * k, HY + 1.4 * k, k * .8) }, cp);
  const inner = h('g', { 'clip-path': `url(#${cid})` }, hg);
  const sep = HX + .6 * k, x0 = HX - 15 * k, w = 31.5 * k, iy = HY - 14 * k, ih = 31.5 * k;
  h('rect', { x: x0, y: iy, width: w, height: ih, fill: 'var(--ear)' }, inner);
  h('rect', { x: x0, y: iy, width: sep - x0, height: ih, fill: POOR, s: bi('back'), cls: 'pop' }, inner);
  h('rect', { x: sep, y: iy, width: x0 + w - sep, height: ih, fill: RICH, s: bi(dbl ? 'oxygen' : 'out'), cls: 'pop' }, inner);
  h('rect', { x: sep - .9 * k, y: iy, width: 1.8 * k, height: ih, fill: 'var(--berry-shade)' }, inner);
  const hlx = HX - 18 * k - 18;
  const ho = { cls: 'ts-label', maxW: hlx - OL - 24, maxLines: 3, lh: 30 };
  const th = h('g', {}, g0); const hm = textBlock(th, 0, 0, M.L('heart'), ho); th.remove();
  tb(hg, hlx, HY + 12 * k - (hm.lines.length - 1) * hm.lh, M.L('heart'), { ...ho, anchor: 'end', a: { fill: 'var(--ink)', cls: 'strong' }, edit: 'text.label:heart' });

  /* vessel names: artery = away, vein = back (placed by the direction the code draws) */
  if (M.names) {
    const nmo = (maxW, anchor) => ({ cls: 'ts-label', maxW, maxLines: 2, lh: 30, anchor });
    const vy = TOPY + 64;
    phased('back', OL + 22, vy, M.L('vein'), Object.assign(nmo(HX - 18 * k - OL - 50, 'start'), { edit: 'text.label:vein' }), 'var(--o2-poor-text)');
    phased('out', OR - 22, vy, M.L('artery'), Object.assign(nmo(OR - (HX + 19 * k) - 50, 'end'), { edit: 'text.label:artery' }), 'var(--o2-rich-text)');
    if (dbl) {
      // the vessels to and from the lungs have their own names, so renaming the body's never renames these
      phased('lungs', pa - 60, TOPY - 16, M.L('artery-lungs'), Object.assign(nmo(pa - 60 - GRID.left, 'end'), { maxLines: 1, edit: 'text.label:artery-lungs' }), 'var(--o2-poor-text)');
      phased('oxygen', pv + 58, TOPY - 16, M.L('vein-lungs'), Object.assign(nmo(COLX - 24 - pv - 58, 'start'), { maxLines: 1, edit: 'text.label:vein-lungs' }), 'var(--o2-rich-text)');
    }
  }

  /* right column: the key, then the pulse at rest and when exercising, or what blood carries */
  let yC = GRID.top + 24;
  [['rich', RICH, 'out'], ['poor', POOR, 'back']].forEach(([id, col, kk]) => {
    const g = h('g', { s: bi(kk), cls: 'rise' }, g0);
    h('line', { x1: COLX, x2: COLX + 26, y1: yC - 10, y2: yC - 10, stroke: col, 'stroke-width': VW, 'stroke-linecap': 'round' }, g);
    const r = tb(g, COLX + 40, yC, M.L(id), { cls: 'ts-label', maxW: COLW - 40, maxLines: 2, lh: 32, a: { fill: 'var(--ink)' }, edit: `text.label:${id}` });
    yC += r.h + 14;
  });
  yC += 4;
  const counters = []; const yList = yC;
  const BX = scale(0, 200, 0, COLW);
  if (M.pulse) {
    const pg = h('g', { s: bi('pulse'), cls: 'rise' }, g0);
    const ht = tb(pg, COLX, yC + 30, M.L('pulse'), { cls: 'ts-label', maxW: COLW, maxLines: 2, lh: 32, a: { fill: 'var(--ink-2)', cls: 'strong' }, edit: 'text.label:pulse' });
    let y0 = yC + 30 + ht.h - 32 + 8;
    const row = (g, id, val, path, col, yy) => {
      const lab = tb(g, COLX, yy + 32, M.L(id), { cls: 'ts-label', maxW: COLW, maxLines: 2, lh: 28, a: { fill: 'var(--ink)' }, edit: `text.label:${id}` });
      const dy = lab.h - lab.lh;
      const n = computed(T(g, COLX, yy + 82 + dy, String(val), 'ts-big', { fill: 'var(--ink)' }), path);
      h('rect', { x: COLX, y: yy + 94 + dy, width: COLW, height: 14, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
      const bar = h('rect', { x: COLX, y: yy + 94 + dy, width: BX(clamp(val, 0, 200)), height: 14, fill: col }, g);
      return { n, bar, dy };
    };
    y0 += row(pg, 'rest', M.rest, 'pulse.rest', 'var(--ink-2)', y0).dy + 118;
    if (M.run) {
      const rg = h('g', { s: bi('run'), cls: 'rise' }, g0);
      const r = row(rg, 'running', M.active, 'pulse.active', 'var(--energy)', y0);
      counters.push({ k: bi('run'), ...r });
      y0 += r.dy + 118;
    }
    if (y0 > GRID.bottom + 4) ctx.warn('The pulse panel runs past the stage.');
    yC = y0 + 12;
  }
  if (M.carries.length) {
    // with the pulse shown, the list has its own build and then gives the column to the pulse panel
    if (M.pulse) yC = yList;
    const cg = h('g', Object.assign({ s: bi('carries'), cls: 'rise' }, M.pulse ? { hide: bi('pulse') } : {}), g0);
    const ch = tb(cg, COLX, yC + 30, M.L('carries'), { cls: 'ts-label', maxW: COLW, maxLines: 2, lh: 30, a: { fill: 'var(--ink-2)', cls: 'strong' }, edit: 'text.label:carries' });
    let yy = yC + 30 + ch.h - ch.lh;
    M.carries.forEach(c => {
      yy += 40;
      h('circle', { cx: COLX + 8, cy: yy - 9, r: 8, fill: c === 'oxygen' ? RICH : c === 'carbonDioxide' ? POOR : 'var(--ink-3)' }, cg);
      const r = tb(cg, COLX + 28, yy, txt(P, 'label:carry-' + c, CARRY_WORDS[c]), { cls: 'ts-cap', maxW: COLW - 28, maxLines: 2, lh: 28, a: { fill: 'var(--ink)' }, edit: `text.label:carry-${c}` });
      yy += r.h - 28;
    });
    if (yy > GRID.bottom + 4) ctx.warn('“Blood carries” list runs past the stage.');
  }

  /* the running pulse counts up from the resting pulse; beads keep flowing round the loop */
  const setRun = (c, v) => { c.n.textContent = String(Math.round(v)); c.bar.setAttribute('width', BX(clamp(v, 0, 200))); };
  const flowAt = t => flows.forEach(f => f.place((t * 55) % f.gap));
  return {
    dur: { run: 1800 },
    still() { counters.forEach(c => setRun(c, M.active)); flows.forEach(f => f.place(f.gap / 2)); },
    reset() { counters.forEach(c => setRun(c, M.rest)); },
    tick(kk, u, t) {
      for (const c of counters) { if (kk === c.k) setRun(c, lerp(M.rest, M.active, eIO(u))); else if (kk > c.k) setRun(c, M.active); }
      if (t != null) flowAt(t);
    },
  };
}

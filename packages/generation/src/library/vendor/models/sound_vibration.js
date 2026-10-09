// Sound and vibration: a source vibrates (drum, string, voice or tuning fork), the particles of
// the medium (air, water or a solid) pass the vibration on, each one only wobbling back and forth
// on the spot, and it reaches the ear. One optional change: louder, quieter, higher, lower pitch,
// or a listener further away. A vacuum has no particles, so nothing is heard.
// Built only on the kit. Particle motion is a longitudinal wave: each particle moves along the
// line of travel about its own rest place, and the size of the wobble fades with distance.
import {
  h, T, measure, clamp, rng, overlaps, GRID,
  textBlock, headD, lanePlace,
  editable, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { apparatus, vibString } from '../kit/batch-E.js';

export const meta = {
  id: 'sound_vibration', name: 'Sound and vibration', kind: 'scene', version: 1,
  subjects: ['Science'],
  years: ['Y4', 'Y5', 'Y6', 'KS3'],
  teaches: 'Sound is a vibration passed on from particle to particle to the ear; bigger vibrations are louder, faster ones are higher, and it fades with distance.',
};

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Sound and vibration',
  properties: {
    title: TITLE_PARAM('How do we hear sounds?'),
    source: { type: 'string', title: 'What makes the sound', enum: ['drum', 'string', 'voice', 'fork'],
      'x-labels': ['A drum', 'A guitar string', 'A person’s voice', 'A tuning fork'], default: 'drum' },
    medium: { type: 'string', title: 'What the sound travels through', enum: ['air', 'water', 'solid', 'vacuum'],
      'x-labels': ['Air', 'Water', 'A solid (a wooden table)', 'Nothing at all (a vacuum)'], default: 'air' },
    change: { type: 'string', title: 'What changes in the last step', enum: ['none', 'louder', 'quieter', 'higher', 'lower', 'further'],
      'x-labels': ['Nothing', 'Louder', 'Quieter', 'Higher pitch', 'Lower pitch', 'The listener moves further away'], default: 'none' },
    pitchBy: { type: 'string', title: 'How the pitch is changed', description: 'Used only when the pitch changes. Higher pitch makes it shorter (or smaller) or tighter; lower pitch makes it longer (or bigger) or looser.',
      enum: ['length', 'tightness'], 'x-labels': ['Its length or size', 'How tight it is'], default: 'length' },
    vocabulary: { type: 'string', title: 'Words used', enum: ['everyday', 'science'],
      'x-labels': ['Everyday words (bigger, faster vibrations)', 'Science words too (amplitude, frequency)'], default: 'everyday' },
    followParticle: { type: 'boolean', title: 'Follow one particle (it stays in place)', default: true },
    trace: { type: 'boolean', title: 'Show the vibration at the ear as a wave line', default: true, 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y4-hear-drum', name: 'Year 4: how we hear a drum', params: {
    title: 'How do we hear a drum?', source: 'drum', medium: 'air', change: 'louder', vocabulary: 'everyday', followParticle: true,
  } },
  { id: 'y4-string-pitch', name: 'Year 4: pitch on a guitar string', params: {
    title: 'Changing the pitch of a string', source: 'string', medium: 'air', change: 'higher', pitchBy: 'length', vocabulary: 'everyday', followParticle: false,
  } },
  { id: 'y4-further-away', name: 'Year 4: quieter further away', params: {
    title: 'Why are sounds quieter far away?', source: 'voice', medium: 'air', change: 'further', vocabulary: 'everyday', followParticle: false,
  } },
  { id: 'ks3-vacuum', name: 'KS3: no sound in a vacuum', params: {
    title: 'Can sound travel through a vacuum?', source: 'fork', medium: 'vacuum', change: 'none', vocabulary: 'science', followParticle: false,
  } },
];

/* ------------------------------------------------------------------ words */
const SRC = {
  drum: { name: 'Drum', part: 'skin', parts: 'skin', act: 'Hit the drum: its skin vibrates, moving quickly up and down.',
    hard: 'Hit it harder', soft: 'Hit it gently', shorter: 'A smaller drum', longer: 'A bigger drum', tighter: 'A tighter drum skin', looser: 'A looser drum skin' },
  string: { name: 'Guitar string', part: 'string', parts: 'string', act: 'Pluck the string: it vibrates, moving quickly up and down.',
    hard: 'Pluck it harder', soft: 'Pluck it gently', shorter: 'A shorter string', longer: 'A longer string', tighter: 'A tighter string', looser: 'A looser string' },
  voice: { name: 'Voice box', part: 'vocal cords', parts: 'vocal cords', act: 'When you speak, your vocal cords vibrate inside your throat.',
    hard: 'Speak louder', soft: 'Speak softly', shorter: 'Shorter vocal cords', longer: 'Longer vocal cords', tighter: 'Tighter vocal cords', looser: 'Looser vocal cords' },
  fork: { name: 'Tuning fork', part: 'prongs', parts: 'prongs', act: 'Strike the tuning fork: its prongs vibrate, moving quickly in and out.',
    hard: 'Strike it harder', soft: 'Strike it gently', shorter: 'Shorter prongs', longer: 'Longer prongs', tighter: 'Tighter prongs', looser: 'Looser prongs' },
};
const MED = {
  air: { name: 'Air particles', the: 'the air', parts: 'air particles' },
  water: { name: 'Water particles', the: 'the water', parts: 'water particles' },
  solid: { name: 'Particles in the table', the: 'the table', parts: 'particles in the table' },
  vacuum: { name: 'A vacuum: no particles', the: 'nothing', parts: '' },
};
const isPitch = c => c === 'higher' || c === 'lower';
// vocal cords and prongs are plural: "the prongs vibrate", "shorter prongs vibrate"
const vib = P => P.source === 'voice' || P.source === 'fork' ? 'vibrate' : 'vibrates';
// the direction follows from the pitch change, so the two settings can never disagree
const pitchWay = P => !isPitch(P.change) ? null
  : P.pitchBy === 'tightness' ? (P.change === 'higher' ? 'tighter' : 'looser') : (P.change === 'higher' ? 'shorter' : 'longer');
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const low1 = s => s.charAt(0).toLowerCase() + s.slice(1);

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  // in a vacuum a change is still allowed: the source changes, but nothing is heard either way
  if (isPitch(P.change) && P.source === 'fork' && P.pitchBy === 'tightness')
    R.push({ path: 'pitchBy', reason: 'A tuning fork has nothing to tighten or loosen: its pitch is set by the length of its prongs. Choose its length or size.' });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const S = SRC[P.source], M = MED[P.medium], vac = P.medium === 'vacuum', sci = P.vocabulary === 'science';
  const steps = [{ key: 'source', caption: S.act }];
  steps.push({ key: 'pass', caption: vac ? 'In a vacuum there are no particles, so nothing can pass the vibration on.'
    : `The vibrating ${S.part} ${S.part === 'skin' || S.part === 'string' ? 'pushes' : 'push'} the ${M.parts} next to ${S.part === 'skin' || S.part === 'string' ? 'it' : 'them'}, and they pass the vibration on.` });
  if (!vac && P.followParticle) steps.push({ key: 'inplace', caption: `Each particle only wobbles back and forth on the spot. The vibration travels, not ${M.the}.` });
  steps.push({ key: 'ear', caption: vac ? 'Nothing reaches the ear, so we hear nothing at all.' : 'The vibration reaches the ear. The eardrum vibrates too, and we hear the sound.' });
  const c = P.change;
  if (vac && c !== 'none') {
    const still = 'but with no particles to pass it on we still hear nothing.';
    steps.push({ key: 'change', caption: c === 'further' ? 'Further away we still hear nothing: there are no particles to pass the vibration on.'
      : c === 'louder' ? `${S.hard}: the ${S.part} ${vib(P)} more, ${still}` : c === 'quieter' ? `${S.soft}: the ${S.part} ${vib(P)} less, ${still}`
      : `${S[pitchWay(P)]} ${vib(P)} ${c === 'higher' ? 'faster' : 'more slowly'}, ${still}` });
  }
  if (!vac && c !== 'none') {
    let cap;
    if (c === 'louder') cap = sci ? `${S.hard}: a bigger amplitude (bigger vibrations) makes a louder sound.` : `${S.hard}: bigger vibrations make a louder sound.`;
    else if (c === 'quieter') cap = sci ? `${S.soft}: a smaller amplitude (smaller vibrations) makes a quieter sound.` : `${S.soft}: smaller vibrations make a quieter sound.`;
    else if (c === 'higher') cap = sci ? `${S[pitchWay(P)]} ${vib(P)} faster: a higher frequency makes a higher pitch.` : `${S[pitchWay(P)]} ${vib(P)} faster, and faster vibrations make a higher pitch.`;
    else if (c === 'lower') cap = sci ? `${S[pitchWay(P)]} ${vib(P)} more slowly: a lower frequency makes a lower pitch.` : `${S[pitchWay(P)]} ${vib(P)} more slowly, and slower vibrations make a lower pitch.`;
    else cap = 'Further away the vibrations have spread out and got smaller, so the sound is quieter.';
    steps.push({ key: 'change', caption: cap });
  }
  const summary = vac ? 'Sound needs particles to pass it on, so sound can’t travel through a vacuum.'
    : 'Sound is a vibration passed on from particle to particle, from the source to the ear.';
  return { steps, summary };
}
export function builds(P) { const p = plan(P); return { steps: p.steps, summary: { caption: p.summary } }; }

export function notes(P) {
  const vac = P.medium === 'vacuum';
  const N = {
    source: 'Every sound starts with something vibrating. Let children feel it: a hand on the throat while humming, rice on a drum skin, a tuning fork touched to water.',
    pass: vac ? 'The classic demonstration is a ringing bell in a jar as the air is pumped out: the bell still vibrates, but the sound fades away. In space, astronauts use radios.'
      : P.medium === 'water' ? 'Sound travels through water about four times faster than through air, which is how whales and swimmers hear underwater. The picture is not to scale: real particles are far too small to see.'
      : P.medium === 'solid' ? 'Sound travels well through solids, faster than through air: try an ear on the table while someone taps the far end. The picture is not to scale.'
      : 'The particles are drawn hugely magnified and far fewer than really there. Not to scale: sound crosses a classroom in about a fiftieth of a second.',
    inplace: 'A common misconception is that the air itself flows to the ear. Watch the purple particle: it wobbles about its dashed ring and never leaves. Ask: if air flowed, would a loud sound feel like a wind?',
    ear: vac ? 'The ear gets no vibration at all, so the wave line at the ear is flat.' : 'The vibration makes the eardrum vibrate; tiny bones and the inner ear pass it on, and nerves carry a message to the brain. The wave line shows how the eardrum moves over time.',
    change: vac ? 'The source still changes, but a vibration needs particles to travel. No change to the source or the distance can carry sound across a vacuum.'
      : P.change === 'further' ? 'The vibration spreads out in all directions, so further away each particle wobbles less: the sound is quieter. Sound fades with distance, it never gets louder further away.'
      : isPitch(P.change) ? 'Pitch depends on how fast the source vibrates (its frequency). Shorter, tighter, smaller or thinner sources vibrate faster and sound higher. The loudness has not changed.'
      : 'Loudness depends on how big the vibrations are (their amplitude). The pitch has not changed: the vibrations are just as fast.',
  };
  return { steps: plan(P).steps.map(s => N[s.key]), summary: vac ? 'Sound needs a medium (a solid, liquid or gas). Light can cross a vacuum, sound can’t: that is why we see the Sun but can’t hear it.' : 'Ask the class to explain, step by step, how the sound got from the source to the ear, using the word “vibrate”.' };
}

/* ------------------------------------------------------------------ geometry */
const TRACE = { x: 800, y: 96, w: GRID.right - 800, h: 152 };
const BENCH_Y = 520, FLOOR = 586, BAND = { y0: 256, y1: 476 }, LAB_Y = 622, R = 12;
const F0 = 1.0, LAM0 = 300, A0 = 17;
const RA = 12, AIR_DX = 54;   // air particles: few, big, evenly spaced   // calm on-screen vibration: about one wobble a second

/** A listener seen side-on, facing the source, the ear in the middle of the head. */
function listener(p, x, a = {}) {
  const g = h('g', a, p);
  h('rect', { x: x - 16, y: 370, width: 32, height: 34, fill: 'var(--person-1)' }, g);
  h('path', { d: `M${x - 64} ${FLOOR} V 446 Q ${x - 64} 398 ${x - 14} 396 H ${x + 14} Q ${x + 64} 398 ${x + 64} 446 V ${FLOOR} Z`, fill: 'var(--cloth-1)', cls: 'body' }, g);
  h('circle', { cx: x, cy: 330, r: 50, fill: 'var(--person-1)', cls: 'body' }, g);
  h('path', { d: `M${x - 46} 314 L ${x - 60} 338 L ${x - 46} 342 Z`, fill: 'var(--person-1)' }, g);
  h('path', { d: `M${x - 18} 286 Q ${x + 30} 268 ${x + 52} 318 Q ${x + 40} 300 ${x + 4} 296 Z`, fill: 'var(--ink-2)' }, g);
  const ear = h('g', {}, g);
  h('path', { d: `M${x + 2} 316 Q ${x + 22} 304 ${x + 24} 330 Q ${x + 24} 352 ${x + 6} 352 Q ${x + 12} 340 ${x + 8} 332 Z`, fill: 'var(--ear)', stroke: 'var(--berry-shade)', 'stroke-width': 'var(--sw-hair)' }, ear);
  h('circle', { cx: x + 10, cy: 332, r: 3.5, fill: 'var(--ink-2)' }, ear);
  return { g, ear, box: { x: x - 64, y: 276, w: 128, h: FLOOR - 276 }, earAt: [x + 12, 332] };
}

/** A speaker seen side-on, facing right, with the voice box marked in the throat. */
function speaker(p, x) {
  const g = h('g', {}, p);
  h('rect', { x: x - 14, y: 370, width: 30, height: 40, fill: 'var(--person-2)' }, g);
  h('path', { d: `M${x - 64} ${FLOOR} V 446 Q ${x - 64} 404 ${x - 14} 402 H ${x + 14} Q ${x + 64} 404 ${x + 64} 446 V ${FLOOR} Z`, fill: 'var(--cloth-2)', cls: 'body' }, g);
  h('circle', { cx: x, cy: 330, r: 50, fill: 'var(--person-2)', cls: 'body' }, g);
  h('path', { d: `M${x + 46} 314 L ${x + 60} 338 L ${x + 46} 342 Z`, fill: 'var(--person-2)' }, g);
  h('path', { d: `M${x + 18} 286 Q ${x - 30} 268 ${x - 52} 318 Q ${x - 40} 300 ${x - 4} 296 Z`, fill: 'var(--ink-2)' }, g);
  h('path', { d: `M${x + 36} 352 Q ${x + 44} 356 ${x + 48} 352`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  return g;
}

/** Rest places of the medium's particles. Air: far apart; water: touching, jumbled; solid: touching rows. */
function particleRest(medium, box, skip, pad = R + 6) {
  const pts = [], rr = rng(7);
  if (medium === 'vacuum') return pts;
  if (medium === 'solid') {
    const d = 2 * R + 1;
    for (let y = box.y0 + R; y <= box.y1 - R; y += d) for (let x = box.x0 + R; x <= box.x1 - R; x += d) pts.push([x, y]);
  } else if (medium === 'water') {
    const d = 2 * R + 2; let row = 0;
    for (let y = box.y0 + R; y <= box.y1 - R; y += d * .9, row++) for (let x = box.x0 + R + (row % 2) * d / 2; x <= box.x1 - R; x += d)
      pts.push([x + (rr() - .5) * 3, y + (rr() - .5) * 3]);
  } else {
    // air: a few even rows of big particles, so the squashed and spread-out zones read at a glance
    const rows = 3, dy = (box.y1 - box.y0 - 64) / (rows - 1), n = Math.max(2, Math.floor((box.x1 - box.x0 - 2 * RA) / AIR_DX));
    const dx = (box.x1 - box.x0 - 2 * RA) / n;
    for (let j = 0; j < rows; j++) for (let i = 0; i <= n; i++) pts.push([box.x0 + RA + i * dx, box.y0 + 32 + j * dy]);
  }
  return pts.filter(([x, y]) => !skip.some(b => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad));
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const b = ctx.b, N = ctx.N; const S = SRC[P.source], M = MED[P.medium];
  const vac = P.medium === 'vacuum', ch = P.change, way = pitchWay(P), further = ch === 'further';
  const kCh = b.change, kEar = b.ear, kPass = b.pass;
  const under = h('g', {}, root), scene = h('g', {}, root), bandG = h('g', {}, root), mid = h('g', {}, root), top = h('g', {}, root);
  const lane = [], row = [];
  const rowLabel = (s, edit, cx, a = {}, mw = 300) => row.push({ s, edit, cx, a, want: Math.min(measure(root, s, 'ts-label'), mw) });
  // the names under the floor share one row: share out its width (narrow names keep theirs), then
  // pack them in order with the lane gap, so a long edit wraps or shrinks in its own slot
  const placeRow = () => {
    const G = 28, avail = GRID.right - GRID.left - G * (row.length - 1);
    let left = avail, n = row.length;
    [...row].sort((p, q) => p.want - q.want).forEach(r => { r.w = Math.min(r.want, left / n); left -= r.w; n--; });
    const L = [...row].sort((p, q) => p.cx - q.cx);
    L.forEach((r, i) => { r.x = Math.max(r.cx - r.w / 2, GRID.left, i ? L[i - 1].x + L[i - 1].w + G : -1e9); });
    for (let i = L.length - 1; i >= 0; i--) r0(L[i], i);
    function r0(r, i) { r.x = Math.min(r.x, GRID.right - r.w, i < L.length - 1 ? L[i + 1].x - G - r.w : 1e9); }
    for (const r of L) {
      const bx = lanePlace(lane, r.w, r.x + r.w / 2, { min: GRID.left, max: GRID.right, y: LAB_Y - 26, h: 34, gap: G, shift: 0 }) || { cx: r.x + r.w / 2 };
      // a long edit wraps to two lines (the block lifts to keep clear of the caption), then shrinks
      const tb = textBlock(top, bx.cx, LAB_Y, r.s, { cls: 'ts-label', maxW: Math.max(r.w, 40), maxLines: 2, lh: 30, anchor: 'middle', edit: r.edit, a: Object.assign({ fill: 'var(--ink)' }, r.a) });
      if (tb.lines.length > 1) tb.el.setAttribute('transform', 'translate(0 -12)');
    }
  };

  /* --- vibration settings before and after the change */
  const before = { A: A0, f: F0 }, after = Object.assign({}, before);
  if (ch === 'louder') after.A = A0 * 2;
  if (ch === 'quieter') { before.A = A0 * 1.5; after.A = A0 * .7; }
  if (ch === 'higher') after.f = F0 * 1.8;
  if (ch === 'lower') { before.f = F0 * 1.6; after.f = F0 * .85; }
  const lam = f => LAM0 * F0 / f;   // same speed, so faster vibrations mean shorter waves

  /* --- the room: a floor line */
  h('line', { x1: 0, x2: 1280, y1: FLOOR, y2: FLOOR, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, scene);

  /* --- the listener(s) */
  const LX = 1104, LXn = 780;
  const near = further ? listener(scene, LXn, { c: kCh != null ? `${kCh}:soft` : null }) : null;
  const far = listener(scene, LX, further ? { s: kCh, cls: 'rise' } : {});
  const ears = [near, far].filter(Boolean);

  /* --- the source */
  const SX = 190; let srcRight = 300, srcMove = () => {}, srcTop = 380;
  const ghostA = { stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', fill: 'none', 'stroke-dasharray': '4 5' };
  const sizeAfter = way === 'shorter' ? .72 : way === 'longer' ? 1.3 : 1;
  const sizeBefore = way === 'longer' ? .72 : 1;
  const sizeAfterAbs = sizeBefore * sizeAfter;
  if (P.source !== 'voice') apparatus(scene, 'bench', SX, BENCH_Y, 1, {}, { w: 260, depth: 22, front: FLOOR - BENCH_Y - 22 });
  const srcG = h('g', {}, scene);
  // one copy per state, so the change step can swap a smaller or longer source in
  const states = isPitch(ch) && sizeAfter !== 1 ? [['before', sizeBefore, { hide: kCh }], ['after', sizeAfterAbs, { s: kCh, cls: 'pop' }]] : [['one', 1, {}]];
  const movers = [];
  for (const [nm, sz, a] of states) {
    const g = h('g', a, srcG);
    if (P.source === 'drum') {
      const w = 170 * sz, hh = 96 * Math.min(1, sz + .1), ry = w * .14, y0 = BENCH_Y;
      h('rect', { x: SX - w / 2, y: y0 - hh, width: w, height: hh, fill: 'var(--heat)', cls: 'body' }, g);
      h('rect', { x: SX + w / 2 - w * .28, y: y0 - hh, width: w * .28, height: hh, fill: 'color-mix(in oklab,var(--heat) 70%,var(--shade))' }, g);
      for (let i = 0; i < 5; i++) { const x = SX - w / 2 + w * (i + .5) / 5; h('path', { d: `M${x - w / 10} ${y0 - hh} L ${x + w / 10} ${y0}`, stroke: 'var(--paper)', 'stroke-width': 'var(--sw-hair)' }, g); }
      h('ellipse', { cx: SX, cy: y0, rx: w / 2, ry, fill: 'var(--heat)', cls: 'body' }, g);
      const amp = 9;
      for (const s of [-1, 1]) h('ellipse', Object.assign({ cx: SX, cy: y0 - hh + s * amp * 1.2, rx: w / 2, ry, s: b.source }, ghostA), g);
      const skin = h('ellipse', { cx: SX, cy: y0 - hh, rx: w / 2, ry, fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'body' }, g);
      movers.push({ nm, set: d => skin.setAttribute('cy', (y0 - hh + d * amp).toFixed(1)) });
      srcRight = Math.max(srcRight, SX + w / 2); srcTop = Math.min(srcTop, y0 - hh - ry - amp * 1.2);
    } else if (P.source === 'string') {
      const L = 220, x1 = SX - L / 2, y = 470;
      if (nm === 'one' || nm === 'before') h('rect', { x: x1 - 16, y: 486, width: L + 32, height: BENCH_Y - 486, rx: 'var(--r-mark)', fill: 'var(--wood-1)', cls: 'body' }, srcG);
      const x2 = x1 + L * Math.min(1, sz);
      const amp = 16;
      for (const s of [-1, 1]) h('path', Object.assign({ d: `M${x1} ${y} Q ${(x1 + x2) / 2} ${y + s * amp * 2} ${x2} ${y}`, s: b.source }, ghostA), g);
      const st = vibString(g, x1, x2, y, { amp: 1 });
      if (sz < 1) {
        h('line', { x1: x2, x2: x1 + L, y1: y, y2: y, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
        h('rect', { x: x1 + L - 6, y: y - 16, width: 12, height: 32, rx: 3, fill: 'var(--board)' }, g);
      }
      movers.push({ nm, set: d => st.set(d * amp) });
      srcRight = Math.max(srcRight, x1 + L + 16); srcTop = 430;
    } else if (P.source === 'fork') {
      const base = BENCH_Y, ph = 140 * sz, gap = 18;
      h('rect', { x: SX - 40, y: base - 14, width: 80, height: 14, rx: 'var(--r-mark)', fill: 'var(--board)', cls: 'body' }, g);
      h('rect', { x: SX - 5, y: base - 70, width: 10, height: 58, rx: 3, fill: 'var(--metal-shade)' }, g);
      const yb = base - 70, yt = yb - 30 - ph, amp = 7;
      for (const s of [-1, 1]) for (const side of [-1, 1]) h('line', Object.assign({ x1: SX + side * (gap + s * amp), x2: SX + side * (gap + s * amp), y1: yb - 30, y2: yt, s: b.source }, ghostA), g);
      const pr = h('path', { fill: 'none', stroke: 'var(--metal)', 'stroke-width': 10, 'stroke-linecap': 'round' }, g);
      const set = d => { const o = gap + d * amp; pr.setAttribute('d', `M${SX - o} ${yt} V ${yb - 20} Q ${SX - o} ${yb} ${SX} ${yb} Q ${SX + o} ${yb} ${SX + o} ${yb - 20} V ${yt}`); };
      set(0); movers.push({ nm, set });
      srcRight = Math.max(srcRight, SX + 60); srcTop = Math.min(srcTop, yt);
    } else {
      if (nm === 'one' || nm === 'before') speaker(srcG, SX);
      const vx = SX + 22, vy = 392, amp = 3;
      h('circle', { cx: vx, cy: vy, r: 13, fill: 'var(--ear)', stroke: 'var(--berry-shade)', 'stroke-width': 'var(--sw-hair)' }, g);
      const c1 = h('line', { stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
      const c2 = h('line', { stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
      const set = d => { const o = 3 + d * amp; c1.setAttribute('x1', vx - o); c1.setAttribute('x2', vx - o); c2.setAttribute('x1', vx + o); c2.setAttribute('x2', vx + o); for (const c of [c1, c2]) { c.setAttribute('y1', vy - 7); c.setAttribute('y2', vy + 7); } };
      set(0); movers.push({ nm, set });
      srcRight = SX + 64; srcTop = 280;
    }
  }
  srcMove = (d, after) => movers.forEach(m => { if (m.nm === 'one' || (m.nm === 'after') === after) m.set(d); });

  /* --- the medium */
  // the rows stop about one spacing short of the listener, so no particle reaches the head or shoulder
  const x0 = Math.max(srcRight + 14, 330), x1 = LX - 124;
  const box = { x0, x1, y0: BAND.y0, y1: BAND.y1 };
  if (P.medium === 'solid') { box.y0 = 300; box.y1 = 430; h('rect', { x: x0 - 12, y: box.y0 - 8, width: x1 - x0 + 30, height: box.y1 - box.y0 + 16, rx: 'var(--r-mark)', fill: 'var(--wood-1)', cls: 'body' }, scene); }
  if (P.medium === 'water') h('rect', { x: x0 - 12, y: box.y0 - 10, width: x1 - x0 + 24, height: box.y1 - box.y0 + 20, rx: 'var(--r-mark)', fill: 'var(--liquid-bg)', stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-struct)', cls: 'body' }, scene);
  if (vac) h('rect', { x: x0 - 12, y: box.y0 + 16, width: (near ? LXn - 78 : x1) - x0 - 4, height: box.y1 - box.y0 - 6, rx: 'var(--r-card)', fill: 'color-mix(in oklab,var(--ink-3) 7%,transparent)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '12 10', s: kPass, cls: 'rise' }, scene);
  const sciW = P.vocabulary === 'science';
  const traceWord = vac ? txt(P, 'label:traceAfter', 'No vibration') : ch === 'none' ? null : txt(P, 'label:traceAfter', {
    louder: sciW ? 'Bigger amplitude: louder' : 'Bigger: louder', quieter: sciW ? 'Smaller amplitude: quieter' : 'Smaller: quieter',
    higher: sciW ? 'Higher frequency: higher pitch' : 'Faster: higher pitch', lower: sciW ? 'Lower frequency: lower pitch' : 'Slower: lower pitch',
    further: sciW ? 'Smaller amplitude: quieter' : 'Smaller: quieter' }[ch]);
  const traceLines = traceWord && measure(root, traceWord, 'ts-label') > TRACE.w - 36 ? 2 : 1;
  const traceBox = { x: TRACE.x, y: TRACE.y, w: TRACE.w, h: TRACE.h + (traceLines - 1) * 32 };
  // a clear gap of about 12 units round the close listener, even at the widest wobble
  const skip = near ? [near.box, { x: LXn - 64, y: 262, w: 128, h: 130 }] : [];
  const rP = P.medium === 'air' ? RA : R;
  const rest = particleRest(P.medium, box, skip, near ? rP + 24 + A0 * (P.medium === 'air' ? .65 : .45) : rP + 6)
    .filter(([x, y]) => !P.trace || !(x > traceBox.x - R - 10 && y < traceBox.y + traceBox.h + R + 12));
  const pg = h('g', {}, mid), air = P.medium === 'air', pr = air ? RA : R;
  // how far each particle moves: in air kept small enough that neighbours never touch, even when louder
  // (louder: twice the swing, spacing at least AIR_DX, so the tightest bunch still leaves a gap)
  const AM = air ? .65 : .45;
  const dots = rest.map(([x, y]) => h('circle', { cx: x, cy: y, r: pr, fill: 'var(--particle)', stroke: 'var(--particle-edge)', 'stroke-width': 'var(--sw-hair)' }, pg));
  const span = x1 - x0;
  const fade = x => 1 / (1 + Math.max(0, x - x0) / span);   // sound fades with distance

  /* --- one particle to follow: it wobbles about its own rest place */
  let fol = null;
  if (!vac && P.followParticle && b.inplace != null) {
    const fx = (x0 + (near ? LXn - 72 : x1)) / 2;
    let bi = -1, bd = 1e9; const yWant = box.y1 - 24;
    rest.forEach(([x, y], i) => { const d = Math.abs(x - fx) + Math.abs(y - yWant) * 1.5; if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) {
      const [px, py] = rest[bi], k = b.inplace, aMax = before.A * AM * fade(px);
      const fg = h('g', { s: k, hide: k + 1 < N ? k + 1 : null, cls: 'rise' }, top);
      h('circle', { cx: px, cy: py, r: pr + 5, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '4 4' }, fg);
      const ay = py + pr + 16;
      h('line', { x1: px - aMax - pr, x2: px + aMax + pr, y1: ay, y2: ay, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-arrow)' }, fg);
      h('path', { d: headD(px - aMax - pr - 4, ay, Math.PI, ctx.tk.head * .7), fill: 'var(--focus)' }, fg);
      h('path', { d: headD(px + aMax + pr + 4, ay, 0, ctx.tk.head * .7), fill: 'var(--focus)' }, fg);
      const lab = txt(P, 'label:particle', 'This particle stays in the same place');
      const tb = textBlock(fg, px, BAND.y1 + 52, lab, { cls: 'ts-small', maxW: 420, maxLines: 3, lh: 26, anchor: 'middle', edit: 'text.label:particle', a: { fill: 'var(--focus-text)' } });
      const lb = { x: px - tb.w / 2 - 10, y: BAND.y1 + 28, w: tb.w + 20, h: tb.h + 10 };
      fg.insertBefore(h('rect', { x: lb.x, y: lb.y, width: lb.w, height: lb.h, rx: 'var(--r-mark)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }), tb.el);
      if (lb.y + lb.h > LAB_Y - 26) ctx.warn('The followed-particle label is too long to fit above the label row.');
      dots[bi].setAttribute('fill', 'var(--focus)'); dots[bi].setAttribute('stroke', 'var(--focus-text)');
      top.appendChild(dots[bi]);   // the followed particle sits on top of its ring
      fol = { i: bi };
    }
  }

  /* --- the vibration travels: one arrow above the medium */
  if (!vac) {
    const tg = h('g', { s: kPass, hide: kEar, c: ctx.rc('pass', 'ear', 'soft') }, top);
    const ax0 = x0, ax1 = Math.min((near ? LXn : LX) - 90, P.trace ? TRACE.x - 30 : 1e9), ay = 224;
    h('line', { x1: ax0, x2: ax1 - 10, y1: ay, y2: ay, stroke: 'var(--energy)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', cls: 'draw', pathLength: 1, s: kPass }, tg);
    h('path', { d: headD(ax1, ay, 0, ctx.tk.head), fill: 'var(--energy)', s: kPass, delay: 600 }, tg);
    const lab = txt(P, 'label:travel', 'The vibration travels this way');
    // a short arrow (an ear close by) wraps its words to a second line, growing upwards, rather than cut them
    const tb = textBlock(tg, ax0, ay - 18, lab, { cls: 'ts-small', maxW: Math.min(520, ax1 - ax0 - 20), maxLines: 2, lh: 30, edit: 'text.label:travel', a: { fill: 'var(--energy-text)' } });
    if (tb.lines.length > 1) tb.el.setAttribute('transform', `translate(0 ${-(tb.lines.length - 1) * tb.lh})`);
  }

  /* --- the ear: a ring marks it when the vibration arrives */
  for (const L of vac ? [] : ears) {
    const isFar = L === far;
    const k = isFar && further ? kCh : kEar;
    h('circle', { cx: L.earAt[0], cy: L.earAt[1], r: 30, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-rule)', s: k, cls: 'pop',
      hide: !isFar && further ? kCh : null }, top);
  }

  /* --- labels on the row under the floor */
  rowLabel(txt(P, 'label:source', S.name), 'text.label:source', SX, { s: b.source, cls: 'rise' });
  if (further) rowLabel(txt(P, 'label:ear', 'Ear, close by'), 'text.label:ear', LXn, { s: kEar, cls: 'rise', c: `${kCh}:soft` });
  rowLabel(txt(P, further ? 'label:earFar' : 'label:ear', further ? 'Ear, further away' : 'Ear'), further ? 'text.label:earFar' : 'text.label:ear', LX, { s: further ? kCh : kEar, cls: 'rise' });
  rowLabel(txt(P, 'label:medium', M.name), 'text.label:medium', near ? (x0 + LXn - 72) / 2 : (x0 + x1) / 2, { s: kPass, cls: 'rise' }, 400);
  placeRow();

  /* --- not to scale: the particles are hugely magnified */
  textBlock(root, GRID.left, GRID.subY + 6, txt(P, 'label:scale', 'Not to scale'), { cls: 'ts-cap', maxW: (P.trace ? TRACE.x - 28 : GRID.right) - GRID.left, maxLines: 2, lh: 28, edit: 'text.label:scale', a: { cls: 'halo' } });

  /* --- the cause of the change, next to the source */
  if (ch !== 'none' && !further) {
    const word = ch === 'louder' ? S.hard : ch === 'quieter' ? S.soft : S[way];
    const tb = textBlock(top, SX, Math.min(srcTop, 300) - 26, txt(P, 'label:how', word), { cls: 'ts-label', maxW: 250, maxLines: 2, lh: 32, anchor: 'middle', edit: 'text.label:how', a: { fill: 'var(--compare-text)', s: kCh, cls: 'rise' } });
    if (Math.min(srcTop, 300) - 26 - 26 < GRID.subY + 14 + (tb.lines.length - 1) * 0) ctx.warn('The change label runs into the title area.');
  }

  /* --- the vibration at the ear, as a wave line */
  if (P.trace) {
    const tb0 = traceBox;
    // the box sits below the title band (title baseline 78), so a long title passes above it
    const g = h('g', { s: kEar, cls: 'rise' }, top);
    h('rect', { x: tb0.x, y: tb0.y, width: tb0.w, height: tb0.h, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'lift body' }, g);
    textBlock(g, tb0.x + 18, tb0.y + 36, txt(P, 'label:trace', 'The vibration at the ear'), { cls: 'ts-label', maxW: tb0.w - 36, maxLines: 1, edit: 'text.label:trace', a: { fill: 'var(--ink-2)' } });
    const cy = tb0.y + 78, wx0 = tb0.x + 20, wx1 = tb0.x + tb0.w - 20, amax = 19;
    h('line', { x1: wx0, x2: wx1, y1: cy, y2: cy, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, g);
    const wave = (A, f) => { let d = ''; const n = 120; for (let i = 0; i <= n; i++) { const x = wx0 + (wx1 - wx0) * i / n; d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + (cy - A * Math.sin(2 * Math.PI * 3 * f / F0 * i / n)).toFixed(1); } return d; };
    // heights are honest relative to each other: the bigger of the two fills the box
    const eB = before.A * fade(further ? LXn : x1), eA = after.A * fade(x1), ref = Math.max(eB, kCh != null ? eA : 0);
    const aB = vac ? 0 : amax * .9 * eB / ref, aA = vac ? 0 : amax * .9 * eA / ref;
    // in a vacuum the line is flat and grey: silence, not a live vibration
    h('path', { d: wave(aB, before.f), fill: 'none', stroke: vac ? 'var(--ink-3)' : 'var(--energy)', 'stroke-width': 'var(--sw-data)', 'stroke-linejoin': 'round', hide: vac ? null : kCh }, g);
    if (vac) textBlock(g, tb0.x + 18, tb0.y + 134, traceWord, { cls: 'ts-label', maxW: tb0.w - 36, maxLines: 2, lh: 32, edit: 'text.label:traceAfter', a: { fill: 'var(--ink)' } });
    if (!vac && kCh != null) h('path', { d: wave(aB, before.f), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '5 5', s: kCh }, g);
    if (!vac && kCh != null) {
      h('path', { d: wave(aA, after.f), fill: 'none', stroke: 'var(--compare)', 'stroke-width': 'var(--sw-data)', 'stroke-linejoin': 'round', s: kCh, cls: 'draw', pathLength: 1 }, g);
      textBlock(g, tb0.x + 18, tb0.y + 134, traceWord, { cls: 'ts-label', maxW: tb0.w - 36, maxLines: 2, lh: 32, edit: 'text.label:traceAfter', a: { fill: 'var(--compare-text)', s: kCh, cls: 'rise' } });
    }
  }

  /* --- squashed-together zones of the wave: shaded bands behind the particles, moving with them */
  let bands = () => {};
  if (!vac) {
    const gL = near ? LXn - 64 - 26 : null, gR = near ? LXn + 64 + 26 : null;
    // soft-edged: the air is most squashed in the middle of each band
    // in air the bands hug the rows of particles, so the shading stays with the particles it belongs to
    const by0 = P.medium === 'air' ? box.y0 + 32 - RA - 30 : box.y0 - 20, bh = P.medium === 'air' ? box.y1 - box.y0 - 64 + 2 * (RA + 30) : box.y1 - box.y0 + 40;
    const gid = `sv-band-${ctx.uid || 'u'}`, defs = h('defs', {}, bandG);
    const gr = h('linearGradient', { id: gid }, defs);
    for (const [o, a] of [[0, 0], [.5, 1], [1, 0]]) h('stop', { offset: o, 'stop-color': 'var(--particle)', 'stop-opacity': a }, gr);
    // masked to the medium (and round the close listener) with feathered ends, so no edge is hard
    const mask = h('mask', { id: gid + '-m', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 1280, height: 720 }, defs);
    const seg = j => {
      const g = h('linearGradient', { id: `${gid}-f${j}` }, defs);
      const st = [0, 0, 1, 1].map((o, i) => h('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': i === 1 || i === 2 ? 1 : 0 }, g));
      const r = h('rect', { y: by0, height: bh, width: 0, fill: `url(#${gid}-f${j})` }, mask);
      return (x, w) => { r.setAttribute('x', x.toFixed(1)); r.setAttribute('width', Math.max(0, w).toFixed(1));
        const f = w > 0 ? Math.min(.5, 34 / w) : .5; st[1].setAttribute('offset', f.toFixed(3)); st[2].setAttribute('offset', (1 - f).toFixed(3)); };
    };
    const cA = seg(0), cB = seg(1);
    // and a vertical feather, so the top and bottom of each band melt away too
    const vg = h('linearGradient', { id: gid + '-v', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    for (const [o, a] of [[0, 0], [.24, 1], [.76, 1], [1, 0]]) h('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': a }, vg);
    const vm = h('mask', { id: gid + '-vm', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 1280, height: 720 }, defs);
    h('rect', { x: 0, y: by0, width: 1280, height: bh, fill: `url(#${gid}-v)` }, vm);
    const bg = h('g', { mask: `url(#${gid}-m)` }, h('g', { mask: `url(#${gid}-vm)` }, bandG));
    const slots = Array.from({ length: 9 }, () => h('rect', { y: by0, height: bh, fill: `url(#${gid})`, opacity: 0, width: 0 }, bg));
    bands = (front, ph, L, A) => {
      const lo = x0 - 6, hi = Math.min(x1 - 4, front), bw = L * .5, n0 = Math.floor(ph / (2 * Math.PI)) - 8;
      const endA = gL == null ? hi : Math.min(hi, gL);
      cA(lo, endA - lo); cB(gR == null ? 0 : gR, gR == null ? 0 : hi - gR);
      slots.forEach((r, i) => {
        const cx = x0 + L * (ph / (2 * Math.PI) - (n0 + i));
        const op = cx < lo - bw || cx > hi + bw ? 0 : Math.min(.38, .44 * (A / A0) * fade(cx) / fade(x0) * (P.medium === 'air' ? 1 : .7));
        // kept inside the medium as drawn, so a band never reaches the labels beside it
        const bx0 = Math.max(cx - bw / 2, lo), bx1 = Math.min(cx + bw / 2, hi);
        // a band mostly cut off by an edge of the medium fades out, so no hard-edged slivers show
        const seg = (a, z) => Math.max(0, Math.min(z, cx + bw / 2) - Math.max(a, cx - bw / 2));
        const frac = (seg(lo, endA) + (gR == null ? 0 : seg(gR, hi))) / bw;
        r.setAttribute('x', bx0.toFixed(1)); r.setAttribute('width', Math.max(0, bx1 - bx0).toFixed(1)); r.setAttribute('opacity', (bx1 > bx0 ? op * clamp((frac - .45) / .45) : 0).toFixed(3));
      });
    };
  }

  /* --- motion: the source vibrates, the particles pass it on in place, the ear vibrates */
  const frame = (k, u, t) => {
    const aft = kCh != null && k >= kCh, s = aft ? after : before;
    const ph = 2 * Math.PI * s.f * t;
    srcMove(k >= 0 ? Math.sin(ph) * s.A / A0 : 0, aft);
    const front = k < kPass ? -1e9 : k === kPass ? x0 + u * (span + 60) : 1e9;
    const L = lam(s.f);
    bands(front - 30, ph, L, s.A);
    rest.forEach(([x, y], i) => {
      const on = clamp((front - x) / 60);
      const d = on * s.A * AM * fade(x) * Math.sin(ph - 2 * Math.PI * (x - x0) / L);
      dots[i].setAttribute('cx', (x + d).toFixed(1)); dots[i].setAttribute('cy', y);
    });
    const earOn = !vac && kEar != null && k >= kEar;
    // the eardrum wobbles less the further the ear is from the source, like the particles
    for (const E of ears) { const d = earOn ? Math.sin(ph - 2 * Math.PI * (E.earAt[0] - x0) / L) * 2.2 * s.A / A0 * fade(E.earAt[0]) / fade(ears[0].earAt[0]) : 0; E.ear.setAttribute('transform', `translate(${d.toFixed(2)} 0)`); }
  };
  return {
    tick: (k, u, t) => frame(k, u, t),
    still: () => frame(N, 1, .21),
    reset: () => frame(-1, 0, 0),
    dur: { source: 1500, pass: 2600, inplace: 1500, ear: 1500, change: 1500 },
  };
}

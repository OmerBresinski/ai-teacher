// Light: how shadows form and change size, reflection in a mirror, how we see, and the periscope.
// Shadows are drawn to scale (one scale on both axes) and their size comes from the geometry:
// the rays that just graze the object's outline set the shadow's edges. Light always travels
// in straight lines, away from the source and into the eye, never out of it.
import {
  h, T, clamp, lerp, eIO, GRID, headD, textBlock, labelGround,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { apparatus, rays } from '../kit/batch-E.js';
import { SHAPES, OBJECT_KINDS, OBJECT_NAMES, outline, hull, rayPoly, drawObject } from './light_shadows/objects.js';

export const meta = {
  id: 'light_shadows', name: 'Light and shadows', kind: 'scene', version: 1,
  subjects: ['Science'], years: ['Y3', 'Y6', 'KS3'],
  teaches: 'Light travels in straight lines: shadows form where it is blocked, mirrors reflect it at equal angles, and we see when light enters our eyes.',
};

const SOURCE_NAMES = { torch: 'Torch', lamp: 'Lamp', sun: 'Sun' };
const TALL = ['tree', 'figure', 'bottle'];
const MAT_LABELS = ['Opaque (blocks light)', 'Translucent (lets some light through)', 'Transparent (lets light through)'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Light and shadows',
  properties: {
    title: TITLE_PARAM('How shadows form'),
    setup: { type: 'string', title: 'What to show', enum: ['shadow', 'mirror', 'seeing', 'periscope'], 'x-labels': ['A shadow on a screen', 'Reflection in a mirror', 'How we see things', 'A periscope'], default: 'shadow' },
    source: { type: 'string', title: 'Light source', enum: ['torch', 'lamp', 'sun'], 'x-labels': ['Torch', 'Lamp', 'The Sun'], default: 'torch', description: 'Shadows and mirrors use a torch or lamp. The periscope uses daylight.' },
    object: { type: 'string', title: 'Object', enum: OBJECT_KINDS, 'x-labels': OBJECT_KINDS.map(k => OBJECT_NAMES[k]), default: 'figure' },
    material: { type: 'string', title: 'The object is', enum: ['opaque', 'translucent', 'transparent'], 'x-labels': MAT_LABELS, default: 'opaque' },
    objectHeight: { type: 'number', title: 'Object height (cm)', minimum: 2, maximum: 40, default: 10 },
    sourcePosition: { type: 'number', title: 'Torch to object (cm)', description: 'How far the light source is from the object.', minimum: 5, maximum: 150, default: 30 },
    screenDistance: { type: 'number', title: 'Object to screen (cm)', minimum: 5, maximum: 150, default: 40 },
    move: { type: 'object', title: 'Move the light', description: 'A last step moves the light source so the class sees the shadow change size.', default: { show: false, to: 22 },
      properties: { show: { type: 'boolean', title: 'Move the light source', default: false }, to: { type: 'number', title: 'Move it to (cm from the object)', minimum: 5, maximum: 150, default: 22 } } },
    showDistances: { type: 'boolean', title: 'Show the distances', default: false },
    angle: { type: 'integer', title: 'Angle the light hits the mirror (°)', description: 'Measured from the normal, the line at right angles to the mirror.', minimum: 20, maximum: 75, default: 40 },
    showAngles: { type: 'boolean', title: 'Show the angles', default: true },
    showEye: { type: 'boolean', title: 'Show an eye seeing the reflection', default: true },
    // names of things take the label cap (40); the scale note is a short phrase (60)
    text: TEXT_PARAM_FOR({ source: 'label', object: 'label', screen: 'label', shadow: 'label', before: 'label', eye: 'label', wall: 'label', mirror: 'label', mirror2: 'label', normal: 'label', scale: 'phrase' }),
  },
};

export const presets = [
  { id: 'y3-shadows-form', name: 'Year 3: how shadows form', params: { title: 'How a shadow forms', setup: 'shadow', source: 'torch', object: 'figure', objectHeight: 12, sourcePosition: 30, screenDistance: 30 } },
  { id: 'y3-shadow-size', name: 'Year 3: shadow size', params: { title: 'Why do shadows change size?', setup: 'shadow', source: 'torch', object: 'tree', objectHeight: 11, sourcePosition: 45, screenDistance: 30, showDistances: true, move: { show: true, to: 15 } } },
  { id: 'y6-how-we-see', name: 'Year 6: how we see objects', params: { title: 'How do we see things?', setup: 'seeing', source: 'lamp', object: 'ball' } },
  { id: 'y6-periscope', name: 'Year 6: the periscope', params: { title: 'Seeing over a wall', setup: 'periscope', object: 'tree' } },
];

/* ------------------------------------------------------------------ shadow geometry (pure) */
const FY = 560, SX = 1020, SW = 40, FACE_T = FY - 440, FACE_B = FY - 16, YC = (FACE_T + FACE_B) / 2, FX = SX - SW / 2, FR = FX + SW, LXMIN = 196, BEAM = (FACE_B - FACE_T) / 2, SH_MAX = 2 * (BEAM - 12);
function shadowModel(P) {
  const src = P.sourcePosition, scr = P.screenDistance, to = P.move && P.move.show ? P.move.to : src;
  const k = Math.min(13, (FX - LXMIN) / (Math.max(src, to) + scr));
  const H = P.objectHeight * k, aspect = (SHAPES[P.object] || SHAPES.ball).aspect, w = aspect * H;
  const ocx = FX - scr * k, x0 = ocx - w / 2, yb = YC + H / 2;
  const poly = hull(outline(P.object, x0, yb, H));
  const lxOf = cm => ocx - cm * k;
  const at = lx => {
    let lo = Infinity, hi = -Infinity, pT, pB;
    for (const q of poly) { const s = (q[1] - YC) / (q[0] - lx); if (s < lo) { lo = s; pT = q; } if (s > hi) { hi = s; pB = q; } }
    const top = YC + lo * (FX - lx), bot = YC + hi * (FX - lx);
    return { lx, top, bot, pT, pB, hU: bot - top, cm: (bot - top) / k };
  };
  return { src, scr, to, k, H, w, ocx, x0, yb, poly, lxOf, at, A: at(lxOf(src)), B: at(lxOf(to)), faceCm: (FACE_B - FACE_T) / k };
}
const fmtCm = v => (v < 10 ? (Math.round(v * 10) / 10) : Math.round(v)) + ' cm';
const low = s => { s = String(s || '').replace(/^(a|an|the)\s+/i, ''); return s ? s[0].toLowerCase() + s.slice(1) : s; };
const names = P => ({ src: txt(P, 'label:source', SOURCE_NAMES[P.source] || 'Torch'), obj: txt(P, 'label:object', OBJECT_NAMES[P.object] || 'Object') });

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const { obj } = names(P);
  if ((P.setup === 'shadow' || P.setup === 'mirror') && P.source === 'sun') R.push({ path: 'source', reason: 'The Sun is so far away that its light arrives as parallel rays, and we cannot move it closer. Use a torch or a lamp for this.' });
  if (P.setup === 'periscope' && !TALL.includes(P.object)) R.push({ path: 'object', reason: 'Choose a tall object (tree, figure or bottle) so its light reaches the top mirror.' });
  if (P.setup === 'shadow') {
    const M = shadowModel(P);
    const half = M.w / 2 / M.k;
    if (half >= P.sourcePosition - 1 || (P.move.show && half >= P.move.to - 1)) R.push({ path: P.move.show && half >= P.move.to - 1 ? 'move.to' : 'sourcePosition', reason: `The light would be touching the ${low(obj)}. Move it further away.` });
    if (half >= P.screenDistance - 1) R.push({ path: 'screenDistance', reason: `The screen would be touching the ${low(obj)}. Move the screen further away.` });
    if (M.H < 44) R.push({ path: 'objectHeight', reason: `At these distances the ${low(obj)} would be too small to see on the slide. Make it taller, or bring the light and the screen closer.` });
    if (P.move.show && P.move.to === P.sourcePosition) R.push({ path: 'move.to', reason: 'The light has to move somewhere new to change the shadow. Choose a different distance.' });
    if (P.move.show && P.material === 'transparent') R.push({ path: 'material', reason: 'A transparent object makes almost no shadow, so moving the light would show nothing. Choose opaque or translucent.' });
    if (!R.length) for (const [path, cm, s] of [['sourcePosition', P.sourcePosition, M.A], ...(P.move.show ? [['move.to', P.move.to, M.B]] : [])])
      if (s.hU > SH_MAX) { R.push({ path, reason: `With the light ${cm} cm from the ${low(obj)}, the shadow would be about ${fmtCm(s.cm)} tall: taller than the lit part of the screen (${Math.round(SH_MAX / M.k)} cm). Move the light further from the ${low(obj)}.` }); break; }
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds and notes */
function plan(P) {
  const { src, obj } = names(P); const s = low(src), o = low(obj); const the = P.source === 'sun' ? 'the Sun' : `the ${s}`;
  const steps = []; let summary;
  if (P.setup === 'shadow') {
    const M = shadowModel(P); const mat = P.material;
    steps.push({ key: 'source', caption: `${the[0].toUpperCase() + the.slice(1)} is a light source: it gives out light.` });
    steps.push({ key: 'rays', caption: `Light travels from ${the} in straight lines.` });
    steps.push({ key: 'object', caption: mat === 'opaque' ? `Light that hits the ${o} is blocked. It cannot pass through or bend round it.` : mat === 'translucent' ? `Some of the light that hits the ${o} passes through it.` : `Light passes straight through the clear ${o}.` });
    steps.push({ key: 'shadow', caption: mat === 'opaque' ? `A shadow forms on the screen where the light cannot reach.` : mat === 'translucent' ? `Only some light reaches the screen there, so the shadow is pale.` : `Almost all the light reaches the screen, so there is almost no shadow.` });
    if (P.move.show) { const closer = M.to < M.src;
      steps.push({ key: 'move', caption: `Move ${the} ${closer ? 'closer to' : 'further from'} the ${o}: the shadow ${closer ? 'grows' : 'shrinks'} from ${fmtCm(M.A.cm)} to ${fmtCm(M.B.cm)}.` });
      summary = closer ? `Light closer to the ${o}: bigger shadow (${fmtCm(M.A.cm)} became ${fmtCm(M.B.cm)}).` : `Light further from the ${o}: smaller shadow (${fmtCm(M.A.cm)} became ${fmtCm(M.B.cm)}).`; }
    else summary = mat === 'transparent' ? 'Transparent objects let light through, so they make almost no shadow.' : `A shadow is where the ${o} blocks the light from ${the}.`;
  } else if (P.setup === 'mirror') {
    steps.push({ key: 'source', caption: `${the[0].toUpperCase() + the.slice(1)} is a light source: it gives out light.` });
    steps.push({ key: 'ray', caption: 'Light travels in a straight line to the mirror.' });
    if (P.showAngles) steps.push({ key: 'normal', caption: `The normal is at right angles to the mirror. The light meets it at ${P.angle}°.` });
    steps.push({ key: 'reflect', caption: P.showAngles ? `The light reflects off the mirror at the same angle: ${P.angle}° on the other side.` : 'The mirror reflects the light. It leaves at the same angle it arrived.' });
    if (P.showEye) steps.push({ key: 'eye', caption: `The reflected light enters the eye, so we see ${the} in the mirror.` });
    summary = P.showAngles ? `Angle in equals angle out: both are ${P.angle}°.` : 'A mirror reflects light. The light still travels in straight lines.';
  } else if (P.setup === 'seeing') {
    steps.push({ key: 'source', caption: `${the[0].toUpperCase() + the.slice(1)} is a light source: it gives out light.` });
    steps.push({ key: 'rays', caption: `Light travels in straight lines from ${the} to the ${o}.` });
    steps.push({ key: 'scatter', caption: `The ${o} reflects light in all directions. It is not a light source.` });
    steps.push({ key: 'eye', caption: `Some reflected light travels into the eye. That is how we see the ${o}.` });
    summary = `We see the ${o} because light from it enters our eyes.`;
  } else {
    steps.push({ key: 'blocked', caption: `The wall blocks the light from the ${o}. Light cannot bend round it.` });
    steps.push({ key: 'top', caption: `Light from the ${o} reflects off the top mirror, straight down the tube.` });
    steps.push({ key: 'bottom', caption: `The bottom mirror reflects it into the eye. Now we can see the ${o} over the wall.` });
    summary = 'Two mirrors turn the light twice, so we can see over the wall.';
  }
  return { steps, summary };
}
export function builds(P) { P = withDefaults(params, P); const { steps, summary } = plan(P); return { steps, summary: { caption: summary } }; }

export function notes(P) {
  P = withDefaults(params, P); const { steps } = plan(P); const { obj, src } = names(P); const o = low(obj); const the = P.source === 'sun' ? 'the Sun' : `the ${low(src)}`;
  const M = P.setup === 'shadow' ? shadowModel(P) : null;
  const n = {
    source: P.setup === 'seeing' ? 'Sort light sources from things that only reflect light. The Moon and mirrors are not light sources.' : 'A light source gives out its own light. Never look straight at the Sun or into a torch.',
    rays: P.setup === 'shadow' ? `Drawn to scale: the ${o} is ${P.objectHeight} cm tall and the arrows show the direction light travels.` : 'Each arrow is one ray. Real light goes in every direction; we draw a few rays to show the paths.',
    object: P.material === 'opaque' ? `Opaque materials block light. Ask: what other objects would make a shadow?` : P.material === 'translucent' ? 'Translucent materials (tissue paper, frosted glass) let some light through.' : 'Transparent materials (clear glass, clear plastic) let almost all light through.',
    shadow: M ? `The shadow is ${fmtCm(M.A.cm)} tall, bigger than the ${o}: the rays spread out after they pass it. A shadow is the same shape as the object's outline.` : '',
    move: M ? `Rays from a closer light spread out more steeply, so they leave a bigger dark area on the screen. Ask the class to predict before you click.` : '',
    ray: 'Light travels in a straight line until it hits something.',
    normal: 'The normal is an imaginary line at 90° to the mirror. Angles are measured from it.',
    reflect: 'Law of reflection: the angle of incidence equals the angle of reflection.',
    eye: P.setup === 'mirror' ? `We see ${the} in the mirror because reflected light enters our eyes.` : 'Common mistake: drawing arrows out of the eye. Light goes into the eye; eyes do not send light out.',
    scatter: 'Most objects reflect light in all directions, which is why everyone in the room can see them.',
    blocked: 'Light travels in straight lines, so it cannot reach the eye round the wall. Not to scale.',
    top: 'Each mirror is at 45° to the tube, so it turns the light through 90°.',
    bottom: `Ask: which way does the light travel? From the ${o} to the eye, never the other way.`,
  };
  return { steps: steps.map(s => n[s.key] || ''), summary: P.setup === 'shadow' ? 'Ask: how could you make the shadow smaller? (Move the light further away, or the screen closer.)' : 'Ask the class to draw the light path with arrows pointing the way the light travels.' };
}

/* ------------------------------------------------------------------ drawing helpers */
function liveRay(ctx, p, a) {
  const g = h('g', {}, p); const s = ctx.tk.head * .9;
  const path = h('path', Object.assign({ fill: 'none', stroke: 'var(--energy)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, a.path || {}), g);
  const head = h('path', Object.assign({ fill: 'var(--energy)' }, a.head || {}), g);
  return { g, set(p0, p1) { path.setAttribute('d', `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} L ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`); const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    head.setAttribute('d', headD((p0[0] + p1[0]) / 2 + Math.cos(ang) * s * .5, (p0[1] + p1[1]) / 2 + Math.sin(ang) * s * .5, ang, s)); } };
}
const drawSel = (k, delay = 0) => ({ path: { cls: 'draw', pathLength: 1, s: k, delay }, head: { s: k, delay: delay + 600 } });
/** Label that wraps then shrinks; with a halo so a ray passing near never strikes through it. */
const label = (p, x, y, s, edit, o = {}) => textBlock(p, x, y, s, Object.assign({ cls: 'ts-label', maxW: 240, maxLines: 2, lh: 30, edit, a: Object.assign({ cls: 'halo', fill: 'var(--ink)' }, o.a || {}) }, o, { a: Object.assign({ cls: 'halo', fill: 'var(--ink)' }, o.a || {}) }));
function source(p, kind, x, y, ang = 0) {
  if (kind === 'sun') { const g = h('g', {}, p); h('circle', { cx: x, cy: y, r: 54, fill: 'var(--sun-body)' }, g); return { g, at: [x, y], top: y - 54, bot: y + 54 }; }
  if (kind === 'lamp') { const g = h('g', {}, p); apparatus(g, 'bulb', x, y + 38, 1, {}, { lit: true, brightness: .6 }); return { g, at: [x, y], top: y - 70, bot: y + 46 }; }
  const g = h('g', {}, p); const a = ang * Math.PI / 180; apparatus(g, 'torch', x - 38 * Math.cos(a), y - 38 * Math.sin(a), 1, {}, { ang }); return { g, at: [x, y], top: y - 30, bot: y + 30 };
}
const notToScale = (root, P, y = GRID.bottom, maxW = 300, maxLines = 3) => {
  const t = textBlock(root, GRID.right, y, txt(P, 'label:scale', 'Not to scale'), { cls: 'ts-cap', anchor: 'end', maxW, maxLines, lh: 28, edit: 'text.label:scale', a: { cls: 'halo', fill: 'var(--ink-2)' } });
  t.el.setAttribute('transform', `translate(0 ${-(t.h - t.lh)})`); return t;
};
/** A plain room behind the apparatus: a wall down to the floor line, so the scene has a setting. */
const room = (root, yF) => h('rect', { x: 0, y: 0, width: 1280, height: yF, fill: 'var(--wall-top)' }, root);

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  P = withDefaults(params, P);
  if (P.setup === 'mirror') return renderMirror(root, P, ctx);
  if (P.setup === 'seeing') return renderSeeing(root, P, ctx);
  if (P.setup === 'periscope') return renderPeriscope(root, P, ctx);
  return renderShadow(root, P, ctx);
}

function renderShadow(root, P, ctx) {
  const b = ctx.b, N = ctx.N, M = shadowModel(P), nm = names(P), mat = P.material;
  const moving = P.move.show, kMove = moving ? b.move : N;
  const lxA = M.A.lx;
  // room wall, bench, screen
  room(root, FY);
  h('rect', { x: GRID.left - 24, y: FY, width: GRID.right - GRID.left + 48, height: 14, fill: 'var(--bench-top)' }, root);
  h('line', { x1: GRID.left - 24, x2: GRID.right + 24, y1: FY, y2: FY, stroke: 'var(--bench-edge)', 'stroke-width': 'var(--sw-rule)' }, root);
  const beam = h('polygon', { fill: 'color-mix(in oklab,var(--energy) 14%,transparent)', s: b.rays }, root);
  const umbra = mat === 'transparent' ? null : h('polygon', { fill: `color-mix(in oklab,var(--shade) ${mat === 'opaque' ? 14 : 6}%,transparent)`, s: b.shadow }, root);
  apparatus(root, 'screen', SX, FY, 1, {}, { w: SW, h: 440 });
  const lit = h('rect', { x: FX, width: SW, fill: 'color-mix(in oklab,var(--energy) 50%,var(--paper))', s: b.rays }, root);
  const shadowFill = `color-mix(in oklab,var(--shade) ${mat === 'opaque' ? 72 : 30}%,var(--paper))`;
  const shp = mat === 'transparent' ? null : h('rect', { x: FX, width: SW, fill: shadowFill, s: b.shadow }, root);
  // object on a thin stick; the stick's own thin shadow runs down the screen below the object's
  const stickX = M.ocx;
  h('line', { x1: stickX, x2: stickX, y1: M.yb - 4, y2: FY, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)' }, root);
  h('rect', { x: stickX - 26, y: FY - 8, width: 52, height: 8, rx: 2, fill: 'var(--board)' }, root);
  const stickSh = mat === 'transparent' ? null : h('line', { x1: SX, x2: SX, stroke: shadowFill, 'stroke-width': 'var(--sw-struct)', s: b.shadow }, root);
  // rays: two beam edges, two grazing rays (shadow edges), blocked rays at the object
  const rTop = liveRay(ctx, root, drawSel(b.rays)), rBot = liveRay(ctx, root, drawSel(b.rays, 150));
  const eTop = liveRay(ctx, root, drawSel(b.rays, 300)), eBot = liveRay(ctx, root, drawSel(b.rays, 450));
  const hits = [-.22, .22].map((f, i) => ({ f, r: liveRay(ctx, root, drawSel(b.object, i * 200)), through: mat === 'opaque' ? null : liveRay(ctx, root, { path: { s: b.object, cls: 'draw', pathLength: 1, delay: 700 + i * 200, opacity: mat === 'translucent' ? .45 : 1 }, head: { s: b.object, delay: 1200 + i * 200, opacity: mat === 'translucent' ? .45 : 1 } }) }));
  drawObject(root, P.object, M.x0, M.yb, M.H, mat);
  // ghost of where the light started (the move build)
  let ghost = null;
  if (moving) {
    const gg = h('g', { s: kMove, c: `${kMove}:soft` }, root);
    h('g', { opacity: .4 }, gg).appendChild(source(h('g', {}), P.source, lxA, YC).g);
    h('rect', { x: FX - 4, y: M.A.top, width: SW + 8, height: M.A.hU, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)', 'stroke-dasharray': '6 6' }, gg);
    // "shadow from here" sits under the ghost light, but never behind the moved light's stand: after a
    // short move it narrows to fit left of the stand, or (moving away) goes right of it, below the beam
    const [sL, sR] = P.source === 'lamp' ? [M.B.lx - 18, M.B.lx + 18] : [M.B.lx - 92, M.B.lx - 32];
    let gw = 250, gx = Math.max(lxA - 40, GRID.left + gw / 2), gy = YC + 66;
    if (gx + gw / 2 + 12 > sL && gx - gw / 2 - 12 < sR) {
      if (sL - 12 - GRID.left >= 120) { gw = Math.min(250, sL - 12 - GRID.left); gx = sL - 12 - gw / 2; }
      else gx = sR + 12 + gw / 2;
    }
    // after a move away the ghost sits inside the new beam: drop the label below its lower edge
    if (M.B.lx < lxA) gy = Math.max(gy, YC + BEAM * (gx + gw / 2 - M.B.lx) / (FX - M.B.lx) + 50);
    const gl = textBlock(gg, gx, gy, txt(P, 'label:before', 'Shadow from here'), { cls: 'ts-label', maxW: gw, maxLines: 3, anchor: 'middle', edit: 'text.label:before', a: { cls: 'halo', fill: 'var(--ink)' } });
    computed(T(gg, gx, gy + gl.h + 4, fmtCm(M.A.cm), 'ts-label', { 'text-anchor': 'middle', cls: 'strong halo', fill: 'var(--ink)' }), 'sourcePosition'); ghost = gg;
  }
  // the light source moves as one group
  const srcG = h('g', {}, root); const S = source(srcG, P.source, lxA, YC);
  h('rect', { x: lxA - (P.source === 'lamp' ? 18 : 92), y: S.bot, width: P.source === 'lamp' ? 36 : 60, height: FY - S.bot, fill: 'var(--wood-1)', stroke: 'var(--wood-line)', 'stroke-width': 'var(--sw-hair)' }, srcG);
  const sOff = P.source === 'lamp' ? 0 : 40, sl = label(srcG, lxA - sOff, S.top - 16, nm.src, 'text.label:source', { anchor: 'middle', maxW: 240, maxLines: 3, a: {} });
  const lxMin = Math.min(lxA, M.B.lx), sShift = Math.max(0, GRID.left - (lxMin - sOff - sl.w / 2));
  sl.el.setAttribute('transform', `translate(${sShift.toFixed(1)} ${-(sl.h - sl.lh)})`);
  sl.el.dataset.c = ctx.rc('source', moving ? 'move' : null, 'soft') || '';
  // labels: object below the bench line, screen above-left of its top; shadow bracket right of the screen
  // the object's name sits under the bench, or above the object when the distances need the bench
  const ow2 = Math.min(320, 2 * (FX - 20 - M.ocx)); let objLabel = null;
  if (P.showDistances) {
    // the label sits just above the beam's top edge for the light where it is now (so it follows a
    // move) and must stay clear of the torch's label at every light position. Try the widest wrap
    // first and narrow it until it fits; only a name that fits nowhere is warned about.
    const lxs = moving ? [lxA, M.B.lx] : [lxA];
    const yOf = (lx, w) => Math.min(M.yb - M.H - 22, YC - BEAM * (M.ocx + w / 2 - lx) / (FX - lx) - 16);
    const slBox = lx => { const cx = lx - sOff + sShift, yb0 = S.top - 16; return [cx - sl.w / 2 - 12, yb0 - (sl.h - sl.lh) - 26, cx + sl.w / 2 + 12, yb0 + 10]; };
    const clear = l => lxs.every(lx => { const y = yOf(lx, l.w), q = [M.ocx - l.w / 2, y - (l.h - l.lh) - 26, M.ocx + l.w / 2, y + 10], t = slBox(lx);
      return q[1] >= GRID.subY - 4 && q[0] >= GRID.left && q[2] <= GRID.right && (q[2] < t[0] || q[0] > t[2] || q[3] < t[1] || q[1] > t[3]); });
    let ol = null, ok = false;
    for (let w = ow2; w >= 120 && !ok; w -= 20) {
      if (ol) ol.el.remove();
      ol = label(root, M.ocx, 0, nm.obj, 'text.label:object', { anchor: 'middle', maxW: w, maxLines: 4, a: { s: b.object } });
      ok = !ol.lines[ol.lines.length - 1].endsWith('…') && clear(ol);
    }
    if (ok) { const olF = ol; objLabel = lx => olF.el.setAttribute('transform', `translate(0 ${(yOf(lx, olF.w) - (olF.h - olF.lh)).toFixed(1)})`); }
    else {
      // a long name goes under the beam instead, left of the stick: below the beam's lower edge for
      // every light position (the edge is lowest-reaching for the furthest light) and above the bench
      ol.el.remove();
      const xR = M.ocx - 10, lxNear = Math.max(...lxs), standR = lxNear + (P.source === 'lamp' ? 18 : -32);
      const top = Math.max(...lxs.map(lx => YC + BEAM * (xR - lx) / (FX - lx))) + 14;
      ol = label(root, xR, top + 20, nm.obj, 'text.label:object', { anchor: 'end', maxW: Math.min(280, xR - Math.max(GRID.left, standR + 8)), maxLines: 3, a: { s: b.object } });
      if (ol.lines[ol.lines.length - 1].endsWith('…') || top + 20 + (ol.h - ol.lh) + 8 > FY - 4) ctx.warn(`light_shadows: the ${low(nm.obj)} label is too long to sit clear of the light and the rays; shorten it`);
    }
  }
  else label(root, M.ocx, FY + 44, nm.obj, 'text.label:object', { anchor: 'middle', maxW: Math.max(ow2, 380), maxLines: 2, a: { s: b.object } });
  label(root, FR + 10, FACE_T + 24, txt(P, 'label:screen', 'Screen'), 'text.label:screen', { anchor: 'start', maxW: GRID.right - FR - 10, maxLines: 4 });
  let br = null;
  if (mat !== 'transparent') {
    br = h('g', { s: b.shadow }, root);
    const bl = h('path', { fill: 'none', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-rule)' }, br);
    const tl = label(br, FR + 16, 0, txt(P, 'label:shadow', 'Shadow'), 'text.label:shadow', { maxW: GRID.right - FR - 16, maxLines: 4 });
    const sz = computed(T(br, FR + 16, 0, '', 'ts-label', { cls: 'strong', fill: 'var(--ink)' }), 'sourcePosition');
    br.set = (s, path) => { const x = FR; sz.dataset.computed = path; bl.setAttribute('d', `M${x - 6} ${s.top} H ${x} V ${s.bot} H ${x - 6}`); const my = (s.top + s.bot) / 2;
      tl.el.setAttribute('y', my - 6 - (tl.h - 30)); tl.el.querySelectorAll('tspan').forEach(t => t.setAttribute('x', FR + 16)); sz.setAttribute('y', my + 28); sz.textContent = fmtCm(s.cm); };
  }
  // distances along the bench
  let dims = null;
  if (P.showDistances) {
    const dg = h('g', {}, root), y = FY + 28;
    const mk = path => { const l = h('path', { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, dg); const t = computed(T(dg, 0, y + 36, '', 'ts-cap', { 'text-anchor': 'middle', fill: 'var(--ink)' }), path); return { l, t }; };
    const d1 = mk('sourcePosition'), d2 = mk('screenDistance');
    const put = (d, x1, x2, cm) => { d.l.setAttribute('d', `M${x1} ${y - 8} V ${y + 8} M${x1} ${y} H ${x2} M${x2} ${y - 8} V ${y + 8}`); d.t.setAttribute('x', (x1 + x2) / 2); d.t.textContent = fmtCm(cm); };
    dims = (lx, path) => { put(d1, lx, M.ocx, (M.ocx - lx) / M.k); d1.t.dataset.computed = path; put(d2, M.ocx, FX, M.scr); };
  }
  // geometry for a light position
  const setLx = lx => {
    const s = M.at(lx), L = [lx, YC];
    srcG.setAttribute('transform', `translate(${(lx - lxA).toFixed(1)} 0)`);
    const yT = YC - BEAM, yB = YC + BEAM;
    beam.setAttribute('points', `${lx},${YC} ${FX},${yT} ${FX},${yB}`);
    lit.setAttribute('y', yT); lit.setAttribute('height', yB - yT);
    rTop.set(L, [FX, yT]); rBot.set(L, [FX, yB]);
    eTop.set(L, [FX, s.top]); eBot.set(L, [FX, s.bot]);
    if (umbra) umbra.setAttribute('points', `${s.pT[0]},${s.pT[1]} ${FX},${s.top} ${FX},${s.bot} ${s.pB[0]},${s.pB[1]}`);
    if (shp) { shp.setAttribute('y', s.top); shp.setAttribute('height', s.hU); }
    if (stickSh) { const yS = YC + (M.yb - YC) * (FX - lx) / (stickX - lx); stickSh.setAttribute('y1', Math.min(yS, FACE_B)); stickSh.setAttribute('y2', FACE_B); }
    for (const it of hits) {
      const target = [M.ocx, YC + it.f * M.H]; const L2 = Math.hypot(target[0] - lx, target[1] - YC); const d = [(target[0] - lx) / L2, (target[1] - YC) / L2];
      const t = rayPoly(L, d, M.poly) || L2; const hit = [lx + d[0] * t, YC + d[1] * t]; it.r.set(L, hit);
      if (it.through) { const tx = (FX - lx) / d[0]; it.through.set(hit, [FX, YC + d[1] * tx]); }
    }
    const path = moving && Math.abs(lx - lxA) > .5 ? 'move.to' : 'sourcePosition';
    if (br) br.set(s, path); if (dims) dims(lx, path); if (objLabel) objLabel(lx);
    return s;
  };
  setLx(lxA);
  return {
    dur: moving ? { move: 1600 } : {},
    still() { setLx(moving ? M.B.lx : lxA); },
    reset() { setLx(lxA); },
    tick(k, u) { if (!moving) return; setLx(k < kMove ? lxA : k > kMove ? M.B.lx : lerp(lxA, M.B.lx, eIO(clamp(u)))); },
  };
}

function renderMirror(root, P, ctx) {
  const b = ctx.b, N = ctx.N, nm = names(P), i = P.angle * Math.PI / 180;
  const Hp = [640, 540], D = 300;
  h('rect', { x: 300, y: 556, width: 680, height: 14, fill: 'var(--bench-top)' }, root);
  apparatus(root, 'mirror', Hp[0], Hp[1] + 2, 1, {}, { len: 560, ang: 180 });
  const lens = [Hp[0] - D * Math.sin(i), Hp[1] - D * Math.cos(i)], out = [Hp[0] + D * Math.sin(i), Hp[1] - D * Math.cos(i)];
  const S = source(root, P.source, lens[0], lens[1], Math.atan2(Hp[1] - lens[1], Hp[0] - lens[0]) * 180 / Math.PI);
  const back = [lens[0] - 130 * Math.sin(i), lens[1] - 130 * Math.cos(i)];
  const sl = label(root, back[0] - 14, back[1] + 10, nm.src, 'text.label:source', { anchor: 'end', maxW: Math.max(140, back[0] - 14 - GRID.left), maxLines: 2 });
  sl.el.dataset.c = ctx.rc('source', null, 'soft') || '';
  label(root, 980, 610, txt(P, 'label:mirror', 'Mirror'), 'text.label:mirror', { anchor: 'end', maxW: 300, maxLines: 2 });
  const focus = `${N}:soft`;
  rays(ctx, root, lens, Hp, { draw: b.ray, a: { s: b.ray } });
  if (P.showAngles) {
    const ng = h('g', { s: b.normal }, root);
    h('line', { x1: Hp[0], x2: Hp[0], y1: Hp[1], y2: Hp[1] - 320, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)', 'stroke-dasharray': '8 8' }, ng);
    label(ng, Hp[0], Hp[1] - 334, txt(P, 'label:normal', 'Normal'), 'text.label:normal', { anchor: 'middle', maxW: 220, maxLines: 1, cls: 'ts-small' });
    const arc = (sgn, g) => { const r = 70; h('path', { d: `M${Hp[0]} ${Hp[1] - r} A ${r} ${r} 0 0 ${sgn > 0 ? 1 : 0} ${Hp[0] + sgn * r * Math.sin(i)} ${Hp[1] - r * Math.cos(i)}`, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)' }, g);
      const rr = clamp(44 / Math.sin(i / 2), 125, 260); computed(T(g, Hp[0] + sgn * rr * Math.sin(i / 2), Hp[1] - rr * Math.cos(i / 2) + 10, `${P.angle}°`, 'ts-label', { 'text-anchor': 'middle', cls: 'halo strong', fill: 'var(--focus-text)' }), 'angle'); };
    arc(-1, h('g', { s: b.normal }, root)); arc(1, h('g', { s: b.reflect }, root));
  }
  rays(ctx, root, Hp, out, { draw: b.reflect, a: { s: b.reflect } });
  if (P.showEye) {
    const ang = Math.atan2(Hp[1] - out[1], Hp[0] - out[0]) * 180 / Math.PI;
    const eg = h('g', { s: b.eye, cls: 'rise' }, root); const e = [out[0] + 40 * Math.sin(i), out[1] - 40 * Math.cos(i)];
    apparatus(h('g', { transform: `rotate(${ang} ${e[0]} ${e[1]})` }, eg), 'eye', e[0], e[1], 1.2, {}, { dir: 1 });
    label(eg, e[0] + 60, e[1] + 8, txt(P, 'label:eye', 'Eye'), 'text.label:eye', { maxW: Math.max(120, GRID.right - e[0] - 60), maxLines: 2 });
  }
  return {};
}

function renderSeeing(root, P, ctx) {
  const b = ctx.b, N = ctx.N, nm = names(P);
  const FYs = 560;
  room(root, FYs);
  h('rect', { x: 0, y: FYs, width: 1280, height: 92, fill: 'var(--bench-top)' }, root);
  h('line', { x1: 0, x2: 1280, y1: FYs, y2: FYs, stroke: 'var(--bench-edge)', 'stroke-width': 'var(--sw-rule)' }, root);
  const H = 170, aspect = (SHAPES[P.object] || SHAPES.ball).aspect, w = aspect * H, cx = 700, x0 = cx - w / 2;
  const poly = hull(outline(P.object, x0, FYs, H)); const C = [cx, FYs - H / 2];
  const sp = P.source === 'sun' ? [220, 220] : P.source === 'lamp' ? [350, 310] : [330, 280];
  const S = source(root, P.source, sp[0], sp[1], P.source === 'torch' ? Math.atan2(C[1] - sp[1], C[0] - sp[0]) * 180 / Math.PI : 0);
  if (P.source === 'lamp') h('rect', { x: sp[0] - 6, y: S.bot, width: 12, height: FYs + 14 - S.bot, fill: 'var(--ink-3)' }, root), h('rect', { x: sp[0] - 40, y: FYs + 4, width: 80, height: 10, rx: 2, fill: 'var(--board)' }, root);
  if (P.source === 'torch') h('rect', { x: sp[0] - 72, y: S.bot, width: 60, height: FYs - S.bot, fill: 'var(--wood-1)', stroke: 'var(--wood-line)', 'stroke-width': 'var(--sw-hair)' }, root);
  const sl = label(root, sp[0], S.top - 18, nm.src, 'text.label:source', { anchor: 'middle', maxW: 300, maxLines: 2 });
  sl.el.setAttribute('transform', `translate(0 ${-(sl.h - sl.lh)})`);
  sl.el.dataset.c = ctx.rc('source', null, 'soft') || '';
  drawObject(root, P.object, x0, FYs, H, 'opaque');
  label(root, cx, FYs + 42, nm.obj, 'text.label:object', { anchor: 'middle', maxW: 340, maxLines: 2 });
  const hitFrom = (o, target) => { const L = Math.hypot(target[0] - o[0], target[1] - o[1]); const d = [(target[0] - o[0]) / L, (target[1] - o[1]) / L]; const t = rayPoly(o, d, poly); return t == null ? target : [o[0] + d[0] * t, o[1] + d[1] * t]; };
  const from = P.source === 'torch' ? [sp[0] + 4, sp[1]] : sp;
  const tg = [[cx - w * .3, FYs - H * .85], [cx - w * .45, FYs - H * .5], [cx - w * .2, FYs - H * .98]].map(t => hitFrom(from, t));
  const quietIn = `${b.eye}-${N}:quiet,${N}:soft`;
  tg.forEach((t, j) => rays(ctx, root, from, t, { draw: b.rays, delay: j * 150, a: { s: b.rays, c: quietIn } }));
  // scattered light: short rays leaving the surface in several directions
  const E = [1070, 330];
  const outDir = [-160, -120, -80, -45, 10].map(a => a * Math.PI / 180);
  const sg = h('g', { s: b.scatter, c: quietIn }, root);
  outDir.forEach((a, j) => { const d = [Math.cos(a), Math.sin(a)]; const far = [C[0] + d[0] * 400, C[1] + d[1] * 400]; const st = hitFrom(far, C); const s0 = [st[0] + d[0] * 6, st[1] + d[1] * 6];
    const len = d[0] > .9 ? 260 : 120; rays(ctx, sg, s0, [s0[0] + d[0] * len, s0[1] + d[1] * len], { draw: b.scatter, delay: j * 120 }); });
  const eg = h('g', { s: b.eye, cls: 'rise' }, root);
  apparatus(eg, 'eye', E[0], E[1], 1.4, {}, { dir: -1 });
  const el = label(eg, Math.min(E[0], GRID.right - 170), E[1] - 46, txt(P, 'label:eye', 'Eye'), 'text.label:eye', { anchor: 'middle', maxW: 340, maxLines: 2 }); el.el.setAttribute('transform', `translate(0 ${-(el.h - 30)})`);
  const far = [C[0] + (E[0] - C[0]) * 3, C[1] + (E[1] - C[1]) * 3]; const st = hitFrom(far, C); const pupil = [E[0] - 34, E[1]];
  rays(ctx, root, [st[0] + 4, st[1] - 1], pupil, { draw: b.eye, a: { s: b.eye } });
  notToScale(root, P);
  return {};
}

function renderPeriscope(root, P, ctx) {
  const b = ctx.b, N = ctx.N, nm = names(P);
  const GY = 600, E = [370, 500], TX0 = 440, TX1 = 520, TC = (TX0 + TX1) / 2, MT = [TC, 230], MB = [TC, 500];
  h('rect', { x: 0, y: GY, width: 1280, height: 60, fill: 'var(--hill-near)' }, root);
  // wall
  const WX = 640, WW = 84, WT = 262;
  h('rect', { x: WX, y: WT, width: WW, height: GY - WT, fill: 'var(--stone)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)' }, root);
  for (let y = WT + 36; y < GY; y += 36) h('line', { x1: WX, x2: WX + WW, y1: y, y2: y, stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-hair)' }, root);
  const treeL = 1020 - .35 * 420; // left edge of the tallest object's crown: the wall label sits between
  // the wall's name sits beside it; a name too long for that narrow gap moves above the wall,
  // over the light's path (clear of the tree's crown)
  const wallName = txt(P, 'label:wall', 'Wall');
  let wl = label(root, WX + WW + 14, WT + 46, wallName, 'text.label:wall', { anchor: 'start', maxW: treeL - (WX + WW + 14) - 12, maxLines: 2 });
  if (wl.lines[wl.lines.length - 1].endsWith('…')) {
    wl.el.remove();
    wl = label(root, WX, MT[1] - 26, wallName, 'text.label:wall', { anchor: 'start', maxW: 300, maxLines: 2 });
    wl.el.setAttribute('transform', `translate(0 ${-(wl.h - wl.lh)})`);
  }
  // object beyond the wall: its top part is level with the top mirror
  const H = 420, aspect = (SHAPES[P.object] || SHAPES.ball).aspect, OH = P.object === 'tree' || P.object === 'figure' || P.object === 'bottle' ? H : 140;
  const ow = aspect * OH, ocx = 1020, oy = GY;
  drawObject(root, P.object, ocx - ow / 2, oy, OH, 'opaque');
  const ol = label(root, ocx - .1 * ow - 14, GY - 16, nm.obj, 'text.label:object', { anchor: 'end', maxW: ocx - .1 * ow - 14 - (WX + WW + 24), maxLines: 3 });
  ol.el.setAttribute('transform', `translate(0 ${-(ol.h - ol.lh)})`); // grows upward, clear of the ground
  const poly = hull(outline(P.object, ocx - ow / 2, oy, OH));
  const yRay = MT[1]; // light reaches the top mirror level, so it meets the 45° mirror and turns straight down
  const tLeft = rayPoly([TX1, yRay], [1, 0], poly); const start = tLeft != null ? [TX1 + tLeft - 4, yRay] : [ocx - ow / 2, yRay];
  // tube with openings facing the object (top, right) and the eye (bottom, left)
  const tg = h('g', {}, root);
  // one closed tube standing on the ground, with an opening beside each mirror
  const TT = 176, oT = [MT[1] - 40, MT[1] + 40], oB = [MB[1] - 40, MB[1] + 40];
  h('rect', { x: TX0, y: TT, width: TX1 - TX0, height: GY - TT, fill: 'var(--air)' }, tg);
  h('path', { d: `M${TX1} ${oT[0]} V ${TT} H ${TX0} V ${oB[0]} M${TX0} ${oB[1]} V ${GY} M${TX1} ${GY} V ${oT[1]}`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'square' }, tg);
  apparatus(tg, 'mirror', MT[0], MT[1], 1, {}, { len: 96, ang: -45 });
  apparatus(tg, 'mirror', MB[0], MB[1], 1, {}, { len: 96, ang: 135 });
  label(root, TX0 - 16, MT[1] + 8, txt(P, 'label:mirror', 'Mirror'), 'text.label:mirror', { anchor: 'end', maxW: TX0 - 16 - GRID.left, maxLines: 2 });
  // the bottom mirror's name sits in the gap right of the tube; one too long for that gap moves left
  // of the tube, above the eye, growing upward
  const m2Name = txt(P, 'label:mirror2', 'Mirror');
  let m2 = label(root, TX1 + 16, MB[1] - 40, m2Name, 'text.label:mirror2', { anchor: 'start', maxW: WX - TX1 - 30, maxLines: 2 });
  if (m2.lines[m2.lines.length - 1].endsWith('…')) {
    m2.el.remove();
    m2 = label(root, TX0 - 16, MB[1] - 46, m2Name, 'text.label:mirror2', { anchor: 'end', maxW: TX0 - 16 - GRID.left, maxLines: 2 });
    m2.el.setAttribute('transform', `translate(0 ${-(m2.h - m2.lh)})`);
  }
  const eg = h('g', {}, root); apparatus(eg, 'eye', E[0], E[1], 1.2, {}, { dir: 1 });
  // the eye's name sits just below it while it clears the tube; a longer one goes behind the eye
  const eyeName = txt(P, 'label:eye', 'Eye'), eyeX = E[0] - 10, eyeW = 2 * (TX0 - 12 - eyeX);
  let el = label(eg, eyeX, E[1] + 66, eyeName, 'text.label:eye', { anchor: 'middle', maxW: eyeW, maxLines: 1 });
  if (el.lines[0].endsWith('…') || el.w > eyeW) { el.el.remove(); el = label(eg, E[0] - 52, E[1] + 8, eyeName, 'text.label:eye', { anchor: 'end', maxW: E[0] - 52 - GRID.left, maxLines: 2 }); }
  // blocked: the straight path from the object to the eye stops at the wall
  const aim = [ocx - ow * .2, oy - OH * .55], eo = [E[0] + 30, E[1]]; const al = Math.hypot(aim[0] - eo[0], aim[1] - eo[1]); const ad = [(aim[0] - eo[0]) / al, (aim[1] - eo[1]) / al];
  const tb = rayPoly(eo, ad, poly); const top = tb != null ? [eo[0] + ad[0] * (tb - 4), eo[1] + ad[1] * (tb - 4)] : aim;
  const dx = E[0] + 30 - top[0], dy = E[1] - top[1];
  const tw = (WX + WW - top[0]) / dx; const wallHit = [WX + WW, top[1] + dy * tw];
  const bg = h('g', { s: b.blocked, c: `${b.blocked + 1}:quiet` }, root); // stays dim in the summary: the mirror path is the point
  rays(ctx, bg, top, wallHit, { draw: b.blocked, col: 'var(--energy)' });
  h('path', { d: `M${wallHit[0] + 14} ${wallHit[1] - 14} l -28 28 m 0 -28 l 28 28`, stroke: 'var(--lost)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', s: b.blocked, delay: 900, cls: 'pop' }, bg);
  rays(ctx, root, start, MT, { draw: b.top, a: { s: b.top } });
  rays(ctx, root, MT, MB, { draw: b.top, delay: 900, a: { s: b.top } });
  rays(ctx, root, MB, [E[0] + 30, E[1]], { draw: b.bottom, a: { s: b.bottom } });
  // "Not to scale" sits right of the trunk, above the ground; a longer note moves onto the ground band
  // on a paper ground, clear of every mark
  const lowR = Math.max(...poly.filter(q => q[1] > GY - 60).map(q => q[0])), ns = notToScale(root, P, GY - 14, GRID.right - (lowR + 14), 1);
  if (ns.lines[0].endsWith('…')) {
    ns.el.remove();
    const t = notToScale(root, P, GY + 38, GRID.right - GRID.left - 24, 1); t.el.classList.remove('halo');
    root.insertBefore(labelGround(h('g'), { x: GRID.right - t.w - 24, y: GY + 12, w: t.w + 24, h: 36 }), t.el);
    t.el.setAttribute('transform', `translate(-12 0)`);
  }
  return {};
}

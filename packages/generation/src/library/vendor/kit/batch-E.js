// Batch E kit additions: materials and physical science (apparatus, particles, light rays,
// circuits, force arrows). Plain ES module on the kit core. Tokens only; every visible word is
// real SVG text marked editable() or computed(). Apparatus carry topic tags (APPARATUS_TOPICS),
// so a model only places objects that fit its topic, the same way scenery uses OBJECT_CULTURES.
//
// Exports and params
//   APPARATUS                       list of apparatus kinds
//   APPARATUS_TOPICS                {kind: [topic...]}; topics: materials, states, separating,
//                                   light, sound, electricity, forces, magnets, any
//   apparatusFor(topic)             kinds that fit a topic ([] when none)
//   apparatus(p, kind, x, y, s=1, a={}, o={})   draw one kind, base centre at (x,y), scale s.
//                                   Returns the outer group; group.info holds anchor points.
//     o by kind:
//       bench     {w=600, depth=26, front=40}              (x,y = centre of the top edge)
//       beaker    {w=120, h=150, level=0..1, liquid}       info.inner {x,y,w,h} liquid box, info.mouth
//       jug       {w=110, h=120, level, liquid}            info.spout
//       sieve     {w=140, flip}                            info.bowl {x,y,w,h}
//       funnel    {w=120, paper=true}                      info.tip, info.cone {x,y,w,h}
//       magnet    {w=160, h=44, shape:'bar'|'horseshoe', flip, labelN='N', labelS='S', editN, editS}
//                                                          info.N, info.S pole centres
//       torch     {ang=0 (deg), on=true}                   info.lens, info.ang
//       mirror    {len=180, ang=90 (deg, 90 = upright)}    info.ends [[x,y],[x,y]], info.face (unit normal)
//       screen    {w=24, h=220}                            info.face {x, y0, y1}
//       eye       {dir=1 (1 faces right, -1 left)}         info.pupil
//       cell      {}                                       info.plus, info.minus (terminals)
//       bulb      {lit=false, brightness=1}                info.ends
//       switch    {open=true}                              info.ends
//       buzzer    {on=false}                               info.ends
//       drum      {w=150, h=90}                            info.skin {x0,x1,y}
//       fork      {}  (tuning fork)                        info.tips
//   wire(p, pts, a={})              insulated wire through points (round joins)
//   vibString(p, x1, x2, y, {amp=0, waves=1, a})  a stretched string; returns {g, set(u)} where
//                                   set(u) bends it to u*amp (call from tick; u in -1..1)
//   PARTICLE_R                      12: one particle size for a substance, every state
//   particleLayout(state, box, {r=PARTICLE_R, n, seed=1})  pure positions [[x,y]...] for
//                                   'solid' (touching rows), 'liquid' (touching, jumbled, filling
//                                   from the bottom) or 'gas' (far apart, min 4r). Same r always.
//   particles(p, state, box, {r, n, seed, col='var(--particle)', edge='var(--particle-edge)', a})
//                                   draws the layout; returns {g, pts, dots, r}
//   jiggle(dots, pts, state, t, r)  motion for tick: solids vibrate in place, liquids slide,
//                                   gases drift (deterministic in t)
//   particleLens(ctx, p, {id, sx, sy, sr, cx, cy, r, state, n, seed, pr, col, edge, a})
//                                   kit magnifier on an object showing its particles
//   rays(ctx, p, from, to, {reflect:[[x1,y1],[x2,y2]], after, col='var(--energy)', draw, delay, a})
//                                   straight rays with mid-segment arrowheads; `to` is a point or a
//                                   list of points (a fan). reflect obeys angle in = angle out.
//                                   Returns [{pts, hit}]
//   circuit(ctx, p, components, {box, style:'symbols'|'pictures', a})
//                                   series loop round a box; components [{kind: cell|bulb|switch|
//                                   buzzer|motor|resistor|gap, open, lit, brightness, label, edit,
//                                   material, materialEdit}]. Wires auto-route on the perimeter,
//                                   standard symbols (BS EN 60617) in symbols style.
//                                   Returns {g, pts (closed loop for current dots), items, complete, avoid}.
//                                   complete = has a cell, no open switch, every gap conducts.
//   currentDots(p, pts, {n=10, r=5, col='var(--energy)', a, avoid})  calm dots on the loop,
//                                   hidden inside `avoid` circles (pass circuit(...).avoid);
//                                   returns {g, set(u)} (u 0..1 = one lap; call from tick)
//   forceArrow(ctx, p, at, dir, size, label, {unit=10, col='var(--ink)', edit, computedPath,
//                                   sizeText, a, minLen})  length = size * unit (proportional);
//                                   dir is degrees (0 right, 90 down) or left|right|up|down.
//                                   Returns {g, tip, len, box}
import { h, T, clamp, rng } from './svg.js';
import { GRID } from './layout.js';
import { editable, computed, textBlock, headD, magnifier } from './components.js';

const rad = d => d * Math.PI / 180;
const S = (x, y, s) => `translate(${x} ${y}) scale(${s})`;
const EDGE = { 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

/* ------------------------------------------------------------------ apparatus */
const AP = {
  bench(g, o) {
    const w = o.w || 600, d = o.depth || 26, f = o.front || 40;
    h('rect', { x: -w / 2, y: 0, width: w, height: d, fill: 'var(--bench-top)', cls: 'body' }, g);
    h('rect', { x: -w / 2, y: d, width: w, height: f, fill: 'var(--bench-front)', cls: 'body' }, g);
    h('line', { x1: -w / 2, x2: w / 2, y1: d, y2: d, stroke: 'var(--bench-edge)', 'stroke-width': 'var(--sw-struct)' }, g);
    return { top: -0, w };
  },
  beaker(g, o) {
    const w = o.w || 120, hh = o.h || 150, lv = clamp(o.level == null ? 0 : o.level);
    const lh = (hh - 10) * lv, inner = { x: -w / 2 + 5, y: -5 - lh, w: w - 10, h: lh };
    h('rect', { x: -w / 2, y: -hh, width: w, height: hh, rx: 'var(--r-mark)', fill: 'var(--air)' }, g);
    if (lv > 0) h('rect', { x: inner.x, y: inner.y, width: inner.w, height: inner.h, fill: o.liquid || 'var(--liquid-bg)' }, g);
    for (let i = 1; i <= 4; i++) h('line', { x1: -w / 2 + 6, x2: -w / 2 + 20, y1: -hh * i / 5, y2: -hh * i / 5, stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-hair)' }, g);
    h('path', Object.assign({ d: `M${-w / 2 - 8} ${-hh} Q ${-w / 2} ${-hh} ${-w / 2} ${-hh + 8} V 0 H ${w / 2} V ${-hh}`, fill: 'none', stroke: 'var(--glass-edge)' }, EDGE), g);
    return { inner: { x: inner.x, y: -hh + 5, w: inner.w, h: hh - 10 }, liquid: inner, mouth: [0, -hh] };
  },
  jug(g, o) {
    const w = o.w || 110, hh = o.h || 120, lv = clamp(o.level == null ? .6 : o.level);
    const body = `M${-w / 2} ${-hh} L ${-w / 2 + 8} 0 H ${w / 2 - 8} L ${w / 2} ${-hh} Z`;
    h('path', { d: body, fill: 'var(--air)' }, g);
    if (lv > 0) { const y = -hh * lv; const k = 8 * (1 - lv); h('path', { d: `M${-w / 2 + 8 - k} ${y} L ${-w / 2 + 8} 0 H ${w / 2 - 8} L ${w / 2 - 8 + k} ${y} Z`, fill: o.liquid || 'var(--liquid-bg)' }, g); }
    h('path', Object.assign({ d: `M${-w / 2 - 14} ${-hh - 6} L ${-w / 2} ${-hh} L ${-w / 2 + 8} 0 H ${w / 2 - 8} L ${w / 2} ${-hh}`, fill: 'none', stroke: 'var(--glass-edge)' }, EDGE), g);
    h('path', Object.assign({ d: `M${w / 2 - 2} ${-hh * .8} C ${w / 2 + 34} ${-hh * .8} ${w / 2 + 34} ${-hh * .25} ${w / 2 - 6} ${-hh * .25}`, fill: 'none', stroke: 'var(--glass-edge)' }, EDGE, { 'stroke-width': 'var(--sw-arrow)' }), g);
    return { spout: [-w / 2 - 14, -hh - 6] };
  },
  sieve(g, o) {
    const w = o.w || 140, r = w / 2, f = o.flip ? -1 : 1;
    h('path', { d: `M${-r} ${-r} A ${r} ${r * .7} 0 0 0 ${r} ${-r} Z`, fill: 'var(--metal)', cls: 'body' }, g);
    for (let i = -3; i <= 3; i++) { const x = i * r / 4; const yy = -r + r * .7 * Math.sqrt(1 - (x / r) ** 2); h('line', { x1: x, x2: x, y1: -r, y2: yy, stroke: 'var(--metal-in)', 'stroke-width': 'var(--sw-hair)' }, g); }
    for (let j = 1; j <= 3; j++) { const yy = -r + r * .7 * j / 4; const xx = r * Math.sqrt(1 - (j / 4) ** 2); h('line', { x1: -xx, x2: xx, y1: yy, y2: yy, stroke: 'var(--metal-in)', 'stroke-width': 'var(--sw-hair)' }, g); }
    h('line', Object.assign({ x1: -r - 6, x2: r + 6, y1: -r, y2: -r, stroke: 'var(--metal-shade)' }, EDGE, { 'stroke-width': 'var(--sw-arrow)' }), g);
    h('line', Object.assign({ x1: f * (r + 6), x2: f * (r + 70), y1: -r, y2: -r - 10, stroke: 'var(--metal-shade)' }, EDGE, { 'stroke-width': 'var(--sw-arrow)' }), g);
    return { bowl: { x: -r, y: -r, w: w, h: r * .7 } };
  },
  funnel(g, o) {
    const w = o.w || 120, ch = w * .75, stem = w * .55;
    h('path', { d: `M${-w / 2} ${-ch - stem} L ${-6} ${-stem} V 0 H 6 V ${-stem} L ${w / 2} ${-ch - stem} Z`, fill: 'var(--funnel)' }, g);
    if (o.paper !== false) h('path', { d: `M${-w / 2 + 10} ${-ch - stem - 4} L 0 ${-stem + 6} L ${w / 2 - 10} ${-ch - stem - 4} Z`, fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, g);
    h('path', Object.assign({ d: `M${-w / 2} ${-ch - stem} L ${-6} ${-stem} V 0 M 6 0 V ${-stem} L ${w / 2} ${-ch - stem}`, fill: 'none', stroke: 'var(--glass-edge)' }, EDGE), g);
    return { tip: [0, 0], cone: { x: -w / 2, y: -ch - stem, w, h: ch } };
  },
  magnet(g, o) {
    const w = o.w || 160, hh = o.h || 44, f = o.flip ? -1 : 1;
    const nCol = 'var(--hue-red)', sCol = 'var(--hue-blue)';
    if (o.shape === 'horseshoe') {
      const R = w / 2, t = hh;
      // U opening upwards; left leg N, right leg S (flip swaps)
      h('path', { d: `M${-R + t / 2} ${-R * .55} A ${R - t / 2} ${R - t / 2} 0 0 0 ${R - t / 2} ${-R * .55}`, fill: 'none', stroke: 'var(--metal)', 'stroke-width': t }, g);
      h('line', { x1: -R + t / 2, x2: -R + t / 2, y1: -R * 1.25 - 24, y2: -R * .55, stroke: f > 0 ? nCol : sCol, 'stroke-width': t }, g);
      h('line', { x1: R - t / 2, x2: R - t / 2, y1: -R * 1.25 - 24, y2: -R * .55, stroke: f > 0 ? sCol : nCol, 'stroke-width': t }, g);
      const yL = -R * 1.25 + 6;
      const tN = T(g, f * (-R + t / 2), yL, o.labelN || 'N', 'ts-label', { 'text-anchor': 'middle', fill: 'var(--on-hue)' }); editable(tN, o.editN);
      const tS = T(g, f * (R - t / 2), yL, o.labelS || 'S', 'ts-label', { 'text-anchor': 'middle', fill: 'var(--on-hue)' }); editable(tS, o.editS);
      return { N: [f * (-R + t / 2), -R * 1.25 - 24], S: [f * (R - t / 2), -R * 1.25 - 24] };
    }
    const xN = f > 0 ? -w / 2 : 0, xS = f > 0 ? 0 : -w / 2;
    h('rect', { x: xN, y: -hh, width: w / 2, height: hh, fill: nCol, cls: 'body' }, g);
    h('rect', { x: xS, y: -hh, width: w / 2, height: hh, fill: sCol, cls: 'body' }, g);
    const tN = T(g, xN + w / 4, -hh / 2 + 10, o.labelN || 'N', 'ts-label', { 'text-anchor': 'middle', fill: 'var(--on-hue)' }); editable(tN, o.editN);
    const tS = T(g, xS + w / 4, -hh / 2 + 10, o.labelS || 'S', 'ts-label', { 'text-anchor': 'middle', fill: 'var(--on-hue)' }); editable(tS, o.editS);
    return { N: [f * -w / 2, -hh / 2], S: [f * w / 2, -hh / 2] };
  },
  torch(g, o) {
    const ang = o.ang || 0; const r = h('g', { transform: `rotate(${ang})` }, g);
    h('rect', { x: -70, y: -14, width: 80, height: 28, rx: 'var(--r-mark)', fill: 'var(--metal)', cls: 'body' }, r);
    h('rect', { x: -70, y: 2, width: 80, height: 12, fill: 'var(--metal-shade)' }, r);
    h('path', { d: 'M10 -14 L 34 -24 V 24 L 10 14 Z', fill: 'var(--metal)', cls: 'body' }, r);
    h('rect', { x: 32, y: -24, width: 6, height: 48, fill: o.on === false ? 'var(--glass-edge)' : 'var(--energy)' }, r);
    h('rect', { x: -40, y: -20, width: 14, height: 6, rx: 2, fill: 'var(--ink-2)' }, r);
    const a = rad(ang); return { lens: [38 * Math.cos(a), 38 * Math.sin(a)], ang };
  },
  mirror(g, o) {
    const L = o.len || 180, a = rad(o.ang == null ? 90 : o.ang), ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const e = [[-ux * L / 2, -uy * L / 2], [ux * L / 2, uy * L / 2]];
    // back of the mirror is on the -n side: hatch it
    for (let i = 0; i <= 8; i++) { const t = -L / 2 + L * i / 8; h('line', { x1: ux * t, y1: uy * t, x2: ux * t - nx * 12 + ux * 8, y2: uy * t - ny * 12 + uy * 8, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g); }
    h('line', Object.assign({ x1: e[0][0], y1: e[0][1], x2: e[1][0], y2: e[1][1], stroke: 'var(--glass-edge)' }, EDGE, { 'stroke-width': 'var(--sw-arrow)' }), g);
    return { ends: e, face: [nx, ny] };
  },
  screen(g, o) {
    const w = o.w || 24, hh = o.h || 220;
    h('rect', { x: -w / 2, y: -hh, width: w, height: hh - 16, fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'body' }, g);
    h('rect', { x: -30, y: -16, width: 60, height: 16, fill: 'var(--board)', cls: 'body' }, g);
    return { face: { x: -w / 2, y0: -hh, y1: -16 } };
  },
  eye(g, o) {
    const d = o.dir === -1 ? -1 : 1;
    h('path', { d: `M${-d * 34} 0 Q 0 ${-30} ${d * 34} 0 Q 0 30 ${-d * 34} 0 Z`, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, g);
    h('circle', { cx: d * 14, cy: 0, r: 13, fill: 'var(--water)' }, g);
    h('circle', { cx: d * 18, cy: 0, r: 6, fill: 'var(--ink)' }, g);
    return { pupil: [d * 24, 0] };
  },
  cell(g) {
    h('rect', { x: -40, y: -18, width: 76, height: 36, rx: 'var(--r-mark)', fill: 'var(--metal)', cls: 'body' }, g);
    h('rect', { x: -40, y: -18, width: 26, height: 36, fill: 'var(--metal-shade)' }, g);
    h('rect', { x: 36, y: -8, width: 8, height: 16, fill: 'var(--metal-in)' }, g);
    h('path', { d: 'M18 -6 V 6 M12 0 H 24', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
    h('path', { d: 'M-32 0 H -22', stroke: 'var(--on-hue)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
    return { plus: [44, 0], minus: [-40, 0] };
  },
  bulb(g, o) {
    const lit = !!o.lit, b = clamp(o.brightness == null ? 1 : o.brightness);
    if (lit) for (let i = 0; i < 8; i++) { const a = rad(-90 + (i - 3.5) * 26), r0 = 34, r1 = 34 + 10 + 22 * b; h('line', { x1: r0 * Math.cos(a), y1: -38 + r0 * Math.sin(a), x2: r1 * Math.cos(a), y2: -38 + r1 * Math.sin(a), stroke: 'var(--energy)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', opacity: .35 + .65 * b }, g); }
    h('circle', { cx: 0, cy: -38, r: 26, fill: 'var(--air)', stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-struct)' }, g);
    if (lit) h('circle', { cx: 0, cy: -38, r: 26, fill: 'var(--energy)', opacity: .25 + .6 * b }, g);
    h('path', { d: 'M-6 -16 L -6 -34 L 0 -42 L 6 -34 L 6 -16', fill: 'none', stroke: lit ? 'var(--heat)' : 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
    h('rect', { x: -16, y: -16, width: 32, height: 16, fill: 'var(--metal)', cls: 'body' }, g);
    h('rect', { x: -30, y: -2, width: 60, height: 10, rx: 2, fill: 'var(--board)', cls: 'body' }, g);
    return { ends: [[-30, 3], [30, 3]] };
  },
  switch(g, o) {
    const open = o.open !== false;
    h('rect', { x: -44, y: -10, width: 88, height: 14, rx: 2, fill: 'var(--board)', cls: 'body' }, g);
    h('circle', { cx: -30, cy: -12, r: 6, fill: 'var(--metal-shade)' }, g); h('circle', { cx: 30, cy: -12, r: 6, fill: 'var(--metal-shade)' }, g);
    const a = open ? rad(-30) : 0; h('line', Object.assign({ x1: -30, y1: -12, x2: -30 + 64 * Math.cos(a), y2: -12 + 64 * Math.sin(a), stroke: 'var(--metal)' }, EDGE, { 'stroke-width': 'var(--sw-arrow)' }), g);
    return { ends: [[-44, -4], [44, -4]] };
  },
  buzzer(g, o) {
    h('rect', { x: -32, y: -40, width: 64, height: 40, rx: 'var(--r-card)', fill: 'var(--hob)', cls: 'body' }, g);
    for (let i = 0; i < 3; i++) h('circle', { cx: -14 + i * 14, cy: -22, r: 3, fill: 'var(--metal)' }, g);
    if (o.on) for (const s of [-1, 1]) for (let i = 0; i < 2; i++) h('path', { d: `M${s * (42 + i * 12)} -34 Q ${s * (50 + i * 12)} -20 ${s * (42 + i * 12)} -6`, fill: 'none', stroke: 'var(--energy)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
    return { ends: [[-32, -10], [32, -10]] };
  },
  drum(g, o) {
    const w = o.w || 150, hh = o.h || 90, ry = w * .14;
    h('rect', { x: -w / 2, y: -hh, width: w, height: hh, fill: 'var(--heat)', cls: 'body' }, g);
    h('rect', { x: w / 2 - w * .28, y: -hh, width: w * .28, height: hh, fill: 'color-mix(in oklab,var(--heat) 70%,var(--shade))' }, g);
    for (let i = 0; i < 5; i++) { const x = -w / 2 + w * (i + .5) / 5; h('path', { d: `M${x - w / 10} ${-hh} L ${x + w / 10} 0`, stroke: 'var(--paper)', 'stroke-width': 'var(--sw-hair)' }, g); }
    h('ellipse', { cx: 0, cy: 0, rx: w / 2, ry, fill: 'var(--heat)', cls: 'body' }, g);
    h('ellipse', { cx: 0, cy: -hh, rx: w / 2, ry, fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'body' }, g);
    return { skin: { x0: -w / 2, x1: w / 2, y: -hh } };
  },
  fork(g) {
    h('rect', { x: -4, y: -40, width: 8, height: 40, rx: 3, fill: 'var(--metal-shade)' }, g);
    h('path', { d: 'M-18 -150 V -56 Q -18 -40 0 -40 Q 18 -40 18 -56 V -150', fill: 'none', stroke: 'var(--metal)', 'stroke-width': 10, 'stroke-linecap': 'round' }, g);
    return { tips: [[-18, -150], [18, -150]] };
  },
};
export const APPARATUS = Object.keys(AP);
/** Which apparatus fits which topic. A model places only apparatus whose tags include its topic. */
export const APPARATUS_TOPICS = {
  bench: ['any'], beaker: ['materials', 'states', 'separating'], jug: ['materials', 'states', 'separating'],
  sieve: ['separating'], funnel: ['separating'], magnet: ['magnets', 'forces', 'materials', 'separating'],
  torch: ['light'], mirror: ['light'], screen: ['light'], eye: ['light'],
  cell: ['electricity'], bulb: ['electricity'], switch: ['electricity'], buzzer: ['electricity'],
  drum: ['sound'], fork: ['sound'],
};
export const apparatusFor = topic => Object.keys(APPARATUS_TOPICS).filter(k => APPARATUS_TOPICS[k].includes(topic) || APPARATUS_TOPICS[k].includes('any'));
/** Draw apparatus `kind` with its base centre at (x,y). Build classes go on the outer group. */
export function apparatus(p, kind, x, y, s = 1, a = {}, o = {}) {
  const outer = h('g', a, p); const g = h('g', { transform: S(x, y, s) }, outer);
  const info = (AP[kind] || AP.beaker)(g, o) || {};
  // anchor points in slide units
  const map = v => Array.isArray(v) && typeof v[0] === 'number' ? [x + v[0] * s, y + v[1] * s] : v;
  outer.info = {};
  for (const k in info) {
    const v = info[k];
    if (Array.isArray(v) && Array.isArray(v[0])) outer.info[k] = v.map(map);
    else if (v && typeof v === 'object' && !Array.isArray(v) && 'w' in v) outer.info[k] = { x: x + v.x * s, y: y + v.y * s, w: v.w * s, h: v.h * s };
    else outer.info[k] = map(v);
  }
  return outer;
}
/** Insulated wire through points. */
export const wire = (p, pts, a = {}) => h('path', Object.assign({ d: 'M' + pts.map(q => q.join(' ')).join(' L '), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, a), p);
/** Stretched string between pegs; set(u) bends its middle by u*amp (u in -1..1). */
export function vibString(p, x1, x2, y, { amp = 0, waves = 1, a = {} } = {}) {
  const g = h('g', a, p);
  for (const x of [x1, x2]) h('rect', { x: x - 6, y: y - 16, width: 12, height: 32, rx: 3, fill: 'var(--board)', cls: 'body' }, g);
  const path = h('path', { fill: 'none', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  const set = u => { let d = ''; for (let i = 0; i <= 48; i++) { const s = i / 48; d += (i ? 'L' : 'M') + (x1 + (x2 - x1) * s).toFixed(1) + ' ' + (y + amp * u * Math.sin(Math.PI * waves * s)).toFixed(1); } path.setAttribute('d', d); };
  set(0); return { g, set };
}

/* ------------------------------------------------------------------ particles */
/** One particle size per substance in every state. Gas particles are far apart, never bigger. */
export const PARTICLE_R = 12;
export function particleLayout(state, box, { r = PARTICLE_R, n, seed = 1 } = {}) {
  const R = rng(seed), d = 2 * r, pts = [];
  if (state === 'solid') {
    const cols = Math.max(1, Math.floor(box.w / d)), rows = Math.max(1, Math.floor(box.h / d));
    const ox = box.x + (box.w - cols * d) / 2 + r, oy = box.y + box.h - (rows * d) + r;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pts.push([ox + i * d, oy + j * d]);
    return n ? pts.slice(-n) : pts;
  }
  if (state === 'liquid') {
    // touching, jumbled, filling from the bottom: a jittered hex pack with gaps
    const cols = Math.max(1, Math.floor(box.w / d)), rows = Math.max(1, Math.floor(box.h / (d * .9)));
    const all = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols - (j % 2); i++) {
      const x = box.x + r + (box.w - cols * d) / 2 + i * d + (j % 2) * r + (R() - .5) * r * .5;
      const y = box.y + box.h - r - j * d * .88 + (R() - .5) * r * .3; all.push([x, y]);
    }
    const want = Math.min(all.length, n || Math.round(all.length * .85));
    // fill from the bottom; the surface row is ragged and a few gaps sit inside (jumbled, still touching)
    const keep = all.slice(0, Math.min(all.length, Math.ceil(want * 1.04)));
    for (let i = keep.length - 1; keep.length > want && i >= 0; i--) if (R() < .5) keep.splice(i, 1);
    return keep.slice(0, want);
  }
  // gas: far apart (at least 4r centre to centre), spread through the whole box
  const want = n || Math.max(4, Math.round(box.w * box.h / (d * d * 14)));
  for (let tries = 0; pts.length < want && tries < want * 400; tries++) {
    const q = [box.x + r + R() * (box.w - d), box.y + r + R() * (box.h - d)];
    if (pts.every(o => Math.hypot(o[0] - q[0], o[1] - q[1]) >= 4 * r)) pts.push(q);
  }
  return pts;
}
export function particles(p, state, box, { r = PARTICLE_R, n, seed = 1, col = 'var(--particle)', edge = 'var(--particle-edge)', a = {} } = {}) {
  const g = h('g', a, p); const pts = particleLayout(state, box, { r, n, seed });
  const dots = pts.map(([x, y]) => h('circle', { cx: x, cy: y, r, fill: col, stroke: edge, 'stroke-width': 'var(--sw-hair)' }, g));
  return { g, pts, dots, r };
}
/** Calm continuous motion for tick(): solids vibrate in place, liquids slide past, gases drift. */
export function jiggle(dots, pts, state, t, r = PARTICLE_R) {
  const amp = state === 'solid' ? r * .12 : state === 'liquid' ? r * .3 : r * 1.4, w = state === 'gas' ? .7 : state === 'liquid' ? 1.6 : 9;
  dots.forEach((el, i) => { const ph = i * 2.39; el.setAttribute('cx', (pts[i][0] + amp * Math.sin(w * t + ph)).toFixed(1)); el.setAttribute('cy', (pts[i][1] + amp * Math.cos(w * .83 * t + ph * 1.3)).toFixed(1)); });
}
/** The kit magnifier on an object, showing its particles in the lens. */
export function particleLens(ctx, p, o) {
  const m = magnifier(ctx, p, o); const R = o.r * .92;
  const box = { x: o.cx - R, y: o.cy - R, w: 2 * R, h: 2 * R };
  const pr = particles(m.inner, o.state || 'solid', box, { r: o.pr || PARTICLE_R, n: o.n, seed: o.seed || 1, col: o.col, edge: o.edge });
  m.rim(); return Object.assign(m, { particles: pr });
}

/* ------------------------------------------------------------------ light rays */
function hitSeg(o, d, a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1], den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den, u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
  return t > 1e-6 && u >= 0 && u <= 1 ? t : null;
}
/** Straight rays from `from` towards `to` (a point or list of points). With reflect (a mirror
 *  segment) a ray that meets it turns so the angle of incidence equals the angle of reflection,
 *  and travels on for `after` units (default: the rest of its length). */
export function rays(ctx, p, from, to, { reflect, after, col = 'var(--energy)', draw, delay = 0, a = {} } = {}) {
  const g = h('g', a, p); const out = []; const targets = Array.isArray(to[0]) ? to : [to]; const s = ctx.tk.head * .9;
  targets.forEach((tp, i) => {
    const L = Math.hypot(tp[0] - from[0], tp[1] - from[1]); const d = [(tp[0] - from[0]) / L, (tp[1] - from[1]) / L];
    let pts = [from, tp], hit = null;
    if (reflect) {
      const t = hitSeg(from, d, reflect[0], reflect[1]);
      if (t != null && t <= L + 1) {
        hit = [from[0] + d[0] * t, from[1] + d[1] * t];
        const ex = reflect[1][0] - reflect[0][0], ey = reflect[1][1] - reflect[0][1], el = Math.hypot(ex, ey), nx = -ey / el, ny = ex / el;
        const dot = d[0] * nx + d[1] * ny, r2 = [d[0] - 2 * dot * nx, d[1] - 2 * dot * ny], rest = after == null ? L - t : after;
        pts = [from, hit, [hit[0] + r2[0] * rest, hit[1] + r2[1] * rest]];
      }
    }
    const pa = { d: 'M' + pts.map(q => q.map(v => v.toFixed(1)).join(' ')).join(' L '), fill: 'none', stroke: col, 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (draw != null) Object.assign(pa, { cls: 'draw', pathLength: 1, s: draw, delay: delay + i * 120 });
    h('path', pa, g);
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], ang = Math.atan2(y1 - y0, x1 - x0);
      h('path', { d: headD((x0 + x1) / 2 + Math.cos(ang) * s * .5, (y0 + y1) / 2 + Math.sin(ang) * s * .5, ang, s), fill: col, s: draw, delay: draw != null ? delay + i * 120 + 500 * k : null }, g);
    }
    out.push({ pts, hit });
  });
  out.g = g; return out;
}

/* ------------------------------------------------------------------ circuits */
// Symbols drawn along +x, centred on 0, spanning [-L/2, L/2]; leads join the wire at the ends.
const SYM_L = { cell: 40, bulb: 64, switch: 48, buzzer: 64, motor: 64, resistor: 72, gap: 120 };
const SY = {
  cell(g) { h('line', { x1: -20, x2: -5, y1: 0, y2: 0, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g); h('line', { x1: 5, x2: 20, y1: 0, y2: 0, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g); h('rect', { x: -12, y: -18, width: 36, height: 36, fill: 'var(--bg)' }, g); h('line', { x1: -5, x2: -5, y1: -26, y2: 26, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g); h('line', { x1: 5, x2: 5, y1: -13, y2: 13, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-arrow)' }, g); },
  bulb(g, c) {
    if (c.lit) h('circle', { cx: 0, cy: 0, r: 22, fill: 'var(--energy)', opacity: .3 + .6 * clamp(c.brightness == null ? 1 : c.brightness) }, g);
    h('circle', { cx: 0, cy: 0, r: 22, fill: c.lit ? 'none' : 'var(--bg)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g);
    h('path', { d: 'M-15.5 -15.5 L 15.5 15.5 M-15.5 15.5 L 15.5 -15.5', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g);
  },
  switch(g, c) {
    h('circle', { cx: -22, cy: 0, r: 5, fill: 'var(--ink)' }, g); h('circle', { cx: 22, cy: 0, r: 5, fill: 'var(--ink)' }, g);
    const a = c.open !== false ? rad(-28) : 0; h('line', { x1: -22, y1: 0, x2: -22 + 46 * Math.cos(a), y2: 46 * Math.sin(a), stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  },
  buzzer(g) {
    h('rect', { x: -24, y: -36, width: 48, height: 40, fill: 'var(--bg)' }, g);
    h('path', { d: 'M-32 0 H -10 V -8 M 10 -8 V 0 H 32', fill: 'none', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, g);
    h('path', { d: 'M-22 -8 H 22 A 22 22 0 0 0 -22 -8 Z', fill: 'var(--bg)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, g);
  },
  motor(g, c, path, ang) { h('circle', { cx: 0, cy: 0, r: 22, fill: 'var(--bg)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g); computed(T(h('g', { transform: `rotate(${-ang})` }, g), 0, 8, 'M', 'ts-tiny', { 'text-anchor': 'middle', fill: 'var(--ink)' }), path); },
  resistor(g) { h('rect', { x: -28, y: -11, width: 56, height: 22, fill: 'var(--bg)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g); },
  gap(g) {
    h('rect', { x: -40, y: -12, width: 80, height: 24, fill: 'var(--bg)' }, g);
    for (const s of [-1, 1]) h('path', { d: `M${s * 40} 0 H ${s * 30} L ${s * 22} -8 M ${s * 30} 0 L ${s * 22} 8`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
    h('rect', { x: -20, y: -9, width: 40, height: 18, rx: 'var(--r-mark)', fill: 'var(--item)', cls: 'body' }, g);
  },
};
/** Series circuit round `box`. Components are spread over the four sides (longest free side
 *  first), wires fill the perimeter between them, and the closed loop is returned for current. */
export function circuit(ctx, p, components, { box, style = 'symbols', a = {}, path = 'components' } = {}) {
  const g = h('g', a, p), { x, y, w, h: hh } = box;
  const C = [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]];
  const sides = [0, 1, 2, 3].map(i => ({ i, a: C[i], b: C[(i + 1) % 4], len: i % 2 ? hh : w, items: [] }));
  const order = [0, 2, 3, 1];
  components.forEach((c, k) => {
    const need = style === 'pictures' ? 150 : (SYM_L[c.kind] || 64) + 50;
    const best = order.map(i => sides[i]).reduce((m, s) => { const free = (s.len - s.items.reduce((t, it) => t + it.need, 0) - need) / (s.items.length + 2); return free > m.f ? { s, f: free } : m; }, { s: null, f: -1e9 });
    if (best.f < 0) ctx.warn(`circuit: no room for ${c.kind} on a ${w}×${hh} loop`);
    best.s.items.push({ c, k, need });
  });
  const items = []; const spans = [];
  for (const s of sides) {
    const n = s.items.length, ux = (s.b[0] - s.a[0]) / s.len, uy = (s.b[1] - s.a[1]) / s.len, ang = Math.atan2(uy, ux) * 180 / Math.PI;
    s.items.forEach((it, j) => {
      const t = s.len * (j + 1) / (n + 1), cx = s.a[0] + ux * t, cy = s.a[1] + uy * t, L = style === 'pictures' ? 0 : (SYM_L[it.c.kind] || 64);
      spans.push({ side: s.i, t0: t - L / 2, t1: t + L / 2 });
      items.push({ kind: it.c.kind, k: it.k, x: cx, y: cy, ang, c: it.c });
    });
  }
  // wires: each side minus component spans
  const wg = h('g', {}, g);
  for (const s of sides) {
    const ux = (s.b[0] - s.a[0]) / s.len, uy = (s.b[1] - s.a[1]) / s.len; let t = 0;
    const sp = spans.filter(q => q.side === s.i).sort((m, n) => m.t0 - n.t0);
    for (const q of sp.concat([{ t0: s.len, t1: s.len }])) { if (q.t0 > t) wire(wg, [[s.a[0] + ux * t, s.a[1] + uy * t], [s.a[0] + ux * q.t0, s.a[1] + uy * q.t0]], style === 'symbols' ? { stroke: 'var(--ink)' } : {}); t = q.t1; }
  }
  for (const it of items) {
    const c = it.c; let lab;
    if (style === 'pictures') {
      const kind = c.kind === 'gap' ? null : c.kind === 'motor' || c.kind === 'resistor' ? null : c.kind;
      if (kind) { const yb = kind === 'cell' ? it.y : it.y + (kind === 'bulb' || kind === 'buzzer' ? 6 : 6); it.el = apparatus(g, kind, it.x, yb, 1, {}, { open: c.open, lit: c.lit, brightness: c.brightness, on: c.lit }); }
      else { it.el = h('g', { transform: `translate(${it.x} ${it.y})` }, g); SY.gap(it.el, c); }
    } else {
      it.el = h('g', { transform: `translate(${it.x} ${it.y}) rotate(${it.ang})` }, g); (SY[c.kind] || SY.resistor)(it.el, c, `${path}.${it.k}.kind`, it.ang);
    }
    // labels sit outside the loop
    const label = c.kind === 'gap' ? c.material : c.label, edit = c.kind === 'gap' ? (c.materialEdit || `${path}.${it.k}.material`) : (c.edit || (c.label != null ? `${path}.${it.k}.label` : null));
    if (label) {
      const out = it.y <= y + 1 ? -1 : it.y >= y + hh - 1 ? 1 : 0, side = it.x <= x + 1 ? -1 : it.x >= x + w - 1 ? 1 : 0;
      const pic = style === 'pictures', top = pic ? (c.kind === 'bulb' || c.kind === 'buzzer' ? 92 : 40) : 44, bot = pic ? 40 : 44, off = pic ? 56 : 44;
      if (out) lab = textBlock(g, it.x, out < 0 ? it.y - top - 6 : it.y + bot + 24, label, { cls: 'ts-small', maxW: 200, maxLines: 2, lh: 28, anchor: 'middle', edit });
      else lab = textBlock(g, it.x + side * off, it.y + 8, label, { cls: 'ts-small', maxW: 180, maxLines: 2, lh: 28, anchor: side < 0 ? 'end' : 'start', edit });
      if (out < 0 && lab.lines.length > 1) lab.el.setAttribute('y', +lab.el.getAttribute('y') - lab.h + lab.lh);
      const x0 = lab.el.getAttribute('text-anchor') === 'end' ? it.x + side * off - lab.w : lab.el.getAttribute('text-anchor') === 'middle' ? it.x - lab.w / 2 : it.x + side * off;
      if (x0 < GRID.left - 1 || x0 + lab.w > GRID.right + 1) ctx.warn(`circuit: label "${label}" runs outside the live area; move the loop in`);
      it.label = lab; it.labelBox = { x: x0, w: lab.w };
    }
  }
  const complete = components.some(c => c.kind === 'cell') && !components.some(c => (c.kind === 'switch' && c.open !== false) || (c.kind === 'gap' && !c.conducts));
  for (const it of items) it.r = (style === 'pictures' ? 60 : (SYM_L[it.kind] || 64) / 2 + 8);
  return { g, pts: C.concat([C[0]]), items, complete, avoid: items.map(it => ({ x: it.x, y: it.y, r: it.r })) };
}
/** Calm current dots travelling round a closed loop; set(u), u = 0..1 for one lap. */
export function currentDots(p, pts, { n = 10, r = 5, col = 'var(--energy)', a = {}, avoid = [] } = {}) {
  const g = h('g', a, p); const seg = []; let L = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  const at = v => { let t = ((v % 1) + 1) % 1 * L; for (let i = 0; i < seg.length; i++) { if (t <= seg[i]) { const u = t / seg[i]; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]; } t -= seg[i]; } return pts[0]; };
  const dots = Array.from({ length: n }, () => h('circle', { r, fill: col }, g));
  const set = u => dots.forEach((d, i) => { const [cx, cy] = at(u + i / n); d.setAttribute('cx', cx.toFixed(1)); d.setAttribute('cy', cy.toFixed(1)); d.setAttribute('opacity', avoid.some(q => Math.hypot(q.x - cx, q.y - cy) < q.r) ? 0 : 1); });
  set(0); return { g, set };
}

/* ------------------------------------------------------------------ forces */
const DIRS = { right: 0, down: 90, left: 180, up: 270 };
/** Force arrow from `at`, its length proportional to size (size * unit). The label sits past the
 *  head; an optional computed size line (e.g. "10 N") sits under it. */
export function forceArrow(ctx, p, at, dir, size, label, { unit = 10, col = 'var(--ink)', edit, computedPath, sizeText, a = {}, minLen } = {}) {
  const g = h('g', a, p); const ang = rad(typeof dir === 'string' ? (DIRS[dir] ?? 0) : dir), len = Math.abs(size) * unit, s = ctx.tk.head;
  if (len < (minLen || s * 2)) ctx.warn(`forceArrow: ${label || 'force'} is too short to read (${len.toFixed(0)} units); raise unit`);
  const ux = Math.cos(ang), uy = Math.sin(ang), tip = [at[0] + ux * len, at[1] + uy * len];
  const ex = tip[0] - ux * s * .72, ey = tip[1] - uy * s * .72;
  h('path', { d: `M${at[0]} ${at[1]} L ${ex} ${ey}`, stroke: col, 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', fill: 'none' }, g);
  h('path', { d: headD(tip[0], tip[1], ang, s), fill: col }, g);
  let box = null;
  if (label) {
    const gap = 16, horiz = Math.abs(ux) >= Math.abs(uy);
    const lx = tip[0] + ux * gap, ly = tip[1] + uy * gap;
    const anchor = horiz ? (ux > 0 ? 'start' : 'end') : 'middle';
    const ty = horiz ? ly + 9 : (uy > 0 ? ly + 24 : ly - (sizeText ? 34 : 6));
    const tb = textBlock(g, lx, ty, label, { cls: 'ts-small', maxW: 220, maxLines: 2, lh: 28, anchor, edit, a: { fill: col === 'var(--ink)' ? 'var(--ink)' : col } });
    let hgt = tb.h;
    if (sizeText) { const st = T(g, lx, ty + tb.h, sizeText, 'ts-tiny', { 'text-anchor': anchor }); computed(st, computedPath); hgt += 26; }
    const x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - tb.w : lx - tb.w / 2;
    box = { x: x0, y: ty - 22, w: tb.w, h: hgt };
  }
  return { g, tip, len, box };
}

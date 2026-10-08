// body_map private drawing parts: face, hair and ears on the kit bodyOutline, a flat skeleton,
// a side-view arm with an antagonistic muscle pair, and one jaw of teeth seen from above.
// Tokens only; anatomical thicknesses scale with the figure (like the kit's organ()).
import { h } from '../../kit/index.js';

const B = 'body';
const geo = (Bd) => { const { H, L, top, cx } = Bd; return { H, L, top, cx, X: f => cx + f * H, Y: f => top + f * H, hx: L.hx * H, hb: L.headB * H }; };

/* ------------------------------------------------------------------ face */
/** Hair cap, ears, eyes, nose and mouth. mouth: 'smile' | 'open' (shows the tongue). Returns points. */
export function face(p, Bd, { mouth = 'smile', a = {} } = {}) {
  const { cx, top, hx, hb } = geo(Bd); const g = h('g', a, p);
  const eyeY = top + hb * .5, earY = top + hb * .54, noseY = top + hb * .64, mouthY = top + hb * .8;
  h('path', { d: `M${cx - hx * 1.01} ${top + hb * .46} C ${cx - hx * 1.12} ${top - hb * .1} ${cx + hx * 1.12} ${top - hb * .1} ${cx + hx * 1.01} ${top + hb * .46} Q ${cx + hx * .86} ${top + hb * .2} ${cx + hx * .2} ${top + hb * .2} Q ${cx - hx * .7} ${top + hb * .22} ${cx - hx * 1.01} ${top + hb * .46} Z`, fill: 'var(--person-2)', cls: B }, g);
  for (const s of [-1, 1]) {
    h('ellipse', { cx: cx + s * hx * 1.0, cy: earY, rx: hx * .17, ry: hb * .12, fill: 'var(--person-1)', cls: B }, g);
    h('path', { d: `M${cx + s * hx * 1.04} ${earY - hb * .06} Q ${cx + s * hx * 1.1} ${earY} ${cx + s * hx * 1.03} ${earY + hb * .06}`, fill: 'none', stroke: 'var(--person-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
    h('circle', { cx: cx + s * hx * .38, cy: eyeY, r: Math.max(4.5, hx * .1), fill: 'var(--shade)' }, g);
  }
  // features keep their proportions at every figure size (strokes scale with the head)
  const fw = Math.max(2.5, hx * .045), feat = 'color-mix(in oklab,var(--person-2) 45%,var(--shade))';
  h('path', { d: `M${cx - hx * .02} ${noseY - hb * .09} Q ${cx + hx * .18} ${noseY + hb * .03} ${cx - hx * .08} ${noseY + hb * .05}`, fill: 'none', style: `stroke:${feat}`, 'stroke-width': fw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  if (mouth === 'open') {
    h('path', { d: `M${cx - hx * .34} ${mouthY - hb * .04} Q ${cx} ${mouthY + hb * .2} ${cx + hx * .34} ${mouthY - hb * .04} Z`, style: `fill:${feat}` }, g);
    h('ellipse', { cx, cy: mouthY + hb * .065, rx: hx * .19, ry: hb * .045, fill: 'var(--ear)' }, g);
  } else h('path', { d: `M${cx - hx * .22} ${mouthY - hb * .02} Q ${cx} ${mouthY + hb * .07} ${cx + hx * .22} ${mouthY - hb * .02}`, fill: 'none', style: `stroke:${feat}`, 'stroke-width': Math.max(3, hx * .05), 'stroke-linecap': 'round' }, g);
  return { g, eyeY, earY, noseY, mouthY, eyeDX: hx * .38, earDX: hx * 1.1 };
}

/* ------------------------------------------------------------------ bones */
/** A bone: a keyline stroke and a bone-coloured stroke, with knob ends. Returns {set(x1,y1,x2,y2)}. */
export function bone(g, w, { knobs = true } = {}) {
  const kp = h('path', { fill: 'none', stroke: 'var(--stone-shade)', 'stroke-width': w + 4, 'stroke-linecap': 'round' }, g);
  const kk = knobs ? [0, 1].map(() => h('circle', { r: w * .72 + 2, fill: 'var(--stone-shade)' }, g)) : [];
  const fp = h('path', { fill: 'none', stroke: 'var(--marble)', 'stroke-width': w, 'stroke-linecap': 'round' }, g);
  const fk = knobs ? [0, 1].map(() => h('circle', { r: w * .72, fill: 'var(--marble)' }, g)) : [];
  return {
    set(x1, y1, x2, y2) {
      const d = `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`; kp.setAttribute('d', d); fp.setAttribute('d', d);
      const ux = x2 - x1, uy = y2 - y1, l = Math.hypot(ux, uy) || 1, o = w * .35;
      [[x1 + ux / l * o, y1 + uy / l * o], [x2 - ux / l * o, y2 - uy / l * o]].forEach(([x, y], i) => { if (kk[i]) { kk[i].setAttribute('cx', x); kk[i].setAttribute('cy', y); fk[i].setAttribute('cx', x); fk[i].setAttribute('cy', y); } });
      return this;
    },
  };
}
const shape = (g, d, fill = 'var(--marble)') => h('path', { d, fill, stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round' }, g);

/** Front-view skeleton fitted inside a bodyOutline. Returns label points for every bone and joint. */
export function skeleton(p, Bd, a = {}) {
  const { H, L, top, cx, X, Y, hx, hb } = geo(Bd); const g = h('g', a, p);
  const sY = Y(L.shoulder), wY = Y(L.waist), cY = Y(L.crotch), T0 = wY - sY, sh = L.sh, hp = L.hip;
  const pts = {};
  // spine: neck to pelvis, one block per vertebra
  const s0 = top + hb * 1.0, s1 = cY - .03 * H, n = 17, vh = (s1 - s0) / n;
  for (let i = 0; i < n; i++) h('rect', { x: cx - .016 * H, y: s0 + i * vh + vh * .14, width: .032 * H, height: vh * .72, rx: vh * .25, fill: 'var(--marble)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-hair)' }, g);
  // pelvis: two wings, the sacrum and the ring under it
  const pY = cY - .06 * H;
  for (const s of [-1, 1]) shape(g, `M${cx + s * .02 * H} ${pY - .03 * H} C ${cx + s * hp * .55 * H} ${pY - .07 * H} ${cx + s * hp * 1.05 * H} ${pY - .05 * H} ${cx + s * hp * .95 * H} ${pY + .005 * H} C ${cx + s * hp * .85 * H} ${pY + .04 * H} ${cx + s * hp * .45 * H} ${pY + .06 * H} ${cx + s * .02 * H} ${pY + .045 * H} Z`);
  shape(g, `M${cx - .028 * H} ${pY - .035 * H} L ${cx + .028 * H} ${pY - .035 * H} L ${cx} ${pY + .05 * H} Z`);
  // ribs: pairs curving out from the spine, a breastbone over them
  for (let i = 0; i < 6; i++) {
    const y = sY + T0 * (.1 + i * .1), w = sh * H * (.74 - Math.abs(i - 2) * .05 - (i > 3 ? .06 : 0));
    for (const s of [-1, 1]) {
      const d = `M${cx + s * .018 * H} ${y} C ${cx + s * w * .7} ${y - .022 * H} ${cx + s * w} ${y - .004 * H} ${cx + s * w} ${y + .018 * H} C ${cx + s * w} ${y + .036 * H} ${cx + s * w * .7} ${y + .05 * H} ${cx + s * w * .45} ${y + .056 * H}`;
      h('path', { d, fill: 'none', stroke: 'var(--stone-shade)', 'stroke-width': .011 * H + 3, 'stroke-linecap': 'round' }, g);
      h('path', { d, fill: 'none', stroke: 'var(--marble)', 'stroke-width': .011 * H, 'stroke-linecap': 'round' }, g);
    }
  }
  h('rect', { x: cx - .013 * H, y: sY + T0 * .06, width: .026 * H, height: T0 * .48, rx: .01 * H, fill: 'var(--marble)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)' }, g);
  // collarbones
  for (const s of [-1, 1]) bone(g, .013 * H, { knobs: false }).set(cx + s * .02 * H, sY + .016 * H, X(s * (sh - .022)), sY + .008 * H);
  // arms and legs
  for (const s of [-1, 1]) {
    const S = [X(s * (sh - .008)), Y(L.shoulder + .025)], E = [X(s * (sh + .012)), Y((L.shoulder + L.wrist) / 2)], Wr = [X(s * (sh + .025)), Y(L.wrist)];
    bone(g, .018 * H).set(S[0], S[1], E[0], E[1]);
    for (const o of [-1, 1]) bone(g, .009 * H, { knobs: false }).set(E[0] + o * .006 * H, E[1] + .01 * H, Wr[0] + o * .007 * H, Wr[1]);
    h('ellipse', { cx: Wr[0] + s * .006 * H, cy: Wr[1] + .028 * H, rx: .017 * H, ry: .026 * H, fill: 'var(--marble)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)' }, g);
    const lx = s * (hp - L.leg / 2 - .004);
    const Hj = [X(s * hp * .62), pY + .012 * H], K = [X(lx), Y(L.knee)], A = [X(lx), Y(L.ankle)];
    bone(g, .022 * H).set(Hj[0], Hj[1], K[0], K[1]);
    bone(g, .015 * H).set(K[0] - s * .005 * H, K[1] + .012 * H, A[0] - s * .005 * H, A[1]);
    bone(g, .008 * H, { knobs: false }).set(K[0] + s * .012 * H, K[1] + .02 * H, A[0] + s * .011 * H, A[1] - .004 * H);
    h('circle', { cx: K[0], cy: K[1], r: .013 * H, fill: 'var(--marble)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)' }, g);
    h('ellipse', { cx: A[0] + s * .014 * H, cy: Y(.982), rx: .03 * H, ry: .011 * H, fill: 'var(--marble)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)' }, g);
    const side = s < 0 ? 'R' : 'L'; // body's right is the viewer's left
    pts['shoulder' + side] = S; pts['elbow' + side] = E; pts['hip' + side] = Hj; pts['knee' + side] = K; pts['ankle' + side] = A; pts['wrist' + side] = Wr;
  }
  // skull last, on top of the neck
  const skY = top + hb * .44;
  shape(g, `M${cx - hx * .52} ${top + hb * .72} C ${cx - hx * .95} ${top + hb * .6} ${cx - hx * .95} ${top + hb * .02} ${cx} ${top + hb * .02} C ${cx + hx * .95} ${top + hb * .02} ${cx + hx * .95} ${top + hb * .6} ${cx + hx * .52} ${top + hb * .72} Z`);
  h('path', { d: `M${cx - hx * .5} ${top + hb * .7} Q ${cx - hx * .46} ${top + hb * .98} ${cx} ${top + hb * .99} Q ${cx + hx * .46} ${top + hb * .98} ${cx + hx * .5} ${top + hb * .7}`, fill: 'var(--marble)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round' }, g);
  for (const s of [-1, 1]) h('ellipse', { cx: cx + s * hx * .34, cy: top + hb * .5, rx: hx * .2, ry: hb * .1, fill: 'var(--stone-shade)' }, g);
  h('path', { d: `M${cx} ${top + hb * .58} L ${cx - hx * .08} ${top + hb * .7} L ${cx + hx * .08} ${top + hb * .7} Z`, fill: 'var(--stone-shade)' }, g);
  Object.assign(pts, {
    skull: [cx - hx * .62, skY - hb * .12], jaw: [cx + hx * .4, top + hb * .9],
    collarbone: [X(sh * .55), sY + .012 * H], ribs: [cx - sh * H * .62, sY + T0 * .42], spine: [cx + .016 * H, sY + T0 * .92],
    pelvis: [cx - hp * H * .8, pY], humerus: [(pts.shoulderL[0] + pts.elbowL[0]) / 2, (pts.shoulderL[1] + pts.elbowL[1]) / 2],
    forearm: [(pts.elbowR[0] + pts.wristR[0]) / 2, (pts.elbowR[1] + pts.wristR[1]) / 2],
    femur: [(pts.hipL[0] + pts.kneeL[0]) / 2, (pts.hipL[1] + pts.kneeL[1]) / 2], kneecap: [pts.kneeR[0], pts.kneeR[1]],
    shin: [(pts.kneeL[0] + pts.ankleL[0]) / 2, (pts.kneeL[1] + pts.ankleL[1]) / 2],
  });
  return { g, pts };
}

/* ------------------------------------------------------------------ arm: side view, facing right */
/** The arm from the side: shoulder blade, upper arm bone, forearm bones, hand, biceps (front) and
 *  triceps (back). set(angle) poses the forearm (radians, 90° = hanging straight down); muscles keep
 *  their volume, so the one that shortens gets fatter. Returns {g, set, pose(angle)}. */
export function arm(p, { sx, sy, up = 196, fore = 176, a = {} }) {
  const g = h('g', a, p);
  const hum = bone(g, 22), rad = bone(g, 11, { knobs: false }), uln = bone(g, 11, { knobs: false });
  const hand = h('path', { fill: 'var(--marble)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round' }, g);
  const tri = h('path', { fill: 'var(--berry-shade)', cls: B }, g), bi = h('path', { fill: 'var(--berry)', cls: B }, g);
  const tends = [0, 1, 2, 3].map(() => h('path', { fill: 'none', stroke: 'var(--marble)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g));
  const E = [sx, sy + up];
  function pose(ang) {
    const d = [Math.cos(ang), Math.sin(ang)], back = [-Math.sin(ang), Math.cos(ang)], front = [-back[0], -back[1]];
    const Wr = [E[0] + d[0] * fore, E[1] + d[1] * fore];
    const biA = [sx + 14, sy + 12], biB = [E[0] + d[0] * 40 + front[0] * 10, E[1] + d[1] * 40 + front[1] * 10];
    const triA = [sx - 14, sy + 16], triB = [E[0] - d[0] * 12 + back[0] * 14, E[1] - d[1] * 12 + back[1] * 14];
    return { d, Wr, biA, biB, triA, triB, front, back };
  }
  const len = (A, Bp) => Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
  const p0 = pose(Math.PI / 2), V = { bi: 15 * len(p0.biA, p0.biB), tri: 14 * len(p0.triA, p0.triB) };
  function lens(el, A, Bp, vol, bias) {
    const l = len(A, Bp), w = Math.max(6, Math.min(30, vol / l)), mx = (A[0] + Bp[0]) / 2, my = (A[1] + Bp[1]) / 2;
    const nx = -(Bp[1] - A[1]) / l, ny = (Bp[0] - A[0]) / l, t = .12; // keep the belly off the tendons
    const A2 = [A[0] + (Bp[0] - A[0]) * t, A[1] + (Bp[1] - A[1]) * t], B2 = [Bp[0] - (Bp[0] - A[0]) * t, Bp[1] - (Bp[1] - A[1]) * t];
    const o = bias * w * .5;
    el.setAttribute('d', `M${A2[0]} ${A2[1]} Q ${mx + nx * (2 * w + o)} ${my + ny * (2 * w + o)} ${B2[0]} ${B2[1]} Q ${mx - nx * (2 * w - o)} ${my - ny * (2 * w - o)} ${A2[0]} ${A2[1]} Z`);
    return { A2, B2, w, mid: [mx, my] };
  }
  const st = {};
  function set(ang) {
    const q = pose(ang);
    hum.set(sx, sy, E[0], E[1]);
    rad.set(E[0] + q.front[0] * 6, E[1] + q.front[1] * 6, q.Wr[0] + q.front[0] * 6, q.Wr[1] + q.front[1] * 6);
    uln.set(E[0] + q.back[0] * 6 - q.d[0] * 10, E[1] + q.back[1] * 6 - q.d[1] * 10, q.Wr[0] + q.back[0] * 5, q.Wr[1] + q.back[1] * 5);
    const hx = q.Wr[0] + q.d[0] * 24, hy = q.Wr[1] + q.d[1] * 24, r = 21;
    hand.setAttribute('d', `M${hx - r} ${hy} A ${r} ${r} 0 1 0 ${hx + r} ${hy} A ${r} ${r} 0 1 0 ${hx - r} ${hy} Z`);
    // the side the belly bulges to: biceps to the front of the arm, triceps to the back
    const sgnB = (-(q.biB[1] - q.biA[1]) * 1 > 0) ? 1 : -1;
    const b = lens(bi, q.biA, q.biB, V.bi, 0), t = lens(tri, q.triA, q.triB, V.tri, 0);
    [[q.biA, b.A2], [b.B2, q.biB], [q.triA, t.A2], [t.B2, q.triB]].forEach(([A, Bp], i) => tends[i].setAttribute('d', `M${A[0]} ${A[1]} L${Bp[0]} ${Bp[1]}`));
    Object.assign(st, { q, bi: b, tri: t, sgnB });
    return st;
  }
  return { g, set, pose, E, S: [sx, sy], st };
}

/* ------------------------------------------------------------------ teeth: one jaw from above */
const TOOTH = { incisor: { w: 30, d: 17 }, canine: { w: 31, d: 27 }, premolar: { w: 35, d: 31 }, molar: { w: 45, d: 41 } };
export const JAW = { adult: ['incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar', 'molar'], milk: ['incisor', 'incisor', 'canine', 'molar', 'molar'] };
/** One jaw seen from above, front teeth at the top. Returns {g, rep{type:[x,y]}, box, count}. */
export function jaw(p, { cx, y0, set = 'adult', a = {} }) {
  const g = h('g', a, p); const seq = JAW[set] || JAW.adult; const sc = set === 'milk' ? 1.35 : 1.18, gap = 7;
  const total = seq.reduce((s, t) => s + TOOTH[t].w * sc + gap, 0);
  const f = total / 400, rx = 230 * f, ry = 330 * f, ecy = y0 + ry;
  // arc-length table along the right half of the ellipse, from the front midline
  const tab = [[0, cx, y0, 0]]; let s = 0, px = cx, py = y0;
  for (let i = 1; i <= 600; i++) { const th = -Math.PI / 2 + i / 600 * (Math.PI / 2 + .25); const x = cx + rx * Math.cos(th), y = ecy + ry * Math.sin(th); s += Math.hypot(x - px, y - py); tab.push([s, x, y, th]); px = x; py = y; }
  const at = v => { const r = tab.find(q => q[0] >= v) || tab[tab.length - 1]; const th = r[3]; const tx = -rx * Math.sin(th), ty = ry * Math.cos(th), l = Math.hypot(tx, ty); return { x: r[1], y: r[2], ang: Math.atan2(ty, tx), nx: ty / l, ny: -tx / l }; };
  // gum under the teeth
  const end = total + 10; const gp = tab.filter(q => q[0] <= end);
  const gd = [...gp].reverse().map(q => [2 * cx - q[1], q[2]]).concat(gp.map(q => [q[1], q[2]]));
  h('path', { d: 'M' + gd.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L '), fill: 'none', stroke: 'var(--ear)', 'stroke-width': 74 * sc / 1.18, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  const rep = {}, types = {}; let v = gap / 2; let minY = y0, maxY = y0;
  for (const t of seq) {
    const w = TOOTH[t].w * sc, d = TOOTH[t].d * sc; const q = at(v + w / 2); v += w + gap;
    for (const sg of [1, -1]) {
      const x = sg > 0 ? q.x : 2 * cx - q.x, ang = sg > 0 ? q.ang : Math.PI - q.ang;
      const tg = h('g', { transform: `translate(${x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${(ang * 180 / Math.PI).toFixed(1)})` }, g);
      const st = { fill: 'var(--cloud)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round', cls: B };
      if (t === 'incisor') h('rect', Object.assign({ x: -w / 2, y: -d / 2, width: w, height: d, rx: 6 }, st), tg);
      else if (t === 'canine') h('path', Object.assign({ d: `M${-w / 2} 2 Q ${-w / 2} ${-d / 2} 0 ${-d / 2 - 4} Q ${w / 2} ${-d / 2} ${w / 2} 2 Q ${w / 3} ${d / 2} 0 ${d / 2} Q ${-w / 3} ${d / 2} ${-w / 2} 2 Z` }, st), tg);
      else if (t === 'premolar') { h('ellipse', Object.assign({ cx: 0, cy: 0, rx: w / 2, ry: d / 2 }, st), tg); h('path', { d: `M${-w * .28} 0 L ${w * .28} 0`, stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, tg); }
      else { h('rect', Object.assign({ x: -w / 2, y: -d / 2, width: w, height: d, rx: 12 }, st), tg); h('path', { d: `M${-w * .3} 0 L ${w * .3} 0 M 0 ${-d * .3} L 0 ${d * .3}`, stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, tg); }
      (types[t] = types[t] || []).push({ x, y: q.y });
      minY = Math.min(minY, q.y - d); maxY = Math.max(maxY, q.y + d);
    }
    // the label points at the outer (cheek) side of the first tooth of each kind on the right
    { const r = d / 2 + 6; rep[t] = [q.x + q.nx * r, q.y + q.ny * r]; }
  }
  const half = gd.length ? Math.max(...gd.map(q => q[0])) - cx : rx;
  return { g, rep, types, count: seq.length * 2, box: { x: cx - half - 40, y: y0 - 40, w: 2 * half + 80, h: maxY - y0 + 80 }, bottom: Math.max(maxY, ...gd.map(q => q[1])) + 37 };
}

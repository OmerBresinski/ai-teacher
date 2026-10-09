// rivers_coasts, course view on a real river (libdata track 2). When the river's name is a real river in
// the geo database (kit/geo.js), the course view draws its real main stem, north up, with its real
// tributaries, source, mouth and the coast around it, in the same flat diagram style as the schematic.
// Builds keep the schematic's keys (source, downhill, tributaries, meander, mouth), so captions and notes
// are unchanged. Only tributaries the teacher names are drawn, and only when they really join this river.
import { h, measure, clamp, lerp, eIO, GRID, textBlock, labelGround, txt, computed } from '../../kit/index.js';
import { riverByName } from '../../kit/geo.js';

export const REAL_PARAM = {
  type: 'boolean', title: 'Draw the real river when it has a real name',
  description: 'Uses the real course from the map database, north at the top. Off draws the schematic.', default: true,
};
/** The real river this slide shows, or null (schematic). */
export function realRiver(P) {
  const R = namedRiver(P);
  return R && R.status === 'ok' ? R : null; // flagged data is never drawn as a real map
}
/** The baked river the name refers to, whatever its review status. */
function namedRiver(P) {
  if (!P || P.view !== 'course' || P.real === false) return null;
  return riverByName(P.river && P.river.name);
}
const norm = s => String(s || '').toLowerCase().replace(/\b(the|river|afon)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
/** Each named tributary matched to a real one (or null when this river has no tributary of that name). */
export function matchTribs(P, R) {
  return (P.tributaries || []).map(t => (R.tribs || []).find(x => norm(x.name) === norm(t.name)) || null);
}
/** Warnings validate() adds for a real river: tributaries that do not join it, and a status to check. */
export function realWarnings(P) {
  const N = namedRiver(P);
  if (N && N.status !== 'ok') return [`The ${N.name} is drawn as a schematic, not a real map: its map data is flagged for review (${N.reviewNote || 'a check failed'}).`];
  const R = realRiver(P); if (!R) return [];
  const W = [];
  matchTribs(P, R).forEach((m, i) => { if (!m) W.push(`${P.tributaries[i].name} is not one of the ${R.name}’s main tributaries in the map database, so it is not drawn. Real tributaries include ${(R.tribs || []).slice(0, 3).map(x => x.name).join(', ') || 'none recorded'}.`); });
  if (R.mouthType && R.mouthType !== 'sea' && P.river && /sea|ocean|channel/i.test(P.river.sea || '')) W.push(`The ${R.name} flows into another river or a lake, not the sea.`);
  return W;
}

const pathD = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
const len = pts => pts.reduce((s, p, i) => s + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A line as chunks of growing width, drawn on in order (a ribbon that widens towards the mouth). */
function ribbon(g, pts, w0, w1, n = 14) {
  const L = len(pts), per = L / n, chunks = []; let acc = 0, cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); acc += d; cur.push(pts[i]);
    if (acc >= per * (chunks.length + 1) || i === pts.length - 1) { chunks.push(cur); cur = [pts[i]]; }
  }
  const els = chunks.map((c, j) => h('path', { d: pathD(c), pathLength: 1, fill: 'none', stroke: 'var(--water)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'stroke-width': lerp(w0, w1, chunks.length > 1 ? j / (chunks.length - 1) : 1).toFixed(1) }, g));
  return u => els.forEach((e, j) => { const k = clamp(u * els.length - j, 0, 1); e.setAttribute('stroke-dasharray', '1 1'); e.setAttribute('stroke-dashoffset', String(1 - k)); });
}

/** The stretch of the main line that bends most (path length over straight distance), for "meander". */
function bendiest(pts, box) {
  let best = null; const n = pts.length, win = Math.max(6, Math.round(n / 8));
  for (let i = Math.round(n * .35); i + win < n - 2; i++) {
    const seg = pts.slice(i, i + win), chord = Math.hypot(seg[win - 1][0] - seg[0][0], seg[win - 1][1] - seg[0][1]) || 1, s = len(seg) / chord;
    if (!best || s > best.s) best = { s, seg };
  }
  if (!best) return null;
  const xs = best.seg.map(p => p[0]), ys = best.seg.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { cx: clamp(cx, box.x + 60, box.x + box.w - 60), cy: clamp(cy, box.y + 50, box.y + box.h - 50), r: clamp(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 18, 34, 90), s: best.s };
}

export function renderRealCourse(root, P, ctx) {
  const R = realRiver(P); const b = ctx.b, bi = k => b[k] ?? 0, r = P.river;
  const BOX = { x: 64, y: 124, w: 1152, h: 448 }; const W0 = 'var(--water-text)';
  h('style', {}, root).textContent = '.slide .rc-gone{opacity:0;transition:opacity var(--t-recede) var(--ease-out)}';
  const id = 'rcreal' + Math.random().toString(36).slice(2, 7);
  const cp = h('clipPath', { id }, h('defs', {}, root)); h('rect', { x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h, rx: 'var(--r-mark)' }, cp);
  const map = h('g', { 'clip-path': `url(#${id})` }, root);
  h('rect', { x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h, fill: 'var(--sea-1)' }, map);
  h('path', { d: R.land, fill: 'var(--hill-far)', stroke: 'var(--hill-mid)', 'stroke-width': 'var(--sw-hair)' }, map); // outer rings only: nonzero keeps clipped, overlapping rings filled
  for (const l of R.lakes || []) h('path', { d: l.d, fill: 'var(--sea-1)' }, map);
  h('rect', { x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', rx: 'var(--r-mark)' }, root);

  const obstacles = [];
  const main = R.main.reduce((a, p) => (p.length > a.length ? p : a), []);
  for (const p of main) obstacles.push({ x: p[0] - 10, y: p[1] - 10, w: 20, h: 20 });
  // places: faint context, under everything the lesson names
  const placeG = h('g', { s: 0 }, root);
  for (const pl of R.places || []) {
    const tw = measure(root, pl.name, 'ts-tiny'); const bx = { x: pl.x + 9, y: pl.y - 12, w: tw, h: 22 };
    // a town is shown only with its name: an unnamed dot is noise
    if (bx.x + bx.w < BOX.x + BOX.w - 4 && !obstacles.some(o => hit(o, bx))) { h('circle', { cx: pl.x, cy: pl.y, r: 5, fill: 'var(--ink-2)' }, placeG); h('text', { x: pl.x + 9, y: pl.y + 6, cls: 'ts-tiny', fill: 'var(--ink-2)', text: pl.name }, placeG); obstacles.push(bx); }
  }

  /* the river and its named, real tributaries */
  const k0 = bi('downhill');
  const tribs = matchTribs(P, R).map((m, i) => m && { m, i }).filter(Boolean);
  const tribG = h('g', { s: bi('tributaries') }, root);
  const setTribs = tribs.map(({ m }) => ribbon(tribG, m.pts, 2, 5, 6));
  const riverG = h('g', { s: k0 }, root);
  const setMain = R.main.map(pts => ribbon(riverG, pts, 2.5, 9));

  /* labels */
  const place = (g, x, y, parts, cands, maxW = 300) => {
    const holder = h('g', {}, g); const gr = labelGround(holder, { x: 0, y: 0, w: 0, h: 0 });
    let yy = 0, wmax = 0; const els = [];
    for (const pt of parts) { const tb = textBlock(holder, 0, yy, pt.text, { cls: pt.cls || 'ts-small', maxW, maxLines: 2, lh: pt.cls === 'ts-label' ? 32 : 26, a: { fill: pt.fill || 'var(--ink)' }, edit: pt.edit }); els.push(tb); yy += tb.h + 2; wmax = Math.max(wmax, tb.w); }
    const bw = wmax + 16, bh = yy + 6;
    for (const [dx, dy] of cands) {
      const bx = { x: x + dx(bw), y: y + dy(bh), w: bw, h: bh };
      if (bx.x < BOX.x + 4 || bx.x + bx.w > BOX.x + BOX.w - 4 || bx.y < BOX.y + 4 || bx.y + bx.h > BOX.y + BOX.h - 4) continue;
      if (obstacles.some(o => hit(o, bx))) continue;
      holder.setAttribute('transform', `translate(${bx.x + 8} ${bx.y + 24})`);
      for (const [k, v] of Object.entries({ x: -8, y: -24, width: bw, height: bh })) gr.setAttribute(k, v);
      obstacles.push(bx);
      const qx = clamp(x, bx.x, bx.x + bx.w), qy = clamp(y, bx.y, bx.y + bx.h); // a leader when the label sits away from its point
      if (Math.hypot(qx - x, qy - y) > 24) g.insertBefore(h('line', { x1: x, y1: y, x2: qx, y2: qy, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)' }), g.firstChild);
      return bx;
    }
    holder.remove(); if (ctx.warn) ctx.warn(`no room for “${parts[0].text}”`); return null;
  };
  const around = [[w => 14, h => -h - 10], [w => 14, h => 10], [w => -w - 14, h => -h - 10], [w => -w - 14, h => 10], [w => -w / 2, h => -h - 18], [w => -w / 2, h => 18],
    [w => 30, h => -h / 2], [w => -w - 30, h => -h / 2], [w => 40, h => -h - 50], [w => -w - 40, h => 40], [w => 60, h => 60], [w => -w - 60, h => -h - 60]];

  const S = R.source || { x: main[0][0], y: main[0][1] };
  const srcG = h('g', { s: 0, c: ctx.rc('source', null, 'rc-gone') }, root);
  h('circle', { cx: S.x, cy: S.y, r: 9, fill: 'var(--water)', stroke: 'var(--paper)', 'stroke-width': 3 }, srcG);
  place(srcG, S.x, S.y, [{ text: txt(P, 'label:source', 'Source'), cls: 'ts-label', fill: W0, edit: 'text.label:source' }, { text: r.source, edit: 'river.source' }], around);

  tribs.forEach(({ m, i }) => {
    const g = h('g', { s: bi('tributaries'), c: ctx.rc('tributaries', null, 'rc-gone') }, root); const st = m.pts[0];
    place(g, st[0], st[1], [{ text: P.tributaries[i].name, fill: W0, edit: `tributaries.${i}.name` }], around, 240);
  });

  if (P.showMeander) {
    const M = bendiest(main, BOX);
    if (M) {
      const g = h('g', { s: bi('meander'), c: ctx.rc('meander', null, 'rc-gone') }, root);
      h('circle', { cx: M.cx, cy: M.cy, r: M.r, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-lead)', 'stroke-dasharray': '7 7' }, g);
      place(g, M.cx, M.cy, [{ text: txt(P, 'label:meander', 'Meanders'), fill: 'var(--focus-text)', edit: 'text.label:meander' }], around.map(([fx, fy]) => [w => fx(w) + Math.sign(fx(w) + 1) * M.r, fy]));
    }
  }

  const Mo = R.mouth || { x: main[main.length - 1][0], y: main[main.length - 1][1] };
  const mg = h('g', { s: bi('mouth') }, root);
  h('circle', { cx: Mo.x, cy: Mo.y, r: 9, fill: 'none', stroke: 'var(--water-text)', 'stroke-width': 'var(--sw-lead)' }, mg);
  const mk = r.mouth === 'estuary' ? 'estuary' : r.mouth === 'delta' ? 'delta' : 'mouth';
  place(mg, Mo.x, Mo.y, [{ text: txt(P, `label:${mk}`, mk[0].toUpperCase() + mk.slice(1)), cls: 'ts-label', fill: W0, edit: `text.label:${mk}` }, { text: r.sea, edit: 'river.sea' }], around);

  /* north arrow and the side view: from the source height down to sea level */
  const na = h('g', {}, root); const NX = BOX.x + BOX.w - 34, NY = BOX.y + 22;
  h('path', { d: `M${NX} ${NY} l10 26 l-10 -6 l-10 6 Z`, fill: 'var(--ink-2)' }, na);
  h('text', { x: NX, y: NY + 46, 'text-anchor': 'middle', cls: 'ts-tiny strong', fill: 'var(--ink-2)', text: 'N' }, na);
  const PY0 = 594, PY1 = 636, X0 = 180, X1 = 1060, prof = u => [lerp(X0, X1, u), PY1 - (PY1 - PY0) * Math.pow(1 - u, 2.2)];
  const pp = Array.from({ length: 31 }, (_, i) => prof(i / 30));
  h('path', { d: pathD(pp) + ` L${X1} ${PY1 + 6} L${X0} ${PY1 + 6} Z`, fill: 'var(--hill-mid)' }, root);
  h('rect', { x: X1, y: PY1, width: 1216 - X1, height: 6, fill: 'var(--sea-1)' }, root);
  const dg = h('g', { s: k0 }, root);
  computed(h('text', { x: X0 - 14, y: PY0 + 16, 'text-anchor': 'end', cls: 'ts-small strong', fill: 'var(--ink)', text: `${r.sourceHeight} m` }, dg), 'river.sourceHeight');
  textBlock(dg, 1216, PY1 - 14, txt(P, 'label:sealevel', 'Sea level: 0 m'), { cls: 'ts-small', maxW: 300, maxLines: 1, lh: 26, anchor: 'end', edit: 'text.label:sealevel', a: { fill: W0 } });
  textBlock(root, 620, 601, txt(P, 'label:nts', 'Side view not to scale'), { cls: 'ts-small', maxW: 320, maxLines: 1, anchor: 'middle', edit: 'text.label:nts', a: { fill: 'var(--ink-2)' } });

  const setRiver = u => setMain.forEach(f => f(u));
  const setT = u => setTribs.forEach(f => f(u));
  return {
    dur: { downhill: 1600, tributaries: 1300 },
    still() { setRiver(1); setT(1); },
    reset() { setRiver(0); setT(0); },
    tick(k, u) { setRiver(k === bi('downhill') ? eIO(u) : 1); if (tribs.length) setT(k === bi('tributaries') ? eIO(u) : 1); },
  };
}

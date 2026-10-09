// The whole sort_venn_carroll layout as numbers, with no DOM: the tray, the diagram and where every
// card goes. render() runs it with the real text measure; validate() runs it with the estimate
// from textw.js (never narrower than the slide), so a setting validate() accepts always fits.
// The fit, in order: the biggest card size that fits every region; then cards wrap to two lines;
// then the two hoops overlap more; then the tray cards drop a size; then the tray moves to a
// column on the left so the diagram has the full height. A region that
// still cannot hold its cards is reported, never drawn on top of another card.
import { GRID, overlaps } from '../../kit/index.js';
import { SIZE, tbFit, cardShape } from './fit.js';
import { vennGeom } from './venn.js';
const MIN_HOOP = 90; // the smallest hoop radius that still reads as a hoop from the back and holds a card

const { HUGE, BIG, SMALL, TINY } = SIZE;
export const PGAP = 14;
const CPAD = 22;
const LAD_SIDE = [[BIG, 0], [SMALL, 0], [BIG, 1], [SMALL, 1], [TINY, 0], [TINY, 1], [TINY, 2]];
const LAD = [[HUGE, 0], ...LAD_SIDE];

function trayPlan(M, trayLabel, side, TS, w) {
  const shapes = M.items.map(it => cardShape(it.label, TS, 0, w, it.pic, true)), TW = shapes.map(c => c.w), ROW = Math.max(...shapes.map(c => c.h)) + 14, n = M.items.length;
  if (side) {
    // three hoops need the height: the tray is columns down the left, under its label
    // the label lane widens until a long tray label fits in four lines, never cut
    let laneMin = 180;
    while (laneMin < 340 && tbFit(trayLabel, TS.cls, laneMin, 4, 30, w).cut) laneMin += 40;
    let lane = laneMin, lane0 = laneMin, f, perCol, nc, colW = Math.max(...TW) + PGAP;
    for (let pass = 0; pass < 2; pass++) {
      lane0 = lane; f = tbFit(trayLabel, TS.cls, lane, 4, 30, w);
      const top = GRID.top + 44 + (f.L.length - 1) * f.lh;
      perCol = Math.max(1, Math.floor((GRID.bottom - top) / ROW)); nc = Math.ceil(n / perCol);
      lane = Math.max(laneMin, nc * colW - PGAP);
    }
    const top = GRID.top + 44 + (f.L.length - 1) * f.lh;
    const layout = ids => { const at = {}; ids.forEach((i, k) => { at[i] = [GRID.left + colW * Math.floor(k / perCol) + TW[i] / 2, top + ROW * (k % perCol + .5)]; }); return at; };
    return { TS, TW, shapes, fit: f, maxW: lane0, maxLines: 4, lx: GRID.left, ly: GRID.top + 24, right: GRID.left + Math.max(nc * colW, f.w) + 20, bottom: GRID.bottom, layout };
  }
  // a long tray label wraps (and shrinks) in a lane beside the cards, so the tray keeps its height
  // two lines in a 400-wide lane; a longer label takes a third line, then a wider lane, never a cut
  let maxW, f, maxLines;
  for ([maxW, maxLines] of [[400, 2], [400, 3], [520, 3], [640, 3]]) { maxW = Math.min(w(trayLabel, TS.cls), maxW) + 1; f = tbFit(trayLabel, TS.cls, maxW, maxLines, 30, w); if (!f.cut) break; }
  const tlW = f.w + 28, avail = GRID.right - GRID.left - tlW;
  const flow = ids => { const rows = [[]]; let x = 0; ids.forEach(i => { if (x + TW[i] > avail && rows[rows.length - 1].length) { rows.push([]); x = 0; } rows[rows.length - 1].push(i); x += TW[i] + PGAP; }); return rows; };
  const nRows = flow(M.items.map(it => it.i)).length, trayH = Math.max(nRows * ROW, f.h + 10), top = GRID.bottom - trayH;
  const y0 = top + (trayH - nRows * ROW) / 2;
  const layout = ids => { const at = {}; flow(ids).forEach((row, r) => { let xx = GRID.left + tlW; row.forEach(i => { at[i] = [xx + TW[i] / 2, y0 + ROW * (r + .5)]; xx += TW[i] + PGAP; }); }); return at; };
  return { TS, TW, shapes, fit: f, maxW, maxLines, lx: GRID.left, ly: top + trayH / 2 - (f.L.length - 1) * f.lh / 2 + 10, right: GRID.left, bottom: top - 16, layout };
}

/** rows null: a one-rule Carroll diagram, two boxes side by side under the rule and its opposite. */
export function carrollGeom(box, rows, cols, w) {
  const hw = rows ? Math.min(260, box.w * .26) : 0, cw = (box.w - hw) / 2;
  const colF = cols.map(c => tbFit(c, 'ts-label', cw - 24, 3, 30, w)); // libfix: wrap a third line (the header grows) before any cut
  const hh = 64 + Math.max(...colF.map(f => (f.L.length - 1) * f.lh)), ch = rows ? (box.h - hh) / 2 : box.h - hh;
  const rowF = (rows || []).map(r => tbFit(r, 'ts-label', hw - 30, 5, 30, w)); // libfix: a row header has the row's height to wrap into
  return { hw, hh, cw, ch, colF, rowF, cell: (ri, ci) => ({ x: box.x + hw + cw * ci, y: box.y + hh + ch * ri, w: cw, h: ch }) };
}

export function attempt(M, box, geo, S, wrap, w, inl) {
  // inl: 0 picture above the word, 1 picture beside it, 2 words only (the last resort before a refusal)
  const cards = M.items.map(it => cardShape(it.label, S, wrap, w, inl === 2 ? null : it.pic, inl === 1));
  const byKey = {}; M.items.filter(it => !it.unk).forEach(it => (byKey[it.key] = byKey[it.key] || []).push(it));
  const to = [], fails = [];
  if (M.kind === 'carroll') {
    for (const key in byKey) {
      const its = byKey[key], mem = its[0].mem, cell = mem.length === 1 ? geo.cell(0, mem[0] ? 0 : 1) : geo.cell(mem[0] ? 0 : 1, mem[1] ? 0 : 1);
      // cards keep CPAD clear of the box rules (and of the highlight drawn inside the fits-both box)
      const IW = cell.w - 2 * CPAD, IH = cell.h - 2 * CPAD;
      const lines = [[]]; let lw = 0, wide = 0;
      its.forEach(it => { const cw = cards[it.i].w; if (cw > IW) wide++; if (lw + cw > IW && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push(it); lw += cw + PGAP; });
      const rh = lines.map(ln => Math.max(...ln.map(it => cards[it.i].h)));
      const total = rh.reduce((t, x) => t + x + 12, 0) - 12;
      if (wide || total > IH) {
        let fit = 0, used = -12; lines.forEach((ln, r) => { used += rh[r] + 12; if (used <= IH) fit += ln.filter(it => cards[it.i].w <= IW).length; });
        fails.push({ key, mem, names: its.map(it => it.label), n: its.length, fit }); continue;
      }
      let y = cell.y + cell.h / 2 - total / 2;
      lines.forEach((ln, r) => {
        const tw = ln.reduce((t, it) => t + cards[it.i].w, 0) + PGAP * (ln.length - 1); let xx = cell.x + (cell.w - tw) / 2;
        ln.forEach(it => { to[it.i] = [xx + cards[it.i].w / 2, y + rh[r] / 2]; xx += cards[it.i].w + PGAP; });
        y += rh[r] + 12;
      });
    }
  } else {
    const placed = []; let side = 0;
    // the tightest regions first (the middle, then the overlaps), so they get their best spots
    for (const key of Object.keys(byKey).sort((p, q) => q.split('1').length - p.split('1').length)) {
      const its = byKey[key], mem = its[0].mem, side0 = side;
      // in reading order; if the region cannot hold them so, biggest card first (it needs the deepest spot)
      const tryOrder = order => {
        const got = []; let sd = side0;
        for (const it of order) {
          const c = cards[it.i], at = geo.place(mem, c, c.pr, placed.concat(got.map(g => g.box)), mem.every(m => !m) ? (sd++ % 2) : 0);
          if (at) got.push({ i: it.i, at, box: { x: at[0] - c.w / 2, y: at[1] - c.h / 2, w: c.w, h: c.h } });
        }
        side = sd; return got;
      };
      let got = tryOrder(its);
      if (got.length < its.length) { const g2 = tryOrder(its.slice().sort((p, q) => cards[q.i].w * cards[q.i].h - cards[p.i].w * cards[p.i].h)); if (g2.length > got.length) got = g2; }
      // a small region with several cards: a short search over the spots each card fits (edges
      // first), so the first card is not left in the middle where it blocks the rest
      if (got.length < its.length && its.length > 1 && its.length <= 5 && mem.some(Boolean)) {
        const opts = its.map(it => { const c = cards[it.i]; return geo.spots(mem, c, c.pr, placed, 60).map(at => ({ i: it.i, at, box: { x: at[0] - c.w / 2, y: at[1] - c.h / 2, w: c.w, h: c.h } })); });
        let budget = 4000; const pick = [];
        const dfs = k => {
          if (k === its.length) return true;
          for (const o of opts[k]) {
            if (--budget < 0) return false;
            if (pick.some(q => overlaps(q.box, o.box, 10))) continue;
            pick.push(o); if (dfs(k + 1)) return true; pick.pop();
          }
          return false;
        };
        if (dfs(0)) got = pick.slice();
      }
      got.forEach(g => { to[g.i] = g.at; placed.push(g.box); });
      if (got.length < its.length) fails.push({ key, mem, names: its.map(it => it.label), n: its.length, fit: got.length });
    }
  }
  return { ok: !fails.length, fails, S, wrap, cards, to };
}

export function solve(M, trayLabel, wRaw) {
  const memo = new Map(), w = (s, c) => { const k = c + '\u0000' + s; let v = memo.get(k); if (v == null) { v = wRaw(s, c); memo.set(k, v); } return v; };
  const side = M.kind === 'venn' && M.n === 3;
  // tray cards are big enough to read from the back; long word lists drop a size rather than take a second row
  const rowsAt = S => { const t = trayPlan(M, trayLabel, false, S, w); return Object.values(t.layout(M.items.map(it => it.i))).reduce((s, [, y]) => s.add(y), new Set()).size; };
  const TS0 = !side && rowsAt(BIG) > rowsAt(SMALL) ? SMALL : BIG;
  // [overlap, sideways stretch]: three hoops stay circles while they can; when a region still cannot
  // hold its cards they widen into ellipses, as the slide has width to spare beside them
  const dFs = M.kind === 'venn' && M.n === 2 ? [[.55, 1], [.45, 1], [.35, 1], [.45, 1.25], [.35, 1.25], [.45, 1.5], [.35, 1.5]] : M.kind === 'venn' && M.n === 3
    ? [[.62, 1], [.5, 1], [.74, 1], [.42, 1], [.5, 1.15], [.62, 1.15], [.5, 1.3], [.62, 1.3], [.5, 1.45], [.62, 1.45], [.62, 1.6]] : [[.55, 1]];
  // apart hoops fill the width, so things that fit no rule get room kept beside them if needed
  // apart hoops keep a lane each side for things that fit no rule, so they stand in a tidy column
  // there rather than squeezed between hoops; full-width hoops only when the lanes cannot hold them
  const outWs = M.kind === 'hoops' && M.items.some(M.none) ? [0, 240, 340] : [0];
  // picture cards: picture above the word while it fits, then the picture beside the word
  const lad0 = side ? LAD_SIDE : LAD, ladder = !M.items.some(it => it.pic) ? lad0.map(x => [...x, 0])
    : [...lad0.filter(([S]) => S !== TINY).map(x => [...x, 0]), ...lad0.map(x => [...x, 1]), ...lad0.filter(([S]) => S === TINY).map(x => [...x, 0]), ...lad0.map(x => [...x, 2])];
  let last;
  // last resorts: the tray moves to a column on the left, so the diagram gets the full height
  const trays = side ? [[1, BIG], [1, TINY]] : [[0, TS0], [0, TINY], [1, BIG], [1, TINY]];
  // the biggest card size wins: the hoops widen (and stretch), then the tray moves, before the cards step down
  const plans = trays.map(([left, TS]) => { const tray = trayPlan(M, trayLabel, !!left, TS, w); return { tray, box: { x: tray.right, y: GRID.top - 4, w: GRID.right - tray.right, h: tray.bottom - (GRID.top - 4) }, geoMemo: new Map() }; });
  for (const [S, wrap, inl] of ladder) {
    if (wrap && !M.items.some(it => (it.label.trim().match(/\s+/g) || []).length >= wrap)) continue;
    for (const { tray, box, geoMemo } of plans) {
      for (const [dF, sx] of dFs) {
      const gk = dF + ',' + sx;
      if (!geoMemo.has(gk)) geoMemo.set(gk, (side ? [[0, true], [0, false]] : outWs.map(o => [o, false])).map(([outW, bigHead]) => [outW, M.kind === 'carroll'
        ? (M.n === 1 ? carrollGeom(box, null, [M.rules[0].label, M.rules[0].not], w)
          : carrollGeom(box, [M.rules[0].label, M.rules[0].not], [M.rules[1].label, M.rules[1].not], w))
        : vennGeom(box, M.rules.map(r => r.label), { apart: M.kind === 'hoops', dF, outW, sx, wFn: w, bigHead })]));
        for (const [outW, geo] of geoMemo.get(gk)) {
          const r = attempt(M, box, geo, S, wrap, w, inl);
          r.miss = r.fails.reduce((t, f) => t + f.n - f.fit, 0);
          // a rule name that would be cut short is a miss too: another layout gives it more room
          if (geo.specs && geo.specs.some(sp => sp.fit.cut)) { r.ok = false; r.cut = true; r.miss += .5; }
          // two rule names on top of each other, or a hoop too small to read as a hoop (or to hold a card),
          // is a miss too: the class would see a tangle, so another layout (or a refusal) wins
          if (geo.labelBoxes && geo.labelBoxes.some((a, i) => geo.labelBoxes.some((b, j) => j > i && overlaps(a, b, 8)))) { r.ok = false; r.clash = true; r.miss += .5; }
          if (geo.circles && Math.min(...geo.circles.map(c => c.r)) < MIN_HOOP) { r.ok = false; r.tiny = true; r.miss += .5; }
          Object.assign(r, { tray, box, geo, dF, sx, outW });
          if (r.ok) return r;
          if (!last || r.miss < last.miss) last = r; // report the closest miss
        }
      }
    }
  }
  return last;
}

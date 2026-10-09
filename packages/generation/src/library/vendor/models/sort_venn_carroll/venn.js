// Venn diagram and sorting hoops for sort_venn_carroll, sized for word cards as well as numbers:
// bigger hoops with a wider overlap than the kit's venn(), labels outside the hoops, and a
// placer that fits each card (by its own width and height) wholly inside its region, in tidy
// rows, with "outside" cards kept beside the hoops rather than in the corners.
// Pure geometry: no DOM. Text widths come from wFn, so validate() and render() share the layout.
import { overlaps } from '../../kit/index.js';
import { tbFit } from './fit.js';

export const COLS = [['var(--focus)', 'var(--focus-text)'], ['var(--compare)', 'var(--compare-text)'], ['var(--energy)', 'var(--energy-text)']];
const LABEL_H = 62, SIDE3 = 90, RING_GAP = 18, LABEL_CLEAR = 24, OUT_GAP = 16, EDGE = 8, LENS_EDGE = 10, OUT_EDGE = 18; // cards in an overlap, and cards outside every hoop, keep well clear of the rings

/** dF: centre offset of two overlapping hoops as a share of the radius (smaller = wider overlap). */
/** sx (three hoops only, last resort): the hoops stretch sideways into ellipses, an affine stretch
 *  of the circle picture, so every region keeps its shape and gains width where the slide has it. */
export function vennGeom(box, labels, { apart = false, dF = .55, outW = 0, sx = 1, wFn, bigHead = false }) {
  const n = labels.length, cx = box.x + box.w / 2, X = x => cx + (x - cx) / sx; // slide x -> circle picture
  const circlesAt = (lh, shrink = 1) => {
    const top = box.y + lh, H = box.h - lh - 6;
    if (apart || n === 1) {
      // outW: room kept beside the hoops (half each side) for the things that fit no rule
      const bw = box.w - outW, r = Math.min(H / 2, (bw / n - 56) / 2);
      return labels.map((_, i) => ({ x: n === 1 ? cx : box.x + outW / 2 + bw * (i + .5) / n, y: top + H / 2, r }));
    }
    if (n === 2) {
      // stretched (sx > 1) two hoops may take more of the width: that is what they stretch into
      const r = Math.min(H / 2, box.w * (sx > 1 ? .8 : .64) / ((2 + 2 * dF) * sx)), d = dF * r;
      return [{ x: cx - d, y: top + H / 2, r }, { x: cx + d, y: top + H / 2, r }];
    }
    // three hoops: dF (.62 up) spreads them, so the two-rule overlaps grow and the middle shrinks.
    // Their rule names sit in the corners beside the hoops (sideSpecs), so the hoops take the full
    // height; shrink (1 = full size) steps down only when a long rule name needs more room beside them.
    const f = Math.max(.4, dF), k3 = 2 + f * Math.sqrt(3), top3 = box.y + 10, H3 = box.h - 16;
    const r = Math.min(H3 / k3, (box.w - 2 * SIDE3) / ((2 + 2 * f) * sx)) * shrink, d = f * r, y0 = top3 + r + (H3 - k3 * r) / 2;
    return [{ x: cx - d, y: y0, r }, { x: cx + d, y: y0, r }, { x: cx, y: y0 + d * Math.sqrt(3), r }];
  };
  // a label that wraps to two lines keeps more air above its hoop
  const specsAt = (C, gap = 18) => C.map((c0, i) => {
    const c = { x: cx + (c0.x - cx) * sx, y: c0.y, r: c0.r, rx: c0.r * sx }; // the drawn hoop: labels sit by what the class sees
    let x, y, anchor, maxW;
    if (apart || n === 1) { x = c.x; y = c.y - c.r - gap; anchor = 'middle'; maxW = apart ? (box.w - outW) / n - 32 : box.w - 64; }
    else if (i === 2) { x = c.x - c.rx * .87 - 14; y = c.y + c.r * .5 + 10; anchor = 'end'; maxW = x - box.x - 20; }
    else { x = i === 0 ? c.x + c.rx * .3 : c.x - c.rx * .3; y = c.y - c.r - gap; anchor = i === 0 ? 'end' : 'start'; maxW = i === 0 ? x - box.x - 20 : box.x + box.w - 20 - x; }
    // two lines, then three or four before a long rule name would be cut
    let f, maxLines = 2;
    for (; maxLines <= 4; maxLines++) { f = tbFit(labels[i], 'ts-num', Math.max(110, maxW), maxLines, 44, wFn) /* libfix: room for a whole word */; if (!f.cut) break; }
    maxLines = Math.min(maxLines, 4);
    // labels above a hoop grow upwards, so their last line keeps its place
    if (!(n === 3 && i === 2 && !apart)) y -= (f.L.length - 1) * f.lh;
    const bx = anchor === 'middle' ? x - f.w / 2 : anchor === 'end' ? x - f.w : x;
    return { x, y, anchor, maxW: Math.max(110, maxW) /* libfix: draw at the width it was fitted at */, maxLines, fit: f, box: { x: bx, y: y - 36, w: f.w, h: 48 + (f.L.length - 1) * f.lh } };
  });
  // three hoops: each rule name goes in the free corner beside its own hoop (top-left, top-right,
  // bottom-left), placed by its measured box so it clears every ring by RING_GAP; it wraps to up
  // to four lines, and if it still cannot fit uncut the hoops step down in size, never the words
  const rectDist = (q0, c) => { const q = { x: X(q0.x), y: q0.y, w: q0.w / sx, h: q0.h }; return Math.hypot(Math.max(q.x - c.x, 0, c.x - q.x - q.w), Math.max(q.y - c.y, 0, c.y - q.y - q.h)); };
  // all three names share one size: the biggest at which every one fits uncut
  const LH = { 'ts-num': 44, 'ts-label': 34, 'ts-tiny': 26 }, ASC = { 'ts-num': 36, 'ts-label': 28, 'ts-tiny': 20 };
  const sideSpecs = C => {
    for (const cls of ['ts-num', 'ts-label', 'ts-tiny']) { const sp = sideAt(C, cls); if (sp) return sp; }
    return null;
  };
  const sideAt = (C, cls) => {
    const out = [];
    for (const [i, side, ideal] of [[0, -1, C[0].y - C[0].r * 1.05], [1, 1, C[1].y - C[1].r * 1.05], [2, -1, C[2].y + C[2].r * .25]]) {
      const c = C[i], cxs = cx + (c.x - cx) * sx; let best = null;
      for (let maxLines = 2; maxLines <= 4 && !best; maxLines++) {
        for (let top = box.y; top <= box.y + box.h - 48; top += 6) {
          for (let x = cxs; side < 0 ? x > box.x + 40 : x < box.x + box.w - 40; x += side * 6) {
            const maxW = side < 0 ? x - box.x - 12 : box.x + box.w - 12 - x;
            const f = tbFit(labels[i], cls, maxW, maxLines, LH[cls], wFn);
            if (f.cut || f.cls !== cls) break; // further out is only narrower
            const bh = ASC[cls] + 12 + (f.L.length - 1) * f.lh, bb = { x: side < 0 ? x - f.w : x, y: top, w: f.w, h: bh };
            if (top + bh > box.y + box.h || bb.x < box.x + 4 || bb.x + bb.w > box.x + box.w - 4) break;
            // the top names stay level with the top of their hoop, the third name below the top hoops' middle
            if (i < 2 ? top + bh > c.y : top < C[0].y + C[0].r * .3) continue;
            if (C.some(cc => rectDist(bb, cc) < cc.r + RING_GAP) || out.some(o => overlaps(o.box, bb, 20))) continue;
            const cost = Math.abs(top + (i === 2 ? 0 : bh) - ideal) + Math.abs(x - cxs) * .5;
            if (!best || cost < best.cost) best = { cost, x, y: top + ASC[cls], anchor: side < 0 ? 'end' : 'start', maxW, maxLines, fit: f, box: bb };
            break; // the first clear spot on a row is the one hugging the hoop
          }
        }
      }
      if (!best) return null;
      out.push(best);
    }
    return out;
  };
  let C, specs;
  if (n === 3 && !apart) {
    // a long rule name keeps the full heading size while the hoops can step down a little for it
    if (bigHead) for (const cls of ['ts-num', 'ts-label']) for (let shrink = 1; shrink > .87 && !specs; shrink -= .06) { C = circlesAt(0, shrink); specs = sideAt(C, cls); }
    for (let shrink = 1; shrink > .5 && !specs; shrink -= .06) { C = circlesAt(0, shrink); specs = sideSpecs(C); }
    if (!specs) { C = circlesAt(0, .5); specs = sideSpecs(C) || specsAt(C); }
  } else {
    C = circlesAt(LABEL_H); specs = specsAt(C);
    const extra = Math.max(0, ...specs.map(s => (s.fit.L.length - 1) * s.fit.lh));
    if (extra) { C = circlesAt(LABEL_H + extra + 8); specs = specsAt(C, 26); }
  }
  const labelBoxes = specs.map(s => s.box);
  // the drawn hoops: the circle picture stretched sideways by sx about the middle
  const drawn = C.map(c => ({ x: cx + (c.x - cx) * sx, y: c.y, r: c.r, rx: c.r * sx }));

  const hoopsL = Math.min(...drawn.map(c => c.x - c.rx)), hoopsR = Math.max(...drawn.map(c => c.x + c.rx)), hoopsB = Math.max(...drawn.map(c => c.y + c.r));
  const memOf = (x, y) => C.map(c => Math.hypot(X(x) - c.x, y - c.y) < c.r);
  const same = (m, want) => m.every((v, i) => v === want[i]);
  /** Does a card (w x h, pill ends of radius pr) centred at (x,y) sit wholly in the region `want`? */
  function fits(x, y, w, h, pr, want) {
    const hw = w / 2, hh = h / 2, a = Math.max(0, hw - pr) / sx, b = Math.max(0, hh - pr), xo = x;
    x = X(x); // test in the circle picture: the core narrows by sx, the pill ends keep pr (so the test errs safe)
    if (xo - hw < box.x + 12 || xo + hw > box.x + box.w - 12 || y - hh < box.y + 10 || y + hh > box.y + box.h - 10) return false;
    // exact: the card is its core rectangle (a x b half-sizes) grown by pr all round, so its
    // nearest and farthest points from a hoop's centre are known; it must clear each ring by e
    const e = want.filter(Boolean).length >= 2 ? LENS_EDGE : EDGE, eOut = want.some(Boolean) ? e : OUT_EDGE;
    // apart hoops: what fits no rule stands under the row of hoops or in the lanes beside it, never in a gap between two
    if (apart && !want.some(Boolean) && xo - hw < hoopsR + OUT_EDGE && xo + hw > hoopsL - OUT_EDGE && y - hh < hoopsB + OUT_EDGE) return false;
    for (let i = 0; i < C.length; i++) {
      const c = C[i], dx = Math.abs(x - c.x), dy = Math.abs(y - c.y);
      if (want[i] ? Math.hypot(dx + a, dy + b) + pr > c.r - e : Math.hypot(Math.max(0, dx - a), Math.max(0, dy - b)) - pr < c.r + eOut) return false;
    }
    return !labelBoxes.some(lb => overlaps(lb, { x: xo - hw, y: y - hh, w, h }, LABEL_CLEAR));
  }
  // the anchor of each region: its deepest point (inside), or the free space beside the hoops (outside)
  const anchors = {};
  function anchorOf(want, sideIx) {
    const key = want.map(Number).join('') + (want.some(v => v) ? '' : ':' + sideIx);
    if (anchors[key]) return anchors[key];
    let best = null;
    if (want.some(v => v)) {
      for (let x = box.x; x < box.x + box.w; x += 8) for (let y = box.y; y < box.y + box.h; y += 8) {
        if (!same(memOf(x, y), want)) continue;
        const d = Math.min(...C.map(c => Math.abs(Math.hypot(X(x) - c.x, y - c.y) - c.r)));
        if (!best || d > best[2]) best = [x, y, d];
      }
    } else {
      const minX = Math.min(...drawn.map(c => c.x - c.rx)), maxX = Math.max(...drawn.map(c => c.x + c.rx)), cy = C.reduce((t, c) => t + c.y, 0) / C.length;
      const below = box.y + box.h - hoopsB;
      // apart hoops with room under them: things that fit no rule make a row there, centred
      best = apart && below > 70 ? [cx, hoopsB + Math.min(below / 2, 60)] : sideIx === 0 ? [(box.x + minX) / 2, cy] : [(maxX + box.x + box.w) / 2, cy];
    }
    return (anchors[key] = best);
  }
  const cands = {};
  /** Centre for a card in region `mem`, clear of cards already placed; null if the region is full. */
  function place(mem, card, pr, placed, sideIx = 0) {
    const want = C.map((_, i) => !!mem[i]);
    const [ax, ay] = anchorOf(want, sideIx) || [box.x + box.w / 2, box.y + box.h / 2];
    const ck = `${ax},${ay},${card.h}`;
    if (!cands[ck]) {
      const rowH = card.h + 14, cand = [];
      for (let m = -6; m <= 6; m += .5) { const y = ay + m * rowH; for (let x = box.x; x <= box.x + box.w; x += 4) cand.push([x, y, (m * rowH) ** 2 * 1.4 + (x - ax) ** 2 + (m % 1 ? 900 : 0)]); }
      cands[ck] = cand.sort((a, b) => a[2] - b[2]);
    }
    const { w, h } = card;
    for (const [x, y] of cands[ck]) {
      if (placed.some(q => overlaps(q, { x: x - w / 2, y: y - h / 2, w, h }, want.some(Boolean) ? 10 : OUT_GAP))) continue;
      if (fits(x, y, w, h, pr, want)) return [x, y];
    }
    return null;
  }
  /** Every centre where a card fits in region `mem` (clear of `placed`), farthest from the region's
   *  deepest point first, thinned to at most `max`: starts for packing several cards into a small
   *  region, where the greedy first card in the middle would leave no room for the next. */
  function spots(mem, card, pr, placed, max = 48) {
    const want = C.map((_, i) => !!mem[i]), [ax, ay] = anchorOf(want, 0) || [0, 0], { w, h } = card, out = [];
    for (let x = box.x; x <= box.x + box.w; x += 6) for (let y = box.y; y <= box.y + box.h; y += 6) {
      if (placed.some(q => overlaps(q, { x: x - w / 2, y: y - h / 2, w, h }, 10))) continue;
      if (fits(x, y, w, h, pr, want)) out.push([x, y, (x - ax) ** 2 + (y - ay) ** 2]);
    }
    out.sort((p, q) => q[2] - p[2]);
    const step = Math.max(1, Math.ceil(out.length / max));
    return out.filter((_, k) => k % step === 0).map(([x, y]) => [x, y]);
  }
  return { circles: drawn, specs, labelBoxes, place, spots, sx };
}

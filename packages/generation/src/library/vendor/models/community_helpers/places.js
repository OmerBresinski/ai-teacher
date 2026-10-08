// Backdrops for community_helpers: a street, a school or a hospital, drawn flat behind the
// helpers. Modern places only (the model is about today's helpers), so the street uses kit
// objects tagged 'modern' or 'any' through sceneryFor / sceneryForG. School and hospital
// buildings are model-private: plain blocks, windows and a sign. No red-cross emblem
// (it is a protected sign, not a hospital sign).
import { h, measure, object, sceneryFor, labelGround, editable } from '../../kit/index.js';
import { periodObject, sceneryForG } from '../../kit/batch-G.js';

const win = (g, x, y, w, hh) => h('rect', { x, y, width: w, height: hh, rx: 3, fill: 'var(--sky-top)' }, g);

/** Draw the place behind the road. Returns {sign: box|null} so the caller keeps clear of it. */
export function backdrop(p, place, base, sign, signEdit, o = {}) {
  const g = h('g', {}, p);
  let signY = 238, xs = null, shop = null;
  if (place === 'street') {
    // only objects that fit a modern street
    const ok = new Set([...sceneryFor('modern'), ...sceneryForG('modern')]);
    // the right-hand end stays plain houses, so a vehicle parked there has a quiet backdrop
    const row = [['house', 110, 2.6], ['shopfront', 340, 1.4], ['house', 560, 2.6], ['tree', 720, 2.3], ['house', 870, 2.6], ['house', 1110, 2.6]];
    for (const [k, x, s] of row) {
      if (!ok.has(k)) continue;
      const sc = s * 1.25; // drawn large so the street fills the sky band behind the helpers
      if (k === 'shopfront') { if (sign && o.custom && !shop) shop = [x, sc]; else periodObject(g, k, x, base, sc); } else object(g, k, x, base, sc);
    }
    if (ok.has('street_lamp')) for (const x of [226, 650]) periodObject(g, 'street_lamp', x, base, 1.5);
  } else if (place === 'school') {
    for (const x of [96, 1184]) object(g, 'tree', x, base, 2);
    // with a lollipop sign in front, the school is drawn taller so its roof stays above the sign, and the name goes on the wall
    const L = o.lollipop, tall = !!L && L.bottom + 8 > base - 164 && L.top - 10 >= 130;
    const x0 = 250, x1 = 1030, top = tall ? L.top - 10 : base - 150;
    const ht = base - top;
    h('rect', { x: x0, y: top, width: x1 - x0, height: ht, fill: 'var(--daub)', cls: 'body' }, g);
    h('rect', { x: x0 + (x1 - x0) * .72, y: top, width: (x1 - x0) * .28, height: ht, fill: 'var(--daub-shade)' }, g);
    h('rect', { x: x0 - 10, y: top - 14, width: x1 - x0 + 20, height: 16, fill: 'var(--tile)' }, g);
    for (let r = 0; r < Math.floor(ht / 60); r++) for (let i = 0; i < 9; i++) { if (i === 4 && top + 60 + r * 60 > base - 58) continue; win(g, x0 + 30 + i * 82, top + 24 + r * 60, 48, 36); }
    h('rect', { x: 610, y: base - 58, width: 60, height: 58, fill: 'var(--hull)' }, g);
    // a low fence along the front
    for (let x = 160; x < 1120; x += 20) h('rect', { x, y: base - 26, width: 5, height: 26, fill: 'var(--wood-2)' }, g);
    h('rect', { x: 156, y: base - 20, width: 968, height: 4, fill: 'var(--wood-2)' }, g);
    // the name plate sits in clear sky above the roof, or on the wall when the school is drawn tall
    signY = tall ? top + 52 : top - 34;
    xs = w => [640, 470, 810, 400, 880, 1216 - w / 2 - 16, 64 + w / 2 + 16];
  } else {
    for (const x of [96, 1184]) object(g, 'tree', x, base, 2);
    const x0 = 330, x1 = 950, top = base - 196;
    h('rect', { x: x0, y: top, width: x1 - x0, height: 196, fill: 'var(--marble)', cls: 'body' }, g);
    h('rect', { x: x0 + (x1 - x0) * .74, y: top, width: (x1 - x0) * .26, height: 196, fill: 'var(--marble-shade)' }, g);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 8; i++) { if (r === 2 && (i === 3 || i === 4)) continue; win(g, x0 + 26 + i * 74, top + 22 + r * 52, 44, 32); }
    h('rect', { x: 560, y: base - 50, width: 160, height: 50, fill: 'var(--sky-top)' }, g);
    h('rect', { x: 540, y: base - 62, width: 200, height: 12, fill: 'var(--water)' }, g);
    signY = top + 8;
  }
  // far planes recede towards the haze; the sign is drawn on top so it stays crisp
  h('rect', { x: 0, y: 0, width: 1280, height: base, fill: 'var(--haze)', opacity: .42 }, g);
  // a named street: the name goes on the shop's sign board, drawn in front of the haze so it reads
  if (shop) periodObject(g, 'shopfront', shop[0], base, shop[1], {}, { sign, signEdit });
  // the sign goes on later, in the first spot clear of the helpers (their tall props, like a lollipop sign)
  function placeSign(layer, avoid = []) {
    if (!sign || place === 'street') return null;
    const w = measure(layer, sign, 'ts-label', { cls: 'strong' });
    const xx = xs ? xs(w) : [640, 470, 810, 380, 900];
    const at = cx => ({ x: cx - w / 2 - 16, y: signY - 36, w: w + 32, h: 48 });
    const hit = b => avoid.some(o => b.x < o.x + o.w + 8 && o.x < b.x + b.w + 8 && b.y < o.y + o.h + 8 && o.y < b.y + b.h + 8);
    const cx = xx.find(c => !hit(at(c))) ?? xx[0]; const box = at(cx);
    labelGround(layer, box);
    editable(h('text', { x: cx, y: signY, 'text-anchor': 'middle', cls: 'ts-label strong', fill: 'var(--ink)', text: sign }, layer), signEdit);
    return box;
  }
  return { g, placeSign };
}

// climate_biomes private parts: flat plant and animal drawings for the biome close-up.
// Base centre at (0, 0), up is negative y. Flat planes with one shade plane, tokens only, no words.
// Each entry: {w, h, draw(g)}. Kit drawings (biomeObject, organism) are wrapped by the model.
import { h } from '../../kit/svg.js';

const B = 'body';
const leg = (g, x, y0, y1, w, fill) => h('rect', { x: x - w / 2, y: y1, width: w, height: y0 - y1, rx: w / 2, fill }, g);
const poly = (g, pts, fill, cls) => h('polygon', { points: pts.map(p => p.join(',')).join(' '), fill, cls }, g);
const eye = (g, x, y, r = 3.5, fill = 'var(--shade)') => h('circle', { cx: x, cy: y, r, fill }, g);

export const ICONS = {
  penguin: { w: 64, h: 104, draw(g) {
    h('ellipse', { cx: -16, cy: -2, rx: 12, ry: 5, fill: 'var(--counter)' }, g); h('ellipse', { cx: 12, cy: -2, rx: 12, ry: 5, fill: 'var(--counter)' }, g);
    h('ellipse', { cx: 0, cy: -50, rx: 28, ry: 48, fill: 'var(--shade)', cls: B }, g);
    h('ellipse', { cx: 5, cy: -42, rx: 18, ry: 36, fill: 'var(--cloud)' }, g);
    h('circle', { cx: 4, cy: -84, r: 17, fill: 'var(--shade)' }, g);
    poly(g, [[16, -88], [34, -82], [16, -78]], 'var(--counter)');
    eye(g, 9, -89, 3.5, 'var(--cloud)');
    h('path', { d: 'M-24 -64 Q -40 -36 -26 -16 Q -22 -40 -18 -60 Z', fill: 'var(--shade)' }, g);
  } },
  polarBear: { w: 156, h: 82, draw(g) {
    for (const x of [-46, -26, 24, 44]) leg(g, x, 0, -36, 18, 'var(--fur-light)');
    h('ellipse', { cx: -2, cy: -46, rx: 64, ry: 32, fill: 'var(--fur-light)', stroke: 'var(--ice-side)', 'stroke-width': 2, cls: B }, g);
    h('path', { d: 'M-62 -40 Q 0 -10 60 -40 Q 0 -22 -62 -40 Z', fill: 'var(--snow-shade)' }, g);
    h('circle', { cx: 52, cy: -66, r: 7, fill: 'var(--fur-light)', stroke: 'var(--ice-side)', 'stroke-width': 2 }, g);
    h('ellipse', { cx: 62, cy: -54, rx: 20, ry: 17, fill: 'var(--fur-light)', stroke: 'var(--ice-side)', 'stroke-width': 2, cls: B }, g);
    h('ellipse', { cx: 78, cy: -50, rx: 12, ry: 9, fill: 'var(--fur-light)', stroke: 'var(--ice-side)', 'stroke-width': 2 }, g);
    eye(g, 89, -51, 5); eye(g, 64, -60, 3);
  } },
  seal: { w: 136, h: 54, draw(g) {
    poly(g, [[-62, -20], [-76, -34], [-70, -18], [-76, -2], [-62, -14]], 'var(--stone-shade)');
    h('ellipse', { cx: -4, cy: -20, rx: 60, ry: 20, fill: 'var(--stone)', cls: B }, g);
    h('path', { d: 'M-60 -14 Q 0 6 54 -14 Q 0 -4 -60 -14 Z', fill: 'var(--stone-shade)' }, g);
    h('circle', { cx: 52, cy: -34, r: 18, fill: 'var(--stone)', cls: B }, g);
    poly(g, [[10, -8], [28, -2], [20, -16]], 'var(--stone-shade)');
    eye(g, 60, -38, 3.5);
  } },
  camel: { w: 150, h: 124, draw(g) {
    for (const x of [-44, -30, 22, 36]) leg(g, x, 0, -64, 10, 'var(--rabbit-shade)');
    h('ellipse', { cx: -6, cy: -72, rx: 54, ry: 22, fill: 'var(--seedhead)', cls: B }, g);
    h('ellipse', { cx: -12, cy: -92, rx: 26, ry: 22, fill: 'var(--seedhead)' }, g);
    h('path', { d: 'M-58 -66 Q -6 -52 46 -66 Q -6 -60 -58 -66 Z', fill: 'var(--rabbit-shade)' }, g);
    poly(g, [[36, -84], [48, -70], [72, -110], [60, -118]], 'var(--seedhead)');
    h('ellipse', { cx: 72, cy: -116, rx: 18, ry: 9, fill: 'var(--seedhead)', cls: B }, g);
    eye(g, 72, -119, 3);
  } },
  lion: { w: 146, h: 94, draw(g) {
    h('path', { d: 'M-58 -52 Q -78 -40 -72 -20', fill: 'none', stroke: 'var(--seedhead)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    h('circle', { cx: -72, cy: -18, r: 6, fill: 'var(--fox-shade)' }, g);
    for (const x of [-40, -24, 22, 36]) leg(g, x, 0, -40, 14, 'var(--seedhead)');
    h('ellipse', { cx: -8, cy: -50, rx: 54, ry: 24, fill: 'var(--seedhead)', cls: B }, g);
    h('circle', { cx: 46, cy: -64, r: 30, fill: 'var(--fox-shade)', cls: B }, g);
    h('circle', { cx: 52, cy: -62, r: 18, fill: 'var(--seedhead)' }, g);
    eye(g, 58, -66, 3); eye(g, 66, -56, 3.5);
  } },
  giraffe: { w: 110, h: 204, draw(g) {
    for (const x of [-30, -18, 12, 24]) leg(g, x, 0, -78, 8, 'var(--sun)');
    poly(g, [[8, -92], [26, -96], [52, -178], [40, -184]], 'var(--sun)');
    h('ellipse', { cx: -4, cy: -86, rx: 42, ry: 20, fill: 'var(--sun)', cls: B }, g);
    h('ellipse', { cx: 54, cy: -184, rx: 18, ry: 9, fill: 'var(--sun)', cls: B }, g);
    for (const [x, y] of [[-24, -90], [-6, -80], [12, -92], [-30, -76], [24, -116], [34, -142], [42, -164]]) h('circle', { cx: x, cy: y, r: 5, fill: 'var(--fox-shade)' }, g);
    h('line', { x1: 46, y1: -192, x2: 44, y2: -202, stroke: 'var(--fox-shade)', 'stroke-width': 'var(--sw-lead)', 'stroke-linecap': 'round' }, g);
    eye(g, 58, -188, 3);
  } },
  jaguar: { w: 156, h: 74, draw(g) {
    h('path', { d: 'M-58 -46 Q -84 -40 -80 -14', fill: 'none', stroke: 'var(--counter)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    for (const x of [-40, -24, 24, 38]) leg(g, x, 0, -34, 13, 'var(--counter)');
    h('ellipse', { cx: -6, cy: -42, rx: 56, ry: 20, fill: 'var(--counter)', cls: B }, g);
    h('circle', { cx: 52, cy: -50, r: 17, fill: 'var(--counter)', cls: B }, g);
    h('circle', { cx: 46, cy: -66, r: 6, fill: 'var(--counter)' }, g); h('circle', { cx: 60, cy: -64, r: 6, fill: 'var(--counter)' }, g);
    for (const [x, y] of [[-38, -46], [-22, -36], [-8, -50], [6, -38], [20, -48], [-30, -30], [30, -36]]) h('circle', { cx: x, cy: y, r: 4, fill: 'none', stroke: 'var(--shade)', 'stroke-width': 'var(--sw-lead)' }, g);
    eye(g, 60, -52, 3);
  } },
  toucan: { w: 96, h: 96, draw(g) {
    h('line', { x1: -46, y1: -6, x2: 44, y2: -6, stroke: 'var(--trunk)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    poly(g, [[-16, -20], [-26, 4], [-12, 4]], 'var(--shade)');
    h('ellipse', { cx: -10, cy: -42, rx: 18, ry: 30, fill: 'var(--shade)', cls: B }, g);
    h('ellipse', { cx: -2, cy: -56, rx: 10, ry: 14, fill: 'var(--sun)' }, g);
    h('path', { d: 'M2 -72 C 24 -82 44 -76 48 -64 C 34 -62 16 -60 2 -60 Z', fill: 'var(--counter)', cls: B }, g);
    eye(g, -4, -70, 3.5, 'var(--cloud)');
  } },
  sloth: { w: 120, h: 104, draw(g) {
    h('line', { x1: -58, y1: -96, x2: 58, y2: -96, stroke: 'var(--trunk)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    for (const [x1, x2] of [[-24, -34], [-6, -14], [16, 22], [30, 40]]) h('line', { x1, y1: -62, x2, y2: -94, stroke: 'var(--rabbit)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    h('ellipse', { cx: 0, cy: -56, rx: 38, ry: 22, fill: 'var(--rabbit)', cls: B }, g);
    h('ellipse', { cx: 30, cy: -46, rx: 15, ry: 12, fill: 'var(--fur-light)' }, g);
    h('ellipse', { cx: 34, cy: -48, rx: 7, ry: 4, fill: 'var(--rabbit-shade)' }, g);
    eye(g, 35, -48, 2.5);
  } },
  reindeer: { w: 130, h: 150, draw(g) {
    for (const x of [-36, -22, 20, 32]) leg(g, x, 0, -58, 9, 'var(--rabbit-shade)');
    h('ellipse', { cx: -4, cy: -66, rx: 46, ry: 20, fill: 'var(--rabbit)', cls: B }, g);
    poly(g, [[26, -78], [40, -72], [56, -106], [44, -112]], 'var(--rabbit)');
    h('ellipse', { cx: 58, cy: -110, rx: 16, ry: 9, fill: 'var(--rabbit)', cls: B }, g);
    h('ellipse', { cx: 34, cy: -82, rx: 10, ry: 8, fill: 'var(--fur-light)' }, g);
    h('path', { d: 'M46 -116 L 36 -140 M40 -128 L 28 -134 M50 -116 L 58 -144 M55 -132 L 66 -138', fill: 'none', stroke: 'var(--trunk)', 'stroke-width': 'var(--sw-lead)', 'stroke-linecap': 'round' }, g);
    eye(g, 60, -112, 3);
  } },
  datePalm: { w: 130, h: 176, draw(g) {
    h('path', { d: 'M-6 0 Q 0 -80 4 -150 L 12 -150 Q 8 -80 6 0 Z', fill: 'var(--trunk)', cls: B }, g);
    for (const [dx, dy] of [[-60, -110], [-50, -136], [-14, -170], [20, -168], [58, -138], [64, -112]]) h('path', { d: `M8 -152 Q ${8 + dx * .5} ${-170 + (dy + 150) * .2} ${8 + dx} ${dy}`, fill: 'none', stroke: 'var(--canopy)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
  } },
  baobab: { w: 150, h: 150, draw(g) {
    h('path', { d: 'M-30 0 C -26 -40 -20 -80 -16 -100 L 16 -100 C 20 -80 26 -40 30 0 Z', fill: 'var(--stone-shade)', cls: B }, g);
    h('path', { d: 'M-14 -98 L -46 -124 M-4 -100 L -10 -134 M8 -100 L 24 -136 M14 -98 L 52 -120', fill: 'none', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    for (const [x, y, r] of [[-48, -128, 16], [-10, -140, 18], [26, -142, 16], [54, -124, 14]]) h('ellipse', { cx: x, cy: y, rx: r * 1.3, ry: r * .7, fill: 'var(--hill-mid)' }, g);
  } },
  bromeliad: { w: 90, h: 70, draw(g) {
    for (const a of [-70, -40, -14, 14, 40, 70]) { const r = a * Math.PI / 180, x = Math.sin(r) * 44, y = -Math.cos(r) * 40 - 6;
      h('path', { d: `M-6 0 Q ${x * .4} ${y * .6} ${x} ${y} Q ${x * .5} ${y * .5} 6 0 Z`, fill: Math.abs(a) > 30 ? 'var(--life-shade)' : 'var(--leaf)' }, g); }
    poly(g, [[-6, -20], [0, -64], [6, -20]], 'var(--berry)');
  } },
  poppy: { w: 90, h: 70, draw(g) {
    h('ellipse', { cx: 0, cy: -2, rx: 30, ry: 7, fill: 'var(--life-shade)' }, g); // a low cushion of leaves
    for (const [x, top] of [[-22, -44], [2, -62], [24, -48]]) {
      h('path', { d: `M${x * .3} -4 Q ${x * .7} ${top / 2} ${x} ${top}`, fill: 'none', stroke: 'var(--life-shade)', 'stroke-width': 'var(--sw-lead)', 'stroke-linecap': 'round' }, g);
      h('path', { d: `M${x - 11} ${top - 2} Q ${x - 12} ${top - 18} ${x} ${top - 16} Q ${x + 12} ${top - 18} ${x + 11} ${top - 2} Q ${x} ${top + 6} ${x - 11} ${top - 2} Z`, fill: 'var(--sun)', cls: B }, g);
      h('circle', { cx: x, cy: top - 6, r: 3, fill: 'var(--life-shade)' }, g);
    }
  } },
  moss: { w: 120, h: 30, draw(g) {
    for (const [x, rx, ry, f] of [[-34, 26, 14, 'var(--life-shade)'], [0, 30, 20, 'var(--life)'], [36, 24, 12, 'var(--life-shade)']]) h('ellipse', { cx: x, cy: 0, rx, ry, fill: f, cls: B }, g);
    for (const [x, y] of [[-40, -8], [-6, -16], [24, -8], [40, -4]]) h('circle', { cx: x, cy: y, r: 4, fill: 'var(--seedhead)' }, g);
  } },
};

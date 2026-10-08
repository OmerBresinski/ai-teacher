// Batch D (Life science) kit parts. Tokens only, flat planes with one shaded face, `.body`
// keylines for themes that want them, every word real SVG text marked editable/computed.
// Imports the kit core directly (not index.js), so index.js may re-export this file.
//
// Exports
//   ORGANISMS                      list of organism kinds (23)
//   ORGANISM_SIZE[kind]            {w, h} nominal box at s = 1 (base centre at 0,0; h above, `below` under ground)
//   ORGANISM_TAGS[kind]            {habitats: [...], topics: [...]}  honest habitat/topic tags for truth rules
//   organismsFor(habitat, topic?)  kinds tagged for a habitat (and topic), [] when none fit
//   organism(p, kind, x, y, s=1, a={})          draws one organism, base centre at (x,y); returns outer <g> with .box
//   organismBox(kind, x, y, s=1)  {x,y,w,h} of an organism drawn at (x,y,s)
//   cycleRing(p, stages, {ctx, cx, cy, r, layout:'ring'|'line', x0, x1, size, s0=0, close=true,
//             col, labelW, a})    stages: [{kind, label, edit, s?}]. Stage i (organism + label) appears at
//             s0+i ('pop'), the arrow into it draws at s0+i, the closing arrow at s0+n.
//             Returns {g, slots:[{x,y,size,box,labelBox,el}], closeS}
//   bodyOutline(p, {age:'child'|'adult', x, top, height, fill:'skin'|'plain', a})
//             front-view figure. Returns {g, H, L (landmarks), slots{name:{x,y}}, journey:{pts, at{stage:index}}}
//             Slot names use the BODY's sides: right* is on the viewer's left.
//   ORGAN_NAMES                    organs bodyOutline can draw
//   organ(p, body, name, a={})     flat organ in its true slot; returns <g> with .box
//   branchTree(p, root, {ctx, x0, x1, y0, y1, s0=0, yesLabel, noLabel, yesEdit, noEdit, cardW, a})
//             root: {q, edit, yes: node, no: node} | leaf {label, edit, kind?}. Question at depth d appears
//             at s0+d, its children (edges, cards, leaves) at s0+d+1 unless node.s is set.
//             Returns {g, nodes:[{node, depth, x, y, box, leaf}], leaves, depth}
//   HABITATS                       ['pond','woodland','ocean','polar','desert','savannah','field']
//   HABITAT_OBJECTS[key]           habitat tags per scenery object (reeds, lilypad, log, rock, seaweed,
//                                  acacia, hedge, tree, floe)
//   habitatScenery(kind)           objects that fit a habitat, [] means plain layers
//   habitatObject(p, key, x, y, s=1, a={})      draws one habitat object
//   habitat(p, kind, {ctx, seed, avoid:[boxes], objects:true, a})
//             full-bleed backdrop from landscape layers (y 0 to the foot rule). Objects are placed only
//             through habitatScenery(kind) and skipped when their box meets an `avoid` box.
//             Returns {g, horizon, groundY, water:{x,y,w,h}|null, placed:[{key, box}]}
import { h, W, clamp, rng, overlaps } from './svg.js';
import { GRID } from './layout.js';
import { textBlock, editable, line, arrow, sky, hills, ground, water, object } from './components.js';

/* ================================================================== organisms */
// Each draw function: base centre at (0,0), up is negative y. Sizes in ORGANISM_SIZE.
const B = 'body';
const O = {
  seed(g) {
    h('ellipse', { cx: 0, cy: -14, rx: 22, ry: 14, fill: 'var(--seed)', cls: B }, g);
    h('path', { d: 'M0 -28 A22 14 0 0 1 0 0 A10 14 0 0 0 0 -28 Z', fill: 'var(--seedhead)' }, g);
    h('path', { d: 'M-8 -16 Q -2 -12 4 -16', fill: 'none', stroke: 'var(--seedhead)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
  },
  sprout(g) {
    for (const d of ['M0 0 Q -10 14 -18 22', 'M0 0 Q 4 16 2 26', 'M0 0 Q 12 12 20 18']) h('path', { d, fill: 'none', stroke: 'var(--seedhead)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
    h('path', { d: 'M0 0 Q -6 -26 0 -50', fill: 'none', stroke: 'var(--life-shade)', 'stroke-width': 5, 'stroke-linecap': 'round' }, g);
    h('path', { d: 'M0 -46 C -10 -64 -32 -62 -34 -50 C -24 -42 -10 -42 0 -46 Z', fill: 'var(--leaf)', cls: B }, g);
    h('path', { d: 'M0 -46 C 10 -64 32 -62 34 -50 C 24 -42 10 -42 0 -46 Z', fill: 'var(--life-shade)', cls: B }, g);
  },
  flower(g) {
    h('path', { d: 'M0 0 Q 4 -50 0 -96', fill: 'none', stroke: 'var(--life-shade)', 'stroke-width': 5, 'stroke-linecap': 'round' }, g);
    h('path', { d: 'M1 -34 C -14 -50 -34 -48 -38 -38 C -26 -30 -12 -28 1 -34 Z', fill: 'var(--leaf)', cls: B }, g);
    h('path', { d: 'M2 -56 C 16 -72 34 -70 38 -60 C 26 -52 14 -50 2 -56 Z', fill: 'var(--life-shade)', cls: B }, g);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; h('ellipse', { cx: Math.cos(a) * 17, cy: -104 + Math.sin(a) * 17, rx: 13, ry: 9, transform: `rotate(${i * 60} ${Math.cos(a) * 17} ${-104 + Math.sin(a) * 17})`, fill: i % 2 ? 'var(--berry-shade)' : 'var(--berry)', cls: B }, g); }
    h('circle', { cx: 0, cy: -104, r: 10, fill: 'var(--sun)', cls: B }, g);
  },
  tree(g) {
    h('path', { d: 'M-9 0 L -7 -74 L 7 -74 L 9 0 Z', fill: 'var(--trunk)' }, g);
    h('circle', { cx: -26, cy: -98, r: 34, fill: 'var(--canopy)', cls: B }, g);
    h('circle', { cx: 24, cy: -96, r: 36, fill: 'var(--canopy)', cls: B }, g);
    h('circle', { cx: 0, cy: -130, r: 38, fill: 'var(--canopy)', cls: B }, g);
    h('path', { d: 'M24 -132 A36 36 0 0 1 24 -60 A40 40 0 0 0 24 -132 Z', fill: 'var(--canopy-shade)' }, g);
  },
  grass(g) {
    for (const [x, hh, f] of [[-22, 26, 'var(--life-shade)'], [-10, 40, 'var(--leaf)'], [2, 32, 'var(--life-shade)'], [12, 42, 'var(--leaf)'], [24, 24, 'var(--life-shade)']])
      h('path', { d: `M${x - 5} 0 Q ${x - 2} ${-hh * .6} ${x + (x < 0 ? -4 : 4)} ${-hh} Q ${x + 4} ${-hh * .5} ${x + 5} 0 Z`, fill: f }, g);
  },
  caterpillar(g) {
    for (let i = 0; i < 6; i++) { const x = -44 + i * 15, y = -14 - 4 * Math.sin(i * 1.1);
      h('line', { x1: x, y1: y + 8, x2: x, y2: 0, stroke: 'var(--life-shade)', 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
      h('circle', { cx: x, cy: y, r: 12, fill: i % 2 ? 'var(--life-shade)' : 'var(--leaf)', cls: B }, g); }
    h('circle', { cx: 46, cy: -20, r: 14, fill: 'var(--life-shade)', cls: B }, g);
    h('circle', { cx: 51, cy: -23, r: 3, fill: 'var(--ink)' }, g);
    h('path', { d: 'M44 -33 L 40 -42 M50 -33 L 54 -42', stroke: 'var(--ink-2)', 'stroke-width': 2.5, 'stroke-linecap': 'round', fill: 'none' }, g);
  },
  chrysalis(g) {
    h('line', { x1: -34, y1: -98, x2: 34, y2: -98, stroke: 'var(--trunk)', 'stroke-width': 7, 'stroke-linecap': 'round' }, g);
    h('line', { x1: 0, y1: -98, x2: 0, y2: -86, stroke: 'var(--ink-3)', 'stroke-width': 2 }, g);
    h('path', { d: 'M0 -86 C 18 -80 20 -44 8 -18 C 4 -8 2 -2 0 0 C -2 -2 -4 -8 -8 -18 C -20 -44 -18 -80 0 -86 Z', fill: 'var(--thatch)', cls: B }, g);
    h('path', { d: 'M0 -86 C 18 -80 20 -44 8 -18 C 4 -8 2 -2 0 0 C 6 -30 8 -60 0 -86 Z', fill: 'var(--thatch-shade)' }, g);
  },
  butterfly(g) {
    h('path', { d: 'M-3 -56 C -30 -96 -66 -92 -58 -62 C -54 -48 -24 -46 -3 -50 Z', fill: 'var(--fox)', cls: B }, g);
    h('path', { d: 'M3 -56 C 30 -96 66 -92 58 -62 C 54 -48 24 -46 3 -50 Z', fill: 'var(--fox)', cls: B }, g);
    h('path', { d: 'M-3 -46 C -24 -44 -48 -30 -38 -14 C -28 -4 -10 -22 -3 -38 Z', fill: 'var(--fox-shade)', cls: B }, g);
    h('path', { d: 'M3 -46 C 24 -44 48 -30 38 -14 C 28 -4 10 -22 3 -38 Z', fill: 'var(--fox-shade)', cls: B }, g);
    for (const x of [-40, 40]) h('circle', { cx: x, cy: -72, r: 6, fill: 'var(--fur-light)' }, g);
    h('ellipse', { cx: 0, cy: -44, rx: 5, ry: 26, fill: 'var(--ink-2)' }, g);
    h('path', { d: 'M-2 -68 Q -8 -84 -16 -88 M2 -68 Q 8 -84 16 -88', fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }, g);
  },
  frogspawn(g) {
    const P = [[-34, -12], [-18, -10], [-2, -11], [14, -10], [30, -12], [-26, -27], [-10, -26], [6, -27], [22, -26], [-18, -42], [-2, -41], [14, -42]];
    for (const [x, y] of P) h('circle', { cx: x, cy: y, r: 9, fill: 'var(--water-hi)', stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-hair)' }, g);
    for (const [x, y] of P) h('circle', { cx: x + 1, cy: y - 1, r: 3.2, fill: 'var(--ink)' }, g);
  },
  tadpole(g) {
    h('path', { d: 'M-6 -16 C 10 -24 18 -6 34 -16 C 26 -8 14 -10 -4 -8 Z', fill: 'var(--soil-deep)' }, g);
    h('ellipse', { cx: -16, cy: -14, rx: 16, ry: 12, fill: 'var(--soil-deep)', cls: B }, g);
    h('circle', { cx: -24, cy: -17, r: 2.6, fill: 'var(--fur-light)' }, g);
  },
  froglet(g) { frogDraw(g, true); },
  frog(g) { frogDraw(g, false); },
  egg(g) {
    h('path', { d: 'M0 -56 C 20 -56 24 -24 22 -16 C 20 -4 10 0 0 0 C -10 0 -20 -4 -22 -16 C -24 -24 -20 -56 0 -56 Z', fill: 'var(--daub)', cls: B }, g);
    h('path', { d: 'M0 -56 C 20 -56 24 -24 22 -16 C 20 -4 10 0 0 0 C 12 -16 12 -40 0 -56 Z', fill: 'var(--daub-shade)' }, g);
  },
  chick(g) {
    for (const x of [-8, 6]) h('path', { d: `M${x} -8 L ${x} 0 M${x - 5} 0 L ${x + 5} 0`, stroke: 'var(--fox)', 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none' }, g);
    h('circle', { cx: -4, cy: -26, r: 20, fill: 'var(--sun)', cls: B }, g);
    h('path', { d: 'M-18 -28 C -16 -14 0 -12 4 -20 C -4 -22 -10 -26 -18 -28 Z', fill: 'var(--seedhead)' }, g);
    h('circle', { cx: 12, cy: -48, r: 13, fill: 'var(--sun)', cls: B }, g);
    h('polygon', { points: '23,-50 34,-46 23,-43', fill: 'var(--fox)' }, g);
    h('circle', { cx: 16, cy: -51, r: 2.6, fill: 'var(--ink)' }, g);
  },
  hen(g) {
    for (const x of [-12, 8]) h('path', { d: `M${x} -24 L ${x} 0 M${x - 8} 0 L ${x + 8} 0`, stroke: 'var(--sun)', 'stroke-width': 4, 'stroke-linecap': 'round', fill: 'none' }, g);
    h('path', { d: 'M-40 -60 L -58 -92 L -46 -58 L -60 -76 L -40 -44 Z', fill: 'var(--rabbit-shade)', cls: B }, g);
    h('ellipse', { cx: -4, cy: -46, rx: 42, ry: 28, fill: 'var(--rabbit)', cls: B }, g);
    h('path', { d: 'M-28 -50 C -18 -28 14 -26 20 -40 C 6 -40 -12 -44 -28 -50 Z', fill: 'var(--rabbit-shade)' }, g);
    h('path', { d: 'M22 -62 C 22 -82 46 -86 48 -70 L 44 -50 Z', fill: 'var(--rabbit)', cls: B }, g);
    h('path', { d: 'M28 -82 Q 32 -94 36 -84 Q 40 -94 44 -82 Z', fill: 'var(--berry)' }, g);
    h('polygon', { points: '48,-74 58,-70 48,-66', fill: 'var(--sun)' }, g);
    h('ellipse', { cx: 47, cy: -62, rx: 4, ry: 6, fill: 'var(--berry)' }, g);
    h('circle', { cx: 40, cy: -74, r: 3, fill: 'var(--ink)' }, g);
  },
  baby(g) { personDraw(g, 58, 4, 'var(--cloth-2)'); },
  child(g) { personDraw(g, 100, 6, 'var(--cloth-3)'); },
  adult(g) { personDraw(g, 140, 7.5, 'var(--cloth-1)'); },
  rabbit(g) { const k = h('g', { transform: 'scale(.52)' }, g); rabbitDraw(k); },
  fox(g) { const k = h('g', { transform: 'scale(.42)' }, g); foxDraw(k); },
  worm(g) {
    const d = 'M-46 -8 C -34 -24 -20 -24 -10 -10 C 0 4 14 4 24 -10 C 32 -20 42 -18 48 -12';
    h('path', { d, fill: 'none', stroke: 'var(--ear)', 'stroke-width': 13, 'stroke-linecap': 'round' }, g);
    h('path', { d: 'M-16 -22 L -14 -10', stroke: 'var(--berry-shade)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
    for (const x of [-34, 6, 30]) h('line', { x1: x, y1: -14, x2: x + 2, y2: -2, stroke: 'var(--berry-shade)', 'stroke-width': 1.5, opacity: .6 }, g);
  },
  bird(g) {
    for (const x of [-6, 6]) h('line', { x1: x, y1: -14, x2: x, y2: 0, stroke: 'var(--ink-2)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }, g);
    h('path', { d: 'M-24 -36 L -46 -46 L -42 -30 Z', fill: 'var(--stone-shade)', cls: B }, g);
    h('ellipse', { cx: 0, cy: -32, rx: 26, ry: 18, fill: 'var(--stone)', cls: B }, g);
    h('path', { d: 'M-16 -38 C -6 -24 12 -22 16 -30 C 6 -34 -6 -38 -16 -38 Z', fill: 'var(--stone-shade)' }, g);
    h('circle', { cx: 22, cy: -50, r: 12, fill: 'var(--stone)', cls: B }, g);
    h('polygon', { points: '32,-52 44,-48 32,-45', fill: 'var(--sun)' }, g);
    h('circle', { cx: 26, cy: -53, r: 2.6, fill: 'var(--ink)' }, g);
  },
  fish(g) {
    h('polygon', { points: '-30,-24 -52,-40 -52,-8', fill: 'var(--metal-shade)', cls: B }, g);
    h('ellipse', { cx: 0, cy: -24, rx: 38, ry: 18, fill: 'var(--metal)', cls: B }, g);
    h('path', { d: 'M-34 -24 C -10 -16 20 -14 36 -22 C 30 -10 14 -6 0 -6 C -16 -6 -30 -14 -34 -24 Z', fill: 'var(--metal-shade)' }, g);
    h('path', { d: 'M-8 -40 Q 4 -50 14 -40 Z', fill: 'var(--metal-shade)' }, g);
    h('circle', { cx: 24, cy: -28, r: 3.2, fill: 'var(--ink)' }, g);
  },
};
function frogDraw(g, young) {
  if (young) h('path', { d: 'M-34 -16 C -52 -18 -62 -10 -76 -18 C -66 -2 -48 -4 -32 -6 Z', fill: 'var(--life-shade)' }, g);
  h('path', { d: 'M-36 -6 C -48 -6 -46 -30 -28 -30 L -6 -12 L -6 -2 Z', fill: 'var(--life-shade)', cls: B }, g);
  h('path', { d: 'M-40 -14 C -40 -46 -2 -54 22 -44 C 40 -38 46 -22 38 -10 C 20 -2 -24 -2 -40 -14 Z', fill: 'var(--life)', cls: B }, g);
  h('path', { d: 'M-34 -12 C -10 -4 22 -4 38 -10 C 20 -16 -10 -18 -34 -12 Z', fill: 'var(--fur-light)' }, g);
  h('path', { d: 'M18 -14 L 24 0 L 34 0', fill: 'none', stroke: 'var(--life-shade)', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  h('path', { d: 'M-30 -8 C -40 -4 -40 0 -22 0', fill: 'none', stroke: 'var(--life-shade)', 'stroke-width': 6, 'stroke-linecap': 'round' }, g);
  h('circle', { cx: 22, cy: -46, r: 9, fill: 'var(--life)', cls: B }, g);
  h('circle', { cx: 24, cy: -47, r: 4, fill: 'var(--ink)' }, g);
}
function personDraw(g, H, heads, cloth) {
  // honest head-to-height ratio (baby about 1:4, child 1:6, adult 1:7.5)
  const hu = H / heads, hr = hu * .42, top = -H, legTop = -H * .47, legW = Math.max(6, H * .055);
  h('rect', { x: -legW - 1.5, y: legTop, width: legW, height: H * .47, rx: legW / 2, fill: 'var(--ink-2)' }, g);
  h('rect', { x: 1.5, y: legTop, width: legW, height: H * .47, rx: legW / 2, fill: 'var(--ink-2)' }, g);
  const sw = H * .13, bodyTop = top + hu * .95;
  h('rect', { x: -sw, y: bodyTop, width: sw * 2, height: legTop - bodyTop + H * .04, rx: Math.min(sw * .6, 12), fill: cloth, cls: B }, g);
  h('rect', { x: sw * .2, y: bodyTop, width: sw * .8, height: legTop - bodyTop + H * .04, rx: Math.min(sw * .4, 8), fill: 'var(--ground-shadow)' }, g);
  h('circle', { cx: 0, cy: top + hr, r: hr, fill: 'var(--person-1)', cls: B }, g);
}
// rabbit2 and fox2 from the north star, unchanged in shape
function rabbitDraw(g) {
  h('ellipse', { cx: 0, cy: 0, rx: 98, ry: 8, fill: 'var(--ground-shadow)' }, g);
  h('circle', { cx: -86, cy: -46, r: 15, fill: 'var(--fur-light)', cls: B }, g);
  h('path', { d: 'M-90 -14 C-100 -62 -62 -104 -8 -102 C34 -100 58 -80 62 -52 L58 -12 C30 -2 -60 -2 -90 -14 Z', fill: 'var(--rabbit)', cls: B }, g);
  h('path', { d: 'M-88 -12 C-96 -50 -66 -82 -34 -76 C-6 -70 2 -34 -12 -6 C-40 0 -70 -2 -88 -12 Z', fill: 'var(--rabbit-shade)' }, g);
  h('ellipse', { cx: -34, cy: -6, rx: 36, ry: 7, fill: 'var(--rabbit-shade)' }, g);
  h('path', { d: 'M38 -46 L46 -6 L64 -6 L56 -48 Z', fill: 'var(--rabbit-shade)' }, g);
  h('ellipse', { cx: 58, cy: -6, rx: 16, ry: 6, fill: 'var(--rabbit-shade)' }, g);
  for (const [ex, ey, rot] of [[30, -134, -34], [50, -140, -16]]) {
    h('ellipse', { cx: ex, cy: ey, rx: 11, ry: 38, transform: `rotate(${rot} ${ex} ${ey})`, fill: 'var(--rabbit)', cls: B }, g);
    h('ellipse', { cx: ex + 1, cy: ey + 3, rx: 5, ry: 26, transform: `rotate(${rot} ${ex} ${ey})`, fill: 'var(--ear)' }, g);
  }
  h('ellipse', { cx: 68, cy: -80, rx: 36, ry: 30, transform: 'rotate(18 68 -80)', fill: 'var(--rabbit)', cls: B }, g);
  h('ellipse', { cx: 84, cy: -66, rx: 17, ry: 13, fill: 'var(--fur-light)' }, g);
  h('circle', { cx: 80, cy: -88, r: 5, fill: 'var(--ink)' }, g); h('circle', { cx: 100, cy: -72, r: 4.5, fill: 'var(--ear)' }, g);
}
function foxDraw(g) {
  h('ellipse', { cx: 10, cy: 0, rx: 140, ry: 9, fill: 'var(--ground-shadow)' }, g);
  h('path', { d: 'M92 -74 C150 -70 198 -104 190 -152 C168 -120 132 -106 86 -100 Z', fill: 'var(--fox)', cls: B }, g);
  h('path', { d: 'M190 -152 C182 -134 170 -124 158 -118 C174 -118 192 -128 190 -152 Z', fill: 'var(--fur-light)' }, g);
  for (const lx of [-62, -38, 56, 80]) { h('rect', { x: lx, y: -52, width: 15, height: 52, rx: 'var(--r-mark)', fill: 'var(--fox-shade)' }, g); h('rect', { x: lx, y: -14, width: 15, height: 14, fill: 'var(--ink)' }, g); }
  h('path', { d: 'M-80 -66 C-68 -106 62 -112 106 -86 C118 -64 100 -46 68 -44 L-56 -44 C-78 -46 -86 -56 -80 -66 Z', fill: 'var(--fox)', cls: B }, g);
  h('path', { d: 'M-56 -46 C-20 -38 30 -38 68 -44 C40 -54 -20 -56 -56 -46 Z', fill: 'var(--fox-shade)' }, g);
  h('ellipse', { cx: -76, cy: -58, rx: 20, ry: 19, fill: 'var(--fur-light)' }, g);
  h('polygon', { points: '-102,-112 -112,-152 -82,-120', fill: 'var(--fox-shade)', cls: B }, g); h('polygon', { points: '-80,-116 -70,-154 -60,-112', fill: 'var(--fox-shade)', cls: B }, g);
  h('circle', { cx: -88, cy: -92, r: 30, fill: 'var(--fox)', cls: B }, g);
  h('polygon', { points: '-104,-100 -152,-80 -106,-70', fill: 'var(--fox)', cls: B }, g);
  h('polygon', { points: '-106,-80 -150,-79 -108,-70', fill: 'var(--fur-light)' }, g);
  h('circle', { cx: -152, cy: -80, r: 5, fill: 'var(--ink)' }, g); h('circle', { cx: -104, cy: -98, r: 4.5, fill: 'var(--ink)' }, g);
}

export const ORGANISMS = Object.keys(O);
/** Nominal box at s = 1. h is above the base line; below is how far roots etc. go under it. */
export const ORGANISM_SIZE = {
  seed: { w: 48, h: 30 }, sprout: { w: 72, h: 66, below: 28 }, flower: { w: 80, h: 132 }, tree: { w: 140, h: 170 },
  grass: { w: 60, h: 44 }, caterpillar: { w: 116, h: 46 }, chrysalis: { w: 72, h: 102 }, butterfly: { w: 124, h: 96 },
  frogspawn: { w: 90, h: 54 }, tadpole: { w: 70, h: 28 }, froglet: { w: 124, h: 58 }, frog: { w: 96, h: 58 },
  egg: { w: 46, h: 58 }, chick: { w: 62, h: 64 }, hen: { w: 120, h: 96 },
  baby: { w: 32, h: 58 }, child: { w: 40, h: 100 }, adult: { w: 50, h: 140 },
  rabbit: { w: 130, h: 92 }, fox: { w: 146, h: 66 }, worm: { w: 108, h: 30 }, bird: { w: 94, h: 64 }, fish: { w: 96, h: 44 },
};
const ORG_CX = { rabbit: 2, fox: 8, caterpillar: 4, froglet: -14, frog: 0, hen: -2, chick: 4, bird: -2, fish: -4 };
/** Honest habitat and topic tags. A model must only place organisms tagged for its habitat. */
export const ORGANISM_TAGS = {
  seed: { habitats: ['field', 'woodland', 'garden'], topics: ['plant', 'life-cycle', 'growth'] },
  sprout: { habitats: ['field', 'woodland', 'garden'], topics: ['plant', 'life-cycle', 'growth'] },
  flower: { habitats: ['field', 'woodland', 'garden'], topics: ['plant', 'life-cycle', 'producer'] },
  tree: { habitats: ['woodland', 'field', 'garden'], topics: ['plant', 'producer'] },
  grass: { habitats: ['field', 'woodland', 'savannah', 'garden'], topics: ['plant', 'producer'] },
  caterpillar: { habitats: ['woodland', 'field', 'garden'], topics: ['insect', 'life-cycle', 'consumer'] },
  chrysalis: { habitats: ['woodland', 'field', 'garden'], topics: ['insect', 'life-cycle'] },
  butterfly: { habitats: ['woodland', 'field', 'garden'], topics: ['insect', 'life-cycle', 'consumer'] },
  frogspawn: { habitats: ['pond'], topics: ['amphibian', 'life-cycle'] },
  tadpole: { habitats: ['pond'], topics: ['amphibian', 'life-cycle', 'consumer'] },
  froglet: { habitats: ['pond'], topics: ['amphibian', 'life-cycle', 'consumer'] },
  frog: { habitats: ['pond', 'woodland', 'garden'], topics: ['amphibian', 'life-cycle', 'consumer'] },
  egg: { habitats: ['farm'], topics: ['bird', 'life-cycle'] },
  chick: { habitats: ['farm'], topics: ['bird', 'life-cycle'] },
  hen: { habitats: ['farm'], topics: ['bird', 'life-cycle', 'consumer'] },
  baby: { habitats: ['home'], topics: ['mammal', 'human', 'life-cycle'] },
  child: { habitats: ['home'], topics: ['mammal', 'human', 'life-cycle'] },
  adult: { habitats: ['home'], topics: ['mammal', 'human', 'life-cycle'] },
  rabbit: { habitats: ['woodland', 'field'], topics: ['mammal', 'consumer', 'prey'] },
  fox: { habitats: ['woodland', 'field'], topics: ['mammal', 'consumer', 'predator'] },
  worm: { habitats: ['woodland', 'field', 'garden'], topics: ['minibeast', 'consumer', 'decomposer'] },
  bird: { habitats: ['woodland', 'field', 'garden', 'pond'], topics: ['bird', 'consumer'] },
  fish: { habitats: ['pond', 'ocean'], topics: ['fish', 'consumer'] },
};
/** Relative size within a cycle (young stages draw smaller than adults when shown together). */
export const ORGANISM_REL = { seed: .55, sprout: .8, egg: .6, chick: .75, frogspawn: .85, tadpole: .6, froglet: .8, caterpillar: .9, chrysalis: .85, baby: .55, child: .78 };
export const organismsFor = (habitat, topic) => ORGANISMS.filter(k => ORGANISM_TAGS[k].habitats.includes(habitat) && (!topic || ORGANISM_TAGS[k].topics.includes(topic)));
export function organismBox(kind, x, y, s = 1) {
  const z = ORGANISM_SIZE[kind] || ORGANISM_SIZE.seed, cx = x + (ORG_CX[kind] || 0) * s;
  return { x: cx - z.w * s / 2, y: y - z.h * s, w: z.w * s, h: (z.h + (z.below || 0)) * s };
}
/** Draw one organism, base centre at (x, y). Build attributes go in `a` on the outer group. */
export function organism(p, kind, x, y, s = 1, a = {}) {
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer);
  (O[kind] || O.seed)(g); outer.box = organismBox(kind, x, y, s); outer.dataset.organism = kind; return outer;
}

/* ================================================================== cycleRing */
export function cycleRing(p, stages, o = {}) {
  const { ctx, layout = 'ring', s0 = 0, close = true, col = 'var(--ink-3)', a = {} } = o;
  const g = h('g', a, p); const under = h('g', {}, g), top = h('g', {}, g); const n = stages.length; const slots = [];
  if (!n) return { g, slots, closeS: s0 };
  const ring = layout !== 'line';
  const cx = o.cx ?? (GRID.left + GRID.right) / 2, cy = o.cy ?? (GRID.top + GRID.bottom) / 2, r = o.r ?? 190;
  const x0 = o.x0 ?? GRID.left + 80, x1 = o.x1 ?? GRID.right - 80;
  const pitch = ring ? 2 * r * Math.sin(Math.PI / Math.max(n, 2)) : (n > 1 ? (x1 - x0) / (n - 1) : 400);
  const size = Math.min(o.size ?? 130, pitch * .62);
  const labelW = o.labelW ?? Math.min(240, ring ? 220 : pitch - 28);
  stages.forEach((st, i) => {
    const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
    const x = ring ? cx + r * Math.cos(ang) : (n > 1 ? x0 + i * pitch : cx), y = ring ? cy + r * Math.sin(ang) : cy;
    const z = ORGANISM_SIZE[st.kind] || ORGANISM_SIZE.seed; const sc = Math.min(size / z.w, size / z.h, 1.6) * (o.relative === false ? 1 : (ORGANISM_REL[st.kind] || 1));
    const base = y + z.h * sc / 2 - (z.below || 0) * sc / 2;
    const s = st.s ?? s0 + i;
    const el = organism(top, st.kind, x - (ORG_CX[st.kind] || 0) * sc, base, sc, { s, cls: 'pop' });
    // label goes outward from the ring (below in a line), so arcs never cross it
    const c = ring ? Math.cos(ang) : 0, sn = ring ? Math.sin(ang) : 1;
    let lx = x, ly, anchor = 'middle';
    const tb = textBlock(top, 0, 0, st.label || '', { cls: 'ts-label', maxW: labelW, maxLines: 2, lh: 32, anchor: 'middle', edit: st.edit, a: { s, cls: 'rise', delay: 200 } });
    if (ring && Math.abs(c) > .45) { anchor = c > 0 ? 'start' : 'end'; lx = x + (c > 0 ? 1 : -1) * (size / 2 + 16); ly = y - tb.h / 2 + 24; }
    else if (sn < 0) ly = y - size / 2 - 14 - tb.h + 24; else ly = y + size / 2 + 34;
    tb.el.setAttribute('text-anchor', anchor); tb.el.setAttribute('x', lx); tb.el.setAttribute('y', ly);
    for (const ts of tb.el.querySelectorAll('tspan')) ts.setAttribute('x', lx);
    const lb = { x: anchor === 'start' ? lx : anchor === 'end' ? lx - tb.w : lx - tb.w / 2, y: ly - 24, w: tb.w, h: tb.h };
    if (lb.x < GRID.left - 8 || lb.x + lb.w > GRID.right + 8 || lb.y < GRID.top - 8 || lb.y + lb.h > GRID.bottom + 8) ctx && ctx.warn(`cycleRing: label "${st.label}" leaves the stage`);
    slots.push({ x, y, ang, size, s, el, label: tb, box: { x: x - size / 2, y: y - size / 2, w: size, h: size }, labelBox: lb });
  });
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) if (overlaps(slots[i].labelBox, slots[j].labelBox, 8)) ctx && ctx.warn('cycleRing: stage labels collide, use a bigger ring or shorter words');
  const trim = size * .62;
  const link = (i, j, s, last) => {
    const A = slots[i], Bs = slots[j];
    if (ring) {
      let a0 = A.ang + trim / r, a1 = (j === 0 ? Bs.ang + 2 * Math.PI : Bs.ang) - trim / r; if (a1 <= a0) return;
      const ex = cx + r * Math.cos(a1), ey = cy + r * Math.sin(a1); const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${(cx + r * Math.cos(a0)).toFixed(1)} ${(cy + r * Math.sin(a0)).toFixed(1)} A${r} ${r} 0 ${large} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      arrow(ctx, under, d, ex, ey, a1 + Math.PI / 2, col, 'var(--sw-arrow)', { draw: s, delay: 100, k: .9 });
    } else if (!last) {
      line(ctx, under, A.x + size / 2 + 8, A.y, Bs.x - size / 2 - 8, Bs.y, col, 'var(--sw-arrow)', { draw: s, delay: 100, k: .9 });
    } else {
      const yb = Math.max(...slots.map(q => q.labelBox.y + q.labelBox.h)) + 30;
      const ya = A.labelBox.y + A.labelBox.h + 10, ye = Bs.labelBox.y + Bs.labelBox.h + 10 + ctx.tk.head * .9;
      const pts = `M${A.x} ${ya} C ${A.x} ${yb}, ${A.x} ${yb}, ${A.x - 40} ${yb} L ${Bs.x + 40} ${yb} C ${Bs.x} ${yb}, ${Bs.x} ${yb}, ${Bs.x} ${ye}`;
      arrow(ctx, under, pts, Bs.x, ye, -Math.PI / 2, col, 'var(--sw-arrow)', { draw: s, delay: 100, k: .9 });
      if (yb > GRID.bottom) ctx && ctx.warn('cycleRing: the return arrow leaves the stage');
    }
  };
  for (let i = 1; i < n; i++) link(i - 1, i, slots[i].s, false);
  const closeS = s0 + n;
  if (close && n > 1) link(n - 1, 0, closeS, true);
  return { g, slots, closeS };
}

/* ================================================================== bodyOutline */
const LMK = {
  // fractions of height from the top of the head; widths are fractions of height
  adult: { headB: .133, shoulder: .175, chest: .25, waist: .40, crotch: .50, wrist: .49, knee: .72, ankle: .96, sh: .125, wa: .085, hip: .10, hx: .055, arm: .042, leg: .06 },
  child: { headB: .167, shoulder: .205, chest: .28, waist: .42, crotch: .53, wrist: .50, knee: .74, ankle: .96, sh: .12, wa: .095, hip: .10, hx: .07, arm: .045, leg: .062 },
};
export function bodyOutline(p, o = {}) {
  const age = o.age === 'adult' ? 'adult' : 'child', L = LMK[age]; const Hh = o.height ?? 480, cx = o.x ?? W / 2, top = o.top ?? GRID.top + 10;
  const Y = f => top + f * Hh, X = f => cx + f * Hh;
  const g = h('g', o.a || {}, p);
  const fill = o.fill === 'plain' ? 'var(--paper)' : 'var(--person-1)';
  const st = o.fill === 'plain' ? { stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)' } : { cls: B };
  const sh = L.sh, wa = L.wa, hp = L.hip;
  // legs and arms first, torso over them, head on top
  for (const sgn of [-1, 1]) {
    const lx = sgn * (hp - L.leg / 2 - .004);
    h('rect', Object.assign({ x: X(lx - L.leg / 2), y: Y(L.crotch - .04), width: L.leg * Hh, height: (L.ankle - L.crotch + .05) * Hh, rx: L.leg * Hh * .4, fill }, st), g);
    h('rect', Object.assign({ x: X(sgn > 0 ? lx - L.leg / 2 : lx - L.leg / 2 - .025), y: Y(L.ankle - .012), width: (L.leg + .025) * Hh, height: (1 - L.ankle + .012) * Hh, rx: (1 - L.ankle) * Hh * .5, fill }, st), g);
    const ax = sgn * (sh + L.arm / 2 - .01);
    h('path', Object.assign({ d: `M${X(sgn * (sh - .03))} ${Y(L.shoulder + .01)} Q ${X(ax + sgn * .02)} ${Y(L.shoulder)} ${X(ax + sgn * .012)} ${Y(L.shoulder + .06)} L ${X(ax + sgn * .03)} ${Y(L.wrist)} Q ${X(ax + sgn * .02)} ${Y(L.wrist + .055)} ${X(ax - sgn * .005)} ${Y(L.wrist + .03)} L ${X(ax - sgn * L.arm * .9)} ${Y(L.shoulder + .07)} Z`, fill }, st), g);
  }
  h('path', Object.assign({ d: `M${X(-sh)} ${Y(L.shoulder + .02)} Q ${X(-sh)} ${Y(L.shoulder)} ${X(-sh + .03)} ${Y(L.shoulder)} L ${X(sh - .03)} ${Y(L.shoulder)} Q ${X(sh)} ${Y(L.shoulder)} ${X(sh)} ${Y(L.shoulder + .02)} L ${X(wa)} ${Y(L.waist)} L ${X(hp)} ${Y(L.crotch - .02)} L ${X(hp)} ${Y(L.crotch + .02)} L ${X(-hp)} ${Y(L.crotch + .02)} L ${X(-hp)} ${Y(L.crotch - .02)} L ${X(-wa)} ${Y(L.waist)} Z`, fill }, st), g);
  h('rect', Object.assign({ x: X(-L.hx * .38), y: Y(L.headB - .01), width: L.hx * .76 * Hh, height: (L.shoulder - L.headB + .02) * Hh, fill }, st), g);
  h('ellipse', Object.assign({ cx, cy: Y(L.headB / 2), rx: L.hx * Hh, ry: L.headB / 2 * Hh, fill }, st), g);
  const sY = Y(L.shoulder), wY = Y(L.waist), cY = Y(L.crotch), T0 = wY - sY, hb = L.headB * Hh;
  const S = (fx, y) => ({ x: X(fx), y });
  const slots = {
    brain: S(0, top + hb * .3), eyes: S(0, top + hb * .48), nose: S(0, top + hb * .64), mouth: S(0, top + hb * .8), tongue: S(0, top + hb * .82),
    rightEar: S(-L.hx, top + hb * .52), leftEar: S(L.hx, top + hb * .52),
    oesophagus: S(0, Y(L.headB) + (sY - Y(L.headB)) * .6), throat: S(0, Y(L.headB) + (sY - Y(L.headB)) * .5),
    rightLung: S(-sh * .45, sY + T0 * .36), leftLung: S(sh * .45, sY + T0 * .36), lungs: S(0, sY + T0 * .36),
    heart: S(sh * .14, sY + T0 * .44), liver: S(-sh * .3, sY + T0 * .68), stomach: S(sh * .3, sY + T0 * .72),
    rightKidney: S(-wa * .5, wY - .02 * Hh), leftKidney: S(wa * .5, wY - .02 * Hh),
    smallIntestine: S(0, wY + (cY - wY) * .55), largeIntestine: S(0, wY + (cY - wY) * .5), bladder: S(0, cY - .015 * Hh),
    skull: S(0, top + hb * .4), ribs: S(0, sY + T0 * .4), spine: S(0, sY + T0 * .5), pelvis: S(0, cY - .03 * Hh),
    rightShoulder: S(-sh + .01, sY + .012 * Hh), leftShoulder: S(sh - .01, sY + .012 * Hh),
    rightElbow: S(-(sh + .03), Y((L.shoulder + L.wrist) / 2)), leftElbow: S(sh + .03, Y((L.shoulder + L.wrist) / 2)),
    rightHand: S(-(sh + .045), Y(L.wrist + .03)), leftHand: S(sh + .045, Y(L.wrist + .03)),
    rightHip: S(-hp * .6, cY - .03 * Hh), leftHip: S(hp * .6, cY - .03 * Hh),
    rightKnee: S(-(hp - L.leg / 2), Y(L.knee)), leftKnee: S(hp - L.leg / 2, Y(L.knee)),
    rightFoot: S(-(hp - L.leg / 2), Y(.985)), leftFoot: S(hp - L.leg / 2, Y(.985)),
  };
  // food journey: mouth, oesophagus, stomach, small intestine (coils), large intestine (frame)
  const si = slots.smallIntestine, st0 = slots.stomach, li = slots.largeIntestine, fw = (wa * .62) * Hh, fh = (cY - wY) * .8;
  const pts = [[slots.mouth.x, slots.mouth.y], [cx, sY], [cx + .01 * Hh, sY + T0 * .6], [st0.x, st0.y], [st0.x - .02 * Hh, st0.y + .03 * Hh],
    [si.x + fw * .5, si.y - fh * .25], [si.x - fw * .5, si.y - fh * .15], [si.x + fw * .5, si.y], [si.x - fw * .5, si.y + fh * .15], [si.x - fw * .9, si.y + fh * .35],
    [li.x - fw * 1.25, li.y + fh * .45], [li.x - fw * 1.25, li.y - fh * .55], [li.x + fw * 1.25, li.y - fh * .55], [li.x + fw * 1.25, li.y + fh * .4], [li.x + fw * .2, li.y + fh * .55], [li.x, cY + .01 * Hh]];
  const journey = { pts, at: { mouth: 0, oesophagus: 1, stomach: 3, smallIntestine: 5, largeIntestine: 10, end: 15 } };
  return { g, H: Hh, age, L, top, cx, slots, journey };
}
export const ORGAN_NAMES = ['brain', 'lungs', 'heart', 'oesophagus', 'stomach', 'liver', 'smallIntestine', 'largeIntestine', 'kidneys', 'bladder'];
/** Flat organ in its true slot, sized from the body's height. */
export function organ(p, body, name, a = {}) {
  const g = h('g', a, p); const S = body.slots, k = body.H / 480, L = body.L, Hh = body.H;
  const sw = (n) => ({ fill: 'none', 'stroke-width': n * k, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  let box;
  if (name === 'brain') { const b = S.brain; h('ellipse', { cx: b.x, cy: b.y, rx: L.hx * Hh * .72, ry: L.headB * Hh * .24, fill: 'var(--ear)', cls: B }, g); h('path', { d: `M${b.x} ${b.y - L.headB * Hh * .22} V ${b.y + L.headB * Hh * .2}`, stroke: 'var(--berry-shade)', 'stroke-width': 'var(--sw-rule)' }, g); box = { x: b.x - L.hx * Hh * .72, y: b.y - L.headB * Hh * .24, w: L.hx * Hh * 1.44, h: L.headB * Hh * .48 }; }
  else if (name === 'lungs') { for (const q of [S.rightLung, S.leftLung]) h('ellipse', { cx: q.x, cy: q.y, rx: 20 * k, ry: 36 * k, fill: 'var(--ear)', cls: B }, g); box = { x: S.rightLung.x - 20 * k, y: S.lungs.y - 36 * k, w: S.leftLung.x - S.rightLung.x + 40 * k, h: 72 * k }; }
  else if (name === 'heart') { const q = S.heart; h('path', { d: `M${q.x} ${q.y + 18 * k} C ${q.x - 22 * k} ${q.y} ${q.x - 18 * k} ${q.y - 18 * k} ${q.x - 6 * k} ${q.y - 16 * k} C ${q.x} ${q.y - 15 * k} ${q.x + 2 * k} ${q.y - 10 * k} ${q.x + 2 * k} ${q.y - 8 * k} C ${q.x + 6 * k} ${q.y - 20 * k} ${q.x + 22 * k} ${q.y - 14 * k} ${q.x + 18 * k} ${q.y} C ${q.x + 14 * k} ${q.y + 10 * k} ${q.x + 6 * k} ${q.y + 14 * k} ${q.x} ${q.y + 18 * k} Z`, fill: 'var(--berry)', cls: B }, g); box = { x: q.x - 20 * k, y: q.y - 18 * k, w: 40 * k, h: 36 * k }; }
  else if (name === 'oesophagus') { const m = S.mouth, s = S.stomach; h('path', Object.assign({ d: `M${m.x} ${m.y + 8 * k} L ${body.cx} ${S.lungs.y} Q ${body.cx + 2 * k} ${s.y - 30 * k} ${s.x - 14 * k} ${s.y - 16 * k}`, stroke: 'var(--ear)' }, sw(9)), g); box = { x: body.cx - 6 * k, y: m.y, w: s.x - body.cx, h: s.y - m.y }; }
  else if (name === 'stomach') { const q = S.stomach; h('path', { d: `M${q.x - 16 * k} ${q.y - 20 * k} C ${q.x + 6 * k} ${q.y - 30 * k} ${q.x + 28 * k} ${q.y - 16 * k} ${q.x + 22 * k} ${q.y + 6 * k} C ${q.x + 16 * k} ${q.y + 26 * k} ${q.x - 14 * k} ${q.y + 26 * k} ${q.x - 22 * k} ${q.y + 14 * k} C ${q.x - 10 * k} ${q.y + 8 * k} ${q.x - 4 * k} ${q.y - 4 * k} ${q.x - 16 * k} ${q.y - 20 * k} Z`, fill: 'var(--ear)', cls: B }, g); box = { x: q.x - 22 * k, y: q.y - 28 * k, w: 46 * k, h: 52 * k }; }
  else if (name === 'liver') { const q = S.liver; h('path', { d: `M${q.x - 30 * k} ${q.y - 12 * k} C ${q.x - 10 * k} ${q.y - 24 * k} ${q.x + 26 * k} ${q.y - 22 * k} ${q.x + 34 * k} ${q.y - 12 * k} C ${q.x + 20 * k} ${q.y + 4 * k} ${q.x - 6 * k} ${q.y + 18 * k} ${q.x - 24 * k} ${q.y + 14 * k} Z`, fill: 'var(--berry-shade)', cls: B }, g); box = { x: q.x - 30 * k, y: q.y - 24 * k, w: 64 * k, h: 42 * k }; }
  else if (name === 'smallIntestine') { const P = body.journey.pts.slice(body.journey.at.smallIntestine, body.journey.at.largeIntestine); let d = `M${P[0][0]} ${P[0][1]}`; for (let i = 1; i < P.length; i++) d += ` Q ${(P[i - 1][0] + P[i][0]) / 2 + (i % 2 ? 1 : -1) * 6 * k} ${(P[i - 1][1] + P[i][1]) / 2 - 10 * k} ${P[i][0]} ${P[i][1]}`; h('path', Object.assign({ d, stroke: 'var(--ear)' }, sw(10)), g); const xs = P.map(q => q[0]), ys = P.map(q => q[1]); box = { x: Math.min(...xs) - 7 * k, y: Math.min(...ys) - 7 * k, w: Math.max(...xs) - Math.min(...xs) + 14 * k, h: Math.max(...ys) - Math.min(...ys) + 14 * k }; }
  else if (name === 'largeIntestine') { const P = body.journey.pts.slice(body.journey.at.largeIntestine); h('path', Object.assign({ d: 'M' + P.map(q => q.join(' ')).join(' L '), stroke: 'var(--daub-shade)' }, sw(13)), g); const xs = P.map(q => q[0]), ys = P.map(q => q[1]); box = { x: Math.min(...xs) - 10 * k, y: Math.min(...ys) - 10 * k, w: Math.max(...xs) - Math.min(...xs) + 20 * k, h: Math.max(...ys) - Math.min(...ys) + 20 * k }; }
  else if (name === 'kidneys') { for (const [q, sg] of [[S.rightKidney, -1], [S.leftKidney, 1]]) h('ellipse', { cx: q.x + sg * 6 * k, cy: q.y, rx: 7 * k, ry: 12 * k, fill: 'var(--berry-shade)', cls: B }, g); box = { x: S.rightKidney.x - 15 * k, y: S.rightKidney.y - 15 * k, w: S.leftKidney.x - S.rightKidney.x + 30 * k, h: 30 * k }; }
  else if (name === 'bladder') { const q = S.bladder; h('ellipse', { cx: q.x, cy: q.y, rx: 14 * k, ry: 11 * k, fill: 'var(--water-hi)', cls: B }, g); box = { x: q.x - 14 * k, y: q.y - 11 * k, w: 28 * k, h: 22 * k }; }
  g.box = box; return g;
}

/* ================================================================== branchTree */
export function branchTree(p, root, o = {}) {
  const { ctx, s0 = 0, a = {} } = o; const x0 = o.x0 ?? GRID.left, x1 = o.x1 ?? GRID.right, y0 = o.y0 ?? GRID.top + 10, y1 = o.y1 ?? GRID.bottom;
  const g = h('g', a, p); const under = h('g', {}, g), top = h('g', {}, g); const nodes = [];
  const isLeaf = n => !n.yes && !n.no; const count = n => isLeaf(n) ? 1 : count(n.yes) + count(n.no);
  const depthOf = n => isLeaf(n) ? 0 : 1 + Math.max(depthOf(n.yes), depthOf(n.no)); const D = depthOf(root);
  const leafN = count(root), pitch = (x1 - x0) / leafN;
  const qW = c => Math.min(o.cardW ?? 300, Math.max(140, c * pitch - 28));
  let li = 0;
  const lay = (n, d, s) => {
    const leaf = isLeaf(n); const sOwn = n.s ?? s;
    if (leaf) { const rec = { node: n, depth: d, x: x0 + (li++ + .5) * pitch, leaf: true, s: sOwn }; nodes.push(rec); return rec; }
    const ya = lay(n.yes, d + 1, s0 + d + 1), no = lay(n.no, d + 1, s0 + d + 1);
    const rec = { node: n, depth: d, x: (ya.x + no.x) / 2, leaf: false, s: sOwn, kids: [ya, no], span: count(n) }; nodes.push(rec); return rec;
  };
  lay(root, 0, s0);
  // pass 1: measure every card (questions on paper cards, leaves as names plus an optional organism)
  for (const r of nodes) {
    const w = r.leaf ? Math.min(220, pitch - 24) : qW(r.span);
    r.label = textBlock(top, r.x, 0, r.leaf ? (r.node.label || '') : (r.node.q || ''), { cls: r.leaf ? 'ts-label' : 'ts-small', maxW: w - 28, maxLines: r.leaf ? 2 : 3, lh: r.leaf ? 32 : 28, anchor: 'middle', edit: r.node.edit, a: r.leaf ? {} : { cls: 'strong' } });
    r.icon = r.leaf && r.node.kind ? Math.min(64, pitch * .5) : 0;
    r.ch = r.label.h + 24 + (r.icon ? r.icon + 10 : 0); r.cw = Math.max(r.label.w + 28, r.leaf ? 0 : 140);
  }
  // pass 2: leaves share the bottom row; question rows share the space above it
  const leafH = Math.max(...nodes.filter(r => r.leaf).map(r => r.ch)), qH = Math.max(0, ...nodes.filter(r => !r.leaf).map(r => r.ch));
  const rowH = D > 1 ? (y1 - leafH - 76 - qH - y0) / (D - 1) : 0;
  if (D > 1 && rowH < qH + 76) ctx && ctx.warn('branchTree: too many questions deep for one slide');
  for (const r of nodes) {
    const yTop = r.leaf ? y1 - r.ch : y0 + r.depth * rowH; r.y = yTop;
    r.box = { x: r.x - r.cw / 2, y: yTop, w: r.cw, h: r.ch };
    const cg = h('g', { s: r.s, cls: r.leaf ? 'pop' : 'rise' }, top);
    h('rect', { x: r.box.x, y: r.box.y, width: r.cw, height: r.ch, rx: 'var(--r-card)', fill: r.leaf ? 'var(--bg)' : 'var(--paper)', stroke: r.leaf ? 'var(--rule)' : 'var(--ink-3)', 'stroke-width': r.leaf ? 'var(--sw-hair)' : 'var(--sw-rule)', cls: r.leaf ? null : 'lift' }, cg);
    if (r.icon) { const z = ORGANISM_SIZE[r.node.kind]; const sc = Math.min(r.icon / z.w, r.icon / z.h); organism(cg, r.node.kind, r.x - (ORG_CX[r.node.kind] || 0) * sc, yTop + 12 + r.icon - (r.icon - z.h * sc) / 2, sc); }
    const ty = yTop + 12 + (r.icon ? r.icon + 10 : 0) + 24;
    r.label.el.setAttribute('x', r.x); r.label.el.setAttribute('y', ty); for (const ts of r.label.el.querySelectorAll('tspan')) ts.setAttribute('x', r.x);
    cg.appendChild(r.label.el);
    if (r.box.x < x0 - 12 || r.box.x + r.box.w > x1 + 12) ctx && ctx.warn(`branchTree: "${(r.node.q || r.node.label || '').slice(0, 30)}" is too wide for its branch`);
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (overlaps(nodes[i].box, nodes[j].box, 6)) ctx && ctx.warn('branchTree: cards collide, shorten a question or use fewer items');
  // edges: elbow lines that end at card edges; yes/no labels sit beside the drop, never on it
  const yesL = o.yesLabel ?? 'Yes', noL = o.noLabel ?? 'No';
  for (const r of nodes) if (!r.leaf) r.kids.forEach((kid, i) => {
    const yA = r.box.y + r.box.h, yB = kid.box.y, ym = yA + Math.min(26, (yB - yA) * .3);
    h('path', { d: `M${r.x} ${yA} V ${ym} H ${kid.x} V ${yB}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', s: kid.s, cls: 'draw', pathLength: 1 }, under);
    const side = kid.x < r.x ? -1 : 1, word = i === 0 ? yesL : noL;
    const t = h('text', { x: kid.x - side * 12, y: Math.min(ym + 34, yB - 8), 'text-anchor': side < 0 ? 'start' : 'end', cls: 'ts-tiny strong', fill: i === 0 ? 'var(--compare-text)' : 'var(--event-text)', text: word, s: kid.s, delay: 300 }, top);
    editable(t, i === 0 ? o.yesEdit : o.noEdit);
    if (yB - ym < 40) ctx && ctx.warn('branchTree: rows too close for yes/no labels');
  });
  return { g, nodes, leaves: nodes.filter(r => r.leaf), depth: D };
}

/* ================================================================== habitats */
export const HABITATS = ['pond', 'woodland', 'ocean', 'polar', 'desert', 'savannah', 'field'];
const HO = {
  reeds(g) { for (const [x, hh, f] of [[-14, 70, 'var(--life-shade)'], [-4, 92, 'var(--leaf)'], [6, 80, 'var(--life-shade)'], [16, 62, 'var(--leaf)']]) { h('path', { d: `M${x - 3} 0 Q ${x} ${-hh * .5} ${x + 2} ${-hh} Q ${x + 4} ${-hh * .5} ${x + 3} 0 Z`, fill: f }, g); } h('rect', { x: -7, y: -78, width: 7, height: 22, rx: 3.5, fill: 'var(--trunk)' }, g); },
  lilypad(g) { h('path', { d: 'M0 -6 L 30 -10 A30 9 0 1 1 26 -14 Z', fill: 'var(--leaf)', cls: B }, g); h('path', { d: 'M-30 -6 A30 9 0 0 0 30 -6 A30 5 0 0 1 -30 -6 Z', fill: 'var(--life-shade)' }, g); },
  log(g) { h('rect', { x: -70, y: -34, width: 140, height: 34, rx: 17, fill: 'var(--trunk)', cls: B }, g); h('rect', { x: -70, y: -14, width: 140, height: 14, rx: 7, fill: 'var(--soil-deep)' }, g); h('ellipse', { cx: 70, cy: -17, rx: 10, ry: 17, fill: 'var(--wood-2)', cls: B }, g); h('ellipse', { cx: 70, cy: -17, rx: 4, ry: 8, fill: 'none', stroke: 'var(--wood-line)', 'stroke-width': 2 }, g); },
  rock(g) { h('path', { d: 'M-34 0 C -36 -20 -18 -34 2 -32 C 24 -30 36 -16 34 0 Z', fill: 'var(--stone)', cls: B }, g); h('path', { d: 'M2 -32 C 24 -30 36 -16 34 0 L 10 0 C 16 -12 12 -24 2 -32 Z', fill: 'var(--stone-shade)' }, g); },
  seaweed(g) { for (const [x, hh] of [[-10, 90], [4, 120], [16, 74]]) h('path', { d: `M${x} 0 C ${x - 14} ${-hh * .3} ${x + 14} ${-hh * .6} ${x} ${-hh}`, fill: 'none', stroke: 'var(--life-shade)', 'stroke-width': 8, 'stroke-linecap': 'round' }, g); },
  acacia(g) { h('path', { d: 'M-4 0 L -2 -60 L -26 -88 M-2 -60 L 20 -92', fill: 'none', stroke: 'var(--trunk)', 'stroke-width': 8, 'stroke-linecap': 'round' }, g); h('ellipse', { cx: -2, cy: -96, rx: 66, ry: 16, fill: 'var(--canopy)', cls: B }, g); h('path', { d: 'M-68 -96 A66 16 0 0 0 64 -96 A66 8 0 0 1 -68 -96 Z', fill: 'var(--canopy-shade)' }, g); },
  hedge(g) { h('path', { d: 'M-90 0 C -96 -40 -60 -54 -40 -46 C -26 -64 6 -62 14 -48 C 34 -62 70 -56 74 -36 C 92 -34 96 -10 90 0 Z', fill: 'var(--hill-mid)', cls: B }, g); h('path', { d: 'M-90 0 C -84 -16 -20 -20 90 0 Z', fill: 'var(--hill-shade)' }, g); },
  tree(g) { object(g, 'tree', 0, 0, 1.6); },
  floe(g) { h('polygon', { points: '-60,0 -50,-14 46,-14 62,0', fill: 'var(--ice-top)', cls: B }, g); h('polygon', { points: '-60,0 62,0 54,8 -54,8', fill: 'var(--ice-side)' }, g); },
};
const HO_SIZE = { reeds: [40, 96], lilypad: [62, 16], log: [160, 36], rock: [70, 34], seaweed: [44, 122], acacia: [140, 112], hedge: [190, 64], tree: [90, 130], floe: [126, 22] };
/** Which habitat each scenery object honestly belongs to. */
export const HABITAT_OBJECTS = {
  reeds: ['pond'], lilypad: ['pond'], log: ['woodland'], rock: ['ocean', 'desert', 'polar', 'field'],
  seaweed: ['ocean'], acacia: ['savannah'], hedge: ['field'], tree: ['woodland', 'field'], floe: ['polar'],
};
export const habitatScenery = kind => Object.keys(HABITAT_OBJECTS).filter(k => HABITAT_OBJECTS[k].includes(kind));
export function habitatObject(p, key, x, y, s = 1, a = {}) {
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer); (HO[key] || HO.rock)(g);
  const [w, hh] = HO_SIZE[key] || [60, 40]; outer.box = { x: x - w * s / 2, y: y - hh * s, w: w * s, h: hh * s + 8 * s }; return outer;
}
// object spots per habitat: [key, x, y, s]; drawn far to near
const SPOTS = {
  woodland: [['tree', 150, 470, .9], ['tree', 330, 452, .75], ['tree', 980, 456, .8], ['tree', 1150, 474, 1], ['log', 760, 600, 1.1], ['rock', 470, 610, .8]],
  pond: [['reeds', 250, 520, 1.1], ['reeds', 1010, 520, 1], ['reeds', 1070, 540, .8], ['lilypad', 560, 560, 1], ['lilypad', 700, 590, .8]],
  ocean: [['seaweed', 140, 640, 1.1], ['rock', 260, 640, 1.2], ['seaweed', 1090, 640, 1], ['rock', 1180, 640, .9]],
  polar: [['floe', 250, 400, 1], ['floe', 980, 396, .8], ['rock', 1120, 610, .8]],
  desert: [['rock', 300, 590, 1.1], ['rock', 1010, 620, .8]],
  savannah: [['acacia', 220, 470, 1], ['acacia', 1060, 460, .8]],
  field: [['hedge', 210, 452, 1], ['tree', 1090, 456, .9], ['hedge', 820, 448, .8]],
};
export function habitat(p, kind, o = {}) {
  const { ctx, seed = 3, avoid = [], a = {} } = o; const g = h('g', a, p); const F = GRID.foot; let water0 = null;
  const R = { pond: 400, woodland: 410, ocean: 230, polar: 360, desert: 380, savannah: 400, field: 400 }; const hz = R[kind] ?? 400;
  sky(g, ctx, hz + 60);
  if (kind === 'ocean') {
    water(g, 0, W, hz, F);
    h('path', { d: `M0 ${F - 40} C 300 ${F - 70} 600 ${F - 30} 900 ${F - 56} S 1200 ${F - 50} ${W} ${F - 60} V ${F} H 0 Z`, fill: 'var(--sand)' }, g);
    water0 = { x: 0, y: hz, w: W, h: F - hz - 60 };
  } else if (kind === 'polar') {
    h('rect', { x: 0, y: hz, width: W, height: 70, fill: 'var(--sea-2)' }, g);
    hills(g, { yBase: hz + 2, amp: 50, fill: 'var(--snow-shade)', seed, bumps: 3 });
    h('path', { d: `M0 ${hz + 64} C 300 ${hz + 52} 700 ${hz + 74} ${W} ${hz + 58} V ${F} H 0 Z`, fill: 'var(--snow)' }, g);
    h('path', { d: `M0 ${hz + 64} C 300 ${hz + 52} 700 ${hz + 74} ${W} ${hz + 58} V ${hz + 78} C 700 ${hz + 92} 300 ${hz + 72} 0 ${hz + 84} Z`, fill: 'var(--snow-shade)' }, g);
    water0 = { x: 0, y: hz, w: W, h: 60 };
  } else if (kind === 'desert') {
    hills(g, { yBase: hz + 20, amp: 70, fill: 'var(--sand-far)', seed, bumps: 3 }); ground(g, 0, W, hz + 18, hz + 92, 'var(--sand-far)');
    hills(g, { yBase: hz + 90, amp: 80, fill: 'var(--sand)', seed: seed + 1, bumps: 2 }); ground(g, 0, W, hz + 88, F, 'var(--sand)');
    hills(g, { yBase: F, amp: 90, fill: 'var(--sand-shade)', seed: seed + 2, bumps: 2, a: { opacity: .35 } });
  } else if (kind === 'savannah') {
    hills(g, { yBase: hz + 10, amp: 30, fill: 'var(--hill-far)', seed, bumps: 5 }); ground(g, 0, W, hz, F, 'var(--field)');
  } else {
    hills(g, { yBase: hz + 10, amp: 60, fill: 'var(--hill-far)', seed, bumps: 4 }); ground(g, 0, W, hz + 8, hz + 62, 'var(--hill-far)');
    hills(g, { yBase: hz + 60, amp: 50, fill: 'var(--hill-mid)', seed: seed + 1, bumps: 3 });
    ground(g, 0, W, hz + 56, F, 'var(--hill-near)');
    if (kind === 'woodland') { const r = rng(seed + 9); for (let i = 0; i < 9; i++) { const x = 60 + i * 140 + r() * 50; h('ellipse', { cx: x, cy: 560 + (i % 3) * 30, rx: 40, ry: 7, fill: 'var(--soil)', opacity: .5 }, g); } }
    if (kind === 'pond') {
      h('ellipse', { cx: W / 2 + 20, cy: 568, rx: 470, ry: 74, fill: 'var(--sea-1)' }, g);
      h('ellipse', { cx: W / 2 + 20, cy: 574, rx: 400, ry: 52, fill: 'var(--sea-2)' }, g);
      water0 = { x: W / 2 + 20 - 400, y: 530, w: 800, h: 90 };
    }
  }
  const placed = [];
  if (o.objects !== false) {
    const fit = habitatScenery(kind);
    for (const [key, x, y, s] of SPOTS[kind] || []) {
      if (!fit.includes(key)) continue;
      const [w, hh] = HO_SIZE[key]; const box = { x: x - w * s / 2, y: y - hh * s, w: w * s, h: hh * s };
      if (avoid.some(b => overlaps(box, b, 12))) continue;
      const el = habitatObject(g, key, x, y, s); placed.push({ key, box: el.box, el });
    }
  }
  return { g, horizon: hz, groundY: kind === 'ocean' ? F - 50 : hz + 60, water: water0, placed };
}

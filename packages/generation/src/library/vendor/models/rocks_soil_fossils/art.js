// Model-private art for rocks_soil_fossils: fossil organisms (soft parts and hard parts drawn
// separately, so the soft parts can rot away and the hard parts can turn to stone) and rock
// specimens with a texture per rock. Flat fills from tokens only; no text here.
import { ROCKS as ROCK_FACTS } from '../../kit/facts.js'; // libdata
import { h, rng } from '../../kit/index.js';

/* ------------------------------------------------------------------ organisms */
// Each kind is drawn centred on (0,0), lying on its side, facing left. w,h = nominal box.
// range = [youngest, oldest] fossil age in millions of years (when the animal lived).
export const ORGS = {
  ammonite: { w: 160, h: 130, name: 'Ammonite', plural: 'Ammonites', hard: 'shell', range: [66, 400], water: 'sea' },
  ichthyosaur: { w: 340, h: 84, name: 'Ichthyosaur', plural: 'Ichthyosaurs', hard: 'bones', range: [90, 250], water: 'sea' },
  fish: { w: 220, h: 80, name: 'Fish', plural: 'Fish', hard: 'bones', range: [1, 500], water: 'sea' },
  trilobite: { w: 140, h: 96, name: 'Trilobite', plural: 'Trilobites', hard: 'hard shell', range: [252, 521], water: 'sea' },
  dinosaur: { w: 340, h: 100, name: 'Dinosaur', plural: 'Dinosaurs', hard: 'bones', range: [66, 233], water: 'river' },
  shell: { w: 104, h: 84, name: 'Shellfish', plural: 'Shellfish', hard: 'shell', range: [1, 540], water: 'sea' },
};

const st = (col, w = 'var(--sw-struct)') => ({ fill: 'none', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });

/** part 'soft' (flesh, fades away) or 'hard' (bones or shell). col = main fill, line = detail colour. */
export function drawOrg(p, kind, part, col, line, edge, edgeW = 'var(--sw-hair)') {
  const g = h('g', edge ? { stroke: edge, 'stroke-width': edgeW, 'stroke-linejoin': 'round' } : {}, p);
  const F = (d, a = {}) => h('path', Object.assign({ d, fill: col }, a), g);
  const S = (d, w) => h('path', Object.assign({ d }, st(line, w)), g);
  if (kind === 'ichthyosaur') {
    if (part === 'soft') {
      F('M-170 4 C-150 0 -120 -6 -100 -12 C-70 -30 0 -34 70 -18 C95 -12 115 -6 128 -4 L158 -40 L150 -2 L166 36 L128 6 C100 12 60 22 10 24 C-40 26 -80 18 -100 12 C-125 9 -150 8 -170 4 Z');
      F('M-10 -29 L12 -42 L30 -27 Z');
      h('ellipse', { cx: -66, cy: 24, rx: 28, ry: 9, transform: 'rotate(28 -66 24)', fill: col }, g);
      h('ellipse', { cx: 42, cy: 22, rx: 17, ry: 6, transform: 'rotate(28 42 22)', fill: col }, g);
      h('circle', { cx: -97, cy: -5, r: 5, fill: line }, g);
    } else {
      F('M-168 4 C-140 -1 -115 -6 -100 -14 C-88 -18 -76 -14 -74 -4 C-74 6 -86 12 -100 12 C-125 9 -150 8 -168 4 Z');
      h('circle', Object.assign({ cx: -94, cy: -3, r: 7 }, st(line, 'var(--sw-hair)')), g);
      for (let x = -66; x <= 150; x += 9) { const y = -7 + (x > 108 ? (x - 108) * .75 : 0); h('rect', { x: x - 3.5, y: y - 5, width: 7, height: 10, rx: 2, fill: col }, g); }
      for (let x = -56; x <= 64; x += 10) S(`M${x} -2 C${x + 4} 6 ${x + 8} 12 ${x + 10} ${19 - Math.abs(x) / 9}`);
      // paddles as solid shapes (a grid of tiny bone dots read as noise)
      h('ellipse', { cx: -66, cy: 24, rx: 24, ry: 8, transform: 'rotate(28 -66 24)', fill: col }, g);
      h('ellipse', { cx: 42, cy: 22, rx: 15, ry: 5.5, transform: 'rotate(28 42 22)', fill: col }, g);
    }
  } else if (kind === 'ammonite') {
    if (part === 'soft') {
      h('ellipse', { cx: -58, cy: 14, rx: 15, ry: 17, fill: col }, g);
      for (let i = 0; i < 6; i++) S(`M-62 ${4 + i * 5} C-74 ${2 + i * 6} -84 ${i * 7} -${92 + (i % 2) * 6} ${-6 + i * 9}`, 'var(--sw-struct)');
      h('circle', { cx: -56, cy: 8, r: 4, fill: line }, g);
    } else {
      h('circle', { cx: 0, cy: 0, r: 62, fill: col }, g);
      let d = ''; for (let t = 0; t <= 5.2 * Math.PI; t += .2) { const r = 6 + t * 3.4; d += (d ? ' L' : 'M') + (r * Math.cos(t)).toFixed(1) + ' ' + (r * Math.sin(t)).toFixed(1); }
      S(d, 'var(--sw-rule)');
      for (let a = 0; a < 360; a += 15) { const t = a * Math.PI / 180; S(`M${(40 * Math.cos(t)).toFixed(1)} ${(40 * Math.sin(t)).toFixed(1)} L${(60 * Math.cos(t)).toFixed(1)} ${(60 * Math.sin(t)).toFixed(1)}`, 'var(--sw-hair)'); }
    }
  } else if (kind === 'fish') {
    if (part === 'soft') {
      F('M-110 0 C-90 -30 30 -36 70 -10 L105 -34 L98 0 L105 34 L70 10 C30 36 -90 30 -110 0 Z');
      F('M-10 -27 L18 -40 L40 -23 Z'); F('M-30 22 L-10 36 L4 22 Z');
      h('circle', { cx: -84, cy: -6, r: 5, fill: line }, g);
    } else {
      F('M-110 0 C-102 -18 -84 -24 -66 -20 L-66 18 C-84 24 -102 18 -110 0 Z');
      h('circle', Object.assign({ cx: -84, cy: -6, r: 6 }, st(line, 'var(--sw-hair)')), g);
      for (let x = -60; x <= 78; x += 8) h('rect', { x: x - 3, y: -4, width: 6, height: 8, rx: 2, fill: col }, g);
      for (let x = -52; x <= 52; x += 9) { const hh = 20 - Math.abs(x) / 5; S(`M${x} -3 L${x + 5} ${-hh}`, 'var(--sw-rule)'); S(`M${x} 3 L${x + 5} ${hh}`, 'var(--sw-rule)'); }
      for (const ty of [-30, -15, 0, 15, 30]) S(`M80 0 L103 ${ty}`, 'var(--sw-rule)');
    }
  } else if (kind === 'trilobite') {
    if (part === 'soft') {
      for (let x = -40; x <= 50; x += 12) { S(`M${x} 34 L${x - 6} 46`, 'var(--sw-rule)'); S(`M${x} -34 L${x - 6} -46`, 'var(--sw-rule)'); }
      S('M-64 -10 C-78 -18 -84 -30 -86 -44', 'var(--sw-rule)'); S('M-64 10 C-78 18 -84 30 -86 44', 'var(--sw-rule)');
      h('ellipse', { cx: 0, cy: 0, rx: 66, ry: 42, fill: col }, g);
    } else {
      h('ellipse', { cx: 0, cy: 0, rx: 64, ry: 40, fill: col }, g);
      S('M-30 -38 C-60 -34 -66 -14 -66 0 C-66 14 -60 34 -30 38', 'var(--sw-rule)');
      h('ellipse', Object.assign({ cx: 4, cy: 0, rx: 58, ry: 12 }, st(line, 'var(--sw-rule)')), g);
      for (let x = -22; x <= 54; x += 9) S(`M${x} ${-Math.sqrt(Math.max(0, 1 - (x / 64) ** 2)) * 38} L${x} ${Math.sqrt(Math.max(0, 1 - (x / 64) ** 2)) * 38}`, 'var(--sw-hair)');
      h('circle', { cx: -44, cy: -14, r: 4, fill: line }, g); h('circle', { cx: -44, cy: 14, r: 4, fill: line }, g);
    }
  } else if (kind === 'dinosaur') {
    if (part === 'soft') {
      F('M-170 -10 C-162 -30 -132 -34 -116 -24 C-100 -14 -82 -24 -60 -30 C-20 -44 40 -40 80 -26 C120 -16 150 -8 170 -4 C150 4 110 6 80 8 C66 10 54 28 46 46 L32 46 L34 16 C10 20 -10 22 -30 18 L-38 46 L-52 46 L-50 14 C-70 8 -100 4 -116 0 C-132 6 -160 8 -170 -10 Z');
      h('circle', { cx: -150, cy: -16, r: 4, fill: line }, g);
    } else {
      F('M-168 -10 C-162 -26 -138 -30 -124 -22 C-118 -14 -120 -4 -128 2 C-144 6 -160 4 -168 -10 Z');
      h('circle', Object.assign({ cx: -148, cy: -14, r: 6 }, st(line, 'var(--sw-hair)')), g);
      const sp = x => x < -60 ? -20 + (x + 116) * -.12 : x < 80 ? -28 + (x + 60) * .06 : -20 + (x - 80) * .17;
      for (let x = -114; x <= 166; x += 9) h('rect', { x: x - 3.5, y: sp(x) - 4, width: 7, height: 8, rx: 2, fill: col }, g);
      for (let x = -50; x <= 50; x += 11) S(`M${x} ${sp(x) + 4} C${x + 4} ${sp(x) + 16} ${x + 6} ${sp(x) + 24} ${x + 8} ${12}`, 'var(--sw-rule)');
      S('M40 -16 L44 18 L38 44 M38 44 L50 46', 'var(--sw-struct)'); S('M-36 -18 L-42 16 L-44 44 M-44 44 L-32 46', 'var(--sw-struct)');
      h('ellipse', { cx: 40, cy: -10, rx: 22, ry: 10, fill: col }, g);
    }
  } else { // shell (a bivalve)
    if (part === 'soft') { h('ellipse', { cx: -36, cy: 34, rx: 20, ry: 8, fill: col }, g); }
    else {
      F('M-50 28 C-54 -14 -24 -40 0 -40 C24 -40 54 -14 50 28 C30 40 -30 40 -50 28 Z');
      for (let a = -48; a <= 48; a += 12) { const t = (a - 90) * Math.PI / 180; S(`M0 34 L${(58 * Math.cos(t)).toFixed(1)} ${(34 + 58 * Math.sin(t)).toFixed(1)}`, 'var(--sw-hair)'); } // ribs stay inside the shell
      F('M-14 34 L14 34 L8 44 L-8 44 Z');
    }
  }
  return g;
}

/* ------------------------------------------------------------------ rocks */
// Named examples: the truth table for "rock types are named correctly". look = texture.
export const ROCKS = {
  granite: { type: 'igneous', look: 'speckled' }, basalt: { type: 'igneous', look: 'dark' }, pumice: { type: 'igneous', look: 'holes' },
  obsidian: { type: 'igneous', look: 'glassy' }, gabbro: { type: 'igneous', look: 'speckled' }, andesite: { type: 'igneous', look: 'dark' },
  diorite: { type: 'igneous', look: 'speckled' }, rhyolite: { type: 'igneous', look: 'dark' }, dolerite: { type: 'igneous', look: 'dark' },
  sandstone: { type: 'sedimentary', look: 'grains' }, limestone: { type: 'sedimentary', look: 'shelly' }, chalk: { type: 'sedimentary', look: 'chalk' },
  mudstone: { type: 'sedimentary', look: 'bands' }, shale: { type: 'sedimentary', look: 'bands' }, siltstone: { type: 'sedimentary', look: 'bands' },
  conglomerate: { type: 'sedimentary', look: 'pebbles' }, breccia: { type: 'sedimentary', look: 'pebbles' }, flint: { type: 'sedimentary', look: 'glassy' },
  coal: { type: 'sedimentary', look: 'dark' }, clay: { type: 'sedimentary', look: 'bands' },
  salt: { type: 'sedimentary', look: 'glassy' }, halite: { type: 'sedimentary', look: 'glassy' }, gypsum: { type: 'sedimentary', look: 'chalk' },
  chert: { type: 'sedimentary', look: 'glassy' }, ironstone: { type: 'sedimentary', look: 'bands' }, jet: { type: 'sedimentary', look: 'dark' },
  gritstone: { type: 'sedimentary', look: 'grains' }, travertine: { type: 'sedimentary', look: 'bands' },
  lava: { type: 'igneous', look: 'dark' }, tuff: { type: 'igneous', look: 'grains' }, scoria: { type: 'igneous', look: 'holes' }, peridotite: { type: 'igneous', look: 'speckled' },
  soapstone: { type: 'metamorphic', look: 'foliated' }, serpentine: { type: 'metamorphic', look: 'veined' }, hornfels: { type: 'metamorphic', look: 'dark' },
  marble: { type: 'metamorphic', look: 'veined' }, slate: { type: 'metamorphic', look: 'slate' }, schist: { type: 'metamorphic', look: 'foliated' },
  gneiss: { type: 'metamorphic', look: 'foliated' }, quartzite: { type: 'metamorphic', look: 'quartzite' },
};
for (const [k, r] of Object.entries(ROCK_FACTS.rows)) if (ROCKS[k]) ROCKS[k].type = r.type; // libdata: BGS rock types
export const TYPE_LOOK = { igneous: 'speckled', sedimentary: 'grains', metamorphic: 'foliated' };
/** The known rock a name refers to ("Pink granite" → granite), or null. */
export function knownRock(name) {
  const words = String(name || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/);
  for (const w of words) if (ROCKS[w]) return w;
  return null;
}

const BASE = {
  speckled: 'var(--marble)', dark: 'var(--stone-shade)', holes: 'var(--marble-shade)', glassy: 'var(--ink-2)', grains: 'var(--sand)',
  shelly: 'var(--marble-shade)', chalk: 'color-mix(in oklab,var(--hue-grey) 14%,var(--cloud))', bands: 'var(--soil)', pebbles: 'var(--sand-shade)', veined: 'var(--marble)',
  slate: 'var(--stone-shade)', foliated: 'var(--stone)', quartzite: 'var(--marble)',
};
/** A rock specimen: an irregular lump with its texture, centred at (x,y), size w×hh. Returns {g, box}. */
export function rockSpecimen(ctx, p, x, y, w, hh, look, seed, a = {}) {
  const g = h('g', a, p); const R = rng(seed * 97 + 13);
  const pts = []; for (let i = 0; i < 11; i++) { const t = i / 11 * Math.PI * 2, k = .86 + R() * .14; pts.push([x + Math.cos(t) * w / 2 * k, y + Math.sin(t) * hh / 2 * k * (Math.sin(t) > 0 ? 1 : .94)]); }
  const d = 'M' + pts.map((q, i) => { const n = pts[(i + 1) % pts.length]; return `${q[0].toFixed(1)} ${q[1].toFixed(1)} Q${q[0].toFixed(1)} ${q[1].toFixed(1)} ${((q[0] + n[0]) / 2).toFixed(1)} ${((q[1] + n[1]) / 2).toFixed(1)}`; }).join(' L') + ' Z';
  const id = `${ctx.uid}-rk${seed}`; const cp = h('clipPath', { id }, h('defs', {}, g)); h('path', { d }, cp);
  h('path', { d, fill: BASE[look] || 'var(--stone)', cls: 'body' }, g);
  const t = h('g', { 'clip-path': `url(#${id})` }, g);
  const x0 = x - w / 2, y0 = y - hh / 2; const rx = () => x0 + R() * w, ry = () => y0 + R() * hh;
  const dot = (n, r0, r1, fill) => { for (let i = 0; i < n; i++) h('circle', { cx: rx(), cy: ry(), r: r0 + R() * (r1 - r0), fill }, t); };
  const chip = (n, s0, s1, fill) => { for (let i = 0; i < n; i++) { const cx = rx(), cy = ry(), s = s0 + R() * (s1 - s0), a0 = R() * 6; h('path', { d: `M${(cx + s * Math.cos(a0)).toFixed(1)} ${(cy + s * Math.sin(a0)).toFixed(1)} L${(cx + s * Math.cos(a0 + 2.2)).toFixed(1)} ${(cy + s * Math.sin(a0 + 2.2)).toFixed(1)} L${(cx + s * .8 * Math.cos(a0 + 4.1)).toFixed(1)} ${(cy + s * .8 * Math.sin(a0 + 4.1)).toFixed(1)} Z`, fill }, t); } };
  const bandsH = (n, col, sw, wav) => { for (let i = 1; i < n; i++) { const yy = y0 + hh * i / n; h('path', Object.assign({ d: `M${x0} ${yy} C${x0 + w * .3} ${yy - wav} ${x0 + w * .6} ${yy + wav} ${x0 + w} ${yy}` }, st(col, sw)), t); } };
  if (look === 'speckled') { chip(70, 2, 4, 'var(--ink-2)'); chip(30, 4, 8, 'var(--sand-shade)'); }
  else if (look === 'dark') dot(40, 1, 2.2, 'var(--ink-3)');
  else if (look === 'holes') { for (let i = 0; i < 22; i++) h('circle', Object.assign({ cx: rx(), cy: ry(), r: 2 + R() * 5, fill: 'var(--marble)' }, { stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-hair)' }), t); }
  else if (look === 'glassy') { for (let i = 0; i < 3; i++) h('path', Object.assign({ d: `M${x0 + w * (.2 + i * .25)} ${y0 + 6} C${x0 + w * (.4 + i * .2)} ${y + 4} ${x0 + w * (.1 + i * .25)} ${y + hh * .3} ${x0 + w * (.3 + i * .25)} ${y0 + hh}` }, st('var(--ink-3)', 'var(--sw-hair)')), t); }
  else if (look === 'grains') { bandsH(4, 'var(--sand-shade)', 'var(--sw-rule)', 3); dot(60, 1.2, 2.4, 'var(--sand-shade)'); }
  else if (look === 'shelly') { for (let i = 0; i < 10; i++) { const cx = rx(), cy = ry(); h('path', Object.assign({ d: `M${cx - 6} ${cy} A6 6 0 0 1 ${cx + 6} ${cy}` }, st('var(--stone-shade)', 'var(--sw-rule)')), t); } dot(20, 1, 2, 'var(--stone)'); }
  else if (look === 'chalk') dot(18, 1.2, 2.4, 'var(--marble-shade)');
  else if (look === 'bands') bandsH(7, 'var(--soil-deep)', 'var(--sw-rule)', 2);
  else if (look === 'pebbles') { for (let i = 0; i < 12; i++) h('ellipse', { cx: rx(), cy: ry(), rx: 5 + R() * 7, ry: 4 + R() * 5, fill: i % 2 ? 'var(--stone)' : 'var(--marble)' }, t); }
  else if (look === 'veined') { for (let i = 0; i < 3; i++) h('path', Object.assign({ d: `M${x0} ${y0 + hh * (.25 + i * .25)} C${x0 + w * .3} ${y0 + hh * (.05 + i * .3)} ${x0 + w * .6} ${y0 + hh * (.5 + i * .15)} ${x0 + w} ${y0 + hh * (.3 + i * .22)}` }, st('var(--marble-shade)', 'var(--sw-struct)')), t); }
  else if (look === 'slate') { // cleavage lines, trimmed to the specimen's box so nothing reaches past it even unclipped
    const dx = hh * .5;
    for (let i = -Math.ceil(dx / 16); i * 16 < w; i++) {
      const x1 = x0 + i * 16, ta = Math.max(0, (x0 - x1) / dx), tb = Math.min(1, (x0 + w - x1) / dx); if (tb <= ta) continue;
      h('path', Object.assign({ d: `M${(x1 + ta * dx).toFixed(1)} ${(y0 + ta * hh).toFixed(1)} L${(x1 + tb * dx).toFixed(1)} ${(y0 + tb * hh).toFixed(1)}` }, st('var(--ink-3)', 'var(--sw-hair)')), t);
    }
  }
  else if (look === 'foliated') { bandsH(6, 'var(--stone-shade)', 'var(--sw-arrow)', 7); bandsH(5, 'var(--marble)', 'var(--sw-rule)', -6); }
  else if (look === 'quartzite') dot(50, 1.5, 3, 'var(--snow-shade)');
  h('path', Object.assign({ d }, st('var(--ink-2)', 'var(--sw-rule)')), g);
  return { g, box: { x: x - w / 2, y: y - hh / 2, w, h: hh } };
}

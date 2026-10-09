// Batch H kit parts: arts, computing, music, PE and RE.
// Plain ES module on the kit core. Tokens only (every fill is a token or a color-mix of tokens,
// the same way the tokens stylesheet derives its roles). Every word is real SVG text; callers pass the
// params path for each word (edit) or the value it comes from (computedPath).
// Nothing here runs on a timer: steps are build attributes (s / hide / c) set by the caller,
// and continuous moves go through the returned pose()/to() helpers inside a model's tick().
//
// MUSIC
//   beatGrid(p, beats, subdivisions, {x, y, w, h=120, bars=1, pulseS, a})
//       -> {g, bars, beats, cellW, barW, y, h, beatX(bar, beat, frac=0), barBox(bar), dots[bar][beat]}
//       Bars as boxes, one pulse dot per beat (shown from build pulseS, staggered), light
//       subdivision ticks. Dots are returned so a model can light them (c ranges) per clap build.
//   playhead(p, grid, {at:[{k, bar, beat}], y0, y1, a})
//       -> {g, marks[], to(bar, beat)}. One marker per entry, shown at build k and hidden at the next
//       entry's k, so the playhead advances one beat per build with no timers. With no `at`, one
//       marker that to() moves (for tick()).
//   rhythmRow(p, grid, bar, cells, {y, s, delay=0, edit:i=>path, sylls})
//       -> {g, items:[{cell, x, w, el}]}. Stick notation over the beat cells: 'ta' (1 beat),
//       'ti-ti' (2 halves, beamed), 'ta-a' (2 beats), 'ta-a-a-a' (4 beats), 'rest' (1 beat, drawn rest).
//       Syllables are real text under each cell (editable via edit(i), else computed from the cell).
//   CELL_BEATS, barBeats(cells) -> beats a bar's cells fill (rests count as beats).
//   keys(p, octave, {x, y, w, h=200, octaves=1, closeC=true, labels=true, labelPath, a})
//       -> {g, whites, keyOf(name) -> {x, top, w, h, black, el}}. Piano keyboard from C<octave>,
//       true black-key pattern; white-key letter names are computed text.
//   NOTE_LETTERS, noteToMidi('C#4'), midiToName(60) -> 'C4', isNoteName(s).
//
// ART
//   PAINT {red, yellow, blue, orange, green, purple, brown, white, black} -> token fills.
//   paintFill(name, {tint=0, shade=0}) -> fill: tint mixes towards white paint, shade towards black.
//   mix(a, b) -> pigment name from the PAINTING (subtractive) mix table, or null if not in it.
//       red+yellow=orange, yellow+blue=green, red+blue=purple, any+same=same, all three=brown.
//   mixAll(list) -> pigment for a list (2 or 3 colours).
//   PAINT_PRIMARIES, WARM, COOL.
//   swatch(p, colour, {x, y, r=48, shape:'dab'|'chip', label, edit, computedPath, tint, shade, a})
//       -> g with g.box. colour is a PAINT name. A flat paint dab (seeded, stable) with a hairline
//       rim so white reads on paper and black reads in Night; label below.
//
// COMPUTING
//   gridWorld(p, cols, rows, {x, y, cell, a}) -> {g, cols, rows, cell, box, cx(c), cy(r), inside(c, r)}
//       Floor mat, column 0 at left, row 0 at top.
//   robot(p, {x, y, size, dir='N', a}) -> outer g (build attrs) with .pose(x, y, dirOrDeg).
//       Generic floor robot drawn facing its heading (eyes at the front), flat, one shaded face.
//   DIRS ['N','E','S','W'], turn(dir, 'left'|'right'), dirDeg(dir).
//   runProgram({cols, rows, obstacles:[[c,r]]}, {c, r, dir}, program, path='program')
//       -> {poses:[{c,r,dir,op,path}], error:null|{path, op, kind:'off-grid'|'obstacle'|'bad-repeat', at}}
//       Program items: 'forward' | 'back' | 'left' | 'right' | {repeat:n, steps:[...]}.
//       Turns are on the spot (90°). Repeats are expanded honestly (n times).
//   gridMarker(p, world, c, r, kind, {a}) -> g. kind: 'flower' | 'flag' | 'block' | 'home'.
//
// PE
//   court(p, sport, {x, y, w, h, a}) -> {g, sport, L, Wd, k, box, mx(m), my(m), areasAt(mx, my)}
//       sport: 'netball' | 'football' | 'hockey' | 'tag-rugby' | 'open'. Real markings at true
//       proportion, fitted into the box. Metres: mx from the left end line, my from the top side line.
//   SPORT_DIMS, NETBALL_POSITIONS, NETBALL_ALLOWED, netballAllowed(pos, mx, my) -> bool.
//   player(p, x, y, {team:'a'|'b', label, edit, computedPath, r=24, a}) -> g. Bib letters in a disc.
//   ball(p, x, y, {r=11, a}) -> g.
//   cone(p, x, y, {s=1, a}) -> g.
//
// SCENERY TAGS: H_OBJECT_TAGS {kind: {cultures, topics}} for every drawn object here
//   (flower, flag, block, home, cone, robot). Generic objects carry cultures ['any'].
import { h, T, rng, clamp } from './svg.js';
import { editable, computed } from './components.js';

/* ================================================================== scenery tags */
export const H_OBJECT_TAGS = {
  flower: { cultures: ['any'], topics: ['algorithms', 'nature', 'minibeasts'] },
  flag: { cultures: ['any'], topics: ['algorithms', 'pe'] },
  block: { cultures: ['any'], topics: ['algorithms'] },
  home: { cultures: ['modern'], topics: ['algorithms', 'community'] },
  cone: { cultures: ['modern'], topics: ['pe'] },
  robot: { cultures: ['modern'], topics: ['algorithms', 'computing'] },
};

/* ================================================================== music */
export const CELL_BEATS = { 'ta': 1, 'ti-ti': 1, 'ta-a': 2, 'ta-a-a-a': 4, 'rest': 1 };
export const barBeats = cells => (cells || []).reduce((n, c) => n + (CELL_BEATS[c] ?? NaN), 0);

export function beatGrid(p, beats, subdivisions = 1, { x = 64, y = 300, w = 1152, h: hh = 120, bars = 1, pulseS, a = {} } = {}) {
  const g = h('g', a, p); const gap = 24; const barW = (w - gap * (bars - 1)) / bars; const cellW = barW / beats;
  const dots = [];
  const bx = b => x + b * (barW + gap);
  for (let b = 0; b < bars; b++) {
    h('rect', { x: bx(b), y, width: barW, height: hh, rx: 'var(--r-mark)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'body' }, g);
    for (let i = 1; i < beats; i++) h('line', { x1: bx(b) + i * cellW, x2: bx(b) + i * cellW, y1: y + 8, y2: y + hh - 8, stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, g);
    if (subdivisions > 1) for (let i = 0; i < beats; i++) for (let j = 1; j < subdivisions; j++) {
      const sx = bx(b) + (i + j / subdivisions) * cellW; h('line', { x1: sx, x2: sx, y1: y + hh - 18, y2: y + hh - 8, stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-hair)' }, g);
    }
    dots[b] = [];
    for (let i = 0; i < beats; i++) dots[b].push(h('circle', { cx: bx(b) + (i + .5) * cellW, cy: y + 20, r: Math.min(11, cellW * .12), fill: 'var(--neutral)', s: pulseS, cls: pulseS != null ? 'pop' : null, delay: pulseS != null ? (b * beats + i) * 60 : null }, g));
  }
  return { g, bars, beats, cellW, barW, y, h: hh, dots, beatX: (b, i, f = 0) => bx(b) + (i + .5 + f) * cellW, barBox: b => ({ x: bx(b), y, w: barW, h: hh }) };
}

export function playhead(p, grid, { at, y0, y1, a = {} } = {}) {
  const g = h('g', a, p); const top = y0 ?? grid.y - 22, bot = y1 ?? grid.y + grid.h;
  const mark = (x, attrs) => {
    const m = h('g', attrs, g); const i = h('g', { transform: `translate(${x} 0)` }, m);
    h('line', { x1: 0, x2: 0, y1: top + 12, y2: bot, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, i);
    h('path', { d: `M-12 ${top} L12 ${top} L0 ${top + 16} Z`, fill: 'var(--focus)' }, i); m.inner = i; return m;
  };
  if (at && at.length) {
    const marks = at.map((e, j) => mark(grid.beatX(e.bar, e.beat), { s: e.k, hide: j + 1 < at.length ? at[j + 1].k : null }));
    return { g, marks, to() {} };
  }
  const m = mark(grid.beatX(0, 0), {});
  return { g, marks: [m], to(b, i) { m.inner.setAttribute('transform', `translate(${grid.beatX(b, i)} 0)`); } };
}

function noteHead(g, x, y, open) {
  h('ellipse', { cx: x, cy: y, rx: 13, ry: 9.5, transform: `rotate(-22 ${x} ${y})`, fill: open ? 'var(--paper)' : 'var(--ink)', stroke: 'var(--ink)', 'stroke-width': open ? 'var(--sw-struct)' : 0 }, g);
}
export function rhythmRow(p, grid, bar, cells, { y, s, delay = 0, edit, sylls, a = {} } = {}) {
  const g = h('g', a, p); const items = []; let beat = 0;
  const base = y ?? grid.y + grid.h - 20, stemH = 50, sw = 'var(--sw-struct)';
  cells.forEach((cell, i) => {
    const n = CELL_BEATS[cell] ?? 1; const x0 = grid.beatX(bar, beat) - grid.cellW / 2, w = n * grid.cellW;
    const cg = h('g', { s, delay: s != null ? delay + i * 90 : null, cls: s != null ? 'rise' : null }, g);
    if (cell === 'ti-ti') {
      const xa = x0 + w * .3, xb = x0 + w * .7;
      for (const xx of [xa, xb]) { noteHead(cg, xx, base, false); h('line', { x1: xx + 11, x2: xx + 11, y1: base - 4, y2: base - stemH, stroke: 'var(--ink)', 'stroke-width': sw }, cg); }
      h('rect', { x: xa + 9, y: base - stemH - 3, width: xb - xa + 4, height: 9, fill: 'var(--ink)' }, cg);
    } else if (cell === 'rest') {
      const cx = x0 + w / 2;
      h('path', { d: `M${cx - 6} ${base - 52} L${cx + 7} ${base - 36} L${cx - 5} ${base - 24} L${cx + 8} ${base - 10} Q${cx - 10} ${base - 14} ${cx - 2} ${base + 4}`, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, cg);
    } else {
      const cx = x0 + Math.min(w, grid.cellW) / 2; const open = cell !== 'ta';
      noteHead(cg, cx, base, open); h('line', { x1: cx + 11, x2: cx + 11, y1: base - 4, y2: base - stemH, stroke: 'var(--ink)', 'stroke-width': sw }, cg);
      if (n > 1) h('line', { x1: cx + 28, x2: x0 + w - 18, y1: base, y2: base, stroke: 'var(--neutral)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }, cg);
    }
    const word = (sylls && sylls[i]) || cell;
    const t = T(cg, x0 + w / 2, grid.y + grid.h + 32, word, 'ts-small', { 'text-anchor': 'middle' });
    if (edit) editable(t, edit(i)); else computed(t, null);
    items.push({ cell, x: x0, w, el: cg }); beat += n;
  });
  return { g, items };
}

export const NOTE_LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
export function noteToMidi(name) {
  const m = /^([A-G])([#b♯♭]?)(-?\d)$/.exec(String(name).trim()); if (!m) return null;
  let l = m[1] + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]); if (FLAT[l]) l = FLAT[l];
  if (l === 'Cb' || l === 'Fb' || l === 'E#' || l === 'B#') { const base = NOTE_LETTERS.indexOf(l[0]) + (l[1] === '#' ? 1 : -1); return (+m[3] + 1) * 12 + base; }
  const i = NOTE_LETTERS.indexOf(l); return i < 0 ? null : (+m[3] + 1) * 12 + i;
}
export const midiToName = n => NOTE_LETTERS[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
export const isNoteName = s => noteToMidi(s) != null;

export function keys(p, octave = 4, { x = 64, y = 360, w = 640, h: hh = 200, octaves = 1, closeC = true, labels = true, labelPath, a = {} } = {}) {
  const g = h('g', a, p); const start = (octave + 1) * 12; const end = start + 12 * octaves + (closeC ? 0 : -1);
  const notes = []; for (let n = start; n <= end; n++) notes.push(n);
  const whites = notes.filter(n => !NOTE_LETTERS[n % 12].includes('#')); const kw = w / whites.length; const map = {};
  whites.forEach((n, i) => {
    const el = h('rect', { x: x + i * kw, y, width: kw, height: hh, rx: 'var(--r-mark)', fill: 'var(--cloud)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, g);
    map[midiToName(n)] = { x: x + (i + .5) * kw, top: y, w: kw, h: hh, black: false, el };
  });
  notes.filter(n => NOTE_LETTERS[n % 12].includes('#')).forEach(n => {
    const left = map[midiToName(n - 1)]; const bw = kw * .58, bx = left.x + kw / 2 - bw / 2;
    const el = h('rect', { x: bx, y, width: bw, height: hh * .62, rx: 'var(--r-mark)', fill: 'var(--shade)' }, g);
    map[midiToName(n)] = { x: bx + bw / 2, top: y, w: bw, h: hh * .62, black: true, el };
  });
  if (labels) whites.forEach(n => { const k = map[midiToName(n)]; const t = T(g, k.x, y + hh - 18, NOTE_LETTERS[n % 12], 'ts-small', { 'text-anchor': 'middle', fill: 'var(--shade)' }); computed(t, labelPath || null); });
  return { g, whites: whites.map(midiToName), keyOf: name => { const m = noteToMidi(name); return m == null ? null : map[midiToName(m)] || null; } };
}

/* ================================================================== art: painting mixes */
export const PAINT = {
  red: 'var(--hue-red)', yellow: 'var(--hue-gold)', blue: 'var(--hue-blue)',
  orange: 'var(--hue-orange)', green: 'var(--hue-green)', purple: 'var(--hue-purple)',
  brown: 'var(--hue-brown)', white: 'var(--cloud)', black: 'var(--shade)',
};
export const PAINT_PRIMARIES = ['red', 'yellow', 'blue'];
export const WARM = ['red', 'orange', 'yellow'];
export const COOL = ['green', 'blue', 'purple'];
const MIX = { 'red+yellow': 'orange', 'blue+yellow': 'green', 'blue+red': 'purple' };
/** Painting (subtractive) mix of two paints. null when the pair is not in the table. */
export function mix(a, b) {
  if (!PAINT[a] || !PAINT[b]) return null; if (a === b) return a;
  return MIX[[a, b].sort().join('+')] || null;
}
export function mixAll(list) {
  const u = [...new Set(list)].sort(); if (u.length === 1) return u[0]; if (u.length === 2) return mix(u[0], u[1]);
  return u.length === 3 && u.join() === 'blue,red,yellow' ? 'brown' : null;
}
/** Fill for a paint with white added (tint 0..1) or black added (shade 0..1). */
export function paintFill(name, { tint = 0, shade = 0 } = {}) {
  const base = PAINT[name] || PAINT.white;
  if (tint > 0) return `color-mix(in oklab,${base} ${Math.round((1 - clamp(tint)) * 100)}%,var(--cloud))`;
  if (shade > 0) return `color-mix(in oklab,${base} ${Math.round((1 - clamp(shade)) * 100)}%,var(--shade))`;
  return base;
}
function dabD(r, seed) {
  const R = rng(seed), n = 9, pts = [];
  for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2, rr = r * (.9 + .14 * R()); pts.push([Math.cos(t) * rr, Math.sin(t) * rr * .88]); }
  const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2]; let m = mid(pts[n - 1], pts[0]); let d = `M${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) { const q = pts[i], e = mid(q, pts[(i + 1) % n]); d += ` Q${q[0].toFixed(1)} ${q[1].toFixed(1)} ${e[0].toFixed(1)} ${e[1].toFixed(1)}`; }
  return d + ' Z';
}
export function swatch(p, colour, { x = 0, y = 0, r = 48, shape = 'dab', label, edit, computedPath, tint = 0, shade = 0, a = {} } = {}) {
  const g = h('g', a, p); const fill = paintFill(colour, { tint, shade }); let seed = 7; for (const ch of String(colour)) seed = seed * 31 + ch.charCodeAt(0);
  const ring = { stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' };
  if (shape === 'chip') h('rect', Object.assign({ x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 'var(--r-mark)', fill }, ring), g);
  else h('path', Object.assign({ d: dabD(r, seed), transform: `translate(${x} ${y})`, fill }, ring), g);
  let bottom = y + r;
  if (label != null) { const t = T(g, x, y + r + 34, label, 'ts-small', { 'text-anchor': 'middle' }); editable(t, edit); computed(t, edit ? null : computedPath); bottom = y + r + 42; }
  g.box = { x: x - r, y: y - r, w: 2 * r, h: bottom - (y - r) };
  return g;
}

/* ================================================================== computing: floor robot */
export const DIRS = ['N', 'E', 'S', 'W'];
const DV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const dirDeg = d => DIRS.indexOf(d) * 90;
export const turn = (d, way) => DIRS[(DIRS.indexOf(d) + (way === 'left' ? 3 : 1)) % 4];

export function gridWorld(p, cols, rows, { x = 64, y = 140, cell = 80, a = {} } = {}) {
  const g = h('g', a, p); const w = cols * cell, hh = rows * cell;
  h('rect', { x: x - 8, y: y - 8, width: w + 16, height: hh + 16, rx: 'var(--r-card)', fill: 'var(--panel)', cls: 'body' }, g);
  h('rect', { x, y, width: w, height: hh, fill: 'var(--paper)' }, g);
  for (let c = 0; c <= cols; c++) h('line', { x1: x + c * cell, x2: x + c * cell, y1: y, y2: y + hh, stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, g);
  for (let r = 0; r <= rows; r++) h('line', { x1: x, x2: x + w, y1: y + r * cell, y2: y + r * cell, stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-rule)' }, g);
  return { g, cols, rows, cell, box: { x, y, w, h: hh }, cx: c => x + (c + .5) * cell, cy: r => y + (r + .5) * cell, inside: (c, r) => c >= 0 && r >= 0 && c < cols && r < rows };
}

export function robot(p, { x = 0, y = 0, size = 64, dir = 'N', a = {} } = {}) {
  const outer = h('g', a, p); const pose = h('g', {}, outer); const s = size / 64; const body = h('g', { transform: `scale(${s})` }, pose);
  for (const sx of [-30, 22]) for (const sy of [-20, 8]) h('rect', { x: sx, y: sy, width: 8, height: 14, rx: 3, fill: 'var(--ink-2)' }, body);
  h('rect', { x: -24, y: -28, width: 48, height: 56, rx: 18, fill: 'var(--energy)', cls: 'body' }, body);
  h('path', { d: 'M8 -28 L6 -28 A18 18 0 0 1 24 -10 L24 10 A18 18 0 0 1 6 28 L8 28 Z', fill: 'color-mix(in oklab,var(--energy) var(--depth-shade),var(--shade))' }, body);
  for (const ex of [-9, 9]) { h('circle', { cx: ex, cy: -14, r: 7, fill: 'var(--paper)' }, body); h('circle', { cx: ex, cy: -16, r: 3.5, fill: 'var(--ink)' }, body); }
  outer.pose = (px, py, d) => pose.setAttribute('transform', `translate(${px} ${py}) rotate(${typeof d === 'number' ? d : dirDeg(d)})`);
  outer.pose(x, y, dir); return outer;
}

/** Run a floor-robot program on a grid. Stops at the first step that leaves the mat or meets an obstacle. */
export function runProgram(world, start, program, path = 'program') {
  const blocked = new Set((world.obstacles || []).map(([c, r]) => c + ',' + r));
  let cur = { c: start.c, r: start.r, dir: start.dir || 'N' }; const poses = [Object.assign({ op: 'start', path: null }, cur)];
  let error = null;
  const walk = (list, base) => {
    for (let i = 0; i < list.length && !error; i++) {
      const st = list[i], sp = `${base}.${i}`;
      if (st && typeof st === 'object') {
        const n = st.repeat; if (!Number.isInteger(n) || n < 1) { error = { path: sp + '.repeat', op: 'repeat', kind: 'bad-repeat', at: { c: cur.c, r: cur.r } }; return; }
        for (let k = 0; k < n && !error; k++) walk(st.steps || [], sp + '.steps');
        continue;
      }
      let nx = { c: cur.c, r: cur.r, dir: cur.dir };
      if (st === 'left' || st === 'right') nx.dir = turn(cur.dir, st);
      else if (st === 'forward' || st === 'back') { const [dx, dy] = DV[cur.dir], m = st === 'forward' ? 1 : -1; nx.c += dx * m; nx.r += dy * m; }
      else { error = { path: sp, op: st, kind: 'bad-step', at: { c: cur.c, r: cur.r } }; return; }
      if (!(nx.c >= 0 && nx.r >= 0 && nx.c < world.cols && nx.r < world.rows)) { error = { path: sp, op: st, kind: 'off-grid', at: { c: nx.c, r: nx.r } }; return; }
      if (blocked.has(nx.c + ',' + nx.r)) { error = { path: sp, op: st, kind: 'obstacle', at: { c: nx.c, r: nx.r } }; return; }
      cur = nx; poses.push(Object.assign({ op: st, path: sp }, cur));
    }
  };
  walk(program || [], path);
  return { poses, error };
}

export function gridMarker(p, world, c, r, kind, { a = {} } = {}) {
  const outer = h('g', a, p); const s = world.cell / 80; const g = h('g', { transform: `translate(${world.cx(c)} ${world.cy(r)}) scale(${s})` }, outer);
  if (kind === 'flower') {
    h('path', { d: 'M0 26 Q4 10 0 0', fill: 'none', stroke: 'var(--leaf)', 'stroke-width': 'var(--sw-struct)' }, g);
    h('path', { d: 'M0 22 Q12 12 18 18 Q10 26 0 22 Z', fill: 'var(--leaf)' }, g);
    for (let i = 0; i < 6; i++) { const t = i / 6 * Math.PI * 2; h('circle', { cx: Math.cos(t) * 11, cy: -6 + Math.sin(t) * 11, r: 8, fill: 'var(--sun)', cls: 'body' }, g); }
    h('circle', { cx: 0, cy: -6, r: 7, fill: 'var(--hull)' }, g);
  } else if (kind === 'flag') {
    h('line', { x1: -10, x2: -10, y1: 28, y2: -28, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
    h('path', { d: 'M-10 -28 L22 -18 L-10 -6 Z', fill: 'var(--event)', cls: 'body' }, g);
  } else if (kind === 'home') {
    h('rect', { x: -22, y: -6, width: 44, height: 30, fill: 'var(--daub)', cls: 'body' }, g); h('rect', { x: 6, y: -6, width: 16, height: 30, fill: 'var(--daub-shade)' }, g);
    h('polygon', { points: '-28,-4 0,-28 28,-4', fill: 'var(--tile)', cls: 'body' }, g); h('rect', { x: -6, y: 8, width: 12, height: 16, fill: 'var(--hull)' }, g);
  } else { // block: an obstacle the robot cannot pass
    h('rect', { x: -30, y: -30, width: 60, height: 60, rx: 'var(--r-mark)', fill: 'var(--stone)', cls: 'body' }, g);
    h('rect', { x: 12, y: -30, width: 18, height: 60, fill: 'var(--stone-shade)' }, g);
  }
  return outer;
}

/* ================================================================== PE: courts and pitches */
// Metres. Netball: England Netball / World Netball. Football: IFAB Law 1 (adult 105 x 68;
// small-sided pitches keep the same shapes smaller). Hockey: FIH. Tag rugby: RFU age-grade
// guide (up to 60 x 30 with 5 m in-goal areas). 'open': a coned playing space, no markings.
export const SPORT_DIMS = {
  netball: { L: 30.5, W: 15.25 }, football: { L: 105, W: 68 }, hockey: { L: 91.4, W: 55 },
  'tag-rugby': { L: 60, W: 30 }, open: { L: 20, W: 12 },
};
export const NETBALL_POSITIONS = ['GK', 'GD', 'WD', 'C', 'WA', 'GA', 'GS'];
/** Areas each netball position may enter, for a team shooting at the right-hand goal.
 *  third-1 is the left (defending) third; circle-1 and circle-3 are the goal circles. */
export const NETBALL_ALLOWED = {
  GK: ['third-1', 'circle-1'], GD: ['third-1', 'circle-1', 'third-2'], WD: ['third-1', 'third-2'],
  C: ['third-1', 'third-2', 'third-3'], WA: ['third-2', 'third-3'], GA: ['third-2', 'third-3', 'circle-3'], GS: ['third-3', 'circle-3'],
};
function netballAreas(mx, my) {
  const { L, W } = SPORT_DIMS.netball; if (mx < 0 || mx > L || my < 0 || my > W) return [];
  const out = ['third-' + (mx < L / 3 ? 1 : mx < 2 * L / 3 ? 2 : 3)];
  if (Math.hypot(mx, my - W / 2) <= 4.9) out.push('circle-1');
  if (Math.hypot(L - mx, my - W / 2) <= 4.9) out.push('circle-3');
  return out;
}
/** True if a netball position may stand at (mx, my): inside a circle it needs that circle, else the third. */
export function netballAllowed(pos, mx, my) {
  const ar = netballAreas(mx, my), ok = NETBALL_ALLOWED[pos]; if (!ok || !ar.length) return false;
  const circ = ar.find(a => a.startsWith('circle')); return circ ? ok.includes(circ) : ok.includes(ar[0]);
}

export function court(p, sport, { x = 64, y = 140, w = 1152, h: hh = 480, a = {} } = {}) {
  const D = SPORT_DIMS[sport] || SPORT_DIMS.open; const { L, W: Wd } = D; const grass = sport !== 'netball' && sport !== 'open';
  const run = 4 * (grass ? 1 : .3); // run-off around the lines, inside the box
  const k = Math.min(w / (L + 2 * run), hh / (Wd + 2 * run)); const ox = x + (w - L * k) / 2, oy = y + (hh - Wd * k) / 2;
  const mx = m => ox + m * k, my = m => oy + m * k;
  const g = h('g', a, p);
  const ln = grass ? 'var(--cloud)' : 'var(--ink-2)'; const sw = 'var(--sw-struct)';
  const L_ = (x1, y1, x2, y2, extra = {}) => h('line', Object.assign({ x1: mx(x1), y1: my(y1), x2: mx(x2), y2: my(y2), stroke: ln, 'stroke-width': sw }, extra), g);
  const P_ = (d, extra = {}) => h('path', Object.assign({ d, fill: 'none', stroke: ln, 'stroke-width': sw }, extra), g);
  const arc = (cx, cy, r, a0, a1) => { const p0 = [mx(cx + r * Math.cos(a0)), my(cy + r * Math.sin(a0))], p1 = [mx(cx + r * Math.cos(a1)), my(cy + r * Math.sin(a1))]; return `M${p0[0]} ${p0[1]} A${r * k} ${r * k} 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} 1 ${p1[0]} ${p1[1]}`; };
  h('rect', { x: mx(-run), y: my(-run), width: (L + 2 * run) * k, height: (Wd + 2 * run) * k, rx: 'var(--r-card)', fill: grass ? 'var(--hill-mid)' : 'var(--panel)' }, g);
  h('rect', { x: mx(0), y: my(0), width: L * k, height: Wd * k, fill: grass ? 'var(--hill-near)' : 'var(--paper)', stroke: ln, 'stroke-width': sw }, g);
  const c = Wd / 2;
  if (sport === 'netball') {
    L_(L / 3, 0, L / 3, Wd); L_(2 * L / 3, 0, 2 * L / 3, Wd);
    h('circle', { cx: mx(L / 2), cy: my(c), r: .45 * k, fill: 'none', stroke: ln, 'stroke-width': sw }, g);
    P_(arc(0, c, 4.9, -Math.PI / 2, Math.PI / 2)); P_(arc(L, c, 4.9, Math.PI / 2, 3 * Math.PI / 2));
    for (const gx of [0, L]) h('circle', { cx: mx(gx), cy: my(c), r: 5, fill: 'var(--ink)' }, g);
  } else if (sport === 'football') {
    L_(L / 2, 0, L / 2, Wd); h('circle', { cx: mx(L / 2), cy: my(c), r: 9.15 * k, fill: 'none', stroke: ln, 'stroke-width': sw }, g);
    h('circle', { cx: mx(L / 2), cy: my(c), r: 3, fill: ln }, g);
    for (const [e, s] of [[0, 1], [L, -1]]) {
      P_(`M${mx(e)} ${my(c - 20.16)} L${mx(e + s * 16.5)} ${my(c - 20.16)} L${mx(e + s * 16.5)} ${my(c + 20.16)} L${mx(e)} ${my(c + 20.16)}`);
      P_(`M${mx(e)} ${my(c - 9.16)} L${mx(e + s * 5.5)} ${my(c - 9.16)} L${mx(e + s * 5.5)} ${my(c + 9.16)} L${mx(e)} ${my(c + 9.16)}`);
      h('circle', { cx: mx(e + s * 11), cy: my(c), r: 3, fill: ln }, g);
      const t = Math.acos(5.5 / 9.15); P_(s > 0 ? arc(e + 11, c, 9.15, -t, t) : arc(e - 11, c, 9.15, Math.PI - t, Math.PI + t));
      h('rect', { x: s > 0 ? mx(e - 2) : mx(e), y: my(c - 3.66), width: 2 * k, height: 7.32 * k, fill: 'none', stroke: ln, 'stroke-width': sw }, g);
    }
  } else if (sport === 'hockey') {
    L_(L / 2, 0, L / 2, Wd); L_(22.9, 0, 22.9, Wd); L_(L - 22.9, 0, L - 22.9, Wd);
    for (const [e, s] of [[0, 1], [L, -1]]) {
      for (const [r, dash] of [[14.63, null], [19.63, '10 12']]) {
        const pa = [e, c - 1.83], pb = [e, c + 1.83];
        const d = `M${mx(e)} ${my(pa[1] - r)} A${r * k} ${r * k} 0 0 ${s > 0 ? 1 : 0} ${mx(e + s * r)} ${my(pa[1])} L${mx(e + s * r)} ${my(pb[1])} A${r * k} ${r * k} 0 0 ${s > 0 ? 1 : 0} ${mx(e)} ${my(pb[1] + r)}`;
        P_(d, dash ? { 'stroke-dasharray': dash, 'stroke-width': 'var(--sw-rule)' } : {});
      }
      h('circle', { cx: mx(e + s * 6.475), cy: my(c), r: 3, fill: ln }, g);
      h('rect', { x: s > 0 ? mx(e - 1.2) : mx(e), y: my(c - 1.83), width: 1.2 * k, height: 3.66 * k, fill: 'none', stroke: ln, 'stroke-width': sw }, g);
    }
  } else if (sport === 'tag-rugby') {
    for (const [x0] of [[0], [L - 5]]) h('rect', { x: mx(x0), y: my(0), width: 5 * k, height: Wd * k, fill: 'var(--hill-mid)', stroke: ln, 'stroke-width': sw }, g);
    L_(L / 2, 0, L / 2, Wd);
  } else {
    for (const [cx, cy] of [[0, 0], [L, 0], [0, Wd], [L, Wd]]) cone(g, mx(cx), my(cy) + 10, { s: .8 });
  }
  return { g, sport, L, Wd, k, box: { x: mx(0), y: my(0), w: L * k, h: Wd * k }, mx, my, areasAt: (ax, ay) => sport === 'netball' ? netballAreas(ax, ay) : [] };
}

export function player(p, x, y, { team = 'a', label = '', edit, computedPath, r = 24, a = {} } = {}) {
  const g = h('g', a, p); const fill = team === 'b' ? 'var(--compare)' : 'var(--focus)';
  h('circle', { cx: x, cy: y + 4, r, fill: 'var(--ground-shadow)' }, g);
  h('circle', { cx: x, cy: y, r, fill, cls: 'body' }, g);
  if (label) {
    const short = String(label).length <= 2;
    const t = short ? T(g, x, y + 8, label, 'ts-badge', { 'text-anchor': 'middle' }) : T(g, x, y + r + 28, label, 'ts-small', { 'text-anchor': 'middle', cls: 'halo strong' });
    editable(t, edit); if (!edit) computed(t, computedPath);
  }
  return g;
}
export function ball(p, x, y, { r = 11, a = {} } = {}) {
  const g = h('g', a, p); h('circle', { cx: x, cy: y, r, fill: 'var(--cloud)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-rule)' }, g);
  h('path', { d: `M${x - r * .7} ${y - r * .3} Q${x} ${y + r * .4} ${x + r * .7} ${y - r * .3}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g); return g;
}
export function cone(p, x, y, { s = 1, a = {} } = {}) {
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer);
  h('rect', { x: -14, y: -4, width: 28, height: 4, fill: 'var(--counter-edge)' }, g);
  h('polygon', { points: '-11,-4 0,-28 11,-4', fill: 'var(--counter)', cls: 'body' }, g);
  h('polygon', { points: '0,-28 11,-4 3,-4', fill: 'var(--counter-edge)' }, g);
  return outer;
}

// Volcanoes and earthquakes: a cross-section through the crust (and the mantle under it).
// Volcano: the cone, magma rising into a chamber, pressure building, the eruption (ash and lava for a
// steep composite cone, runny lava for a shield), an optional nearby town buried by ash, and the cone
// growing by a new layer. Earthquake: two plates (or a fault inside one), stress building, the rock
// snapping at the focus, shock waves spreading, and the epicentre right above the focus.
// Optional: where it happens (plate boundary or hot spot), a real example, and a small whole-Earth
// cutaway when the layer list goes down to the core. Built on the kit; batch F parts from kit/batch-F.js.
import {
  h, T, measure, clamp, lerp, eOut, headD, GRID,
  textBlock, sky, object, sceneryFor, overlaps,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { volcano, ashCloud, earthInterior, LAYER_FILLS } from '../kit/batch-F.js';

export const meta = {
  id: 'volcano_earthquake', name: 'Volcanoes and earthquakes', kind: 'scene', version: 1,
  subjects: ['Geography', 'Science'],
  years: ['Y3', 'Y4', 'Y5', 'Y6', 'KS3'],
  teaches: 'What happens under the ground when a volcano erupts or an earthquake strikes, and why they happen where plates meet.',
};

const KINDS = ['crust', 'mantle', 'outerCore', 'innerCore'];
const KIND_WORDS = ['Crust', 'Mantle', 'Outer core', 'Inner core'];
const BOUNDARIES = ['none', 'destructive', 'constructive', 'conservative', 'hotspot'];
const BOUNDARY_WORDS = ['Not shown (for an earthquake: a crack inside one plate)', 'Plates move together (one sinks under the other)', 'Plates move apart', 'Plates slide past each other', 'A hot spot under a plate'];
// real examples and their real type and setting
const EXAMPLES = {
  none: null,
  vesuvius: { name: 'Vesuvius, Italy', shape: 'composite', boundaries: ['destructive'], where: 'where two plates move together and one sinks under the other' },
  etna: { name: 'Etna, Sicily', shape: 'composite', boundaries: ['destructive'], where: 'where two plates move together and one sinks under the other' },
  iceland: { name: 'Skjaldbreiður, Iceland', shape: 'shield', boundaries: ['constructive', 'hotspot'], where: 'on the rift where two plates pull apart, over a hot spot' },
  maunaloa: { name: 'Mauna Loa, Hawaii', shape: 'shield', boundaries: ['hotspot'], where: 'over a hot spot in the middle of the Pacific Plate, far from any plate boundary' },
};
const EX_IDS = Object.keys(EXAMPLES);
const SHAPE_WORDS = { composite: 'Steep cone (a composite volcano)', shield: 'Wide shield (a shield volcano)' };

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Volcanoes and earthquakes',
  properties: {
    title: TITLE_PARAM('Inside a volcano'),
    hazard: { type: 'string', title: 'Show', enum: ['volcano', 'earthquake'], 'x-labels': ['A volcano erupting', 'An earthquake'], default: 'volcano' },
    shape: { type: 'string', title: 'Kind of volcano', enum: ['composite', 'shield'], 'x-labels': ['Steep cone: layers of ash and lava', 'Wide shield: runny lava'], default: 'composite' },
    example: { type: 'string', title: 'Real volcano', description: 'Names a real volcano. Its kind and where it sits must match the real one.', enum: EX_IDS, 'x-labels': ['None (any volcano)', 'Vesuvius, Italy', 'Etna, Sicily', 'Skjaldbreiður, Iceland', 'Mauna Loa, Hawaii'], default: 'none' },
    boundary: { type: 'string', title: 'Where it happens', description: 'Shows the plates moving, in its own step.', enum: BOUNDARIES, 'x-labels': BOUNDARY_WORDS, default: 'none' },
    layers: {
      type: 'array', title: 'Layers of the Earth', description: 'From the surface down, always in the true order: crust, mantle, outer core, inner core. Add a layer to go deeper; reaching the outer core adds a small cutaway of the whole Earth.', 'x-item': 'a layer', minItems: 1, maxItems: 4,
      default: [{ label: 'Crust' }, { label: 'Mantle' }],
      items: { type: 'object', default: { label: '' }, properties: {
        label: { type: 'string', title: 'Label', description: 'Leave it empty to use the layer’s own name.', maxLength: 40, default: '' },
      } },
    },
    vocabulary: { type: 'string', title: 'Words', enum: ['simple', 'full'], 'x-labels': ['Simple words', 'Scientific words'], default: 'full' },
    town: {
      type: 'object', title: 'A place nearby', default: { show: false, name: 'A town', culture: 'modern' },
      properties: {
        show: { type: 'boolean', title: 'Show a town', default: false },
        name: { type: 'string', title: 'Its name', maxLength: 36, minLength: 1, default: 'A town' },
        culture: { type: 'string', title: 'Buildings from', enum: ['modern', 'victorian', 'tudor', 'rome'], 'x-labels': ['Today', 'Victorian times', 'Tudor times', 'Roman times'], default: 'modern' },
      },
    },
    focusDepth: { type: 'number', title: 'How deep the rock breaks (km)', description: 'Earthquakes: the depth of the focus. Most are less than 70 km down.', minimum: 1, maximum: 1000, default: 10 },
    magnitude: {
      type: 'object', title: 'Magnitude', description: 'Earthquakes: how strong it was.', default: { show: false, value: 6 },
      properties: { show: { type: 'boolean', title: 'Show the magnitude', default: false }, value: { type: 'number', title: 'Magnitude', minimum: 0, maximum: 12, default: 6 } },
    },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y3-inside', name: 'Year 3: inside a volcano', params: {
    title: 'Inside a volcano', hazard: 'volcano', shape: 'composite', example: 'none', boundary: 'none', vocabulary: 'simple',
    layers: [{ label: 'Crust' }, { label: 'Mantle' }],
  } },
  { id: 'y4-pompeii', name: 'Year 4: Pompeii and Vesuvius', params: {
    title: 'Vesuvius and Pompeii, AD 79', hazard: 'volcano', shape: 'composite', example: 'vesuvius', boundary: 'none', vocabulary: 'full',
    layers: [{ label: 'Crust' }, { label: 'Mantle' }], town: { show: true, name: 'Pompeii', culture: 'rome' },
  } },
  { id: 'y6-iceland', name: 'Year 6: Iceland, where plates pull apart', params: {
    title: 'Iceland: where plates pull apart', hazard: 'volcano', shape: 'shield', example: 'iceland', boundary: 'constructive', vocabulary: 'full',
    layers: [{ label: 'Crust' }, { label: 'Mantle' }],
  } },
  { id: 'y6-quake', name: 'Year 6: plates and earthquakes', params: {
    title: 'Plates and earthquakes', hazard: 'earthquake', boundary: 'destructive', vocabulary: 'full', focusDepth: 30,
    layers: [{ label: 'Crust' }, { label: 'Mantle' }, { label: 'Outer core' }, { label: 'Inner core' }],
    town: { show: true, name: 'A town', culture: 'modern' }, magnitude: { show: true, value: 7 },
  } },
];

/* ------------------------------------------------------------------ normalise and validate */
// a number typed on the slide arrives as text: read "30", "30 km" or "6.5" as numbers
const toNum = v => typeof v === 'string' ? parseFloat(v.replace(/,/g, '').replace(/[^\d.\-]+/g, ' ').trim()) : v;
function norm(raw) {
  const P = withDefaults(params, JSON.parse(JSON.stringify(raw || {})));
  P.focusDepth = toNum(P.focusDepth);
  if (P.magnitude) P.magnitude.value = toNum(P.magnitude.value);
  // a layer's kind is its place in the list (the Earth has one true order), so no choice can put them out of order
  if (Array.isArray(P.layers)) P.layers = P.layers.map(L => ({ label: L && typeof L.label === 'string' ? L.label : '' }));
  // a named real volcano carries its own kind and setting: a clashing choice is drawn the true way, with a warning
  const carry = []; Object.defineProperty(P, '_carry', { value: carry, enumerable: false });
  const ex = P.hazard !== 'earthquake' && EXAMPLES[P.example];
  if (ex) {
    const nm = ex.name.split(',')[0];
    if (P.shape !== ex.shape && SHAPE_WORDS[P.shape]) { carry.push(`${nm} is a ${ex.shape === 'composite' ? 'steep composite cone' : 'wide shield volcano'}, so it is drawn as one, whatever “Kind of volcano” says. For another kind, set “Real volcano” to None.`); P.shape = ex.shape; }
    if (P.boundary !== 'none' && BOUNDARIES.includes(P.boundary) && !ex.boundaries.includes(P.boundary)) { carry.push(`${nm} sits ${ex.where}, so the slide shows that, whatever “Where it happens” says. For another place, set “Real volcano” to None.`); P.boundary = ex.boundaries[0]; }
  }
  return P;
}
const isQuake = P => P.hazard === 'earthquake';
const hasKind = (P, k) => (P.layers || []).length > KINDS.indexOf(k);
const labelAt = (P, i) => { const L = (P.layers || [])[i]; return !L ? null : L.label && L.label.trim() ? L.label : KIND_WORDS[i]; };
const layerLabel = (P, k) => labelAt(P, KINDS.indexOf(k));
const cores = P => hasKind(P, 'outerCore');
// Vesuvius in AD 79 (with Pompeii shown): ash, pumice and hot flows of ash and gas, no lava flows
const ad79Of = P => P.hazard !== 'earthquake' && P.example === 'vesuvius' && P.town && P.town.show;

export function validate(raw) {
  const P = norm(raw); const R = []; const W = [];
  if (Number.isNaN(P.focusDepth)) return result([{ path: 'focusDepth', reason: 'Type the depth as a number of kilometres, like 10.' }]);
  if (P.magnitude && Number.isNaN(P.magnitude.value)) return result([{ path: 'magnitude.value', reason: 'Type the magnitude as a number, like 6.5.' }]);
  schemaCheck(params, P, '', R);
  if (R.length) return result(R);
  if (!isQuake(P)) {
    if (P.boundary === 'conservative') R.push({ path: 'boundary', reason: 'Volcanoes do not form where plates slide past each other, because no magma rises there. Choose another place, or show an earthquake.' });
    W.push(...P._carry);
  } else {
    if (P.boundary === 'hotspot') R.push({ path: 'boundary', reason: 'This earthquake slice shows rock breaking on a fault or where plates meet. A hot spot is for volcanoes: choose a plate boundary, or “Not shown” for a crack inside one plate.' });
    if (P.focusDepth > 700) R.push({ path: 'focusDepth', reason: `Earthquakes do not start deeper than about 700 km: below that the rock is too hot and soft to snap. Type a smaller depth than ${P.focusDepth} km.` });
    else if (P.focusDepth > 20 && P.boundary === 'constructive') R.push({ path: 'focusDepth', reason: `Where plates pull apart, earthquakes start near the surface, less than about 20 km down. Type 20 km or less.` });
    else if (P.focusDepth > 30 && P.boundary === 'conservative') R.push({ path: 'focusDepth', reason: `Where plates slide past each other, earthquakes start near the surface, less than about 30 km down. Type 30 km or less.` });
    else if (P.focusDepth > 70 && P.boundary !== 'destructive') R.push({ path: 'focusDepth', reason: `Earthquakes ${P.focusDepth} km down only happen where one plate sinks under another. Choose “Plates move together”, or type 70 km or less.` });
    if (P.focusDepth > 70 && !hasKind(P, 'mantle')) R.push({ path: 'layers', reason: `Rock ${P.focusDepth} km down is in the mantle, so add the mantle to the layers.` });
    if (P.magnitude.show && P.magnitude.value > 9.5) R.push({ path: 'magnitude.value', reason: `The strongest earthquake ever measured was magnitude 9.5 (Chile, 1960), so ${P.magnitude.value} is too big. Type 9.5 or less.` });
    if (P.example !== 'none') W.push('The real volcano is not shown for an earthquake.');
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds and notes */
const fmtKm = n => (Math.round(n * 10) / 10).toLocaleString('en-GB');
function plan(P0) {
  const P = norm(P0); const items = []; const simple = P.vocabulary === 'simple';
  const ex = !isQuake(P) && EXAMPLES[P.example]; const exName = ex ? ex.name.split(',')[0] : null;
  const coreWords = () => hasKind(P, 'innerCore') ? 'Far below the crust are the mantle, the outer core and the inner core.' : 'Far below the crust are the mantle and the outer core.';
  if (!isQuake(P)) {
    const shield = P.shape === 'shield'; const ad79 = ad79Of(P);
    items.push({ key: 'section', caption: ex ? `A slice through ${exName}: a ${shield ? 'wide shield' : 'cone'} of rock standing on the Earth’s crust.` : `A slice through a volcano: a ${shield ? 'wide shield' : 'cone'} of rock standing on the Earth’s crust.` });
    if (cores(P)) items.push({ key: 'earth', caption: coreWords() });
    if (P.boundary !== 'none') items.push({ key: 'plates', caption: {
      destructive: 'Two plates move together. One sinks under the other and starts to melt.',
      constructive: 'Two plates move apart, very slowly. Hot rock rises to fill the gap.',
      hotspot: 'A plate moves slowly over a hot spot, where very hot rock rises from deep in the mantle.' }[P.boundary] });
    items.push({ key: 'magma', caption: simple ? 'Magma, which is melted rock, rises from deep below and collects under the volcano.' : 'Magma, melted rock, rises from deep below and collects in a magma chamber.' });
    items.push({ key: 'pressure', caption: 'Gas in the magma pushes upwards, so the pressure builds and magma fills the vent.' });
    items.push({ key: 'erupt', caption: shield ? 'The volcano erupts: runny lava pours out and flows a long way.' : ad79 ? 'The volcano erupts: ash and pumice shoot high into the sky.' : 'The volcano erupts: ash shoots high into the sky and lava pours out.' });
    if (P.town.show) items.push({ key: 'town', caption: shield ? `Lava flows towards ${P.town.name}.` : `Ash falls on ${P.town.name} and slowly buries it.` });
    items.push({ key: 'layers', caption: shield ? 'The lava cools into a new layer of rock, so the shield grows wider.' : ad79 ? 'The ash settles into a new layer of rock, so the cone grows.' : 'The ash and lava cool into a new layer of rock, so the cone grows.' });
    const summary = `${ex ? exName : 'A volcano'} is built from layers of ${shield ? 'lava' : 'ash and lava'} that came up from deep underground.`;
    return { P, items, summary, ex };
  }
  const bd = P.boundary;
  items.push({ key: 'section', caption: bd === 'none' ? 'A slice through the crust. A fault is a crack where rocks can move.' : 'A slice through the crust where two plates meet.' });
  if (cores(P)) items.push({ key: 'earth', caption: coreWords() });
  items.push({ key: 'stress', caption: {
    none: 'The rocks on each side of the fault are pushed. They stick, so the rock bends.',
    destructive: 'The plates push together. They stick, so the rock bends as the push builds.',
    constructive: 'The plates pull apart. They stick, so the rock stretches as the pull builds.',
    conservative: 'The plates try to slide past each other. They stick, so the rock bends.' }[bd] });
  items.push({ key: 'focus', caption: simple ? `Suddenly the rock snaps and slips, ${fmtKm(P.focusDepth)} km underground.` : `Suddenly the rock snaps and slips. Where it breaks, ${fmtKm(P.focusDepth)} km down, is the focus.` });
  items.push({ key: 'waves', caption: 'Shock waves spread out from there in every direction.' });
  // below about magnitude 2.5 people do not feel a quake: only instruments pick it up
  const weak = P.magnitude.show && P.magnitude.value < 2.5;
  items.push({ key: 'epicentre', caption: weak ? (simple ? 'The surface right above where the rock broke shakes most, but too little for people to feel.' : 'The epicentre is on the surface, right above the focus. This quake is too small for people to feel.')
    : simple ? 'The shaking is strongest on the surface right above where the rock broke.' : 'The epicentre is on the surface, right above the focus. Shaking is strongest there.' });
  const summary = weak ? `Rock snapped ${fmtKm(P.focusDepth)} km down in a magnitude ${fmtKm(P.magnitude.value)} earthquake, too weak for people to feel.`
    : P.magnitude.show ? `Magnitude ${fmtKm(P.magnitude.value)}: rock snapped ${fmtKm(P.focusDepth)} km down, and shock waves shook the surface.`
    : `Rock snapped ${fmtKm(P.focusDepth)} km down, and shock waves spread out and shook the surface.`;
  return { P, items, summary, ex: null };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P0) {
  const { P, items, ex } = plan(P0);
  const N = {
    section: isQuake(P) ? 'Not to scale: the crust is 5 to 70 km thick, and the buildings are drawn far too big. Ask: what is under our feet?'
      : `Not to scale: a real magma chamber is a few kilometres down. ${ex ? `${ex.name} is a real ${P.shape === 'composite' ? 'composite volcano' : 'shield volcano'}. ` : ''}Ask: what do you think is under a volcano?`,
    earth: 'The slice is a tiny piece near the surface of the Earth. The crust is drawn thicker than it really is: at true scale it would be thinner than a line.',
    plates: { destructive: 'The sinking plate drags down water, which helps the rock above it melt. That is why chains of volcanoes line up along these boundaries.',
      constructive: 'Iceland sits on the Mid-Atlantic Ridge, where the North American and Eurasian plates move apart about 2 cm a year, about as fast as fingernails grow.',
      hotspot: 'A hot spot stays still while the plate moves over it, so a line of volcanoes forms, oldest furthest away (like the Hawaiian islands).',
      none: '' }[P.boundary],
    magma: 'The mantle is mostly solid rock that flows very slowly. Magma forms where some of it melts. Magma under the ground; lava once it comes out.',
    pressure: 'Like shaking a fizzy drink: gas trapped in the magma pushes harder and harder until the rock above gives way.',
    erupt: P.shape === 'shield' ? 'Runny lava lets gas escape gently, so shield volcanoes rarely explode. Ask: why does the lava flow so far?'
      : 'Thick, sticky magma traps gas, so composite volcanoes explode. Ash is tiny pieces of rock and glass, not soot from a fire.',
    town: ex && P.example === 'vesuvius' ? 'In AD 79 ash and pumice fell on Pompeii for hours, then hot flows of ash and gas swept over it. The town lay buried for about 1,700 years.'
      : 'Ask: what could people living nearby do to keep safe?',
    layers: 'Each eruption adds a layer, so the volcano grows over thousands of years. The cone in the drawing shows a few of its layers.',
    stress: 'Plates move a few centimetres a year. The rocks lock together, so the strain builds up for years.',
    focus: `The focus (or hypocentre) is drawn ${P.focusDepth > 70 ? 'in the sinking plate, deep down' : 'on the fault'}: shallower quakes are drawn higher, deeper ones lower, but ${fmtKm(P.focusDepth)} km is not to scale on this slice.`,
    waves: 'Shock waves (seismic waves) travel through rock in every direction, like ripples from a stone dropped in a pond.',
    epicentre: P.magnitude.show ? `Magnitude measures the energy released: each step up is about 32 times more energy. Magnitude ${fmtKm(P.magnitude.value)} is ${P.magnitude.value >= 7 ? 'a major earthquake' : P.magnitude.value >= 5 ? 'a moderate to strong earthquake' : P.magnitude.value >= 2.5 ? 'a minor to light earthquake' : 'a micro earthquake: instruments record it, but people do not feel it'}.${P.focusDepth > 300 ? ' Very deep earthquakes shake the surface less, because the waves fade on the long way up.' : ''}`
      : 'Ask: why is the shaking strongest at the epicentre?',
  };
  return { steps: items.map(it => N[it.key] || ''), summary: isQuake(P) ? 'Ask the class to retell the earthquake in order: stress, snap, waves, shaking.' : 'Ask the class to retell the eruption in order: magma rises, pressure builds, eruption, new layer.' };
}

/* ------------------------------------------------------------------ drawing helpers */
// the north-star label card: paper, hairline rule, lifted
function card(g, box) { const r = h('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)', cls: 'lift body' }); g.insertBefore(r, g.firstChild); return r; }
// a label on a card (or bare on a flat band); returns its group, with .box. Long edits wrap, then shrink.
function lab(p, x, y, s, { edit, comp, anchor = 'start', maxW = 260, maxLines = 4, cls = 'ts-label', a = {}, ground = true, fill = 'var(--ink)' } = {}) {
  const g = h('g', a, p);
  const tb = textBlock(g, x, y, s, { cls, maxW, maxLines, lh: 34, anchor, edit, a: { fill } });
  if (comp) computed(tb.el, comp);
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - tb.w : x - tb.w / 2;
  const box = { x: x0 - 16, y: y - 32, w: tb.w + 32, h: tb.h + 14 };
  if (ground) card(g, box);
  g.box = box; g.tb = tb; g.cut = cutShort(tb, s) || tb.broke; /* a word split across lines counts as cut: put() tries the next place */ return g;
}
// true when the kit had to end the wording in “…” (the whole wording did not fit)
const cutShort = (tb, s) => { const L = tb.lines, w = String(s).trim(); return !!L.length && L[L.length - 1].endsWith('…') && !w.endsWith('…'); };
const leader = (p, x1, y1, x2, y2, a = {}) => h('line', Object.assign({ x1, y1, x2, y2, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)', 'stroke-linecap': 'round' }, a), p);
function harrow(ctx, p, x1, x2, y, col, a = {}) {
  const g = h('g', a, p); const dir = Math.sign(x2 - x1); const hs = ctx.tk.head || 16;
  h('path', { d: `M${x1} ${y} H ${x2 - dir * hs * .7}`, fill: 'none', stroke: col, 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
  h('path', { d: headD(x2, y, dir > 0 ? 0 : Math.PI, hs), fill: col }, g);
  return g;
}
function varrow(ctx, p, x, y1, y2, col, a = {}) {
  const g = h('g', a, p); const hs = (ctx.tk.head || 16) * .8;
  h('path', { d: `M${x} ${y1} V ${y2 + hs * .7}`, fill: 'none', stroke: col, 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
  h('path', { d: headD(x, y2, -Math.PI / 2, hs), fill: col }, g);
  return g;
}
// crust: warm grey rock; mantle: solid rock, a clear terracotta that is never the magma colour
const CRUST = 'color-mix(in oklab, var(--stone-shade) 78%, var(--soil))';
const MANTLE = 'color-mix(in oklab, var(--tile) 58%, var(--paper))';
const P2 = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
// lava lying on a surface: a centre line thickened upwards, tapering from t0 to t1
function flowD(pts, t0, t1) { const n = pts.length, up = [], dn = [];
  pts.forEach((q, i) => { const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)]; const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy) || 1;
    let nx = dy / L, ny = -dx / L; if (ny > 0) { nx = -nx; ny = -ny; }
    const t = lerp(t0, t1, i / (n - 1)) * (1 + .14 * Math.sin(i * 1.9)); up.push([q[0] + nx * t, q[1] + ny * t]); dn.push([q[0] - nx * 2, q[1] - ny * 2]); });
  return 'M' + up.map(q => P2(...q)).join(' L ') + ' L ' + dn.reverse().map(q => P2(...q)).join(' L ') + ' Z'; }

/* ------------------------------------------------------------------ render */
export function render(root, P0, ctx) {
  const { P, items, ex } = plan(P0); const b = ctx.b, N = ctx.N; const bi = k => b[k];
  const has = k => b[k] != null; const simple = P.vocabulary === 'simple';
  const soft = `${N}:soft`; const recede = k => [ctx.rc(k), soft].filter(Boolean).join(',');
  const quake = isQuake(P); const mantle = hasKind(P, 'mantle');
  const yG = quake ? 380 : 390, yM = 570, yBot = 660;
  const crustBottom = mantle ? yM : yBot;
  const labels = []; // boxes of placed labels, for scenery to avoid
  const hooks = { dur: {}, ticks: [], stills: [], resets: [] };
  // every placed label (and the ash cloud) with the builds it shows in, so a label that moves for a long edit
  // checks only what is on screen with it
  const placed = [];
  const block = (b, s = 0, e = 1e9) => { placed.push({ b, s: +s, e: +e }); labels.push(b); return b; };
  // labels keep 16 apart; a label may come close to a drawn mark, but never onto it
  const clash = (b, s, e) => placed.some(q => q.s < e && s < q.e && overlaps(b, q.b, q.m ? 4 : 16));
  const mark = (b, s = 0, e = 1e9) => placed.push({ b, s: +s, e: +e, m: true }); // a drawn mark labels keep off
  const inGrid = b => b.x + 16 >= GRID.left - 1 && b.x + b.w - 16 <= GRID.right + 1 && b.y >= 36 && b.y + b.h <= GRID.foot - 2;
  // a label at its usual place; a long edit that would collide tries each fallback in turn (moved, then narrower,
  // so it wraps and shrinks), never drawing on another label. The whole wording comes first: only when no place
  // shows all of it (far past realistic lengths) is it kept to two lines, cut with “…”
  function put(p, x, y, s, o, alts = []) {
    const a = o.a || {}, vs = a.s != null ? +a.s : 0, ve = a.hide != null ? +a.hide : 1e9;
    const cands = [{ x, y }, ...alts.map(c => Object.assign({ x, y }, c))];
    const clashS = (b, s, e) => placed.some(q => !q.faint && q.s < e && s < q.e && overlaps(b, q.b, q.m ? 4 : 16));
    for (const pass of o.overFaint ? ['whole', 'faint', 'cut'] : ['whole', 'cut']) for (let i = 0; i < cands.length; i++) {
      const whole = pass !== 'cut';
      const c = cands[i], g = lab(p, c.x, c.y, s, Object.assign({}, o, c.anchor ? { anchor: c.anchor } : {}, c.maxW ? { maxW: Math.max(80, c.maxW) } : {}, c.maxLines ? { maxLines: c.maxLines } : {}, whole ? {} : { maxLines: 2 }));
      const ok = inGrid(g.box) && !(pass === 'faint' ? clashS : clash)(g.box, vs, ve) && (!whole || !g.cut);
      if (ok || (!whole && i === cands.length - 1)) { if (!ok) ctx.warn(`The label “${s.slice(0, 30)}” has no clear place.`); block(g.box, vs, ve); return g; }
      g.remove();
    }
  }
  // move a label group so its box bottom sits at y; returns the moved box
  const lift = (g, y) => { const dy = Math.round(y - (g.box.y + g.box.h)); g.setAttribute('transform', `translate(0 ${dy})`); return Object.assign({}, g.box, { y: g.box.y + dy }); };
  // the slide title: labels that climb into the sky keep off it
  if (P.title) { const tw = measure(root, P.title, 'ts-title'); placed.push({ b: { x: GRID.left - 16, y: GRID.titleY - 40, w: tw + 32, h: 54 }, s: 0, e: 1e9 }); }
  const upFrom = (y, lo, step = 20) => { const r = []; for (let v = y - step; v >= lo; v -= step) r.push({ y: v }); return r; };

  sky(root, ctx, yG);
  const under = h('g', {}, root);   // ground fills
  const mid = h('g', {}, root);     // waves and lines that labels sit on
  const top = h('g', {}, root);     // marks
  const lbl = h('g', { cls: ctx.uid + '-vq' }, root);     // every label, above everything else
  const over = h('g', { cls: ctx.uid + '-vq' }, root);    // a full-size card in a build of its own
  // a hidden label or card must not catch clicks meant for the text under it
  h('style', {}, root).textContent = `.${ctx.uid}-vq .off, .${ctx.uid}-vq .off *{pointer-events:none}`;

  // the ground in section
  h('rect', { x: 0, y: yG, width: 1280, height: yBot - yG, fill: CRUST }, under);
  if (mantle) h('rect', { x: 0, y: yM, width: 1280, height: yBot - yM, fill: MANTLE }, under);
  h('line', { x1: 0, y1: yG, x2: 1280, y2: yG, stroke: 'var(--soil)', 'stroke-width': 'var(--sw-arrow)' }, under);

  // layer names at the left edge, bare on their bands
  const crustL = layerLabel(P, 'crust'), mantleL = layerLabel(P, 'mantle');
  const iC = 0, iM = 1;
  const rightLayers = !quake && P.boundary === 'destructive';
  const lx0 = rightLayers ? 1200 : 80, lan = rightLayers ? 'end' : 'start';
  // a long name wraps to two lines and stays inside its band; a ground in the band's own colour keeps
  // shock waves and other lines off the words without changing the look
  function bandLabel(s, i, y0, fit, groundFill, lines = 2, mw = quake ? 240 : 300) {
    const g = lab(lbl, lx0, y0, s, { edit: `layers.${i}.label`, anchor: lan, maxW: mw, maxLines: lines, ground: false, a: { s: 0 } });
    const dy = Math.round(fit(g.box)); g.setAttribute('transform', `translate(0 ${dy})`);
    const box = Object.assign({}, g.box, { y: g.box.y + dy });
    g.insertBefore(h('rect', { x: g.box.x + 6, y: g.box.y + 4, width: g.box.w - 12, height: g.box.h - 6, rx: 'var(--r-mark)', fill: groundFill }), g.firstChild);
    block(box);
  }
  const plateFill = quake && P.boundary !== 'none';
  if (crustL) bandLabel(crustL, iC, crustBottom - 30, bx => crustBottom - 12 - (bx.y + bx.h), plateFill ? 'var(--stone)' : CRUST, 3);
  if (mantleL) bandLabel(mantleL, iM, Math.round((yM + yBot) / 2 + 10), bx => (yM + yBot) / 2 + 2 - (bx.y + bx.h / 2), MANTLE, 2, 380);
  // not to scale: small, top right beside the title as in the north star (two lines raised if long); placed last
  function notToScale() {
    const s = txt(P, 'label:nts', 'Not to scale'), tw = P.title ? measure(root, P.title, 'ts-title') : 0;
    const avail = Math.min(520, GRID.right - (GRID.left + tw + 32));
    const spots = [];
    if (avail >= 120) spots.push({ y: GRID.titleY, maxW: avail, up: true });
    if (avail >= 200) spots.push({ y: GRID.titleY - 24, maxW: Math.min(avail, 250), up: false });
    // at the foot, low enough that three lines stay inside the bottom band
    spots.push(...[420, 260, 190].map(maxW => ({ y: GRID.bottom + 10, maxW, up: false })));
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i], g = h('g', {}, lbl);
      const tb = textBlock(g, GRID.right, sp.y, s, { cls: 'ts-tiny', maxW: sp.maxW, maxLines: sp.up ? 2 : 4, lh: 24, anchor: 'end', edit: 'text.label:nts', a: { cls: 'halo' } });
      const dy = sp.up || sp.y > GRID.titleY ? -(tb.lines.length - 1) * tb.lh : 0;
      if (dy) g.setAttribute('transform', `translate(0 ${dy})`);
      const b = { x: GRID.right - tb.w, y: sp.y + dy - 20, w: tb.w, h: tb.h };
      if (!clash(b, 0, 1e9) || i === spots.length - 1) { block(b); return; }
      g.remove();
    }
  }

  // whole-Earth cutaway, full size, in its own build only
  if (has('earth')) {
    const r = 170, ls = P.layers.map((L, i) => ({ text: labelAt(P, i), edit: `layers.${i}.label` }));
    // the card is as wide as its longest name (the kit part wraps a name only past the live area)
    const lw = Math.min(GRID.right - 30 - (GRID.left + 2 * r + 80), Math.max(...ls.map(L => measure(root, L.text, 'ts-small'))));
    const cw = 40 + 2 * r + 40 + lw + 30, x0 = Math.max(GRID.left, Math.round((1280 - cw) / 2)), y0 = 104;
    // the cutaway has the slide to itself: every other label steps out for its build
    lbl.dataset.c = `${bi('earth')}-${bi('earth') + 1}:off`;
    const g = h('g', { s: bi('earth'), hide: bi('earth') + 1, cls: 'rise' }, over);
    h('rect', { x: x0, y: y0, width: cw, height: 2 * r + 40, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'lift body' }, g);
    earthInterior(ctx, g, x0 + 40 + r, y0 + 20 + r, r, { labels: ls });
  }

  return quake ? renderQuake() : renderVolcano();

  /* ---------------------------------------------------------------- volcano */
  function renderVolcano() {
    const shield = P.shape === 'shield', bd = P.boundary, ad79 = ad79Of(P);
    const vx = bd === 'destructive' ? 760 : 600;
    const w = shield ? (bd === 'destructive' ? 680 : 860) : 600, hgt = shield ? 140 : 205, ty = yG - hgt, cw = w * .1;
    const chamber = { dy: 95, rx: shield ? 110 : 90, ry: 30 }, chY = yG + chamber.dy, chTop = chY - chamber.ry, chBot = chY + chamber.ry;
    const feedFrom = mantle ? yM : yBot;
    const kMag = bi('magma'), ke = bi('erupt'), kl = bi('layers');

    // where it happens: drawn into the ground before the cone, so the cone sits on top
    let source = [vx, feedFrom];
    if (bd === 'destructive') {
      const xt = 340, ys = yG + 34, xe = xt + 340, m = (yBot - ys) / (xe - xt), th = 64;
      h('rect', { x: 0, y: yG, width: xt, height: ys - yG, fill: 'var(--sea-2)' }, under);
      h('line', { x1: 0, y1: yG, x2: xt, y2: yG, stroke: 'var(--sea-3)', 'stroke-width': 'var(--sw-rule)' }, under);
      if (mantle) { const xbM = xt + (yM - ys - th) / m; h('path', { d: `M0 ${ys + th} L${xt} ${ys + th} L${P2(xbM, yM)} L0 ${yM} Z`, fill: MANTLE }, under); }
      const xb = xt + (yBot - ys - th) / m;
      h('path', { d: `M0 ${ys} L${xt} ${ys} L${xe} ${yBot} L${P2(xb, yBot)} L${xt} ${ys + th} L0 ${ys + th} Z`, fill: 'var(--stone)' }, under);
      h('path', { d: `M${xt} ${ys} L${xe} ${yBot}`, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', fill: 'none' }, under);
      source = [xt + 236, ys + m * 236 - 8];
      const pg = h('g', { s: bi('plates'), hide: kMag }, lbl);
      const l1 = lab(pg, 70, ys + 40, txt(P, 'label:plateA', simple ? 'Ocean plate' : 'Oceanic plate'), { edit: 'text.label:plateA', maxW: 200 });
      harrow(ctx, pg, l1.box.x + l1.box.w + 14, xt - 14, ys + 32, 'var(--ink)');
      const l2 = lab(pg, 1200, yG + 44, txt(P, 'label:plateB', simple ? 'Land plate' : 'Continental plate'), { edit: 'text.label:plateB', anchor: 'end', maxW: 260 });
      harrow(ctx, pg, 1200, 1090, yG + 80, 'var(--ink)');
      block(l1.box, bi('plates'), kMag); block(l2.box, bi('plates'), kMag);
    } else if (bd === 'constructive') {
      // the rift: the crust split in two, mantle rock rising into the gap under the volcano
      const kp = bi('plates'); const rg = h('g', { s: kp, cls: 'rise' }, under);
      h('path', { d: `M${vx - 34} ${crustBottom} L${vx - 12} ${yG} L${vx + 12} ${yG} L${vx + 34} ${crustBottom} Z`, fill: MANTLE }, rg);
      for (const sd of [-1, 1]) h('path', { d: `M${vx + sd * 34} ${crustBottom} L${vx + sd * 12} ${yG}`, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', fill: 'none' }, rg);
      const pg = h('g', { s: kp, c: recede('plates') }, top);
      harrow(ctx, pg, vx - 70, vx - 290, yG + 40, 'var(--ink)');
      harrow(ctx, pg, vx + 70, vx + 290, yG + 40, 'var(--ink)');
      mark({ x: vx - 294, y: yG + 26, w: 228, h: 28 }, kp); mark({ x: vx + 66, y: yG + 26, w: 228, h: 28 }, kp);
      block(lab(lbl, 1200, yG + 54, txt(P, 'label:apart', 'Plates move apart'), { edit: 'text.label:apart', anchor: 'end', maxW: 280, a: { s: kp, hide: kMag, cls: 'rise' } }).box, kp, kMag);
    } else if (bd === 'hotspot') {
      const pg = h('g', { s: bi('plates'), c: recede('plates') }, under);
      h('path', { d: `M${vx - 90} ${yBot} C ${vx - 70} ${yM} ${vx - 30} ${chBot + 30} ${vx - 20} ${chBot} L ${vx + 20} ${chBot} C ${vx + 30} ${chBot + 30} ${vx + 70} ${yM} ${vx + 90} ${yBot} Z`, fill: 'var(--heat)', opacity: .32 }, pg);
      const tg = h('g', { s: bi('plates'), hide: kMag }, lbl);
      block(lab(tg, vx - 110, 624, txt(P, 'label:hotspot', 'Hot spot'), { edit: 'text.label:hotspot', anchor: 'end', maxW: 220 }).box, bi('plates'), kMag);
      const l = lab(tg, 80, yG + 50, txt(P, 'label:plateMoves', 'The plate moves'), { edit: 'text.label:plateMoves', maxW: 240 });
      harrow(ctx, tg, l.box.x + l.box.w + 14, l.box.x + l.box.w + 190, yG + 40, 'var(--ink)'); block(l.box, bi('plates'), kMag);
    }

    // the cone (kit part), its chamber appears with the magma
    const V = volcano(top, { x: vx, yBase: yG, w, hgt, chamber, strata: shield ? 2 : 3, conduit: false, ground: false, a: { s: 0 } });
    // a solid cone of rock in the kit's depth style: the stone's shade, with its own shade on the far flank
    { const [coneP, farP] = V.g.querySelectorAll(':scope > path');
      const CONE = 'var(--stone-shade)';
      coneP.style.fill = CONE; farP.style.fill = `color-mix(in oklab,${CONE} 78%,var(--shade))`; }   // the kit sets fills as styles
    const chEl = V.g.querySelector('ellipse'); chEl.dataset.s = kMag; chEl.classList.add('rise');
    for (let i = 0; i < 6; i++) { const y0 = lerp(ty, yG, i / 6), y1 = lerp(ty, yG, (i + 1) / 6), half = lerp(cw, w / 2, (i + .5) / 6);
      mark({ x: vx - half, y: y0, w: 2 * half, h: y1 - y0 }); }

    // magma rising from below into the chamber
    const [sx, sy] = source;
    const feed = h('path', { d: `M${P2(sx, sy)} C ${P2(sx, lerp(sy, chBot, .6))} ${P2(vx, lerp(sy, chBot, .5))} ${P2(vx, chBot - 4)}`, fill: 'none', stroke: 'var(--heat)', 'stroke-width': 16, 'stroke-linecap': 'round', pathLength: 1, cls: 'draw', s: kMag }, top);
    feed.style.setProperty('--t-build-draw', 'calc(1400ms * var(--pace))');
    const chLabel = simple ? 'Magma (melted rock)' : 'Magma chamber';
    { const x = vx - chamber.rx - 22, mw = Math.min(340, vx - chamber.rx - 60), lo = yG + 40;
      // a long name rises within the crust, then narrows, clear of the layer names
      put(lbl, x, chY + 8, txt(P, 'label:chamber', chLabel), { edit: 'text.label:chamber', anchor: 'end', maxW: mw, a: { s: kMag, cls: 'rise' } },
        [...upFrom(chY + 8, lo), { maxW: mw * .7 }, ...upFrom(chY + 8, lo).map(c => Object.assign(c, { maxW: mw * .7 })), { y: lo, maxW: mw * .5 },
          { maxW: 130 }, { y: chY - 20, maxW: 130 },
          // a long layer name can fill the left: then the chamber is named on its right (pressure moves up)
          { x: vx + chamber.rx + 32, anchor: 'start', maxW: 280 }, { x: vx + chamber.rx + 32, y: chY + 28, anchor: 'start', maxW: 280 }]); }

    // pressure: the vent fills from the chamber up to the crater; its arrows and label go once it erupts
    const cid = ctx.uid + '-vent'; const clip = h('rect', { x: vx - 30, y: chTop, width: 60, height: 0 }, h('clipPath', { id: cid }, h('defs', {}, top)));
    const vent = h('g', { 'clip-path': `url(#${cid})`, s: bi('pressure') }, top);
    h('path', { d: `M${vx - 9} ${ty + 6} L${vx - 14} ${chTop + 8} L${vx + 14} ${chTop + 8} L${vx + 9} ${ty + 6} Z`, fill: 'var(--heat)' }, vent);
    const setVent = u => { const y = lerp(chTop + 8, ty + 4, clamp(u)); clip.setAttribute('y', y); clip.setAttribute('height', chTop + 10 - y); };
    const pg = h('g', { s: bi('pressure'), hide: ke }, top);
    for (const dx of [-36, 36]) varrow(ctx, pg, vx + dx, chTop - 6, chTop - 50, 'var(--energy)');
    hooks.dur.pressure = 1600;
    hooks.ticks.push((k, u) => { const kp = bi('pressure'); setVent(k > kp ? 1 : k === kp ? eOut(u) : 0);
      const s = k === kp ? 1 + .06 * Math.sin(u * Math.PI * 2) * (1 - u) : 1; chEl.setAttribute('rx', chamber.rx * s); chEl.setAttribute('ry', chamber.ry * s); });
    hooks.stills.push(() => { setVent(1); chEl.setAttribute('rx', chamber.rx); chEl.setAttribute('ry', chamber.ry); });
    hooks.resets.push(() => setVent(0));

    // the volcano's name, from the start
    const nameLines = []; let nameBox = null;
    if (ex) nameLines.push({ s: txt(P, 'label:volcano', ex.name), edit: P.text && P.text['label:volcano'] ? 'text.label:volcano' : null, comp: P.text && P.text['label:volcano'] ? null : 'example' });
    if (!simple) nameLines.push({ s: shield ? 'Shield volcano' : 'Composite volcano', comp: 'shape', small: true });
    if (nameLines.length) {
      const nx = GRID.left + 16, ng = h('g', { s: 0 }, lbl); let ny = 160;
      const gb = { y: ny - 30, h: nameLines.length * 30 + 14 }; let gw = 0;
      for (const L of nameLines) {
        const tb = textBlock(ng, nx, ny, L.s, { cls: L.small ? 'ts-tiny' : 'ts-small', maxW: 420, maxLines: 1, anchor: 'start', edit: L.edit, a: { fill: L.small ? 'var(--ink-2)' : 'var(--ink)', cls: L.small ? null : 'strong' } });
        if (L.comp) computed(tb.el, L.comp); gw = Math.max(gw, tb.w); ny += 30;
      }
      const box = { x: nx - 16, y: gb.y, w: gw + 32, h: gb.h }; card(ng, box); block(box); nameBox = box;
    }

    // crater name (scientific words): up and to one side, clear of the slope, with a leader into the crater
    if (!simple) {
      // on the side away from the ash cloud (a shield has no cloud, so away from the name card)
      const cs = shield ? 1 : (vx > 700 ? 1 : -1), cg = h('g', { s: 0 }, lbl);
      const ax = vx + cs * (cw + 50), ay = ty - (shield ? 44 : 34);
      // a long name narrows to stay off the name card, or drops below the card
      const alts = [], below = nameBox && { x: GRID.left + 16, y: nameBox.y + nameBox.h + 54, anchor: 'start' };
      // a long name first widens beside the crater (higher up, so it clears the slope), then drops below the card
      for (const mw of [300, 380, 460]) alts.push({ maxW: mw }, { y: ay - 34, maxW: mw });
      if (below) alts.push(Object.assign({ maxW: 300 }, below), Object.assign({ maxW: 260 }, below));
      if (cs < 0 && nameBox) alts.push({ maxW: ax - (nameBox.x + nameBox.w) - 30 });
      if (below) alts.push(Object.assign({ maxW: 200 }, below));
      const cl = put(cg, ax, ay, txt(P, 'label:crater', 'Crater'), { edit: 'text.label:crater', anchor: cs < 0 ? 'end' : 'start', maxW: 220 }, alts);
      const bx = cl.box, ex2 = vx + cs * cw * .45, ey2 = ty + 4, fromLeft = bx.x + bx.w < ex2;
      cg.insertBefore(leader(cg, fromLeft ? bx.x + bx.w : bx.x, bx.y + bx.h / 2, ex2, ey2), cg.firstChild); h('circle', { cx: ex2, cy: ey2, r: 5, fill: 'var(--ink)' }, cg);
    }
    // eruption: the ash cloud drifts off to one side, so the vent stays in view
    let cloudBox = null; const cloudSide = vx > 700 ? -1 : 1;
    const eg = h('g', { s: ke }, top);
    if (!shield) {
      // the ash column rises straight up out of the vent and spreads into a cloud above it
      // a broad, low plume: its top stays below the title band (y 92) so the title keeps its full width
      const sx = 1.2, sy = .62, cx = vx, cy = 136, cb = cy + 20;
      h('path', { d: `M${vx - 12} ${ty + 2} C ${vx - 18} ${ty - 14} ${P2(cx - 40, cb + 8)} ${P2(cx - 70, cb)} L ${P2(cx + 70, cb)} C ${P2(cx + 40, cb + 8)} ${vx + 18} ${ty - 14} ${vx + 12} ${ty + 2} Z`, fill: 'var(--neutral)', cls: 'rise' }, eg);
      ashCloud(h('g', { transform: `translate(${cx} ${cy}) scale(${sx} ${sy})` }, eg), 0, 0, 1, { cls: 'rise', delay: 250 });
      cloudBox = { x: cx - 90 * sx, y: cy - 66 * sy, w: 180 * sx, h: 110 * sy }; placed.push({ b: cloudBox, s: ke, e: 1e9, faint: true }); // only the new layer's card may cover it, as a last resort
    } else {
      for (const [dx, dy, r] of [[-14, -22, 7], [6, -34, 8], [18, -18, 6], [-2, -12, 6]]) h('circle', { cx: vx + dx, cy: ty + dy, r, fill: 'var(--heat)', cls: 'pop' }, eg);
    }
    // lava lying on the flanks: short and thick on a cone (away from the cloud), long and thin on a shield.
    // Vesuvius in AD 79 made no lava flows, so none is drawn then.
    const flank = (side, f) => { const x0 = vx + side * cw, x1 = vx + side * w / 2; const pts = [];
      for (let i = 0; i <= 14; i++) { const u = f * i / 14; pts.push([lerp(x0, x1, u), lerp(ty, yG, u)]); } return pts; };
    const layerG = h('g', {}, top);
    if (!ad79) {
      const lavaA = flank(shield ? 1 : -cloudSide, shield ? 1 : .62), lavaB = flank(-1, .82);
      if (shield) for (let i = 1; i <= 4; i++) lavaA.push([vx + w / 2 + 12 * i, yG]);
      for (const [pts, d] of shield ? [[lavaA, 500], [lavaB, 700]] : [[lavaA, 500]])
        h('path', { d: flowD(pts, shield ? 5 : 5, shield ? 13 : 16), fill: 'var(--heat)', cls: 'rise', s: ke, hide: kl, delay: d }, top);
      const le = lavaA[lavaA.length - 1], ls = shield ? 1 : -cloudSide;
      if (shield) put(lbl, le[0], yG + 50, txt(P, 'label:lava', simple ? 'Runny lava' : 'Lava flow'), { edit: 'text.label:lava', anchor: 'middle', maxW: 220, a: { s: ke, hide: kl, cls: 'rise', delay: 900 } },
        [{ x: GRID.right, anchor: 'end', maxW: 190 }, ...[yG - 60, yG - 100, yG - 140].map(y => ({ x: GRID.right, y, anchor: 'end', maxW: 200 })), { y: yG + 200 }, { x: GRID.right, y: yG + 200, anchor: 'end', maxW: 200 }]);
      else block(lab(lbl, le[0] + ls * 24, le[1] + 10, txt(P, 'label:lava', 'Lava'), { edit: 'text.label:lava', anchor: ls > 0 ? 'start' : 'end', maxW: 220, a: { s: ke, hide: kl, cls: 'rise', delay: 900 } }).box, ke, kl);
    }

    // the town, beyond the foot; its name sits just above the buildings; buried by ash (or reached by lava) in its own step
    if (P.town.show) {
      const sc = 1.6, tx = Math.min(vx + w / 2 + 160, 1070), kinds = sceneryFor(P.town.culture);
      const pick = kinds.includes('house') ? ['house', ...kinds.filter(k => k !== 'house' && k !== 'field')] : kinds;
      const tg = h('g', { s: 0 }, top);
      const objs = pick.slice(0, 2); objs.forEach((kd, i) => object(tg, kd, tx + (objs.length > 1 ? (i ? 70 : -70) : 0), yG, sc));
      let tTop = yG - 100 * sc; try { const bb = tg.getBBox(); if (bb.height) tTop = bb.y; } catch (e) { /* not laid out */ }
      const nl = lab(lbl, tx, 0, P.town.name, { edit: 'town.name', anchor: 'middle', maxW: 240, a: { s: 0 } });
      const dy = Math.round(tTop - 12 - (nl.box.y + nl.box.h)); nl.setAttribute('transform', `translate(0 ${dy})`);
      const nb = Object.assign({}, nl.box, { y: nl.box.y + dy }); block(nb);
      const kt = bi('town'); const ag = h('g', { s: kt }, top);
      if (!shield) {
        h('rect', { x: tx - 150, y: yG - 28, width: 300, height: 26, rx: 'var(--r-mark)', fill: 'var(--neutral)', cls: 'rise', delay: 600 }, ag);
        const from = cloudBox ? [cloudBox.x + cloudBox.w * .7, cloudBox.y + cloudBox.h] : [vx, ty];
        for (let i = 0; i < 11; i++) { const u = (i + .5) / 11; const x = lerp(from[0], tx - 20, u) + (i % 3 - 1) * 18, y = lerp(from[1], yG - 50, u) + (i % 2) * 14;
          const seg = { x: x - 10, y: y - 10, w: 20, h: 20 }; if (labels.some(q => overlaps(seg, q, 6))) continue;
          h('line', { x1: x - 6, y1: y - 9, x2: x + 6, y2: y + 9, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round', delay: i * 80 }, ag); }
      } else {
        h('path', { d: flowD([[vx + w / 2 + 40, yG], [tx - 90, yG]], 9, 9), fill: 'var(--heat)', cls: 'rise', hide: kl }, ag);
      }
    }
    if (cloudBox) { // beside the cloud; a long name moves down beside it, then narrows
      const toRight = cloudSide > 0, x = toRight ? cloudBox.x + cloudBox.w + 36 : cloudBox.x - 36, y = cloudBox.y + 40;
      const mw = Math.min(280, toRight ? GRID.right - x : x - GRID.left), steps = [40, 80, 120, -40, 72 - y].map(d => ({ y: y + d }));
      put(lbl, x, y, txt(P, 'label:ash', ad79 ? 'Ash and pumice' : 'Ash cloud'), { edit: 'text.label:ash', anchor: toRight ? 'start' : 'end', maxW: mw, a: { s: ke, hide: kl, cls: 'rise', delay: 400 } },
        [...steps, ...[{ y }, ...steps].map(c => Object.assign({}, c, { maxW: mw * .65 }))]);
    }

    // pressure label (placed after the town and the ash label: it shows only before the eruption)
    const putPressure = () => {
    { const x = vx + chamber.rx + 22, mw = Math.min(280, 1050 - x), lo = yG + 40;
      put(lbl, x, chY + 8, txt(P, 'label:pressure', simple ? 'Gas pushes up' : 'Pressure builds'), { edit: 'text.label:pressure', maxW: mw, a: { s: bi('pressure'), cls: 'rise', hide: ke } },
        [...upFrom(chY + 8, lo), { y: lo, maxW: GRID.right - x }, { y: lo, maxW: mw * .6 },
          { x: vx + 40, y: yG - 44, maxW: 300 }, { x: vx + 40, y: yG - 44, maxW: 200 },
          // before the eruption the sky is clear: a long name crowded out of the ground sits there
          ...[72, 112, 152].flatMap(y => [460, 400, 340].map(maxW => ({ x: GRID.right, y, anchor: 'end', maxW })))]); }
    };
    putPressure();

    // the cone grows: a new layer over both flanks
    const d = shield ? 10 : 14; const lg = h('g', { s: kl }, layerG);
    for (const side of [-1, 1]) {
      const F = [vx + side * w / 2, yG], Tp = [vx + side * cw, ty]; const dx = Tp[0] - F[0], dy = Tp[1] - F[1], L = Math.hypot(dx, dy);
      const n = side < 0 ? [dy / L, -dx / L] : [-dy / L, dx / L];
      const P1 = [Tp[0] + n[0] * d, Tp[1] + n[1] * d], Q = [F[0] + n[0] * d, F[1] + n[1] * d];
      const gx = Q[0] + (yG - Q[1]) * (Q[0] - P1[0]) / (Q[1] - P1[1]);
      h('path', { d: `M${P2(...F)} L${P2(...Tp)} L${P2(...P1)} L${P2(gx, yG)} Z`, fill: 'var(--neutral)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', cls: 'rise', delay: side > 0 ? 200 : 0 }, lg);
    }
    { // label off the left flank, pointing at its middle
      const mx = vx - (cw + w / 2) / 2 - d, my = (ty + yG) / 2;
      const lx = mx - 60, ly = shield ? ty - 4 : my - 20;
      const mw = Math.min(320, lx - 90), downs = [30, 60, 90].map(d => ({ y: ly + d })).filter(c => c.y + 40 < yG), ups = [-40, -80, -120].map(d => ({ y: ly + d }));
      const rx = vx + (cw + w / 2) / 2 + d + 60, rmw = Math.min(320, GRID.right - rx);
      const outer = [30, 50, 70].flatMap(off => [0, 30, 60, 90].map(dd => ({ x: lx - off, y: ly + dd, maxW: mw - off }))).filter(c => c.y + 40 < yG);
      const right = [ly, ly - 60, ly + 40, ly + 70, ly + 100, ly + 130].flatMap(y => [{ x: rx, y, anchor: 'start', maxW: rmw }, { x: rx, y, anchor: 'start', maxW: rmw * .7 }]);
      // the top corners, beside the title row's foot, once the eruption's labels have gone
      // then in the ground at the right, pointing up at the flank; last the top corner, clear of the cloud
      right.push(...[yG + 100, yG + 70, yG + 130].map(y => ({ x: GRID.right, y, anchor: 'end', maxW: 400 })));
      const cornerW = cloudBox && cloudSide > 0 ? GRID.right - (cloudBox.x + cloudBox.w) - 50 : 380;
      right.push(...[72, 112, 152].flatMap(y => [{ x: GRID.right, y, anchor: 'end', maxW: Math.min(300, cornerW) }, { x: GRID.right, y, anchor: 'end', maxW: cornerW }, { x: GRID.right, y, anchor: 'end', maxW: 460 }]));
      const nl = put(lbl, lx, ly, txt(P, 'label:newLayer', shield ? 'New layer of lava' : ad79 ? 'New layer of ash' : 'New layer of ash and lava'), { edit: 'text.label:newLayer', anchor: 'end', maxW: mw, overFaint: true, a: { s: kl, cls: 'rise', delay: 500 } },
        [...downs, ...outer, ...ups, ...right, ...[{ y: ly }, ...downs, ...ups].map(c => Object.assign({}, c, { maxW: mw * .6 }))]);
      const bx = nl.box, onRight = bx.x > vx; const far = bx.y > yG || bx.y + bx.h < ty; const lead = h('g', { s: kl, delay: 500 }, far ? top : mid); // from the ground or the top corner it crosses the cone, so on top
      const tx2 = onRight ? 2 * vx - mx - 4 : mx + 4;
      if (bx.y > my) leader(lead, clamp(tx2 + 60, bx.x + 24, bx.x + bx.w - 24), bx.y, tx2, my - 4); // a card below the flank points up from its top
      else if (bx.y + bx.h < ty) leader(lead, clamp(tx2 + 40, bx.x + 24, bx.x + bx.w - 24), bx.y + bx.h, tx2, my - 4); // from the top corner, down from its foot
      else leader(lead, onRight ? bx.x : bx.x + bx.w, bx.y + bx.h / 2, tx2, my - 4); h('circle', { cx: tx2, cy: my - 4, r: 5, fill: 'var(--ink)' }, lead);
    }
    notToScale();
    return finish();
  }

  /* ---------------------------------------------------------------- earthquake */
  function renderQuake() {
    const bd = P.boundary, deep = P.focusDepth > 70;
    const ft = bd === 'destructive' ? 560 : 640, fb = bd === 'destructive' ? 760 : 640; // fault at the surface and at the bottom of the slice
    const fx = y => lerp(ft, fb, (y - yG) / (yBot - yG));
    // the plates
    if (bd !== 'none') {
      if (bd === 'destructive') {
        const k = (fb - ft) / (yBot - yG), xb = fb - 90, xq = xb - (yBot - yM) * k;
        h('path', { d: `M0 ${yG} L${ft} ${yG} L${fb} ${yBot} L${xb} ${yBot} L${P2(mantle ? xq : xb, mantle ? yM : yBot)} L0 ${mantle ? yM : yBot} Z`, fill: 'var(--stone)' }, under);
      } else h('rect', { x: 0, y: yG, width: fb, height: crustBottom - yG, fill: 'var(--stone)' }, under);
      if (bd === 'constructive') h('path', { d: `M${fb - 7} ${yG} L${fb - 3} ${crustBottom} L${fb + 3} ${crustBottom} L${fb + 7} ${yG} Z`, fill: 'var(--heat)' }, under);
      h('line', { x1: 0, y1: yG, x2: 1280, y2: yG, stroke: 'var(--soil)', 'stroke-width': 'var(--sw-arrow)' }, under);
      if (bd === 'destructive') { h('path', { d: `M0 ${yG - 22} L${ft - 70} ${yG - 22} L${ft - 30} ${yG} L0 ${yG} Z`, fill: 'var(--sea-2)' }, under); h('line', { x1: 0, y1: yG - 22, x2: ft - 70, y2: yG - 22, stroke: 'var(--sea-3)', 'stroke-width': 'var(--sw-rule)' }, under); }
    }
    h('path', { d: `M${ft} ${yG} L${fx(bd === 'destructive' ? yBot : crustBottom)} ${bd === 'destructive' ? yBot : crustBottom}`, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', fill: 'none' }, mid);
    // names: the plates, or the fault
    if (bd !== 'none') {
      const dA = { destructive: simple ? 'Ocean plate' : 'Oceanic plate', constructive: 'Plate', conservative: 'Plate' }[bd];
      const dB = { destructive: simple ? 'Land plate' : 'Continental plate', constructive: 'Plate', conservative: 'Plate' }[bd];
      block(lift(lab(lbl, 80, yG - 30, txt(P, 'label:plateA', dA), { edit: 'text.label:plateA', maxW: 300, maxLines: 3, a: { s: 0 } }), yG - 14));
      block(lift(lab(lbl, 1200, yG - 30, txt(P, 'label:plateB', dB), { edit: 'text.label:plateB', anchor: 'end', maxW: 300, maxLines: 3, a: { s: 0 } }), yG - 14));
    } else {
      // above the ground, left of the fault and clear of the epicentre line; a long name grows upwards
      const l = lab(lbl, ft - 40, yG - 30, txt(P, 'label:fault', 'Fault'), { edit: 'text.label:fault', anchor: 'end', maxW: 300, a: { s: 0 } });
      const fb0 = lift(l, yG - 14);
      block(fb0); leader(h('g', { s: 0 }, mid), fb0.x + fb0.w, fb0.y + fb0.h - 8, ft - 3, yG + 4);
    }
    // stress: arrows, plus the rock bending next to the fault
    const ks = bi('stress'); const sg = h('g', { s: ks, c: recede('stress') }, top); const ay = yG + 50;
    if (bd === 'conservative') {
      for (const [x, towards] of [[ft - 200, true], [ft + 200, false]]) {
        h('circle', { cx: x, cy: ay + 10, r: 20, fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, sg);
        if (towards) h('circle', { cx: x, cy: ay + 10, r: 6, fill: 'var(--ink)' }, sg);
        else h('path', { d: `M${x - 10} ${ay} L${x + 10} ${ay + 20} M${x + 10} ${ay} L${x - 10} ${ay + 20}`, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, sg);
        block(lab(lbl, x + (towards ? -34 : 34), ay + 18, txt(P, towards ? 'label:towards' : 'label:away', towards ? 'Moving towards you' : 'Moving away from you'), { edit: towards ? 'text.label:towards' : 'text.label:away', anchor: towards ? 'end' : 'start', maxW: 260, a: { s: ks, hide: bi('focus') } }).box, ks, bi('focus'));
      }
    } else {
      const apart = bd === 'constructive';
      harrow(ctx, sg, apart ? ft - 120 : ft - 300, apart ? ft - 300 : ft - 110, ay, 'var(--ink)');
      harrow(ctx, sg, apart ? fx(ay) + 120 : fx(ay) + 300, apart ? fx(ay) + 300 : fx(ay) + 110, ay, 'var(--ink)');
      for (const x of [ft - 304, fx(ay) + 106]) placed.push({ b: { x, y: ay - 14, w: 198, h: 28 }, s: ks, e: 1e9, m: true, faint: true });
    }
    for (const side of [-1, 1]) for (const dy of [70, 120]) { const y = yG + dy, x = fx(y) + side * 14;
      h('path', { d: `M${x + side * 120} ${y + 10} Q ${x + side * 50} ${y + 10} ${x} ${y - 14}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, sg); }
    const stressText = simple ? 'The rock bends' : 'Stress builds';
    // the stress label goes once the rock snaps, so nothing faint is left under the shock waves
    const sx0 = fx(yG + 120) - 170;
    const sl = put(lbl, sx0, yG + 172, txt(P, 'label:stress', stressText), { edit: 'text.label:stress', anchor: 'end', maxW: 260, a: { s: ks, cls: 'rise', hide: bi('focus') } },
      [...upFrom(yG + 172, yG + 90), ...[yG + 172, yG + 150].map(y => ({ x: fx(yG + 120) + 190, y, anchor: 'start', maxW: 300 })),
        { maxW: 170 }, ...upFrom(yG + 172, yG + 90).map(c => Object.assign(c, { maxW: 170 }))]);

    // the focus
    const fyy = Math.round(deep ? lerp(yM + 14, yBot - 22, clamp((P.focusDepth - 70) / 630))
      : yG + 34 + (crustBottom - 30 - yG - 34) * Math.sqrt(clamp(P.focusDepth / 70)));
    const fxx = Math.round(fx(fyy) - (deep && bd === 'destructive' ? 40 : 0)); // deep: inside the sinking plate
    const kf = bi('focus');
    // shock waves under every label, kept to the ground and cut away around the labels that stay
    const kw = bi('waves'); const mkId = ctx.uid + '-ground';
    const mk = h('mask', { id: mkId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 1280, height: 720 }, h('defs', {}, mid));
    h('rect', { x: 0, y: yG, width: 1280, height: yBot - yG, fill: 'white' }, mk);
    const wg = h('g', { mask: `url(#${mkId})`, s: kw }, mid); const RINGS = [80, 160, 240, 320];
    const rings = RINGS.map((r, i) => h('circle', { cx: fxx, cy: fyy, r, fill: 'none', stroke: 'var(--energy)', 'stroke-width': 'var(--sw-struct)', opacity: 1 - i * .18 }, wg));
    const setRings = u => rings.forEach((el, i) => el.setAttribute('r', Math.max(0, RINGS[i] * eOut(clamp(u * 1.4 - i * .12)))));
    hooks.dur.waves = 2200;
    hooks.ticks.push((k, u) => setRings(k > kw ? 1 : k === kw ? u : 0)); hooks.stills.push(() => setRings(1)); hooks.resets.push(() => setRings(0));
    const fg = h('g', { s: kf, cls: 'pop' }, top);
    h('path', { d: starD(fxx, fyy, 22, 10, 8), fill: 'var(--event)', stroke: 'var(--bg)', 'stroke-width': 3 }, fg);
    // the fault line and the focus star are marks the focus card (and every later label) keeps off
    { const yEnd = bd === 'destructive' ? yBot : crustBottom;
      for (let y = yG; y < yEnd; y += 30) { const y1 = Math.min(yEnd, y + 30), xa = fx(y), xb = fx(y1); mark({ x: Math.min(xa, xb) - 4, y, w: Math.abs(xb - xa) + 8, h: y1 - y }); } }
    mark({ x: fxx - 24, y: fyy - 24, w: 48, h: 48 }, kf);
    // focus label: name, then the depth (its number is the setting itself). A unit worded as a heading
    // ("Depth in kilometres…") goes on its own line above the number, so it never reads "30 Depth…"
    {
      // a long name and unit that find no clear place try a wider card, then one with the number on the unit's last line
      const LAYS = [{ mw: 380 }, { mw: 440 }, { mw: 440, inline: true }];
      let g = null, pick = null, R = null;
      for (let li = 0; li < LAYS.length && !pick; li++) {
      const { mw, inline } = LAYS[li];
      g = h('g', { s: kf, cls: 'rise' }, lbl); const lx = 0, ly = 0;
      const name = textBlock(g, lx, ly, txt(P, 'label:focus', simple ? 'The rock breaks here' : 'Focus'), { cls: 'ts-label', maxW: mw, maxLines: 4, lh: 34, edit: 'text.label:focus', a: { fill: 'var(--event-text)', cls: 'strong' } });
      const unitS = txt(P, 'label:km', 'km down'), heading = /^[A-Z]/.test(unitS.trim());
      let y = ly + name.h + 4, w = name.w, hh = name.h + 4;
      if (heading) {
        const unit = textBlock(g, lx, y, unitS, { cls: 'ts-label', maxW: mw - (inline ? 70 : 0), maxLines: 4, lh: 34, edit: 'text.label:km', a: { fill: 'var(--ink)' } });
        w = Math.max(w, unit.w);
        if (inline) { // "Depth below the surface 30": the number ends the heading's last line
          const yl = y + (unit.lines.length - 1) * unit.lh, lw = measure(root, unit.lines[unit.lines.length - 1], 'ts-label');
          const num = editable(T(g, lx + lw + 10, yl, fmtKm(P.focusDepth), 'ts-label', { fill: 'var(--ink)', cls: 'strong' }), 'focusDepth');
          w = Math.max(w, lw + 10 + num.getComputedTextLength()); hh += unit.h;
        } else {
          y += unit.h; hh += unit.h;
          const num = editable(T(g, lx, y, fmtKm(P.focusDepth), 'ts-label', { fill: 'var(--ink)', cls: 'strong' }), 'focusDepth');
          w = Math.max(w, num.getComputedTextLength()); hh += 34;
        }
      } else {
        const num = editable(T(g, lx, y, fmtKm(P.focusDepth), 'ts-label', { fill: 'var(--ink)', cls: 'strong' }), 'focusDepth');
        const nw = num.getComputedTextLength();
        const unit = textBlock(g, lx + nw + 8, y, unitS, { cls: 'ts-label', maxW: mw - 80, maxLines: 3, lh: 34, edit: 'text.label:km', a: { fill: 'var(--ink)' } });
        w = Math.max(w, nw + 8 + unit.w); hh += Math.max(34, unit.h);
      }
      var box0 = { x: lx - 16, y: ly - 32, w: w + 32, h: hh + 12 };
      card(g, box0);
      // beside the star (right, then left), stepping down then up; further up or down it gets a leader
      // a sloping fault: the card keeps to one side of the line over its whole height
      const top0 = y0 => y0 + box0.y, bot0 = y0 => y0 + box0.y + box0.h;
      R = y0 => Math.max(fxx + 46, Math.max(fx(top0(y0)), fx(bot0(y0))) + 24 + 16);
      const L = y0 => Math.min(fxx - 30, Math.min(fx(top0(y0)), fx(bot0(y0))) - 24) - box0.w + 16, cands = [];
      for (const dy of [-8, 32, 72, -48, -88, -128, -168, -208]) for (const f of [R, L]) cands.push([f(fyy + dy), fyy + dy]);
      for (const dy of [112, 152]) for (const f of [R, L]) cands.push([f(fyy + dy), fyy + dy]);
      for (const dy of [-60, -100, -140, -180]) cands.push([fxx - box0.w / 2 + 16, fyy - 30 - box0.h + 32 + dy + 60]);
      const clashF = b2 => placed.some(q => !q.faint && q.s < 1e9 && kf < q.e && overlaps(b2, q.b, q.m ? 4 : 16));
      for (const test of [clash, clashF]) { if (pick) break;
        for (const [x, yy] of cands) { const b2 = Object.assign({}, box0, { x: box0.x + x, y: box0.y + yy });
          if (b2.y > yG + 4 && inGrid(b2) && !test(b2, kf, 1e9)) { pick = [x, yy, b2]; break; } } }
      if (!pick && li < LAYS.length - 1) g.remove();
      }
      if (!pick) { ctx.warn('The focus label has no clear place.'); pick = [R(fyy - 8), fyy - 8, Object.assign({}, box0, { x: box0.x + R(fyy - 8), y: box0.y + fyy - 8 })]; }
      g.setAttribute('transform', `translate(${Math.round(pick[0])} ${Math.round(pick[1])})`);
      const fb2 = pick[2]; block(fb2, kf);
      // a card that sits away from the star points at it
      const cxs = clamp(fxx, fb2.x, fb2.x + fb2.w), cys = clamp(fyy, fb2.y, fb2.y + fb2.h);
      if (Math.hypot(cxs - fxx, cys - fyy) > 44) { const dd = Math.hypot(cxs - fxx, cys - fyy);
        leader(h('g', { s: kf, cls: 'rise' }, mid), cxs, cys, fxx + (cxs - fxx) * 26 / dd, fyy + (cys - fyy) * 26 / dd); }
    }
    // the epicentre, straight above the focus
    const ke = bi('epicentre'); const eg = h('g', { s: ke }, mid);
    if (fyy - 26 > yG + 10) h('line', { x1: fxx, y1: fyy - 26, x2: fxx, y2: yG + 8, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 7', cls: 'draw', pathLength: 1 }, eg);
    const ep = h('g', { s: ke, cls: 'pop' }, top);
    h('path', { d: `M${fxx - 14} ${yG} L${fxx} ${yG - 20} L${fxx + 14} ${yG} Z`, fill: 'var(--event)', stroke: 'var(--bg)', 'stroke-width': 2 }, ep);
    const el = lab(lbl, fxx, P.town.show ? 170 : 216, txt(P, 'label:epicentre', simple ? 'Shaking is strongest here' : 'Epicentre'), { edit: 'text.label:epicentre', anchor: 'middle', maxW: 420, a: { s: ke, cls: 'rise' } });
    block(el.box, ke); leader(h('g', { s: ke }, mid), fxx, el.box.y + el.box.h, fxx, yG - 22);
    if (P.magnitude.show) {
      // room up to the epicentre label; a long name wraps, the number beside it on the last line. If no place
      // is clear at that width, a wider card (fewer lines) is tried, left of the epicentre, right of it, or top right
      const x = GRID.left + 16, y = 190; let done = false;
      for (const mw of [clamp(el.box.x - 40 - x - 80, 180, 380), 260, 320, 420, 520]) {
        const g = h('g', { s: ke, cls: 'rise', delay: 400 }, lbl);
        const t1 = textBlock(g, x, y, txt(P, 'label:mag', 'Magnitude'), { cls: 'ts-label', maxW: mw, maxLines: 4, lh: 34, edit: 'text.label:mag', a: { fill: 'var(--ink)' } });
        const yl = y + (t1.lines.length - 1) * t1.lh;
        const v = editable(T(g, x + t1.w + 10, yl + 2, fmtKm(P.magnitude.value), 'ts-num', { fill: 'var(--event-text)' }), 'magnitude.value');
        const box = { x: x - 16, y: y - 36, w: t1.w + 10 + v.getComputedTextLength() + 32, h: 52 + (t1.lines.length - 1) * t1.lh };
        card(g, box);
        const spots = [[0, 0], [0, -20], [0, GRID.subY - 8 - box.y], [el.box.x + el.box.w + 40 - box.x, 0], [el.box.x + el.box.w + 40 - box.x, GRID.subY - 8 - box.y], [GRID.right - box.w + 16 - box.x, GRID.subY - 8 - box.y]];
        const mcut = cutShort(t1, txt(P, 'label:mag', 'Magnitude'));
        let mv = mcut && mw < 520 ? null : spots.find(([dx, dy]) => { const b2 = Object.assign({}, box, { x: box.x + dx, y: box.y + dy }); return b2.y >= GRID.subY - 8 && inGrid(b2) && !clash(b2, ke, 1e9); });
        if (!mv && mw < 520) { g.remove(); continue; }
        if (!mv) { ctx.warn('The magnitude has no clear place.'); mv = [0, 0]; }
        if (mv[0] || mv[1]) g.setAttribute('transform', `translate(${Math.round(mv[0])} ${mv[1]})`);
        block(Object.assign({}, box, { x: box.x + mv[0], y: box.y + mv[1] }), ke); done = true; break;
      }
    }
    // buildings that shake, placed after the labels and never on one
    const shakers = [];
    if (P.town.show) {
      const kinds = sceneryFor(P.town.culture); const pick = kinds.includes('house') ? ['house', ...kinds.filter(k => k !== 'house' && k !== 'field')] : kinds;
      const bg = h('g', { s: 0 }, top); let n = 0; const houses = [];
      for (const dx of [140, -140, 250, -250, 360, -360]) {
        if (!pick.length) break; const x = fxx + dx, sc = .85; const ob = { x: x - 40, y: yG - 100 * sc, w: 80, h: 100 * sc };
        if (x < 120 || x > 1160 || (bd === 'destructive' && x < ft + 40) || labels.some(q => overlaps(ob, q, 8))) continue;
        const o = object(bg, pick[n % pick.length], x, yG, sc); shakers.push({ el: o, a: 7 * (1 - Math.abs(dx) / 520) }); n++;
        let hb = ob; try { const bb = o.getBBox(); if (bb.height) hb = { x: bb.x, y: bb.y, w: bb.width, h: bb.height }; } catch (e) { /* not laid out */ }
        houses.push({ x, b: hb }); mark(hb);
      }
      if (houses.length) {
        mark({ x: fxx - 10, y: el.box.y + el.box.h, w: 20, h: yG - (el.box.y + el.box.h) }, ke); // the epicentre line
        // over a building (centred, or flush with either side of it), wider first, then narrower so it wraps
        let best = null, nl = null;
        for (const mw of [260, 180]) {
          nl = lab(lbl, houses[0].x, yG - 130, P.town.name, { edit: 'town.name', anchor: 'middle', maxW: mw, a: { s: 0 } }); const bw = nl.box.w;
          for (const hs of houses) for (const cx of [hs.x, hs.b.x + bw / 2, hs.b.x + hs.b.w - bw / 2, hs.x + bw / 2 - 40, hs.x - bw / 2 + 40]) {
            const x0 = cx - bw / 2, roof = Math.min(...houses.filter(q => q.b.x < x0 + bw && x0 < q.b.x + q.b.w).map(q => q.b.y));
            const b2 = { x: x0, y: roof - 20 - nl.box.h, w: bw, h: nl.box.h };
            if (inGrid(b2) && !clash(b2, 0, 1e9)) { best = { cx, b2 }; break; }
          }
          if (best) break; nl.remove();
        }
        if (best) { nl.setAttribute('transform', `translate(${Math.round(best.cx - (nl.box.x + nl.box.w / 2))} ${Math.round(best.b2.y - nl.box.y)})`); block(best.b2); }
        else ctx.warn('The town name has no clear place above the buildings, so it is left off.');
      }
    }
    for (const q of labels) if (q !== sl.box) h('rect', { x: q.x - 8, y: q.y - 8, width: q.w + 16, height: q.h + 16, rx: 12, fill: 'black' }, mk);
    hooks.dur.epicentre = 2000;
    hooks.ticks.push((k, u) => { const on = k === ke && u < 1; shakers.forEach(s => s.el.setAttribute('transform', on ? `translate(${(s.a * Math.sin(u * 60) * (1 - u)).toFixed(2)} 0)` : '')); });
    hooks.stills.push(() => shakers.forEach(s => s.el.setAttribute('transform', '')));
    notToScale();
    return finish();
  }

  function finish() {
    return {
      dur: hooks.dur,
      tick(k, u) { hooks.ticks.forEach(f => f(k, u)); },
      still() { hooks.stills.forEach(f => f()); },
      reset() { hooks.resets.forEach(f => f()); },
    };
  }
}
function starD(x, y, R, r, n) { let d = ''; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r : R; d += (i ? ' L' : 'M') + P2(x + rr * Math.cos(a), y + rr * Math.sin(a)); } return d + ' Z'; }

// Map skills: a bird's-eye map (our classroom, the school grounds, a local area, the UK or the
// world) with a key, a compass, a numbered grid and a route. One task is the point of the slide:
// follow a route, compass directions, 4- or 6-figure grid references, key symbols, or scale.
// Every direction, grid reference and distance is worked out in code from where things are on the
// drawn map, so the slide can never say the church is north when it is east.
import {
  h, T, measure, clamp, eIO, GRID,
  textBlock, labelGround, editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result, overlaps,
} from '../kit/index.js';
import { basemap, REGIONS, placeOf, compassRose, gridRefs, scaleBar, route } from '../kit/batch-G.js';

export const meta = {
  id: 'map_skills', name: 'Map skills', kind: 'info', version: 1,
  subjects: ['Geography'],
  years: ['Reception', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Reading a map from above: what the key means, compass directions, grid references, routes and scale.',
};

/* ------------------------------------------------------------------ places on each map */
// Plans are drawn by the kit (school, classroom) or here (local). Positions are fractions of the
// map frame, measured from the drawn shapes, so a symbol always sits on the thing it names.
const SPOTS = {
  school: {
    classrooms: [.23, .23, 'school'], hall: [.355, .45, 'building'], playground: [.20, .735, 'play'], field: [.76, .31, 'goal'],
    garden: [.485, .16, 'flower'], gate: [.535, .955, 'gate'], 'car park': [.77, .8, 'parking'], path: [.45, .60, 'star'],
  },
  classroom: {
    whiteboard: [.5, .085, 'board'], door: [.06, .86, 'door'], windows: [.93, .45, 'window'], "teacher's desk": [.16, .13, 'desk'],
    carpet: [.19, .5, 'carpet'], sink: [.88, .86, 'water'],
    'table 1': [.465, .34, 'table'], 'table 2': [.655, .34, 'table'], 'table 3': [.845, .34, 'table'],
    'table 4': [.465, .66, 'table'], 'table 5': [.655, .66, 'table'], 'table 6': [.845, .66, 'table'],
  },
  local: {
    church: [.47, .12, 'church'], school: [.80, .35, 'school'], shops: [.48, .835, 'shop'], woods: [.12, .46, 'tree'],
    park: [.40, .36, 'tree'], playground: [.48, .46, 'play'], pond: [.39, .55, 'water'], houses: [.15, .15, 'house'],
    farm: [.85, .13, 'building'], 'bus stop': [.6, .665, 'bus'], bridge: [.285, .725, 'bridge'], river: [.30, .28, 'water'],
  },
};
const PLAN = m => m === 'school' || m === 'classroom' || m === 'local';
const SPAN = { classroom: [3, 30], school: [30, 800], local: [200, 8000] }; // how wide each plan can honestly be, in metres
const acrossOf = P => { const sp = SPAN[P.map], a = (P.scale && P.scale.across) || 200; return sp ? clamp(a, sp[0], sp[1]) : a; };
// UK and Ireland, drawn here so Northern Ireland and the Republic can differ (lon, lat; simplified from
// public-domain coastlines). The Bristol Channel is kept clear of Cardiff so its dot sits on land.
const UK_LAND = {
  britain: [[-5.7,50.05],[-5.0,50.0],[-4.2,50.35],[-3.5,50.3],[-3.0,50.7],[-2.0,50.6],[-1.3,50.75],[-0.8,50.75],[0.3,50.75],[1.0,50.95],[1.4,51.15],[1.4,51.38],[0.9,51.5],[0.6,51.55],[0.9,51.75],[1.3,51.95],[1.75,52.45],[1.7,52.75],[1.3,52.95],[0.4,52.95],[0.2,52.85],[0.35,53.2],[0.1,53.55],[-0.1,53.65],[-0.3,54.1],[-0.6,54.5],[-1.2,54.65],[-1.5,55.0],[-1.6,55.6],[-2.0,55.85],[-2.6,56.05],[-2.6,56.3],[-2.8,56.45],[-2.5,56.6],[-2.0,57.15],[-1.8,57.5],[-2.0,57.68],[-3.0,57.7],[-3.6,57.65],[-4.2,57.5],[-3.8,57.85],[-3.1,58.6],[-3.4,58.65],[-4.5,58.55],[-5.0,58.62],[-5.2,58.3],[-5.4,57.9],[-5.7,57.6],[-5.6,57.2],[-5.8,56.8],[-5.6,56.5],[-5.4,56.2],[-5.7,55.7],[-5.6,55.3],[-5.0,55.7],[-4.9,55.2],[-5.15,54.85],[-4.4,54.9],[-3.6,54.95],[-3.4,54.6],[-3.1,54.15],[-2.9,53.75],[-3.1,53.3],[-3.6,53.3],[-4.2,53.2],[-4.6,53.3],[-4.7,52.8],[-4.1,52.75],[-4.1,52.3],[-4.7,52.1],[-5.2,51.9],[-5.1,51.7],[-4.3,51.65],[-3.9,51.55],[-3.2,51.33],[-2.75,51.42],[-3.0,51.18],[-3.6,51.17],[-4.2,51.2],[-4.6,51.0],[-4.5,50.8],[-5.0,50.55],[-5.5,50.2]],
  ireland: [[-6.2,53.3],[-6.0,52.95],[-6.0,52.6],[-6.4,52.18],[-7.0,52.13],[-7.6,51.95],[-8.2,51.8],[-9.0,51.6],[-9.8,51.5],[-10.3,51.8],[-9.9,52.1],[-10.4,52.2],[-9.6,52.6],[-9.4,53.0],[-10.0,53.4],[-9.9,53.9],[-10.0,54.2],[-9.1,54.3],[-8.5,54.3],[-8.6,54.65],[-8.3,55.1],[-7.6,55.25],[-6.9,55.2],[-6.1,55.2],[-5.6,54.7],[-5.5,54.4],[-6.1,54.0],[-6.3,53.85]],
  ni: [[-7.25,55.05],[-6.9,55.2],[-6.1,55.2],[-5.6,54.7],[-5.5,54.4],[-6.05,54.05],[-6.3,54.1],[-7.0,54.4],[-7.6,54.15],[-8.15,54.45],[-7.55,54.75]],
};
const IRISH_BORDER = [[-7.25,55.05],[-7.55,54.75],[-8.15,54.45],[-7.6,54.15],[-7.0,54.4],[-6.3,54.1],[-6.05,54.05]];
const MAP_NAMES = { classroom: 'the classroom', school: 'the school grounds', local: 'the local area', uk: 'the UK', world: 'the world' };
const SYMS = ['auto', 'house', 'school', 'building', 'church', 'tree', 'flower', 'water', 'parking', 'play', 'goal', 'gate', 'shop', 'bus', 'bridge', 'table', 'board', 'door', 'window', 'desk', 'carpet', 'city', 'star', 'flag'];
const SYM_LABELS = ['Automatic', 'House', 'School', 'Building', 'Church', 'Tree', 'Flower', 'Water', 'Car park', 'Swing (play)', 'Goal (sport)', 'Gate', 'Shop', 'Bus', 'Bridge', 'Table', 'Board', 'Door', 'Window', 'Desk', 'Carpet', 'Town or city', 'Star (capital or special place)', 'Flag'];
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const NORTH = { up: 0, right: 90, down: 180, left: 270 };

const FEATURE = {
  type: 'object', required: ['place', 'label'], default: { place: 'hall', label: 'The hall', symbol: 'auto', ref: '' }, properties: {
    place: { type: 'string', title: 'Where it is', description: 'A place on the map, like “hall”, “church” or “London”. On the classroom, school or local map you can also give squares from the bottom-left corner: “3.5, 2” means 3½ along and 2 up.', minLength: 1, maxLength: 40 },
    label: { type: 'string', title: 'What to call it', minLength: 1, maxLength: 60 },
    symbol: { type: 'string', title: 'Symbol', enum: SYMS, 'x-labels': SYM_LABELS, default: 'auto' },
    ref: { type: 'string', title: 'Grid reference (to check)', description: 'Optional. Type the reference you expect and the slide checks it. Leave empty to work it out.', maxLength: 6, default: '', 'x-panel': 'advanced' },
  },
};

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Map skills',
  properties: {
    title: TITLE_PARAM('A map of our school'),
    map: { type: 'string', title: 'Map of', enum: ['classroom', 'school', 'local', 'uk', 'world'], 'x-labels': ['Our classroom', 'The school grounds', 'The local area', 'The UK', 'The world'], default: 'school' },
    task: { type: 'string', title: 'What we practise', enum: ['route', 'compass', 'grid4', 'grid6', 'key', 'scale'], 'x-labels': ['Following a route', 'Compass directions', '4-figure grid references', '6-figure grid references', 'Key symbols', 'Scale and distance'], default: 'route' },
    features: { type: 'array', title: 'Places on the map', 'x-item': 'a place', maxItems: 6, items: FEATURE,
      default: [{ place: 'classrooms', label: 'Our classroom' }, { place: 'hall', label: 'The hall' }, { place: 'playground', label: 'The playground' }, { place: 'gate', label: 'The gate' }] },
    route: { type: 'object', title: 'Route', description: 'Places to visit in order, by name.', default: { stops: ['gate', 'hall', 'classrooms'], along: 'straight' }, properties: {
      stops: { type: 'array', title: 'Stops in order', 'x-item': 'a stop', maxItems: 5, items: { type: 'string', title: 'Stop', default: 'hall', minLength: 1, maxLength: 40 }, default: ['gate', 'hall', 'classrooms'] },
      along: { type: 'string', title: 'The route goes', enum: ['straight', 'grid', 'grid-v'], 'x-labels': ['In straight lines', 'Across first, then up or down (turning at corners)', 'Up or down first, then across (turning at corners)'], default: 'straight' },
    } },
    centre: { type: 'object', title: 'Directions from', description: 'For compass directions: the place we stand.', default: { place: 'playground', label: 'The playground' }, properties: {
      place: { type: 'string', title: 'Where we stand', minLength: 1, maxLength: 40, default: 'playground' },
      label: { type: 'string', title: 'What to call it', minLength: 1, maxLength: 60, default: 'The playground' },
    } },
    show: { type: 'object', title: 'Show on the map', default: { picture: false, key: false, compass: true, grid: false }, properties: {
      picture: { type: 'boolean', title: 'Start from a picture, then look from above', default: false },
      key: { type: 'boolean', title: 'A key (names go in the key, not on the map)', default: false },
      compass: { type: 'boolean', title: 'A compass', default: true },
      grid: { type: 'boolean', title: 'Grid squares', default: false },
    } },
    compass: { type: 'object', title: 'Compass', 'x-panel': 'advanced', default: { points: '4', north: 'up' }, properties: {
      points: { type: 'string', title: 'Compass points', enum: ['4', '8'], 'x-labels': ['4 points (N, E, S, W)', '8 points (adds NE, SE, SW, NW)'], default: '4' },
      north: { type: 'string', title: 'North points', description: 'Real maps of the UK and the world always have north at the top.', enum: ['up', 'right', 'down', 'left'], 'x-labels': ['Up the page', 'To the right', 'Down the page', 'To the left'], default: 'up' },
    } },
    grid: { type: 'object', title: 'Grid', 'x-panel': 'advanced', default: { cols: 8, rows: 5, e0: 0, n0: 0 }, properties: {
      cols: { type: 'integer', title: 'Squares across', minimum: 2, maximum: 12, default: 8 },
      rows: { type: 'integer', title: 'Squares up', minimum: 2, maximum: 8, default: 5 },
      e0: { type: 'integer', title: 'First number along the bottom', minimum: 0, maximum: 88, default: 0 },
      n0: { type: 'integer', title: 'First number up the side', minimum: 0, maximum: 92, default: 0 },
    } },
    scale: { type: 'object', title: 'Scale', 'x-panel': 'advanced', default: { across: 200, bar: 50 }, properties: {
      across: { type: 'number', title: 'How wide the mapped area really is (metres)', description: 'For the classroom, school or local map. The UK and world maps work this out for you.', minimum: 1, maximum: 20000, default: 200 },
      bar: { type: 'number', title: 'Scale bar length (metres, or km on the UK map)', minimum: 1, maximum: 5000, default: 50 },
    } },
    text: TEXT_PARAM_FOR({ N: 'label', E: 'label', S: 'label', W: 'label', key: 'label', up: 'label', along: 'phrase', roi: 'label' }),
  },
};

export const presets = [
  { id: 'r-our-school', name: 'Reception: a map of our school', params: {
    title: 'A map of our school', map: 'school', task: 'route',
    show: { picture: true, key: true, compass: false, grid: false },
    features: [{ place: 'classrooms', label: 'Our classroom' }, { place: 'hall', label: 'The hall' }, { place: 'playground', label: 'The playground' }, { place: 'field', label: 'The field' }, { place: 'gate', label: 'The gate' }],
    route: { stops: ['gate', 'hall', 'classrooms'], along: 'grid-v' },
  } },
  { id: 'y3-compass', name: 'Year 3: four compass points around the playground', params: {
    title: 'What is north of the playground?', map: 'local', task: 'compass',
    show: { picture: false, key: false, compass: true, grid: false },
    centre: { place: 'playground', label: 'The playground' },
    features: [{ place: 'church', label: 'The church' }, { place: 'school', label: 'Our school' }, { place: 'shops', label: 'The shops' }, { place: 'woods', label: 'The woods' }],
    route: { stops: [], along: 'straight' },
  } },
  { id: 'y5-uk-scale', name: 'Year 5: how far? Using a scale bar', params: {
    title: 'How far is it from London to Edinburgh?', map: 'uk', task: 'scale',
    show: { picture: false, key: false, compass: true, grid: false },
    features: [{ place: 'London', label: 'London', symbol: 'star' }, { place: 'York', label: 'York' }, { place: 'Edinburgh', label: 'Edinburgh' }, { place: 'Cardiff', label: 'Cardiff' }, { place: 'Belfast', label: 'Belfast' }],
    route: { stops: ['London', 'York', 'Edinburgh'], along: 'straight' }, scale: { across: 200, bar: 500 },
  } },
  { id: 'y6-six-figure', name: 'Year 6: six-figure grid references', params: {
    title: 'Six-figure grid references', map: 'local', task: 'grid6',
    show: { picture: false, key: false, compass: true, grid: true },
    grid: { cols: 8, rows: 5, e0: 40, n0: 20 },
    features: [{ place: 'church', label: 'The church' }, { place: 'bridge', label: 'The bridge' }, { place: 'pond', label: 'The pond' }, { place: 'bus stop', label: 'The bus stop' }],
    route: { stops: [], along: 'straight' },
  } },
];

/* ------------------------------------------------------------------ geometry (pure: validate uses it too) */
// The map fills the stage; the side column (compass, key, scale) sits right beside it and the pair is
// centred, so there is no empty half-slide. The UK view is cropped to Britain and Ireland.
const SCW = 280, GAP = 40;
const UKV = { lon: [-10.6, 2.0], lat: [49.85, 58.8] };
const viewOf = m => m === 'uk' ? UKV : REGIONS[m];
const titleCase = s => s ? s[0].toUpperCase() + s.slice(1) : s;
function geom(P) {
  const m = P.map, gr = P.grid || {}; const cols = gr.cols || 8, rows = gr.rows || 5;
  const gridOn = !!(P.show && P.show.grid) || P.task === 'grid4' || P.task === 'grid6';
  const side = !!(P.show && (P.show.compass || P.show.key)) || ['compass', 'key', 'scale'].includes(P.task);
  const L0 = GRID.left + (gridOn ? 76 : 0), top = GRID.top + 8;
  const availW = GRID.right - L0, availH = (gridOn ? 589 : 636) - top, boxW = availW - (side ? SCW + GAP : 0);
  let fw, fh, proj, mPerUnit, frame, k = 1, V, kx = 1;
  if (PLAN(m)) { const cell = Math.min(boxW / cols, availH / rows); fw = cols * cell; fh = rows * cell; }
  else {
    V = viewOf(m); const lat0 = (V.lat[0] + V.lat[1]) / 2; kx = m === 'world' ? 1 : Math.cos(lat0 * Math.PI / 180);
    const W0 = (V.lon[1] - V.lon[0]) * kx, H0 = V.lat[1] - V.lat[0]; k = Math.min(boxW / W0, availH / H0); fw = W0 * k; fh = H0 * k;
  }
  frame = { x: L0 + (availW - fw - (side ? SCW + GAP : 0)) / 2, y: top + (availH - fh) / 2, w: fw, h: fh };
  if (PLAN(m)) { proj = (fx, fy) => [frame.x + fx * frame.w, frame.y + fy * frame.h]; mPerUnit = acrossOf(P) / frame.w; }
  else { proj = (lon, lat) => [frame.x + (lon - V.lon[0]) * kx * k, frame.y + (V.lat[1] - lat) * k]; mPerUnit = 111320 / k; } // a degree of latitude is about 111 km; true along the standard parallel
  let cols2 = cols, rows2 = rows;
  if (!PLAN(m) && gridOn) { cols2 = Math.min(cols, Math.max(2, Math.floor(fw / 60))); rows2 = Math.min(rows, Math.max(2, Math.floor(fh / 60))); }
  const cw = frame.w / cols2, ch = frame.h / rows2;
  const north = PLAN(m) ? NORTH[(P.compass && P.compass.north) || 'up'] || 0 : 0; // real maps always have north at the top
  const SC = { x: frame.x + fw + GAP, y: frame.y, w: SCW };
  const BOUNDS = { x: GRID.left, y: GRID.top + 4, w: (side ? SC.x - 16 : GRID.right) - GRID.left, h: 636 - GRID.top - 4 }; // where map labels may go
  return { m, frame, proj, mPerUnit, cols: cols2, rows: rows2, gridCut: cols2 !== cols || rows2 !== rows, cw, ch, e0: gr.e0 || 0, n0: gr.n0 || 0, north, SC, BOUNDS, side };
}
const CUSTOM = /^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/;
function locate(G, place) {
  const name = String(place || '').trim(); const key = name.toLowerCase();
  if (PLAN(G.m)) {
    const S = SPOTS[G.m]; const hit = Object.keys(S).find(k => k === key || k + 's' === key || k === key + 's');
    if (hit) { const [fx, fy, sym] = S[hit]; const [x, y] = G.proj(fx, fy); return { x, y, sym, name: hit }; }
    const c = name.match(CUSTOM);
    if (c) { const a = +c[1], u = +c[2]; if (a > G.cols || u > G.rows) return { error: `“${name}” is off the map: it is ${G.cols} squares across and ${G.rows} up.` };
      return { x: G.frame.x + a * G.cw, y: G.frame.y + G.frame.h - u * G.ch, sym: 'flag', name, custom: true }; }
    return { error: `There is no “${name}” on the map of ${MAP_NAMES[G.m]}. Choose one of: ${Object.keys(S).join(', ')}; or give squares, like “3.5, 2”.` };
  }
  if (CUSTOM.test(name)) return { error: `On a real map, places sit where they really are, so choose a place by name (like “York”), not by squares.` };
  const q = placeOf(name); if (!q) return { error: `“${name}” is not in our list of real places, so we can’t put it where it really is. Try a nearby city.` };
  const [x, y] = G.proj(q[0], q[1]); const f = G.frame;
  if (x < f.x + 4 || x > f.x + f.w - 4 || y < f.y + 4 || y > f.y + f.h - 4) return { error: `${name} is not on the map of ${MAP_NAMES[G.m]}. Use the world map, or pick a place on this one.` };
  return { x, y, sym: 'city', name };
}
const bearing = (G, a, b) => ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI - G.north) % 360 + 720) % 360;
const dirWord = (deg, pts) => pts === 8 ? DIRS[Math.round(deg / 45) % 8] : DIRS[(Math.round(deg / 90) % 4) * 2];
const pad2 = v => String(v).padStart(2, '0');
function gridPos(G, p) { return { e: G.e0 + (p.x - G.frame.x) / G.cw, n: G.n0 + (G.frame.y + G.frame.h - p.y) / G.ch }; }
const ref4 = (G, p) => { const { e, n } = gridPos(G, p); return pad2(Math.floor(e)) + pad2(Math.floor(n)); };
const ref6 = (G, p) => { const { e, n } = gridPos(G, p); const t = v => Math.floor((v - Math.floor(v)) * 10 + 1e-6); return pad2(Math.floor(e)) + t(e) + pad2(Math.floor(n)) + t(n); };
function niceDist(G, units) {
  const m = units * G.mPerUnit;
  if (G.m === 'uk' || G.m === 'world') return `${Math.round(m / 10000) * 10} km`;
  if (m < 30) return `${Math.round(m * 2) / 2} m`;
  if (m < 1000) return `${Math.round(m / 5) * 5} m`;
  return `${(Math.round(m / 100) / 10).toLocaleString('en-GB')} km`;
}
const unitsOf = G => (G.m === 'uk' || G.m === 'world') ? 'km' : 'm';
const barUnits = (G, bar) => G.m === 'uk' || G.m === 'world' ? bar * 1000 / G.mPerUnit : bar / G.mPerUnit;

const STARTER = {
  classroom: { centre: 'carpet', stops: ['door', 'carpet', 'table 2'] },
  school: { centre: 'playground', stops: ['gate', 'hall', 'classrooms'] },
  local: { centre: 'playground', stops: ['bridge', 'pond', 'church'] },
  uk: { centre: 'York', stops: ['London', 'York', 'Edinburgh'], places: ['London', 'York', 'Edinburgh', 'Cardiff', 'Belfast', 'Dublin'] },
  world: { centre: 'Cairo', stops: ['London', 'Cairo', 'Nairobi'], places: ['London', 'New York', 'Cairo', 'Delhi', 'Beijing', 'Sydney', 'Rio de Janeiro', 'Lagos'] },
};
// True when the map holds none of these places: the map was switched, not one place mistyped.
const ownName = (G, n) => PLAN(G.m) && !/^table/.test(n) ? 'The ' + n : titleCase(n); // a starter place's name, as the slide says it
const foreignList = (G, names) => names.length > 0 && names.every(n => locate(G, n).error);
function model(P) {
  const G = geom(P);
  const foreign = foreignList(G, (P.features || []).map(f => f.place)); const ST = STARTER[G.m];
  const foreignStops = foreignList(G, P.route.stops || []);
  const centreOwn = P.task === 'compass' && foreign && locate(G, P.centre.place).error;
  const pts0 = P.compass && P.compass.points === '8' ? 8 : 4;
  const C0 = P.task === 'compass' ? (centreOwn ? Object.assign(locate(G, ST.centre), { label: ownName(G, ST.centre), derived: true }) : Object.assign(locate(G, P.centre.place), { label: P.centre.label })) : null;
  let feats;
  if (foreign) {
    // the map's own places, keeping only those the task's truth rules accept (clear directions, off the grid lines)
    const all = PLAN(G.m) ? Object.keys(SPOTS[G.m]) : ST.places; const routeFirst = (P.task === 'route' || P.task === 'scale') && foreignStops;
    const names = routeFirst ? [...ST.stops, ...all.filter(n => !ST.stops.includes(n))] : all; // the route's stops are named first
    const ok = L => { if (L.error) return false;
      if (C0) { if (Math.hypot(L.x - C0.x, L.y - C0.y) < 30) return false; const d = bearing(G, C0, L); if (pts0 === 4 && Math.abs(((d + 45) % 90) - 45) > 22.5) return false; }
      if (P.task === 'grid4' || P.task === 'grid6') { const { e, n } = gridPos(G, L); const near = v => Math.abs(v - Math.round(v)) < .04; if (near(e) || near(n)) return false; }
      return true; };
    // one place per direction first, so the starter set teaches more than one word
    const cand = names.map(n => locate(G, n)).filter(ok); const seen = new Set(), first = [], rest = [];
    for (const L of cand) { const w = C0 ? dirWord(bearing(G, C0, L), pts0) : L.name; (seen.has(w) ? rest : first).push(L); seen.add(w); }
    feats = [...first, ...rest].slice(0, PLAN(G.m) ? 4 : 3).map((L, i) => Object.assign({}, L, { i, label: ownName(G, L.name), derived: true }));
  } else feats = (P.features || []).map((f, i) => { const L = locate(G, f.place); return Object.assign({}, L, { i, label: f.label, sym: f.symbol && f.symbol !== 'auto' ? f.symbol : L.sym }); });
  const showGrid = !!(P.show && P.show.grid) || P.task === 'grid4' || P.task === 'grid6';
  const showCompass = !!(P.show && P.show.compass) || P.task === 'compass';
  const keyMode = !!(P.show && P.show.key) || P.task === 'key';
  const pts = P.compass && P.compass.points === '8' ? 8 : 4;
  const C = C0;
  const useRoute = P.task === 'route' || P.task === 'scale';
  const stops = useRoute ? (foreignStops ? ST.stops : (P.route.stops || [])).map(s => { const L = locate(G, s); const f = feats.find(q => !q.error && !L.error && Math.abs(q.x - L.x) < 1 && Math.abs(q.y - L.y) < 1); return Object.assign({}, L, { label: f ? f.label : (L.error ? s : ownName(G, L.name)), feat: f }); }) : [];
  const along = (P.route.along === 'grid' || P.route.along === 'grid-v') && P.task !== 'scale' && PLAN(G.m) ? 'grid' : 'straight'; const upFirst = P.route.along === 'grid-v';
  // legs: each is one or two straight moves; along the grid, the move along the corridor comes first
  const legs = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i]; if (a.error || b.error) continue;
    const pts2 = along === 'grid' && Math.abs(a.x - b.x) > 2 && Math.abs(a.y - b.y) > 2 ? [[a.x, a.y], upFirst ? [a.x, b.y] : [b.x, a.y], [b.x, b.y]] : [[a.x, a.y], [b.x, b.y]];
    const moves = []; for (let j = 1; j < pts2.length; j++) { const p0 = { x: pts2[j - 1][0], y: pts2[j - 1][1] }, p1 = { x: pts2[j][0], y: pts2[j][1] };
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y); moves.push({ p0, p1, len, dir: dirWord(bearing(G, p0, p1), along === 'grid' ? 4 : pts), deg: bearing(G, p0, p1), sq: along === 'grid' ? len / (Math.abs(p1.x - p0.x) > 1 ? G.cw : G.ch) : null }); }
    legs.push({ i: i - 1, a, b, pts: pts2, moves, len: moves.reduce((s, q) => s + q.len, 0) });
  }
  return { G, feats, showGrid, showCompass, keyMode, pts, C, stops, legs, along, foreign, foreignStops, centreOwn };
}
const sqWord = n => { const r = Math.round(n); const near = Math.abs(n - r) < .2; return `${near ? '' : 'about '}${r} square${r === 1 ? '' : 's'}`; };
function legPhrase(M, L) {
  if (!M.showCompass) return '';
  return L.moves.map(q => M.along === 'grid' && M.showGrid ? `${q.dir} ${sqWord(q.sq)}` : q.dir).join(', then ');
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const real = !PLAN(P.map);
  if (real && P.compass.north !== 'up') W.push({ path: 'compass.north', reason: `Maps of ${MAP_NAMES[P.map]} are always drawn with north at the top, so the compass stays pointing up.` });
  if (real && P.show.picture) W.push({ path: 'show.picture', reason: 'Starting from a picture works for the classroom, the school grounds or the local area, which we can draw from the side. This map starts from above.' });
  if (P.map === 'world' && P.task === 'scale') R.push({ path: 'task', reason: 'A flat world map stretches distances away from the equator, so one scale bar can’t be true everywhere. Use the UK map, or a local map, for scale.' });
  if (R.length) return result(R);
  const M = model(P); const G = M.G;
  if (M.foreign) W.push({ path: 'features', reason: `None of the places you chose are on the map of ${MAP_NAMES[P.map]}, so the slide shows some of its own places. Change the places to choose your own.` });
  if (M.foreignStops && (P.task === 'route' || P.task === 'scale')) W.push({ path: 'route.stops', reason: `None of the stops are on the map of ${MAP_NAMES[P.map]}, so the slide uses a route of its own. Change the stops to choose your own.` });
  if (M.centreOwn) W.push({ path: 'centre.place', reason: `${P.centre.place} is not on the map of ${MAP_NAMES[P.map]}, so the directions start from the ${STARTER[P.map].centre}.` });
  if (M.foreign && !M.feats.length && P.task !== 'route' && P.task !== 'scale') R.push({ path: 'map', reason: `None of the places you chose are on the map of ${MAP_NAMES[P.map]}. Choose places on this map first.` });
  if (G.gridCut) W.push({ path: 'grid.cols', reason: `On ${MAP_NAMES[P.map]} the squares would be too small to read, so the grid shows ${G.cols} across and ${G.rows} up.` });
  M.feats.forEach(f => { if (f.error) R.push({ path: `features.${f.i}.place`, reason: f.error }); });
  if (M.C && M.C.error) R.push({ path: 'centre.place', reason: M.C.error });
  M.stops.forEach((s, i) => { if (s.error) R.push({ path: `route.stops.${i}`, reason: s.error }); });
  if (R.length) return result(R);
  if (M.feats.length < 1 && P.task !== 'route' && P.task !== 'scale') R.push({ path: 'features', reason: 'Add at least one place to the map for this task.' });
  if ((P.task === 'route' || P.task === 'scale') && M.stops.length < 2) R.push({ path: 'route.stops', reason: 'A route needs at least two stops: where it starts and where it ends.' });
  for (let i = 1; i < M.stops.length; i++) if (Math.hypot(M.stops[i].x - M.stops[i - 1].x, M.stops[i].y - M.stops[i - 1].y) < 30) R.push({ path: `route.stops.${i}`, reason: `Stop ${i + 1} is in the same place as stop ${i}, so there is nowhere to go. Choose a different place.` });
  // compass words have to be true: four points only for things that really are N, E, S or W
  if (M.C) M.feats.forEach(f => {
    if (Math.hypot(f.x - M.C.x, f.y - M.C.y) < 30) { R.push({ path: `features.${f.i}.place`, reason: `${f.label} is where we are standing, so it has no direction. Choose another place.` }); return; }
    const d = bearing(G, M.C, f); const off = Math.abs(((d + 45) % 90) - 45);
    if (M.pts === 4 && off > 22.5) R.push({ path: `features.${f.i}.place`, reason: `${f.label} is ${DIRS[Math.round(d / 45) % 8]} of ${M.C.label.replace(/^The /, 'the ')}, between two of the four points. Use 8 compass points, or choose a place that is clearly north, east, south or west.` });
  });
  // the same for straight route legs: a 4-point word only when the 8-point word would be the same
  if (P.task === 'route' && M.showCompass && M.along === 'straight' && M.pts === 4) M.legs.forEach(L => L.moves.forEach(q => {
    if (Math.abs(((q.deg + 45) % 90) - 45) > 22.5) R.push({ path: `route.stops.${L.i + 1}`, reason: `From ${nm(L.a.label)} to ${nm(L.b.label)} goes ${DIRS[Math.round(q.deg / 45) % 8]}, between two of the four points. Use 8 compass points, or set the route to go “Across first, then up or down”.` });
  }));
  if (M.showGrid) {
    if (PLAN(G.m) && Math.min(G.cw, G.ch) < 48) R.push({ path: 'grid.cols', reason: `The squares would be too small to read from the back of the room. Use fewer squares across or up.` });
    // a reference has to name one square: a place sitting on a grid line is ambiguous
    if (P.task === 'grid4' || P.task === 'grid6') M.feats.forEach(f => {
      const { e, n } = gridPos(G, f); const near = v => Math.abs(v - Math.round(v)) < .04;
      if (near(e) || near(n)) R.push({ path: 'grid.cols', reason: `${f.label} sits right on a grid line, so its square is not clear. Change the number of squares, or move it.` });
      const want = P.task === 'grid4' ? ref4(G, f) : ref6(G, f); const typed = f.derived ? '' : String(P.features[f.i].ref || '').replace(/\s+/g, '');
      if (typed && typed !== want) {
        const half = want.length / 2, a = want.slice(0, half), u = want.slice(half);
        const swapped = typed === u + a;
        R.push({ path: `features.${f.i}.ref`, reason: swapped ? `${typed} reads up the stairs first. Go along the corridor first, then up the stairs: ${nm(f.label)} ${isAre(f.label)} at ${want}.` : `${f.label} ${isAre(f.label)} at ${want}, not ${typed}: along to ${a}, then up to ${u}.` });
      }
    });
  }
  if (P.task === 'scale') {
    const span = SPAN[P.map];
    if (span && (P.scale.across < span[0] || P.scale.across > span[1])) W.push({ path: 'scale.across', reason: `A map of ${MAP_NAMES[P.map]} is usually between ${span[0]} and ${span[1].toLocaleString('en-GB')} metres across, not ${P.scale.across.toLocaleString('en-GB')}, so the slide uses ${acrossOf(P).toLocaleString('en-GB')} metres. Measure it on a real map and type that.` });
    const B = barOf(G, P);
    if (!R.length && B.changed) W.push({ path: 'scale.bar', reason: `A ${P.scale.bar.toLocaleString('en-GB')} ${unitsOf(G)} bar would be ${B.short ? 'too short to measure with' : 'longer than the space for it'} on this map, so the slide uses ${B.bar.toLocaleString('en-GB')} ${unitsOf(G)}.` });
  }
  return result(R, W);
}
// the bar the slide draws: the teacher's, or the nearest round length that fits the side column
function barOf(G, P) {
  const bar = P.scale.bar, bu = barUnits(G, bar);
  if (bu >= 60 && bu <= SCW - 16) return { bar, bu, changed: false };
  const v = (G.m === 'uk' || G.m === 'world') ? 160 * G.mPerUnit / 1000 : 160 * G.mPerUnit; const p = Math.pow(10, Math.floor(Math.log10(v)));
  const best = [1, 2, 2.5, 5, 10].map(c => c * p).filter(c => { const u = barUnits(G, c); return u >= 60 && u <= SCW - 16; }).sort((a, b) => Math.abs(barUnits(G, a) - 160) - Math.abs(barUnits(G, b) - 160))[0] || p;
  return { bar: best, bu: barUnits(G, best), changed: true, short: bu < 60 };
}
function niceBar(G, units) { const v = (G.m === 'uk' || G.m === 'world') ? units * G.mPerUnit / 1000 : units * G.mPerUnit; const p = Math.pow(10, Math.floor(Math.log10(v))); const s = [1, 2, 5, 10].find(c => c * p >= v * .7) * p; return s; }

/* ------------------------------------------------------------------ builds */
const isAre = s => /[^su]s$/i.test(String(s).trim().split(/\s+/).pop()) ? 'are' : 'is';
const tenths = d => `${d} tenth${d === '1' ? '' : 's'}`;
const nm = s => String(s).replace(/^(The|Our|Table) /, m => m.toLowerCase());
function plan(P) {
  const M = model(P); const G = M.G; const items = [];
  const plans = PLAN(G.m);
  if (P.show.picture && plans) {
    items.push({ key: 'picture', caption: { school: 'These are our school grounds, seen from the side.', classroom: 'This is our classroom, seen from the side.', local: 'This is where we live, seen from the side.' }[G.m] });
    items.push({ key: 'map', caption: 'Now we look down from above, like a bird. A map shows things from above.' });
  } else items.push({ key: 'map', caption: `A map of ${MAP_NAMES[G.m]}, seen from above.` });
  if (P.task === 'key') M.feats.forEach(f => items.push({ key: `sym:${f.i}`, caption: `On the map, this symbol means ${nm(f.label)}.` }));
  else if (M.keyMode) items.push({ key: 'key', caption: 'The key tells us what each symbol on the map means.' });
  if (M.showCompass) items.push({ key: 'compass', caption: G.north === 0 ? 'The compass shows which way is north. On this map, north is at the top.' : `The compass shows which way is north. On this map, north points ${P.compass.north === 'down' ? 'down the page' : 'to the ' + P.compass.north}.` });
  if (M.showGrid) items.push({ key: 'grid', caption: P.task === 'grid4' || P.task === 'grid6' ? 'Grid lines are numbered. Read along the corridor first, then up the stairs.' : 'Grid squares help us find things on the map.' });
  if (P.task === 'scale') items.push({ key: 'scale', caption: `The scale bar shows how far ${barOf(G, P).bar.toLocaleString('en-GB')} ${unitsOf(G)} is on this map.` });
  if (P.task === 'route' || P.task === 'scale') M.legs.forEach(L => {
    const ph = legPhrase(M, L);
    const cap = P.task === 'scale' ? `${L.a.label} to ${L.b.label} is about ${niceDist(G, L.len).replace(/^about /, '')}${M.along === 'straight' ? ' as the crow flies' : ''}.`
      : ph ? `From ${nm(L.a.label)}, go ${ph} to ${nm(L.b.label)}.` : `From ${nm(L.a.label)}, go to ${nm(L.b.label)}.`;
    items.push({ key: `leg:${L.i}`, caption: cap.replace(/^./, c => c.toUpperCase()) });
  });
  if (P.task === 'compass') M.feats.forEach(f => items.push({ key: `dir:${f.i}`, caption: `${f.label} ${isAre(f.label)} ${dirWord(bearing(G, M.C, f), M.pts)} of ${nm(M.C.label)}.` }));
  if (P.task === 'grid4' || P.task === 'grid6') M.feats.forEach(f => {
    const r = P.task === 'grid4' ? ref4(G, f) : ref6(G, f); const half = r.length / 2;
    const how = P.task === 'grid4' ? `along to ${r.slice(0, 2)}, then up to ${r.slice(2)}` : `along ${r.slice(0, 2)} and ${tenths(r[2])}, then up ${r.slice(3, 5)} and ${tenths(r[5])}`;
    items.push({ key: `ref:${f.i}`, caption: `${f.label} is at ${r}: ${how}.`, half });
  });
  let summary;
  if (P.task === 'route') summary = `The whole route: ${M.stops.map(s => nm(s.label)).join(', then ')}.`;
  else if (P.task === 'scale') { const tot = M.legs.reduce((s, L) => s + L.len, 0); summary = `${M.stops[0].label} to ${M.stops[M.stops.length - 1].label}${M.stops.length > 2 ? ` by way of ${M.stops.slice(1, -1).map(s => s.label).join(' and ')}` : ''}: about ${niceDist(G, tot)}.`; }
  else if (P.task === 'compass') summary = `Every place has a direction from ${nm(M.C.label)}.`;
  else if (P.task === 'key') summary = 'The key tells us what every symbol on the map means.';
  else summary = 'Each place has its own grid reference: along the corridor first, then up the stairs.';
  if (summary.length > 120) summary = P.task === 'route' ? `The whole route, from ${nm(M.stops[0].label)} to ${nm(M.stops[M.stops.length - 1].label)}.` : summary;
  return { M, items, summary };
}
export function builds(P) { P = withDefaults(params, P); const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  P = withDefaults(params, P);
  const { M, items } = plan(P); const G = M.G; const plans = PLAN(G.m);
  const steps = items.map(it => {
    const k = it.key;
    if (k === 'picture') return 'Ask: what can you see? Which things are near, which are far? Then say we will look from above, like a bird or a drone.';
    if (k === 'map') return plans ? 'A map shows things from above, as flat shapes. Ask children to find the shapes they saw in the picture. This plan is a model, not drawn exactly to scale.'
      : `The coastline is simplified. ${G.m === 'uk' ? 'Distances are true along the middle of the map and a little out at the top and bottom.' : 'A flat world map stretches places near the poles, so Greenland looks bigger than it is.'}`;
    if (k === 'key') return 'Point to each symbol, then find it in the key. Ask: why do maps use symbols instead of pictures?';
    if (k.startsWith('sym:')) { const f = M.feats[+k.slice(4)]; return `Ask: where else might you see this symbol? Find ${nm(f.label)} on the map.`; }
    if (k === 'compass') return G.north === 0 ? 'Remember: Never Eat Shredded Wheat (N, E, S, W clockwise). North is at the top of most maps.' : 'This map is turned, so north is not at the top. Ask children to turn the page until N points up and check the directions again.';
    if (k === 'grid') return it.caption.includes('corridor') ? 'Eastings run along the bottom; northings run up the side. Along the corridor, then up the stairs.' : 'Use the squares to say where things are: “in the square next to the hall”.';
    if (k === 'scale') return `The bar is drawn true for this map: ${G.m === 'uk' ? 'it is exact along the middle latitude of the map.' : 'it matches the real width you gave.'} Model measuring with a strip of paper.`;
    if (k.startsWith('leg:')) { const L = M.legs[+k.slice(4)]; return P.task === 'scale' ? `Measure ${L.a.label} to ${L.b.label} with a strip of paper, then lay it along the bar. Real roads are longer than a straight line.` : (M.showCompass ? 'Ask a child to give the direction before you reveal it.' : 'Trace the route with a finger. Ask: what do we pass on the way?'); }
    if (k.startsWith('dir:')) return 'Stand in the middle and face north. Ask: what is on your right? That is east.';
    if (k.startsWith('ref:')) { const f = M.feats[+k.slice(4)]; const { e, n } = gridPos(G, f); return P.task === 'grid6' ? `Count tenths inside the square: about ${Math.floor((e % 1) * 10)} along and ${Math.floor((n % 1) * 10)} up.` : `Use the bottom-left corner of the square: easting ${Math.floor(e)}, northing ${Math.floor(n)}.`; }
    return '';
  });
  return { steps, summary: 'Ask the class to give directions, references or distances for a place you choose.' };
}

/* ------------------------------------------------------------------ symbols */
function symbol(p, kind, x, y, o = {}) {
  const g = h('g', Object.assign({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, o.a || {}), p);
  const disc = o.disc !== false;
  if (disc) h('circle', { cx: 0, cy: 0, r: 22, fill: 'var(--paper)', stroke: o.ring || 'var(--ink-2)', 'stroke-width': o.ring ? 'var(--sw-struct)' : 'var(--sw-rule)' }, g);
  const ink = { stroke: 'var(--ink)', 'stroke-width': 'var(--sw-hair)', 'stroke-linejoin': 'round' };
  const R = (x0, y0, w, hh, fill, a) => h('rect', Object.assign({ x: x0, y: y0, width: w, height: hh, fill }, a || {}), g);
  const Pth = (d, fill, a) => h('path', Object.assign({ d, fill }, a || {}), g);
  switch (kind) {
    case 'house': Pth('M-12 1 L0 -11 L12 1 V12 H-12 Z', 'var(--tile)', ink); R(-3, 4, 6, 8, 'var(--trunk)'); break;
    case 'school': Pth('M-15 -3 L0 -13 L15 -3 Z', 'var(--tile-shade)', ink); R(-14, -3, 28, 15, 'var(--tile)', ink); for (const dx of [-10, -2, 6]) R(dx, 0, 4, 4, 'var(--sky-top)'); R(-2, 6, 4, 6, 'var(--trunk)'); break;
    case 'building': R(-12, -11, 24, 23, 'var(--tile)', ink); for (const dx of [-8, 2]) for (const dy of [-6, 3]) R(dx, dy, 6, 5, 'var(--sky-top)'); break;
    case 'church': R(-8, -1, 16, 13, 'var(--stone)', ink); Pth('M-10 -1 L0 -9 L10 -1 Z', 'var(--tile-shade)', ink); R(-1.5, -18, 3, 10, 'var(--ink)'); R(-5, -15, 10, 3, 'var(--ink)'); break;
    case 'tree': R(-2, 4, 4, 9, 'var(--trunk)'); h('circle', { cx: 0, cy: -3, r: 10, fill: 'var(--canopy)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-hair)' }, g); break;
    case 'flower': for (let i = 0; i < 5; i++) { const a = i * 1.2566 - 1.57; h('circle', { cx: Math.cos(a) * 6.5, cy: Math.sin(a) * 6.5 - 1, r: 5, fill: 'var(--berry)' }, g); } h('circle', { cx: 0, cy: -1, r: 4, fill: 'var(--sun)' }, g); break;
    case 'water': h('ellipse', { cx: 0, cy: 0, rx: 14, ry: 10, fill: 'var(--water)' }, g); for (const dy of [-3, 3]) Pth(`M-8 ${dy} q4 -3 8 0 t8 0`, 'none', { stroke: 'var(--water-hi)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }); break;
    case 'parking': R(-12, -12, 24, 24, 'var(--road)', { rx: 3 }); for (const dx of [-6, 0, 6]) h('line', { x1: dx, x2: dx, y1: -9, y2: 2, stroke: 'var(--road-line)', 'stroke-width': 'var(--sw-rule)' }, g); h('line', { x1: -9, x2: 9, y1: 2, y2: 2, stroke: 'var(--road-line)', 'stroke-width': 'var(--sw-rule)' }, g); break;
    case 'play': Pth('M-12 12 L-8 -10 H8 L12 12', 'none', { stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }); h('line', { x1: 0, x2: 0, y1: -10, y2: 4, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-hair)' }, g); R(-5, 4, 10, 4, 'var(--event)'); break;
    case 'goal': Pth('M-14 10 V-7 H14 V10', 'none', { stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }); for (const dx of [-7, 0, 7]) h('line', { x1: dx, x2: dx, y1: -7, y2: 10, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g); h('line', { x1: -14, x2: 14, y1: 2, y2: 2, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g); break;
    case 'gate': R(-13, -11, 4, 23, 'var(--hull)'); R(9, -11, 4, 23, 'var(--hull)'); for (const dy of [-5, 1, 7]) h('line', { x1: -9, x2: 9, y1: dy, y2: dy, stroke: 'var(--hull)', 'stroke-width': 'var(--sw-struct)' }, g); break;
    case 'shop': R(-12, -3, 24, 15, 'var(--tile)', ink); for (let i = 0; i < 4; i++) R(-14 + i * 7, -10, 7, 7, i % 2 ? 'var(--cloud)' : 'var(--event)'); R(-3, 4, 6, 8, 'var(--trunk)'); break;
    case 'bus': R(-14, -9, 28, 16, 'var(--event)', { rx: 4 }); for (const dx of [-11, -3, 5]) R(dx, -6, 6, 5, 'var(--cloud)'); for (const dx of [-8, 8]) h('circle', { cx: dx, cy: 8, r: 3.5, fill: 'var(--ink)' }, g); break;
    case 'bridge': R(-15, 6, 30, 6, 'var(--water)'); Pth('M-15 6 Q0 -12 15 6 V1 Q0 -16 -15 1 Z', 'var(--stone)', ink); R(-16, -3, 32, 4, 'var(--stone-shade)'); break;
    case 'table': R(-11, -6, 22, 12, 'var(--bench-top)', ink); for (const dx of [-8, 2]) for (const dy of [-12, 8]) R(dx, dy, 6, 4, 'var(--cloth-1)'); break;
    case 'board': R(-15, -8, 30, 16, 'var(--hob)', { stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }); break;
    case 'door': h('line', { x1: -10, x2: -10, y1: 10, y2: -10, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g); Pth('M-10 -10 A20 20 0 0 1 10 10', 'none', { stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '4 4' }); h('line', { x1: -14, x2: 12, y1: 10, y2: 10, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g); break;
    case 'window': R(-11, -12, 22, 24, 'var(--sky-top)', ink); h('line', { x1: 0, x2: 0, y1: -12, y2: 12, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-hair)' }, g); h('line', { x1: -11, x2: 11, y1: 0, y2: 0, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-hair)' }, g); break;
    case 'desk': R(-13, -7, 26, 12, 'var(--bench-front)', ink); R(-4, 7, 8, 5, 'var(--cloth-2)'); break;
    case 'carpet': R(-13, -9, 26, 18, 'var(--compare-pale)', { stroke: 'var(--compare)', 'stroke-width': 'var(--sw-rule)', rx: 3 }); R(-8, -4, 16, 8, 'none', { stroke: 'var(--compare)', 'stroke-width': 'var(--sw-hair)' }); break;
    case 'star': Pth('M0 -13 L3.8 -4.2 L12.4 -4 L5.6 1.6 L7.9 10.5 L0 5.3 L-7.9 10.5 L-5.6 1.6 L-12.4 -4 L-3.8 -4.2 Z', 'var(--event)', ink); break;
    case 'flag': h('line', { x1: -7, x2: -7, y1: 13, y2: -13, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)' }, g); Pth('M-7 -13 L11 -7 L-7 -1 Z', 'var(--event)'); break;
    case 'city': default: h('circle', { cx: 0, cy: 0, r: 7, fill: 'var(--ink)', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)' }, g); break;
  }
  return g;
}

/* ------------------------------------------------------------------ local area plan (drawn here, generic) */
function localPlan(p, f) {
  const g = h('g', {}, p);
  const X = fx => f.x + fx * f.w, Y = fy => f.y + fy * f.h;
  const R = (x0, y0, x1, y1, fill, a) => h('rect', Object.assign({ x: X(x0), y: Y(y0), width: X(x1) - X(x0), height: Y(y1) - Y(y0), fill }, a || {}), g);
  R(0, 0, 1, 1, 'var(--hill-far)', { rx: 'var(--r-card)' });
  // farm fields, school field, park
  R(.74, .04, .97, .22, 'var(--field)', { rx: 'var(--r-mark)' }); R(.72, .44, .95, .62, 'var(--hill-mid)', { rx: 'var(--r-mark)' });
  R(.35, .30, .59, .62, 'var(--hill-mid)', { rx: 'var(--r-mark)' });
  // river: a filled band, wiggling down the west side
  const rv = [[.31, 0], [.29, .15], [.32, .3], [.28, .45], [.30, .6], [.27, .75], [.29, .9], [.27, 1]];
  const side = (dx) => rv.map(([fx, fy]) => [X(fx) + dx, Y(fy)]);
  const L = side(-11), Rr = side(11).reverse();
  h('path', { d: 'M' + [...L, ...Rr].map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ' Z', fill: 'var(--water)' }, g);
  // roads: the high street, a cross road, a lane to the church
  R(0, .69, 1, .75, 'var(--road)'); R(.62, 0, .66, 1, 'var(--road)'); R(.46, .17, .48, .30, 'var(--road)');
  R(.25, .685, .32, .755, 'var(--stone)', { stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' });
  // buildings (flat blocks seen from above)
  const B = (x0, y0, x1, y1) => R(x0, y0, x1, y1, 'var(--tile)', { cls: 'body' });
  B(.43, .06, .52, .17); B(.72, .29, .88, .40); B(.81, .06, .89, .12);
  for (let i = 0; i < 4; i++) B(.40 + i * .045, .78, .435 + i * .045, .87);
  for (const [x0, y0] of [[.06, .06], [.14, .06], [.06, .16], [.14, .16]]) B(x0, y0, x0 + .06, y0 + .07);
  // playground and pond in the park; the woods
  R(.43, .40, .53, .52, 'var(--road)', { rx: 'var(--r-mark)' });
  h('ellipse', { cx: X(.39), cy: Y(.55), rx: f.w * .025, ry: f.h * .04, fill: 'var(--water)' }, g);
  const tr = [[.07, .39], [.15, .38], [.10, .47], [.17, .53], [.07, .54]];
  for (const [fx, fy] of tr) h('circle', { cx: X(fx), cy: Y(fy), r: f.w * .022, fill: 'var(--canopy)', cls: 'body' }, g);
  const bx = (x0, y0, x1, y1) => ({ x: X(x0), y: Y(y0), w: X(x1) - X(x0), h: Y(y1) - Y(y0) });
  return [bx(.43, .06, .52, .17), bx(.72, .29, .88, .40), bx(.81, .06, .89, .12), bx(.40, .78, .57, .87), bx(.06, .06, .20, .23), bx(.43, .40, .53, .52), bx(.365, .51, .415, .59), bx(.25, .685, .32, .755),
    ...rv.slice(1).map(([fx, fy], i) => { const x0 = Math.min(fx, rv[i][0]), x1 = Math.max(fx, rv[i][0]); return { x: X(x0) - 13, y: Y(rv[i][1]), w: X(x1) - X(x0) + 26, h: Y(fy) - Y(rv[i][1]) }; })];
}

/* ------------------------------------------------------------------ the side picture (Reception: before the view tilts) */
function sidePicture(p, M, a) {
  const G = M.G, f = G.frame; const g = h('g', a, p);
  const X = fx => f.x + fx * f.w; const yH = f.y + f.h * .70;
  h('rect', { x: f.x, y: f.y, width: f.w, height: f.h, fill: 'var(--sky-top)', rx: 'var(--r-card)' }, g);
  h('rect', { x: f.x, y: yH, width: f.w, height: f.y + f.h - yH, fill: 'var(--hill-mid)' }, g);
  const block = (x0, x1, hh, fill, win) => { h('rect', { x: X(x0), y: yH - hh, width: X(x1) - X(x0), height: hh, fill, cls: 'body' }, g);
    if (win) for (let x = X(x0) + 18; x + 26 < X(x1) - 8; x += 44) for (let y = yH - hh + 18; y + 26 < yH - 10; y += 46) h('rect', { x, y, width: 26, height: 24, fill: 'var(--sky-top)' }, g); };
  const roof = (x0, x1, hh, rh) => h('path', { d: `M${X(x0) - 6} ${yH - hh} L${(X(x0) + X(x1)) / 2} ${yH - hh - rh} L${X(x1) + 6} ${yH - hh} Z`, fill: 'var(--tile-shade)', cls: 'body' }, g);
  const tree = (fx, s = 1) => { h('rect', { x: X(fx) - 5 * s, y: yH - 40 * s, width: 10 * s, height: 40 * s, fill: 'var(--trunk)' }, g); h('circle', { cx: X(fx), cy: yH - 58 * s, r: 30 * s, fill: 'var(--canopy)', cls: 'body' }, g); };
  if (G.m === 'school') {
    block(.05, .29, f.h * .40, 'var(--tile)', true); roof(.05, .29, f.h * .40, 40);
    block(.30, .41, f.h * .26, 'var(--tile-shade)', true);
    for (let i = 0; i < 4; i++) tree(.60 + i * .1, .9);
    h('line', { x1: X(.42), x2: X(.99), y1: yH - 18, y2: yH - 18, stroke: 'var(--hull)', 'stroke-width': 'var(--sw-struct)' }, g);
    for (const fx of [.51, .56]) h('rect', { x: X(fx), y: yH - 44, width: 8, height: 44, fill: 'var(--hull)' }, g);
  } else if (G.m === 'classroom') {
    h('rect', { x: f.x, y: f.y, width: f.w, height: yH - f.y, fill: 'var(--wall-top)', rx: 'var(--r-card)' }, g);
    h('rect', { x: X(.3), y: f.y + 40, width: X(.7) - X(.3), height: 110, fill: 'var(--hob)' }, g);
    h('rect', { x: X(.84), y: f.y + 40, width: X(.96) - X(.84), height: 120, fill: 'var(--sky-top)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, g);
    h('rect', { x: X(.03), y: yH - 190, width: 70, height: 190, fill: 'var(--wall-bot)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, g);
    for (const fx of [.42, .61, .80]) { h('rect', { x: X(fx), y: yH - 60, width: f.w * .13, height: 10, fill: 'var(--bench-top)' }, g); for (const dx of [.01, .11]) h('rect', { x: X(fx + dx), y: yH - 50, width: 6, height: 50, fill: 'var(--bench-front)' }, g); }
  } else {
    tree(.06); tree(.12, .8); tree(.17); block(.43, .52, 90, 'var(--stone)', false); h('rect', { x: X(.455), y: yH - 170, width: X(.495) - X(.455), height: 80, fill: 'var(--stone)', cls: 'body' }, g);
    block(.72, .88, 120, 'var(--tile)', true); roof(.72, .88, 120, 30);
    for (const fx of [.20, .58, .93]) { block(fx - .03, fx + .03, 60, 'var(--tile)', false); roof(fx - .03, fx + .03, 60, 26); }
  }
  return g;
}

/* ------------------------------------------------------------------ label placement */
function placeBox(anchor, w, hh, r, taken, bounds) {
  const { x, y } = anchor; const c = [];
  for (const d of [8, 26, 48, 80, 116]) {
    c.push([x + r + d, y - hh / 2], [x - r - d - w, y - hh / 2], [x - w / 2, y - r - d - hh], [x - w / 2, y + r + d],
      [x + r + d * .6, y - r - d * .6 - hh], [x + r + d * .6, y + r + d * .6], [x - r - d * .6 - w, y - r - d * .6 - hh], [x - r - d * .6 - w, y + r + d * .6]);
  }
  for (const [bx, by] of c) {
    const box = { x: bx, y: by, w, h: hh };
    if (bx < bounds.x || by < bounds.y || bx + w > bounds.x + bounds.w || by + hh > bounds.y + bounds.h) continue;
    if (taken.some(t => overlaps(box, t, 6))) continue;
    return box;
  }
  return null;
}
// try each anchor against the strictest obstacle set first, then relax
function placeAny(ats, w, hh, r, tiers, bounds) { for (const obs of tiers) for (const at of ats) { const b = placeBox(at, w, hh, r, obs, bounds); if (b) return b; } return null; }
const segAt = (A, B, t) => ({ x: A[0] + (B[0] - A[0]) * t, y: A[1] + (B[1] - A[1]) * t });
function ukMap(p, G, P, taken) {
  const f = G.frame; const g = h('g', {}, p);
  const d = (poly, close = true) => 'M' + poly.map(q => G.proj(q[0], q[1]).map(v => v.toFixed(1)).join(' ')).join(' L') + (close ? ' Z' : '');
  const line = { stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round' };
  h('rect', { x: f.x, y: f.y, width: f.w, height: f.h, fill: 'var(--sky-top)', rx: 'var(--r-mark)' }, g);
  // the Republic of Ireland is not in the UK: a faded fill, a border line and its own name
  h('path', Object.assign({ d: d(UK_LAND.ireland), fill: 'color-mix(in oklab,var(--paper) 55%,var(--sky-top))' }, line), g);
  const land = 'color-mix(in oklab,var(--paper) 70%,var(--cloud))';
  h('path', { d: d(UK_LAND.ni), fill: land }, g);
  h('path', Object.assign({ d: d(UK_LAND.britain), fill: land }, line), g);
  h('path', { d: d(IRISH_BORDER, false), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '7 5' }, g);
  const [rx, ry] = G.proj(-8.1, 53.25);
  const tb = textBlock(g, rx, ry, txt(P, 'label:roi', 'Republic of Ireland'), { cls: 'ts-small', maxW: 130, maxLines: 2, lh: 26, anchor: 'middle', a: { fill: 'var(--ink-2)', cls: 'halo' }, edit: 'text.label:roi' });
  taken.push({ x: rx - 70, y: ry - 24, w: 140, h: (tb && tb.h) || 56 });
}
function bigScale(p, x, y, bu, bar, units, a) {
  const g = h('g', a, p); const n = [5, 4, 2].find(q => bar % q === 0) || 2;
  for (let i = 0; i < n; i++) h('rect', { x: x + bu * i / n, y, width: bu / n, height: 16, fill: i % 2 ? 'var(--paper)' : 'var(--ink)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-hair)' }, g);
  computed(T(g, x, y - 14, '0', 'ts-label', { fill: 'var(--ink)' }), 'scale.bar');
  computed(T(g, x + bu, y - 14, `${bar.toLocaleString('en-GB')} ${units}`, 'ts-label', { 'text-anchor': 'end', fill: 'var(--ink)', cls: 'strong' }), 'scale.bar');
  return g;
}
const lineBoxes = (pts, r = 6) => { const out = []; for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 14)); for (let j = 0; j <= n; j++) { const x = x0 + (x1 - x0) * j / n, y = y0 + (y1 - y0) * j / n; out.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r }); } } return out; };

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  P = withDefaults(params, P);
  const { M, items } = plan(P); const G = M.G, f = G.frame; const b = ctx.b, N = ctx.N; const bi = k => b[k] ?? 0;
  const plans = PLAN(G.m); const mapK = bi('map'); const pic = b.picture != null;
  const taken = []; // label obstacles
  const avoid = []; // map features labels should keep off when they can
  const SC = G.SC, BOUNDS = G.BOUNDS;

  /* the map (tilts up from the side picture in Reception) */
  const mapG = h('g', { s: mapK }, root);
  if (G.m === 'local') avoid.push(...localPlan(mapG, f));
  else if (G.m === 'uk') ukMap(mapG, G, P, taken);
  else basemap(mapG, G.m, { box: f });
  if (pic) sidePicture(root, M, { s: 0, hide: mapK });
  const hiG = h('g', {}, root);   // grid-square highlights, under the grid lines
  const gridG = h('g', {}, root);
  const under = h('g', {}, root); // routes and arrows, under symbols and labels
  const symG = h('g', {}, root);
  const labG = h('g', {}, root);
  const late = pic ? 1300 : 0;   // in Reception, symbols wait for the tilt to finish

  /* grid */
  let GR = null;
  if (M.showGrid) {
    GR = gridRefs(gridG, f, G.cols, G.rows, { e0: G.e0, n0: G.n0, digits: 2, tenths: false, computedPath: 'grid.e0', a: { s: bi('grid'), cls: 'rise' } });
    for (const t of (GR.g.querySelectorAll ? GR.g.querySelectorAll('text') : [])) t.setAttribute('class', 'ts-small halo'); // grid numbers at body size
    taken.push({ x: f.x - 4, y: f.y + f.h + 4, w: f.w + 8, h: 40 }, { x: f.x - 80, y: f.y - 4, w: 80, h: f.h + 8 });
    if (P.task === 'grid4' || P.task === 'grid6') {
      const gk = bi('grid'); const g2 = h('g', { s: gk }, gridG);
      const al = txt(P, 'label:along', 'along the corridor'), up = txt(P, 'label:up', 'up the stairs');
      const ay = f.y + f.h + 32; // the line numbers sit here; the hint goes under them, on one line the width of the map
      textBlock(g2, f.x + f.w / 2, Math.min(ay + 27, GRID.foot - 12), al + ' →', { cls: 'ts-small', maxW: f.w, maxLines: 1, anchor: 'middle', a: { fill: 'var(--focus-text)', cls: 'halo strong' }, edit: 'text.label:along' });
      textBlock(g2, f.x - 52, f.y + f.h / 2, up + ' →', { cls: 'ts-small', maxW: f.h, maxLines: 1, anchor: 'middle', a: { fill: 'var(--focus-text)', cls: 'halo strong', transform: `rotate(-90 ${f.x - 52} ${f.y + f.h / 2})` }, edit: 'text.label:up' });
    }
    for (const w of GR.warnings) ctx.warn(w);
  }

  /* compass, key and scale in the side column */
  let sideY = SC.y;
  if (M.showCompass) {
    // the kit rose draws the needles; its letters are drawn here so a long word fits the column:
    // the needle shortens first, then the word wraps (never past the column or into the map)
    const L = { N: txt(P, 'label:N', 'N'), E: txt(P, 'label:E', 'E'), S: txt(P, 'label:S', 'S'), W: txt(P, 'label:W', 'W') };
    const slotOf = i => ((G.north / 90) + i) % 4; // 0 top, 1 right, 2 bottom, 3 left
    const at = {}; ['N', 'E', 'S', 'W'].forEach((k, i) => { at[slotOf(i)] = k; });
    const lw = k => measure(root, L[k], 'ts-label', { cls: 'strong' });
    const sideW = Math.max(lw(at[1]), lw(at[3]));
    // short words sit beside the east and west arms (the rose may shrink a little); long ones go under
    // those arms, clear of the dial, each in its half of the column
    const r0 = P.task === 'compass' ? 76 : 50; const r = Math.max(44, Math.min(r0, SC.w / 2 - 14 - sideW));
    const beside = sideW <= SC.w / 2 - 14 - r; const sideMax = beside ? SC.w / 2 - r - 14 : SC.w / 2 - r * .2 - 12;
    const cg = h('g', { s: bi('compass'), cls: 'pop', c: ctx.rc('compass', null, 'soft') }, root);
    const cx = SC.x + SC.w / 2;
    const lab = (k, x, y, anchor, maxW, maxLines) => { const tmp = h('g', {}, root); const tb = textBlock(tmp, 0, 0, L[k], { cls: 'ts-label', maxW, maxLines, lh: 28, a: { cls: 'halo' + (k === 'N' ? ' strong' : '') } }); tmp.remove(); return { k, tb, draw: (yy) => textBlock(cg, x, yy, L[k], { cls: 'ts-label', maxW, maxLines, lh: 28, anchor, a: { fill: 'var(--ink)', cls: 'halo' + (k === 'N' ? ' strong' : '') }, edit: `text.label:${k}` }) }; };
    const top = lab(at[0], cx, 0, 'middle', SC.w, 2), bot = lab(at[2], cx, 0, 'middle', SC.w, 2);
    const cy = SC.y + top.tb.h + r + 12;
    compassRose(cg, cx, cy, { r, points: M.pts, north: G.north, labels: { N: '', E: '', S: '', W: '' } });
    for (const t of cg.querySelectorAll('text')) t.remove();
    top.draw(cy - r - 12 - top.tb.h + 21);
    let below = cy + r + 12;
    if (beside) {
      const rt = lab(at[1], cx + r + 14, 0, 'start', sideMax, 3), lt = lab(at[3], cx - r - 14, 0, 'end', sideMax, 3);
      rt.draw(cy - rt.tb.h / 2 + 21); lt.draw(cy - lt.tb.h / 2 + 21);
    } else {
      const y0 = cy + r * .62 + 10;
      const rt = lab(at[1], SC.x + SC.w, 0, 'end', sideMax, 3), lt = lab(at[3], SC.x, 0, 'start', sideMax, 3);
      rt.draw(y0 + 21); lt.draw(y0 + 21);
      below = Math.max(below, y0 + Math.max(rt.tb.h, lt.tb.h) + 10);
    }
    bot.draw(below + 21);
    sideY = below + bot.tb.h + 22;
  }
  const keyRows = [];
  if (M.keyMode && M.feats.length) {
    const kx = SC.x, kw = SC.w; const lw = kw - 76;
    const rows = M.feats.map(ft => { const tmp = h('g', {}, root); const tb = textBlock(tmp, 0, 0, ft.label, { cls: 'ts-small', maxW: lw, maxLines: 2, lh: 28 }); tmp.remove(); return { ft, hh: Math.max(52, tb.h + 22) }; });
    const kt = txt(P, 'label:key', 'Key'); const ktmp = h('g', {}, root); const khd = textBlock(ktmp, 0, 0, kt, { cls: 'ts-label', maxW: kw - 40, maxLines: 2, lh: 28, a: { cls: 'strong' } }); ktmp.remove();
    const head = 54 + khd.h - 28;
    const total = head + rows.reduce((s, r) => s + r.hh, 0) + 8;
    const ks = P.task === 'key' ? bi(`sym:${M.feats[0].i}`) : bi('key');
    const card = h('g', { s: ks, cls: 'rise' }, root);
    if (sideY + total > GRID.bottom + 8) ctx.warn(`The key is too tall for the side column (${Math.round(sideY + total)}).`);
    h('rect', { x: kx, y: sideY, width: kw, height: total, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, card);
    textBlock(card, kx + 20, sideY + 38, kt, { cls: 'ts-label', maxW: kw - 40, maxLines: 2, lh: 28, a: { cls: 'strong', fill: 'var(--ink)' }, edit: 'text.label:key' });
    let y = sideY + head;
    for (const r of rows) {
      const k = P.task === 'key' ? bi(`sym:${r.ft.i}`) : ks;
      const rg = h('g', { s: k, cls: 'rise', c: P.task === 'key' ? null : null }, card);
      symbol(rg, r.ft.sym, kx + 40, y + r.hh / 2, { disc: plans, ring: null });
      const tmp = h('g', {}, root); const tb = textBlock(tmp, 0, 0, r.ft.label, { cls: 'ts-small', maxW: lw, maxLines: 2, lh: 28 }); tmp.remove();
      textBlock(rg, kx + 76, y + r.hh / 2 - tb.h / 2 + 21, r.ft.label, { cls: 'ts-small', maxW: lw, maxLines: 2, lh: 28, a: { fill: 'var(--ink)' }, edit: `features.${r.ft.i}.label` });
      keyRows.push({ ft: r.ft, y, hh: r.hh }); y += r.hh;
    }
    sideY += total + 16;
  }
  if (P.task === 'scale') {
    const { bar, bu } = barOf(G, P); const x0 = SC.x + 8, y0 = Math.max(sideY + 50, f.y + f.h - 28);
    bigScale(root, x0, y0, bu, bar, unitsOf(G), { s: bi('scale'), cls: 'rise' });
    if (bu > SC.w - 16) ctx.warn('The scale bar is longer than the side column.');
  }

  /* routes and arrows (drawn first so labels can keep off them) */
  const lineObs = []; const isGridTask0 = P.task === 'grid4' || P.task === 'grid6';
  const symR = plans ? 22 : 10;
  const legLabels = [];
  if (P.task === 'route' || P.task === 'scale') {
    M.legs.forEach((L, j) => {
      const k = bi(`leg:${L.i}`); const last = j === M.legs.length - 1;
      // trim the ends to the symbol edge so the arrow never hides a symbol
      const pts = L.pts.map(q => q.slice()); const trim = (A, B, d) => { const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; return [A[0] + (B[0] - A[0]) * d / len, A[1] + (B[1] - A[1]) * d / len]; };
      pts[0] = trim(pts[0], pts[1], symR + 4); pts[pts.length - 1] = trim(pts[pts.length - 1], pts[pts.length - 2], symR + 6);
      route(under, pts, { col: 'var(--focus)', s: k, smooth: false, a: { c: last ? null : ctx.rc(`leg:${L.i}`, null, 'soft') } });
      lineObs.push(...lineBoxes(pts, 7));
      const word = P.task === 'scale' ? niceDist(G, L.len) : legPhrase(M, L);
      if (word) legLabels.push({ k, last, word, ats: L.moves.length === 2 ? [{ x: L.pts[1][0], y: L.pts[1][1] }, segAt(pts[0], pts[1], .5), segAt(pts[1], pts[2], .5)] : [.5, .35, .65, .2, .8].map(t => segAt(pts[0], pts[1], t)), path: `route.stops.${L.i + 1}` });
    });
  }
  if (P.task === 'compass') {
    M.feats.forEach(ft => {
      const k = bi(`dir:${ft.i}`); const A = [M.C.x, M.C.y], B = [ft.x, ft.y]; const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len]; const p0 = [A[0] + u[0] * 30, A[1] + u[1] * 30], p1 = [B[0] - u[0] * 30, B[1] - u[1] * 30];
      route(under, [p0, p1], { col: 'var(--focus)', s: k, smooth: false, a: { c: ctx.rc(`dir:${ft.i}`, null, 'soft') } });
      lineObs.push(...lineBoxes([p0, p1], 7));
      legLabels.push({ k, word: dirWord(bearing(G, M.C, ft), M.pts), ats: [.5, .35, .65, .25, .75].map(t => segAt(p0, p1, t)), path: `features.${ft.i}.place`, rc: `dir:${ft.i}` });
    });
  }

  /* symbols */
  const featK = ft => P.task === 'key' ? bi(`sym:${ft.i}`) : mapK;
  for (const ft of M.feats) { symbol(symG, ft.sym, ft.x, ft.y, { disc: plans, a: { s: featK(ft), cls: 'pop', delay: late } }); taken.push({ x: ft.x - symR, y: ft.y - symR, w: symR * 2, h: symR * 2 }); }
  for (const s of M.stops) if (!s.feat) { symbol(symG, s.sym, s.x, s.y, { disc: plans, a: { s: mapK, cls: 'pop', delay: late } }); taken.push({ x: s.x - symR, y: s.y - symR, w: symR * 2, h: symR * 2 }); }
  if (M.C) { symbol(symG, M.C.sym, M.C.x, M.C.y, { disc: true, ring: 'var(--focus)', a: { s: mapK, cls: 'pop', delay: late } }); taken.push({ x: M.C.x - 24, y: M.C.y - 24, w: 48, h: 48 }); }
  if (isGridTask0 && GR) for (const ft of M.feats) { const { e, n } = gridPos(G, ft); avoid.push({ x: GR.x(Math.floor(e)), y: GR.y(Math.floor(n) + 1), w: G.cw, h: G.ch }); }

  /* labels on the map: names (unless the key holds them), then refs, then route and direction words */
  const isGridTask = P.task === 'grid4' || P.task === 'grid6';
  const named = [...(M.C ? [{ ...M.C, label: M.C.label, edit: 'centre.label', k: mapK }] : []), ...(M.keyMode ? [] : M.feats.map(ft => ({ ...ft, edit: `features.${ft.i}.label`, k: featK(ft) }))),
    ...(M.keyMode ? [] : M.stops.filter(s => !s.feat).map(s => ({ ...s, edit: null, k: mapK })))];
  const refW = isGridTask ? measure(root, P.task === 'grid4' ? '0000' : '000000', 'ts-date') + 20 : 0;
  for (const it of named) {
    const tmp = h('g', {}, root); const tb = textBlock(tmp, 0, 0, it.label, { cls: 'ts-small', maxW: 250, maxLines: 3, lh: 28 }); tmp.remove();
    const ft = isGridTask && it.edit && it.edit.startsWith('features') ? it : null;
    const w = Math.max(tb.w + 20, ft ? refW : 0), hh = tb.h + 12 + (ft ? 34 : 0);
    const rr = it.edit === 'centre.label' ? 24 : symR;
    const box = placeAny([it], w, hh, rr, [[...taken, ...lineObs, ...avoid], [...taken, ...lineObs]], BOUNDS);
    if (!box) { ctx.warn(`No room for the label “${it.label}”.`); continue; }
    taken.push(box);
    // a name appears when its place is in focus, and recedes when the next one comes
    const fk = it.edit && it.edit.startsWith('features') ? (P.task === 'compass' ? `dir:${it.i}` : isGridTask ? `ref:${it.i}` : null) : null;
    const g = h('g', { s: fk ? bi(fk) : it.k, cls: 'rise', delay: fk ? 300 : late + 200, c: fk ? ctx.rc(fk, null, 'soft') : null }, labG);
    const nx = Math.max(box.x, Math.min(it.x, box.x + box.w)), ny = Math.max(box.y, Math.min(it.y, box.y + tb.h + 12)), dd = Math.hypot(nx - it.x, ny - it.y);
    if (dd > rr + 18) h('line', { x1: it.x + (nx - it.x) / dd * (rr + 3), y1: it.y + (ny - it.y) / dd * (rr + 3), x2: nx, y2: ny, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, g);
    labelGround(g, { x: box.x, y: box.y, w: box.w, h: tb.h + 12 });
    const tb2 = textBlock(g, box.x + 10, box.y + 27, it.label, { cls: 'ts-small', maxW: 250, maxLines: 3, lh: 28, a: { fill: 'var(--ink)' }, edit: it.edit });
    if (ft) {
      const rg = h('g', {}, g);
      h('rect', { x: box.x, y: box.y + tb.h + 12, width: box.w, height: 34, rx: 'var(--r-mark)', fill: 'var(--focus-pale)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-hair)' }, rg);
      computed(T(rg, box.x + 10, box.y + tb.h + 12 + 26, P.task === 'grid4' ? ref4(G, ft) : ref6(G, ft), 'ts-date', { fill: 'var(--focus-text)' }), `features.${ft.i}.ref`);
    }
    void tb2;
  }
  for (const L of legLabels) {
    const w = measure(root, L.word, 'ts-small', { cls: 'strong' }) + 20, hh = 36;
    const box = placeAny(L.ats, w, hh, 8, [[...taken, ...lineObs], taken], BOUNDS);
    if (!box) { ctx.warn(`No room for “${L.word}”.`); continue; }
    taken.push(box);
    const g = h('g', { s: L.k, cls: 'rise', delay: 700, c: L.rc ? ctx.rc(L.rc, null, 'soft') : (L.last ? null : null) }, labG);
    h('rect', { x: box.x, y: box.y, width: box.w, height: hh, rx: 'var(--r-mark)', fill: 'var(--paper)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-hair)' }, g);
    computed(T(g, box.x + 10, box.y + 26, L.word, 'ts-small', { fill: 'var(--focus-text)', cls: 'strong' }), L.path);
  }

  /* grid reference builds: the square lights, then along the corridor and up the stairs */
  if (isGridTask && GR) {
    for (const ft of M.feats) {
      const k = bi(`ref:${ft.i}`); const { e, n } = gridPos(G, ft); const ef = Math.floor(e), nf = Math.floor(n);
      const sx = GR.x(ef), sy = GR.y(nf + 1);
      h('rect', { x: sx, y: sy, width: G.cw, height: G.ch, fill: 'var(--focus-pale)', s: k, hide: k + 1 }, hiG);
      const x0 = f.x, yb = f.y + f.h;
      const tx = P.task === 'grid6' ? GR.x(Math.floor(e * 10) / 10) : sx, ty = P.task === 'grid6' ? GR.y(Math.floor(n * 10) / 10) : GR.y(nf);
      route(under, [[x0, yb], [tx, yb], [tx, ty]], { col: 'var(--focus)', s: k, smooth: false, head: 14, a: { hide: k + 1 } });
      if (P.task === 'grid6') {
        const tg = h('g', { s: k, hide: k + 1 }, under);
        for (let i = 1; i < 10; i++) { h('line', { x1: sx + G.cw * i / 10, x2: sx + G.cw * i / 10, y1: sy + G.ch, y2: sy + G.ch - (i === 5 ? 14 : 9), stroke: 'var(--focus-text)', 'stroke-width': 'var(--sw-hair)' }, tg);
          h('line', { x1: sx, x2: sx + (i === 5 ? 14 : 9), y1: sy + G.ch - G.ch * i / 10, y2: sy + G.ch - G.ch * i / 10, stroke: 'var(--focus-text)', 'stroke-width': 'var(--sw-hair)' }, tg); }
      }
    }
  }

  /* Reception: the plan starts squashed (seen from the side) and tilts up to a bird's-eye view */
  const yb = f.y + f.h;
  const setTilt = u => { const s = .22 + .78 * eIO(clamp(u)); mapG.setAttribute('transform', `translate(0 ${(yb * (1 - s)).toFixed(2)}) scale(1 ${s.toFixed(4)})`); };
  return pic ? {
    dur: { map: 1400 },
    reset() { setTilt(0); },
    still() { setTilt(1); },
    tick(k, u) { if (k === mapK) setTilt(u); else setTilt(k > mapK ? 1 : 0); },
  } : {};
}

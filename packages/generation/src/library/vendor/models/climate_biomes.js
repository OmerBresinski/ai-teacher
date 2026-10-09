// Hot and cold places, climate zones and biomes. A simplified world map with honest latitudes
// (equirectangular, so latitude lines are evenly spaced), the hot belt between the tropics and
// the cold caps beyond the polar circles, real places from a list (true latitudes, so a place
// cannot be moved to the wrong zone), and a biome close-up whose plants and animals must
// really live there (no penguins in the Arctic). Zones are computed from latitude, never set.
import {
  h, T, measure, clamp, overlaps, GRID, sky, hills, ground, labelGround, textBlock,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
// Batch F and D parts are not re-exported by kit/index.js, so they are imported directly.
import { biomeObject, biomeSceneryFor } from '../kit/batch-F.js';
import { organism, ORGANISM_SIZE } from '../kit/batch-D.js';
import { ICONS } from './climate_biomes/life.js';

export const meta = {
  id: 'climate_biomes', name: 'Climate zones and biomes', kind: 'scene', version: 1,
  subjects: ['Geography', 'Science'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Why places near the equator are hot and places near the poles are cold, the climate zones, and the plants and animals of one biome.',
};

/* ------------------------------------------------------------------ facts */
const TROPIC = 23.44, POLAR = 66.56;
// [id, name, lat, lon, biome, region]. Latitudes are the real ones (centre of the place).
const PLACES = [
  ['uk', 'The UK', 54, -2, 'temperate', 'europe'],
  ['amazon', 'The Amazon rainforest', -3, -62, 'rainforest', 'americas'],
  ['congo', 'The Congo rainforest', -1, 22, 'rainforest', 'africa'],
  ['borneo', 'The Borneo rainforest', 1, 114, 'rainforest', 'asia'],
  ['costarica', 'The Costa Rica rainforest', 10, -84, 'rainforest', 'americas'],
  ['sahara', 'The Sahara Desert', 23, 10, 'desert', 'africa'],
  ['arabia', 'The Arabian Desert', 22, 48, 'desert', 'asia'],
  ['sonoran', 'The Sonoran Desert', 31, -112, 'desert', 'americas'],
  ['outback', 'The Australian outback', -23, 133, 'desert', 'oceania'],
  ['serengeti', 'The Serengeti', -2, 35, 'savanna', 'africa'],
  ['prairie', 'The prairie', 45, -100, 'grassland', 'americas'],
  ['siberia', 'The Siberian forest', 60, 100, 'taiga', 'asia'],
  ['canada', 'The Canadian forest', 56, -112, 'taiga', 'americas'],
  ['arctic', 'The Arctic', 82, -30, 'polar-north', 'arctic'],
  ['greenland', 'Greenland', 72, -42, 'polar-north', 'arctic'],
  ['antarctica', 'Antarctica', -80, 20, 'polar-south', 'antarctica'],
].map(([id, name, lat, lon, biome, region]) => ({ id, name, lat, lon, biome, region }));
const PLACE_IDS = [...PLACES.map(p => p.id), 'custom'];
const PLACE_LABELS = [...PLACES.map(p => p.name), 'My own place (set below)'];

const BIOME = {
  rainforest: { name: 'tropical rainforest', climate: 'Hot and wet all year', lat: [0, 25], ground: 'var(--hill-near)', far: 'var(--canopy)', scen: 'rainforest' },
  desert: { name: 'hot desert', climate: 'Hot days, cold nights and hardly any rain', lat: [0, 40], ground: 'var(--sand)', far: 'var(--sand-far)', scen: 'desert' },
  savanna: { name: 'savanna', climate: 'Hot all year, with a wet season and a dry season', lat: [0, 30], ground: 'var(--field)', far: 'var(--hill-far)', scen: 'savanna' },
  grassland: { name: 'grassland', climate: 'Warm summers, cold winters and not much rain', lat: [30, 60], ground: 'var(--field)', far: 'var(--hill-far)', scen: 'grassland' },
  temperate: { name: 'temperate forest', climate: 'Mild: warm summers, cool winters and rain all year', lat: [30, 65], ground: 'var(--hill-near)', far: 'var(--hill-far)', scen: 'temperate' },
  taiga: { name: 'cold forest (taiga)', climate: 'Long freezing winters and short cool summers', lat: [45, 72], ground: 'var(--hill-mid)', far: 'var(--hill-far)', scen: 'taiga' },
  'polar-north': { name: 'polar region', climate: 'Very cold, with ice and snow for most of the year', lat: [60, 90], ground: 'var(--snow-shade)', far: 'var(--ice-side)', scen: 'polar-north', north: true },
  'polar-south': { name: 'polar region', climate: 'Freezing cold and icy all year', lat: [60, 90], ground: 'var(--snow-shade)', far: 'var(--ice-side)', scen: 'polar-south', south: true },
};
const BIOME_IDS = Object.keys(BIOME);
const BIOME_LABELS = ['Tropical rainforest', 'Hot desert', 'Savanna', 'Grassland', 'Temperate forest', 'Cold forest (taiga)', 'Arctic (far north)', 'Antarctic (far south)'];

// Species: biomes and regions they honestly belong to (regions null = anywhere in that biome).
const AMERICAS = 'in the rainforests of Central and South America';
const SPECIES = {
  kapok: { name: 'Kapok tree', plant: true, biomes: ['rainforest'], regions: ['americas', 'africa'], where: 'in the rainforests of South America and West Africa', kit: ['biome', 'rainforest', 120, 150] },
  bromeliad: { name: 'Bromeliad', plant: true, biomes: ['rainforest'], regions: ['americas'], where: AMERICAS, icon: 'bromeliad' },
  saguaro: { name: 'Saguaro cactus', plant: true, biomes: ['desert'], regions: ['americas'], where: 'only in the deserts of the Americas', kit: ['biome', 'cactus', 60, 90] },
  datePalm: { name: 'Date palm', plant: true, biomes: ['desert'], regions: ['africa', 'asia'], where: 'at oases in the deserts of North Africa and Arabia', icon: 'datePalm' },
  acacia: { name: 'Acacia tree', plant: true, biomes: ['savanna', 'desert'], regions: ['africa', 'asia', 'oceania'], where: 'in the savannas and deserts of Africa, Arabia and Australia', kit: ['biome', 'acacia', 120, 90] },
  baobab: { name: 'Baobab tree', plant: true, biomes: ['savanna'], regions: ['africa', 'oceania'], where: 'in the savannas of Africa and Australia', icon: 'baobab' },
  grass: { name: 'Grasses', plant: true, pl: true, biomes: ['savanna', 'grassland', 'temperate'], regions: null, where: 'in savannas, grasslands and temperate places', kit: ['biome', 'grass', 34, 36] },
  conifer: { name: 'Conifer trees', plant: true, pl: true, biomes: ['taiga', 'temperate'], regions: ['europe', 'asia', 'americas'], where: 'in cold forests and temperate places', kit: ['biome', 'conifer', 80, 96] },
  oak: { name: 'Oak tree', plant: true, biomes: ['temperate'], regions: ['europe', 'asia', 'americas'], where: 'in temperate forests', kit: ['biome', 'seasonTree', 120, 140] },
  poppy: { name: 'Arctic poppy', plant: true, biomes: ['polar-north'], regions: null, where: 'only in the far north: the Arctic tundra', icon: 'poppy' },
  moss: { name: 'Moss and lichen', plant: true, pl: true, biomes: ['polar-north', 'polar-south', 'taiga'], regions: null, where: 'in polar places and cold forests', icon: 'moss' },
  jaguar: { name: 'Jaguar', biomes: ['rainforest'], regions: ['americas'], where: AMERICAS, icon: 'jaguar' },
  toucan: { name: 'Toucan', biomes: ['rainforest'], regions: ['americas'], where: AMERICAS, icon: 'toucan' },
  sloth: { name: 'Sloth', biomes: ['rainforest'], regions: ['americas'], where: AMERICAS, icon: 'sloth' },
  poisonFrog: { name: 'Poison dart frog', biomes: ['rainforest'], regions: ['americas'], where: AMERICAS, kit: ['org', 'frog'] },
  camel: { name: 'Camel', biomes: ['desert'], regions: ['africa', 'asia'], where: 'in the deserts of North Africa and Asia', icon: 'camel' },
  lion: { name: 'Lion', biomes: ['savanna'], regions: ['africa'], where: 'on the African savanna', icon: 'lion' },
  giraffe: { name: 'Giraffe', biomes: ['savanna'], regions: ['africa'], where: 'on the African savanna', icon: 'giraffe' },
  reindeer: { name: 'Reindeer', biomes: ['taiga', 'polar-north'], regions: ['europe', 'asia', 'americas', 'arctic'], where: 'in the far north: the Arctic and cold forests', icon: 'reindeer' },
  polarBear: { name: 'Polar bear', biomes: ['polar-north'], regions: null, where: 'only in the Arctic, in the far north', icon: 'polarBear' },
  penguin: { name: 'Penguin', biomes: ['polar-south'], regions: null, where: 'only in the southern half of the world, mostly in cold seas', icon: 'penguin' },
  seal: { name: 'Seal', biomes: ['polar-north', 'polar-south'], regions: null, where: 'in polar seas, north and south', icon: 'seal' },
  fox: { name: 'Red fox', biomes: ['temperate', 'taiga', 'grassland'], regions: ['europe', 'asia', 'americas'], where: 'in temperate places and cold forests', kit: ['org', 'fox'] },
  rabbit: { name: 'Rabbit', biomes: ['temperate', 'grassland'], regions: ['europe', 'americas'], where: 'in temperate places and grasslands', kit: ['org', 'rabbit'] },
  bird: { name: 'Robin', biomes: ['temperate'], regions: ['europe'], where: 'in the woods and gardens of Europe', kit: ['org', 'bird'] },
};
const PLANT_IDS = Object.keys(SPECIES).filter(k => SPECIES[k].plant), ANIMAL_IDS = Object.keys(SPECIES).filter(k => !SPECIES[k].plant);

/* ------------------------------------------------------------------ params */
export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Climate zones and biomes',
  properties: {
    title: TITLE_PARAM('Hot and cold places'),
    view: { type: 'string', title: 'What the slide shows', enum: ['hot-cold', 'zones', 'biome'], 'x-labels': ['Hot and cold places', 'Climate zones', 'A close-up of one place'], default: 'hot-cold' },
    places: {
      type: 'array', title: 'Places on the map', description: 'Each place sits at its real latitude, so its zone is worked out for you.', 'x-item': 'a place', maxItems: 5,
      default: [{ place: 'uk' }, { place: 'sahara' }, { place: 'antarctica' }],
      items: { type: 'object', required: ['place'], default: { place: 'uk' }, properties: { place: { type: 'string', title: 'Place', enum: PLACE_IDS, 'x-labels': PLACE_LABELS, default: 'uk' } } },
    },
    focus: {
      type: 'object', title: 'Close-up', description: 'Used when the slide shows a close-up of one place.',
      default: { place: 'amazon', plants: ['kapok', 'bromeliad'], animals: ['jaguar', 'toucan', 'sloth'] },
      properties: {
        place: { type: 'string', title: 'Place to zoom into', enum: PLACE_IDS, 'x-labels': PLACE_LABELS, default: 'amazon' },
        plants: { type: 'array', title: 'Plants', 'x-item': 'a plant', maxItems: 3, default: [], items: { type: 'string', enum: PLANT_IDS, 'x-labels': PLANT_IDS.map(k => SPECIES[k].name), default: 'grass' } },
        animals: { type: 'array', title: 'Animals', 'x-item': 'an animal', maxItems: 3, default: [], items: { type: 'string', enum: ANIMAL_IDS, 'x-labels': ANIMAL_IDS.map(k => SPECIES[k].name), default: 'fox' } },
      },
    },
    customPlace: {
      type: 'object', title: 'My own place', description: 'Used by “My own place” in the lists above.', 'x-panel': 'advanced',
      default: { name: 'Our school', lat: 52, lon: -1, biome: 'temperate' },
      properties: {
        name: { type: 'string', title: 'Name', minLength: 1, maxLength: 40, default: 'Our school' },
        lat: { type: 'number', title: 'Latitude (degrees, south is minus)', minimum: -90, maximum: 90, default: 52 },
        lon: { type: 'number', title: 'Longitude (degrees, west is minus)', minimum: -180, maximum: 180, default: -1 },
        biome: { type: 'string', title: 'Biome', enum: BIOME_IDS, 'x-labels': BIOME_LABELS, default: 'temperate' },
      },
    },
    bandWords: { type: 'string', title: 'Words for the bands', enum: ['auto', 'simple', 'zones'], 'x-labels': ['Match the view', 'Hot and cold', 'Climate zone names'], default: 'auto', 'x-panel': 'advanced' },
    showEquator: { type: 'boolean', title: 'Show the equator', default: true },
    showPoles: { type: 'boolean', title: 'Name the North and South Poles', default: true },
    showLatitude: { type: 'boolean', title: 'Show each place’s latitude', default: false, 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y1-hot-cold', name: 'Year 1: hot and cold places', params: {
    title: 'Hot and cold places', view: 'hot-cold',
    places: [{ place: 'uk' }, { place: 'sahara' }, { place: 'amazon' }, { place: 'arctic' }, { place: 'antarctica' }],
  } },
  { id: 'y3-zones', name: 'Year 3: climate zones', params: {
    title: 'The world’s climate zones', view: 'zones', showLatitude: true,
    places: [{ place: 'uk' }, { place: 'sahara' }, { place: 'borneo' }, { place: 'greenland' }],
  } },
  { id: 'y5-amazon', name: 'Year 5: the Amazon rainforest', params: {
    title: 'The Amazon rainforest', view: 'biome', showLatitude: true,
    focus: { place: 'amazon', plants: ['kapok', 'bromeliad'], animals: ['jaguar', 'toucan', 'sloth'] },
  } },
  { id: 'y2-polar', name: 'Year 2: the Arctic, up close', params: {
    title: 'Life in the Arctic', view: 'biome', bandWords: 'simple',
    focus: { place: 'arctic', plants: ['moss'], animals: ['polarBear', 'seal', 'reindeer'] },
  } },
];

/* ------------------------------------------------------------------ model of the data */
const fmtLat = lat => lat === 0 ? '0°' : `${Math.round(Math.abs(lat))}° ${lat > 0 ? 'N' : 'S'}`;
const zoneOf = lat => Math.abs(lat) <= TROPIC ? 'hot' : Math.abs(lat) >= POLAR ? 'cold' : 'mid';
// Coarse continent boxes for a teacher's own place, so species checks still apply to it.
function regionOf(lat, lon, biome) {
  if (lat <= -60) return 'antarctica';
  if (lat >= 60 && biome === 'polar-north') return 'arctic';
  if (lon < -30) return 'americas';
  if (lon > 110 && lat < -10) return 'oceania';
  if (lat > 35 && lon <= 60) return 'europe';
  if (lat <= 35 && lon <= 52) return 'africa';
  return 'asia';
}
function placeOf(P, id, path) {
  if (id === 'custom') { const c = P.customPlace || {}; return { id: 'custom', name: c.name, lat: c.lat, lon: c.lon, biome: c.biome, region: regionOf(c.lat, c.lon, c.biome), edit: 'customPlace.name', latPath: 'customPlace.lat', path }; }
  const k = PLACES.find(p => p.id === id); if (!k) return null;
  return { ...k, name: txt(P, `label:place:${id}`, k.name), edit: `text.label:place:${id}`, latPath: path, path };
}
function model(P) {
  const words = P.bandWords && P.bandWords !== 'auto' ? P.bandWords : P.view === 'hot-cold' ? 'simple' : 'zones';
  const places = P.view === 'biome' ? [] : (P.places || []).map((it, i) => Object.assign(placeOf(P, it.place, `places.${i}.place`) || {}, { i })).filter((p, n, all) => p.id && all.findIndex(q => q.id === p.id) === n);
  const focus = P.view === 'biome' ? placeOf(P, (P.focus || {}).place, 'focus.place') : null;
  const once = (id, n, l) => l.indexOf(id) === n;
  const plants = focus ? (P.focus.plants || []).filter(once).map(id => ({ id, ...SPECIES[id], name: txt(P, `label:sp:${id}`, SPECIES[id].name) })) : [];
  const animals = focus ? (P.focus.animals || []).filter(once).map(id => ({ id, ...SPECIES[id], name: txt(P, `label:sp:${id}`, SPECIES[id].name) })) : [];
  const L = {
    hot: txt(P, 'label:hot', words === 'simple' ? 'Hot near the equator' : 'Tropical zone'),
    cold: txt(P, 'label:cold', words === 'simple' ? 'Cold near the poles' : 'Polar zone'),
    mid: txt(P, 'label:temperate', 'Temperate zone'),
    equator: txt(P, 'label:equator', 'Equator'), north: txt(P, 'label:north', 'North Pole'), south: txt(P, 'label:south', 'South Pole'),
  };
  return { words, places, focus, plants, animals, L, lines: !!(P.showEquator || P.showPoles) };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const usesCustom = (P.view !== 'biome' && (P.places || []).some(p => p.place === 'custom')) || (P.view === 'biome' && P.focus.place === 'custom');
  if (usesCustom) {
    const c = P.customPlace, B = BIOME[c.biome], a = Math.abs(c.lat);
    if (B.north && c.lat < 0) R.push({ path: 'customPlace.biome', reason: 'The Arctic is in the far north, so its latitude is north (a plus number). Choose “Antarctic (far south)” for a place in the south.' });
    else if (B.south && c.lat > 0) R.push({ path: 'customPlace.biome', reason: 'Antarctica is in the far south, so its latitude is south (a minus number). Choose “Arctic (far north)” for a place in the north.' });
    else if (a < B.lat[0] || a > B.lat[1]) R.push({ path: 'customPlace.lat', reason: `A ${B.name} is found between ${B.lat[0]}° and ${B.lat[1]}° from the equator, and ${fmtLat(c.lat)} is ${a < B.lat[0] ? 'nearer the equator' : 'further from the equator'} than that. Check the latitude or the biome.` });
  }
  if (P.view !== 'biome') {
    const M = model(P);
    // a place listed twice is drawn once: a warning, so swapping two places one at a time never deadlocks
    (P.places || []).forEach((it, i, l) => { if (l.findIndex(q => q.place === it.place) !== i) W.push({ path: `places.${i}.place`, reason: `${(placeOf(P, it.place) || {}).name || 'This place'} is on the map twice, so it is shown once. Remove one of them.` }); });
    for (let i = 0; i < M.places.length; i++) for (let j = 0; j < i; j++) { const a = M.places[i], b = M.places[j];
      if (a.id !== b.id && Math.abs(a.lat - b.lat) < 8 && Math.abs(a.lon - b.lon) < 16) R.push({ path: a.path, reason: `${b.name} and ${a.name} are too close together to label on a world map. Choose one of them.` }); }
  } else {
    const M = model(P); const f = M.focus;
    const check = (list, key) => list.forEach((s, i) => {
      const okB = s.biomes.includes(f.biome), okR = !s.regions || !f.region || s.regions.includes(f.region);
      if (okB && okR) return;
      const S = SPECIES[s.id], pl = !!S.pl, verb = S.plant ? 'grow' : 'live', place = f.name.replace(/^The /, 'the ');
      const who = pl ? S.name : `The ${S.name.toLowerCase()}`;
      R.push({ path: `focus.${key}.${s.i ?? i}`, reason: `${who} ${pl ? 'do' : 'does'} not ${verb} in ${place}: ${pl ? 'they' : 'it'} ${pl ? verb : verb + 's'} ${S.where}. Choose ${S.plant ? 'a plant' : 'an animal'} that lives in a ${BIOME[f.biome].name}.` });
    });
    // species are checked at their own list position; a repeat is drawn once (a warning, not a refusal)
    const at = (key) => (P.focus[key] || []).map((id, i) => ({ id, i, ...SPECIES[id], name: txt(P, `label:sp:${id}`, SPECIES[id].name) }));
    const first = l => l.filter((s, n) => l.findIndex(x => x.id === s.id) === n);
    check(first(at('plants')), 'plants'); check(first(at('animals')), 'animals');
    const dup = (l, key) => l.forEach((s, n) => { if (l.findIndex(x => x.id === s.id) !== n) W.push({ path: `focus.${key}.${s.i}`, reason: `${s.name} is on the list twice, so it is shown once.` }); });
    dup(at('plants'), 'plants'); dup(at('animals'), 'animals');
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function placeCaption(p, words, lat) {
  const z = zoneOf(p.lat), where = lat ? ` (${fmtLat(p.lat)})` : '';
  if (words === 'simple') return z === 'hot' ? `${p.name} is near the equator, so it is hot.` : z === 'cold' ? `${p.name} is near a pole, so it is cold all year.`
    : p.biome === 'desert' ? `${p.name} is a hot desert, just outside the hot belt.` : `${p.name} is between the equator and a pole: not too hot, not too cold.`;
  return `${p.name}${where} is in the ${z === 'hot' ? 'tropical' : z === 'cold' ? 'polar' : 'temperate'} zone.`;
}
function plan(P) {
  const M = model(P); const S = []; const simple = M.words === 'simple';
  S.push({ key: 'map', caption: 'This is a map of the whole world, flattened out.' });
  if (M.lines) S.push({ key: 'lines', caption: P.showEquator && P.showPoles ? 'The equator runs round the middle of the Earth. The poles are at the very top and bottom.' : P.showEquator ? 'The equator is an imaginary line round the middle of the Earth.' : 'The North Pole is at the top of the world, the South Pole at the bottom.' });
  S.push({ key: 'hot', caption: simple ? 'Near the equator the Sun is high in the sky, so it is hot all year.' : 'The tropical zone lies either side of the equator. It is hot all year.' });
  S.push({ key: 'cold', caption: simple ? 'Near the poles the Sun stays low in the sky, so it is cold.' : 'The polar zones are around the poles. They are cold all year.' });
  if (!simple && P.view === 'zones') S.push({ key: 'mid', caption: 'Between them are the temperate zones, with warm summers and cool winters.' });
  M.places.forEach(p => S.push({ key: `place:${p.i}`, caption: placeCaption(p, M.words, P.showLatitude) }));
  let summary;
  if (M.focus) {
    const f = M.focus, B = BIOME[f.biome], z = zoneOf(f.lat);
    S.push({ key: 'place', caption: `${f.name} is ${z === 'hot' ? 'near the equator' : z === 'cold' ? 'near the ' + (f.lat > 0 ? 'North' : 'South') + ' Pole' : 'between the equator and the pole'}${P.showLatitude ? `, at ${fmtLat(f.lat)}` : ''}.` });
    S.push({ key: 'focus', caption: `${f.name} is a ${B.name}. ${txt(P, `label:climate:${f.biome}`, B.climate)}.` });
    const listCap = (lead, l, short) => { const c = `${lead}: ${l.map(s => s.name).join(', ')}.`; return c.length <= 110 ? c : short; };
    if (M.plants.length) S.push({ key: 'plants', caption: listCap('Plants that grow here', M.plants, 'These plants grow here, suited to this climate.') });
    if (M.animals.length) S.push({ key: 'animals', caption: listCap('Animals that live here', M.animals, 'These animals live here, suited to this climate.') });
    summary = `${f.name}: ${txt(P, `label:climate:${f.biome}`, B.climate).replace(/^./, c => c.toLowerCase())}, and the life that suits it.`;
  } else summary = simple ? 'Places near the equator are hot. Places near the poles are cold.' : 'Tropical near the equator, polar near the poles, temperate in between.';
  return { M, S, summary };
}
export function builds(P) { const { S, summary } = plan(P); return { steps: S.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, S } = plan(P);
  const steps = S.map(({ key }) => {
    if (key === 'map') return 'A flat map stretches the poles into the top and bottom edges. Show a globe too: the poles are points. The map shapes are simplified.';
    if (key === 'lines') return 'The equator is at 0° latitude. Ask: which half of the world do we live in?';
    if (key === 'hot') return `The tropics are about 23½° north and south of the equator. Sunlight hits the ground most directly here, so it heats it most.`;
    if (key === 'cold') return `Beyond the polar circles (about 66½°) sunlight arrives at a low slant and spreads out, so it warms the ground least. There are days when the Sun never rises.`;
    if (key === 'mid') return 'The UK is in the northern temperate zone. Hot deserts like the Sahara sit near the edge of the tropics, where dry air sinks.';
    if (key.startsWith('place:')) { const p = M.places.find(q => q.i === +key.slice(6)); return p ? `${p.name} is at about ${fmtLat(p.lat)}. Ask: is it nearer the equator or a pole?` : ''; }
    if (key === 'place') return `Latitude says how far north or south of the equator a place is. ${M.focus.name} is at about ${fmtLat(M.focus.lat)}.`;
    if (key === 'focus') return 'A biome is a large area with its own climate, plants and animals.';
    if (key === 'plants') return 'Ask: how is each plant suited to this climate?';
    if (key === 'animals') return 'Ask: what helps each animal survive here? Penguins live only in the south and polar bears only in the north.';
    return '';
  });
  return { steps, summary: 'Ask the class to sort the places into hot, cold and in between, and say why.' };
}

/* ------------------------------------------------------------------ the map */
// Simplified coastlines, [lon, lat]. Schematic, not a survey map; latitudes are honest.
const LAND = [
  [[-165, 65], [-160, 71], [-140, 70], [-120, 72], [-95, 72], [-80, 73], [-65, 60], [-56, 52], [-66, 45], [-70, 42], [-76, 35], [-81, 31], [-80, 25], [-84, 30], [-90, 30], [-97, 27], [-97, 21], [-91, 19], [-87, 21], [-88, 16], [-84, 15], [-83, 10], [-79, 9], [-77, 8], [-80, 7], [-86, 12], [-92, 15], [-105, 20], [-110, 24], [-115, 30], [-118, 34], [-124, 40], [-124, 48], [-130, 55], [-140, 60], [-150, 60], [-158, 57], [-165, 55], [-160, 59]],
  [[-55, 60], [-44, 60], [-35, 66], [-21, 70], [-18, 78], [-30, 83], [-60, 82], [-72, 78], [-58, 75], [-53, 68]],
  [[-77, 8], [-72, 12], [-62, 11], [-52, 5], [-50, 0], [-35, -6], [-39, -15], [-41, -22], [-48, -27], [-53, -34], [-58, -38], [-65, -42], [-67, -50], [-68, -55], [-72, -52], [-74, -45], [-73, -35], [-71, -25], [-70, -18], [-76, -14], [-81, -6], [-80, 0], [-78, 3]],
  [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [0, 49], [5, 53], [8, 54], [10, 57], [5, 58], [5, 62], [14, 67], [20, 70], [30, 71], [40, 67], [45, 68], [60, 69], [70, 73], [80, 73], [100, 77], [115, 74], [130, 71], [140, 72], [160, 70], [180, 69], [180, 65], [170, 60], [163, 58], [156, 51], [160, 60], [150, 59], [140, 54], [135, 44], [129, 40], [127, 35], [122, 40], [117, 39], [122, 31], [120, 24], [113, 22], [109, 19], [106, 10], [104, 9], [100, 13], [100, 6], [103, 1], [98, 8], [98, 16], [94, 17], [91, 22], [87, 21], [80, 15], [78, 8], [76, 10], [73, 18], [72, 22], [67, 25], [57, 25], [56, 27], [52, 24], [55, 22], [59, 22], [52, 16], [45, 13], [43, 13], [39, 21], [35, 28], [34, 30], [35, 33], [36, 36], [30, 36], [27, 37], [26, 40], [23, 40], [23, 37], [20, 40], [19, 42], [13, 46], [12, 44], [16, 40], [15, 38], [10, 44], [6, 43], [3, 43], [0, 39], [-5, 36]],
  [[-5, 50], [1, 51], [2, 53], [-2, 56], [-3, 58.5], [-6, 58], [-5, 55], [-3, 54], [-5, 52]],
  [[-10, 52], [-6, 52], [-6, 55], [-8, 55]],
  [[-24, 64], [-22, 66], [-15, 66.5], [-13, 65], [-18, 63.5]],
  [[-17, 21], [-17, 15], [-12, 8], [-8, 4.5], [0, 5], [9, 4], [10, 1], [12, -5], [13, -12], [12, -18], [15, -28], [18, -34], [20, -35], [26, -34], [32, -29], [35, -24], [40, -16], [40, -10], [39, -5], [42, 0], [51, 11], [43, 12], [38, 18], [35, 24], [32, 31], [25, 32], [20, 31], [10, 34], [10, 37], [0, 36], [-6, 36], [-10, 30], [-13, 27]],
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -16]],
  [[114, -22], [115, -34], [118, -35], [124, -33], [130, -31], [136, -35], [138, -34], [141, -38], [147, -38], [150, -37], [153, -28], [153, -25], [146, -19], [143, -11], [141, -17], [136, -12], [132, -11], [129, -15], [123, -17], [122, -19]],
  [[109, 1], [110, -3], [116, -4], [119, 1], [117, 7], [113, 3]],
  [[95, 5], [98, 4], [106, -3], [105, -6], [101, -3], [96, 3]],
  [[131, -1], [141, -3], [150, -10], [143, -9], [138, -8], [132, -4]],
  [[130, 31], [135, 34], [140, 36], [142, 41], [140, 41], [135, 35], [130, 33]],
  [[172, -35], [178, -38], [174, -41], [167, -46], [171, -44], [174, -39]],
  [[-180, -90], [-180, -78], [-150, -77], [-120, -74], [-90, -72], [-75, -72], [-62, -64], [-58, -63], [-60, -70], [-40, -78], [-20, -72], [0, -70], [30, -69], [60, -67], [90, -66], [120, -66], [150, -69], [170, -72], [180, -78], [180, -90]],
];

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b, N = ctx.N; const bi = k => b[k] ?? 0;
  const split = !!M.focus;
  const mp = { x: GRID.left, y: 150, w: 860, h: 430 }; // full width in every view; the close-up covers it
  // calm map colours mixed from the theme's ground, so the map dims with the night theme
  const night = ctx.name === 'night'; // warm tints go muddy on a dark ground, so night mixes them into the sea
  const C = {
    sea: 'color-mix(in oklab,var(--hue-blue) 30%,var(--bg))', land: 'color-mix(in oklab,var(--hue-green) 46%,var(--bg))',
    coast: 'color-mix(in oklab,var(--hue-green) 62%,var(--bg))', ice: `color-mix(in oklab,var(--cloud-shade) ${night ? 46 : 72}%,var(--bg))`,
    hotSea: night ? 'color-mix(in oklab,var(--hue-red) 30%,color-mix(in oklab,var(--hue-blue) 30%,var(--bg)))' : 'color-mix(in oklab,var(--hue-red) 13%,var(--bg))', cap: 'color-mix(in oklab,var(--cloud) 74%,var(--bg))',
  };
  const X = lon => mp.x + (lon + 180) / 360 * mp.w, Y = lat => mp.y + (90 - lat) / 180 * mp.h;
  const colX = mp.x + mp.w + 18, colW = GRID.right - colX;
  const softMap = split ? `${bi('focus')}-${N + 1}:soft` : null;
  const offAtFocus = split ? bi('focus') : null; // map-side words leave when the close-up opens

  /* map: ocean, land, then bands clipped to the map */
  const mapG = h('g', { s: 0, c: softMap }, root);
  const cid = ctx.uid + '-map'; h('rect', { x: mp.x, y: mp.y, width: mp.w, height: mp.h }, h('clipPath', { id: cid }, h('defs', {}, mapG)));
  const clipG = h('g', { 'clip-path': `url(#${cid})` }, mapG);
  h('rect', { x: mp.x, y: mp.y, width: mp.w, height: mp.h, fill: C.sea }, clipG);
  const landD = poly => 'M' + poly.map(([lo, la]) => `${X(lo).toFixed(1)} ${Y(la).toFixed(1)}`).join(' L ') + ' Z';
  const drawLand = g => LAND.forEach((poly, i) => h('path', { d: landD(poly), fill: i === LAND.length - 1 ? C.ice : C.land, stroke: i === LAND.length - 1 ? 'none' : C.coast, 'stroke-width': 'var(--sw-hair)', 'stroke-linejoin': 'round' }, g));
  drawLand(clipG);
  const band = (la0, la1, fill, op, a) => h('rect', Object.assign({ x: mp.x, y: Y(la0), width: mp.w, height: Y(la1) - Y(la0), fill, opacity: op }, a), clipG);
  const hotK = bi('hot'), coldK = bi('cold'), midK = b.mid;
  { // hot belt: warm sea, the land redrawn on top, one light warm wash (no purple from tinting blue)
    const hid = ctx.uid + '-hot'; h('rect', { x: mp.x, y: Y(TROPIC), width: mp.w, height: Y(-TROPIC) - Y(TROPIC) }, h('clipPath', { id: hid }, h('defs', {}, mapG)));
    const hg = h('g', { 'clip-path': `url(#${hid})`, s: hotK }, clipG);
    h('rect', { x: mp.x, y: Y(TROPIC), width: mp.w, height: Y(-TROPIC) - Y(TROPIC), fill: C.hotSea }, hg);
    drawLand(hg);
    h('rect', { x: mp.x, y: Y(TROPIC), width: mp.w, height: Y(-TROPIC) - Y(TROPIC), fill: 'var(--heat)', opacity: night ? .04 : .06 }, hg);
  }
  band(90, POLAR, C.cap, night ? .4 : .62, { s: coldK, cls: 'rise' }); band(-POLAR, -90, C.cap, night ? .4 : .62, { s: coldK, cls: 'rise' });
  if (midK != null) { band(POLAR, TROPIC, 'var(--life)', .14, { s: midK }); band(-TROPIC, -POLAR, 'var(--life)', .14, { s: midK }); }
  const dashed = (la, k) => h('line', { x1: mp.x, x2: mp.x + mp.w, y1: Y(la), y2: Y(la), stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '6 6', s: k }, clipG);
  for (const la of [TROPIC, -TROPIC]) dashed(la, hotK); for (const la of [POLAR, -POLAR]) dashed(la, coldK);
  h('rect', { x: mp.x, y: mp.y, width: mp.w, height: mp.h, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, mapG);

  const under = h('g', {}, root); // the zoom wedge, beneath every label
  const labels = h('g', {}, root);
  const taken = []; // label boxes on and around the map

  /* equator and poles */
  const linesK = bi('lines');
  const lineG = h('g', { s: linesK, hide: offAtFocus, c: split ? null : ctx.rc('lines', N, null, 'soft') }, labels);
  if (P.showEquator) {
    const ey = Y(0); const el = h('line', { x1: mp.x, x2: mp.x + mp.w, y1: ey, y2: ey, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', cls: 'draw', pathLength: 1, s: linesK }, lineG);
    el.style.setProperty('--t-build-draw', 'calc(1400ms * var(--pace))');
    // the name sits on the line's left end, wrapped into a fixed width so a long edit grows upward, never across the map
    const eqW = 280, tmp = h('g', {}, root); const tb = textBlock(tmp, 0, 0, M.L.equator, { cls: 'ts-small', maxW: eqW, maxLines: 2, lh: 26, a: { cls: 'strong' } }); tmp.remove();
    const eqG = h('g', { hide: split ? bi('place') : null }, lineG);
    const lb = { x: mp.x + 8, y: ey - 8 - (tb.h + 12), w: tb.w + 16, h: tb.h + 12 }; labelGround(eqG, lb); taken.push(lb);
    textBlock(eqG, mp.x + 16, lb.y + 27, M.L.equator, { cls: 'ts-small', maxW: eqW, maxLines: 2, lh: 26, a: { fill: 'var(--ink)', cls: 'strong' }, edit: 'text.label:equator' });
  }
  if (P.showPoles) {
    const cx = mp.x + mp.w / 2;
    for (const [t, y, path, top] of [[M.L.north, mp.y - 12, 'text.label:north', true], [M.L.south, mp.y + mp.h + 30, 'text.label:south', false]]) {
      // one line across the map's width: a long edit shrinks, then ends in "…", never past the map's edges
      const tb = textBlock(lineG, cx, y, t, { cls: 'ts-small', maxW: mp.w - 40, maxLines: 1, lh: 26, anchor: 'middle', a: { fill: 'var(--ink)', cls: 'strong' }, edit: path });
      taken.push({ x: cx - tb.w / 2, y: y - 24, w: tb.w, h: 30 });
      h('circle', { cx, cy: top ? mp.y : mp.y + mp.h, r: 6, fill: 'var(--ink)' }, lineG);
    }
  }
  if (!split && P.showPoles && mp.y + mp.h + 30 > GRID.bottom + 4) ctx.warn('climate_biomes: South Pole label below the stage');

  /* band labels in a column beside the map: a coloured bar the height of the band, then its name */
  const items = [
    { key: 'hot', la0: TROPIC, la1: -TROPIC, fill: 'var(--heat)', tcol: 'var(--heat-text)', text: M.L.hot, edit: 'text.label:hot' },
    { key: 'cold', la0: 90, la1: POLAR, fill: 'var(--s-cool)', tcol: 'var(--s-cool-text)', text: M.L.cold, edit: 'text.label:cold' },
    { key: 'cold', la0: -POLAR, la1: -90, fill: 'var(--s-cool)', tcol: 'var(--s-cool-text)', text: M.L.cold, edit: 'text.label:cold' },
  ];
  if (midK != null) items.push({ key: 'mid', la0: POLAR, la1: TROPIC, fill: 'var(--life)', tcol: 'var(--ink)', text: M.L.mid, edit: 'text.label:temperate' },
    { key: 'mid', la0: -TROPIC, la1: -POLAR, fill: 'var(--life)', tcol: 'var(--ink)', text: M.L.mid, edit: 'text.label:temperate' });
  const placed = [];
  for (const it of items.sort((a, c) => c.la0 - a.la0)) {
    const y0 = Y(it.la0) + 2, y1 = Y(it.la1) - 2, cy = (y0 + y1) / 2, k = bi(it.key);
    const g = h('g', { s: k, cls: 'rise', hide: offAtFocus }, labels);
    h('rect', { x: colX, y: y0, width: 8, height: y1 - y0, rx: 4, fill: it.fill }, g);
    const tmp = h('g', {}, root); const tb0 = textBlock(tmp, 0, 0, it.text, { cls: 'ts-small', maxW: colW - 22, maxLines: split ? 3 : 2, lh: 28, a: { cls: 'strong' } }); tmp.remove();
    let top = clamp(cy - tb0.h / 2, mp.y - 6, mp.y + mp.h + 6 - tb0.h);
    for (const q of placed) if (top < q.y + q.h + 6 && q.y < top + tb0.h + 6) top = q.y + q.h + 6;
    if (top + tb0.h > mp.y + mp.h + 24) ctx.warn(`climate_biomes: no room for the label “${it.text}”`);
    placed.push({ y: top, h: tb0.h });
    textBlock(g, colX + 20, top + 21, it.text, { cls: 'ts-small', maxW: colW - 22, maxLines: split ? 3 : 2, lh: 28, a: { fill: it.tcol, cls: 'strong' }, edit: it.edit });
  }

  /* places: a dot coloured by its zone, the name on a paper ground beside it */
  const dotCol = lat => ({ hot: 'var(--heat)', cold: 'var(--s-cool)', mid: 'var(--life)' })[zoneOf(lat)];
  const dots = [];
  const list = M.focus ? [Object.assign({}, M.focus, { key: 'place' })] : M.places.map(p => Object.assign({}, p, { key: `place:${p.i}` }));
  for (const p of list) dots.push({ x: X(p.lon) - 10, y: Y(p.lat) - 10, w: 20, h: 20 });
  const bounds = split ? { x0: 24, x1: colX - 8 } : { x0: 24, x1: colX - 8 };
  list.forEach((p, n) => {
    const k = bi(p.key), x = X(p.lon), y = Y(p.lat);
    let box = null, maxW, maxLines, tb0;
    const sizes = [[split ? 220 : 240, 2], [170, 2], [240, 1], [150, 1], [110, 1]];
    for (const [mw, ml] of sizes) {
      maxW = mw; maxLines = ml;
      const tmp = h('g', {}, root); tb0 = textBlock(tmp, 0, 0, p.name, { cls: 'ts-small', maxW, maxLines, lh: 26, a: { cls: 'strong' } });
      const lw = P.showLatitude ? measure(tmp, fmtLat(p.lat), 'ts-tiny') : 0; tmp.remove();
      const bw = Math.max(tb0.w, lw) + 20, bh = tb0.h + (P.showLatitude ? 26 : 0) + 12;
      const cands = [['r', x + 14, y - bh / 2], ['l', x - 14 - bw, y - bh / 2], ['a', x - bw / 2, y - 14 - bh], ['b', x - bw / 2, y + 14],
        ['ar', x + 8, y - 10 - bh], ['br', x + 8, y + 10], ['al', x - 8 - bw, y - 10 - bh], ['bl', x - 8 - bw, y + 10]];
      if (split) cands.unshift(cands.splice(2, 1)[0], cands.splice(1, 1)[0]);
      for (const [, bx, by] of cands) { const c = { x: bx, y: by, w: bw, h: bh };
        if (c.x < bounds.x0 || c.x + c.w > bounds.x1 || c.y < GRID.top - 4 || c.y + c.h > GRID.bottom) continue;
        if (taken.some(q => overlaps(c, q, 6)) || dots.some((d, j) => j !== n && overlaps(c, d, 4))) continue; box = c; break; }
      if (box) break;
    }
    if (!box) { ctx.warn(`climate_biomes: no room for the place label “${p.name}”`); return; } // never drawn over another label
    taken.push(box);
    // one callout at a time: it leaves at the next build (the dot stays) and all return in the summary
    const callout = (s, hide) => { const g = h('g', { s, cls: 'rise', hide }, labels);
      labelGround(g, box);
      textBlock(g, box.x + 10, box.y + 27, p.name, { cls: 'ts-small', maxW, maxLines, lh: 26, a: { fill: 'var(--ink)', cls: 'strong' }, edit: p.edit });
      if (P.showLatitude) computed(T(g, box.x + 10, box.y + tb0.h + 30, fmtLat(p.lat), 'ts-tiny'), p.latPath); };
    if (split) callout(k, offAtFocus);
    else if (k + 1 >= N) callout(k, null);
    else { callout(k, k + 1); callout(N, null); }
    h('circle', { cx: x, cy: y, r: 9, fill: dotCol(p.lat), stroke: 'var(--paper)', 'stroke-width': 3, s: k, cls: 'pop', c: softMap }, labels);
  });

  /* the close-up */
  if (M.focus) {
    const f = M.focus, B = BIOME[f.biome], fk = bi('focus');
    const bx = { x: 560, y: 136, w: GRID.right - 560, h: GRID.bottom - 136 };
    const fx = X(f.lon), fy = Y(f.lat);
    h('polygon', { points: `${fx},${fy - 8} ${fx},${fy + 8} ${bx.x},${bx.y + bx.h} ${bx.x},${bx.y}`, fill: 'var(--cone)', s: fk, cls: 'rise' }, under);
    const pg = h('g', { s: fk, cls: 'rise' }, root);
    h('rect', { x: bx.x, y: bx.y, width: bx.w, height: bx.h, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'lift body' }, pg);
    const pid = ctx.uid + '-panel'; h('rect', { x: bx.x, y: bx.y, width: bx.w, height: bx.h, rx: 14 }, h('clipPath', { id: pid }, h('defs', {}, pg)));
    const inner = h('g', { 'clip-path': `url(#${pid})` }, pg);
    // heading: the place, then its climate in one line
    const head = textBlock(inner, bx.x + 24, bx.y + 42, f.name, { cls: 'ts-label', maxW: bx.w - 48, maxLines: 1, a: { fill: 'var(--ink)' }, edit: f.edit });
    textBlock(inner, bx.x + 24, bx.y + 42 + head.lh + 4, txt(P, `label:climate:${f.biome}`, B.climate), { cls: 'ts-small', maxW: bx.w - 48, maxLines: 2, lh: 28, edit: `text.label:climate:${f.biome}` });
    // the landscape: sky, a far layer, the ground
    const sy0 = bx.y + 128, hz = bx.y + 270, gb = bx.y + bx.h;
    const sc = h('g', {}, inner);
    const skyR = sky(sc, ctx, hz + 20, bx.x, bx.x + bx.w); skyR.setAttribute('y', sy0); skyR.setAttribute('height', hz + 20 - sy0);
    const polar = f.biome.startsWith('polar'), forest = f.biome === 'rainforest';
    // a row of round crowns: the layered canopy of a rainforest
    const crowns = (yb, r, fill, seed) => { let x = bx.x - r * .4, i = 0;
      while (x < bx.x + bx.w + r) { const rr = r * (.78 + .44 * (((i * 7 + seed) % 5) / 4)); h('circle', { cx: x, cy: yb - rr * .55, r: rr, fill }, sc); x += r * 1.25; i++; }
      h('rect', { x: bx.x, y: yb - 2, width: bx.w, height: gb - yb + 2, fill }, sc); };
    if (polar) {
      ground(sc, bx.x, bx.x + bx.w, hz - 40, hz + 12, 'var(--sea-1)'); // open sea to the horizon
      for (const [u, w0, ht] of [[.16, 70, 26], [.52, 110, 38], [.86, 60, 22]]) { const cx = bx.x + bx.w * u; // far icebergs
        h('polygon', { points: `${cx - w0 / 2},${hz - 34} ${cx - w0 / 4},${hz - 34 - ht} ${cx + w0 / 6},${hz - 30 - ht} ${cx + w0 / 2},${hz - 34}`, fill: 'var(--ice-side)' }, sc); }
    } else if (forest) { // three canopy layers, far to near, with trunks under the nearest
      crowns(hz - 60, 30, 'var(--hill-far)', 1); crowns(hz - 32, 40, 'var(--hill-mid)', 3);
      for (let x = bx.x + 30; x < bx.x + bx.w; x += 74) h('rect', { x: x - 5, y: hz - 30, width: 10, height: 40, fill: 'var(--trunk)' }, sc);
      crowns(hz - 26, 34, 'var(--life-shade)', 2); }
    else hills(sc, { x0: bx.x, x1: bx.x + bx.w, yBase: hz + 10, amp: 40, fill: B.far, seed: 4, bumps: 4 });
    // the ground the animals stand on: sea ice, a leaf-litter forest floor, or the biome's ground
    const floor = polar ? (night ? 'color-mix(in oklab,var(--snow-shade) 60%,var(--bg))' : 'var(--snow-shade)') : forest ? `color-mix(in oklab,color-mix(in oklab,var(--hue-brown) 34%,var(--hill-mid)) ${night ? 55 : 100}%,var(--bg))` : B.ground;
    ground(sc, bx.x, bx.x + bx.w, hz + 8, gb, floor);
    if (polar) h('rect', { x: bx.x, y: hz + 8, width: bx.w, height: 6, fill: 'var(--ice-side)' }, sc); // the ice edge
    if (forest) h('rect', { x: bx.x, y: hz + 8, width: bx.w, height: 10, fill: 'var(--hill-shade)', opacity: .5 }, sc); // shade under the canopy
    h('line', { x1: bx.x, x2: bx.x + bx.w, y1: sy0, y2: sy0, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, sc);
    // far scenery only from honest biome tags (cacti only in the Americas); none if nothing fits
    const scenTag = f.biome === 'desert' && f.region === 'americas' ? 'desert-americas' : B.scen;
    const scen = biomeSceneryFor(scenTag).filter(k => k !== 'grass');
    if (scen.length && !polar && !forest) [[.1, .5], [.9, .45]].forEach(([u, s], i) => biomeObject(sc, scen[i % scen.length], bx.x + bx.w * u, hz + 12, s, { opacity: .55 }));
    // plants on the back row, animals on the front row, each named on a paper ground
    const prep = (list) => list.map((S, i) => {
      const n = list.length, cx = bx.x + bx.w * (i + .5) / n, slotW = bx.w / n - 20;
      const tmp = h('g', {}, root); const tb = textBlock(tmp, 0, 0, S.name, { cls: 'ts-small', maxW: slotW - 16, maxLines: 2, lh: 26, a: { cls: 'strong' } }); tmp.remove();
      const size = S.icon ? [ICONS[S.icon].w, ICONS[S.icon].h] : S.kit[0] === 'org' ? [ORGANISM_SIZE[S.kit[1]].w, ORGANISM_SIZE[S.kit[1]].h] : [S.kit[2], S.kit[3]];
      return { S, i, cx, slotW, tb, size };
    });
    const draw = (rows, key, baseY, labY, maxH) => rows.forEach(({ S, i, cx, slotW, tb, size }) => {
      const k = Math.min(1, (slotW - 6) / size[0], maxH / size[1]);
      const sg = h('g', { s: bi(key), cls: 'rise', delay: i * 240 }, inner);
      if (polar && S.plant) { const rx = Math.min(slotW / 2, size[0] * k * .7 + 30); // bare rock showing through the snow
        h('path', { d: `M${cx - rx} ${baseY + 6} Q ${cx - rx * .5} ${baseY - 16} ${cx} ${baseY - 14} Q ${cx + rx * .6} ${baseY - 14} ${cx + rx} ${baseY + 6} Z`, fill: 'var(--stone)' }, sg); }
      if (S.icon) { const ig = h('g', { transform: `translate(${cx} ${baseY}) scale(${k})` }, sg); ICONS[S.icon].draw(ig); }
      else if (S.kit[0] === 'org') organism(sg, S.kit[1], cx, baseY, k);
      else biomeObject(sg, S.kit[1], cx, baseY, k);
      const lb = { x: cx - tb.w / 2 - 8, y: labY - 24, w: tb.w + 16, h: tb.h + 10 };
      labelGround(sg, lb);
      textBlock(sg, cx, labY, S.name, { cls: 'ts-small', maxW: slotW - 16, maxLines: 2, lh: 26, anchor: 'middle', a: { fill: 'var(--ink)', cls: 'strong' }, edit: `text.label:sp:${S.id}` });
      if (lb.y + lb.h > gb - 2) ctx.warn(`climate_biomes: the name “${S.name}” runs off the close-up`);
    });
    const pr = prep(M.plants), ar = prep(M.animals);
    const pBase = hz + 30, pLab = pBase + 30, pBottom = pr.length ? pLab - 24 + Math.max(...pr.map(r => r.tb.h)) + 10 : hz;
    const aH = ar.length ? Math.max(...ar.map(r => r.tb.h)) : 26, aLab = gb - 12 - aH + 18, aBase = aLab - 30;
    draw(pr, 'plants', pBase, pLab, Math.min(160, pBase - (bx.y + 150)));
    draw(ar, 'animals', aBase, aLab, Math.max(48, Math.min(100, aBase - pBottom - 10)));
  }
  return {};
}

// The shared cut-out picture library (libdata track 2). One registry of subjects (animals, plants,
// objects, people's roles, weather, planets) in the library's flat art style, for every model that shows
// a thing. It was seeded from all the art the models already had, de-duplicated: where two models drew
// the same subject, the most detailed drawing is canonical and the others are listed in `alts`.
//
//   findSubject(name)                 -> entry | null. Exact names and true synonyms only, never the
//                                        nearest thing ("shark" never finds the seal).
//   drawSubjectAt(p, id, x, y, w, h, {anchor: 'centre' | 'base', area, a}) -> <g>, fitted to the box
//   picture(p, name, x, y, w, h, opts) -> {g, how: 'library' | 'source' | 'card', id?}
//        the library first; then a registered source (the photo library or generation, see
//        registerSubjectSource); then the labelled card from track 1. Misses are queued (wanted()).
//   coverage(names)                   -> {have: [[name, id]], missing: [names]}
//
// Drawings come from the kit and model art modules, unchanged: each is drawn at the origin, measured
// and fitted, so their different anchors and sizes do not matter to callers.
import { h } from './svg.js';
import { countable } from './batch-A.js';
import { pictoSymbol } from './batch-C.js';
import { organism, habitatObject } from './batch-D.js';
import { apparatus } from './batch-E.js';
import { planet, weatherIcon, seasonTree, biomeObject } from './batch-F.js';
import { figure, periodObject } from './batch-G.js';
import { robot } from './batch-H.js';
import { object } from './components.js';
import { pictureCard, registerPictureSource, setPictureLibrary, noteArt } from './pictures.js';
import { drawOrganism } from '../models/food_chain/organisms.js';
import { drawPicture as classifyPicture, pictureSize as classifySize } from '../models/classify_key/pictures.js';
import { drawPic as sortPic, picFor as sortPicFor } from '../models/sort_venn_carroll/pictures.js';
import { drawCreature } from '../models/microhabitat_survey/creatures.js';
import { drawArt as lifeArt } from '../models/life_cycle/art.js';
import { ICONS as CLIMATE } from '../models/climate_biomes/life.js';

/* ------------------------------------------------------------------ sources (how to draw a key) */
const SRC = {
  countable: (g, k) => countable(g, k, 0, 0, 100),
  picto: (g, k) => pictoSymbol(g, k, 0, 0, 100),
  organism: (g, k) => organism(g, k, 0, 0, 1),
  habitat: (g, k) => habitatObject(g, k, 0, 0, 1),
  apparatus: (g, k) => apparatus(g, k, 0, 0, 1),
  planet: (g, k) => planet(g, k, 0, 0, 50),
  weather: (g, k) => weatherIcon(g, k, 0, 0, 1),
  seasonTree: (g, k) => seasonTree(g, 0, 0, k, 1),
  biome: (g, k) => biomeObject(g, k, 0, 0, 1),
  role: (g, k) => figure(g, k, 0, 0, 1),
  period: (g, k) => periodObject(g, k, 0, 0, 1),
  robot: g => robot(g, { x: 0, y: 0, size: 100, dir: 'E' }),
  object: (g, k) => object(g, k, 0, 0, 1),
  foodChain: (g, k) => drawOrganism(g, k, 0, 0, 1),
  classify: (g, k) => { const z = classifySize(k) || { w: 100, h: 100 }; return classifyPicture(g, k, 0, 0, z.w, z.h); },
  sortVenn: (g, k) => sortPic(g, sortPicFor(k), 0, 0, 100),
  creature: (g, k) => drawCreature(g, k, 0, 0, 1),
  lifeCycle: (g, k) => lifeArt(g, k, 0, 0, 1),
  climate: (g, k) => CLIMATE[k].draw(g),
};
/** Where the seed art came from (source key -> module), for the coverage report. */
export const SOURCE_MODULES = {
  countable: 'kit/batch-A.js', picto: 'kit/batch-C.js', organism: 'kit/batch-D.js', habitat: 'kit/batch-D.js', apparatus: 'kit/batch-E.js',
  planet: 'kit/batch-F.js', weather: 'kit/batch-F.js', seasonTree: 'kit/batch-F.js', biome: 'kit/batch-F.js', role: 'kit/batch-G.js',
  period: 'kit/batch-G.js', robot: 'kit/batch-H.js', object: 'kit/components.js', foodChain: 'models/food_chain/organisms.js',
  classify: 'models/classify_key/pictures.js', sortVenn: 'models/sort_venn_carroll/pictures.js', creature: 'models/microhabitat_survey/creatures.js',
  lifeCycle: 'models/life_cycle/art.js', climate: 'models/climate_biomes/life.js',
};

/* ------------------------------------------------------------------ the registry
   [id, category, [source, key], names (synonyms that are the same thing), alts (other drawings of it)]
   A stage or age is its own subject (chick, tadpole, seedling): it is never an alias of the adult. */
const A = 'animal', PL = 'plant', O = 'object', PE = 'person', W = 'weather', SP = 'space', PLACE = 'place';
const ROWS = [
  // animals
  ['ant', A, ['creature', 'ant']], ['bat', A, ['classify', 'bat']], ['bee', A, ['classify', 'bee'], ['honeybee', 'honey bee', 'bumblebee']],
  ['beetle', A, ['creature', 'beetle'], [], [['foodChain', 'beetle']]], ['bird', A, ['organism', 'bird']],
  ['butterfly', A, ['organism', 'butterfly']], ['camel', A, ['climate', 'camel']], ['caterpillar', A, ['organism', 'caterpillar']],
  ['centipede', A, ['creature', 'centipede']], ['chick', A, ['organism', 'chick'], ['baby chicken', 'chicken chick']],
  ['hen', A, ['organism', 'hen'], ['chicken', 'adult hen'], [['classify', 'hen']]], ['egg', A, ['organism', 'egg'], ['hen egg', 'chicken egg']],
  ['chrysalis', A, ['organism', 'chrysalis'], ['pupa']], ['duck', A, ['countable', 'duck']], ['earwig', A, ['creature', 'earwig']],
  ['grasshopper', A, ['creature', 'grasshopper']], ['millipede', A, ['creature', 'millipede']], ['slug', A, ['creature', 'slug']],
  ['woodlouse', A, ['creature', 'woodlouse'], [], [['classify', 'woodlouse']]], ['snail', A, ['creature', 'snail'], [], [['foodChain', 'snail']]],
  ['spider', A, ['creature', 'spider'], [], [['classify', 'spider']]], ['ladybird', A, ['creature', 'ladybird'], ['ladybug'], [['classify', 'ladybird']]],
  ['worm', A, ['organism', 'worm'], ['earthworm'], [['creature', 'worm']]], ['fish', A, ['organism', 'fish'], [], [['sortVenn', 'fish']]],
  ['fox', A, ['organism', 'fox'], ['red fox']], ['frog', A, ['organism', 'frog'], ['common frog'], [['creature', 'frog']]],
  ['frogspawn', A, ['organism', 'frogspawn'], ['frog spawn']], ['tadpole', A, ['organism', 'tadpole']], ['froglet', A, ['organism', 'froglet']],
  ['giraffe', A, ['climate', 'giraffe'], [], [['foodChain', 'giraffe']]], ['heron', A, ['foodChain', 'heron'], ['grey heron']],
  ['jaguar', A, ['climate', 'jaguar']], ['toucan', A, ['climate', 'toucan']], ['sloth', A, ['climate', 'sloth']], ['reindeer', A, ['climate', 'reindeer'], ['caribou']],
  ['lion', A, ['climate', 'lion'], [], [['foodChain', 'lion']]], ['lizard', A, ['classify', 'lizard']], ['newt', A, ['classify', 'newt']],
  ['penguin', A, ['climate', 'penguin'], [], [['classify', 'penguin']]], ['shark', A, ['classify', 'shark']], ['snake', A, ['classify', 'snake']],
  ['whale', A, ['classify', 'whale']], ['mouse', A, ['foodChain', 'mouse'], ['field mouse']], ['owl', A, ['foodChain', 'owl']],
  ['polar bear', A, ['climate', 'polarBear'], [], [['foodChain', 'polarbear']]], ['rabbit', A, ['organism', 'rabbit']],
  ['seal', A, ['climate', 'seal'], [], [['foodChain', 'seal']]], ['zebra', A, ['foodChain', 'zebra']],
  ['plankton', A, ['foodChain', 'plankton'], ['phytoplankton']], ['zooplankton', A, ['foodChain', 'zooplankton']],
  // people (ages and roles)
  ['baby', PE, ['organism', 'baby']], ['child', PE, ['organism', 'child'], ['kid']], ['adult', PE, ['organism', 'adult'], ['grown up', 'grownup']],
  ['person', PE, ['role', 'person'], [], [['picto', 'person'], ['object', 'person']]], ['firefighter', PE, ['role', 'firefighter'], ['fireman', 'firewoman']],
  ['nurse', PE, ['role', 'nurse']], ['doctor', PE, ['role', 'doctor']], ['police officer', PE, ['role', 'police'], ['policeman', 'policewoman']],
  ['postal worker', PE, ['role', 'postal'], ['postman', 'postwoman', 'post worker']], ['lollipop person', PE, ['role', 'lollipop'], ['school crossing patrol', 'lollipop lady', 'lollipop man']],
  ['teacher', PE, ['role', 'teacher']], ['refuse collector', PE, ['role', 'refuse'], ['bin collector', 'binman']], ['vet', PE, ['role', 'vet'], ['veterinary surgeon']],
  // plants
  ['flower', PL, ['organism', 'flower']], ['tree', PL, ['organism', 'tree'], [], [['habitat', 'tree'], ['object', 'tree']]],
  ['tree in spring', PL, ['seasonTree', 'spring'], ['spring tree']], ['tree in summer', PL, ['seasonTree', 'summer'], ['summer tree']],
  ['tree in autumn', PL, ['seasonTree', 'autumn'], ['autumn tree']], ['tree in winter', PL, ['seasonTree', 'winter'], ['winter tree', 'bare tree']],
  ['grass', PL, ['organism', 'grass'], [], [['biome', 'grass']]], ['seed', PL, ['organism', 'seed']], ['seedling', PL, ['organism', 'sprout'], ['sprout', 'shoot']],
  ['reeds', PL, ['habitat', 'reeds'], ['reed', 'bulrush']], ['lily pad', PL, ['habitat', 'lilypad'], ['water lily leaf']], ['seaweed', PL, ['habitat', 'seaweed'], ['kelp']],
  ['acacia', PL, ['biome', 'acacia'], ['acacia tree'], [['habitat', 'acacia'], ['foodChain', 'acacia']]], ['conifer', PL, ['biome', 'conifer'], ['pine tree', 'fir tree', 'evergreen tree']],
  ['cactus', PL, ['biome', 'cactus']], ['palm tree', PL, ['object', 'palm'], ['palm']], ['rainforest tree', PL, ['biome', 'rainforest']],
  ['date palm', PL, ['climate', 'datePalm']], ['baobab', PL, ['climate', 'baobab'], ['baobab tree']], ['bromeliad', PL, ['climate', 'bromeliad']],
  ['poppy', PL, ['climate', 'poppy']], ['moss', PL, ['climate', 'moss']], ['pondweed', PL, ['foodChain', 'pondweed']], ['leaf', PL, ['sortVenn', 'leaf']],
  ['bean plant', PL, ['lifeCycle', 'beanPlant']], ['seed head', PL, ['lifeCycle', 'seedhead'], ['dandelion clock']], ['bean pod', PL, ['lifeCycle', 'pods'], ['pea pod']],
  // objects
  ['counter', O, ['countable', 'counter']], ['star', O, ['countable', 'star'], [], [['picto', 'star'], ['sortVenn', 'star']]],
  ['apple', O, ['countable', 'apple'], [], [['picto', 'apple'], ['sortVenn', 'apple']]], ['car', O, ['countable', 'car'], [], [['period', 'car'], ['sortVenn', 'car']]],
  ['ball', O, ['picto', 'ball'], ['football'], [['sortVenn', 'ball']]], ['book', O, ['picto', 'book'], [], [['sortVenn', 'book']]],
  ['button', O, ['sortVenn', 'button']], ['brick', O, ['sortVenn', 'brick']], ['orange', O, ['sortVenn', 'orange']], ['banana', O, ['sortVenn', 'banana']],
  ['cup', O, ['sortVenn', 'cup'], ['mug']], ['sock', O, ['sortVenn', 'sock']], ['hat', O, ['sortVenn', 'hat']], ['pencil', O, ['sortVenn', 'pencil']],
  ['plate', O, ['sortVenn', 'plate']], ['coin', O, ['sortVenn', 'coin']], ['fire engine', O, ['period', 'fire_engine'], ['fire truck'], [['sortVenn', 'fire engine']]],
  ['horse and cart', O, ['period', 'horse_cart']], ['early car', O, ['period', 'early_car'], ['vintage car']], ['police car', O, ['period', 'police_car']],
  ['bus', O, ['period', 'bus']], ['ambulance', O, ['period', 'ambulance']], ['post van', O, ['period', 'post_van'], ['mail van']], ['bin lorry', O, ['period', 'bin_lorry'], ['rubbish truck']],
  ['gas lamp', O, ['period', 'gas_lamp']], ['street lamp', O, ['period', 'street_lamp'], ['street light']], ['beach hut', O, ['period', 'beach_hut']],
  ['bathing machine', O, ['period', 'bathing_machine']], ['shop front', O, ['period', 'shopfront'], ['shop']], ['teddy bear', O, ['period', 'teddy'], ['teddy']],
  ['spinning top', O, ['period', 'spinning_top']], ['hoop', O, ['period', 'hoop']], ['tablet', O, ['period', 'tablet'], ['tablet computer']],
  ['smartphone', O, ['period', 'smartphone'], ['mobile phone']], ['robot', O, ['robot', 'robot']],
  ['bench', O, ['apparatus', 'bench']], ['beaker', O, ['apparatus', 'beaker']], ['jug', O, ['apparatus', 'jug'], ['measuring jug']], ['sieve', O, ['apparatus', 'sieve']],
  ['funnel', O, ['apparatus', 'funnel']], ['magnet', O, ['apparatus', 'magnet'], ['bar magnet']], ['torch', O, ['apparatus', 'torch'], ['flashlight']],
  ['mirror', O, ['apparatus', 'mirror']], ['screen', O, ['apparatus', 'screen']], ['eye', O, ['apparatus', 'eye']], ['cell', O, ['apparatus', 'cell'], ['battery']],
  ['bulb', O, ['apparatus', 'bulb'], ['light bulb']], ['switch', O, ['apparatus', 'switch']], ['buzzer', O, ['apparatus', 'buzzer']], ['drum', O, ['apparatus', 'drum']],
  ['tuning fork', O, ['apparatus', 'fork']], ['log', O, ['habitat', 'log']], ['rock', O, ['habitat', 'rock'], ['boulder']], ['ice floe', O, ['habitat', 'floe'], [], [['biome', 'iceFloe']]],
  ['hut', PLACE, ['object', 'hut']], ['house', PLACE, ['object', 'house']], ['temple', PLACE, ['object', 'temple']], ['pyramid', PLACE, ['object', 'pyramid']],
  ['fort', PLACE, ['object', 'fort']], ['field', PLACE, ['object', 'field']], ['tent', PLACE, ['object', 'tent']], ['tower', PLACE, ['object', 'tower']],
  ['obelisk', PLACE, ['object', 'obelisk']], ['standing stones', PLACE, ['object', 'stones'], ['stone circle']],
  // weather and space
  ['sun', W, ['weather', 'sun'], ['sunny']], ['cloud', W, ['weather', 'cloud'], ['cloudy']], ['rain', W, ['weather', 'rain'], ['rainy']], ['snow', W, ['weather', 'snow'], ['snowy']],
  ['wind', W, ['weather', 'wind'], ['windy']], ['sun and cloud', W, ['weather', 'sun-cloud'], ['sunny spells']],
  ...['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].map(k => [k, SP, ['planet', k], [`planet ${k}`]]),
];
/** Art in the models that is not a subject of its own, and why (for the report). */
export const NOT_SEEDED = {
  'models/evolution_adaptation/art.js': 'moth, beetle, finch, giraffe are drawn per trait value (a peppered moth at a darkness); they stay in the model',
  'models/rocks_soil_fossils/art.js': 'fossil outlines (ammonite, trilobite...) are drawn inside a rock; they stay in the model',
  'models/light_shadows/objects.js': 'silhouettes for shadow casting (ball, bottle, cup, tree, card figure); the library has the full drawings',
  'kit/batch-H.js H_OBJECT_TAGS': 'grid markers (flower, flag, block, home, cone) drawn on a grid cell; robot is seeded',
  'models/life_cycle/art.js leafEggs, flowerBee, beanFlowers': 'stage scenes, not subjects',
};

export const SUBJECTS = ROWS.map(([id, cat, from, names = [], alts = []]) => ({ id, cat, from, names, alts }));
const BY_ID = new Map(SUBJECTS.map(s => [s.id, s]));
export const subject = id => BY_ID.get(id) || null;

/* ------------------------------------------------------------------ names */
const IRREG = { mice: 'mouse', geese: 'goose', children: 'child', people: 'person', teeth: 'tooth', feet: 'foot', leaves: 'leaf', wolves: 'wolf', sheep: 'sheep',
  fish: 'fish', deer: 'deer', reindeer: 'reindeer', woodlice: 'woodlouse', cacti: 'cactus', knives: 'knife', loaves: 'loaf', calves: 'calf', halves: 'half', shelves: 'shelf' };
const KEEP = /(ss|us|is|ous|news|species|series|glasses|scissors|chess|reeds|stones|sunny spells)$/;
const one = w => IRREG[w] || (w.length <= 3 || KEEP.test(w) ? w : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /(ches|shes|xes|zes|sses|oes)$/.test(w) ? w.slice(0, -2) : /s$/.test(w) ? w.slice(0, -1) : w);
/** Lower case, no accents, articles or punctuation; the last word singular ("Two Polar Bears" -> "polar bear"). */
export function subjectKey(name) {
  const ws = String(name == null ? '' : name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ').trim().split(/\s+/).filter(w => w && !/^(a|an|the|some|one|two|three|four|five|six|seven|eight|nine|ten|many)$/.test(w));
  if (ws.length) ws[ws.length - 1] = one(ws[ws.length - 1]);
  return ws.join(' ');
}
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = new Map();
  for (const s of SUBJECTS) for (const n of [s.id, ...s.names]) { const k = subjectKey(n); if (k && !INDEX.has(k)) INDEX.set(k, s.id); }
  return INDEX;
}
/** The subject a name is, or null. Only exact names and true synonyms: no nearest match, no partial
 *  words, so "monkey" finds nothing rather than a giraffe, and "shark" never finds the seal. */
export function findSubject(name) {
  const id = index().get(subjectKey(name));
  return id ? BY_ID.get(id) : null;
}

/* ------------------------------------------------------------------ drawing */
/** Draw subject `id` fitted inside a w × hh box. anchor 'centre': (x, y) is the box centre; 'base': the
 *  middle of its bottom edge. `area` (0..1) caps the share of the box the drawing covers, so a long whale
 *  and a tall giraffe read the same size in a row. Returns the outer <g> (dataset.subject = id). */
export function drawSubjectAt(p, id, x, y, w, hh, { anchor = 'centre', area = .62, a = {} } = {}) {
  const s = BY_ID.get(id); if (!s) return null;
  const outer = h('g', a, p); outer.dataset.subject = id;
  const inner = h('g', {}, outer); SRC[s.from[0]](inner, s.from[1]);
  let bb = null; try { bb = inner.getBBox(); } catch (e) { bb = null; }
  if (!bb || !(bb.width > 0)) bb = { x: -50, y: -100, width: 100, height: 100 };
  const pad = 4, bw = bb.width + 2 * pad, bh = bb.height + 2 * pad;
  const k = Math.min(w / bw, hh / bh, Math.sqrt(area * w * hh / (bw * bh)));
  const cy = anchor === 'base' ? y - (bh * k) / 2 : y;
  inner.setAttribute('transform', `translate(${(x - k * (bb.x + bb.width / 2)).toFixed(1)} ${(cy - k * (bb.y + bb.height / 2)).toFixed(1)}) scale(${k.toFixed(4)})`);
  return outer;
}

/* ------------------------------------------------------------------ the fallback chain */
/** Add a source for subjects the library does not draw (the photo library, or generation):
 *  fn(name, {model, hint}) -> {href} | null. Returns a remover. One registry with kit/pictures.js, so a
 *  source fills every card on every model. A throwing source is skipped. */
export const registerSubjectSource = registerPictureSource;
const WANTED = new Map();
/** Names asked for that the library could not draw, with counts: the queue for new cut-outs. */
export const wanted = () => [...WANTED.entries()].sort((a, b) => b[1] - a[1]);
let CARD = (p, name, x, y, o) => pictureCard(p, name, x, y, Object.assign({ noLibrary: true }, o));
/** The fallback card (libfix kit/pictures.js pictureCard: a source's picture on the card, else the name). */
export function setCardFallback(fn) { if (fn) CARD = fn; }

/** Draw a named thing in a w × hh box centred on (x, y): the library's cut-out, else a source's picture,
 *  else the labelled card. Never a different subject under the name. */
export function picture(p, name, x, y, w, hh, opts = {}) {
  const s = findSubject(name);
  if (s) { noteArt(name, `library:${s.id}`); return { g: drawSubjectAt(p, s.id, x, y, w, hh, opts), how: 'library', id: s.id }; }
  const k = subjectKey(name); if (k) WANTED.set(k, (WANTED.get(k) || 0) + 1);
  const g = CARD(p, name, x, y + hh / 2, { w, h: hh, a: opts.a });
  return { g, how: g && g.querySelector && g.querySelector('image') ? 'source' : 'card' };
}

/** Which names the library can draw. */
export function coverage(names) {
  const have = [], missing = [];
  for (const n of names) { const s = findSubject(n); if (s) have.push([n, s.id]); else missing.push(n); }
  return { have, missing };
}

// every pictureCard call in every model looks here first, so a model whose own art does not fit a name
// draws the shared cut-out when there is one (a shark finds the shark, never the seal)
setPictureLibrary((p, name, x, yBase, w, hh, a) => {
  const s = findSubject(name);
  if (!s) { const k = subjectKey(name); if (k) WANTED.set(k, (WANTED.get(k) || 0) + 1); return null; }
  return { g: drawSubjectAt(p, s.id, x, yBase - hh / 2, w, hh, { a }), id: s.id };
});

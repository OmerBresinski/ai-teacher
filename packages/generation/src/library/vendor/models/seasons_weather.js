// Seasons, weather and day length (Reception–Y2). One tree in one field, seen in each season,
// laid out as a cycle of four panels round a ring of arrows. Three views share the layout:
//   seasons   the tree changes (new leaves, full, falling, bare)
//   weather   plus each season's typical weather, as a picture and the teacher's words
//   daylength plus the Sun's path on the season's solstice or equinox day: the arc's width is the
//             hours of daylight (24 h = the full arc track) and its height follows the Sun's noon
//             height, both worked out from the place's latitude.
// Truth: season months follow the hemisphere; trees are deciduous so they are bare in winter
// (drawn from the season, not a setting); no snow in summer, nor in places where it hardly snows.
import { TOWNS } from '../kit/facts.js'; import { gazPlace } from '../kit/geo.js'; // libdata
import {
  h, T, measure, wrap, clamp, eIO, GRID,
  textBlock, sky, hills, ground, headD,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
// batch F parts are not re-exported from kit/index.js yet, so they come from their own file
import { seasonTree, weatherIcon, sunArc, WEATHER } from '../kit/batch-F.js';

export const meta = {
  id: 'seasons_weather', name: 'Seasons, weather and day length', kind: 'scene', version: 1,
  subjects: ['Science', 'Geography'],
  years: ['Reception', 'Y1', 'Y2'],
  teaches: 'The four seasons in order, how a tree and the weather change through the year, and why summer days are long and winter days are short.',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_LABELS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const WEATHER_LABELS = { sun: 'Sunny', cloud: 'Cloudy', rain: 'Rainy', snow: 'Snowy', wind: 'Windy', 'sun-cloud': 'Sun and cloud' };
// latitude in degrees (south negative); snows: whether snow is usual in its cold months
const PLACES = {
  london: { name: 'London', lat: 51.5, snows: true }, edinburgh: { name: 'Edinburgh', lat: 55.95, snows: true },
  cardiff: { name: 'Cardiff', lat: 51.48, snows: true }, belfast: { name: 'Belfast', lat: 54.6, snows: true },
  'new-york': { name: 'New York', lat: 40.7, snows: true }, sydney: { name: 'Sydney', lat: -33.87, snows: false },
  melbourne: { name: 'Melbourne', lat: -37.81, snows: false }, auckland: { name: 'Auckland', lat: -36.85, snows: false },
  'cape-town': { name: 'Cape Town', lat: -33.92, snows: false },
};
for (const [k, t] of Object.entries(TOWNS.rows)) { const id = k.replace(/ /g, '-'), g = gazPlace(t.name); if (g) PLACES[id] = Object.assign(PLACES[id] || { name: t.name }, { lat: g[1], snows: t.snows, koppen: t.koppen }); } // libdata: real towns
const PLACE_IDS = Object.keys(PLACES);
// the month each season starts in (1-based), by hemisphere; one month earlier is also allowed
// (the old Celtic calendar starts spring on 1 February)
const START = { north: { spring: 3, summer: 6, autumn: 9, winter: 12 }, south: { spring: 9, summer: 12, autumn: 3, winter: 6 } };
const KEY_DAY = { north: { spring: '20 March', summer: '21 June', autumn: '23 September', winter: '21 December' }, south: { spring: '23 September', summer: '21 December', autumn: '20 March', winter: '21 June' } };

const SEASON_ITEM = {
  type: 'object', required: ['season', 'name', 'from'], default: { season: 'spring', name: 'Spring', from: 'March', weather: 'sun-cloud', weatherWords: 'Sunshine and showers' },
  properties: {
    season: { type: 'string', title: 'Season', enum: SEASONS, 'x-labels': SEASON_LABELS },
    name: { type: 'string', title: 'Name on the slide', maxLength: 24 },
    from: { type: 'string', title: 'Starts in', enum: MONTHS, description: 'Each season lasts three months.' },
    weather: { type: 'string', title: 'Weather picture', enum: WEATHER, 'x-labels': WEATHER.map(w => WEATHER_LABELS[w]) },
    weatherWords: { type: 'string', title: 'Weather in words', maxLength: 60 },
  },
};
const NORTH = [
  { season: 'spring', name: 'Spring', from: 'March', weather: 'sun-cloud', weatherWords: 'Sunshine and showers' },
  { season: 'summer', name: 'Summer', from: 'June', weather: 'sun', weatherWords: 'Warm and sunny' },
  { season: 'autumn', name: 'Autumn', from: 'September', weather: 'wind', weatherWords: 'Windy and wet' },
  { season: 'winter', name: 'Winter', from: 'December', weather: 'snow', weatherWords: 'Cold, sometimes snow' },
];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Seasons, weather and day length',
  properties: {
    title: TITLE_PARAM('The four seasons'),
    view: { type: 'string', title: 'Show', enum: ['seasons', 'weather', 'daylength'], 'x-labels': ['The four seasons (one tree through the year)', 'The weather in each season', 'How long the days are'], default: 'seasons' },
    hemisphere: { type: 'string', title: 'Where we live', enum: ['north', 'south'], 'x-labels': ['Northern half of the world (UK, Europe, North America)', 'Southern half of the world (Australia, New Zealand, South Africa)'], default: 'north' },
    place: { type: 'string', title: 'Town or city', description: 'Sets the hours of daylight and whether it snows.', enum: PLACE_IDS, 'x-labels': PLACE_IDS.map(k => PLACES[k].name), default: 'london' },
    showMonths: { type: 'boolean', title: 'Show the months', default: true },
    seasons: { type: 'array', title: 'The seasons, in order', description: 'Start with any season; the others follow in order.', 'x-item': 'a season', minItems: 4, maxItems: 4, items: SEASON_ITEM, default: NORTH },
    text: TEXT_PARAM,
  },
};

const SOUTH = [
  { season: 'spring', name: 'Spring', from: 'September', weather: 'sun-cloud', weatherWords: 'Warm, with sunny spells' },
  { season: 'summer', name: 'Summer', from: 'December', weather: 'sun', weatherWords: 'Hot and sunny' },
  { season: 'autumn', name: 'Autumn', from: 'March', weather: 'cloud', weatherWords: 'Mild and cloudy' },
  { season: 'winter', name: 'Winter', from: 'June', weather: 'rain', weatherWords: 'Cool and wet' },
];
export const presets = [
  { id: 'reception-four-seasons', name: 'Reception: the four seasons', params: { title: 'The four seasons', view: 'seasons', hemisphere: 'north', place: 'london', showMonths: false, seasons: NORTH } },
  { id: 'y1-weather', name: 'Year 1: weather in each season', params: { title: 'Weather in each season', view: 'weather', hemisphere: 'north', place: 'london', seasons: NORTH } },
  { id: 'y1-long-days', name: 'Year 1: long summer days', params: { title: 'Long summer days', view: 'daylength', hemisphere: 'north', place: 'london', seasons: NORTH } },
  { id: 'y2-australia', name: 'Year 2: seasons in Australia', params: { title: 'Seasons in Sydney, Australia', view: 'weather', hemisphere: 'south', place: 'sydney', seasons: SOUTH } },
];

const DEFAULTS = { north: NORTH, south: SOUTH };
const sameWeather = (s, d) => s.weather === d.weather && (s.weatherWords || '') === d.weatherWords;
// words for a snow picture drawn as rain, where it hardly snows
const RAIN_WORDS = { winter: 'Cool and wet', spring: 'Mild, with showers', autumn: 'Mild, with showers' };

/* ------------------------------------------------------------------ the science */
const mon = m => MONTHS[((m - 1) % 12 + 12) % 12];
const mi = s => MONTHS.indexOf(s.from) + 1;
const monthsLabel = s => `${mon(mi(s))} to ${mon(mi(s) + 2)}`;
const nextSeason = s => SEASONS[(SEASONS.indexOf(s) + 1) % 4];
// declination on the season's key day: + towards the hemisphere's own summer
function decl(season, hemi) { const d = season === 'summer' ? 23.44 : season === 'winter' ? -23.44 : 0; return hemi === 'north' ? d : -d; }
/** Hours of daylight (sunrise to sunset, with the usual refraction allowance) and noon height in degrees. */
function sunOn(season, hemi, lat) {
  const r = Math.PI / 180, dl = decl(season, hemi) * r, ph = lat * r;
  const cosH = clamp((Math.sin(-0.833 * r) - Math.sin(ph) * Math.sin(dl)) / (Math.cos(ph) * Math.cos(dl)), -1, 1);
  return { hours: 2 * Math.acos(cosH) / r / 15, noon: 90 - Math.abs(lat - decl(season, hemi)) };
}
// the season's key day, as said on the slide: 'on the longest day, 21 June'
const dayWords = (season, hemi) => `on ${season === 'summer' ? 'the longest day, ' : season === 'winter' ? 'the shortest day, ' : ''}${KEY_DAY[hemi][season]}`;
const lowerFirst = s => /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
const TREE = {
  spring: 'new leaves and blossom grow on the tree', summer: 'the tree is full of green leaves',
  autumn: 'the leaves turn orange and brown, then fall', winter: 'the tree’s branches are bare',
};

/* ------------------------------------------------------------------ resolve and validate */
// One change in the panel never needs a second to be accepted: linked values are carried.
//   town in the other half of the world  -> whichever of the two still matches the months is the old
//                                           one: a new town brings its half of the world, a new half
//                                           brings its main town
//   a whole half-of-the-world move        -> panels still on the old half's preset weather take this half's
//   one panel's season changed           -> the cycle turns to start there; each season keeps its words
//   all months from the other half       -> the months move to this half's calendar
//   one panel on the other calendar      -> (March or one month earlier) the other panels follow it
//   snow where it hardly snows           -> drawn as rain (words that say snow follow), with a warning
// validate() writes carried values back into the params it was given, so the panel shows what the
// slide shows; resolving the written-back params again changes nothing.
// What stays refused is a single wrong value with a single fix: snow in summer, a month that is
// no season's start, a panel named after another season.
const half = lat => lat >= 0 ? 'north' : 'south';
const HALF_NAME = { north: 'northern', south: 'southern' };
const MAIN_TOWN = { north: 'london', south: 'sydney' };
// 0: the usual start month, 1: one month earlier, -1: neither
const cal = (s, hemi) => { const c = START[hemi][s.season], m = mi(s); return m === c ? 0 : m === ((c + 10) % 12) + 1 ? 1 : -1; };
const listWords = a => a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

function resolve(P) {
  const R = [], W = []; let hemi = P.hemisphere, carried = false;
  let placeId = PLACES[P.place] ? P.place : MAIN_TOWN[hemi], place = PLACES[placeId];
  if (half(place.lat) !== hemi) {
    carried = true;
    if (P.seasons.every(s => cal(s, hemi) >= 0)) { // the months still match "Where we live": the town is the new choice
      hemi = half(place.lat);
      W.push(`${place.name} is in the ${HALF_NAME[hemi]} half of the world, so “Where we live” is now the ${HALF_NAME[hemi]} half and the months follow it.`);
    } else {
      const was = place; placeId = MAIN_TOWN[hemi]; place = PLACES[placeId];
      W.push(`${was.name} is in the ${HALF_NAME[half(was.lat)]} half of the world, so the town is now ${place.name}.`);
    }
  }
  let S = P.seasons.map((s, i) => Object.assign({}, s, { _i: i }));
  // order: each panel votes for the season the cycle starts with; a lone dissenter is the one just changed
  const vote = S.map((s, i) => ((SEASONS.indexOf(s.season) - i) % 4 + 4) % 4);
  const count = v => vote.filter(x => x === v).length;
  const odd = vote.findIndex(v => count(v) === 1);
  if (new Set(vote).size === 2 && odd >= 0 && count(vote[(odd + 1) % 4]) === 3) {
    const by = {}; S.forEach((s, i) => { if (i !== odd) by[s.season] = s; });
    const missing = SEASONS.find(x => !by[x]);
    by[missing] = Object.assign({}, S[odd], { season: missing });
    S = [0, 1, 2, 3].map(j => by[SEASONS[(vote[odd] + j) % 4]]);
    W.push(`The seasons now start with ${S[0].season}; the others follow in order, each with its own words.`); carried = true;
  } else if (new Set(vote).size > 1) {
    for (let i = 0; i < 3; i++) if (S[i + 1].season !== nextSeason(S[i].season))
      R.push({ path: `seasons.${i + 1}.season`, reason: `After ${S[i].season} comes ${nextSeason(S[i].season)}. Keep the seasons in order: spring, summer, autumn, winter (you can start with any of them).` });
    return { R, W, S, place, placeId, hemi, carried };
  }
  S.forEach(s => { if (s.name !== '' && !s.name.trim()) R.push({ path: `seasons.${s._i}.name`, reason: 'Name on the slide is empty. Type a name, such as ' + SEASON_LABELS[SEASONS.indexOf(s.season)] + '.' }); });
  // a panel's name may be any wording (Welsh, 'Springtime'), but not another season's name
  S.forEach(s => {
    const j = SEASON_LABELS.findIndex(l => l.toLowerCase() === s.name.trim().toLowerCase());
    if (j >= 0 && SEASONS[j] !== s.season) R.push({ path: `seasons.${s._i}.name`, reason: `This panel shows ${s.season}; call it ${SEASON_LABELS[SEASONS.indexOf(s.season)]}, or pick ${SEASON_LABELS[j]} in Season.` });
  });
  // months
  const other = hemi === 'north' ? 'south' : 'north';
  let c = S.map(s => cal(s, hemi)), moved = false;
  if (c.every(v => v < 0) && S.every(s => cal(s, other) >= 0)) {
    c = S.map(s => cal(s, other)); moved = true;
  } else S.forEach((s, i) => {
    if (c[i] < 0) { const st = START[hemi][s.season];
      R.push({ path: `seasons.${s._i}.from`, reason: `In the ${HALF_NAME[hemi]} half of the world ${s.season} starts in ${mon(st)} (some calendars say ${mon(st - 1)}), not ${s.from}.${hemi === 'north' && s.season === 'winter' ? ' In the UK, December is winter.' : ''}` }); }
  });
  if (!R.length) {
    // one calendar for all four: a lone panel on the other calendar is the one just changed
    const early = c.filter(v => v === 1).length;
    if (early === 2) S.slice(1).forEach((s, i) => { if (c[i + 1] !== c[0])
      R.push({ path: `seasons.${s._i}.from`, reason: `Each season lasts three months, so ${s.season} starts in ${mon(mi(S[0]) + 3 * (i + 1))}, three months after ${S[i].season}.` }); });
    else {
      const e = early === 1 || early === 4 ? 1 : 0;
      const changed = moved || S.some((s, i) => c[i] !== e);
      S.forEach(s => { s.from = mon(START[hemi][s.season] - e); });
      if (changed) carried = true;
      // a whole move to this half: panels still on the other half's preset weather take this half's
      let swapped = 0;
      if (moved) S.forEach(s => { const d = DEFAULTS[other].find(x => x.season === s.season), n = DEFAULTS[hemi].find(x => x.season === s.season);
        if (sameWeather(s, d) && !sameWeather(s, n)) { s.weather = n.weather; s.weatherWords = n.weatherWords; swapped++; } });
      if (moved) W.push(`The months now follow the ${HALF_NAME[hemi]} half of the world: the seasons start in ${listWords(S.map(s => s.from))}.${swapped ? ' The weather pictures and words change to that half’s usual weather.' : ''}`);
      else if (changed) W.push(`Each season lasts three months, so the seasons now start in ${listWords(S.map(s => s.from))}.`);
    }
  }
  if (R.length) return { R, W, S, place, placeId, hemi, carried };
  S.forEach(s => {
    if (s.weather !== 'snow') return;
    if (s.season === 'summer') R.push({ path: `seasons.${s._i}.weather`, reason: 'It does not snow in summer: it is too warm. Pick sun, cloud, rain or wind.' });
    else if (!place.snows) {
      s.weather = 'rain'; carried = true;
      const said = /snow/i.test(s.weatherWords || '');
      if (said) s.weatherWords = RAIN_WORDS[s.season];
      W.push(`It hardly ever snows in ${place.name}, even in ${s.season}, so the picture shows rain${said ? ` and the words say “${s.weatherWords}”` : ''}. Pick another weather picture to change it.`);
    }
    else if (s.season !== 'winter') W.push(`Snow in ${s.season} is unusual in ${place.name}; winter is the usual time.`);
  });
  return { R, W, S, place, placeId, hemi, carried };
}

export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  if (R.length) return result(R);
  const r = resolve(P);
  // an accepted change that carried other values: write them back, so the panel matches the slide
  if (!r.R.length && r.carried && raw && typeof raw === 'object') {
    raw.hemisphere = r.hemi; raw.place = r.placeId;
    raw.seasons = r.S.map(({ _i, ...s }) => s);
  }
  return result(r.R, r.W);
}

/* ------------------------------------------------------------------ builds and notes */
function plan(P) {
  const { S, place, hemi } = resolve(P);
  const sun = S.map(s => sunOn(s.season, hemi, place.lat));
  const hrs = i => Math.round(sun[i].hours);
  const steps = S.map((s, i) => {
    let caption;
    if (P.view === 'weather') caption = `${s.name}: ${lowerFirst(s.weatherWords || WEATHER_LABELS[s.weather])}.`;
    else if (P.view === 'daylength') caption = `${s.name}: ${dayWords(s.season, hemi)}, about ${hrs(i)} hours of daylight. ` + (s.season === 'summer' ? 'The Sun climbs high.' : s.season === 'winter' ? 'The Sun stays low.' : 'Day and night are about equal.');
    else caption = `${s.name}${P.showMonths ? ` (${monthsLabel(s)})` : ''}: ${TREE[s.season]}.`;
    return { key: `season:${s.season}`, caption };
  });
  steps.push({ key: 'again', caption: `After ${lowerFirst(S[3].name)} comes ${lowerFirst(S[0].name)} again. The seasons go round every year.` });
  const iS = S.findIndex(s => s.season === 'summer'), iW = S.findIndex(s => s.season === 'winter');
  const summary = P.view === 'daylength' ? `In ${place.name}, the longest day has about ${hrs(iS)} hours of daylight and the shortest about ${hrs(iW)}.`
    : P.view === 'weather' ? 'Each season has its own kind of weather, and the seasons come round again every year.'
      : `${S[0].name}, ${lowerFirst(S[1].name)}, ${lowerFirst(S[2].name)} and ${lowerFirst(S[3].name)}: the four seasons, round and round.`;
  return { S, sun, hrs, steps, summary, place, hemi };
}
export function builds(P) { const { steps, summary } = plan(P); return { steps, summary: { caption: summary } }; }

export function notes(P) {
  const { S, hrs, place, hemi } = plan(P);
  const steps = S.map((s, i) => {
    if (P.view === 'daylength') return `This is ${KEY_DAY[hemi][s.season]} in ${place.name}: the Sun is up for about ${hrs(i)} hours. The width of the arc shows how long it is up; its height shows how high it gets at midday. Never look straight at the Sun.`;
    if (P.view === 'weather') return `This is the usual weather for ${s.season} in ${place.name}; any one day can be different. Ask: what do we wear in ${s.season}?`;
    return {
      spring: 'Ask: what is new on the tree? Look for buds, blossom and baby leaves.',
      summer: 'The tree is a deciduous tree, like an oak. Ask: what has changed since spring?',
      autumn: 'Deciduous trees drop their leaves in autumn. Evergreen trees, like holly and pine, keep theirs all year.',
      winter: 'The tree is resting, not dead: buds are waiting on the branches for spring.',
    }[s.season] + (hemi === 'south' ? ' Most Australian native trees, like gum trees, are evergreen; this is a tree like a plane or oak.' : '');
  });
  steps.push(`The seasons repeat because the Earth goes round the Sun once a year, tilted. ${hemi === 'north' ? 'In the southern half of the world the seasons are the other way round: December is summer there.' : 'In the UK the seasons are the other way round: December is winter there.'}`);
  const summary = P.view === 'daylength' ? 'Not to scale: the arcs are a picture of the Sun’s path. Their widths match the hours of daylight, worked out for this town. The strip on the ground is the whole day and night, 24 hours; its bright part is the daylight. Ask: when do we come home from school in the dark?'
    : P.view === 'weather' ? 'Ask the class to name the seasons in order, starting from any one, and say one thing that changes in each.'
      : 'Ask the class to name the seasons in order, starting from any one, and say one thing that changes in each. In autumn the fallen leaves gather on the ground under the tree.';
  return { steps, summary };
}

/* ------------------------------------------------------------------ the words columns */
const COL_TOP = 30, COL_GAP = 6, NUM_H = 40, COL_FOOT = 8;
// wrap first, then shrink (three steps, down to the token minimum), then widen the column and
// narrow the picture; the same sizes and width are used for all four panels so they match
// three weights: the name leads, the teacher's words (weather, hours) follow in ink, and the worked-out
// facts (months, the key day) step back smaller in the second ink
const LEVELS = [
  { name: ['ts-h3', 38], body: ['ts-cap', 31], meta: ['ts-small', 29] },
  { name: ['ts-h3', 38], body: ['ts-small', 29], meta: ['ts-tiny', 26] },
  { name: ['ts-label', 34], body: ['ts-tiny', 26], meta: ['ts-tiny', 26] },
  { name: ['ts-tiny', 26], body: ['ts-tiny', 26], meta: ['ts-tiny', 26] },
];
const LANES = [214, 250, 286];
function columnItems(P, s, i, hrs, hemi, L) {
  const nm = (str, o) => Object.assign({ str, cls: L.name[0], lh: L.name[1], fill: 'var(--ink)' }, o);
  const bd = (str, o) => Object.assign({ str, cls: L.body[0], lh: L.body[1], fill: 'var(--ink)' }, o);
  const mt = (str, o) => Object.assign({ str, cls: L.meta[0], lh: L.meta[1], fill: 'var(--ink-2)' }, o);
  const out = [nm(s.name, { edit: `seasons.${s._i}.name` })];
  if (P.view === 'daylength') {
    out.push({ num: true, str: String(hrs(i)), computed: 'place' });
    out.push(bd(txt(P, 'label:hours', 'hours of daylight'), { edit: 'text.label:hours', unit: true }));
    out.push(mt(KEY_DAY[hemi][s.season], { computed: 'hemisphere' }));
  } else {
    if (P.showMonths) out.push(mt(monthsLabel(s), { computed: `seasons.${s._i}.from` }));
    if (P.view === 'weather') out.push(bd(s.weatherWords || WEATHER_LABELS[s.weather], { edit: `seasons.${s._i}.weatherWords` }));
  }
  return out;
}
// height of a column from its first baseline to its last, plus whether every line fits the width
function sizeColumn(p, items, w) {
  let cy = 0, last = 0, wide = false;
  for (const it of items) {
    if (it.num) { last = cy; cy += NUM_H; continue; }
    const L = wrap(p, it.str, it.cls, w, { fill: it.fill }); it.n = Math.max(1, L.length);
    if (L.some(l => measure(p, l, it.cls) > w + 0.5)) wide = true;
    const lh = it.cls === 'ts-tiny' ? Math.min(it.lh, 26) : it.lh; it.lh = lh;
    last = cy + (it.n - 1) * lh; cy += it.n * lh + COL_GAP;
  }
  return { last, wide };
}
// a single word wider than the column (a long name typed without spaces) is broken with a hyphen
function breakLong(p, str, cls, w) {
  return String(str).split(/\s+/).map(word => {
    if (measure(p, word, cls) <= w) return word;
    const parts = []; let cur = '';
    for (const ch of word) { if (cur && measure(p, cur + ch + '-', cls) > w) { parts.push(cur + '-'); cur = ch; } else cur += ch; }
    return parts.concat(cur).join(' ');
  }).join(' ');
}
function fitColumns(p, P, S, hrs, hemi, span, ph) {
  const room = ph - COL_TOP - COL_FOOT;
  // day length: a short unit ('hours of daylight') reads best on one line under its number, so a
  // slightly wider column is tried first at the full sizes
  if (P.view === 'daylength') for (const tc of LANES) {
    const cols = S.map((s, i) => columnItems(P, s, i, hrs, hemi, LEVELS[0]));
    if (cols.every(items => { const z = sizeColumn(p, items, tc); return !z.wide && z.last <= room && items.every(it => it.num || !it.unit || it.n === 1); })) return { tc, cols, cut: false };
  }
  for (const tc of LANES) for (const L of LEVELS) {
    const cols = S.map((s, i) => columnItems(P, s, i, hrs, hemi, L));
    if (cols.every(items => { const z = sizeColumn(p, items, tc); return !z.wide && z.last <= room; })) return { tc, cols, cut: false };
  }
  // last resort (only wording far past the usual length): the widest, smallest column, cut to the room left
  const tc = LANES[LANES.length - 1], L = LEVELS[LEVELS.length - 1]; let cut = false;
  const cols = S.map((s, i) => { const items = columnItems(P, s, i, hrs, hemi, L);
    for (const it of items) if (!it.num) it.str = breakLong(p, it.str, it.cls, tc);
    sizeColumn(p, items, tc);
    let cy = 0; for (const it of items) { if (it.num) { cy += NUM_H; continue; }
      const n = Math.max(1, Math.min(it.n, Math.floor((room - cy) / it.lh) + 1)); if (n < it.n) { cut = true; it.n = n; } cy += it.n * it.lh + COL_GAP; }
    return items; });
  return { tc, cols, cut };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { S, sun, hrs, hemi } = plan(P); const b = ctx.b, N = ctx.N;
  const bi = k => b[k] ?? 0;
  // dark rooms: faded panels step back less, or they vanish into the background
  const dark = ctx.name === 'night', rq = dark ? 'soft' : 'quiet';
  // 2×2 grid of panels filling the live area; each panel's words sit in a column on its outer side
  const tg = 12, gut = 64, rowGap = 60, span = (GRID.right - GRID.left - gut) / 2 - tg; // column + panel
  const ph = (GRID.bottom - GRID.top - rowGap) / 2;
  const fit = fitColumns(root, P, S, hrs, hemi, span, ph);
  const tc = fit.tc, pw = span - tc;
  if (fit.cut) ctx.warn('The words beside the pictures were cut short to fit; shorten the longest one.');
  const rows = [GRID.top, GRID.top + ph + rowGap], cols = [GRID.left + tc + tg, GRID.left + tc + tg + pw + gut];
  // clockwise: top-left, top-right, bottom-right, bottom-left
  const slots = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([c, r]) => ({ c, x: cols[c], y: rows[r] }));
  const again = bi('again'), dayl = P.view === 'daylength';
  const snowField = dark ? 'color-mix(in oklab,var(--snow) 42%,var(--panel))' : 'var(--snow)';
  const snowHill = dark ? 'color-mix(in oklab,var(--snow) 26%,var(--panel))' : 'var(--snow-shade)';
  const fieldFill = (s) => s.weather === 'snow' ? snowField : s.season === 'autumn' ? 'var(--field)' : s.season === 'winter' ? 'var(--hill-mid)' : 'var(--hill-near)';
  const suns = [];

  S.forEach((s, i) => {
    const { c, x, y } = slots[i]; const k = bi(`season:${s.season}`);
    // each panel steps back after its build; for "again" all four step back so the arrows lead;
    // in day length the summary is summer against winter, so spring and autumn stay soft
    const mid = s.season === 'spring' || s.season === 'autumn';
    const cr = [ctx.rc(k + 1, again, rq), dayl ? `${again}-${N}:soft` : `${again}:soft`, dayl && mid ? `${N}:soft` : null];
    const g = h('g', { s: k, cls: 'rise', c: cr.filter(Boolean).join(',') || null }, root);

    /* the words column: name (editable), then months, weather or daylight, beside the panel;
       sizes, line counts and the column width come from fitColumns, so nothing runs below the picture */
    const anchor = c === 0 ? 'end' : 'start', ax = c === 0 ? x - tg : x + pw + tg;
    let cy = y + COL_TOP;
    const put = (it) => { const tb = textBlock(g, ax, cy, it.str, { cls: it.cls, maxW: tc, maxLines: it.n, lh: it.lh, anchor, a: { style: `fill:${it.fill}` }, edit: it.edit }); cy += tb.h + COL_GAP; return tb; };
    for (const it of fit.cols[i]) {
      if (it.num) { computed(T(g, ax, cy, it.str, 'ts-h3', { 'text-anchor': anchor, fill: 'var(--ink)' }), it.computed); cy += NUM_H; continue; }
      const tb = put(it); if (it.computed) computed(tb.el, it.computed);
    }

    /* the scene: sky, the field, the tree */
    const cid = `${ctx.uid}-sw-${i}`;
    h('rect', { x, y, width: pw, height: ph, rx: 'var(--r-card)' }, h('clipPath', { id: cid }, h('defs', {}, g)));
    const sc = h('g', { 'clip-path': `url(#${cid})` }, g);
    sky(h('g', { transform: `translate(0 ${y})` }, sc), { uid: `${ctx.uid}-sw${i}` }, ph, x, x + pw);
    const yH = y + ph - 50;
    // day length has a flat horizon, so sunrise and sunset sit on one line
    if (!dayl) hills(sc, { x0: x, x1: x + pw, yBase: yH + 4, amp: 30, fill: s.weather === 'snow' ? snowHill : 'var(--hill-far)', seed: 5, bumps: 3 });
    ground(sc, x, x + pw, yH, y + ph, fieldFill(s));

    if (dayl) {
      // 24 hours = the whole arc track; the arc's height follows the Sun's noon height (70° = the top of the sky)
      const tx0 = x + 18, tx1 = x + pw - 18, tw = tx1 - tx0, cx = (tx0 + tx1) / 2, r = 18;
      const aw = tw * sun[i].hours / 24, ah = Math.max(r + 18, (ph - 50 - 34) * clamp(sun[i].noon / 70, 0.05, 1));
      seasonTree(sc, x + pw - 40, yH + 6, s.season, 0.6, {}, { snow: s.weather === 'snow' });
      // the day as a strip on the ground: the whole strip is 24 hours, the bright part is daylight
      h('rect', { x: tx0, y: yH + 22, width: tw, height: 14, rx: 'var(--r-mark)', fill: 'var(--shade)' }, sc);
      h('rect', { x: cx - aw / 2, y: yH + 22, width: aw, height: 14, fill: 'var(--sun)' }, sc);
      const arc = sunArc(g, { x0: cx - aw / 2, x1: cx + aw / 2, yH, peak: yH - ah, frac: 0.5, r });
      arc.el.style.setProperty('stroke-width', 'var(--sw-struct)'); arc.el.setAttribute('stroke-dasharray', '1 9');
      const disc = arc.g.querySelector('circle'); suns.push({ k, disc, at: arc.at });
    } else {
      const tX = P.view === 'weather' ? x + pw * 0.3 : x + pw / 2;
      if (s.season === 'autumn') // fallen leaves gather on the ground: the "then fall" of autumn
        for (let j = 0; j < 14; j++) { const lx = x + 14 + j * (pw - 28) / 13, ly = yH + 16 + (j % 3) * 9;
          h('ellipse', { cx: lx, cy: ly, rx: 8, ry: 4, fill: j % 2 ? 'var(--counter)' : 'var(--sun)', transform: `rotate(${(j * 47) % 180 - 90} ${lx} ${ly})` }, sc); }
      seasonTree(sc, tX, yH + 22, s.season, P.view === 'weather' ? 1.05 : 1.15, {}, { snow: s.weather === 'snow' });
      if (P.view === 'weather') weatherIcon(g, s.weather, x + pw * 0.74, y + 62, 0.95, { s: k, cls: 'pop', delay: 500 });
    }
    h('rect', { x, y, width: pw, height: ph, rx: 'var(--r-card)', fill: 'none', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, g);
  });

  /* the arrows between the panels, clockwise: each comes with the season it points to */
  const sz = (ctx.tk.head || 16) * 1.6, pad = 10;
  const yM = rows.map(r => r + ph / 2), xM = cols.map(c => c + pw / 2);
  const lines = [
    [cols[0] + pw + pad, yM[0], cols[1] - pad, yM[0]],
    [xM[1], rows[0] + ph + pad, xM[1], rows[1] - pad],
    [cols[1] - pad, yM[1], cols[0] + pw + pad, yM[1]],
    [xM[0], rows[1] - pad, xM[0], rows[0] + ph + pad],
  ];
  lines.forEach(([x0, y0, x1, y1], i) => {
    const k = i < 3 ? bi(`season:${S[i + 1].season}`) : again;
    const g = h('g', { s: k, cls: 'pop', delay: 200, c: dayl ? `${N}:soft` : null }, root);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    h('path', { d: `M${x0} ${y0} L${x1 - Math.cos(ang) * sz * .7} ${y1 - Math.sin(ang) * sz * .7}`, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    h('path', { d: headD(x1, y1, ang, sz), fill: 'var(--ink)' }, g);
  });

  if (!suns.length) return {};
  /* day length: during its build the Sun rises and climbs to midday along its arc */
  const place = (s, u) => { const [px, py] = s.at(0.5 * u); s.disc.setAttribute('cx', px); s.disc.setAttribute('cy', py); };
  return {
    dur: Object.fromEntries(S.map(s => [`season:${s.season}`, 1600])),
    still() { suns.forEach(s => place(s, 1)); },
    reset() { suns.forEach(s => place(s, 0)); },
    tick(k, u) { for (const s of suns) { if (k === s.k) place(s, eIO(clamp(u))); else if (k > s.k) place(s, 1); } },
  };
}

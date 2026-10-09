// Real geography for the models (libdata track 2). Reads kit/geo-data.js, which tools/geobake.ts bakes
// from the geo database (research/geo/geo.sqlite): river windows, Natural Earth land and a gazetteer.
// Models never invent coordinates: the teacher names a place or river, and this module looks it up.
// A name it does not know returns null, and the model keeps its schematic (and says so).
import { RIVERS, LAND, GAZETTEER, GEO_META } from './geo-data.js';

export { GEO_META };

/** Lower case, no accents or punctuation: "Rio Grande!" -> "rio grande". */
export const geoNorm = s => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const RIVER_WORDS = /\b(the|river|rio|riviere|fleuve|afon|abhainn|fiume|rivier|reka)\b/g;
const riverKey = s => geoNorm(s).replace(RIVER_WORDS, ' ').replace(/\s+/g, ' ').trim();

let RIVER_INDEX = null;
function riverIndex() {
  if (RIVER_INDEX) return RIVER_INDEX;
  RIVER_INDEX = new Map();
  // GB ids come first in the bake and the unsuffixed id is the longest river of that name
  const ids = Object.keys(RIVERS).sort((a, b) => (a.includes('.', 9) ? 1 : 0) - (b.includes('.', 9) ? 1 : 0));
  for (const id of ids) for (const n of [RIVERS[id].name, ...(RIVERS[id].aliases || [])]) {
    const k = riverKey(n); if (k && !RIVER_INDEX.has(k)) RIVER_INDEX.set(k, id);
  }
  return RIVER_INDEX;
}
/** The baked river a name refers to, as {id, ...entry}, or null. "River Thames", "the Thames" and
 *  "Thames" all find gb.river-thames; a name that is only a common word ("The river") finds nothing. */
export function riverByName(name) {
  const k = riverKey(name); if (!k) return null;
  const id = riverIndex().get(k);
  return id ? Object.assign({ id }, RIVERS[id]) : null;
}
export const RIVER_IDS = Object.keys(RIVERS);
export const riverById = id => (RIVERS[id] ? Object.assign({ id }, RIVERS[id]) : null);

/** [lon, lat] of a real place in the gazetteer (capitals, cities of 150k+, GB towns of 25k+), or null. */
export function gazPlace(name) {
  const r = GAZETTEER[geoNorm(name)];
  return r ? [r[1], r[2]] : null;
}
export const gazEntry = name => { const r = GAZETTEER[geoNorm(name)]; return r ? { name: r[0], lon: r[1], lat: r[2], kind: r[3], country: r[4] } : null; };

/** Natural Earth land rings ([lon, lat]) that reach into a view {lon: [w, e], lat: [s, n]}. */
export function landRings(view) {
  const [w, e] = view.lon, [s, n] = view.lat; const out = [];
  for (const ring of LAND) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= w && x0 <= e && y1 >= s && y0 <= n) out.push(ring);
  }
  return out;
}

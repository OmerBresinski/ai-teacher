// hist_map private data: extra real places, sea waypoints (allowed only part-way along a route),
// map views, and the territory library. Every territory is drawn "after" a cited source; the
// outlines are hand-simplified from it and clipped to the kit coastline, so the sea edges are
// not part of the claim. [lon, lat] throughout.
import { PLACES, REGIONS } from '../../kit/batch-G.js';
import { gazEntry } from '../../kit/geo.js'; // libdata: gazetteer

/** Real places the kit does not list yet (towns, sites and landing places used in KS1–2 history). */
export const EXTRA_PLACES = {
  Ebbsfleet: [1.37, 51.33], Selsey: [-0.79, 50.73], Bamburgh: [-1.71, 55.61], Jarrow: [-1.48, 54.98], Iona: [-6.41, 56.33],
  Repton: [-1.55, 52.84], Pevensey: [0.34, 50.82], 'Stamford Bridge': [-0.91, 53.99], Edington: [-2.1, 51.28], Chester: [-2.89, 53.19],
  Lincoln: [-0.54, 53.23], Norwich: [1.3, 52.63], Southampton: [-1.4, 50.9], Ostia: [12.29, 41.75], Hamburg: [9.99, 53.55],
  Bergen: [5.32, 60.39], Reykjavik: [-21.9, 64.15], Venice: [12.34, 45.44], Genoa: [8.93, 44.41], Seville: [-5.98, 37.39],
  Calicut: [75.78, 11.25], 'Cape of Good Hope': [18.47, -34.36], Moscow: [37.62, 55.75], Tokyo: [139.69, 35.69],
  'River Thames': [-0.1, 51.49], 'East Anglia': [1.0, 52.45],
  Gloucester: [-2.24, 51.86], Exeter: [-3.53, 50.72], Wroxeter: [-2.65, 52.67], Caerleon: [-2.96, 51.61], 'St Albans': [-0.34, 51.75],
};
/** Sea areas: real, but not somewhere a journey starts or ends. Use them in “On the way”. */
export const WAYPOINTS = {
  'Strait of Dover': [1.45, 51.0], 'English Channel': [0.0, 50.35], 'North Sea': [3.0, 55.0], 'Bay of Biscay': [-5.0, 45.5],
  'Strait of Gibraltar': [-5.6, 35.95], 'Atlantic Ocean': [-40.0, 30.0], 'Irish Sea': [-4.8, 53.8],
};
export const ALL_PLACES = Object.assign({}, PLACES, EXTRA_PLACES);
export const PLACE_NAMES = Object.keys(ALL_PLACES).sort((a, b) => a.localeCompare(b));
const find = (tbl, name) => { const s = String(name || '').trim().toLowerCase(); const k = Object.keys(tbl).find(x => x.toLowerCase() === s); return k ? { name: k, ll: tbl[k] } : null; };
/** {name, ll, sea} or null. */
export const lookup = name => { const p = find(ALL_PLACES, name); if (p) return p; const w = find(WAYPOINTS, name); if (w) return Object.assign(w, { sea: true });
  const g = gazEntry(name); return g ? { name: g.name, ll: [g.lon, g.lat], gazetteer: true } : null; }; // libdata: any real town or city in the geo database

/** Map views: kit region + optional view box. */
export const VIEWS = {
  uk: { kit: 'uk', view: null, name: 'Britain and Ireland', ...REGIONS.uk },
  south: { kit: 'uk', view: { lon: [-6.2, 4.0], lat: [49.6, 56.0] }, name: 'England and Wales', lon: [-6.2, 4.0], lat: [49.6, 56.0] },
  northsea: { kit: 'europe', view: { lon: [-9, 15], lat: [49.5, 61.5] }, name: 'Britain and the lands across the North Sea', lon: [-9, 15], lat: [49.5, 61.5] },
  europe: { kit: 'europe', view: null, name: 'Europe', ...REGIONS.europe },
  mediterranean: { kit: 'mediterranean', view: null, name: 'the Mediterranean', ...REGIONS.mediterranean },
  world: { kit: 'world', view: null, name: 'the world', ...REGIONS.world },
};
export const inView = (v, ll) => ll[0] >= v.lon[0] && ll[0] <= v.lon[1] && ll[1] >= v.lat[0] && ll[1] <= v.lat[1];

/** Territory library. `at` is where the name sits (on land). `hatch` = the edge is not known exactly. */
export const TERRITORIES = {
  roman_britain_122: {
    name: 'Roman Britain', date: 'AD 122', hatch: false, at: [-1.6, 52.5],
    source: 'Ordnance Survey, Map of Roman Britain (5th edition, 2001): the province south of Hadrian’s Wall',
    poly: [[-5.9, 49.8], [-5.9, 51.4], [-5.3, 52.0], [-4.95, 53.5], [-3.6, 54.9], [-3.15, 54.96], [-2.6, 54.98], [-1.53, 55.0], [2.6, 55.0], [2.6, 52.0], [1.7, 51.2], [1.0, 50.7], [-1.0, 50.4]],
  },
  anglo_saxon_600: {
    name: 'Anglo-Saxon kingdoms', date: 'c. AD 600', hatch: true, at: [-0.9, 52.4],
    source: 'David Hill, An Atlas of Anglo-Saxon England (1981): the kingdoms around AD 600',
    poly: [[-2.1, 50.4], [-2.3, 51.0], [-2.4, 51.5], [-2.2, 52.0], [-2.1, 52.6], [-2.3, 53.2], [-1.9, 53.6], [-2.0, 54.2], [-2.3, 54.8], [-2.5, 55.4], [-2.6, 55.75], [-1.5, 55.95], [2.6, 55.95], [2.6, 51.6], [1.7, 51.2], [1.0, 50.7]],
  },
  danelaw_886: {
    name: 'The Danelaw', date: 'c. AD 886', hatch: false, at: [-0.7, 53.2],
    source: 'The treaty of Alfred and Guthrum (about AD 886): the border ran up the Thames, the River Lea and Watling Street',
    poly: [[-0.02, 51.5], [-0.05, 51.8], [-0.42, 51.88], [-0.47, 52.14], [-0.85, 52.06], [-1.4, 52.45], [-1.85, 52.66], [-2.2, 53.0], [-2.9, 53.35], [-3.2, 53.5], [-3.3, 53.95], [-2.5, 54.2], [-1.8, 54.55], [-1.2, 54.62], [2.6, 54.62], [2.6, 51.6], [0.7, 51.56]],
  },
  roman_empire_117: {
    name: 'The Roman Empire', date: 'AD 117', hatch: false, at: [13.0, 42.6],
    source: 'Richard Talbert (editor), Barrington Atlas of the Greek and Roman World (2000): the empire under Trajan',
    poly: [[-10.5, 33.4], [-10.5, 44.0], [-6.0, 48.6], [-6.5, 50.0], [-5.9, 51.4], [-5.3, 52.0], [-4.95, 53.5], [-3.6, 54.9], [-1.53, 55.0], [1.5, 55.0], [4.3, 52.0], [6.0, 51.85], [7.0, 50.6], [8.0, 50.4], [9.6, 49.5], [10.6, 48.95], [11.8, 48.85], [13.5, 48.6], [16.9, 48.15], [18.9, 47.8], [19.05, 47.0], [20.2, 46.2], [22.5, 47.6], [25.5, 47.2], [26.0, 45.6], [25.0, 43.9], [28.0, 44.1], [29.7, 45.2], [30.6, 44.0], [33.0, 43.0], [40.0, 43.0], [41.8, 41.8], [44.5, 41.0], [46.5, 39.5], [45.5, 37.0], [48.5, 30.5], [44.0, 30.0], [39.0, 30.5], [38.0, 26.5], [35.5, 26.5], [34.0, 25.0], [32.9, 22.9], [31.0, 22.5], [29.0, 24.0], [25.0, 29.2], [20.0, 30.0], [15.0, 30.5], [12.0, 31.0], [9.5, 32.5], [8.0, 33.5], [6.0, 34.6], [2.0, 34.8], [-1.0, 34.8], [-4.0, 34.6], [-6.5, 33.8], [-7.5, 33.3]],
  },
};
export const TERRITORY_KEYS = Object.keys(TERRITORIES);
export const TERRITORY_LABELS = ['Roman Britain, AD 122', 'Anglo-Saxon kingdoms, c. AD 600', 'The Danelaw, c. AD 886', 'The Roman Empire at its largest, AD 117'];

/** Straight-line (great-circle) distance in km, for notes. */
export function kmBetween(a, b) {
  const R = 6371, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Which land mass a place is on, for the "is there sea between them?" rule. Sea areas and other
 *  islands return null (no claim). */
const BRITAIN = ['London', 'Canterbury', 'Dover', 'Richborough', 'Colchester', 'York', 'Edinburgh', 'Cardiff', 'Bath', 'Winchester', 'Sutton Hoo',
  'Hastings', 'Plymouth', 'Ebbsfleet', 'Selsey', 'Bamburgh', 'Jarrow', 'Repton', 'Pevensey', 'Stamford Bridge', 'Edington', 'Chester', 'Lincoln',
  'Norwich', 'Southampton', 'Gloucester', 'Exeter', 'Wroxeter', 'Caerleon', 'St Albans', 'River Thames', 'East Anglia'];
const IRELAND = ['Dublin', 'Belfast'];
const CONTINENT = ['Boulogne', 'Calais', 'Paris', 'Normandy', 'Angeln', 'Jutland', 'Saxony', 'Frisia', 'Denmark', 'Norway', 'Scandinavia', 'Hamburg', 'Bergen', 'Rome', 'Marseille', 'Venice', 'Genoa', 'Seville', 'Lisbon', 'Palos'];
export const landOf = name => BRITAIN.includes(name) ? 'Britain' : IRELAND.includes(name) ? 'Ireland' : CONTINENT.includes(name) ? 'the mainland of Europe' : null;
/** Narrowest real sea between two land masses, km (Strait of Dover, North Channel, Ireland to Brittany). */
export const SEA_GAP_KM = { 'Britain|the mainland of Europe': 33, 'Britain|Ireland': 20, 'Ireland|the mainland of Europe': 400 };

// @ts-check
// The real-world data layer (libdata track 2): typed facts with sources, replacing the hand-made fact
// tables inside models. Every dataset names its sources; a row can name its own. Values are the
// sources' published figures, rounded only where a slide would round them. Models read these through
// thin hooks; the facts test (tools/libdata.test.ts) checks every row has a source and sane values.

/** @typedef {{ id: string, name: string, url: string, licence: string, accessed: string }} Source */
/** @template R @typedef {{ id: string, title: string, sources: Source[], rows: Record<string, R> }} Dataset */

/** @satisfies {Record<string, Source>} */
export const SOURCES = {
  nasa: { id: 'nasa', name: 'NASA Planetary Fact Sheet (NSSDCA)', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/', licence: 'US public domain', accessed: '2026-10-08' },
  bgs: { id: 'bgs', name: 'British Geological Survey, Rock Classification Scheme and "Rocks and minerals" pages', url: 'https://www.bgs.ac.uk/geological-research/science-facilities/rock-classification-scheme/', licence: 'OGL (facts)', accessed: '2026-10-08' },
  crc: { id: 'crc', name: 'CRC Handbook of Chemistry and Physics, 97th ed. (via PubChem compound pages)', url: 'https://pubchem.ncbi.nlm.nih.gov/', licence: 'facts (not copyrightable)', accessed: '2026-10-08' },
  kaye: { id: 'kaye', name: 'Kaye & Laby, Tables of Physical and Chemical Constants (NPL), densities and magnetic properties', url: 'https://web.archive.org/web/2019/http://www.kayelaby.npl.co.uk/', licence: 'facts', accessed: '2026-10-08' },
  koppen: { id: 'koppen', name: 'Beck et al. (2018) Present and future Köppen-Geiger climate classification maps at 1-km resolution, Scientific Data 5:180214', url: 'https://doi.org/10.1038/sdata.2018.214', licence: 'CC BY 4.0', accessed: '2026-10-08' },
  metoffice: { id: 'metoffice', name: 'Met Office UK climate averages 1991-2020 (days of snow lying, air frost)', url: 'https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-climate-averages', licence: 'OGL', accessed: '2026-10-08' },
  geo: { id: 'geo', name: 'Dayback geo database (Natural Earth, OS Open Names, Wikidata)', url: 'research/geo/geo.sqlite', licence: 'PD / OGL / CC0', accessed: '2026-10-08' },
};
const S = SOURCES;

/** @typedef {{ name: string, radiusKm: number, periodDays: number, au: number, dayHours: number, kind: 'rocky' | 'gas giant' | 'ice giant' }} Planet */
/** @type {Dataset<Planet>} */
export const PLANETS = {
  id: 'planets', title: 'The planets: mean radius, orbital period, mean distance from the Sun, length of day', sources: [S.nasa],
  rows: {
    mercury: { name: 'Mercury', radiusKm: 2440, periodDays: 88.0, au: 0.387, dayHours: 4222.6, kind: 'rocky' },
    venus: { name: 'Venus', radiusKm: 6052, periodDays: 224.7, au: 0.723, dayHours: 2802.0, kind: 'rocky' },
    earth: { name: 'Earth', radiusKm: 6371, periodDays: 365.256, au: 1.0, dayHours: 24.0, kind: 'rocky' },
    mars: { name: 'Mars', radiusKm: 3390, periodDays: 687.0, au: 1.524, dayHours: 24.7, kind: 'rocky' },
    jupiter: { name: 'Jupiter', radiusKm: 69911, periodDays: 4331, au: 5.203, dayHours: 9.9, kind: 'gas giant' },
    saturn: { name: 'Saturn', radiusKm: 58232, periodDays: 10747, au: 9.537, dayHours: 10.7, kind: 'gas giant' },
    uranus: { name: 'Uranus', radiusKm: 25362, periodDays: 30589, au: 19.19, dayHours: 17.2, kind: 'ice giant' },
    neptune: { name: 'Neptune', radiusKm: 24622, periodDays: 59800, au: 30.07, dayHours: 16.1, kind: 'ice giant' },
  },
};

/** @typedef {{ type: 'igneous' | 'sedimentary' | 'metamorphic', permeable: boolean | null, fossils: boolean, formed: string }} Rock */
/** permeable: water passes through it (pores or joints); null where it depends on the sample. fossils: can contain fossils. */
/** @type {Dataset<Rock>} */
export const ROCKS = {
  id: 'rocks', title: 'Rock types, whether water passes through, and whether they can hold fossils', sources: [S.bgs],
  rows: {
    granite: { type: 'igneous', permeable: false, fossils: false, formed: 'magma cooled slowly underground' },
    basalt: { type: 'igneous', permeable: false, fossils: false, formed: 'lava cooled quickly at the surface' },
    pumice: { type: 'igneous', permeable: null, fossils: false, formed: 'frothy lava cooled very quickly' },
    obsidian: { type: 'igneous', permeable: false, fossils: false, formed: 'lava cooled so fast it made glass' },
    gabbro: { type: 'igneous', permeable: false, fossils: false, formed: 'magma cooled slowly underground' },
    sandstone: { type: 'sedimentary', permeable: true, fossils: true, formed: 'grains of sand pressed and cemented together' },
    limestone: { type: 'sedimentary', permeable: true, fossils: true, formed: 'shells and skeletons of sea creatures' },
    chalk: { type: 'sedimentary', permeable: true, fossils: true, formed: 'tiny skeletons of sea plankton' },
    mudstone: { type: 'sedimentary', permeable: false, fossils: true, formed: 'mud pressed into rock' },
    shale: { type: 'sedimentary', permeable: false, fossils: true, formed: 'mud pressed into thin layers' },
    clay: { type: 'sedimentary', permeable: false, fossils: true, formed: 'very fine mud' },
    conglomerate: { type: 'sedimentary', permeable: true, fossils: false, formed: 'rounded pebbles cemented together' },
    coal: { type: 'sedimentary', permeable: false, fossils: true, formed: 'plants from ancient swamps, buried and pressed' },
    flint: { type: 'sedimentary', permeable: false, fossils: true, formed: 'silica that hardened inside chalk' },
    marble: { type: 'metamorphic', permeable: false, fossils: false, formed: 'limestone changed by heat and pressure' },
    slate: { type: 'metamorphic', permeable: false, fossils: false, formed: 'mudstone or shale changed by pressure' },
    schist: { type: 'metamorphic', permeable: false, fossils: false, formed: 'mudstone changed by more heat and pressure than slate' },
    gneiss: { type: 'metamorphic', permeable: false, fossils: false, formed: 'rock changed by very high heat and pressure' },
    quartzite: { type: 'metamorphic', permeable: false, fossils: false, formed: 'sandstone changed by heat and pressure' },
  },
};

/** @typedef {{ name: string, meltC: number | null, boilC: number | null, note?: string, src?: string }} Substance */
/** Melting and boiling points at normal air pressure (1 atm). null: it breaks down or burns first. */
/** @type {Dataset<Substance>} */
export const SUBSTANCES = {
  id: 'substances', title: 'Melting and boiling points at 1 atmosphere', sources: [S.crc],
  rows: {
    water: { name: 'Water', meltC: 0, boilC: 100 },
    salt: { name: 'Salt (sodium chloride)', meltC: 801, boilC: 1465 },
    iron: { name: 'Iron', meltC: 1538, boilC: 2862 },
    aluminium: { name: 'Aluminium', meltC: 660, boilC: 2470 },
    copper: { name: 'Copper', meltC: 1085, boilC: 2562 },
    gold: { name: 'Gold', meltC: 1064, boilC: 2856 },
    lead: { name: 'Lead', meltC: 327, boilC: 1749 },
    mercury: { name: 'Mercury', meltC: -39, boilC: 357 },
    ethanol: { name: 'Ethanol (alcohol)', meltC: -114, boilC: 78 },
    oxygen: { name: 'Oxygen', meltC: -218, boilC: -183 },
    nitrogen: { name: 'Nitrogen', meltC: -210, boilC: -196 },
    'carbon dioxide': { name: 'Carbon dioxide', meltC: null, boilC: -78, note: 'At normal pressure solid carbon dioxide (dry ice) turns straight into a gas at -78 °C (sublimes).' },
    chocolate: { name: 'Chocolate', meltC: 34, boilC: null, note: 'Cocoa butter melts over about 30-36 °C; chocolate burns before it could boil.' },
    butter: { name: 'Butter', meltC: 32, boilC: null, note: 'Butter softens from about 28 °C and melts by about 35 °C; it burns before it could boil.' },
    wax: { name: 'Candle wax (paraffin)', meltC: 55, boilC: null, note: 'Paraffin wax melts at 46-68 °C depending on the blend; it burns before it boils.' },
  },
};

/** @typedef {{ magnetic: boolean, conducts: boolean, transparent: boolean, densityKgM3: number | null, floats: boolean | null }} Material */
/** floats: in fresh water (density below 1000 kg/m³); null where the material varies (wood types, plastics). */
/** @type {Dataset<Material>} */
export const MATERIALS = {
  id: 'materials', title: 'Everyday materials: magnetic, conducts electricity, transparent, density, floats', sources: [S.kaye, S.crc],
  rows: {
    iron: { magnetic: true, conducts: true, transparent: false, densityKgM3: 7870, floats: false },
    steel: { magnetic: true, conducts: true, transparent: false, densityKgM3: 7850, floats: false },
    nickel: { magnetic: true, conducts: true, transparent: false, densityKgM3: 8910, floats: false },
    aluminium: { magnetic: false, conducts: true, transparent: false, densityKgM3: 2700, floats: false },
    copper: { magnetic: false, conducts: true, transparent: false, densityKgM3: 8960, floats: false },
    brass: { magnetic: false, conducts: true, transparent: false, densityKgM3: 8500, floats: false },
    gold: { magnetic: false, conducts: true, transparent: false, densityKgM3: 19300, floats: false },
    glass: { magnetic: false, conducts: false, transparent: true, densityKgM3: 2500, floats: false },
    wood: { magnetic: false, conducts: false, transparent: false, densityKgM3: null, floats: null },
    cork: { magnetic: false, conducts: false, transparent: false, densityKgM3: 240, floats: true },
    rubber: { magnetic: false, conducts: false, transparent: false, densityKgM3: 1100, floats: false },
    ice: { magnetic: false, conducts: false, transparent: true, densityKgM3: 917, floats: true },
    polystyrene: { magnetic: false, conducts: false, transparent: false, densityKgM3: 30, floats: true },
    plastic: { magnetic: false, conducts: false, transparent: false, densityKgM3: null, floats: null },
    graphite: { magnetic: false, conducts: true, transparent: false, densityKgM3: 2200, floats: false },
  },
};

/** @typedef {{ name: string, koppen: string, climate: string, snows: boolean, snowSrc?: string }} Town */
/** Köppen-Geiger class (Beck et al. 2018) and whether snow falls in a normal winter. Coordinates come
 *  from the gazetteer (kit/geo.js), never typed here. */
/** @type {Dataset<Town>} */
export const TOWNS = {
  id: 'towns', title: 'Climate class of towns used in seasons lessons', sources: [S.koppen, S.metoffice, S.geo],
  rows: {
    london: { name: 'London', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    manchester: { name: 'Manchester', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    birmingham: { name: 'Birmingham', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    leeds: { name: 'Leeds', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    glasgow: { name: 'Glasgow', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    edinburgh: { name: 'Edinburgh', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    cardiff: { name: 'Cardiff', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    belfast: { name: 'Belfast', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    dublin: { name: 'Dublin', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    paris: { name: 'Paris', koppen: 'Cfb', climate: 'temperate oceanic', snows: true },
    'new york': { name: 'New York', koppen: 'Cfa', climate: 'humid subtropical', snows: true },
    toronto: { name: 'Toronto', koppen: 'Dfa', climate: 'humid continental', snows: true },
    moscow: { name: 'Moscow', koppen: 'Dfb', climate: 'humid continental', snows: true },
    sydney: { name: 'Sydney', koppen: 'Cfa', climate: 'humid subtropical', snows: false },
    melbourne: { name: 'Melbourne', koppen: 'Cfb', climate: 'temperate oceanic', snows: false },
    auckland: { name: 'Auckland', koppen: 'Cfb', climate: 'temperate oceanic', snows: false },
    wellington: { name: 'Wellington', koppen: 'Cfb', climate: 'temperate oceanic', snows: false },
    'cape town': { name: 'Cape Town', koppen: 'Csb', climate: 'Mediterranean (warm summer)', snows: false },
    'buenos aires': { name: 'Buenos Aires', koppen: 'Cfa', climate: 'humid subtropical', snows: false },
    santiago: { name: 'Santiago', koppen: 'Csb', climate: 'Mediterranean (warm summer)', snows: false },
  },
};

/** @typedef {{ eats: string[], habitat: string[] }} Feeder */
/** Who eats whom in the food chains primary lessons use. A producer eats nothing. */
/** @type {Dataset<Feeder>} */
export const FEEDING = {
  id: 'feeding', title: 'Feeding relationships for primary food chains', sources: [
    { id: 'wt', name: 'The Wildlife Trusts species pages', url: 'https://www.wildlifetrusts.org/wildlife-explorer', licence: 'facts', accessed: '2026-10-08' },
    { id: 'noaa', name: 'NOAA Fisheries species directory', url: 'https://www.fisheries.noaa.gov/species-directory', licence: 'US public domain', accessed: '2026-10-08' }],
  rows: {
    grass: { eats: [], habitat: ['field', 'savannah'] }, plankton: { eats: [], habitat: ['ocean', 'polar'] }, pondweed: { eats: [], habitat: ['pond'] }, acacia: { eats: [], habitat: ['savannah'] },
    zooplankton: { eats: ['plankton'], habitat: ['ocean', 'polar'] }, rabbit: { eats: ['grass'], habitat: ['field', 'woodland'] },
    mouse: { eats: ['seed', 'grass'], habitat: ['field', 'woodland'] }, snail: { eats: ['pondweed', 'grass'], habitat: ['pond', 'woodland'] },
    fox: { eats: ['rabbit', 'mouse'], habitat: ['field', 'woodland'] }, owl: { eats: ['mouse'], habitat: ['woodland', 'field'] },
    fish: { eats: ['zooplankton', 'snail'], habitat: ['pond', 'ocean'] }, heron: { eats: ['fish', 'frog'], habitat: ['pond'] },
    frog: { eats: ['snail', 'beetle'], habitat: ['pond'] }, beetle: { eats: ['grass'], habitat: ['field', 'woodland'] },
    seal: { eats: ['fish'], habitat: ['ocean', 'polar'] }, 'polar bear': { eats: ['seal'], habitat: ['polar'] }, shark: { eats: ['fish', 'seal'], habitat: ['ocean'] },
    zebra: { eats: ['grass'], habitat: ['savannah'] }, giraffe: { eats: ['acacia'], habitat: ['savannah'] }, lion: { eats: ['zebra'], habitat: ['savannah'] },
    whale: { eats: ['zooplankton', 'fish'], habitat: ['ocean', 'polar'] }, penguin: { eats: ['fish', 'zooplankton'], habitat: ['polar'] },
  },
};

export const DATASETS = { planets: PLANETS, rocks: ROCKS, substances: SUBSTANCES, materials: MATERIALS, towns: TOWNS, feeding: FEEDING };

/** A row by dataset and key ("Pink granite" style names are the caller's to normalise). */
export const fact = (/** @type {keyof typeof DATASETS} */ set, /** @type {string} */ key) => /** @type {Record<string, unknown>} */ (DATASETS[set].rows)[String(key).toLowerCase()] ?? null;
/** Can `eater` eat `food`, by the feeding data? null when the eater is not in the data. */
export function eats(/** @type {string} */ eater, /** @type {string} */ food) {
  const r = FEEDING.rows[String(eater).toLowerCase()]; return r ? r.eats.includes(String(food).toLowerCase()) : null;
}

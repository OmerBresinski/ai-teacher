// Historical map: journeys, invasions and territory over time, on a true-shaped map.
// Routes run between real places (in date order, each its own build), territories are drawn
// after a cited source and clipped to the coast, and today's borders can come last, faint.
// Built on the kit (batch G map parts). Labels are placed once for every build, on solid
// grounds, with hairline leaders that never cross another label.

import { basemap, route, scaleBar, territory, todayBorders } from "../kit/batch-G.js";
import {
  clamp,
  computed,
  editable,
  formatYear,
  GRID,
  h,
  labelGround,
  measure,
  overlaps,
  parseDate,
  result,
  schemaCheck,
  T,
  TEXT_PARAM,
  TITLE_PARAM,
  textBlock,
  txt,
  WORD_CAPS,
  withDefaults,
} from "../kit/index.js";
import {
  inView,
  kmBetween,
  landOf,
  lookup,
  PLACE_NAMES,
  SEA_GAP_KM,
  TERRITORIES,
  TERRITORY_KEYS,
  TERRITORY_LABELS,
  VIEWS,
} from "./hist_map/data.js";

export const meta = {
  id: "hist_map",
  name: "Historical map",
  kind: "info",
  version: 1,
  subjects: ["History", "Geography"],
  years: ["Y2", "Y3", "Y4", "Y5", "Y6"],
  teaches:
    "Where people travelled, invaded or settled, and how much land they held, on a true map in date order.",
};

const COLOURS = ["auto", "1", "2", "3", "4", "5", "6"],
  COLOUR_LABELS = ["Automatic", "Brown", "Red", "Green", "Blue", "Gold", "Purple"];
const DATE = {
  type: "string",
  title: "Date",
  description: "Like “AD 43”, “c. AD 450”, “55 BC” or “1492”. There is no year 0.",
  minLength: 1,
  maxLength: 20,
};
const PLACE = (title, def) => ({ type: "string", title, enum: PLACE_NAMES, default: def });
const REGION_KEYS = ["uk", "south", "northsea", "europe", "mediterranean", "world"];
// place names and the north word are names (label cap); the borders key is a phrase
const NAME = (title, role) => ({
  type: "string",
  title,
  maxLength: WORD_CAPS[role],
  "x-role": role,
});
const TEXT = Object.assign({}, TEXT_PARAM, {
  patternProperties: Object.assign(
    {
      "^label:place:": NAME("Place name", "label"),
      "^label:north$": NAME("North arrow word", "label"),
      "^label:today$": NAME("Borders key", "phrase"),
    },
    TEXT_PARAM.patternProperties,
  ),
});

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Historical map",
  properties: {
    title: TITLE_PARAM("Journeys on a map"),
    region: {
      type: "string",
      title: "Map of",
      enum: REGION_KEYS,
      "x-labels": [
        "Britain and Ireland",
        "England and Wales (closer)",
        "Britain and the North Sea lands",
        "Europe",
        "The Mediterranean",
        "The world",
      ],
      default: "uk",
    },
    dates: {
      type: "string",
      title: "How years are written",
      enum: ["bc-ad", "bce-ce", "plain"],
      "x-labels": ["BC and AD", "BCE and CE", "Years only (like 1492)"],
      default: "bc-ad",
    },
    dateRange: {
      type: "object",
      title: "Years the map covers",
      description: "Every journey, event and area must fall inside these years.",
      default: { from: "AD 1", to: "AD 500" },
      properties: {
        from: Object.assign({}, DATE, { title: "From" }),
        to: Object.assign({}, DATE, { title: "To" }),
      },
    },
    routes: {
      type: "array",
      title: "Journeys",
      description: "Each journey draws on in date order. It starts and ends at real places.",
      "x-item": "a journey",
      maxItems: 4,
      default: [],
      items: {
        type: "object",
        required: ["who", "date", "from", "to"],
        default: {
          who: "Someone",
          label: "",
          date: "AD 100",
          from: "London",
          via: "",
          to: "York",
          travel: "surface",
          colour: "auto",
        },
        properties: {
          who: { type: "string", title: "Who travelled", maxLength: 32, minLength: 1 },
          label: { type: "string", title: "What they did", maxLength: 70, default: "" },
          date: DATE,
          from: PLACE("Starts at", "London"),
          via: {
            type: "string",
            title: "On the way",
            description:
              "Places or seas passed, separated by commas, such as “Canary Islands” or “Strait of Dover”.",
            maxLength: 90,
            default: "",
          },
          to: PLACE("Ends at", "York"),
          travel: {
            type: "string",
            title: "How",
            enum: ["surface", "space"],
            "x-labels": ["By land or sea", "Into space and back"],
            default: "surface",
          },
          colour: {
            type: "string",
            title: "Colour",
            enum: COLOURS,
            "x-labels": COLOUR_LABELS,
            default: "auto",
          },
        },
      },
    },
    events: {
      type: "array",
      title: "Events at a place",
      "x-item": "an event",
      maxItems: 4,
      default: [],
      items: {
        type: "object",
        required: ["place", "date", "label"],
        default: { place: "London", date: "AD 100", label: "Something happened here" },
        properties: {
          place: PLACE("Where", "London"),
          date: DATE,
          label: { type: "string", title: "What happened", maxLength: 70, minLength: 1 },
        },
      },
    },
    territories: {
      type: "array",
      title: "Areas held",
      description: "Shaded land, drawn after a published map. Your own area needs its source.",
      "x-item": "an area",
      maxItems: 3,
      default: [],
      items: {
        type: "object",
        required: ["area"],
        default: {
          area: "roman_britain_122",
          label: "",
          colour: "auto",
          date: "",
          corners: "",
          source: "",
        },
        properties: {
          area: {
            type: "string",
            title: "Area",
            enum: [...TERRITORY_KEYS, "custom"],
            "x-labels": [...TERRITORY_LABELS, "My own area (needs a source)"],
            default: "roman_britain_122",
          },
          label: {
            type: "string",
            title: "Name on the map",
            description: "Leave empty to use ours.",
            maxLength: 40,
            default: "",
          },
          colour: {
            type: "string",
            title: "Colour",
            enum: COLOURS,
            "x-labels": COLOUR_LABELS,
            default: "auto",
          },
          date: Object.assign({}, DATE, {
            title: "Date (your own area)",
            minLength: 0,
            default: "",
          }),
          corners: {
            type: "string",
            title: "Corners (your own area)",
            description: "Three or more real places, separated by commas, going round the edge.",
            maxLength: 160,
            default: "",
          },
          source: {
            type: "string",
            title: "Source (your own area)",
            description: "The atlas or map the edge comes from.",
            maxLength: 160,
            default: "",
          },
        },
      },
    },
    todayBorders: {
      type: "boolean",
      title: "End with today’s borders, faint (maps of Britain only)",
      default: false,
    },
    north: { type: "boolean", title: "Show the north arrow", default: true, "x-panel": "advanced" },
    scaleBar: { type: "boolean", title: "Show a scale bar", default: true, "x-panel": "advanced" },
    text: TEXT,
  },
};

export const presets = [
  {
    id: "y2-columbus-armstrong",
    name: "Year 2: Columbus and Armstrong, two journeys",
    params: {
      title: "Two famous journeys",
      region: "world",
      dates: "plain",
      dateRange: { from: "1450", to: "2000" },
      routes: [
        {
          who: "Christopher Columbus",
          label: "sails west across the Atlantic",
          date: "1492",
          from: "Palos",
          via: "Canary Islands",
          to: "San Salvador",
          colour: "4",
        },
        {
          who: "Neil Armstrong",
          label: "flies to the Moon and back",
          date: "1969",
          from: "Cape Canaveral",
          to: "Pacific splashdown",
          travel: "space",
          colour: "6",
        },
      ],
    },
  },
  {
    id: "y3-anglo-saxons",
    name: "Year 3: where the Anglo-Saxons came from",
    params: {
      title: "Where the Anglo-Saxons came from",
      region: "northsea",
      dates: "bc-ad",
      dateRange: { from: "AD 400", to: "AD 650" },
      routes: [
        {
          who: "Jutes",
          label: "sail to Kent",
          date: "AD 449",
          from: "Jutland",
          to: "Ebbsfleet",
          colour: "5",
        },
        {
          who: "Angles",
          label: "sail to East Anglia",
          date: "c. AD 450",
          from: "Angeln",
          to: "Sutton Hoo",
          colour: "4",
        },
        {
          who: "Saxons",
          label: "sail along the coast to Sussex",
          date: "AD 477",
          from: "Saxony",
          via: "Frisia, Strait of Dover, English Channel",
          to: "Selsey",
          colour: "2",
        },
      ],
      territories: [{ area: "anglo_saxon_600", colour: "3" }],
    },
  },
  {
    id: "y4-roman-invasion",
    name: "Year 4: the Roman invasion route",
    params: {
      title: "The Roman invasion of Britain",
      region: "south",
      dates: "bc-ad",
      dateRange: { from: "AD 40", to: "AD 130" },
      routes: [
        {
          who: "Claudius’s army",
          label: "crosses the sea to Britain",
          date: "AD 43",
          from: "Boulogne",
          to: "Richborough",
          colour: "2",
        },
        {
          who: "The legions",
          label: "march to the Thames and cross it",
          date: "AD 43",
          from: "Richborough",
          to: "River Thames",
          colour: "2",
        },
        {
          who: "Emperor Claudius",
          label: "joins them and enters Camulodunum (Colchester)",
          date: "AD 43",
          from: "River Thames",
          to: "Colchester",
          colour: "2",
        },
      ],
      events: [{ place: "York", date: "AD 71", label: "The Romans build a fortress at York" }],
      territories: [{ area: "roman_britain_122", colour: "2" }],
      todayBorders: true,
    },
  },
  {
    id: "y5-vikings",
    name: "Year 5: Viking raids and the Danelaw",
    params: {
      title: "Viking raids and the Danelaw",
      region: "northsea",
      dates: "bc-ad",
      dateRange: { from: "AD 750", to: "AD 900" },
      routes: [
        {
          who: "Viking raiders",
          label: "attack the monastery at Lindisfarne",
          date: "AD 793",
          from: "Norway",
          to: "Lindisfarne",
          colour: "4",
        },
        {
          who: "The Great Heathen Army",
          label: "sails from Denmark and lands in East Anglia",
          date: "AD 865",
          from: "Denmark",
          to: "East Anglia",
          colour: "6",
        },
      ],
      events: [
        { place: "York", date: "AD 866", label: "The Great Heathen Army takes York" },
        { place: "Winchester", date: "AD 871", label: "Alfred becomes king of Wessex" },
      ],
      territories: [{ area: "danelaw_886", colour: "6" }],
      todayBorders: true,
    },
  },
];

/* ------------------------------------------------------------------ the map's geometry (no DOM) */
const MAPBOX = { x: GRID.left, y: 128, w: GRID.right - GRID.left, h: GRID.bottom - 128 };
// the same equirectangular projection the kit basemap draws (standard parallel at the middle)
function projFor(region) {
  const V = VIEWS[region] || VIEWS.uk;
  const [w0, e0] = V.lon,
    [s0, n0] = V.lat;
  const kx = region === "world" ? 1 : Math.cos((((s0 + n0) / 2) * Math.PI) / 180);
  const W0 = (e0 - w0) * kx,
    H0 = n0 - s0;
  const k = Math.min(MAPBOX.w / W0, MAPBOX.h / H0);
  const ox = MAPBOX.x + (MAPBOX.w - W0 * k) / 2,
    oy = MAPBOX.y + (MAPBOX.h - H0 * k) / 2;
  const f = (lon, lat) => [ox + (lon - w0) * kx * k, oy + (n0 - lat) * k];
  f.w = W0 * k;
  f.k = k;
  return f;
}
// a tall map sits at the left so the labels get one clear column on the right
// a map narrow enough gets a callout column on its right (cards never sit on the map)
const COLUMN_MIN = 340;
// f < 1 draws a column map smaller (same region, same shape), to give a crowded key more room
const mapBox = (region, f = 1) => {
  const w = projFor(region).w;
  return w < MAPBOX.w - COLUMN_MIN
    ? {
        x: GRID.left,
        y: MAPBOX.y + (MAPBOX.h * (1 - f)) / 2,
        w: w * f,
        h: MAPBOX.h * f,
        column: true,
      }
    : MAPBOX;
};
const FIRST_SPACEFLIGHT = 1961;
const splitList = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const NUM = ["no", "one", "two", "three", "four", "five", "six"];
const plural = (n, w) => `${NUM[n] || n} ${w}${n === 1 ? "" : "s"}`;

function model(P) {
  const st = P.dates || "bc-ad",
    V = VIEWS[P.region] || VIEWS.uk;
  const dl = (d) => formatYear(d.astro, st, d.approx);
  const autoCol = (i) => (i % 6) + 1;
  const routes = (P.routes || []).map((r, i) => {
    const a = lookup(r.from),
      z = lookup(r.to);
    const dropped = [];
    // every stop the teacher gave is kept, in their order (a voyage round a cape turns sharply; that is
    // the journey). A stop the map cannot place, or one off this map, is refused in validate, never dropped.
    const via = splitList(r.via).map(lookup).filter(Boolean);
    const viaOff = via.filter((v) => !inView(V, v.ll)).map((v) => v.name);
    const endOff = [a, z].find((p) => p && !inView(V, p.ll));
    const pts = [a, ...via, z];
    const d = parseDate(r.date);
    // “into space” only for a journey from the first spaceflight on; earlier, the line is drawn by land or sea (validate says so)
    return {
      ...r,
      i,
      d,
      pts,
      dropped,
      viaOff,
      endOff,
      spaceAsked: r.travel === "space",
      earlySpace: r.travel === "space" && !d.error && d.astro < FIRST_SPACEFLIGHT,
      a: pts[0],
      b: pts[pts.length - 1],
      space: r.travel === "space" && !d.error && d.astro >= FIRST_SPACEFLIGHT,
      col: r.colour && r.colour !== "auto" ? +r.colour : autoCol(i),
    };
  });
  const events = (P.events || []).map((e, i) => ({
    ...e,
    i,
    d: parseDate(e.date),
    p: lookup(e.place),
  }));
  const terrs = (P.territories || []).map((t, i) => {
    const L = TERRITORIES[t.area];
    const custom = t.area === "custom";
    const cornerPts = custom ? splitList(t.corners).map(lookup) : null;
    const poly = custom ? (cornerPts.every(Boolean) ? cornerPts.map((c) => c.ll) : []) : L.poly;
    const at = custom
      ? poly.length
        ? [
            poly.reduce((s, q) => s + q[0], 0) / poly.length,
            poly.reduce((s, q) => s + q[1], 0) / poly.length,
          ]
        : null
      : L.at;
    return {
      ...t,
      i,
      custom,
      name: t.label || (custom ? "Our area" : L.name),
      dateRaw: custom ? t.date : L.date,
      d: parseDate(custom ? t.date : L.date),
      source: custom ? t.source : L.source,
      hatch: custom ? false : L.hatch,
      poly,
      at,
      cornerPts,
      col: t.colour && t.colour !== "auto" ? +t.colour : 3 + i,
      incomplete:
        custom &&
        (!String(t.date || "").trim() || !String(t.source || "").trim() || poly.length < 3),
    };
  });
  const borders = !!P.todayBorders && ["uk", "south", "northsea"].includes(P.region);
  const range = P.dateRange || {};
  const from = parseDate(range.from),
    to = parseDate(range.to);
  return {
    st,
    V,
    dl,
    routes: routes.filter((r) => !r.endOff),
    allRoutes: routes,
    events,
    terrs: terrs.filter((t) => !t.incomplete),
    allTerrs: terrs,
    borders,
    from,
    to,
  };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  let R = schemaCheck(params, P);
  const W = [];
  // a place outside the list gets a reason in teacher words, not the whole list
  R = R.map((r) => {
    const m = r.path.match(/^(routes|events)\.(\d+)\.(from|to|place)$/);
    if (!m || !/must be one of/.test(r.reason)) return r;
    const v = (P[m[1]][+m[2]] || {})[m[3]];
    return {
      path: r.path,
      reason: `“${v}” isn’t a place this map knows, so the line can’t start or end there. Choose a real place from the list, such as London, Rome or York.`,
    };
  });
  if (R.length) return result(R);
  const M = model(P);
  const st = M.st;
  const chk = (path, d) => {
    if (d.error) R.push({ path, reason: d.error });
    return !d.error;
  };
  chk("dateRange.from", M.from);
  chk("dateRange.to", M.to);
  M.allRoutes.forEach((r) => chk(`routes.${r.i}.date`, r.d));
  M.events.forEach((e) => chk(`events.${e.i}.date`, e.d));
  M.allTerrs.forEach((t) => {
    if (t.custom && !String(t.date || "").trim()) return;
    chk(`territories.${t.i}.date`, t.d);
  });
  if (R.length) return result(R);
  const all = [
    ["dateRange.from", M.from],
    ["dateRange.to", M.to],
    ...M.allRoutes.map((r) => [`routes.${r.i}.date`, r.d]),
    ...M.events.map((e) => [`events.${e.i}.date`, e.d]),
  ];
  if (st === "plain")
    for (const [path, v] of all)
      if (v.astro <= 0) {
        R.push({
          path,
          reason: `“${v.raw}” is BC, so the years need BC and AD (or BCE and CE). Change “How years are written”.`,
        });
        break;
      }
  const NOW = new Date().getFullYear();
  const future = [
    ...all,
    ...M.allTerrs
      .filter((t) => t.custom && String(t.date || "").trim())
      .map((t) => [`territories.${t.i}.date`, t.d]),
  ];
  for (const [path, v] of future)
    if (v.astro > NOW)
      R.push({
        path,
        reason: `${M.dl(v)} is in the future. This map shows history, so choose a year up to ${NOW}.`,
      });
  if (R.length) return result(R);
  if (M.to.astro <= M.from.astro)
    R.push({
      path: "dateRange.to",
      reason: `The map has to cover a span of years: ${M.dl(M.to)} is not after ${M.dl(M.from)}.`,
    });
  if (R.length) return result(R);
  const inR = (d) => d.astro >= M.from.astro && d.astro <= M.to.astro;
  const span = `${M.dl(M.from)} to ${M.dl(M.to)}`;
  const proj = projFor(P.region);
  const where = M.V.name;
  M.allRoutes.forEach((r) => {
    const base = `routes.${r.i}`;
    if (!inR(r.d))
      R.push({
        path: `${base}.date`,
        reason: `${M.dl(r.d)} is outside the years this map covers (${span}). Move the date or widen “Years the map covers”.`,
      });
    // a stop is part of the journey: one the map can't place is refused, never silently left off the line
    splitList(r.via).forEach((v) => {
      if (!lookup(v))
        R.push({
          path: `${base}.via`,
          reason: `“${v}” isn’t a place or sea this map knows, and the line must pass every stop. Use real places, such as “Canary Islands” or “Strait of Dover”, or take it out.`,
        });
    });
    if (r.earlySpace)
      W.push(
        `${r.who}: people first went into space in ${FIRST_SPACEFLIGHT}, so a journey in ${M.dl(r.d)} is drawn by land or sea, not into space.`,
      );
    if (r.pts.some((p) => !p)) return;
    if (r.endOff)
      return R.push({
        path: `${base}.${r.endOff === r.a ? "from" : "to"}`,
        reason: `${r.who}: ${r.endOff.name} is not on a map of ${where}, so this journey can’t be drawn. Choose a map that shows the whole journey.`,
      });
    if (r.viaOff.length)
      return R.push({
        path: `${base}.via`,
        reason: `${r.who}: ${r.viaOff.join(", ")} ${r.viaOff.length > 1 ? "are" : "is"} not on a map of ${where}, and the line must pass every stop. Choose a map that shows the whole journey.`,
      });
    // these depend on both ends, so they warn: refusing would lock “Starts at” and “Ends at” together
    if (!r.space && r.a.name === r.b.name)
      return W.push(
        `${r.who}: this journey starts and ends at ${r.a.name}, so only the place is marked. Choose where it ended.`,
      );
    if (!r.space) {
      let len = 0;
      for (let j = 1; j < r.pts.length; j++) {
        const [x1, y1] = proj(...r.pts[j - 1].ll),
          [x2, y2] = proj(...r.pts[j].ll);
        len += Math.hypot(x2 - x1, y2 - y1);
      }
      if (len < 36)
        W.push(
          `${r.a.name} to ${r.b.name} is too short to see well on a map of ${where}. A closer map, such as Britain, shows it better.`,
        );
      // two land masses: the drawn coast must show the sea between them, or the line reads as a land bridge
      const la = landOf(r.a.name),
        lb = landOf(r.b.name);
      if (la && lb && la !== lb) {
        const gap = SEA_GAP_KM[[la, lb].sort().join("|")] || 0;
        const kmPerUnit = 111.32 / proj.k;
        if (gap / kmPerUnit < 8)
          W.push(
            `${r.a.name} is in ${la} and ${r.b.name} is in ${lb}, but at this size the map can’t show the sea between them, so the line may look like it crosses land. A closer map shows the sea.`,
          );
      }
    }
  });
  M.events.forEach((e) => {
    if (!inR(e.d))
      R.push({
        path: `events.${e.i}.date`,
        reason: `${M.dl(e.d)} is outside the years this map covers (${span}). Move the date or widen “Years the map covers”.`,
      });
    if (e.p && !inView(M.V, e.p.ll))
      R.push({
        path: `events.${e.i}.place`,
        reason: `${e.p.name} is not on a map of ${where}. Choose a map that shows it.`,
      });
  });
  M.allTerrs.forEach((t) => {
    const base = `territories.${t.i}`;
    if (t.custom) {
      // your own area is filled in a field at a time: until it has a date, a source and three real corners it is left off, with a note
      const bad = splitList(t.corners).find((c) => !lookup(c));
      const need = [];
      if (!String(t.date || "").trim()) need.push("a date (the year the land was held like this)");
      if (!String(t.source || "").trim())
        need.push("a source (the atlas or map its edge comes from)");
      if (bad) need.push(`real places for the corners (“${bad}” isn’t one this map knows)`);
      else if (t.cornerPts.length < 3) need.push("at least three corners, going round its edge");
      if (need.length)
        return W.push(`Your own area is left off the map until it has ${need.join(", ")}.`);
    }
    if (!inR(t.d))
      R.push({
        path: t.custom ? `${base}.date` : `${base}.area`,
        reason: `${t.name} is drawn as it was in ${M.dl(t.d)}, outside the years this map covers (${span}). Widen “Years the map covers” or choose another area.`,
      });
    if (t.poly.length >= 3) {
      const xs = t.poly.map((q) => proj(...q));
      const x0 = Math.min(...xs.map((q) => q[0])),
        x1 = Math.max(...xs.map((q) => q[0])),
        y0 = Math.min(...xs.map((q) => q[1])),
        y1 = Math.max(...xs.map((q) => q[1]));
      if (!t.poly.some((q) => inView(M.V, q)) && !inView(M.V, t.at))
        R.push({ path: `${base}.area`, reason: `${t.name} is not on a map of ${where}.` });
      else if (x1 - x0 < 36 || y1 - y0 < 24)
        R.push({
          path: `${base}.area`,
          reason: `${t.name} is too small to see on a map of ${where}. Choose a closer map, such as Britain.`,
        });
    }
  });
  if (P.todayBorders && !M.borders)
    W.push("Today’s borders are only drawn on maps of Britain, so that step is left out.");
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P);
  const dl = M.dl;
  const items = [];
  items.push({
    key: "map",
    t: -Infinity,
    o: 0,
    caption: `A map of ${M.V.name}, with north at the top.`,
  });
  M.routes.forEach((r) =>
    items.push({
      key: `route:${r.i}`,
      t: r.d.astro,
      o: 1,
      r,
      caption: `${dl(r.d)}: ${r.who}, from ${r.a.name} to ${r.b.name}${r.space ? ", by way of space" : ""}.`,
    }),
  );
  M.events.forEach((e) =>
    items.push({
      key: `ev:${e.i}`,
      t: e.d.astro,
      o: 2,
      e,
      caption: `${dl(e.d)}, ${e.p.name}: ${e.label}.`,
    }),
  );
  items.sort((a, b) => a.t - b.t || a.o - b.o);
  [...M.terrs]
    .sort((a, b) => a.d.astro - b.d.astro)
    .forEach((t) =>
      items.push({
        key: `terr:${t.i}`,
        t: Infinity,
        tr: t,
        caption: `${t.name} in ${dl(t.d)}${t.hatch ? ". The striped edge is approximate: no one knows the exact border" : ""}.`,
      }),
    );
  if (M.borders)
    items.push({ key: "today", caption: "Today’s borders, faint and dashed, for comparison." });
  const bits = [
    M.routes.length ? plural(M.routes.length, "journey") : null,
    M.events.length ? plural(M.events.length, "event") : null,
    M.terrs.length ? plural(M.terrs.length, "area") : null,
  ].filter(Boolean);
  const list =
    bits.length > 1
      ? bits.slice(0, -1).join(", ") + " and " + bits[bits.length - 1]
      : bits[0] || "the map";
  const summary = `${list[0].toUpperCase()}${list.slice(1)}, from ${dl(M.from)} to ${dl(M.to)}.`;
  return { M, items, summary };
}
export function builds(P) {
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

const fmtKm = (n) =>
  n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n);
export function notes(P) {
  const { M, items } = plan(P);
  const steps = items.map((it) => {
    if (it.key === "map")
      return P.region === "world"
        ? "A flat world map stretches the land near the poles, so distances there look bigger than they are. Shapes near the equator are true. Find the places before the journeys start."
        : "This map keeps true shapes and is drawn to scale: the bar shows a real distance. Find north and the places before the journeys start.";
    if (it.r) {
      const r = it.r;
      if (r.space)
        return `${r.who} left from ${r.a.name} and came back down at ${r.b.name}. The line arcs up off the map’s surface because the journey went into space. The arc is not to scale: the Moon is about 384,000 km away, far beyond the edge of any map.`;
      const km = kmBetween(r.a.ll, r.b.ll);
      const via = splitList(r.via);
      return `${r.a.name} to ${r.b.name} is about ${fmtKm(km).toLocaleString("en-GB")} km in a straight line${via.length ? `; the route went by ${via.join(", ")}` : ""}. The line shows the way they went, not every turn.${r.d.approx ? " “c.” means about: the date comes from evidence, not a record." : ""}`;
    }
    if (it.e) return `Point to ${it.e.p.name} on the map. Ask: why might this have happened here?`;
    if (it.tr) {
      const t = it.tr;
      return `The shaded land is drawn after ${t.source}.${t.hatch ? " The striped edge is approximate: borders then were not drawn on maps." : ""} Ask: how did the journeys lead to this?`;
    }
    if (it.key === "today")
      return "Borders today are not the same as borders then. Ask: which places would have been in a different land?";
    return "";
  });
  return {
    steps,
    summary: "Ask the class to retell the story of the map in date order, using the place names.",
  };
}

/* ------------------------------------------------------------------ layout helpers */
// Clip every land ring to a rectangle (Sutherland–Hodgman). The kit draws the whole world's
// outline; zoomed in, its far-off points make the browser drop parts of the fill, so the model
// redraws only what the frame shows. Same coastline, no change of shape.
function clipRings(d, r) {
  const rings = d
    .split("Z")
    .map((sg) => (sg.match(/-?\d+(?:\.\d+)?/g) || []).map(Number))
    .filter((a) => a.length >= 6)
    .map((a) => {
      const q = [];
      for (let i = 0; i < a.length; i += 2) q.push([a[i], a[i + 1]]);
      return q;
    });
  const edges = [
    [(q) => q[0] >= r.x, (a, b) => [r.x, a[1] + ((b[1] - a[1]) * (r.x - a[0])) / (b[0] - a[0])]],
    [
      (q) => q[0] <= r.x + r.w,
      (a, b) => [r.x + r.w, a[1] + ((b[1] - a[1]) * (r.x + r.w - a[0])) / (b[0] - a[0])],
    ],
    [(q) => q[1] >= r.y, (a, b) => [a[0] + ((b[0] - a[0]) * (r.y - a[1])) / (b[1] - a[1]), r.y]],
    [
      (q) => q[1] <= r.y + r.h,
      (a, b) => [a[0] + ((b[0] - a[0]) * (r.y + r.h - a[1])) / (b[1] - a[1]), r.y + r.h],
    ],
  ];
  const out = [];
  for (let ring of rings) {
    for (const [inside, cut] of edges) {
      const res = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[(i + ring.length - 1) % ring.length],
          b = ring[i];
        if (inside(b)) {
          if (!inside(a)) res.push(cut(a, b));
          res.push(b);
        } else if (inside(a)) res.push(cut(a, b));
      }
      ring = res;
      if (!ring.length) break;
    }
    ring = ring.filter((q, i) => {
      const n = ring[(i + 1) % ring.length];
      return Math.abs(q[0] - n[0]) > 0.05 || Math.abs(q[1] - n[1]) > 0.05;
    });
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}
// does segment (x1,y1)-(x2,y2) pass through box b?
function segHits(x1, y1, x2, y2, b) {
  let t0 = 0,
    t1 = 1;
  const dx = x2 - x1,
    dy = y2 - y1;
  for (const [p, q] of [
    [-dx, x1 - b.x],
    [dx, b.x + b.w - x1],
    [-dy, y1 - b.y],
    [dy, b.y + b.h - y1],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 < t1;
}
// do two leader lines cross (a shared end does not count)?
function segX(a, b) {
  const near = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2) < 4;
  if (
    near(a[0], a[1], b[0], b[1]) ||
    near(a[0], a[1], b[2], b[3]) ||
    near(a[2], a[3], b[0], b[1]) ||
    near(a[2], a[3], b[2], b[3])
  )
    return false;
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const A = [a[0], a[1]],
    B = [a[2], a[3]],
    C = [b[0], b[1]],
    D = [b[2], b[3]];
  return o(A, B, C) !== o(A, B, D) && o(C, D, A) !== o(C, D, B);
}
// where do segments a and b cross (null if they don't)?
function segAt(a, b) {
  const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d,
    u = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
    ? [a[0] + t * (a[2] - a[0]), a[1] + t * (a[3] - a[1])]
    : null;
}
// distance from point to segment
function segDist(px, py, l) {
  const dx = l[2] - l[0],
    dy = l[3] - l[1],
    L2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - l[0]) * dx + (py - l[1]) * dy) / L2, 0, 1);
  return Math.hypot(l[0] + t * dx - px, l[1] + t * dy - py);
}
// two leaders cross, or pass so close they read as crossing (a shared end does not count)
function segNear(a, b) {
  if (segX(a, b)) return true;
  const ends = (l, m) =>
    [
      [l[0], l[1]],
      [l[2], l[3]],
    ].some(
      ([x, y]) =>
        Math.hypot(x - m[0], y - m[1]) >= 4 &&
        Math.hypot(x - m[2], y - m[3]) >= 4 &&
        segDist(x, y, m) < 6,
    );
  return ends(a, b) || ends(b, a);
}
const grow = (q, m) => ({ x: q.x - m, y: q.y - m, w: q.w + 2 * m, h: q.h + 2 * m });
function placer(bounds, obstacles, onLand, frame, routeSegs = [], leaders0 = []) {
  const boxes = obstacles.slice(),
    leaders = leaders0.slice();
  for (const o of boxes) if (!o.placed) o.obst = true;
  // a leader may leave its own dot along a route, but never cross a route line further out
  const crossesRoute = (l) =>
    routeSegs.some((r) => {
      const q = segAt(l, r);
      return q && Math.hypot(q[0] - l[0], q[1] - l[1]) > 12;
    });
  const ANG = Array.from({ length: 24 }, (_, i) => (i * Math.PI) / 12);
  return {
    boxes,
    leaders,
    bounds,
    obstacle(b) {
      boxes.push(b);
    },
    leader(l) {
      leaders.push(l);
    },
    place(ax0, ay0, w, hh, o = {}) {
      const list = Array.isArray(ax0) ? ax0 : [[ax0, ay0]];
      const free = list.filter(
        ([x, y]) =>
          !boxes.some(
            (q) =>
              !q.dot &&
              !q.soft &&
              x > q.x - 4 &&
              x < q.x + q.w + 4 &&
              y > q.y - 4 &&
              y < q.y + q.h + 4,
          ),
      );
      // strict first (no leader passes under another label); then a leader may run beneath a label's solid ground
      // route lines are soft: avoided first, given up only if nothing else fits
      const modes = o.modes || [
        [false, true],
        [false, false],
        [true, true],
        [true, false],
      ];
      for (const [skip, strict] of modes)
        for (const [x, y] of free.length ? free : list) {
          const r = this.place1(x, y, w, hh, Object.assign({}, o, { strict, skip }));
          if (r) return r;
        }
      return null;
    },
    place1(
      ax,
      ay,
      w,
      hh,
      {
        centre = false,
        offMap = true,
        strict = true,
        skip = false,
        inner = null,
        dists = [14, 28, 44, 64, 90, 120, 160, 200, 250, 300, 360, 430, 510, 600],
      } = {},
    ) {
      let best = null;
      const tryBox = (b, d) => {
        const B = inner || bounds;
        if (b.x < B.x || b.y < B.y || b.x + b.w > B.x + B.w || b.y + b.h > B.y + B.h) return;
        if (boxes.some((q) => !(skip && q.soft) && overlaps(b, q, q.soft ? 2 : q.dot ? 8 : 14)))
          return;
        const nx = clamp(ax, b.x, b.x + b.w),
          ny = clamp(ay, b.y, b.y + b.h);
        const lead = d > 30 || Math.hypot(nx - ax, ny - ay) > 16 ? [ax, ay, nx, ny] : null;
        if (
          lead &&
          strict &&
          boxes.some(
            (q) =>
              !q.soft &&
              (q.dot
                ? Math.hypot(q.x + q.w / 2 - ax, q.y + q.h / 2 - ay) >= 4 &&
                  segDist(q.x + q.w / 2, q.y + q.h / 2, lead) < 12
                : segHits(
                    ax,
                    ay,
                    nx,
                    ny,
                    q.obst ? { x: q.x + 2, y: q.y + 2, w: q.w - 4, h: q.h - 4 } : grow(q, 5),
                  )),
          )
        )
          return;
        if (lead && strict && crossesRoute(lead)) return;
        if (
          strict &&
          leaders.some((l) => segHits(l[0], l[1], l[2], l[3], b) || (lead && segNear(l, lead)))
        )
          return;
        const onMap = overlaps(b, frame, -6);
        const cost =
          d + (onMap ? (offMap ? 70 : 0) + (onLand(b.x + b.w / 2, b.y + b.h / 2) ? 40 : 0) : 0);
        if (!best || cost < best.cost) best = { cost, b, lead };
      };
      if (centre) tryBox({ x: ax - w / 2, y: ay - hh / 2, w, h: hh }, 0);
      for (const d of dists)
        for (const a of ANG) {
          const px = ax + Math.cos(a) * d,
            py = ay + Math.sin(a) * d;
          const c = Math.cos(a),
            s = Math.sin(a);
          tryBox(
            {
              x: c > 0.3 ? px : c < -0.3 ? px - w : px - w / 2,
              y: s > 0.3 ? py : s < -0.3 ? py - hh : py - hh / 2,
              w,
              h: hh,
            },
            d,
          );
        }
      if (!best) return null;
      best.b.placed = true;
      boxes.push(best.b);
      if (best.lead) leaders.push(best.lead);
      return Object.assign({}, best.b, { lead: best.lead });
    },
  };
}

/* ------------------------------------------------------------------ render */
const fx = (q) => q[0].toFixed(1) + " " + q[1].toFixed(1);
const straightD = (ring) => "M" + ring.map(fx).join(" L") + " Z";
// coastlines as smooth curves through the kit's own points (Catmull-Rom): the same places, no corners
function smoothD(ring) {
  const n = ring.length;
  let d = "M" + fx(ring[0]);
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n],
      p1 = ring[i],
      p2 = ring[(i + 1) % n],
      p3 = ring[(i + 2) % n];
    d += ` C${fx([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${fx([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${fx(p2)}`;
  }
  return d + " Z";
}
const CARD = "ts-cap",
  LH = 32;
// kit coast point -> real points in its place, so the Channel reads at close zoom
const COAST_DETAIL = [
  [
    [1.4, 51.15],
    [
      [1.18, 51.07],
      [1.32, 51.12],
      [1.38, 51.16],
    ],
  ],
  [
    [1.6, 50.9],
    [
      [1.57, 50.74],
      [1.59, 50.87],
      [1.85, 50.97],
      [2.2, 51.03],
    ],
  ],
];

// When the summary key can't hold every word beside the map, the map is drawn smaller and the slide laid out again.
const RETRY = {};
export function render(root, P, ctx) {
  const fs = [1, 0.82, 0.68];
  for (const f of fs) {
    const mark = root.childNodes.length,
      warns = [];
    const c2 = Object.create(ctx);
    c2.warn = (m) => warns.push(m);
    const out = renderAt(root, P, c2, f, f === fs[fs.length - 1]);
    if (out !== RETRY) {
      warns.forEach((m) => ctx.warn(m));
      return out;
    }
    while (root.childNodes.length > mark) root.lastChild.remove();
  }
}
function renderAt(root, P, ctx, f, last) {
  const { M } = plan(P);
  const b = ctx.b,
    N = ctx.N;
  const bi = (k) => b[k] ?? 0;
  const V = M.V;
  const box = mapBox(P.region, f);
  let column = !!box.column;
  const columnMap = column;
  const map = basemap(root, V.kit, { box, view: V.view || undefined, a: { s: bi("map") } });
  const F = map.frame;
  const proj = (ll) => map.proj(ll[0], ll[1]);
  // one calm land colour; in Night the land is lifted off the dark sea
  const landFill =
    ctx.name === "night" ? "color-mix(in oklab,var(--paper) 72%,var(--ink) 28%)" : "var(--paper)";
  {
    const R = { x: F.x - 24, y: F.y - 24, w: F.w + 48, h: F.h + 48 };
    let landD = map.land.getAttribute("d");
    // the Strait of Dover in finer detail (Folkestone, Dover, South Foreland; Boulogne, Cap Gris-Nez, Calais)
    for (const [kit, fine] of COAST_DETAIL)
      landD = landD.replace(fx(proj(kit)), fine.map((q) => fx(proj(q))).join(" L"));
    const rings = clipRings(landD, R);
    const dAll = rings.map(smoothD).join(" ");
    // one element per ring: drawn as a single path, the browser left holes in the zoomed-in continent
    for (const r of rings)
      map.inner.insertBefore(
        h("path", {
          d: smoothD(r),
          fill: landFill,
          stroke: "var(--ink-3)",
          "stroke-width": "var(--sw-hair)",
          "stroke-linejoin": "round",
        }),
        map.land,
      );
    map.land.setAttribute("d", dAll);
    map.land.setAttribute("visibility", "hidden");
    for (const lk of [...map.inner.children].filter(
      (e) =>
        e.tagName === "path" &&
        e !== map.land &&
        /sky-top/.test(e.getAttribute("fill") || e.getAttribute("style") || ""),
    ))
      lk.setAttribute("d", clipRings(lk.getAttribute("d"), R).map(straightD).join(" ") || "M0 0");
    const cp = map.g.querySelector('clipPath[id$="-land"] path');
    if (cp) cp.setAttribute("d", dAll);
  }
  let onLand = () => false;
  try {
    const pt = new DOMPoint(0, 0);
    onLand = (x, y) => {
      pt.x = x;
      pt.y = y;
      return map.land.isPointInFill(pt);
    };
  } catch (e) {
    /* no hit test: no preference */
  }

  /* territories (a calm wash with a strong edge), then today's borders, then routes: inside the frame */
  const terrG = h("g", {}, map.inner);
  for (const t of M.terrs)
    if (t.poly.length >= 3) {
      const tg = territory(terrG, t.poly.map(proj), t.col, {
        clip: map.landClip,
        hatch: t.hatch,
        a: { s: bi(`terr:${t.i}`) },
      });
      const wash = tg.g.querySelector("path[fill-opacity]");
      if (wash) wash.setAttribute("fill-opacity", t.hatch ? 0.3 : 0.4);
    }
  if (M.borders) todayBorders(root, map, { a: { s: bi("today") } });
  const routeInfo = [],
    lineBoxes = [],
    routeSegs = [];
  for (const r of M.routes) {
    const k = bi(`route:${r.i}`);
    const col = `var(--era-${r.col}-text)`;
    let pts = r.pts.map((p) => proj(p.ll));
    // a space journey arcs up and peaks inside the frame (it is clipped there, never drawn over the title)
    if (r.space) {
      const [a, z] = [pts[0], pts[pts.length - 1]];
      const top = F.y + 36;
      pts = [a, [(a[0] + z[0]) / 2, 2 * top - (a[1] + z[1]) / 2], z];
    }
    // one focal journey per build: earlier ones step back to a faint trace until the summary
    // a journey that starts and ends at one place (validate warns) marks only the place: no line to draw
    if (
      !r.space &&
      Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < 2 &&
      pts.length === 2
    ) {
      routeInfo.push({ r, k, col, anchor: [pts[0]] });
      continue;
    }
    const rt = route(map.inner, pts, {
      col,
      s: k,
      head: 18,
      a: k + 1 < N ? { c: `${k + 1}-${N}:quiet` } : {},
    });
    const tmp = h("path", { d: rt.d }, root);
    const L = tmp.getTotalLength();
    {
      const [ex, ey] = pts[pts.length - 1];
      lineBoxes.push({ x: ex - 14, y: ey - 14, w: 28, h: 28, soft: true });
    }
    const at = (u) => {
      const q = tmp.getPointAtLength(L * u);
      return [q.x, q.y];
    };
    {
      let prev = at(0);
      for (let u = 0.03; u < 1.015; u += 0.03) {
        const [x, y] = at(Math.min(u, 1));
        if (u < 1) lineBoxes.push({ x: x - 5, y: y - 5, w: 10, h: 10, soft: true });
        routeSegs.push([prev[0], prev[1], x, y]);
        prev = [x, y];
      }
    }
    const anchors = (
      r.space
        ? [0.14, 0.18, 0.1, 0.22, 0.06, 0.86, 0.9, 0.8, 0.94]
        : [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]
    )
      .map(at)
      .filter((q) => q[1] > F.y + 10 && q[0] > F.x + 4 && q[0] < F.x + F.w - 4);
    tmp.remove();
    routeInfo.push({ r, k, col, anchor: anchors.length ? anchors : [pts[0]] });
  }

  /* obstacles: title, the date span, the north arrow, the scale bar, every dot, every route line */
  const obstacles = [...lineBoxes];
  const titleW = P.title ? measure(root, P.title, "ts-title") : 0;
  if (P.title) obstacles.push({ x: GRID.left, y: 30, w: titleW + 8, h: 64 });
  const spanText = `${M.dl(M.from)} to ${M.dl(M.to)}`;
  const spanW = measure(root, spanText, "ts-small", { cls: "strong" });
  // the span sits beside the title; a long title pushes it to the line below, right-aligned above the map
  if (GRID.left + titleW + 48 + spanW <= GRID.right) {
    computed(
      T(root, GRID.right, GRID.titleY, spanText, "ts-small", {
        "text-anchor": "end",
        cls: "strong",
        s: bi("map"),
      }),
      "dateRange.from",
    );
    obstacles.push({ x: GRID.right - spanW, y: 50, w: spanW, h: 40 });
  } else if (titleW <= GRID.right - GRID.left) {
    computed(
      T(root, GRID.right, GRID.subY + 4, spanText, "ts-small", {
        "text-anchor": "end",
        cls: "strong",
        s: bi("map"),
      }),
      "dateRange.from",
    );
    obstacles.push({ x: GRID.right - spanW, y: 94, w: spanW, h: 30 });
  } else
    ctx.warn(
      `The title is too long to leave room for the years “${spanText}”. They are still in the caption.`,
    );
  const sideR = GRID.right - (F.x + F.w);
  /* pins: every place a journey starts or ends at, or an event happens at */
  const pins = new Map();
  // places that share a spot at this scale (London and the River Thames) share one dot and one label
  const addPin = (p, k, ev) => {
    const xy = proj(p.ll);
    const cur =
      pins.get(p.name) ||
      [...pins.values()].find((q) => Math.hypot(q.xy[0] - xy[0], q.xy[1] - xy[1]) < 12);
    if (!cur) return pins.set(p.name, { p, ps: [p], k, ev, xy });
    if (!cur.ps.some((q) => q.name === p.name)) cur.ps.push(p);
    cur.k = Math.min(cur.k, k);
    cur.ev = cur.ev || ev;
  };
  for (const ri of routeInfo) {
    addPin(ri.r.a, ri.k);
    addPin(ri.r.b, ri.k);
  }
  for (const e of M.events) addPin(e.p, bi(`ev:${e.i}`), true);
  const dotBoxes = [...pins.values()].map((pn) => ({
    x: pn.xy[0] - 11,
    y: pn.xy[1] - 11,
    w: 22,
    h: 22,
    dot: true,
  }));
  obstacles.push(...dotBoxes);

  if (P.north !== false) {
    // with a callout column the arrow sits in the map's top-left corner (open sea on every British view)
    const nx = column ? F.x + 40 : sideR >= 110 ? F.x + F.w + 52 : F.x + F.w - 40,
      ny = F.y + 70;
    const g = h("g", { s: bi("map") }, root);
    h(
      "path",
      {
        d: `M${nx} ${ny - 26} L${nx + 13} ${ny + 14} L${nx} ${ny + 6} L${nx - 13} ${ny + 14} Z`,
        fill: "var(--ink)",
        stroke: "var(--paper)",
        "stroke-width": "var(--sw-hair)",
        "stroke-linejoin": "round",
      },
      g,
    );
    // the letter sits on its halo; a longer word wraps above the arrow on a solid ground, kept inside the grid
    const word = txt(P, "label:north", "N");
    const NW = 240;
    const probeN = (cls, lh) => {
      const g0 = h("g", {}, root);
      const tb = textBlock(g0, 0, 0, word, {
        cls,
        maxW: NW,
        maxLines: 4,
        lh,
        a: { cls: "strong" },
      });
      g0.remove();
      return tb;
    };
    let tb0 = probeN("ts-label", 30);
    const multi = tb0.lines.length > 1;
    if (multi) tb0 = probeN(CARD, 28);
    const bw = tb0.w,
      bh = tb0.lines.length * tb0.lh,
      one = tb0.lines.length === 1;
    // one line sits above the arrow; more lines run down beside it (above would reach the title)
    const right = nx + 26 + bw + 8 <= GRID.right;
    const cx = one
      ? clamp(nx, GRID.left + bw / 2 + 8, GRID.right - bw / 2 - 8)
      : right
        ? nx + 26 + bw / 2
        : nx - 26 - bw / 2;
    const base = one ? ny - 34 : ny - 18;
    const gb = { x: cx - bw / 2 - 8, y: base - 26, w: bw + 16, h: bh + 12 };
    if (bw > 40) labelGround(g, gb);
    textBlock(g, cx, base, word, {
      cls: multi ? CARD : "ts-label halo",
      maxW: NW,
      maxLines: 4,
      lh: multi ? 28 : 30,
      anchor: "middle",
      a: { cls: "strong" },
      edit: "text.label:north",
    });
    const ab = { x: nx - 24, y: ny - 64, w: 48, h: 84 };
    const x0 = Math.min(ab.x, gb.x),
      y0 = Math.min(ab.y, gb.y);
    obstacles.push({
      x: x0,
      y: y0,
      w: Math.max(ab.x + ab.w, gb.x + gb.w) - x0,
      h: Math.max(ab.y + ab.h, gb.y + gb.h) - y0,
    });
  }
  let scale = null;
  const leads = [];
  if (P.scaleBar !== false && P.region !== "world") {
    const raw = 150 * map.kmPerUnit;
    const NICE = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const km = NICE.reduce(
      (a, c) => (Math.abs(Math.log(c / raw)) < Math.abs(Math.log(a / raw)) ? c : a),
      NICE[0],
    );
    const w = km / map.kmPerUnit;
    // the bar takes the first map corner clear of every pin, route line and the north arrow
    const bx = (sx, sy) => ({ x: sx - 24, y: sy - 18, w: w + 48 + 90, h: 66 });
    const spots = [
      [F.x + 32, F.y + F.h - 48],
      [F.x + F.w - w - 120, F.y + F.h - 48],
      [F.x + 32, F.y + 60],
      [F.x + F.w - w - 120, F.y + 60],
    ];
    const spot = spots.find(([sx, sy]) => {
      const q = bx(sx, sy);
      return !obstacles.some((o) => overlaps(q, o, 0));
    });
    // the corner is held while labels are placed; it is checked again against every label and leader before drawing
    scale = { km, bx, spots, spot, box: spot ? bx(...spot) : null };
    if (scale.box) obstacles.push(scale.box);
  }

  const PL = placer(
    column
      ? { x: F.x, y: F.y, w: F.w + 52, h: F.h }
      : { x: GRID.left, y: 120, w: GRID.right - GRID.left, h: 530 },
    obstacles,
    onLand,
    F,
    routeSegs,
  );
  const dotsG = h("g", {}, root),
    leadG = h("g", {}, root),
    labG = h("g", {}, root);
  const fail = (what) => ctx.warn(`No room on the map for ${what}.`);

  /* callout cards: journeys, events, areas and the borders key. Each shows at its own build (no ghosts)
     and again in the summary. Beside a narrow map they sit in a column, joined by a leader line only. */
  const colX = F.x + F.w + 76,
    MW0 = column ? Math.min(520, GRID.right - colX - 34) : 340,
    maxW = MW0;
  // a size may carry its own width (the two-column key)
  // every wording in a card is a measured text block: it wraps, then shrinks, and the card grows to hold it.
  // Cards are made at a size: the normal card size, or the kit's minimum for a crowded summary column.
  const SZ = { cls: CARD, lh: LH, pad: 24, base: 38 },
    TINY = { cls: "ts-tiny", lh: 26, pad: 20, base: 32 };
  const probe = (s, o, z = SZ) => {
    const tmp = h("g", {}, root);
    const tb = textBlock(
      tmp,
      0,
      0,
      s,
      Object.assign({ cls: z.cls, maxW: z.maxW || MW0, lh: z.lh }, o),
    );
    tmp.remove();
    return tb;
  };
  const chip = (z, tcol, date, datePath, who, whoPath, label, labelPath) => {
    const maxW = z.maxW || MW0;
    const dw = measure(root, date, z.cls, { cls: "strong" }),
      ww = who ? measure(root, who, z.cls, { cls: "strong" }) : 0;
    const one = !who || dw + 10 + ww <= maxW;
    const wb = who && !one ? probe(who, { maxLines: 3, a: { cls: "strong" } }, z) : null;
    const tb = label ? probe(label, { maxLines: 4 }, z) : null;
    const whoH = wb ? wb.lines.length * wb.lh : 0;
    const head = one ? dw + (who ? 10 + ww : 0) : Math.max(dw, wb.w);
    return {
      w: Math.max(head, tb ? tb.w : 0) + 34,
      h: z.pad + z.lh + whoH + (tb ? tb.lines.length * tb.lh : 0),
      body: (g, pl) => {
        const x0 = pl.x + 20,
          y1 = pl.y + z.base;
        editable(T(g, x0, y1, date, z.cls, { fill: tcol, cls: "strong" }), datePath);
        if (who) {
          if (one)
            editable(
              T(g, x0 + dw + 10, y1, who, z.cls, { fill: "var(--ink)", cls: "strong" }),
              whoPath,
            );
          else
            textBlock(g, x0, y1 + z.lh, who, {
              cls: z.cls,
              maxW,
              maxLines: 3,
              lh: z.lh,
              a: { fill: "var(--ink)", cls: "strong" },
              edit: whoPath,
            });
        }
        if (label)
          textBlock(g, x0, y1 + z.lh + whoH, label, {
            cls: z.cls,
            maxW,
            maxLines: 4,
            lh: z.lh,
            a: { fill: "var(--ink-2)" },
            edit: labelPath,
          });
      },
    };
  };
  const cards = [];
  for (const ri of routeInfo) {
    const r = ri.r;
    const date = M.dl(r.d);
    const mk = (z, lab) =>
      chip(
        z,
        ri.col,
        date,
        `routes.${r.i}.date`,
        r.who,
        `routes.${r.i}.who`,
        lab ? r.label || "" : "",
        lab ? `routes.${r.i}.label` : null,
      );
    cards.push(
      Object.assign(
        {
          what: `the journey “${r.who}”`,
          k: ri.k,
          bar: ri.col,
          anchors: ri.anchor,
          tiny: mk(TINY, true),
          make: (z) => mk(z, true),
        },
        mk(SZ, true),
      ),
    );
  }
  for (const e of M.events) {
    const date = M.dl(e.d);
    const pk = `label:place:${e.p.name}`;
    const mk = (z, at) =>
      chip(
        z,
        "var(--event-text)",
        date,
        `events.${e.i}.date`,
        at ? txt(P, pk, e.p.name) : "",
        at ? `text.${pk}` : null,
        e.label,
        `events.${e.i}.label`,
      );
    cards.push(
      Object.assign(
        {
          what: `the event “${e.label}”`,
          k: bi(`ev:${e.i}`),
          bar: "var(--event)",
          anchors: [proj(e.p.ll)],
          tiny: mk(TINY),
          named: { full: mk(SZ, true), tiny: mk(TINY, true) },
          make: (z) => mk(z, true),
        },
        mk(SZ),
      ),
    );
  }
  for (const t of M.terrs) {
    if (!t.at) continue;
    const date = M.dl(t.d);
    const tcol = `var(--era-${t.col}-text)`;
    const mk = (z) => {
      const maxW = z.maxW || MW0;
      const nb = probe(t.name, { maxLines: 2, a: { cls: "strong" } }, z),
        dw = measure(root, date, z.cls);
      const nl = nb.lines.length,
        nh = nl * nb.lh;
      const nw = nb.w;
      const one = nl === 1 && nw + 12 + dw <= maxW;
      return {
        w: (one ? nw + 12 + dw : Math.max(nw, dw)) + 34,
        h: z.pad + nh + (one ? 0 : z.lh),
        body: (g, pl) => {
          textBlock(g, pl.x + 20, pl.y + z.base, t.name, {
            cls: z.cls,
            maxW,
            maxLines: 2,
            lh: z.lh,
            a: { fill: tcol, cls: "strong" },
            edit: `territories.${t.i}.label`,
          });
          const dEl = T(
            g,
            one ? pl.x + 32 + nw : pl.x + 20,
            one ? pl.y + z.base : pl.y + z.base + nh,
            date,
            z.cls,
            { fill: "var(--ink-2)" },
          );
          if (t.custom) editable(dEl, `territories.${t.i}.date`);
          else computed(dEl, `territories.${t.i}.area`);
        },
      };
    };
    const near = column
      ? [proj(t.at)]
      : [
          [0, 0],
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
          [-1, -1],
          [1, 1],
          [0, -2],
          [0, 2],
        ].map(([a, c]) => proj([t.at[0] + a, t.at[1] + c]));
    cards.push(
      Object.assign(
        {
          what: `the area “${t.name}”`,
          k: bi(`terr:${t.i}`),
          bar: tcol,
          anchors: near,
          opt: { centre: true, offMap: false },
          tiny: mk(TINY),
          make: mk,
        },
        mk(SZ),
      ),
    );
  }
  if (M.borders) {
    const label = txt(P, "label:today", "Dashed lines: borders today");
    const mk = (z) => {
      const maxW = z.maxW || MW0;
      const lb = probe(label, { maxLines: 4 }, z);
      return {
        w: lb.w + 34,
        h: z.pad + lb.lines.length * lb.lh,
        body: (g, pl) =>
          textBlock(g, pl.x + 20, pl.y + z.base, label, {
            cls: z.cls,
            maxW,
            maxLines: 4,
            lh: z.lh,
            a: { fill: "var(--ink)" },
            edit: "text.label:today",
          }),
      };
    };
    cards.push(
      Object.assign(
        {
          what: "the borders key",
          k: bi("today"),
          bar: "var(--ink-3)",
          anchors: [
            [-2.6, 55.15],
            [-3.0, 53.1],
            [-3.1, 52.3],
          ].map((q) => map.proj(q[0], q[1])),
          ordered: true,
          tiny: mk(TINY),
          make: mk,
        },
        mk(SZ),
      ),
    );
  }

  // place names: one name per dot, closest to its dot, never on a line, a leader or another label.
  // A dot with neighbours close by always gets its own leader, so every name points at exactly one dot.
  // The most crowded dots are named first, while there is still room beside them.
  for (const pn of pins.values())
    h(
      "circle",
      {
        cx: pn.xy[0],
        cy: pn.xy[1],
        r: pn.ev ? 9 : 7,
        fill: pn.ev ? "var(--event)" : "var(--ink)",
        stroke: "var(--paper)",
        "stroke-width": "var(--sw-rule)",
        s: pn.k,
        cls: "pop",
      },
      dotsG,
    );
  const inner = { x: F.x, y: F.y, w: F.w, h: F.h };
  const all = [...pins.values()];
  const crowd = (pn) =>
    all.filter((q) => q !== pn && Math.hypot(q.xy[0] - pn.xy[0], q.xy[1] - pn.xy[1]) < 60).length;
  const order2 = all
    .map((pn) => ({ pn, c: crowd(pn) }))
    .sort((p, q) => q.c - p.c || p.pn.k - q.pn.k)
    .map((o) => o.pn);
  const crowdedNames = [];
  const SHAPES = [
    { cls: CARD, maxW: 260, lh: 28 },
    { cls: CARD, maxW: 170, lh: 28 },
    { cls: "ts-tiny", maxW: 200, lh: 24 },
  ];
  // a shared dot's label holds each place's name on its own line(s), each editable on its own
  const namesOf = (pn) => pn.ps.map((p) => txt(P, `label:place:${p.name}`, p.name));
  const shapeOf = (pn, z) => {
    const pbs = namesOf(pn).map((label) =>
      probe(label, { maxW: z.maxW, maxLines: 4, lh: z.lh }, { cls: z.cls, lh: z.lh }),
    );
    const nl = pbs.reduce((t, pb) => t + pb.lines.length, 0);
    return Object.assign({}, z, {
      pbs,
      w: Math.max(...pbs.map((pb) => pb.w)) + 18,
      h: 38 + (nl - 1) * z.lh,
    });
  };
  const nameOf = (pn) => namesOf(pn).join(" and ");
  const drawName = (pn, pl, nz) => {
    if (pl.lead) {
      leads.push(pl.lead);
      h(
        "line",
        {
          x1: pl.lead[0],
          y1: pl.lead[1],
          x2: pl.lead[2],
          y2: pl.lead[3],
          stroke: "var(--ink-3)",
          "stroke-width": "var(--sw-rule)",
          s: pn.k,
          cls: "rise",
        },
        leadG,
      );
    }
    const g = h("g", { s: pn.k, cls: "rise" }, labG);
    labelGround(g, { x: pl.x, y: pl.y, w: pl.w, h: pl.h });
    let y = pl.y + 27;
    namesOf(pn).forEach((label, i) => {
      const tb = textBlock(g, pl.x + 9, y, label, {
        cls: nz.cls,
        maxW: nz.maxW,
        maxLines: 4,
        lh: nz.lh,
        a: { fill: "var(--ink)" },
        edit: `text.label:place:${pn.ps[i].name}`,
      });
      y += tb.lines.length * nz.lh;
    });
  };
  const routeCross = (l, skip) =>
    routeSegs.some((r) => {
      if (skip && skip(r)) return false;
      const q = segAt(l, r);
      return q && Math.hypot(q[0] - l[0], q[1] - l[1]) > 12;
    });
  // Dots too close to name one at a time (a far-out map) get a fan: their names stand in one column beside
  // the group, in the order that keeps every leader clear of the others, each with its own line to its own dot.
  const clustersAt = (thr) => {
    const clusters = [];
    for (const pn of all) {
      const c0 = clusters.filter((c) =>
        c.some((q) => Math.hypot(q.xy[0] - pn.xy[0], q.xy[1] - pn.xy[1]) < thr),
      );
      const merged = [pn, ...c0.flat()];
      c0.forEach((c) => clusters.splice(clusters.indexOf(c), 1));
      clusters.push(merged);
    }
    return clusters
      .filter((c) => c.length > 1 && c.length <= 8)
      .sort((p, q) => q.length - p.length);
  };
  let clusters = clustersAt(64);
  const perms = (a) =>
    a.length <= 1
      ? [a]
      : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]));
  const fan = (cl, strict) => {
    const xs = cl.map((p) => p.xy[0]),
      ys = cl.map((p) => p.xy[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      cy = ys.reduce((t, y) => t + y, 0) / ys.length;
    const bb = {
      x: minX - 20,
      y: Math.min(...ys) - 20,
      w: maxX - minX + 40,
      h: Math.max(...ys) - Math.min(...ys) + 40,
    };
    const inBB = (r) =>
      [
        [r[0], r[1]],
        [r[2], r[3]],
      ].every(([x, y]) => x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h);
    const byY = cl.slice().sort((p, q) => p.xy[1] - q.xy[1] || p.xy[0] - q.xy[0]);
    const orders = cl.length <= 5 ? [byY, ...perms(byY).slice(1)] : [byY];
    // one column on either side; else the western dots' names to the west and the eastern ones' to the east
    const mx = xs.reduce((t, x) => t + x, 0) / xs.length;
    const west = byY.filter((p) => p.xy[0] <= mx),
      east = byY.filter((p) => p.xy[0] > mx);
    const column = (items, side, gap, B, sh) => {
      const H = items.reduce((t, pn) => t + sh.get(pn).h, 0) + 8 * (items.length - 1),
        W = Math.max(...items.map((pn) => sh.get(pn).w));
      const ex = items.map((p) => p.xy[0]);
      const x = side > 0 ? Math.max(...ex) + gap : Math.min(...ex) - gap - W;
      if (x < B.x || x + W > B.x + B.w || H > B.h) return null;
      const cy0 = items.reduce((t, p) => t + p.xy[1], 0) / items.length;
      let y = clamp(cy0 - H / 2, B.y, B.y + B.h - H);
      const out = [];
      for (const pn of items) {
        const s0 = sh.get(pn);
        const bx = { x: side > 0 ? x : x + W - s0.w, y, w: s0.w, h: s0.h };
        out.push({
          pn,
          s0,
          b: bx,
          lead: [pn.xy[0], pn.xy[1], side > 0 ? bx.x : bx.x + bx.w, y + s0.h / 2],
        });
        y += s0.h + 8;
      }
      return out;
    };
    const good = (out, strictRoutes) =>
      out.every(
        ({ pn, b: bx, lead }, i) =>
          !PL.boxes.some(
            (q) => (strictRoutes || !q.soft) && overlaps(bx, q, q.soft ? 2 : q.dot ? 6 : 10),
          ) &&
          !out.some((o, j) => j !== i && overlaps(bx, o.b, 4)) &&
          !PL.leaders.some((l) => segNear(l, lead) || segHits(l[0], l[1], l[2], l[3], bx)) &&
          !out.some(
            (o, j) =>
              j !== i &&
              (segNear(o.lead, lead) || segHits(lead[0], lead[1], lead[2], lead[3], grow(o.b, 4))),
          ) &&
          !PL.boxes.some(
            (q) =>
              !q.soft &&
              !q.dot &&
              segHits(
                lead[0],
                lead[1],
                lead[2],
                lead[3],
                q.obst ? { x: q.x + 2, y: q.y + 2, w: q.w - 4, h: q.h - 4 } : grow(q, 4),
              ),
          ) &&
          !all.some(
            (q) =>
              q !== pn &&
              Math.hypot(q.xy[0] - pn.xy[0], q.xy[1] - pn.xy[1]) > 8 &&
              segDist(q.xy[0], q.xy[1], lead) < (cl.includes(q) ? 6 : 12),
          ) &&
          !routeCross(lead, strictRoutes ? null : inBB),
      );
    for (const strictRoutes of [strict])
      for (const B of [inner, PL.bounds])
        for (const z of SHAPES)
          for (const gap of [40, 64, 96, 140, 190]) {
            const sh = new Map(cl.map((pn) => [pn, shapeOf(pn, z)]));
            const cands = [];
            for (const side of [1, -1])
              for (const ord of orders) cands.push(() => column(ord, side, gap, B, sh));
            if (west.length && east.length)
              cands.push(() => {
                const a = column(west, -1, gap, B, sh),
                  c = column(east, 1, gap, B, sh);
                return a && c ? [...a, ...c] : null;
              });
            for (const mk of cands) {
              const out = mk();
              if (out && good(out, strictRoutes)) {
                for (const o of out) {
                  o.b.placed = true;
                  PL.boxes.push(o.b);
                  PL.leaders.push(o.lead);
                }
                return out;
              }
            }
          }
    return null;
  };
  let fanned = new Set();
  // fans that keep every line off the routes; a fan whose lines may cross a route only if naming dot by dot can't do better
  const fanPass = (strict, mask = -1) => {
    const got = [];
    for (const [ci, cl] of clusters.entries()) {
      if (!((mask >> ci) & 1) || cl.some((pn) => fanned.has(pn))) continue;
      const out = fan(cl, strict);
      if (out)
        for (const o of out) {
          fanned.add(o.pn);
          got.push(o);
        }
    }
    return got;
  };
  const placeOne = (pn) => {
    const near = all.some(
      (q) => q !== pn && Math.hypot(q.xy[0] - pn.xy[0], q.xy[1] - pn.xy[1]) < 34,
    );
    // a long name tries a narrower block, then the kit's minimum size, before its leader may cross anything
    const shapes = SHAPES.map((z) => shapeOf(pn, z));
    const dists = near
      ? [36, 56, 90, 140, 200, 260, 330]
      : [12, 22, 36, 56, 90, 140, 200, 260, 330];
    // strict everywhere first (on the map, then anywhere on the slide), clear of every route line; a name over
    // a route line or a leader beneath a label's ground comes next; crossing a route or a leader only as a last resort, with a note
    for (const [B, mode] of [
      [inner, [false, true]],
      [null, [false, true]],
      [inner, [true, true]],
      [null, [true, true]],
      [null, [true, false]],
    ])
      for (const z of shapes) {
        const pl = PL.place(pn.xy[0], pn.xy[1], z.w, z.h, {
          offMap: false,
          inner: B,
          dists,
          modes: [mode],
        });
        if (pl) return { pn, pl, nz: z, loose: !mode[1], over: mode[0] };
      }
    return { pn, pl: null };
  };
  // names are placed one dot at a time; for a crowded group every order is tried, and the one that keeps
  // every line clear and every name closest to its dot wins
  const greedy = (order) => {
    let bad = 0,
      cost = 0;
    const res = order.map((pn) => {
      const r = placeOne(pn);
      if (!r.pl || r.loose) bad++;
      else {
        if (r.over) bad += 0.5;
        cost += Math.hypot(
          clamp(pn.xy[0], r.pl.x, r.pl.x + r.pl.w) - pn.xy[0],
          clamp(pn.xy[1], r.pl.y, r.pl.y + r.pl.h) - pn.xy[1],
        );
      }
      return r;
    });
    return { res, bad, cost, order };
  };
  const snap = () => [PL.boxes.length, PL.leaders.length],
    restore = ([nb, nl]) => {
      PL.boxes.length = nb;
      PL.leaders.length = nl;
    };
  const search = () => {
    const rest = order2.filter((pn) => !fanned.has(pn));
    const s0 = snap();
    const hot = rest.filter((pn) => crowd(pn) > 0),
      cold = rest.filter((pn) => crowd(pn) === 0);
    const orders = [
      rest,
      ...(hot.length > 1 && hot.length <= 4 ? perms(hot).map((o) => [...o, ...cold]) : []),
    ];
    let best = null;
    for (const o of orders) {
      const g = greedy(o);
      restore(s0);
      if (!best || g.bad < best.bad || (g.bad === best.bad && g.cost < best.cost - 1)) best = g;
      if (best.bad === 0 && o === rest && best.cost < 30 * rest.length) break;
    }
    return greedy(best.order);
  };
  // ways to name the dots, best first: every crowded group in a fan clear of the routes, then fewer fans (the rest
  // named dot by dot), then fans whose lines may cross a route. The first with every line and name clear wins;
  // otherwise the one with fewest crossings.
  // a name with no clear spot of its own may join a wider fan with its neighbours
  const pop = (m) => m.toString(2).replace(/0/g, "").length;
  const masks = (cl) => {
    const full = (1 << cl.length) - 1;
    return [...Array(full + 1).keys()].sort((p, q) => pop(q) - pop(p) || q - p).slice(0, 16);
  };
  const groups = [64, 110, 160].map(clustersAt);
  const ways = [
    ...groups.flatMap((g, gi) => (gi ? masks(g).slice(0, 4) : masks(g)).map((m) => [true, m, g])),
    [false, -1, groups[0]],
  ];
  const s00 = snap();
  let best = null;
  for (const [strict, mask, g] of ways) {
    restore(s00);
    fanned = new Set();
    clusters = g;
    const f = fanPass(strict, mask),
      p = search();
    const score = p.bad + (strict ? 0 : f.length);
    if (!best || score < best.score) best = { strict, mask, g, score };
    if (score === 0) break;
  }
  restore(s00);
  fanned = new Set();
  clusters = best.g;
  const fans = fanPass(best.strict, best.mask),
    pick = search(),
    fanCross = best.strict ? [] : fans.map((o) => nameOf(o.pn));
  for (const o of fans) drawName(o.pn, Object.assign({}, o.b, { lead: o.lead }), o.s0);
  crowdedNames.push(...fanCross);
  for (const r of pick.res) {
    const label = nameOf(r.pn);
    if (!r.pl) {
      fail(`the name “${label}”`);
      continue;
    }
    if (r.loose) crowdedNames.push(label);
    drawName(r.pn, r.pl, r.nz);
  }
  if (crowdedNames.length)
    ctx.warn(
      `At this map size the line to ${crowdedNames.map((n) => `“${n}”`).join(", ")} has to cross another line. Try a closer map.`,
    );
  let tier = 0,
    legend = null,
    named = false;
  if (column) {
    // stack the cards beside the map, each as close as it can be to the height of what it points at
    const top = F.y,
      bot = F.y + F.h,
      gap = 14;
    // each card points from the rightmost anchor whose leader to the column passes no label or the north arrow
    // names are placed first: a card's line also passes no name, no name's line and no journey's line
    const hard = PL.boxes.filter((o) => !o.soft);
    const clearOf = (x, y) => {
      const l = [x, y, colX, y];
      return (
        !PL.leaders.some((q) => segX(q, l)) &&
        !routeSegs.some((r) => {
          const q = segAt(l, r);
          return q && Math.hypot(q[0] - x, q[1] - y) > 12;
        })
      );
    };
    const away = (o, x, y) => !(o.dot && Math.hypot(o.x + o.w / 2 - x, o.y + o.h / 2 - y) < 6);
    for (const c of cards) {
      const byX = c.ordered ? c.anchors : c.anchors.slice().sort((p, q) => q[0] - p[0]);
      const q =
        byX.find(
          ([x, y]) =>
            clearOf(x, y) && !hard.some((o) => away(o, x, y) && segHits(x, y, colX, y, o)),
        ) ||
        byX.find(([x, y]) => !hard.some((o) => away(o, x, y) && segHits(x, y, colX, y, o))) ||
        byX.find(([x, y]) => !hard.some((o) => !o.dot && segHits(x, y, colX, y, o)));
      c.ax = (q || byX[0])[0];
      c.ay = (q || byX[0])[1];
      // no level line clears the north arrow or a label: the card names its place and draws no line
      if (!q) {
        c.blocked = true;
        if (c.named) Object.assign(c, c.named.full, { tiny: c.named.tiny });
      }
    }
    const order = cards.slice().sort((p, q) => p.ay - q.ay || p.k - q.k);
    // the summary shows every card at once: full if they fit, else journeys drop to their one-line head,
    // else every card drops to the kit's minimum text size; only then do the cards leave the column
    const V2 = (c, tier) =>
      named && c.named ? (tier === 2 ? c.named.tiny : c.named.full) : tier === 2 ? c.tiny : c;
    const stack = (tier) => {
      const H = (c) => V2(c, tier).h;
      let y = top;
      for (const c of order) {
        c.sy = Math.max(c.ay - H(c) / 2, y);
        y = c.sy + H(c) + gap;
      }
      let lim = bot;
      for (const c of order.slice().reverse()) {
        if (c.sy + H(c) > lim) c.sy = lim - H(c);
        lim = c.sy - gap;
      }
      return !order.length || order[0].sy >= top - 1;
    };
    tier = [0, 2].find(stack);
    // the summary joins each card to its mark only while the lines run level and clear of other dots;
    // otherwise (a far-out map, a crowded column) the lines would fan across the map, so they are left off
    // and each event card names its place instead (journeys and areas share their card's colour)
    const fans = () =>
      order.some((c) => {
        if (c.blocked) return false;
        const hh = V2(c, tier).h,
          ey = clamp(c.ay, c.sy + 14, c.sy + hh - 14);
        const l = [c.ax, c.ay, colX, ey];
        return (
          Math.abs(ey - c.ay) > 48 ||
          dotBoxes.some((o) => away(o, c.ax, c.ay) && segHits(c.ax, c.ay, colX, ey, o)) ||
          !clearOf(c.ax, c.ay) ||
          routeCross(l) ||
          PL.leaders.some((q) => segNear(q, l)) ||
          PL.boxes.some((q) => q.placed && segHits(l[0], l[1], l[2], l[3], q)) ||
          order.some(
            (d) =>
              d !== c &&
              segNear(l, [d.ax, d.ay, colX, clamp(d.ay, d.sy + 14, d.sy + V2(d, tier).h - 14)]),
          )
        );
      });
    if (tier != null && fans()) {
      named = true;
      order.sort((p, q) => p.k - q.k || p.ay - q.ay);
      tier = [0, 2].find(stack);
    } // without leaders the column reads in date order
    if (tier != null) for (const c of cards) c.S = V2(c, tier);
    else {
      // still too many: the summary becomes one key beside the map (rows at the minimum size, each with its colour bar);
      // every card keeps its own build, level with what it points at
      named = true;
      for (const c of cards) if (c.named) c.tiny = c.named.tiny;
      const byK = cards.slice().sort((p, q) => p.k - q.k);
      const kTop = MAPBOX.y,
        avail = MAPBOX.h;
      const rowsOf = (z) =>
        byK.map((c) => {
          const v = z ? c.make(z) : c.tiny;
          return { c, v, hh: v.h - 20 + 6 };
        });
      const r1 = rowsOf(null);
      const H1 = 10 + r1.reduce((a, r) => a + r.hh, 0);
      if (H1 <= avail)
        legend = {
          y: kTop + (avail - H1) / 2,
          w: Math.max(...r1.map((r) => r.v.w)),
          h: H1,
          cols: [r1],
          cw: 0,
        };
      else {
        // two columns side by side, still in date order (down the first, then the second)
        const cw = Math.floor((GRID.right - colX - 16) / 2);
        const r2 = rowsOf(Object.assign({}, TINY, { maxW: cw - 40 }));
        let best = null;
        for (let j = 1; j < r2.length; j++) {
          const a = r2.slice(0, j),
            c2 = r2.slice(j);
          const hh =
            10 +
            Math.max(
              a.reduce((t, r) => t + r.hh, 0),
              c2.reduce((t, r) => t + r.hh, 0),
            );
          if (!best || hh < best.h) best = { h: hh, cols: [a, c2] };
        }
        if (best && best.h <= avail)
          legend = {
            y: kTop + (avail - best.h) / 2,
            w: cw + 16 + Math.max(...best.cols[1].map((r) => r.v.w)),
            h: best.h,
            cols: best.cols,
            cw: cw + 16,
          };
      }
      if (!legend) {
        if (!last) return RETRY;
        column = false;
      }
    }
  }
  if (column) {
    const top = F.y,
      bot = F.y + F.h;
    const lead = (c, y, hh) => {
      const l = [c.ax, c.ay, colX, clamp(c.ay, y + 14, y + hh - 14)];
      PL.leader(l);
      leads.push(l);
      return l;
    };
    for (const c of cards) {
      // on its own build a card sits level with what it points at
      const y = clamp(c.ay - c.h / 2, top, bot - c.h);
      c.pl = { x: colX, y, w: c.w, h: c.h };
      c.lead = c.blocked ? null : lead(c, y, c.h);
      if (legend) continue;
      const S = c.S;
      c.sum = { pl: { x: colX, y: c.sy, w: S.w, h: S.h }, body: S.body };
      c.sum.lead = named || c.blocked ? null : lead(c, c.sy, S.h);
    }
  }

  // a column that can't hold every card hands them to the placer, which may use the whole slide
  const PC =
    column || !columnMap
      ? PL
      : placer(
          { x: GRID.left, y: 120, w: GRID.right - GRID.left, h: 530 },
          PL.boxes,
          onLand,
          F,
          routeSegs,
          PL.leaders,
        );
  if (!column)
    for (const c of cards) {
      const tries = [
        [c, [[false, true]]],
        [c.tiny, [[false, true]]],
        [c, [[true, true]]],
        [
          c.tiny,
          [
            [true, true],
            [false, false],
            [true, false],
          ],
        ],
      ];
      let pl = null;
      for (const [z, modes] of tries) {
        pl = PC.place(c.anchors, null, z.w, z.h, Object.assign({}, c.opt || {}, { modes }));
        if (pl) {
          if (z !== c) {
            c.body = z.body;
            c.w = z.w;
            c.h = z.h;
          }
          break;
        }
      }
      if (!pl) {
        fail(c.what);
        continue;
      }
      c.pl = pl;
      c.lead = pl.lead;
      if (pl.lead) leads.push(pl.lead);
    }
  if (scale) {
    // the bar goes in a corner clear of every label, card and leader line, or is left off with a note
    const held = [
      ...PL.boxes,
      ...cards.flatMap((c) => [c.pl, c.sum && c.sum.pl]).filter(Boolean),
    ].filter((q) => q !== scale.box);
    if (legend) held.push({ x: colX, y: legend.y, w: legend.w, h: legend.h });
    const clear = (q) =>
      !held.some((o) => overlaps(q, o, 0)) &&
      !leads.some((l) => segHits(l[0], l[1], l[2], l[3], q));
    const spot = [scale.spot, ...scale.spots].filter(Boolean).find((sp) => clear(scale.bx(...sp)));
    if (spot) {
      const sb = scaleBar(root, spot[0], spot[1], {
        km: scale.km,
        map,
        computedPath: "region",
        a: { s: bi("map") },
      });
      for (const t of sb.g.querySelectorAll("text"))
        t.setAttribute("class", (t.getAttribute("class") || "").replace("ts-axis", "ts-cap"));
    } else
      ctx.warn(
        "No clear corner for the scale bar, so it is left off. Turn off “Show a scale bar” to hide this note.",
      );
  }
  const copyEls = [];
  for (const c of cards) {
    if (!c.pl) continue;
    // the summary copy first (so a click on the slide's text finds the one on show), then the build's own
    const sum = c.sum || { pl: c.pl, lead: c.lead, body: c.body },
      own = { pl: c.pl, lead: c.lead, body: c.body };
    const ownA = { s: c.k, hide: c.k + 1 < N ? c.k + 1 : N, cls: "rise" };
    const copies = legend
      ? [[ownA, own]]
      : [
          [{ s: N }, sum],
          [ownA, own],
        ];
    for (const [a, v] of copies) {
      if (v.lead)
        h(
          "line",
          Object.assign(
            {
              x1: v.lead[0],
              y1: v.lead[1],
              x2: v.lead[2],
              y2: v.lead[3],
              stroke: "var(--ink-3)",
              "stroke-width": "var(--sw-rule)",
            },
            a,
          ),
          leadG,
        );
      if (v.lead)
        h(
          "circle",
          Object.assign({ cx: v.lead[0], cy: v.lead[1], r: 4, fill: "var(--ink-3)" }, a),
          leadG,
        );
      const g = h("g", a, labG);
      labelGround(g, v.pl);
      copyEls.push({ g, s: a.s, hide: a.hide });
      h(
        "rect",
        { x: v.pl.x, y: v.pl.y, width: 6, height: v.pl.h, fill: c.bar, rx: "var(--r-mark)" },
        g,
      );
      v.body(g, v.pl);
    }
  }
  if (legend) {
    const g = h("g", { s: N }, labG);
    labelGround(g, { x: colX, y: legend.y, w: legend.w, h: legend.h });
    copyEls.push({ g, s: N });
    legend.cols.forEach((rows, ci) => {
      const x = colX + ci * legend.cw;
      let y = legend.y + 6;
      for (const { c, v, hh } of rows) {
        h("rect", { x, y: y + 2, width: 6, height: hh - 10, fill: c.bar, rx: "var(--r-mark)" }, g);
        v.body(g, { x, y: y - 8 });
        y += hh;
      }
    });
  }
  // a card's other copy shares its spot while faded out: it must not catch the teacher's click
  const live = (k) => {
    for (const e of copyEls) {
      const on = k >= e.s && (e.hide == null || k < e.hide);
      if (on) e.g.removeAttribute("pointer-events");
      else e.g.setAttribute("pointer-events", "none");
    }
  };
  live(N);
  return { onStep: live, still: () => live(N) };
}

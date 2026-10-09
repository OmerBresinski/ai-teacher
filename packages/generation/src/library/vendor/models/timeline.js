// Timeline: any date range (BC/AD with no year 0, BCE/CE, or plain years), eras as bands,
// events as flags, an optional zoom inset into any section (its own build), optional
// "how long between" brackets computed in code, optional generic scenery per era.
// The reference model for the library: built only on the kit.
import {
  bracket,
  CULTURES,
  clamp,
  computed,
  durationLabel,
  editable,
  eIO,
  fmtInt,
  formatYear,
  GRID,
  ground,
  h,
  hills,
  knock,
  labelGround,
  lanePlace,
  lines,
  measure,
  object,
  overlaps,
  parseDate,
  placeFlags,
  result,
  scale,
  sceneryFor,
  schemaCheck,
  sky,
  T,
  TEXT_PARAM,
  TITLE_PARAM,
  textBlock,
  timeTicks,
  txt,
  withDefaults,
  zoomInset,
} from "../kit/index.js";

export const meta = {
  id: "timeline",
  name: "Timeline",
  kind: "info",
  version: 1,
  subjects: ["History", "RE", "Geography", "Science", "Music", "Art"],
  years: ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "KS3", "KS4"],
  teaches:
    "When things happened and how long between them: chronology, periods, BC and AD, and the scale of time.",
};

const ERA_COLOURS = ["auto", "1", "2", "3", "4", "5", "6"];
const CULTURE_LABELS = [
  "None (plain land)",
  "Old Stone Age / Middle Stone Age",
  "New Stone Age",
  "Bronze Age",
  "Iron Age",
  "Ancient Egypt",
  "Ancient Greece",
  "Early Rome",
  "Roman",
  "Anglo-Saxon",
  "Medieval",
  "Tudor",
  "Victorian",
  "Modern",
  "Desert",
];
const DATE = {
  type: "string",
  title: "Date",
  description: "Like “55 BC”, “AD 43”, “c. 2560 BC” or “2019”. There is no year 0.",
  minLength: 1,
  maxLength: 20,
};

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Timeline",
  required: ["from", "to"],
  properties: {
    title: TITLE_PARAM("A timeline"),
    dates: {
      type: "string",
      title: "How years are written",
      enum: ["bc-ad", "bce-ce", "plain"],
      "x-labels": ["BC and AD", "BCE and CE", "Years only (like 2019)"],
      default: "bc-ad",
    },
    from: Object.assign({}, DATE, { title: "Timeline starts", default: "100 BC" }),
    to: Object.assign({}, DATE, { title: "Timeline ends", default: "AD 100" }),
    eras: {
      type: "array",
      title: "Eras (coloured bands)",
      "x-item": "an era",
      maxItems: 6,
      default: [],
      items: {
        type: "object",
        required: ["name", "from", "to"],
        default: { name: "New era", from: "", to: "" },
        properties: {
          name: { type: "string", title: "Name", maxLength: 40, minLength: 1 },
          from: Object.assign({}, DATE, { title: "Starts" }),
          to: Object.assign({}, DATE, { title: "Ends" }),
          colour: {
            type: "string",
            title: "Colour",
            enum: ERA_COLOURS,
            "x-labels": ["Automatic", "Brown", "Red", "Green", "Blue", "Gold", "Purple"],
            default: "auto",
          },
          culture: {
            type: "string",
            title: "Scenery for",
            description:
              "Only buildings that belong to this people or period are drawn. With none that fit, the land stays plain.",
            enum: CULTURES,
            "x-labels": CULTURE_LABELS,
            default: "none",
          },
          land: {
            type: "string",
            title: "Land",
            enum: ["grass", "sand", "snow"],
            "x-labels": ["Grass", "Sand", "Snow"],
            default: "grass",
          },
        },
      },
    },
    events: {
      type: "array",
      title: "Events",
      "x-item": "an event",
      maxItems: 10,
      default: [],
      items: {
        type: "object",
        required: ["date", "label"],
        default: { date: "", label: "Something happened" },
        properties: {
          date: DATE,
          label: { type: "string", title: "What happened", maxLength: 70, minLength: 1 },
        },
      },
    },
    zoom: {
      type: "object",
      title: "Zoom in",
      description:
        "Show one section bigger, in its own step. Leave its dates empty to zoom on the two closest events.",
      default: { show: false },
      properties: {
        show: { type: "boolean", title: "Zoom into a section", default: false },
        from: Object.assign({}, DATE, { title: "Zoom starts" }),
        to: Object.assign({}, DATE, { title: "Zoom ends" }),
      },
    },
    gaps: {
      type: "array",
      title: "How long between",
      description:
        "Brackets that measure the time between two dates. The number is worked out for you.",
      "x-item": "a bracket",
      maxItems: 3,
      default: [],
      items: {
        type: "object",
        required: ["from", "to"],
        default: { from: "", to: "" },
        properties: {
          from: Object.assign({}, DATE, { title: "From" }),
          to: Object.assign({}, DATE, { title: "To" }),
        },
      },
    },
    eraSteps: {
      type: "string",
      title: "When eras appear",
      enum: ["with-scale", "one-each"],
      "x-labels": ["All at the start", "One step each"],
      default: "with-scale",
    },
    scenery: { type: "boolean", title: "Show a landscape above the line", default: false },
    today: {
      type: "object",
      title: "Today",
      default: { show: false, year: 2026 },
      "x-panel": "advanced",
      properties: {
        show: { type: "boolean", title: "Mark today", default: false },
        year: { type: "integer", title: "This year", minimum: 1, maximum: 3000, default: 2026 },
      },
    },
    text: TEXT_PARAM,
  },
};

export const presets = [
  {
    id: "y2-my-life",
    name: "Year 2: my life",
    params: {
      title: "My life so far",
      dates: "plain",
      from: "2018",
      to: "2027",
      eraSteps: "one-each",
      eras: [
        { name: "Baby", from: "2019", to: "2021" },
        { name: "Toddler", from: "2021", to: "2023" },
        { name: "At school", from: "2023", to: "2027" },
      ],
      events: [
        { date: "2019", label: "I was born" },
        { date: "2020", label: "I took my first steps" },
        { date: "2023", label: "I started Reception" },
        { date: "2025", label: "I started Year 1" },
      ],
      gaps: [{ from: "2019", to: "2023" }],
      today: { show: true, year: 2026 },
    },
  },
  {
    id: "y3-egyptians",
    name: "Year 3: Ancient Egypt, zoom on the pyramid age",
    params: {
      title: "Ancient Egypt",
      dates: "bc-ad",
      from: "3200 BC",
      to: "AD 100",
      scenery: true,
      eras: [
        {
          name: "Old Kingdom",
          from: "c. 2686 BC",
          to: "c. 2181 BC",
          culture: "egypt",
          land: "sand",
          colour: "5",
        },
        {
          name: "Middle Kingdom",
          from: "c. 2055 BC",
          to: "c. 1650 BC",
          culture: "egypt",
          land: "sand",
          colour: "1",
        },
        {
          name: "New Kingdom",
          from: "c. 1550 BC",
          to: "c. 1069 BC",
          culture: "egypt",
          land: "sand",
          colour: "2",
        },
      ],
      events: [
        { date: "c. 3100 BC", label: "Upper and Lower Egypt join" },
        { date: "c. 2670 BC", label: "Step Pyramid built" },
        { date: "c. 2560 BC", label: "Great Pyramid finished" },
        { date: "c. 2500 BC", label: "Great Sphinx carved" },
        { date: "1332 BC", label: "Tutankhamun becomes king" },
        { date: "30 BC", label: "Cleopatra dies" },
      ],
      zoom: { show: true, from: "2700 BC", to: "2450 BC" },
      gaps: [{ from: "c. 2560 BC", to: "30 BC" }],
    },
  },
  {
    id: "y4-romans",
    name: "Year 4: the Romans",
    params: {
      title: "The Romans",
      dates: "bc-ad",
      from: "800 BC",
      to: "AD 500",
      scenery: true,
      eraSteps: "one-each",
      eras: [
        { name: "Kings", from: "753 BC", to: "509 BC", culture: "early-rome", colour: "1" },
        { name: "Republic", from: "509 BC", to: "27 BC", culture: "rome", colour: "4" },
        { name: "Empire", from: "27 BC", to: "AD 476", culture: "rome", colour: "2" },
      ],
      events: [
        { date: "753 BC", label: "Rome is founded (the story says)" },
        { date: "55 BC", label: "Julius Caesar lands in Britain" },
        { date: "AD 43", label: "Claudius invades Britain" },
        { date: "AD 60", label: "Boudica rebels" },
        { date: "AD 122", label: "Hadrian’s Wall begun" },
        { date: "AD 410", label: "Romans leave Britain" },
      ],
      zoom: { show: true, from: "60 BC", to: "AD 130" },
      gaps: [{ from: "55 BC", to: "AD 43" }],
    },
  },
  {
    id: "y6-stone-to-iron",
    name: "Year 6: Stone Age to Iron Age",
    params: {
      title: "Stone Age to Iron Age Britain",
      dates: "bc-ad",
      from: "10,000 BC",
      to: "AD 100",
      scenery: true,
      eras: [
        {
          name: "Middle Stone Age",
          from: "c. 10,000 BC",
          to: "c. 4000 BC",
          culture: "stone-age",
          colour: "3",
        },
        {
          name: "New Stone Age",
          from: "c. 4000 BC",
          to: "c. 2500 BC",
          culture: "neolithic",
          colour: "5",
        },
        {
          name: "Bronze Age",
          from: "c. 2500 BC",
          to: "c. 800 BC",
          culture: "bronze-age",
          colour: "1",
        },
        { name: "Iron Age", from: "c. 800 BC", to: "AD 43", culture: "iron-age", colour: "6" },
      ],
      events: [
        { date: "c. 9000 BC", label: "Hunters camp at Star Carr" },
        { date: "c. 3000 BC", label: "Stonehenge begun" },
        { date: "c. 2300 BC", label: "Amesbury Archer buried" },
        { date: "AD 43", label: "Romans invade" },
      ],
      zoom: { show: true, from: "2600 BC", to: "AD 100" },
      gaps: [{ from: "c. 3000 BC", to: "AD 43" }],
    },
  },
];

/* ------------------------------------------------------------------ model of the data */
const X0 = 104,
  X1 = 1176;
function model(P) {
  const d = (s) => parseDate(s);
  const from = d(P.from),
    to = d(P.to);
  const style = P.dates || "bc-ad";
  const span = to.astro - from.astro;
  const X = scale(from.astro, to.astro, X0, X1);
  const eras = (P.eras || []).map((e, i) => ({
    ...e,
    i,
    a: d(e.from),
    b: d(e.to),
    col: e.colour && e.colour !== "auto" ? +e.colour : (i % 6) + 1,
  }));
  const events = (P.events || []).map((e, i) => ({ ...e, i, d: d(e.date) }));
  // today past either end of the line is drawn just beyond that end, after a break, not on the scale
  if (P.today && P.today.show) {
    const y = P.today.year;
    events.push({
      i: "today",
      label: txt(P, "label:today", "Today"),
      date: String(y),
      d: { astro: y, approx: false },
      today: true,
      off: y > to.astro ? "end" : y < from.astro ? "start" : null,
    });
  }
  const z =
    P.zoom && P.zoom.show
      ? zoomAuto(P)
        ? autoZoom(from, to, events)
        : { a: d(P.zoom.from), b: d(P.zoom.to) }
      : null;
  const inZoom = (a) => !!z && a >= z.a.astro && a <= z.b.astro;
  const gaps = (P.gaps || []).map((g, i) => ({ ...g, i, a: d(g.from), b: d(g.to) }));
  return { from, to, style, span, X, eras, events, z, inZoom, gaps };
}
const dateLabel = (dd, style) => formatYear(dd.astro, style, dd.approx);
const blank = (s) => !String(s ?? "").trim();
const zoomAuto = (P) => blank(P.zoom.from) && blank(P.zoom.to);
// zoom with no dates: the two closest events with the same space again either side, at most half the line
function autoZoom(from, to, events) {
  const span = to.astro - from.astro;
  const ds = [...new Set(events.filter((e) => !e.off).map((e) => e.d.astro))].sort((a, b) => a - b);
  let lo = from.astro + Math.round(span / 3),
    hi = from.astro + Math.round((2 * span) / 3);
  if (ds.length >= 2) {
    let k = 1;
    for (let i = 2; i < ds.length; i++) if (ds[i] - ds[i - 1] < ds[k] - ds[k - 1]) k = i;
    const g = Math.max(1, ds[k] - ds[k - 1]);
    lo = Math.max(from.astro, ds[k - 1] - g);
    hi = Math.min(to.astro, ds[k] + g);
    if (hi - lo > span / 2) {
      const c = (lo + hi) / 2;
      lo = Math.max(from.astro, Math.round(c - span / 4));
      hi = Math.min(to.astro, Math.round(c + span / 4));
    }
  }
  return { a: { astro: lo, approx: false }, b: { astro: hi, approx: false }, auto: true };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  const chk = (path, s) => {
    const v = parseDate(s);
    if (v.error) R.push({ path, reason: v.error });
    return v;
  };
  const from = chk("from", P.from),
    to = chk("to", P.to);
  const all = [];
  (P.eras || []).forEach((e, i) =>
    all.push(
      [`eras.${i}.from`, chk(`eras.${i}.from`, e.from)],
      [`eras.${i}.to`, chk(`eras.${i}.to`, e.to)],
    ),
  );
  (P.events || []).forEach((e, i) =>
    all.push([`events.${i}.date`, chk(`events.${i}.date`, e.date)]),
  );
  if (P.zoom && P.zoom.show && !zoomAuto(P))
    all.push(["zoom.from", chk("zoom.from", P.zoom.from)], ["zoom.to", chk("zoom.to", P.zoom.to)]);
  (P.gaps || []).forEach((g, i) =>
    all.push(
      [`gaps.${i}.from`, chk(`gaps.${i}.from`, g.from)],
      [`gaps.${i}.to`, chk(`gaps.${i}.to`, g.to)],
    ),
  );
  if (R.length) return result(R);
  if (P.dates === "plain")
    for (const [path, v] of [["from", from], ["to", to], ...all])
      if (v.astro <= 0 || v.era === "BC") {
        R.push({
          path,
          reason: `“${v.raw}” is BC, so the years need BC and AD (or BCE and CE). Change “How years are written”.`,
        });
        break;
      }
  if (to.astro <= from.astro)
    R.push({
      path: "to",
      reason: `The timeline has to end after it starts: ${formatYear(to.astro, P.dates)} is not after ${formatYear(from.astro, P.dates)}.`,
    });
  if (R.length) return result(R);
  const M = model(P);
  const inR = (a) => a >= from.astro && a <= to.astro;
  for (const [path, v] of all)
    if (!inR(v.astro))
      R.push({
        path,
        reason: `${formatYear(v.astro, P.dates, v.approx)} is outside the timeline (${formatYear(from.astro, P.dates)} to ${formatYear(to.astro, P.dates)}). Move the date or widen the timeline.`,
      });
  M.eras.forEach((e) => {
    if (e.b.astro <= e.a.astro)
      R.push({ path: `eras.${e.i}.to`, reason: `“${e.name}” has to end after it starts.` });
  });
  // overlapping eras share a second row; three at once will not read
  for (const e of M.eras) {
    const at = M.eras.filter((f) => f.a.astro < e.b.astro && e.a.astro < f.b.astro && f !== e);
    if (
      at.length >= 2 &&
      at.some((f) => at.some((g) => g !== f && g.a.astro < f.b.astro && f.a.astro < g.b.astro))
    ) {
      R.push({
        path: `eras.${e.i}`,
        reason: `Three eras overlap around ${formatYear(e.a.astro, P.dates, e.a.approx)}. A slide can show two at once.`,
      });
      break;
    }
  }
  M.gaps.forEach((g) => {
    if (g.b.astro <= g.a.astro)
      R.push({
        path: `gaps.${g.i}.to`,
        reason: `A “how long between” bracket goes from the earlier date to the later one.`,
      });
  });
  if (M.z) {
    if (M.z.b.astro <= M.z.a.astro)
      R.push({ path: "zoom.to", reason: "The zoom has to end after it starts." });
    else if (M.z.b.astro - M.z.a.astro > 0.6 * M.span)
      R.push({
        path: "zoom.to",
        reason:
          "The zoom covers most of the timeline, so it would not show anything bigger. Zoom into a shorter section.",
      });
  }
  if (R.length) return result(R);
  // honest spacing means close dates sit close: draw them at their true places (smaller dots, flags
  // either side) and say so, rather than fake the gap
  const tooClose = (list, Xf, minPx, where) => {
    const s = [...list].sort((a, b) => a.d.astro - b.d.astro);
    for (let i = 1; i < s.length; i++)
      if (
        Math.abs(Xf(s[i].d.astro) - Xf(s[i - 1].d.astro)) < minPx &&
        s[i].d.astro !== s[i - 1].d.astro
      )
        return W.push({
          path: s[i].i === "today" ? "today.year" : `events.${s[i].i}.date`,
          reason: `${dateLabel(s[i - 1].d, P.dates)} and ${dateLabel(s[i].d, P.dates)} are very close ${where}, so their dots almost touch. ${M.z ? "A shorter zoom section would spread them out." : "Turn on “Zoom in” for that section to spread them out."}`,
        });
  };
  tooClose(
    M.events.filter((e) => !e.off && !M.inZoom(e.d.astro)),
    M.X,
    16,
    "at this scale",
  );
  if (M.z)
    tooClose(
      M.events.filter((e) => M.inZoom(e.d.astro)),
      scale(M.z.a.astro, M.z.b.astro, 0, 1040),
      16,
      "even zoomed in",
    );
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P);
  const st = M.style;
  const items = [];
  items.push({
    key: "scale",
    t: -Infinity,
    caption:
      st === "plain"
        ? "Equal spaces on the line mean equal amounts of time."
        : "Equal spaces on the line mean equal amounts of time. BC years count down to AD 1.",
  });
  if (P.eraSteps === "one-each")
    M.eras.forEach((e) =>
      items.push({
        key: `era:${e.i}`,
        t: e.a.astro,
        o: 0,
        caption: `${e.name}: ${dateLabel(e.a, st)} to ${dateLabel(e.b, st)}.`,
      }),
    );
  M.events.forEach((e) =>
    items.push({
      key: e.today ? "today" : `ev:${e.i}`,
      t: e.d.astro,
      o: 2,
      caption: e.today
        ? e.off === "end"
          ? `Today: ${e.d.astro}. That is off the end of this line, ${durationLabel(e.d.astro - M.to.astro, false)} after ${dateLabel(M.to, st)}.`
          : e.off === "start"
            ? `Today: ${e.d.astro}. This line starts ${durationLabel(M.from.astro - e.d.astro, false)} after today.`
            : `Today: ${e.d.astro}. That is where we are on the line.`
        : `${dateLabel(e.d, st)}: ${e.label}.`,
    }),
  );
  if (M.z) {
    const first = M.events
      .filter((e) => M.inZoom(e.d.astro))
      .sort((a, b) => a.d.astro - b.d.astro)[0];
    items.push({
      key: "zoom",
      t: first ? first.d.astro : M.z.a.astro,
      o: 1,
      caption: `Zoom in: ${dateLabel(M.z.a, st)} to ${dateLabel(M.z.b, st)}, shown bigger.`,
    });
  }
  M.gaps.forEach((g) =>
    items.push({
      key: `gap:${g.i}`,
      t: g.b.astro,
      o: 3,
      caption: `From ${dateLabel(g.a, st)} to ${dateLabel(g.b, st)} is ${durationLabel(g.b.astro - g.a.astro, g.a.approx || g.b.approx)}.`,
    }),
  );
  items.sort((a, b) => a.t - b.t || a.o - b.o);
  const g0 = M.gaps[M.gaps.length - 1];
  const summary = g0
    ? `${durationLabel(g0.b.astro - g0.a.astro, g0.a.approx || g0.b.approx)[0].toUpperCase()}${durationLabel(g0.b.astro - g0.a.astro, g0.a.approx || g0.b.approx).slice(1)} from ${dateLabel(g0.a, st)} to ${dateLabel(g0.b, st)}.`
    : `${dateLabel(M.from, st)} to ${dateLabel(M.to, st)}: ${durationLabel(M.span, false)} on one line.`;
  return { M, items, summary };
}
export function builds(P) {
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

export function notes(P) {
  const { M, items } = plan(P);
  const st = M.style;
  const approxAny =
    M.events.some((e) => e.d.approx) || M.eras.some((e) => e.a.approx || e.b.approx);
  const steps = items.map((it) => {
    if (it.key === "scale")
      return (
        (st === "plain"
          ? `Each tick is the same length of time. `
          : `There is no year 0: the year after 1 BC is AD 1. So the ticks either side of the BC/AD line are one year closer than the others. `) +
        (approxAny ? "“c.” (circa) means about: these dates come from evidence, not records." : "")
      );
    if (it.key === "zoom")
      return `The zoom shows ${dateLabel(M.z.a, st)} to ${dateLabel(M.z.b, st)} about ${Math.round(M.span / (M.z.b.astro - M.z.a.astro))} times bigger. Ask: why can’t we see these on the main line?`;
    if (it.key.startsWith("gap:")) {
      const g = M.gaps[+it.key.slice(4)];
      const n = g.b.astro - g.a.astro;
      if (g.a.astro <= 0 && g.b.astro >= 1 && st !== "plain")
        return `Across BC and AD, add the two numbers and take away 1, because there is no year 0: ${1 - g.a.astro} + ${g.b.astro} − 1 = ${n}.${g.a.approx || g.b.approx ? " One date is approximate, so say “about”." : ""}`;
      if (g.b.astro <= 0 && st !== "plain")
        return `Both dates are BC, so take the smaller number from the bigger one: ${1 - g.a.astro} − ${1 - g.b.astro} = ${n}.`;
      return `Take the earlier year from the later one: ${g.b.astro} − ${g.a.astro} = ${n}.`;
    }
    if (it.key.startsWith("era:")) {
      const e = M.eras[+it.key.slice(4)];
      return `${e.name} lasted ${durationLabel(e.b.astro - e.a.astro, e.a.approx || e.b.approx)}.`;
    }
    if (it.key === "today")
      return M.events.some((e) => e.today && e.off)
        ? "Today is too far away to fit at this scale. Ask: how much longer would the line need to be to reach it?"
        : "Point out how far “today” is from the other events.";
    const e = M.events[+it.key.slice(3)];
    return e && e.d.approx ? `${dateLabel(e.d, st)}: “c.” means about.` : "";
  });
  return {
    steps,
    summary:
      "Ask the class to retell the order of events using “before”, “after” and “how long between”.",
  };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { M, items } = plan(P);
  const st = M.style;
  const b = ctx.b;
  const N = ctx.N;
  const X = M.X;
  const BH = 34;
  // layout: with a zoom, the main line sits high and the zoom is a full-width panel below it
  // (overview above, detail below); without one, the line sits low with room for flags above
  const zGapsAll = M.z ? M.gaps.filter((g) => M.inZoom(g.a.astro) && M.inZoom(g.b.astro)) : [];
  const mainGaps = M.gaps.filter((g) => !zGapsAll.includes(g));
  const GY = M.z ? 272 : P.scenery ? 470 : 430;
  const bi = (key) => b[key] ?? 0;
  const eraBuild = (e) => (P.eraSteps === "one-each" ? bi(`era:${e.i}`) : bi("scale"));
  // era rows: an era that overlaps an earlier one goes on a second, thinner row above the band
  M.eras.forEach((e) => {
    e.row = M.eras.some(
      (f) => f.i < e.i && f.row === 0 && f.a.astro < e.b.astro && e.a.astro < f.b.astro,
    )
      ? 1
      : 0;
  });
  const row1 = M.eras.some((e) => e.row === 1);

  /* scenery: generic layers only */
  if (P.scenery) {
    const sand = M.eras.filter((e) => e.land === "sand").length > M.eras.length / 2;
    sky(root, ctx, GY);
    hills(root, {
      yBase: GY - 40,
      amp: 70,
      fill: sand ? "var(--sand-far)" : "var(--hill-far)",
      seed: 3,
      bumps: 5,
    });
    hills(root, {
      yBase: GY,
      amp: 54,
      fill: sand ? "var(--sand)" : "var(--hill-mid)",
      seed: 7,
      bumps: 4,
    });
    for (const e of M.eras) {
      const xa = X(e.a.astro),
        xb = X(e.b.astro);
      const land =
        e.land === "sand" ? "var(--sand)" : e.land === "snow" ? "var(--snow)" : "var(--hill-near)";
      ground(root, xa, xb, GY - 18, GY, land, { s: eraBuild(e), cls: "rise" });
    }
  }
  const sceneG = h("g", {}, root); // objects, filled once labels are placed
  const under = h("g", {}, root); // wedges and anything that must sit beneath every label

  /* the band, eras and the scale */
  const band = h("g", { s: bi("scale") }, root);
  // the line itself is thin; eras are the thick bands on it
  h(
    "rect",
    { x: X0, y: GY + BH / 2 - 5, width: X1 - X0, height: 10, fill: "var(--neutral)", rx: 5 },
    band,
  );
  const eraFlags = [],
    lane = [];
  const xdv = st !== "plain" && M.from.astro <= 0 && M.to.astro >= 1 ? X(0.5) : null;
  const bcT = st === "bce-ce" ? "BCE" : "BC",
    adT = st === "bce-ce" ? "CE" : "AD";
  if (xdv != null) {
    const w1 = measure(root, bcT, "ts-small", { cls: "strong" }),
      w2 = measure(root, adT, "ts-small", { cls: "strong" });
    lane.push({ x: xdv - w1 - 12, y: GY + BH + 18, w: w1 + w2 + 24, h: 32 });
  }
  // the zoom's cone crosses the lane under the band: era names keep clear of it (tick labels do not need to)
  const zBy = GY + BH + (mainGaps.length ? 138 : 58);
  if (M.z) {
    const sy = GY + BH + 6,
      at = (y, xs, xe) => xs + ((xe - xs) * (y - sy)) / (zBy - sy),
      ys = [GY + BH + 18, GY + BH + 50];
    const l = Math.min(...ys.map((y) => at(y, X(M.z.a.astro) - 6, GRID.left))),
      r = Math.max(...ys.map((y) => at(y, X(M.z.b.astro) + 6, GRID.right)));
    lane.push({ x: l, y: ys[0], w: r - l, h: 32, cone: true });
  }
  for (const e of M.eras) {
    const xa = X(e.a.astro),
      xb = X(e.b.astro);
    const y = e.row ? GY - 26 : GY,
      hh = e.row ? 24 : BH;
    const g = h("g", { s: eraBuild(e), cls: "wipe" }, root);
    h("rect", { x: xa, y, width: xb - xa, height: hh, fill: `var(--era-${e.col})` }, g);
    const name = e.name,
      w = measure(root, name, "ts-era");
    // slide the name along its band so it never sits under an event dot
    const dots = M.events.map((v) => X(v.d.astro));
    const slot = (w) => {
      for (let d = 0; d <= (xb - xa) / 2; d += 6)
        for (const c of [(xa + xb) / 2 - d, (xa + xb) / 2 + d]) {
          if (c - w / 2 < xa + 8 || c + w / 2 > xb - 8) continue;
          if (e.row === 0 && dots.some((dx) => Math.abs(dx - c) < w / 2 + 16)) continue;
          return c;
        }
      return null;
    };
    const lx = slot(w);
    if (lx != null)
      editable(
        T(g, lx, y + hh / 2 + 8, name, "ts-era", {
          "text-anchor": "middle",
          fill: `var(--era-${e.col}-text)`,
        }),
        `eras.${e.i}.name`,
      );
    else if (!(M.z && M.inZoom(e.a.astro) && M.inZoom(e.b.astro))) {
      // too narrow for its name: the name goes in the scale lane under the band (tick labels give way), else a flag
      // a long name takes a narrower slot (wrapped smaller, then cut) before it gives up the lane
      let bx2 = null,
        cap = w;
      // (a short name, or one for an era inside the zoomed section, may sit on the pale zoom cone; a long one keeps clear)
      const ln =
        M.z && (w <= 200 || (e.a.astro < M.z.b.astro && M.z.a.astro < e.b.astro))
          ? lane.filter((q) => !q.cone)
          : lane;
      // libfix: a name only ever takes a slot it fits whole; if none, it becomes a flag (never "Old…")
      const nw = measure(root, name, "ts-era") + 2;
      if (e.row === 0)
        for (const c of [Math.max(w, nw)]) {
          cap = c;
          bx2 = lanePlace(ln, c, (xa + xb) / 2, {
            y: GY + BH + 18,
            gap: 28,
            shift: 90,
            min: GRID.left,
            max: GRID.right,
          });
          if (bx2) {
            if (ln !== lane) lane.push(bx2);
            break;
          }
        }
      const cx = bx2 && bx2.cx;
      if (bx2) {
        const nb = textBlock(g, cx, GY + BH + 42, name, {
          cls: "ts-era",
          maxW: cap,
          maxLines: 1,
          anchor: "middle",
          a: { fill: `var(--era-${e.col}-text)` },
          edit: `eras.${e.i}.name`,
        });
        h(
          "line",
          {
            x1: Math.max(xa, cx - nb.w / 2),
            x2: Math.min(xb, cx + nb.w / 2),
            y1: GY + BH + 6,
            y2: GY + BH + 6,
            stroke: `var(--era-${e.col})`,
            "stroke-width": "var(--sw-struct)",
          },
          g,
        );
      } else {
        // no lane slot: the name is cut to fit its own band (a band too narrow for that gets a flag)
        let cx2 = null,
          cap2 = 0;
        for (let c = xb - xa - 16; c >= Math.max(70, nw) && cx2 == null; c = Math.floor(c * 0.7)) {
          const tmp = h("g", {}, root);
          const tw = textBlock(tmp, 0, 0, name, { cls: "ts-era", maxW: c, maxLines: 1 }).w;
          tmp.remove();
          cx2 = slot(tw);
          cap2 = c;
        }
        if (cx2 != null)
          textBlock(g, cx2, y + hh / 2 + 8, name, {
            cls: "ts-era",
            maxW: cap2,
            maxLines: 1,
            anchor: "middle",
            a: { fill: `var(--era-${e.col}-text)` },
            edit: `eras.${e.i}.name`,
          });
        else eraFlags.push({ x: (xa + xb) / 2, w, h: 30, era: e, prio: 1 });
      }
    }
  }
  const tk = h("g", { s: bi("scale") }, root);
  const labW = Math.max(
    measure(root, formatYear(M.from.astro, st), "ts-axis"),
    measure(root, formatYear(M.to.astro, st), "ts-axis"),
    measure(root, formatYear(Math.round((M.from.astro + M.to.astro) / 2), st), "ts-axis"),
  );
  const ticks = timeTicks(M.from.astro, M.to.astro, st, X.k, labW + 30);
  const tY = GY + BH;
  for (const a of ticks.minor)
    h(
      "line",
      {
        x1: X(a),
        x2: X(a),
        y1: tY + 2,
        y2: tY + 9,
        stroke: "var(--ink-3)",
        "stroke-width": "var(--sw-hair)",
      },
      tk,
    );
  let lastR = -1e9;
  for (const m of ticks.major) {
    const x = X(m.astro);
    h(
      "line",
      {
        x1: x,
        x2: x,
        y1: tY + 2,
        y2: tY + 16,
        stroke: "var(--ink-2)",
        "stroke-width": "var(--sw-rule)",
      },
      tk,
    );
    const w = measure(root, m.label, "ts-axis");
    if (
      lane.some((q) => !q.cone && x + w / 2 > q.x - 8 && x - w / 2 < q.x + q.w + 8) ||
      x - w / 2 < lastR + 16 ||
      x + w / 2 > 1250 ||
      x - w / 2 < 30
    )
      continue;
    lastR = x + w / 2;
    computed(T(tk, x, tY + 42, m.label, "ts-axis", { "text-anchor": "middle" }), "from");
  }
  const obstacles = [];
  if (ticks.divider != null) {
    const xd = X(ticks.divider);
    h(
      "line",
      {
        x1: xd,
        x2: xd,
        y1: GY - 8,
        y2: tY + 30,
        stroke: "var(--ink-2)",
        "stroke-width": "var(--sw-rule)",
        "stroke-dasharray": "4 5",
      },
      tk,
    );
    computed(
      T(tk, xd - 9, tY + 42, bcT, "ts-small", {
        "text-anchor": "end",
        fill: "var(--ink)",
        cls: "strong",
      }),
      "dates",
    );
    computed(
      T(tk, xd + 9, tY + 42, adT, "ts-small", {
        "text-anchor": "start",
        fill: "var(--ink)",
        cls: "strong",
      }),
      "dates",
    );
  }

  /* one focal point: the last bracket is the summary's point, so whichever part it is not in steps back */
  const lastGap = M.gaps[M.gaps.length - 1];
  const gapInZoom = !!(lastGap && zGapsAll.includes(lastGap));
  const focusZoom =
    lastGap && !gapInZoom
      ? `${N}:soft,${bi(`gap:${lastGap.i}`)}-${bi(`gap:${lastGap.i}`) + 1}:soft`
      : null;
  const focusMain =
    lastGap && gapInZoom
      ? `${N}:soft,${bi(`gap:${lastGap.i}`)}-${bi(`gap:${lastGap.i}`) + 1}:soft`
      : null;
  /* zoom inset: its own build, with the events inside it */
  let Z = null;
  if (M.z) {
    const za = M.z.a.astro,
      zb = M.z.b.astro;
    const sx0 = X(za) - 6,
      sx1 = X(zb) + 6;
    const zEvents = M.events.filter((e) => M.inZoom(e.d.astro));
    const zGaps = M.gaps.filter((g) => M.inZoom(g.a.astro) && M.inZoom(g.b.astro));
    const bx = GRID.left,
      bw = GRID.right - GRID.left,
      by = zBy,
      bh = 646 - by;
    const zb0 = bi("zoom");
    const lastZ = Math.max(
      zb0,
      ...zEvents.map((e) => bi(e.today ? "today" : `ev:${e.i}`)),
      ...zGaps.map((g) => bi(`gap:${g.i}`)),
    );
    const zi = zoomInset(ctx, root, {
      src: { x: sx0, y: GY - 6, w: sx1 - sx0, h: BH + 12 },
      box: { x: bx, y: by, w: bw, h: bh },
      col: "var(--event)",
      a: {
        s: zb0,
        cls: "rise",
        c: [ctx.rc(lastZ + 1), focusZoom].filter(Boolean).join(",") || null,
      },
      under,
    });
    const ix0 = bx + 56,
      ix1 = bx + bw - 56,
      ZX = scale(za, zb, ix0, ix1);
    const yb = by + bh - (zGaps.length ? 146 : 68);
    const g = zi.inner;
    h(
      "rect",
      { x: ix0, y: yb + 10, width: ix1 - ix0, height: 10, fill: "var(--neutral)", rx: 5 },
      g,
    );
    const zt = timeTicks(
      za,
      zb,
      st,
      ZX.k,
      Math.max(
        measure(g, formatYear(za, st), "ts-axis"),
        measure(g, formatYear(zb, st), "ts-axis"),
      ) + 30,
    );
    for (const e of M.eras) {
      const a = Math.max(za, e.a.astro),
        z2 = Math.min(zb, e.b.astro);
      if (z2 <= a) continue;
      const er = h(
        "rect",
        { x: ZX(a), y: yb, width: ZX(z2) - ZX(a), height: 30, fill: `var(--era-${e.col})` },
        g,
      );
      if (P.eraSteps === "one-each") er.dataset.s = eraBuild(e);
      // the name sits in the band between event dots; a long one is cut to the widest clear gap
      const na = { fill: `var(--era-${e.col}-text)`, cls: "strong" },
        full = measure(g, e.name, "ts-tiny", na);
      const zd = [
        ...zEvents.map((v) => ZX(v.d.astro)),
        ...(zt.divider != null ? [ZX(zt.divider)] : []),
      ];
      let zx = null,
        cap = full;
      for (const cw of [full, ...[200, 140, 90].filter((c) => c < full)]) {
        const tmp = h("g", {}, g);
        const tbz = textBlock(tmp, 0, 0, e.name, { cls: "ts-tiny", maxW: cw, maxLines: 1, a: na });
        tmp.remove();
        // libfix: the zoom band repeats an era's name only when it fits whole; the main line names it
        if (/…$/.test(tbz.lines[0] || "")) continue;
        const w = tbz.w;
        for (let c = ZX(a) + 12; c + w < ZX(z2) - 12 && zx == null; c += 6)
          if (!zd.some((dx) => dx > c - 16 && dx < c + w + 16)) zx = c;
        if (zx != null) {
          cap = cw;
          break;
        }
      }
      if (zx != null)
        textBlock(g, zx, yb + 23, e.name, {
          cls: "ts-tiny",
          maxW: cap,
          maxLines: 1,
          a: na,
          edit: `eras.${e.i}.name`,
        });
    }
    let lr = -1e9;
    for (const m of zt.major) {
      const x = ZX(m.astro);
      h(
        "line",
        {
          x1: x,
          x2: x,
          y1: yb + 32,
          y2: yb + 42,
          stroke: "var(--ink-3)",
          "stroke-width": "var(--sw-rule)",
        },
        g,
      );
      const w = measure(g, m.label, "ts-axis");
      if (x - w / 2 < lr + 14 || x + w / 2 > bx + bw - 8 || x - w / 2 < bx + 8) continue;
      lr = x + w / 2;
      computed(
        T(g, x, yb + 64, m.label, "ts-axis", { "text-anchor": "middle", cls: "halo-paper" }),
        "zoom.from",
      );
    }
    if (zt.divider != null)
      h(
        "line",
        {
          x1: ZX(zt.divider),
          x2: ZX(zt.divider),
          y1: yb - 10,
          y2: yb + 42,
          stroke: "var(--ink-2)",
          "stroke-width": "var(--sw-rule)",
          "stroke-dasharray": "4 5",
        },
        g,
      );
    // the panel's title: one short line in a corner (a long edit shrinks, then is cut), never across the flags
    // (its width steps down with the flags when they need the room)
    const zTitle = txt(P, "label:zoom", "Zoomed in");
    const titleAt = (cap) => {
      const o = { cls: "ts-tiny", maxW: cap, maxLines: 2, a: { cls: "muted" } }; // libfix: a second line before any cut
      const tmpT = h("g", {}, root);
      const tw = textBlock(tmpT, 0, 0, zTitle, o).w + 16;
      tmpT.remove();
      const xs = zEvents.map((e) => ZX(e.d.astro)),
        leftBusy = xs.some((x) => x < bx + 30 + tw),
        rightBusy = xs.some((x) => x > bx + bw - 30 - tw);
      const right =
        leftBusy &&
        (!rightBusy ||
          Math.min(...xs.map((x) => x - bx)) < Math.min(...xs.map((x) => bx + bw - x)));
      return { o, right, box: { x: right ? bx + bw - 14 - tw : bx + 14, y: by + 6, w: tw, h: 34 } };
    };
    Z = {
      g,
      ZX,
      yb,
      top: by + 4,
      zEvents,
      zGaps,
      box: { x: bx, y: by, w: bw, h: bh },
      titleAt,
      drawTitle: (t) =>
        textBlock(
          g,
          t.right ? bx + bw - 22 : bx + 22,
          by + 32,
          zTitle,
          Object.assign({}, t.o, { anchor: t.right ? "end" : "start", edit: "text.label:zoom" }),
        ),
    };
  }

  /* event flags (main line and zoom), placed once for every build so nothing jumps */
  // flags: a block (date over a wrapped label) on the main line; one line (date then label) in the zoom
  const flagItem = (e, maxW, inline, maxLines = 2) => {
    const dl = e.today ? String(e.d.astro) : dateLabel(e.d, st);
    const dw = measure(root, dl, "ts-date");
    const tmp = h("g", {}, root);
    const tb = textBlock(tmp, 0, 0, e.label, { cls: "ts-small", maxW, maxLines, lh: 28 });
    tmp.remove();
    // one line in the zoom; a long edit wraps to a second line under the label, then shrinks
    return inline
      ? {
          x: 0,
          e,
          dl,
          dw,
          w: dw + 12 + tb.w,
          h: 36 + (tb.lines.length - 1) * 28,
          maxW,
          maxLines,
          inline,
        }
      : { x: 0, e, dl, dw, w: Math.max(dw, tb.w), h: 34 + tb.h, maxW, maxLines };
  };
  // fit, not warn-and-draw: a flag with no room steps down to a narrower label (more lines, then
  // smaller, then cut) and is placed again; if it is already at the smallest, every flag steps down
  const fitFlags = (srcs, n, opts) => {
    // keeps the first layout with the fewest failures, so flags never shrink when shrinking does not help
    const lv = srcs.map(() => 0);
    let best = null;
    for (let r = 0; r < 4 * n; r++) {
      const items = srcs.map((s, i) => s(lv[i]));
      placeFlags(items, opts);
      const bad = items.map((it, i) => (it.failed ? i : -1)).filter((i) => i >= 0);
      if (!best || bad.length < best.n) best = { items, n: bad.length };
      if (!bad.length) break;
      let moved = false;
      for (const i of bad)
        if (lv[i] < n - 1) {
          lv[i]++;
          moved = true;
        }
      if (!moved)
        for (let i = 0; i < lv.length; i++)
          if (lv[i] < n - 1) {
            lv[i]++;
            moved = true;
          }
      if (!moved) break;
    }
    return best.items;
  };
  // labels get narrower but never shorter: a crowded timeline wraps names onto more lines rather than cutting
  // them ("Julius…"), and era names keep a lane wide enough for two words
  const MAIN_STEPS = [
      [300, 2],
      [240, 3],
      [180, 3],
      [150, 4],
      [130, 5],
    ],
    ERA_CAPS = [1e9, 300, 240, 200, 180],
    ZOOM_STEPS = [
      [400, 2],
      [300, 2],
      [220, 3],
      [160, 4],
      [130, 5],
    ];
  const ex = (e) => (e.off === "end" ? X1 + 24 : e.off === "start" ? X0 - 24 : X(e.d.astro));
  const drawFlag = (p, it, baseY, dotR, a) => {
    const e = it.e;
    const g = h("g", a, p);
    const col = e.today ? "var(--ink)" : "var(--event)",
      tcol = e.today ? "var(--ink)" : "var(--event-text)";
    if (it.failed) {
      ctx.warn(
        `No room for the label “${e.label}” (x ${it.x | 0}, ${it.w | 0} × ${it.h}${Z ? `, zoom box y ${Z.box.y | 0}–${(Z.box.y + Z.box.h) | 0}, band ${Z.yb | 0}` : ""}).`,
      );
      it.top = baseY - 40 - it.h;
      // libfix: a flag with no clear slot still stays on the slide: it opens to whichever side has room
      const toRight = it.x + 14 + it.w <= GRID.right;
      it.lx = toRight ? it.x + 14 : Math.max(GRID.left + it.w, it.x - 14);
      it.anchor = toRight ? "start" : "end";
    }
    const bgX = it.anchor === "start" ? it.lx - 6 : it.lx - it.w - 10;
    if (P.scenery && p === root)
      labelGround(g, { x: bgX, y: it.top - 4, w: it.w + 16, h: it.h + 6 });
    else if (p !== root)
      h(
        "rect",
        {
          x: bgX,
          y: it.top - 4,
          width: it.w + 16,
          height: it.h + 6,
          rx: "var(--r-mark)",
          fill: "var(--knockout)",
        },
        g,
      );
    h(
      "line",
      {
        x1: it.x,
        x2: it.x,
        y1: it.top + 4,
        y2: baseY,
        stroke: col,
        "stroke-width": "var(--sw-lead)",
      },
      g,
    );
    const x0 = it.anchor === "start" ? it.lx : it.lx - it.w;
    const dt = it.inline
      ? T(g, x0, it.top + 27, it.dl, "ts-date", { fill: tcol })
      : T(g, it.lx, it.top + 26, it.dl, "ts-date", { "text-anchor": it.anchor, fill: tcol });
    if (e.today) computed(dt, "today.year");
    else editable(dt, `events.${e.i}.date`);
    const edit = e.today ? "text.label:today" : `events.${e.i}.label`;
    if (it.inline)
      textBlock(g, x0 + it.dw + 12, it.top + 27, e.label, {
        cls: "ts-small",
        maxW: it.maxW,
        maxLines: it.maxLines,
        lh: 28,
        a: { fill: "var(--ink)" },
        edit,
      });
    else
      textBlock(g, it.lx, it.top + 58, e.label, {
        cls: "ts-small",
        maxW: it.maxW,
        maxLines: it.maxLines,
        lh: 28,
        anchor: it.anchor,
        a: { fill: "var(--ink)" },
        edit,
      });
    return g;
  };
  const mainEvents = M.events.filter((e) => !M.inZoom(e.d.astro));
  const bottom0 = GY - (row1 ? 40 : 16);
  const levels = [];
  for (let y = bottom0; y - 30 >= 92; y -= 6) levels.push(y);
  // the title is an obstacle, so labels can rise beside it on the right
  if (P.title)
    obstacles.push({
      x: GRID.left,
      y: 30,
      w: Math.min(GRID.right - GRID.left, measure(root, P.title, "ts-title") + 8),
      h: 64,
    });
  const eraItem = (f, l) => {
    const cap =
      ERA_CAPS[
        l
      ]; /* a flag on a leader line: its name may run past a short era rather than be cut */
    const tmp = h("g", {}, root);
    const w = textBlock(tmp, 0, 0, f.era.name, { cls: "ts-era", maxW: cap, maxLines: 1 }).w;
    tmp.remove();
    return { x: f.x, w, h: 30, era: f.era, prio: 1, cap };
  };
  const placed = fitFlags(
    [
      ...mainEvents.map(
        (e) => (l) =>
          Object.assign(flagItem(e, MAIN_STEPS[l][0], false, MAIN_STEPS[l][1]), { x: ex(e) }),
      ),
      ...eraFlags.map((f) => (l) => eraItem(f, l)),
    ],
    MAIN_STEPS.length,
    { levels, base: GY, minTop: 92, obstacles, left: GRID.left + 8, right: GRID.right - 8, pad: 8 },
  );
  const mItems = placed.filter((i) => i.e),
    eraPlaced = placed.filter((i) => i.era);
  for (const f of eraPlaced) {
    const e = f.era,
      g = h("g", { s: eraBuild(e), c: focusMain }, root);
    if (f.failed) {
      ctx.warn(`No room for the era name “${e.name}”.`);
      continue;
    }
    h(
      "line",
      {
        x1: f.x,
        x2: f.x,
        y1: f.top + 30,
        y2: GY,
        stroke: `var(--era-${e.col}-text)`,
        "stroke-width": "var(--sw-hair)",
      },
      g,
    );
    if (P.scenery) labelGround(g, { x: f.box.x - 2, y: f.top - 2, w: f.box.w + 4, h: 34 });
    textBlock(g, f.lx, f.top + 24, e.name, {
      cls: "ts-era",
      maxW: f.cap,
      maxLines: 1,
      anchor: f.anchor,
      a: { fill: `var(--era-${e.col}-text)` },
      edit: `eras.${e.i}.name`,
    });
  }
  for (const it of mItems) {
    const k = bi(it.e.today ? "today" : `ev:${it.e.i}`);
    drawFlag(root, it, GY, 8, { s: k, cls: "rise", c: focusMain });
    // close dates keep their true places: smaller dots so both still show
    const near = Math.min(1e9, ...mItems.filter((o) => o !== it).map((o) => Math.abs(o.x - it.x)));
    if (it.e.off)
      h(
        "line",
        {
          x1: it.e.off === "end" ? X1 + 3 : it.x + 10,
          x2: it.e.off === "end" ? it.x - 10 : X0 - 3,
          y1: GY + BH / 2,
          y2: GY + BH / 2,
          stroke: "var(--ink-3)",
          "stroke-width": "var(--sw-rule)",
          "stroke-dasharray": "3 4",
          s: k,
        },
        root,
      );
    h(
      "circle",
      {
        cx: it.x,
        cy: GY + BH / 2,
        r: near < 22 ? 6 : 9,
        fill: it.e.today ? "var(--ink)" : "var(--event)",
        stroke: "var(--bg)",
        "stroke-width": 3,
        s: k,
        cls: "pop",
      },
      root,
    );
  }
  if (P.scenery) {
    const boxes = placed.filter((i) => i.box).map((i) => i.box);
    for (const e of M.eras) {
      const xa = X(e.a.astro),
        xb = X(e.b.astro);
      const kinds = sceneryFor(e.culture);
      const n = Math.min(
        3,
        kinds.length ? Math.max(xb - xa >= 56 ? 1 : 0, Math.floor((xb - xa) / 110)) : 0,
      );
      const sc = clamp((xb - xa) / 130, 0.5, 0.82);
      for (let k = 0; k < n; k++) {
        const x = xa + ((k + 0.5) * (xb - xa)) / n,
          ob = { x: x - 62 * sc, y: GY - 14 - 96 * sc, w: 124 * sc, h: 96 * sc };
        if (boxes.some((b) => overlaps(ob, b, 6))) continue;
        object(sceneG, kinds[k % kinds.length], x, GY - 14, sc, {
          s: eraBuild(e),
          cls: "rise",
          delay: 200 + k * 120,
        });
      }
    }
  }
  if (Z) {
    for (const e of Z.zEvents)
      h(
        "circle",
        {
          cx: X(e.d.astro),
          cy: GY + BH / 2,
          r: 6,
          fill: "var(--event)",
          stroke: "var(--bg)",
          "stroke-width": 2,
          s: bi(e.today ? "today" : `ev:${e.i}`),
          cls: "pop",
        },
        root,
      );
    const zl = [];
    for (let y = Z.yb - 10; y - 36 >= Z.top; y -= 6) zl.push(y);
    let zItems, zt;
    for (const cap of [300, 200, 120]) {
      zt = Z.titleAt(cap);
      zItems = fitFlags(
        Z.zEvents.map(
          (e) => (l) =>
            Object.assign(flagItem(e, ZOOM_STEPS[l][0], true, ZOOM_STEPS[l][1]), {
              x: Z.ZX(e.d.astro),
            }),
        ),
        ZOOM_STEPS.length,
        {
          levels: zl,
          base: Z.yb,
          minTop: Z.top,
          pad: 4,
          obstacles: [zt.box],
          left: Z.box.x + 16,
          right: Z.box.x + Z.box.w - 16,
        },
      );
      if (!zItems.some((it) => it.failed)) break;
    }
    Z.drawTitle(zt);
    for (const it of zItems) {
      const k = bi(it.e.today ? "today" : `ev:${it.e.i}`);
      drawFlag(Z.g, it, Z.yb, 7, { s: k, cls: "rise" });
      h(
        "circle",
        {
          cx: it.x,
          cy: Z.yb + 15,
          r: 8,
          fill: "var(--event)",
          stroke: "var(--paper)",
          "stroke-width": 3,
          s: k,
          cls: "pop",
        },
        Z.g,
      );
    }
  }

  /* how long between: brackets measured in code; the number counts up during its build */
  const counters = [];
  M.gaps.forEach((g, j) => {
    const key = `gap:${g.i}`,
      k = bi(key);
    const n = g.b.astro - g.a.astro,
      approx = g.a.approx || g.b.approx;
    const inside = Z && Z.zGaps.includes(g);
    const [x1, x2, y, p] = inside
      ? [Z.ZX(g.a.astro), Z.ZX(g.b.astro), Z.yb + 88, Z.g]
      : [X(g.a.astro), X(g.b.astro), GY + BH + 68, root];
    const last = j === M.gaps.length - 1;
    const br = bracket(p, x1, x2, y, durationLabel(n, approx), {
      a: { s: k, c: last ? null : ctx.rc(key) },
      computedPath: `gaps.${g.i}`,
    });
    br.firstChild.setAttribute("class", "draw");
    br.firstChild.setAttribute("pathLength", 1);
    br.firstChild.dataset.s = k;
    br.firstChild.style.setProperty("--t-build-draw", "calc(1800ms * var(--pace))");
    // keep the number on the slide even when the bracket is short
    const lw = br.label.getComputedTextLength();
    const kb = h("rect", {
      x: 0,
      y: y + 14,
      width: lw + 20,
      height: 44,
      rx: "var(--r-mark)",
      fill: inside ? "var(--paper)" : "var(--bg)",
    });
    br.insertBefore(kb, br.label);
    const cx = clamp(
      (x1 + x2) / 2,
      (inside ? Z.box.x + 16 : 24) + lw / 2,
      (inside ? Z.box.x + Z.box.w - 16 : 1256) - lw / 2,
    );
    br.label.setAttribute("x", cx);
    kb.setAttribute("x", cx - lw / 2 - 10);
    counters.push({ k, n, approx, el: br.label });
  });

  return {
    dur: Object.fromEntries(M.gaps.map((g) => [`gap:${g.i}`, 1800])),
    still() {
      counters.forEach((c) => (c.el.textContent = durationLabel(c.n, c.approx)));
    },
    reset() {
      counters.forEach((c) => (c.el.textContent = durationLabel(0, false)));
    },
    tick(k, u) {
      for (const c of counters) {
        if (k === c.k)
          c.el.textContent =
            u >= 1 ? durationLabel(c.n, c.approx) : `${fmtInt(Math.round(c.n * eIO(u)))} years`;
        else if (k > c.k) c.el.textContent = durationLabel(c.n, c.approx);
      }
    },
  };
}

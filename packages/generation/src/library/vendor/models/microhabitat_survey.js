// Habitats and microhabitats: a small place (under a log, a stone, leaf litter, a hedge bottom,
// a pond edge, long grass or an open path) seen as a cross-section. Lift the cover (or look
// closely) to find the minibeasts, label the conditions (damp or dry, light or dark), say why
// they live there, then tally them. One place, or two side by side to compare.
// Truth rules: creatures only where their needs are met (woodlice in damp and dark), the
// conditions fit the place (under a log is not light), and every tally is computed from its count.

import { tally } from "../kit/batch-C.js";
import { habitatObject } from "../kit/batch-D.js";
import {
  clamp,
  computed,
  editable,
  eIO,
  GRID,
  ground,
  h,
  labelGround,
  measure,
  nameFits,
  noteArt,
  overlaps,
  panels,
  pictureCard,
  result,
  schemaCheck,
  sky,
  T,
  TEXT_PARAM_FOR,
  TITLE_PARAM,
  textBlock,
  txt,
  WORD_CAPS,
  withDefaults,
} from "../kit/index.js";
import { creatureSize, drawCreature, REL } from "./microhabitat_survey/creatures.js";

export const meta = {
  id: "microhabitat_survey",
  name: "Habitats and microhabitats",
  kind: "scene",
  version: 1,
  subjects: ["Science"],
  years: ["Y2", "Y3", "Y4"],
  teaches:
    "Living things live in small places that suit them: look under a log, see that it is damp and dark, say why the minibeasts live there, and tally what you find.",
};

/* ------------------------------------------------------------------ places and creatures */
const MOIST = ["wet", "damp", "dry"],
  LIGHT = ["dark", "shady", "light"];
const PL = {
  log: {
    label: "Under a log",
    name: "Under the log",
    where: "under the log",
    desc: "a log lying on the ground",
    obj: "log",
    lift: true,
    light: ["dark", "shady"],
    lightWhy: "the log blocks out the light",
  },
  stone: {
    label: "Under a stone",
    name: "Under the stone",
    where: "under the stone",
    desc: "a large flat stone",
    obj: "stone",
    lift: true,
    light: ["dark", "shady"],
    lightWhy: "the stone blocks out the light",
  },
  leaves: {
    label: "In leaf litter",
    name: "In the leaves",
    where: "in the leaf litter",
    desc: "a pile of fallen leaves",
    obj: "leaves",
    lift: true,
    light: ["dark", "shady"],
    lightWhy: "the leaves on top block out the light",
  },
  hedge: {
    label: "At the bottom of a hedge",
    name: "Hedge bottom",
    where: "at the bottom of the hedge",
    desc: "the bottom of a hedge",
    light: ["dark", "shady"],
    lightWhy: "the leaves above shade it",
  },
  pond: {
    label: "At the edge of a pond",
    name: "Pond edge",
    where: "at the pond edge",
    desc: "the edge of a pond",
    moist: ["wet", "damp"],
    moistWhy: "the water keeps the ground wet or damp",
  },
  grass: {
    label: "In long grass",
    name: "Long grass",
    where: "in the long grass",
    desc: "a patch of long grass",
    light: ["shady", "light"],
    lightWhy: "light gets in between the stems",
  },
  path: {
    label: "On an open path",
    name: "On the path",
    where: "on the path",
    desc: "an open path",
    light: ["light"],
    lightWhy: "nothing covers it, so daylight falls on it",
  },
};
const PLACES = Object.keys(PL);
const ALLM = MOIST,
  ALLL = LIGHT;
// what each creature needs; whyM / whyL say why, in Year 2 words
const C = {
  woodlouse: {
    label: "Woodlouse",
    name: "Woodlice",
    moist: ["wet", "damp"],
    light: ["dark", "shady"],
    whyM: "they lose water through their shells and dry out",
    whyL: "in the light they dry out and birds find them",
  },
  worm: {
    label: "Earthworm",
    name: "Worms",
    moist: ["wet", "damp"],
    light: ["dark", "shady"],
    whyM: "they breathe through damp skin",
    whyL: "sunlight dries out their skin",
  },
  slug: {
    label: "Slug",
    name: "Slugs",
    moist: ["wet", "damp"],
    light: ["dark", "shady"],
    whyM: "they have no shell and dry out quickly",
    whyL: "they hide from the sun in the day",
  },
  snail: {
    label: "Snail",
    name: "Snails",
    moist: ["wet", "damp"],
    light: ALLL,
    whyM: "in dry weather they seal themselves in their shells and hide",
  },
  centipede: {
    label: "Centipede",
    name: "Centipedes",
    moist: ["wet", "damp"],
    light: ["dark", "shady"],
    whyM: "they dry out easily",
    whyL: "they hide by day and hunt in the dark",
  },
  millipede: {
    label: "Millipede",
    name: "Millipedes",
    moist: ["wet", "damp"],
    light: ["dark", "shady"],
    whyM: "they dry out easily",
    whyL: "they hide from the light by day",
  },
  spider: { label: "Spider", name: "Spiders", moist: ALLM, light: ALLL },
  beetle: { label: "Beetle", name: "Beetles", moist: ALLM, light: ALLL },
  ant: {
    label: "Ant",
    name: "Ants",
    moist: ["damp", "dry"],
    light: ALLL,
    whyM: "their nests flood in wet ground",
  },
  ladybird: {
    label: "Ladybird",
    name: "Ladybirds",
    moist: ALLM,
    light: ["shady", "light"],
    whyL: "they live on plants in the light, where they hunt greenfly",
  },
  earwig: {
    label: "Earwig",
    name: "Earwigs",
    moist: ALLM,
    light: ["dark", "shady"],
    whyL: "they hide in dark gaps by day and come out at night",
  },
  grasshopper: {
    label: "Grasshopper",
    name: "Grasshoppers",
    moist: ["damp", "dry"],
    light: ["light"],
    whyM: "they like warm, dry places",
    whyL: "they need sunshine to warm up",
  },
  frog: {
    label: "Frog",
    name: "Frogs",
    moist: ["wet", "damp"],
    light: ALLL,
    whyM: "their skin must stay moist",
  },
};
const KINDS = Object.keys(C);
// what each creature's art shows; a name outside it (bees, pond skaters) draws a labelled card
const SYN = {
  woodlouse: ["pill bug", "slater"],
  worm: ["earthworm", "worm"],
  snail: ["garden snail", "snail"],
  spider: ["spider", "money spider", "garden spider"],
  beetle: ["beetle", "ground beetle", "black beetle"],
  ant: ["ant"],
  frog: ["frog", "common frog", "froglet"],
  ladybird: ["ladybird", "ladybug"],
};
const fitsArt = (kind, name) =>
  nameFits(name, [C[kind].label, C[kind].name, kind, ...(SYN[kind] || [])]);
const words = (a) =>
  a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " or " + a[a.length - 1];
const andList = (a) =>
  a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const lc = (s) => {
  const w = String(s).trim();
  return /^[A-Z]{2}/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1);
};
const cap = (s) => {
  const w = String(s);
  return w.charAt(0).toUpperCase() + w.slice(1);
};

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Microhabitat survey",
  properties: {
    title: TITLE_PARAM("What lives under a log?"),
    sites: {
      type: "array",
      title: "Places we looked",
      description:
        "One place, or two side by side to compare. Say how damp and how light each place is.",
      "x-item": "a place",
      minItems: 1,
      maxItems: 2,
      default: [{ place: "log", name: "Under the log", moisture: "damp", light: "dark" }],
      items: {
        type: "object",
        required: ["place"],
        default: { place: "path", name: "On the path", moisture: "dry", light: "light" },
        properties: {
          place: {
            type: "string",
            title: "Place",
            enum: PLACES,
            "x-labels": PLACES.map((k) => PL[k].label),
            default: "log",
          },
          name: {
            type: "string",
            title: "Name on the slide",
            minLength: 1,
            maxLength: WORD_CAPS.label,
            "x-role": "label",
            default: "Under the log",
          },
          moisture: {
            type: "string",
            title: "Damp or dry",
            enum: MOIST,
            "x-labels": ["Wet", "Damp", "Dry"],
            default: "damp",
          },
          light: {
            type: "string",
            title: "Light or dark",
            enum: LIGHT,
            "x-labels": ["Dark", "Shady", "Light"],
            default: "dark",
          },
        },
      },
    },
    creatures: {
      type: "array",
      title: "What we found",
      description:
        "Each kind of minibeast and how many were counted. Put 0 when you looked but found none.",
      "x-item": "a creature",
      minItems: 1,
      maxItems: 5,
      default: [
        { kind: "woodlouse", name: "Woodlice", count: 8 },
        { kind: "worm", name: "Worms", count: 3 },
      ],
      items: {
        type: "object",
        required: ["kind"],
        default: { kind: "spider", name: "Spiders", count: 1, count2: 0 },
        properties: {
          kind: {
            type: "string",
            title: "Creature",
            enum: KINDS,
            "x-labels": KINDS.map((k) => C[k].label),
            default: "spider",
          },
          name: {
            type: "string",
            title: "Name on the slide",
            minLength: 1,
            maxLength: WORD_CAPS.label,
            "x-role": "label",
            default: "Spiders",
          },
          count: {
            type: "integer",
            title: "How many (first place)",
            minimum: 0,
            maximum: 15,
            default: 1,
            description: "Up to 15: more than that is hard to count in tally marks.",
          },
          count2: {
            type: "integer",
            title: "How many (second place)",
            minimum: 0,
            maximum: 15,
            default: 0,
            description: "Only used when you compare two places.",
          },
        },
      },
    },
    text: TEXT_PARAM_FOR({
      why: "caption",
      whyHead: "label",
      tallyHead: "label",
      totalHead: "label",
      scale: "label",
    }),
  },
};

export const presets = [
  {
    id: "y2-under-a-log",
    name: "Year 2: under a log",
    params: {
      title: "What lives under a log?",
      sites: [{ place: "log", name: "Under the log", moisture: "damp", light: "dark" }],
      creatures: [
        { kind: "woodlouse", name: "Woodlice", count: 9 },
        { kind: "worm", name: "Worms", count: 4 },
        { kind: "slug", name: "Slugs", count: 3 },
        { kind: "centipede", name: "Centipedes", count: 2 },
      ],
    },
  },
  {
    id: "y2-pond-edge",
    name: "Year 2: at the pond edge",
    params: {
      title: "Who lives at the pond edge?",
      sites: [{ place: "pond", name: "Pond edge", moisture: "wet", light: "light" }],
      creatures: [
        { kind: "frog", name: "Frogs", count: 2 },
        { kind: "snail", name: "Snails", count: 6 },
        { kind: "spider", name: "Spiders", count: 3 },
        { kind: "beetle", name: "Beetles", count: 1 },
      ],
    },
  },
  {
    id: "y4-compare",
    name: "Year 4: comparing two habitats",
    params: {
      title: "Under a log or on a path?",
      sites: [
        { place: "log", name: "Under the log", moisture: "damp", light: "dark" },
        { place: "path", name: "On the path", moisture: "dry", light: "light" },
      ],
      creatures: [
        { kind: "woodlouse", name: "Woodlice", count: 11, count2: 0 },
        { kind: "slug", name: "Slugs", count: 4, count2: 0 },
        { kind: "ant", name: "Ants", count: 1, count2: 6 },
        { kind: "spider", name: "Spiders", count: 2, count2: 1 },
      ],
    },
  },
];

/* ------------------------------------------------------------------ validate */
const cntKey = (j) => (j ? "count2" : "count");
const cnt = (c, j) => (j ? c.count2 : c.count) || 0;
// The place sets what light (and, at a pond, what wetness) is possible, and each creature lives only where its
// needs are met. A setting that breaks this is not refused (a refusal there would lock the place and its
// conditions, or a creature and its place, so that neither could change first). The slide shows the nearest
// true value instead, and a warning says what was changed and how to fix it.
const nearest = (all, ok, v) =>
  ok.includes(v)
    ? v
    : ok
        .slice()
        .sort(
          (p, q) =>
            Math.abs(all.indexOf(p) - all.indexOf(v)) - Math.abs(all.indexOf(q) - all.indexOf(v)),
        )[0];
function fixSite(s) {
  const pl = PL[s.place];
  return Object.assign({}, s, {
    light: pl.light ? nearest(LIGHT, pl.light, s.light) : s.light,
    moisture: pl.moist ? nearest(MOIST, pl.moist, s.moisture) : s.moisture,
  });
}
const suits = (kind, s) => C[kind].moist.includes(s.moisture) && C[kind].light.includes(s.light);
/** What the slide shows: conditions true to each place, and every count exactly as the class found it.
 *  A count that seems unlikely for the place is never changed (it is the class's data): validate warns,
 *  and the speaker notes carry the doubt. */
function norm(P) {
  const sites = P.sites.map(fixSite);
  return Object.assign({}, P, { sites, creatures: P.creatures.map((c) => Object.assign({}, c)) });
}
/** Counts that seem unlikely for the place, as speaker-note sentences (never shown on the slide). */
function doubts(P) {
  const out = [];
  P.creatures.forEach((c) =>
    P.sites.forEach((s, j) => {
      const n = cnt(c, j);
      if (!n || suits(c.kind, s)) return;
      const k = C[c.kind];
      out.push(
        `The class counted ${n} ${lc(c.name || k.name)} where it is ${s.moisture} and ${s.light}, but ${lc(k.name)} usually live in ${words(k.moist)}, ${words(k.light)} places. Ask: why might they have been there?`,
      );
    }),
  );
  return out;
}
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const Wn = [];
  if (R.length) return result(R);
  const S = P.sites,
    Cr = P.creatures;
  if (S.length === 2 && Cr.length > 4)
    R.push({
      path: "creatures",
      reason: `Comparing two places, one slide can tally four kinds of creature, not ${Cr.length}. Take one out.`,
    });
  if (R.length) return result(R);
  const F = S.map(fixSite);
  S.forEach((s, j) => {
    const pl = PL[s.place];
    if (F[j].light !== s.light)
      Wn.push(
        `${cap(pl.where)} cannot be ${s.light}: ${pl.lightWhy}. The slide shows it as ${F[j].light}.`,
      );
    if (F[j].moisture !== s.moisture)
      Wn.push(
        `${cap(pl.where)} cannot be ${s.moisture}: ${pl.moistWhy}. The slide shows it as ${F[j].moisture}.`,
      );
  });
  const seen = {};
  Cr.forEach((c, i) => {
    const nm = nameOf(P, i);
    if (seen[c.kind] === nm)
      Wn.push(`${nm} is in the list twice. Give each a different name, or count them once.`);
    seen[c.kind] = nm;
  });
  Cr.forEach((c, i) =>
    F.forEach((s, j) => {
      if (!cnt(c, j)) return;
      const k = C[c.kind],
        pl = PL[s.place];
      const nm = cap(lc(k.name)),
        n = cnt(c, j),
        left = `but the class counted ${n} there, so the slide shows ${n} and the speaker notes ask why. Check the count or the place.`;
      if (!k.moist.includes(s.moisture))
        Wn.push(
          `${nm} need ${words(k.moist)} places${k.whyM ? `: ${k.whyM}` : ""}. ${cap(pl.where)} it is ${s.moisture}, ${left}`,
        );
      else if (!k.light.includes(s.light))
        Wn.push(
          `${nm} live in ${words(k.light)} places${k.whyL ? `: ${k.whyL}` : ""}. ${cap(pl.where)} it is ${s.light}, ${left}`,
        );
    }),
  );
  if (S.length === 1 && Cr.some((c) => c.count2))
    Wn.push("The second count is only used when you compare two places.");
  return result(R, Wn);
}

/* ------------------------------------------------------------------ the plan: builds, captions, why */
// a name left over from another kind (the kind was changed, the name was not) falls back to this kind's name
const nameOf = (P, i) => {
  const c = P.creatures[i],
    k = C[c.kind];
  if (!c.name) return k.name;
  const stale = KINDS.some((o) => o !== c.kind && (C[o].name === c.name || C[o].label === c.name));
  return stale ? k.name : c.name;
};
// a name left over from another place (the place was changed, the name was not) falls back to this place's name
const siteName = (P, j) => {
  const s = P.sites[j],
    own = PL[s.place].name;
  if (!s.name) return own;
  return PLACES.some((o) => o !== s.place && (PL[o].name === s.name || PL[o].label === s.name))
    ? own
    : s.name;
};
const found = (P, j) => P.creatures.map((c, i) => i).filter((i) => cnt(P.creatures[i], j) > 0);
const total = (P, j) => P.creatures.reduce((a, c) => a + cnt(c, j), 0);
const cond = (s) => `${s.moisture} and ${s.light}`;
function whyText(P) {
  const S = P.sites;
  if (S.length === 2) {
    const t = [0, 1].map((j) => total(P, j));
    const A = t[0] >= t[1] ? 0 : 1,
      Bj = 1 - A;
    if (t[0] === t[1])
      return `We found the same number in both places. Each creature lives where its needs are met.`;
    const sA = S[A],
      sB = S[Bj];
    const only = found(P, A)
      .filter((i) => !cnt(P.creatures[i], Bj))
      .filter((i) => {
        const k = C[P.creatures[i].kind];
        return !k.moist.includes(sB.moisture) || !k.light.includes(sB.light);
      });
    if (!only.length)
      return `More creatures were living ${PL[sA.place].where}, where it is ${cond(sA)}.`;
    // group by the condition that actually keeps them out of place B
    const grp = {};
    for (const i of only) {
      const k = C[P.creatures[i].kind];
      const m = !k.moist.includes(sB.moisture),
        l = !k.light.includes(sB.light);
      const need = m && l ? `${sA.moisture}, ${sA.light}` : m ? sA.moisture : sA.light;
      (grp[need] = grp[need] || []).push(lc(nameOf(P, i)));
    }
    return Object.entries(grp)
      .map(
        ([need, nm]) =>
          `${cap(andList(nm))} need ${need} places, so they live only ${PL[sA.place].where}.`,
      )
      .join(" ");
  }
  const s = S[0];
  const f = found(P, 0);
  if (!f.length)
    return `We found nothing living ${PL[s.place].where} today. Try another day, or another place.`;
  const grp = { dd: [], d: [], l: [], any: [] };
  for (const i of f) {
    const k = C[P.creatures[i].kind];
    const nd = !k.moist.includes("dry"),
      dk = !k.light.includes("light"),
      lt = !k.light.includes("dark");
    (nd && dk ? grp.dd : nd ? grp.d : lt ? grp.l : grp.any).push(lc(nameOf(P, i)));
  }
  const out = [];
  if (grp.dd.length)
    out.push(`${cap(andList(grp.dd))} need damp, dark places, or their bodies dry out.`);
  if (grp.d.length) out.push(`${cap(andList(grp.d))} need damp to stay moist.`);
  if (grp.l.length) out.push(`${cap(andList(grp.l))} like light places with plants.`);
  if (grp.any.length)
    out.push(
      `${cap(andList(grp.any))} can live in many places${["log", "leaves", "stone", "hedge"].includes(s.place) ? ", and hunt the others here" : ""}.`,
    );
  const food = {
    log: "Rotting wood is food for many of them.",
    leaves: "Rotting leaves are food for many of them.",
    hedge: "Fallen leaves give food and shelter.",
    pond: "The water keeps the ground wet.",
    grass: "The grass gives food and shelter.",
  }[s.place];
  if (food && out.length < 3) out.push(food);
  return out.join(" ");
}
function plan(P) {
  const S = P.sites,
    two = S.length === 2,
    items = [];
  const pw = (j) => PL[S[j].place];
  items.push({
    key: "place",
    caption: two
      ? `Two microhabitats to compare: ${pw(0).desc} and ${pw(1).desc}.`
      : `${cap(pw(0).desc)} is a microhabitat: a small home inside a bigger habitat.`,
  });
  S.forEach((s, j) => {
    const f = found(P, j).map((i) => lc(nameOf(P, i)));
    const pl = PL[s.place];
    const what = f.length
      ? pl.lift
        ? `${andList(f)} ${f.length > 1 || /s$/.test(f[0]) ? "are" : "is"} underneath.`
        : `we find ${andList(f)}.`
      : pl.lift
        ? "nothing is hiding underneath."
        : "we find nothing living here.";
    items.push({
      key: `look:${j}`,
      j,
      caption: pl.lift ? `Lift the ${pl.obj} gently: ${what}` : `Look closely ${pl.where}: ${what}`,
    });
  });
  items.push({
    key: "conditions",
    caption: two
      ? `${cap(pw(0).where)} it is ${cond(S[0])}; ${pw(1).where} it is ${cond(S[1])}.`
      : `${cap(pw(0).where)} it is ${cond(S[0])}.`,
  });
  items.push({
    key: "why",
    caption: "Each creature lives where it gets the damp, light, shelter and food it needs.",
  });
  const t = S.map((s, j) => total(P, j));
  // the most common kinds: every kind that shares the top count (a tie names them all; all equal names none)
  const most = (j) => {
    const f = found(P, j);
    if (!f.length) return null;
    const top = Math.max(...f.map((i) => cnt(P.creatures[i], j)));
    const m = f.filter((i) => cnt(P.creatures[i], j) === top);
    return m.length === f.length ? [] : m;
  };
  items.push({
    key: "tally",
    caption: two
      ? `We tallied both places: ${t[0]} ${t[0] === 1 ? "creature" : "creatures"} ${pw(0).where} and ${t[1]} ${pw(1).where}.`
      : `We made a tally: one mark for each creature, a gate for every five.`,
  });
  let summary;
  if (two) {
    const A = t[0] >= t[1] ? 0 : 1;
    summary =
      t[0] === t[1]
        ? `We found ${t[0]} creatures in each place.`
        : `More lived ${pw(A).where} (${t[A]}) than ${pw(1 - A).where} (${t[1 - A]}): it is ${cond(S[A])}.`;
  } else {
    const m = most(0);
    const lead = `We found ${t[0]} ${t[0] === 1 ? "creature" : "creatures"} ${pw(0).where}`;
    summary =
      m == null
        ? `We found nothing ${pw(0).where}.`
        : !m.length
          ? `${lead}.`
          : `${lead}, and ${andList(m.map((i) => lc(nameOf(P, i))))} were the most common${m.length > 1 ? " (equal)" : ""}.`;
  }
  return { items, two, summary };
}
export function builds(P) {
  P = norm(P);
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}
export function notes(P) {
  P = norm(P);
  const { items, two } = plan(P);
  const steps = items.map((it) => {
    if (it.key === "place")
      return "A habitat is where a living thing lives; a microhabitat is a very small one, like the space under a log. Ask: what do you think we will find here?";
    if (it.key.startsWith("look:"))
      return PL[P.sites[it.j].place].lift
        ? "In a real survey, lift the cover slowly, look, count, then put it back gently the same way up so the creatures keep their home."
        : "Look without disturbing: count what you see, then leave everything as it was.";
    if (it.key === "conditions")
      return "Feel the soil: is it damp or dry? Is it light or dark? You can use a data logger to measure light and moisture.";
    if (it.key === "why") return whyNote(P);
    return two
      ? "Compare the totals, not just the kinds. Ask: why might there be more in one place? Is one look enough to be sure?"
      : "Each mark is one creature; the fifth mark crosses the four to make a gate, so we count in fives.";
  });
  const dz = doubts(P);
  return {
    steps,
    summary:
      (dz.length ? dz.join(" ") + " " : "") +
      "Not to scale: the creatures are drawn much bigger than life so each can be seen, and one of each kind is drawn. The tally shows how many were counted.",
  };
}

// the teacher note for the why build, from the places and the creatures actually found
function whyNote(P) {
  const S = P.sites,
    all = [...new Set(S.flatMap((s, j) => found(P, j)))];
  const nd = (i) => !C[P.creatures[i].kind].moist.includes("dry"),
    dk = (i) => !C[P.creatures[i].kind].light.includes("light");
  const nm = (a) => cap(andList(a.map((i) => lc(nameOf(P, i)))));
  const dd = all.filter((i) => nd(i) && dk(i)),
    damp = all.filter((i) => nd(i) && !dk(i)),
    dark = all.filter((i) => dk(i) && !nd(i));
  const out = ["Animals are suited to where they live."];
  if (dd.length) out.push(`${nm(dd)} lose water easily, so they stay where it is damp and dark.`);
  if (damp.length) out.push(`${nm(damp)} lose water easily, so they stay where it is damp or wet.`);
  if (dark.length) out.push(`${nm(dark)} keep out of the light by day.`);
  if (!dd.length && !damp.length && !dark.length && all.length)
    out.push(
      `${cap(andList(all.map((i) => lc(nameOf(P, i)))))} can cope with ${cond(S[0])} places.`,
    );
  const pl = PL[S[0].place];
  const f0 = found(P, 0);
  const ask =
    S.length === 2
      ? f0.length
        ? `Ask: what would happen to the ${lc(nameOf(P, f0[0]))} if we moved them ${PL[S[1].place].where}?`
        : "Ask: why might one place have more creatures than the other?"
      : pl.lift
        ? `Ask: what would happen if we left the ${pl.obj} upside down?`
        : {
            pond: "Ask: what would happen to these animals if the pond dried up?",
            grass: "Ask: what would happen if the grass were cut short?",
            hedge: "Ask: what would happen if the hedge were cut down?",
            path: "Ask: why do so few creatures live out on the open path?",
          }[S[0].place];
  return out.join(" ") + " " + ask;
}

/* ------------------------------------------------------------------ scenery for one place */
const drawLog = (g, x0, x1, G, hh) => {
  const w = x1 - x0,
    r = hh / 2;
  h(
    "rect",
    { x: x0, y: G - hh, width: w, height: hh, rx: r, fill: "var(--trunk)", cls: "body" },
    g,
  );
  h(
    "rect",
    {
      x: x0,
      y: G - hh * 0.42,
      width: w,
      height: hh * 0.42,
      rx: hh * 0.21,
      fill: "var(--soil-deep)",
    },
    g,
  );
  for (const f of [0.22, 0.5, 0.74])
    h(
      "line",
      {
        x1: x0 + w * f,
        x2: x0 + w * f + 40,
        y1: G - hh * 0.7,
        y2: G - hh * 0.66,
        stroke: "var(--soil-deep)",
        "stroke-width": "var(--sw-struct)",
        "stroke-linecap": "round",
      },
      g,
    );
  h(
    "ellipse",
    { cx: x1 - r * 0.4, cy: G - r, rx: r * 0.55, ry: r, fill: "var(--wood-2)", cls: "body" },
    g,
  );
  h(
    "ellipse",
    {
      cx: x1 - r * 0.4,
      cy: G - r,
      rx: r * 0.22,
      ry: r * 0.45,
      fill: "none",
      stroke: "var(--wood-line)",
      "stroke-width": "var(--sw-lead)",
    },
    g,
  );
};
const drawStone = (g, x0, x1, G, hh) => {
  const w = x1 - x0;
  h(
    "path",
    {
      d: `M${x0} ${G} C ${x0 - 6} ${G - hh * 0.7} ${x0 + w * 0.2} ${G - hh} ${x0 + w * 0.5} ${G - hh} C ${x0 + w * 0.82} ${G - hh} ${x1 + 6} ${G - hh * 0.6} ${x1} ${G} Z`,
      fill: "var(--stone)",
      cls: "body",
    },
    g,
  );
  h(
    "path",
    {
      d: `M${x0} ${G} C ${x0 + w * 0.3} ${G - hh * 0.3} ${x1 - w * 0.3} ${G - hh * 0.3} ${x1} ${G} Z`,
      fill: "var(--stone-shade)",
    },
    g,
  );
};
const drawLeaves = (g, x0, x1, G, hh) => {
  const w = x1 - x0;
  h(
    "path",
    {
      d: `M${x0} ${G} C ${x0 + w * 0.15} ${G - hh} ${x1 - w * 0.15} ${G - hh} ${x1} ${G} Z`,
      fill: "var(--wood-line)",
      cls: "body",
    },
    g,
  );
  const n = Math.round(w / 34);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n,
      x = x0 + w * u,
      y = G - hh * Math.sin(Math.PI * u) * 0.78 - 4;
    h(
      "ellipse",
      {
        cx: x,
        cy: y,
        rx: 18,
        ry: 7,
        transform: `rotate(${((i * 37) % 60) - 30} ${x} ${y})`,
        fill: i % 3 ? "var(--wood-2)" : "var(--leaf)",
      },
      g,
    );
  }
};
function drawScene(root, P, j, box, ctx, cover) {
  const s = P.sites[j],
    pl = PL[s.place];
  const g = h("g", {}, root);
  const G = box.G,
    yb = box.y + box.h,
    R = box.x + box.w,
    bh = yb - G;
  const cid = `${ctx.uid}-clip${j}`;
  h(
    "rect",
    { x: box.x, y: box.y, width: box.w, height: box.h, rx: "var(--r-card)" },
    h("clipPath", { id: cid }, g),
  );
  const cg = h("g", { "clip-path": `url(#${cid})` }, g);
  sky(h("g", {}, cg), { uid: `${ctx.uid}-s${j}` }, s.place === "pond" ? yb : G, box.x, R);
  // a far plane in haze behind the ground, for depth
  h(
    "path",
    {
      d: `M${box.x} ${G} L ${box.x} ${G - 34} C ${box.x + box.w * 0.3} ${G - 64} ${box.x + box.w * 0.6} ${G - 22} ${R} ${G - 50} L ${R} ${G} Z`,
      fill: "var(--hill-far)",
    },
    cg,
  );
  const wet = s.moisture !== "dry";
  const surf = s.place === "path" ? "var(--stone)" : "var(--hill-near)";
  ground(cg, box.x, R, G, yb, wet ? "var(--soil)" : "var(--sand)");
  ground(cg, box.x, R, G - 4, G + 8, surf);
  if (s.place === "pond") {
    const wx = box.x + box.w * 0.64;
    h(
      "path",
      {
        d: `M${wx - 50} ${G - 4} C ${wx - 20} ${G + 20} ${wx + 30} ${yb - 24} ${wx + 110} ${yb} L ${R} ${yb} L ${R} ${G - 4} Z`,
        fill: "var(--bg)",
      },
      cg,
    );
    h(
      "path",
      {
        d: `M${wx - 36} ${G + 6} C ${wx - 14} ${G + 24} ${wx + 30} ${yb - 20} ${wx + 110} ${yb} L ${R} ${yb} L ${R} ${G + 6} Z`,
        fill: "var(--water)",
      },
      cg,
    );
    h("rect", { x: wx - 36, y: G + 6, width: R - wx + 36, height: 5, fill: "var(--sea-1)" }, cg);
    h(
      "path",
      {
        d: `M${wx - 50} ${G - 4} C ${wx - 20} ${G + 20} ${wx + 30} ${yb - 24} ${wx + 110} ${yb}`,
        fill: "none",
        stroke: "var(--soil-deep)",
        "stroke-width": "var(--sw-struct)",
      },
      cg,
    );
    habitatObject(cg, "reeds", wx + 16, G + 6, 1.3);
    habitatObject(cg, "reeds", R - 60, G + 6, 1.1);
  }
  if (s.place === "hedge") {
    const hx0 = box.x + box.w * 0.06,
      hx1 = box.x + box.w * 0.94,
      top = Math.max(box.top + 10, G - 180);
    const hh = G - top,
      wv = hx1 - hx0;
    h(
      "path",
      {
        d: `M${hx0} ${G} C ${hx0 - 10} ${G - hh * 0.7} ${hx0 + wv * 0.12} ${top} ${hx0 + wv * 0.3} ${top + 10} C ${hx0 + wv * 0.45} ${top - 6} ${hx0 + wv * 0.62} ${top + 4} ${hx0 + wv * 0.74} ${top + 8} C ${hx0 + wv * 0.9} ${top} ${hx1 + 10} ${G - hh * 0.6} ${hx1} ${G} Z`,
        fill: "var(--hill-mid)",
        cls: "body",
      },
      cg,
    );
    h(
      "path",
      {
        d: `M${hx0} ${G} C ${hx0 + wv * 0.3} ${G - hh * 0.4} ${hx1 - wv * 0.3} ${G - hh * 0.4} ${hx1} ${G} Z`,
        fill: "var(--hill-shade)",
      },
      cg,
    );
    for (let i = 0; i < 6; i++)
      h(
        "rect",
        {
          x: hx0 + wv * (0.12 + i * 0.15),
          y: G - hh * 0.35,
          width: 8,
          height: hh * 0.35,
          fill: "var(--trunk)",
        },
        cg,
      );
    for (let i = 0; i < 14; i++) {
      const x = box.x + 20 + (i * (box.w - 40)) / 13;
      h(
        "ellipse",
        { cx: x, cy: G - 2, rx: 14, ry: 5, fill: i % 2 ? "var(--wood-2)" : "var(--wood-line)" },
        cg,
      );
    }
  }
  if (s.place === "grass") {
    const n = Math.round(box.w / 46);
    for (let i = 0; i < n; i++) {
      const x = box.x + 20 + (i * (box.w - 40)) / (n - 1),
        hh = Math.min(G - box.top - 10, 96 + ((i * 29) % 50));
      for (const [dx, f] of [
        [-6, "var(--life-shade)"],
        [0, "var(--leaf)"],
        [7, "var(--life-shade)"],
      ])
        h(
          "path",
          {
            d: `M${x + dx - 3} ${G} Q ${x + dx} ${G - hh * 0.5} ${x + dx + dx * 0.6} ${G - hh * (f === "var(--leaf)" ? 1 : 0.8)} Q ${x + dx + 3} ${G - hh * 0.5} ${x + dx + 3} ${G} Z`,
            fill: f,
          },
          cg,
        );
    }
  }
  // the open path: sparse dry gravel, some of it lying on the surface
  if (s.place === "path") {
    for (let i = 0; i < 12; i++) {
      const x = box.x + 30 + ((i * 97) % (box.w - 60)),
        r = 6 + ((i * 7) % 7);
      const y = i % 3 === 0 ? G + 1 : G + 18 + ((i * 23) % Math.max(10, bh - 32));
      h(
        "ellipse",
        {
          cx: x,
          cy: y,
          rx: r * 1.5,
          ry: r,
          transform: `rotate(${((i * 31) % 40) - 20} ${x} ${y})`,
          fill: i % 2 ? "var(--stone-shade)" : "var(--stone)",
          cls: "body",
        },
        cg,
      );
    }
  }
  // the cover that lifts: log, stone or leaves, on a damp dark patch of soil with a little leaf litter
  let lift = null;
  if (pl.lift) {
    const { x0, x1, hh } = cover;
    const lg = h("g", {}, cg);
    if (wet)
      h(
        "path",
        {
          d: `M${x0 - 16} ${G + 6} C ${x0} ${G + bh * 0.8} ${x1} ${G + bh * 0.8} ${x1 + 16} ${G + 6} Z`,
          fill: "var(--soil-deep)",
        },
        cg,
      );
    for (const [x, r, f] of [
      [x0 - 34, 20, "var(--wood-line)"],
      [x0 - 10, -25, "var(--wood-2)"],
      [x1 + 12, 30, "var(--wood-2)"],
      [x1 + 38, -15, "var(--leaf)"],
    ])
      h(
        "ellipse",
        { cx: x, cy: G - 3, rx: 16, ry: 6, transform: `rotate(${r} ${x} ${G - 3})`, fill: f },
        cg,
      );
    (pl.obj === "log" ? drawLog : pl.obj === "stone" ? drawStone : drawLeaves)(lg, x0, x1, G, hh);
    lift = lg;
  }
  // panel frame
  h(
    "rect",
    {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      rx: "var(--r-card)",
      fill: "none",
      stroke: "var(--rule)",
      "stroke-width": "var(--sw-rule)",
    },
    g,
  );
  return { g, cg, lift };
}

/* condition chip: flat glyph + word (computed from the setting) */
const CHIP_H = 44;
const chipW = (p, val) => 44 + measure(p, val, "ts-label", { cls: "strong" }) + 14;
function chip(p, x, y, kind, val, path, a) {
  const g = h("g", a, p);
  const word = val;
  const w = chipW(p, val),
    hh = CHIP_H;
  labelGround(g, { x, y, w, h: hh });
  const ix = x + 22,
    iy = y + hh / 2;
  if (kind === "moisture") {
    const drop = (dx, sc, fill) =>
      h(
        "path",
        {
          d: `M${ix + dx} ${iy - 13 * sc} C ${ix + dx + 6 * sc} ${iy - 4 * sc} ${ix + dx + 9 * sc} ${iy} ${ix + dx + 9 * sc} ${iy + 4 * sc} A ${9 * sc} ${9 * sc} 0 0 1 ${ix + dx - 9 * sc} ${iy + 4 * sc} C ${ix + dx - 9 * sc} ${iy} ${ix + dx - 6 * sc} ${iy - 4 * sc} ${ix + dx} ${iy - 13 * sc} Z`,
          fill,
          stroke: "var(--water)",
          "stroke-width": "var(--sw-lead)",
        },
        g,
      );
    if (val === "wet") {
      drop(-5, 0.8, "var(--water)");
      drop(6, 0.8, "var(--water)");
    } else if (val === "damp") drop(0, 1, "var(--water)");
    else drop(0, 1, "none");
  } else if (val === "light")
    h("circle", { cx: ix, cy: iy, r: 11, fill: "var(--sun)" }, g); // a flat sun disc
  else if (val === "shady") {
    h("circle", { cx: ix, cy: iy, r: 11, fill: "var(--sun)" }, g);
    h("path", { d: `M${ix} ${iy - 11} A 11 11 0 0 1 ${ix} ${iy + 11} Z`, fill: "var(--ink-2)" }, g);
  } else
    h(
      "path",
      {
        d: `M${ix + 4} ${iy - 11.3} A 12 12 0 1 0 ${ix + 4} ${iy + 11.3} A 16 16 0 0 1 ${ix + 4} ${iy - 11.3} Z`,
        fill: "var(--ink-2)",
      },
      g,
    ); // a crescent moon
  computed(
    T(g, x + 44, y + hh / 2 + 10, word, "ts-label", { cls: "strong", fill: "var(--ink)" }),
    path,
  );
  g.box = { x, y, w, h: hh };
  return g;
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  P = norm(P);
  const { items, two } = plan(P);
  const b = ctx.b,
    N = ctx.N;
  const S = P.sites,
    Cr = P.creatures;
  const bi = (k) => b[k];
  const kL = (j) => bi(`look:${j}`),
    kC = bi("conditions"),
    kW = bi("why"),
    kT = bi("tally");
  // layout: the scene(s) fill the stage; directly under them one band holds the legend rows (then the tally),
  // and the why text takes that band for its own build
  const n = Cr.length,
    rows = two ? n : Math.ceil(n / 2);
  const colW = two ? panels(2)[0].w : (GRID.right - GRID.left - 48) / 2;
  const tg = tableGeo(root, P, two, colW);
  const bandH = Math.max(tg.headH + tg.tableH, 156),
    bandY = GRID.bottom - bandH,
    sceneY = GRID.top + 4,
    sceneB = bandY - 14;
  const sceneBoxes = two
    ? panels(2, sceneY, sceneB)
    : [{ x: GRID.left, y: sceneY, w: GRID.right - GRID.left, h: sceneB - sceneY }];
  const lifts = [];
  sceneBoxes.forEach((bx, j) => {
    const s = S[j],
      pl = PL[s.place];
    // header: the name top left, the condition chips top right when they fit beside it, else on the soil
    const tmp = h("g", {}, root);
    const cw = ["moisture", "light"].map((kd) => chipW(tmp, s[kd])),
      chipsW = cw[0] + cw[1] + 10;
    const rowMax = bx.w - 72 - chipsW;
    const inHeader = measure(tmp, siteName(P, j), "ts-label") <= rowMax;
    const nameMax = inHeader ? rowMax : bx.w - 56;
    const nLines = two ? 1 : 2;
    const nb = textBlock(tmp, 0, 0, siteName(P, j), {
      cls: "ts-label",
      maxW: nameMax,
      maxLines: nLines,
      lh: 32,
    });
    tmp.remove();
    const nameBox = { x: bx.x + 14, y: bx.y + 14, w: nb.w + 28, h: nb.h + 16 };
    const soilH = two ? 74 : 84,
      G = bx.y + bx.h - soilH;
    bx.G = G;
    const ceil = nameBox.y + nameBox.h + 10;
    bx.top = ceil;
    const chipY = inHeader ? nameBox.y + (nameBox.h - CHIP_H) / 2 : G + (soilH - CHIP_H) / 2 + 2,
      chipX = inHeader ? bx.x + bx.w - 14 - chipsW : bx.x + 14;
    // creature scale: big enough to read from the back, but they must fit along the ground and under the lifted cover
    const f = found(P, j),
      room = G - ceil,
      tilt = 1.5;
    const wsum = f.reduce((a, i) => a + creatureSize(Cr[i].kind).w * REL[Cr[i].kind], 0);
    const hmax = Math.max(1, ...f.map((i) => creatureSize(Cr[i].kind).h * REL[Cr[i].kind]));
    const spanMax = pl.lift ? bx.w - 100 : s.place === "pond" ? bx.w * 0.64 - 24 : bx.w * 0.8;
    const sc = Math.min(
      two ? 1.75 : 2.3,
      (spanMax - 22 * (f.length + 1)) / Math.max(1, wsum),
      pl.lift ? (room - 44 - 22 - bx.w * 0.03) / hmax : 9,
    );
    const want = wsum * sc + 22 * (f.length + 1);
    const coverW = clamp(Math.max(want + 40, bx.w * (two ? 0.62 : 0.5)), 200, bx.w - 80);
    const rise = coverW * Math.sin((tilt * Math.PI) / 180);
    const tallest = f.length ? hmax * sc : 0,
      liftNeed = tallest + 22;
    const coverMax =
      pl.obj === "stone" ? (two ? 64 : 80) : pl.obj === "leaves" ? (two ? 70 : 86) : two ? 72 : 88;
    // a deep header (long name) lowers the cover's resting height first, then the lift
    const coverH = clamp(room - liftNeed - rise, 44, coverMax);
    const cx0 = s.place === "pond" ? bx.x + 40 : bx.x + (bx.w - coverW) / 2;
    const cover = { x0: cx0, x1: cx0 + coverW, hh: coverH };
    const scene = drawScene(root, P, j, bx, ctx, cover);
    scene.g.dataset.c = `${kT}:soft`;
    const liftUp = Math.max(0, Math.min(liftNeed, room - coverH - rise));
    if (scene.lift && tallest + 6 > liftUp)
      ctx.warn("the lifted cover is too low to show the creatures");
    if (scene.lift) lifts.push({ el: scene.lift, k: kL(j), up: liftUp, px: cover.x0, py: G, tilt });
    // creatures on the ground in the revealed strip (pond: on the bank)
    const span =
      s.place === "pond"
        ? [bx.x + 24, bx.x + bx.w * 0.64]
        : pl.lift
          ? [cover.x0 + 10, cover.x1 - 10]
          : [bx.x + bx.w * 0.1, bx.x + bx.w * 0.9];
    const ws = f.map((i) => creatureSize(Cr[i].kind).w * REL[Cr[i].kind] * sc);
    const free = span[1] - span[0] - ws.reduce((a, c) => a + c, 0);
    const gap = f.length ? free / (f.length + 1) : 0;
    if (f.length && gap < 6) ctx.warn(`creatures crowd ${siteName(P, j)}`);
    let x = span[0] + gap;
    f.forEach((i, m) => {
      const k = Cr[i].kind;
      // the picture follows the name: bees are never drawn as a beetle; a name the art is not gets a card
      const a0 = { s: kL(j), cls: "pop", delay: (pl.lift ? 900 : 200) + m * 180 },
        nm0 = nameOf(P, i);
      if (fitsArt(k, nm0)) {
        drawCreature(scene.cg, k, x + ws[m] / 2, G + 2, REL[k] * sc, a0);
        noteArt(nm0, k);
      } else
        pictureCard(scene.cg, nm0, x + ws[m] / 2, G + 2, {
          w: Math.max(ws[m], 90),
          h: Math.max(ws[m] * 0.62, 56),
          a: a0,
          model: "microhabitat_survey",
          hint: "minibeast",
        });
      x += ws[m] + gap;
    });
    // header labels on a solid ground; kept at full strength when the scene recedes, so they stay readable
    const top = h("g", {}, root);
    const hg = h("g", { s: bi("place"), cls: "rise" }, top);
    labelGround(hg, nameBox);
    textBlock(
      hg,
      nameBox.x + 14,
      nameBox.y + 8 + (nb.cls === "ts-tiny" ? 19 : 24),
      siteName(P, j),
      {
        cls: "ts-label",
        maxW: nameMax,
        maxLines: nLines,
        lh: 32,
        edit: `sites.${j}.name`,
        a: { fill: "var(--ink)" },
      },
    );
    chip(top, chipX, chipY, "moisture", s.moisture, `sites.${j}.moisture`, {
      s: kC,
      cls: "pop",
      delay: 200,
    });
    chip(top, chipX + cw[0] + 10, chipY, "light", s.light, `sites.${j}.light`, {
      s: kC,
      cls: "pop",
      delay: 500,
    });
    if (scene.lift && G - coverH - liftUp - rise < ceil - 1)
      ctx.warn("lifted cover meets the place name");
  });

  /* why: its own build, in the band under the scene */
  const why = txt(P, "label:why", whyText(P));
  const whyG = h("g", { s: kW, hide: kT, cls: "rise" }, root);
  editable(
    T(whyG, GRID.left, bandY + 30, txt(P, "label:whyHead", "Why here?"), "ts-label", {
      cls: "strong",
      fill: "var(--ink)",
    }),
    "text.label:whyHead",
  );
  textBlock(whyG, GRID.left, bandY + 30 + 36, why, {
    cls: "ts-label",
    maxW: GRID.right - GRID.left,
    maxLines: 3,
    lh: 38,
    edit: "text.label:why",
    a: { fill: "var(--ink)" },
  });
  drawTable(root, P, ctx, { two, kL, kC, kW, kT, bandY, tg, boxes: sceneBoxes });

  // not to scale, at the right of the title band; the engine's title stops short of it
  const nts = txt(P, "label:scale", "Not to scale"),
    ntsO = {
      cls: "ts-label",
      maxW: 340,
      maxLines: 2,
      lh: 30,
      anchor: "end",
      a: { fill: "var(--ink-2)" },
    };
  const tmpN = h("g", {}, root);
  const nb = textBlock(tmpN, 0, 0, nts, ntsO);
  tmpN.remove();
  textBlock(
    root,
    GRID.right,
    GRID.titleY - (nb.lines.length - 1) * nb.lh,
    nts,
    Object.assign(ntsO, { edit: "text.label:scale" }),
  );

  // lift choreography: the cover rises at its build, stays up after
  const set = (k, u) => {
    for (const L of lifts) {
      const v = k > L.k ? 1 : k === L.k ? eIO(clamp(u / 0.6)) : 0;
      L.el.setAttribute(
        "transform",
        `translate(0 ${-L.up * v}) rotate(${-L.tilt * v} ${L.px} ${L.py})`,
      );
    }
  };
  set(-1, 0);
  return {
    tick(k, u) {
      set(k, u);
    },
    onStep(k) {
      set(k, 0);
    },
    still() {
      set(N, 1);
    },
    reset() {
      set(-1, 0);
    },
    dur: Object.fromEntries(items.map((it) => [it.key, it.key.startsWith("look") ? 2400 : 1800])),
  };
}

/* table geometry, shared by the band height and the table: the name column grows (then wraps) for long names,
   each row is tall enough for its name's lines, and long column heads wrap in their own lanes */
const ICON_W = 66,
  NUM_W = 50,
  TALLY_MIN = 168,
  SCENE_MIN = 240;
function tableGeo(root, P, two, colW) {
  const Cr = P.creatures,
    tmp = h("g", {}, root),
    rows = two ? Cr.length : Math.ceil(Cr.length / 2);
  const budget = GRID.bottom - GRID.top - 18 - SCENE_MIN; // the scene keeps room to lift its cover
  const longest = Math.max(...Cr.map((c, i) => measure(tmp, nameOf(P, i), "ts-label"))) + 4;
  const tinyLines = (w) =>
    Math.max(
      ...Cr.map(
        (c, i) =>
          textBlock(tmp, 0, 0, nameOf(P, i), { cls: "ts-tiny", maxW: w, maxLines: 9, lh: 22 }).lines
            .length,
      ),
    );
  const hA = { cls: "strong", fill: "var(--ink)" };
  const totS = txt(P, "label:totalHead", "Total"),
    talS = txt(P, "label:tallyHead", "Tally");
  const totMax = colW * (two ? 0.5 : 0.4),
    totW = Math.min(totMax, measure(tmp, totS, "ts-label", hA));
  // ml: most lines a name may take; hl: most lines a column head may take. Long wording wraps first; only when
  // the band would crowd the scene do names and heads give back lines (the kit then shrinks, and at last cuts)
  const plan = (ml, hl) => {
    // a name that would need more lines than allowed gives up the row icon (the scene above shows the creature)
    let iconW = ICON_W,
      nameMax = colW - ICON_W - 18 - 8 - NUM_W - TALLY_MIN;
    if (longest > nameMax && tinyLines(nameMax) > ml) {
      iconW = 0;
      nameMax += ICON_W;
    }
    const nameW = longest <= colW * 0.34 ? longest : Math.min(nameMax, longest);
    const names = Cr.map((c, i) => {
      const nm = nameOf(P, i);
      const one = textBlock(tmp, 0, 0, nm, { cls: "ts-label", maxW: nameW, maxLines: 1 });
      return one.cls === "ts-label" && one.lines[0] === nm
        ? { cls: "ts-label", maxLines: 1, n: 1, lh: 30 }
        : {
            cls: "ts-tiny",
            maxLines: ml,
            n: textBlock(tmp, 0, 0, nm, { cls: "ts-tiny", maxW: nameW, maxLines: ml, lh: 22 }).lines
              .length,
            lh: 22,
          };
    });
    // each row is as tall as its longest name needs (one place: two names share a row)
    const base = two ? 38 : 48,
      rowOf = (i) => (two ? i : Math.floor(i / 2));
    const rowH = Array.from({ length: rows }, (_, r) =>
      Math.max(base, ...names.map((q, i) => (rowOf(i) === r && q.n > 1 ? q.n * 22 + 10 : 0))),
    );
    const rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((a, v) => a + v, 0)),
      tableH = rowH.reduce((a, v) => a + v, 0);
    // heads: Total sits right-aligned over the numbers; Tally over the marks, or from the column start when long
    const headOpt = (str, maxW) => {
      const o = { cls: "ts-label", maxW, maxLines: Math.min(hl, two ? 2 : 3), lh: 30, a: hA };
      const q = textBlock(tmp, 0, 0, str, o);
      return /…$/.test(q.lines[q.lines.length - 1]) && !/…$/.test(str)
        ? Object.assign(o, { cls: "ts-tiny", maxLines: hl })
        : o;
    };
    const totO = headOpt(totS, totMax),
      tot = textBlock(tmp, 0, 0, totS, totO);
    const tallyX0 = iconW + nameW + 18,
      numX0 = colW - 8,
      talRoom = numX0 - totW - 28;
    const talX = measure(tmp, talS, "ts-label", hA) <= talRoom - tallyX0 ? tallyX0 : 0;
    const talO = headOpt(talS, talRoom - talX),
      tal = textBlock(tmp, 0, 0, talS, talO);
    const headH = Math.max(44, ...[tot, tal].map((q) => 30 + (q.lines.length - 1) * q.lh + 14));
    return {
      iconW,
      nameW,
      names,
      rowH,
      rowY,
      tableH,
      th: base - 14,
      headH,
      hA,
      totO,
      talO,
      totS,
      talS,
      talX,
    };
  };
  let g;
  for (const [ml, hl] of [
    [3, 3],
    [2, 3],
    [2, 2],
    [1, 2],
  ]) {
    g = plan(two ? Math.min(ml, 2) : ml, hl);
    if (g.headH + g.tableH <= budget) break;
  }
  tmp.remove();
  return g;
}

/* legend rows under the scene (icon and name, as each kind is found), which become the tally table.
   One place: two columns. Two places: one table under each scene, its columns under that scene. */
function drawTable(root, P, ctx, { two, kL, kC, kW, kT, bandY, tg, boxes }) {
  const Cr = P.creatures;
  const { iconW, nameW, names, headH, th, rowH, rowY } = tg;
  const g = h("g", { c: `${kW}-${kT}:off` }, root); // the why build has the band to itself
  const colW = two ? boxes[0].w : (GRID.right - GRID.left - 48) / 2;
  const colX = two ? boxes.map((bx) => bx.x) : [GRID.left, GRID.left + colW + 48];
  const cells = two
    ? [0, 1].flatMap((j) => Cr.map((c, i) => ({ i, j, col: j, row: i })))
    : Cr.map((c, i) => ({ i, j: 0, col: i % 2, row: Math.floor(i / 2) }));
  const geo = (x) => {
    const tallyX = x + iconW + nameW + 18,
      numX = x + colW - 8;
    return { tallyX, numX, tsc: clamp((numX - NUM_W - tallyX) / 240, 0.7, 1.2) };
  };
  // header row per column: Tally / Total
  const usedCols = [...new Set(cells.map((q) => q.col))];
  for (const col of usedCols) {
    const x = colX[col],
      { numX } = geo(x);
    const hg = h("g", { s: kT, cls: "rise" }, g);
    textBlock(
      hg,
      x + tg.talX,
      bandY + 30,
      tg.talS,
      Object.assign({}, tg.talO, { edit: "text.label:tallyHead" }),
    );
    textBlock(
      hg,
      numX,
      bandY + 30,
      tg.totS,
      Object.assign({}, tg.totO, { anchor: "end", edit: "text.label:totalHead" }),
    );
    h(
      "line",
      {
        x1: x,
        x2: x + colW,
        y1: bandY + headH,
        y2: bandY + headH,
        stroke: "var(--rule)",
        "stroke-width": "var(--sw-rule)",
      },
      hg,
    );
  }
  for (const { i, j, col, row } of cells) {
    const c = Cr[i],
      x = colX[col],
      { tallyX, numX, tsc } = geo(x);
    const pitch = rowH[row],
      y0 = bandY + headH + rowY[row],
      cy = y0 + pitch / 2;
    const rg = h(
      "g",
      { s: cnt(c, j) ? kL(j) : kT, cls: "rise", delay: 1200 + i * 150, c: `${kC}-${kW}:quiet` },
      g,
    );
    const z = creatureSize(c.kind);
    const s1 = Math.min(56 / z.w, 32 / z.h);
    if (iconW && fitsArt(c.kind, nameOf(P, i)))
      drawCreature(rg, c.kind, x + iconW / 2 - 4, cy + (z.h * s1) / 2, s1);
    const q = names[i],
      one = q.n === 1 && q.cls === "ts-label";
    textBlock(rg, x + iconW, cy + (one ? 10 : 7) - ((q.n - 1) * q.lh) / 2, nameOf(P, i), {
      cls: q.cls,
      maxW: nameW,
      maxLines: q.maxLines,
      lh: 22,
      edit: `creatures.${i}.name`,
      a: { fill: "var(--ink)" },
    });
    h(
      "line",
      {
        x1: x,
        x2: x + colW,
        y1: y0 + pitch,
        y2: y0 + pitch,
        stroke: "var(--rule)",
        "stroke-width": "var(--sw-hair)",
      },
      rg,
    );
    const v = cnt(c, j);
    const mg = h("g", { s: kT, cls: "rise", delay: 200 + i * 250 }, g);
    if (v)
      tally(
        h("g", { transform: `translate(${tallyX + 8 * tsc} ${cy + th / 2}) scale(${tsc})` }, mg),
        0,
        0,
        v,
        { h: th / tsc, col: "var(--ink)" },
      );
    computed(
      T(mg, numX, cy + 11, String(v), "ts-label", {
        cls: "strong",
        fill: "var(--ink)",
        "text-anchor": "end",
      }),
      `creatures.${i}.${cntKey(j)}`,
    );
  }
}

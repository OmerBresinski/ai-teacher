// Forces and magnets: one object with its forces drawn to scale (arrow length = size), what the
// forces do to its motion, and up to two more panels that change one factor (the surface, the
// parachute, the shape) to compare. A magnets mode shows pairs of bar magnets that attract or
// repel, worked out from the facing poles. Built only on the kit.

import { apparatus, forceArrow } from "../kit/batch-E.js";
import {
  computed,
  editable,
  eIO,
  GRID,
  h,
  headD,
  nameFits,
  noteArt,
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
  W,
  withDefaults,
} from "../kit/index.js";

export const meta = {
  id: "forces_magnets",
  name: "Forces and magnets",
  kind: "scene",
  version: 1,
  subjects: ["Science"],
  years: ["Y3", "Y4", "Y5", "Y6"],
  teaches:
    "Forces are pushes and pulls with a size and a direction; balanced forces leave motion unchanged, unbalanced forces speed things up, slow them down or start them moving, and magnets attract or repel by their poles.",
};

/* ------------------------------------------------------------------ the science, as data */
const CONTEXTS = ["push", "friction", "air", "water", "gravity", "magnets"];
const CTX = {
  push: { obj: "box", axis: "h", ground: "floor" },
  friction: { obj: "car", axis: "h", ground: "surface" },
  air: { obj: "chute", axis: "v", ground: "none" },
  water: { obj: "boat", axis: "h", ground: "water" },
  gravity: { obj: "ball", axis: "v", ground: "grass" },
};
const KINDS = {
  push: { word: "Push", role: "drive" },
  pull: { word: "Pull", role: "drive" },
  friction: { word: "Friction", role: "resist", medium: "surface" },
  air: { word: "Air resistance", role: "resist", medium: "air" },
  water: { word: "Water resistance", role: "resist", medium: "water" },
  gravity: { word: "Gravity", role: "gravity" },
  upthrust: { word: "Upthrust", role: "up" },
};
const KIND_KEYS = Object.keys(KINDS);
const COL = {
  drive: ["var(--focus)", "var(--focus-text)"],
  resist: ["var(--heat)", "var(--heat-text)"],
  gravity: ["var(--compare)", "var(--compare-text)"],
  up: ["var(--water)", "var(--water-text)"],
};
// a factor belongs to one context and governs one force; rank orders how much of that force it gives
// (only orderings that are reliably true are ranked apart: ice < polished wood < rougher surfaces)
const FACTORS = {
  none: { ctx: null, rank: 0, word: "" },
  ice: { ctx: "friction", rank: 1, word: "Ice" },
  polished: { ctx: "friction", rank: 2, word: "Polished wood" },
  tarmac: { ctx: "friction", rank: 3, word: "Tarmac" },
  carpet: { ctx: "friction", rank: 3, word: "Carpet" },
  grass: { ctx: "friction", rank: 3, word: "Grass" },
  sandpaper: { ctx: "friction", rank: 3, word: "Sandpaper" },
  "no-chute": { ctx: "air", rank: 0, word: "No parachute" },
  small: { ctx: "air", rank: 1, word: "Small parachute" },
  large: { ctx: "air", rank: 2, word: "Large parachute" },
  streamlined: { ctx: "water", rank: 1, word: "Streamlined" },
  flat: { ctx: "water", rank: 2, word: "Flat front" },
};
const FKEYS = Object.keys(FACTORS);
const GOVERNS = { friction: "friction", air: "air", water: "water" };
const GROUND = { push: "floor", friction: "surface", water: "water" };
const DIRS = ["left", "right", "up", "down"];
const OPP = { left: "right", right: "left", up: "down", down: "up" };
const VEC = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], still: [0, 0] };
const lc = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
// some directions follow from the science, so they are carried, not refused: resistance points against
// the motion, gravity down, upthrust up. A stored direction that disagrees is drawn the true way, with a warning.
function trueDir(P, f) {
  const K = KINDS[f.kind];
  if (K.role === "resist" && P.motion !== "still") return OPP[P.motion];
  if (f.kind === "gravity") return "down";
  if (f.kind === "upthrust") return "up";
  return f.dir;
}
// Two more things follow from the science and are carried the same way, so one change at a time always works:
// - the panels change the surface, parachute or shape, which changes only its own resistance. If the force
//   that changes is another force, the panels compare that force's size instead and keep the first panel's
//   surface, parachute or shape;
// - more of the factor gives more of its resistance, so a panel's arrow is never drawn shorter than one with
//   less of the factor (it is drawn equal to it, with a warning naming the size typed).
const WHAT = { friction: "surface", air: "parachute", water: "shape" };
function settle(P0) {
  const W = [];
  if (P0.context === "magnets") return { P: P0, W };
  // the parachute falls straight down, so a sideways start is drawn falling
  if (P0.context === "air" && (P0.motion === "left" || P0.motion === "right")) {
    W.push({
      path: "motion",
      reason:
        "Here the parachute falls straight down, so it is drawn Moving down (falling). Choose Moving down, Moving up or Not moving.",
    });
    P0 = { ...P0, motion: "down" };
  }
  // water resistance needs water and friction needs a surface to rub on: in another scene the resistance
  // is that scene's own (friction on a floor or surface, air resistance in the air, water resistance on water)
  const MEDIUM = {
    push: "friction",
    friction: "friction",
    air: "air",
    gravity: "air",
    water: "water",
  };
  const NEEDS = { water: ["water"], friction: ["push", "friction"] };
  P0 = {
    ...P0,
    forces: P0.forces.map((f, i) => {
      if (!NEEDS[f.kind] || NEEDS[f.kind].includes(P0.context)) return f;
      const k = MEDIUM[P0.context];
      W.push({
        path: `forces.${i}.kind`,
        reason:
          f.kind === "water"
            ? `Water resistance only acts on things moving through water, so here it is drawn as ${lc(KINDS[k].word)}. Choose the boat scene to show water resistance.`
            : `Friction acts where two surfaces rub together, so here it is drawn as ${lc(KINDS[k].word)}. Choose a scene on a surface to show friction.`,
      });
      return { ...f, kind: k };
    }),
  };
  const forces = P0.forces.map((f, i) => {
    const d = trueDir(P0, f);
    if (d !== f.dir)
      W.push({
        path: `forces.${i}.dir`,
        reason: `${KINDS[f.kind].word} ${f.kind === "gravity" ? "always pulls down" : f.kind === "upthrust" ? "always pushes up" : "always acts against the way something moves"}, so its arrow is drawn pointing ${d}.`,
      });
    return { ...f, dir: d };
  });
  // a surface, parachute or shape from another scene is left out (each scene has its own), with a warning
  const fit = (fk, path) => {
    const F = FACTORS[fk || "none"];
    if (!F.ctx || F.ctx === P0.context) return fk || "none";
    W.push({
      path,
      reason: `${F.word} belongs with ${F.ctx === "friction" ? "friction on surfaces" : F.ctx === "air" ? "parachutes" : "boats in water"}, so this scene leaves it out. Choose ${P0.context === "friction" ? "a surface" : P0.context === "air" ? "a parachute" : P0.context === "water" ? "a shape" : "None"}.`,
    });
    return "none";
  };
  let P = {
    ...P0,
    forces,
    factor: fit(P0.factor, "factor"),
    compare: (P0.compare || []).map((c, n) => ({
      ...c,
      factor: fit(c.factor, `compare.${n}.factor`),
    })),
  };
  const vi = (P.varies || 1) - 1,
    vf = forces[vi],
    gov = GOVERNS[P.context],
    cmp = P.compare || [];
  if (!vf || !gov || !cmp.length) return { P, W };
  const facs = [P.factor, ...cmp.map((c) => c.factor || "none")];
  if (vf.kind !== gov) {
    if (new Set(facs).size > 1) {
      const keep = FACTORS[P.factor].word
        ? lc(FACTORS[P.factor].word)
        : `the same ${WHAT[P.context]}`;
      cmp.forEach((c, n) => {
        if ((c.factor || "none") !== P.factor)
          W.push({
            path: `compare.${n}.factor`,
            reason: `The panels compare the size of ${lc(KINDS[vf.kind].word)}, so every panel keeps ${keep}. To compare ${WHAT[P.context]}s, make ${lc(KINDS[gov].word)} the force that changes.`,
          });
      });
      P = { ...P, compare: cmp.map((c) => ({ ...c, factor: P.factor })) };
    }
    return { P, W };
  }
  const sizes = [vf.size, ...cmp.map((c) => c.size)];
  const rk = facs.map((k) => (FACTORS[k].ctx === P.context ? FACTORS[k].rank : null));
  const drawn = sizes.map((v, b) => {
    if (rk[b] === null) return v;
    let a = -1;
    sizes.forEach((u, q) => {
      if (rk[q] !== null && rk[q] < rk[b] && u > v && (a < 0 || u > sizes[a])) a = q;
    });
    if (a < 0) return v;
    const B = FACTORS[facs[b]],
      A = FACTORS[facs[a]],
      path = b ? `compare.${b - 1}.size` : `forces.${vi}.size`;
    W.push({
      path,
      reason: `${B.word} gives more ${lc(KINDS[gov].word)} than ${lc(A.word)}${gov === "friction" ? "" : " at the same speed"}, so its arrow cannot be shorter: it is drawn at ${sizes[a]}, not ${v}.`,
    });
    return sizes[a];
  });
  P = {
    ...P,
    forces: forces.map((f, i) => (i === vi ? { ...f, size: drawn[0] } : f)),
    compare: cmp.map((c, n) => ({ ...c, size: drawn[n + 1] })),
  };
  return { P, W };
}
const prep = (raw) => settle(withDefaults(params, raw)).P;
const MOVE_WORD = {
  still: "is not moving",
  left: "is moving to the left",
  right: "is moving to the right",
  up: "is moving up",
  down: "is falling",
};

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Forces and magnets",
  properties: {
    title: TITLE_PARAM("Forces on a moving object"),
    context: {
      type: "string",
      title: "What it shows",
      enum: CONTEXTS,
      "x-labels": [
        "Pushes and pulls",
        "Friction on surfaces",
        "Air resistance (parachute)",
        "Water resistance (boat)",
        "Gravity",
        "Magnets attract and repel",
      ],
      default: "friction",
    },
    object: {
      type: "string",
      title: "The object",
      description: 'Used in the captions, for example "toy car".',
      default: "toy car",
      maxLength: 30,
    },
    motion: {
      type: "string",
      title: "How it is moving at the start",
      enum: ["still", "left", "right", "up", "down"],
      "x-labels": [
        "Not moving",
        "Moving left",
        "Moving right",
        "Moving up",
        "Moving down (falling)",
      ],
      default: "right",
    },
    forces: {
      type: "array",
      title: "Forces on it",
      description:
        "Arrow length shows the size. Forces that point the same way are drawn end to end.",
      "x-item": "a force",
      minItems: 1,
      maxItems: 4,
      default: [{ kind: "friction", dir: "left", size: 2 }],
      items: {
        type: "object",
        required: ["kind", "dir", "size"],
        default: { kind: "push", dir: "right", size: 4 },
        properties: {
          kind: {
            type: "string",
            title: "Force",
            enum: KIND_KEYS,
            "x-labels": KIND_KEYS.map((k) => KINDS[k].word),
            default: "push",
          },
          dir: {
            type: "string",
            title: "Direction",
            enum: DIRS,
            "x-labels": ["Left", "Right", "Up", "Down"],
            default: "right",
          },
          size: {
            type: "number",
            title: "Size",
            description: "Relative size, or newtons if you show units.",
            minimum: 0.5,
            maximum: 100,
            default: 4,
          },
        },
      },
    },
    factor: {
      type: "string",
      title: "Surface, parachute or shape",
      description:
        "Surfaces for friction, parachutes for air resistance, shapes for water resistance.",
      enum: FKEYS,
      "x-labels": FKEYS.map((k) => FACTORS[k].word || "None"),
      default: "none",
    },
    varies: {
      type: "integer",
      title: "Force that changes in the comparison",
      description: "Which force (1 = first) is different in the other panels.",
      minimum: 1,
      maximum: 4,
      default: 1,
    },
    compare: {
      type: "array",
      title: "Compare: change one thing",
      description:
        "Each adds a panel with a different surface, parachute or shape, and the new size of the force that changes.",
      "x-item": "a panel",
      maxItems: 2,
      default: [],
      items: {
        type: "object",
        required: ["size"],
        default: { factor: "none", size: 4 },
        properties: {
          factor: {
            type: "string",
            title: "Surface, parachute or shape",
            enum: FKEYS,
            "x-labels": FKEYS.map((k) => FACTORS[k].word || "None"),
            default: "none",
          },
          size: {
            type: "number",
            title: "New size of the force",
            minimum: 0.5,
            maximum: 100,
            default: 4,
          },
        },
      },
    },
    balance: { type: "boolean", title: "Use the words balanced and unbalanced", default: false },
    units: {
      type: "string",
      title: "Show sizes",
      enum: ["none", "newtons"],
      "x-labels": ["No numbers (arrow length only)", "In newtons (N)"],
      default: "none",
      "x-panel": "advanced",
    },
    pairs: {
      type: "array",
      title: "Magnet pairs",
      description: "Only for magnets: the poles that face each other.",
      "x-item": "a pair",
      minItems: 1,
      maxItems: 3,
      default: [{ left: "N", right: "S" }],
      items: {
        type: "object",
        required: ["left", "right"],
        default: { left: "N", right: "N" },
        properties: {
          left: {
            type: "string",
            title: "Left magnet’s facing pole",
            enum: ["N", "S"],
            "x-labels": ["North (N)", "South (S)"],
            default: "N",
          },
          right: {
            type: "string",
            title: "Right magnet’s facing pole",
            enum: ["N", "S"],
            "x-labels": ["North (N)", "South (S)"],
            default: "S",
          },
        },
      },
    },
    // force and panel names are names, so they take the label cap and always fit whole
    text: TEXT_PARAM_FOR({
      f0: "label",
      f1: "label",
      f2: "label",
      f3: "label",
      case0: "label",
      case1: "label",
      case2: "label",
    }),
  },
};

export const presets = [
  {
    id: "y3-magnets",
    name: "Year 3: magnets attract and repel",
    params: {
      title: "Magnets attract and repel",
      context: "magnets",
      pairs: [
        { left: "N", right: "S" },
        { left: "N", right: "N" },
        { left: "S", right: "S" },
      ],
    },
  },
  {
    id: "y3-friction",
    name: "Year 3: friction on three surfaces",
    params: {
      title: "Friction on three surfaces",
      context: "friction",
      object: "toy car",
      motion: "right",
      forces: [{ kind: "friction", dir: "left", size: 2 }],
      factor: "ice",
      varies: 1,
      compare: [
        { factor: "polished", size: 3 },
        { factor: "carpet", size: 5 },
      ],
      balance: false,
      units: "none",
    },
  },
  {
    id: "y5-parachutes",
    name: "Year 5: parachutes and air resistance",
    params: {
      title: "Parachutes and air resistance",
      context: "air",
      object: "parcel",
      motion: "down",
      forces: [
        { kind: "gravity", dir: "down", size: 5 },
        { kind: "air", dir: "up", size: 2 },
      ],
      factor: "no-chute",
      varies: 2,
      compare: [
        { factor: "small", size: 4 },
        { factor: "large", size: 5 },
      ],
      balance: true,
      units: "none",
    },
  },
  {
    id: "y5-boat",
    name: "Year 5: water resistance and shape (newtons)",
    params: {
      title: "Water resistance and shape",
      context: "water",
      object: "model boat",
      motion: "right",
      forces: [
        { kind: "push", dir: "right", size: 8 },
        { kind: "water", dir: "left", size: 3 },
      ],
      factor: "streamlined",
      varies: 2,
      compare: [{ factor: "flat", size: 8 }],
      balance: true,
      units: "newtons",
      text: { "label:f0": "Motor push" },
    },
  },
];

/* ------------------------------------------------------------------ model of the data */
const fmtN = (v) => `${Math.round(v * 10) / 10} N`;
function cases(P) {
  const vi = (P.varies || 1) - 1;
  const out = [
    {
      j: 0,
      factor: P.factor,
      forces: P.forces.map((f, i) => ({ ...f, i })),
      sizePath: `forces.${vi}.size`,
    },
  ];
  (P.compare || []).forEach((c, n) =>
    out.push({
      j: n + 1,
      factor: c.factor || "none",
      forces: P.forces.map((f, i) => ({ ...f, i, size: i === vi ? c.size : f.size })),
      sizePath: `compare.${n}.size`,
    }),
  );
  return out;
}
function outcome(P, cs) {
  let nx = 0,
    ny = 0;
  for (const f of cs.forces) {
    nx += VEC[f.dir][0] * f.size;
    ny += VEC[f.dir][1] * f.size;
  }
  nx = Math.round(nx * 1000) / 1000;
  ny = Math.round(ny * 1000) / 1000;
  const m = VEC[P.motion];
  const mag = Math.hypot(nx, ny);
  let kind;
  if (!mag) kind = P.motion === "still" ? "still" : "steady";
  else if (P.motion === "still") kind = "starts";
  else {
    const dot = nx * m[0] + ny * m[1];
    kind = dot > 0 ? "speeds" : dot < 0 ? "slows" : "turns";
  }
  const netDir =
    Math.abs(nx) >= Math.abs(ny) ? (nx > 0 ? "right" : "left") : ny > 0 ? "down" : "up";
  return { kind, mag, netDir: mag ? netDir : null, nx, ny };
}
const VERB = {
  still: "stays still",
  steady: "keeps moving at a steady speed",
  speeds: "speeds up",
  slows: "slows down",
  turns: "changes direction",
};
function verb(o) {
  return o.kind === "starts"
    ? `starts moving ${o.netDir === "down" ? "down" : o.netDir === "up" ? "up" : "to the " + o.netDir}`
    : VERB[o.kind];
}
const shortResult = (o) =>
  ({
    still: "Stays still",
    steady: "Steady speed",
    speeds: "Speeds up",
    slows: "Slows down",
    starts: "Starts moving",
    turns: "Changes direction",
  })[o.kind];
const fWord = (P, f) =>
  String(txt(P, `label:f${f.i}`, KINDS[f.kind].word)).trim() || KINDS[f.kind].word;
function resultSentence(P, cs, o) {
  const name = P.object || "it";
  if (!o.mag)
    return `${P.balance ? "The forces are balanced" : "The forces are the same size"}, so the ${name} ${verb(o)}.`;
  const along = cs.forces.filter((f) => f.dir === o.netDir),
    against = cs.forces.filter((f) => f.dir === OPP[o.netDir]);
  const big = along.sort((a, b) => b.size - a.size)[0];
  const lead = P.balance ? "Unbalanced: " : "";
  if (!against.length)
    return `${lead}only ${lc(fWord(P, big))} acts this way, so the ${name} ${verb(o)}.`.replace(
      /^only/,
      "Only",
    );
  return `${lead}${P.balance ? lc(fWord(P, big)) : fWord(P, big)} is bigger than ${lc(fWord(P, against[0]))}, so ${P.balance ? "it" : `the ${name}`} ${verb(o)}.`;
}
const caseName = (P, c, j) =>
  String(txt(P, `label:case${j}`, FACTORS[c.factor].word || ["A", "B", "C"][j])).trim() ||
  FACTORS[c.factor].word ||
  ["A", "B", "C"][j];
const showCaseLabels = (P) => (P.compare || []).length > 0 || P.factor !== "none";

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P0 = withDefaults(params, raw);
  const R = schemaCheck(params, P0);
  if (R.length) return result(R);
  if (P0.context === "magnets") return result([]);
  if ((P0.varies || 1) > P0.forces.length)
    return result([
      {
        path: "varies",
        reason: `There are only ${P0.forces.length} forces, so force ${P0.varies} cannot be the one that changes. Choose a number from 1 to ${P0.forces.length}.`,
      },
    ]);
  const { P, W: Wn } = settle(P0);
  const cx = CTX[P.context],
    vi = P.varies - 1;
  // sideways scenes: the floor, surface or water holds the object up, so only forces along the motion
  if (cx.axis === "h") {
    const G = GROUND[P.context],
      holds = `The ${G} holds it up, so only show forces along the way it moves.`;
    if (P.motion === "up" || P.motion === "down")
      R.push({
        path: "motion",
        reason: `The ${P.object || "object"} moves along the ${G}, so it can only move left or right, or stay still.`,
      });
    P.forces.forEach((f, i) => {
      if (f.kind === "gravity" || f.kind === "upthrust")
        R.push({ path: `forces.${i}.kind`, reason: holds });
      else if (f.dir === "up" || f.dir === "down")
        R.push({ path: `forces.${i}.dir`, reason: holds });
    });
  }
  if (R.length) return result(R, Wn);
  // one scale for every arrow: a force too small to see next to the biggest is drawn at the shortest readable length
  {
    const CS = cases(P),
      { DS, unit } = geometry(P, CS);
    const seen = new Set();
    CS.forEach((cs, j) =>
      cs.forces.forEach((f, q) => {
        const sp = f.i === vi ? cs.sizePath : `forces.${f.i}.size`;
        if (DS[j].forces[q].size > f.size + 1e-9 && !seen.has(sp)) {
          seen.add(sp);
          Wn.push({
            path: sp,
            reason: `The arrows share one scale, so a force of ${f.size} would be too short to see next to the biggest one. Its arrow is drawn longer than to scale; make it at least ${Math.ceil((MIN_ARROW / unit) * 10) / 10} to keep every arrow to scale.`,
          });
        }
      }),
    );
  }
  // truth rules on every panel
  for (const cs of cases(P)) {
    for (const f of cs.forces) {
      const K = KINDS[f.kind],
        path = `forces.${f.i}`,
        sp = f.i === vi ? cs.sizePath : `${path}.size`;
      if (K.role === "resist") {
        if (P.motion === "still" && f.kind !== "friction")
          R.push({
            path: "motion",
            reason: `${K.word} only acts on something moving through the ${K.medium}. Set it moving, or take this force out.`,
          });
        if (P.motion === "still" && f.kind === "friction") {
          const ax = VEC[f.dir];
          let app = 0;
          for (const g of cs.forces)
            if (g !== f) app += VEC[g.dir][0] * ax[0] * g.size + VEC[g.dir][1] * ax[1] * g.size;
          if (app >= 0)
            R.push({
              path: `${path}.dir`,
              reason:
                "On something that is not moving, friction only pushes back against a push or pull. Add a push the other way, or point friction against it.",
            });
          else if (f.size > -app)
            R.push({
              path: sp,
              reason: `Friction can stop a still object moving, but it cannot be bigger than the push or pull (${-app}). Set friction to ${-app} or less.`,
            });
        }
      }
    }
    if (R.length) break;
  }
  return result(R, Wn);
}

/* ------------------------------------------------------------------ builds */
const POLE = { N: "north pole", S: "south pole" };
const attracts = (pr) => pr.left !== pr.right;
function forceCaption(P, f) {
  const w = fWord(P, f),
    name = P.object || "object",
    d = f.dir === "up" ? "upwards" : f.dir === "down" ? "downwards" : `to the ${f.dir}`;
  return {
    push: `${w} pushes the ${name} ${d}.`,
    pull: `${w} pulls the ${name} ${d}.`,
    friction: `${w} acts against the way it moves, ${d}.`,
    air:
      f.dir === "up" && P.motion === "down"
        ? `${w} pushes up against the falling ${name}.`
        : `${w} acts against the way it moves, ${d}.`,
    water: `${w} acts against the way it moves, ${d}.`,
    gravity: `${w} pulls the ${name} down, towards the centre of the Earth.`,
    upthrust: `${w} pushes the ${name} up.`,
  }[f.kind];
}
const gravityFirst = (P, c0) =>
  CTX[P.context].axis === "v" ? c0.forces.find((f) => f.kind === "gravity") || null : null;
function plan(P) {
  const items = [];
  if (P.context === "magnets") {
    P.pairs.forEach((pr, i) => {
      items.push({ key: `pair:${i}`, caption: `A ${POLE[pr.left]} faces a ${POLE[pr.right]}.` });
      items.push({
        key: `res:${i}`,
        caption: attracts(pr)
          ? "Opposite poles attract: the magnets pull together."
          : "Like poles repel: the magnets push apart.",
      });
    });
    const kinds = new Set(P.pairs.map(attracts));
    const summary =
      kinds.size > 1
        ? "Opposite poles attract. Like poles repel."
        : kinds.has(true)
          ? "Opposite poles attract."
          : "Like poles repel.";
    return { items, summary };
  }
  const CS = cases(P),
    vi = P.varies - 1;
  const name = P.object || "object";
  const c0 = CS[0];
  // in falling scenes gravity is there from the start, so it comes in with the object
  const gF = gravityFirst(P, c0);
  items.push({
    key: "obj",
    caption: `The ${name} ${MOVE_WORD[P.motion]}${c0.factor !== "none" && P.context === "friction" ? ` on ${lc(FACTORS[c0.factor].word)}` : ""}.${gF ? " " + forceCaption(P, gF) : ""}`,
  });
  c0.forces.forEach((f) => {
    if (f !== gF) items.push({ key: `f:${f.i}`, caption: forceCaption(P, f) });
  });
  const o0 = outcome(P, c0);
  items.push({ key: "result", caption: resultSentence(P, c0, o0) });
  CS.slice(1).forEach((cs) => {
    const o = outcome(P, cs),
      s0 = c0.forces[vi].size,
      s1 = cs.forces[vi].size,
      w = lc(fWord(P, cs.forces[vi]));
    const more = s1 > s0 ? "more" : s1 < s0 ? "less" : "the same";
    let v = verb(o);
    if (o.kind === o0.kind && o.mag !== o0.mag && (o.kind === "speeds" || o.kind === "slows"))
      v += o.mag > o0.mag ? " more quickly" : " more slowly";
    const where = FACTORS[cs.factor].word ? `${FACTORS[cs.factor].word}: ` : "";
    items.push({
      key: `cmp:${cs.j}`,
      caption: `${where}${more === "the same" ? "the same" : more} ${w}, so it ${v}.`.replace(
        /^(\w)/,
        (m) => m.toUpperCase(),
      ),
    });
  });
  let summary;
  if (CS.length > 1) {
    const f = c0.forces[vi],
      K = KINDS[f.kind];
    summary =
      K.role === "resist"
        ? `The more ${lc(fWord(P, f))}, the more it holds the ${name} back.`
        : `Change the ${lc(fWord(P, f))} and the motion changes.`;
  } else
    summary = o0.mag
      ? "Unbalanced forces change how something moves."
      : "Balanced forces leave the motion as it was.";
  return { CS, items, summary };
}
export function builds(P) {
  P = prep(P);
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

export function notes(P) {
  P = prep(P);
  const { items } = plan(P);
  const steps = items.map((it) => {
    const [k, n] = it.key.split(":");
    if (k === "pair")
      return "Ask: predict. Will these two ends pull together or push apart? Try it with real magnets.";
    if (k === "res")
      return attracts(P.pairs[+n])
        ? "A north pole and a south pole attract. Magnets can act without touching: the force works across the gap."
        : "Two of the same pole repel. Ask: how could you make them attract? (Turn one magnet round.)";
    if (k === "obj")
      return (
        "Ask: what forces are acting on it? Which way is each one pushing or pulling?" +
        (P.context !== "magnets" && gravityFirst(P, cases(P)[0])
          ? " Gravity pulls everything towards the centre of the Earth; weight is the force of gravity on an object."
          : "")
      );
    if (k === "f") {
      const f = P.forces[+n];
      return (
        {
          push: "A push or pull is a force. The longer the arrow, the bigger the force.",
          pull: "A push or pull is a force. The longer the arrow, the bigger the force.",
          friction:
            "Friction acts between two surfaces and always works against the movement. Rougher surfaces usually give more friction.",
          air: "Air resistance acts against the movement through air. A bigger parachute catches more air, so at the same speed there is more air resistance.",
          water:
            "Water resistance acts against the movement through water. A streamlined shape lets water flow past more easily.",
          gravity:
            'Gravity pulls everything towards the centre of the Earth. Wherever you stand on Earth, "down" points to the centre. Weight is the force of gravity on an object.',
          upthrust: "Upthrust is the push up from water (or air) on things in it.",
        }[f.kind] + " Not all forces are shown, only the ones this lesson is about."
      );
    }
    if (k === "result")
      return (
        "Balanced forces do not stop something moving: if it was moving, it carries on at the same speed in the same direction." +
        (CTX[P.context].axis === "h"
          ? " The dots mark where it is at equal times: wider gaps mean faster, and a shorter trail means it stops sooner."
          : " The streaks show how fast it falls: longer streaks mean faster.")
      );
    return (
      "Only one thing changes between panels, so it is a fair comparison. The arrows use the same scale in every panel." +
      (P.context === "air"
        ? " The forces are compared at the same falling speed; once the parachute slows down, air resistance drops until the forces balance."
        : "")
    );
  });
  return {
    steps,
    summary:
      "Ask: what would happen if one force were removed? Arrow lengths are to scale with each other, not with the real object.",
  };
}

/* ------------------------------------------------------------------ objects */
// What each context's art shows. The picture follows the object's name: a name the art is not (a sledge
// on the friction car, a skydiver on the air parcel) draws a labelled card the same size, never the car
// or the parcel. The push box is a plain block, so it stands for any object.
export const OBJ_ART = {
  car: ["car", "toy car", "model car", "truck", "lorry", "van", "vehicle", "toy truck"],
  chute: [
    "parcel",
    "box",
    "package",
    "toy",
    "object",
    "parachute",
    "toy parachute",
    "parcel with a parachute",
  ],
  boat: ["boat", "model boat", "toy boat", "ship", "yacht", "canoe", "raft", "sailing boat"],
  ball: ["ball", "football", "tennis ball", "rubber ball", "bouncy ball", "netball", "basketball"],
};
const objFits = (kind, name) => kind === "box" || nameFits(name, OBJ_ART[kind]);
function dims(kind, factor) {
  return Object.assign(
    { kind, factor },
    {
      box: { w: 110, h: 90 },
      car: { w: 124, h: 64 },
      ball: { w: 72, h: 72 },
      boat: { w: 170, h: 60 },
      chute:
        factor === "no-chute" ? { w: 88, h: 80 } : { w: factor === "large" ? 200 : 132, h: 156 },
    }[kind],
  );
}
function drawObj(g, kind, factor, X0, Y0, flip, sc = 1) {
  const d = dims(kind, factor),
    x0 = 0,
    y0 = 0,
    cx = d.w / 2;
  const wrap = h(
    "g",
    {
      transform: flip
        ? `translate(${X0 + d.w * sc} ${Y0}) scale(${-sc} ${sc})`
        : `translate(${X0} ${Y0}) scale(${sc})`,
    },
    g,
  );
  const m = local(wrap, d, x0, y0, cx);
  return { mid: Y0 + m * sc };
}
// a cardboard parcel with a band of tape
function parcel(wrap, x, y, w, hh) {
  h("rect", { x, y, width: w, height: hh, rx: "var(--r-mark)", fill: "var(--crust)" }, wrap);
  h("rect", { x: x + w / 2 - 6, y, width: 12, height: hh, fill: "var(--cheese)" }, wrap);
}
function local(wrap, d, x0, y0, cx) {
  const kind = d.kind,
    factor = d.factor;
  if (kind === "box") {
    h(
      "rect",
      { x: x0, y: y0, width: d.w, height: d.h, rx: "var(--r-mark)", fill: "var(--wood-1)" },
      wrap,
    );
    for (let i = 1; i < 4; i++)
      h(
        "line",
        {
          x1: x0 + 6,
          x2: x0 + d.w - 6,
          y1: y0 + (i * d.h) / 4,
          y2: y0 + (i * d.h) / 4,
          stroke: "var(--wood-line)",
          "stroke-width": "var(--sw-hair)",
        },
        wrap,
      );
    return y0 + d.h / 2;
  }
  if (kind === "car") {
    // a toy car: rounded body, bubble cabin with a window, big wheels (faces right)
    h(
      "path",
      {
        d: `M${x0 + 30} ${y0 + 26} Q ${x0 + 36} ${y0} ${x0 + 62} ${y0} Q ${x0 + 88} ${y0} ${x0 + 96} ${y0 + 26} Z`,
        fill: "var(--hue-gold)",
      },
      wrap,
    );
    h(
      "path",
      {
        d: `M${x0 + 44} ${y0 + 24} Q ${x0 + 48} ${y0 + 9} ${x0 + 62} ${y0 + 9} Q ${x0 + 78} ${y0 + 9} ${x0 + 84} ${y0 + 24} Z`,
        fill: "var(--air)",
      },
      wrap,
    );
    h(
      "path",
      {
        d: `M${x0 + 4} ${y0 + 50} Q ${x0} ${y0 + 26} ${x0 + 20} ${y0 + 24} H ${x0 + 108} Q ${x0 + 124} ${y0 + 26} ${x0 + 122} ${y0 + 50} Z`,
        fill: "var(--hue-gold)",
      },
      wrap,
    );
    h(
      "rect",
      { x: x0 + 110, y: y0 + 30, width: 8, height: 7, rx: "var(--r-mark)", fill: "var(--paper)" },
      wrap,
    );
    for (const wx of [x0 + 30, x0 + 94]) {
      h("circle", { cx: wx, cy: y0 + 50, r: 14, fill: "var(--ink-2)" }, wrap);
      h("circle", { cx: wx, cy: y0 + 50, r: 6, fill: "var(--metal)" }, wrap);
    }
    return y0 + 37;
  }
  if (kind === "ball") {
    h("circle", { cx, cy: y0 + 36, r: 36, fill: "var(--item)" }, wrap);
    h(
      "path",
      {
        d: `M${cx - 36} ${y0 + 36} Q ${cx} ${y0 + 54} ${cx + 36} ${y0 + 36}`,
        fill: "none",
        stroke: "var(--shade)",
        "stroke-width": "var(--sw-struct)",
      },
      wrap,
    );
    return y0 + 36;
  }
  if (kind === "boat") {
    const hull =
      factor === "flat"
        ? `M${x0} ${y0 + 28} H ${x0 + 170} V ${y0 + 60} H ${x0 + 12} Z`
        : `M${x0} ${y0 + 28} H ${x0 + 118} Q ${x0 + 160} ${y0 + 28} ${x0 + 170} ${y0 + 34} Q ${x0 + 150} ${y0 + 60} ${x0 + 110} ${y0 + 60} H ${x0 + 12} Z`;
    h(
      "rect",
      { x: x0 + 30, y: y0 + 4, width: 60, height: 26, rx: "var(--r-mark)", fill: "var(--metal)" },
      wrap,
    );
    h("path", { d: hull, fill: "var(--hull)" }, wrap);
    return y0 + 36;
  }
  // parachute: canopy, strings, parcel; or the parcel alone
  if (factor === "no-chute") {
    parcel(wrap, x0, y0, d.w, d.h);
    return y0 + d.h / 2;
  }
  const r = d.w / 2,
    ly = y0 + 92;
  for (const sx of [-r + 4, -r * 0.4, r * 0.4, r - 4])
    h(
      "line",
      {
        x1: cx + sx,
        y1: y0 + 52,
        x2: cx + (sx < 0 ? -26 : 26),
        y2: ly,
        stroke: "var(--ink-3)",
        "stroke-width": "var(--sw-hair)",
      },
      wrap,
    );
  h(
    "path",
    { d: `M${cx - r} ${y0 + 52} A ${r} 52 0 0 1 ${cx + r} ${y0 + 52} Z`, fill: "var(--cloth-1)" },
    wrap,
  );
  parcel(wrap, cx - 36, ly, 72, 64);
  return y0 + 70;
}
const SURF = {
  ice: ["var(--ice-top)", null],
  polished: ["var(--wood-1)", "var(--wood-line)"],
  tarmac: ["var(--road)", "var(--road-line)"],
  carpet: ["var(--cloth-2)", "var(--cloth-3)"],
  grass: ["var(--hill-near)", "var(--hill-shade)"],
  sandpaper: ["var(--sand)", "var(--sand-shade)"],
  none: ["var(--bench-top)", null],
};
function surface(g, fk, x0, x1, y, hgt) {
  const [fill, mark] = SURF[fk] || SURF.none;
  h("rect", { x: x0, y, width: x1 - x0, height: hgt, fill }, g);
  h(
    "line",
    { x1: x0, x2: x1, y1: y, y2: y, stroke: "var(--rule)", "stroke-width": "var(--sw-rule)" },
    g,
  );
  if (!mark) return;
  // texture shows roughness: none on ice, fine lines on wood, dense marks on rough surfaces
  const step = fk === "polished" ? 40 : 14;
  for (let x = x0 + 8, i = 0; x < x1 - 4; x += step, i++) {
    if (fk === "polished")
      h(
        "line",
        {
          x1: x,
          x2: x + 26,
          y1: y + 9 + (i % 2) * 10,
          y2: y + 9 + (i % 2) * 10,
          stroke: mark,
          "stroke-width": "var(--sw-hair)",
        },
        g,
      );
    else if (fk === "grass")
      h(
        "path",
        {
          d: `M${x} ${y} l 3 -8 l 3 8`,
          fill: "none",
          stroke: mark,
          "stroke-width": "var(--sw-hair)",
        },
        g,
      );
    else h("circle", { cx: x + (i % 3) * 3, cy: y + 6 + (i % 4) * 5, r: 2, fill: mark }, g);
  }
}

/* ------------------------------------------------------------------ render */
const V0 = 140,
  V1 = 510; // room for up and down arrows (falling scenes)
const ROWS_V = { lab: V1 + 42, res: V1 + 84 };
const SX0 = 380; // sideways scenes: names and results sit in the column left of SX0
const STRIP = 28; // floor, surface or water strip under a sideways lane
export function render(root, P, ctx) {
  P = prep(P);
  const { items } = plan(P);
  const b = ctx.b,
    N = ctx.N;
  const bi = (k) => b[k] ?? 0;
  const dur = Object.fromEntries(
    items.map((it) => [it.key, it.key.startsWith("res") ? 1800 : 1400]),
  );
  return P.context === "magnets"
    ? renderMagnets(root, P, ctx, bi, N, dur)
    : renderForces(root, P, ctx, bi, N, dur);
}
// sideways scenes compare in full-width lanes stacked down the stage, so every build uses its final place
function lanes(n) {
  if (n === 1) return [{ y: 200, h: 320 }];
  const top = GRID.top + 16,
    lh = (GRID.bottom - top) / n;
  return Array.from({ length: n }, (_, j) => ({ y: top + j * lh, h: lh }));
}

const marred = (tb, word) => {
  const ws = new Set(String(word).split(/\s+/));
  return tb.lines.some((l) => l.endsWith("…") || l.split(" ").some((x) => x && !ws.has(x)));
};
// a force name: wraps at label size first, then drops to the smallest size with more lines, so a long edit stays whole
function fitLabel(p, x, y, word, maxW, lines1, lines2, anchor, a, edit) {
  lines1 = Math.max(1, lines1);
  lines2 = Math.max(1, lines2);
  // a name that would be cut short or split inside a word steps down to the smallest size; tb.cut says if it still is
  let tb = textBlock(p, x, y, word, {
    cls: "ts-label",
    maxW,
    maxLines: lines1,
    lh: 30,
    anchor,
    a,
    edit,
  });
  if (marred(tb, word)) {
    tb.el.remove();
    tb = textBlock(p, x, y, word, {
      cls: "ts-tiny",
      maxW,
      maxLines: lines2,
      lh: 26,
      anchor,
      a,
      edit,
    });
  }
  tb.cut = marred(tb, word);
  return tb;
}
// the slide's geometry and its one arrow scale (pure arithmetic, so validate() can check arrows are readable)
const HEAD = 16,
  MIN_ARROW = 2 * HEAD;
function geometry(P, CS0) {
  // forces too small to see are drawn at the shortest readable arrow (validate() warns); DS holds the drawn sizes
  let CS = CS0,
    g = geom1(P, CS);
  for (let it = 0; it < 8; it++) {
    const floor = MIN_ARROW / g.unit;
    const next = CS0.map((cs) => ({
      ...cs,
      forces: cs.forces.map((f) => ({ ...f, size: Math.max(f.size, floor) })),
    }));
    if (
      next.every((cs, j) =>
        cs.forces.every((f, q) => Math.abs(f.size - CS[j].forces[q].size) < 1e-6),
      )
    )
      break;
    CS = next;
    g = geom1(P, CS);
  }
  return { ...g, DS: CS };
}
function geom1(P, CS) {
  const C = CTX[P.context];
  const vert = C.axis === "v";
  const n = CS.length;
  const LN = vert ? null : lanes(n);
  const PN = vert
    ? n === 1
      ? [{ x: GRID.left, w: GRID.right - GRID.left, cx: W / 2 }]
      : panels(n)
    : null;
  const SC = vert ? 1 : n === 3 ? 1.3 : 1.4;
  const D = CS.map((cs) => {
    const d = dims(C.obj, cs.factor);
    return { w: d.w * SC, h: d.h * SC };
  });
  const mx = { left: 0, right: 0, up: 0, down: 0 };
  // forces that point the same way are drawn end to end: o = the sizes already drawn that way
  const OFF = CS.map((cs) => {
    const run = { left: 0, right: 0, up: 0, down: 0 },
      o = {},
      nth = {},
      cnt = { left: 0, right: 0, up: 0, down: 0 };
    cs.forces.forEach((f) => {
      o[f.i] = run[f.dir];
      nth[f.i] = cnt[f.dir]++;
      run[f.dir] += f.size;
    });
    for (const d in run) mx[d] = Math.max(mx[d], run[d]);
    return { o, nth };
  });
  const stacked = OFF.some((x) => Object.values(x.nth).some((v) => v > 0));
  const Wmax = Math.max(...D.map((d) => d.w)),
    Hmax = Math.max(...D.map((d) => d.h)),
    pad = 14;
  const xmin = vert ? null : SX0 + pad,
    xmax = GRID.right - pad,
    ocxS = (SX0 + GRID.right) / 2;
  // one scale for every arrow on the slide: length is proportional to the force
  const us = [64];
  if (vert) {
    if (mx.left + mx.right) us.push((PN[0].w - Wmax - 2 * pad) / (mx.left + mx.right));
    if (mx.up + mx.down) us.push((V1 - V0 - Hmax) / (mx.up + mx.down));
  } else {
    if (mx.left) us.push((ocxS - Wmax / 2 - xmin) / mx.left);
    if (mx.right) us.push((xmax - ocxS - Wmax / 2) / mx.right);
  }
  const unit = Math.min(...us);
  return { C, vert, n, LN, PN, SC, D, mx, OFF, stacked, Wmax, Hmax, pad, xmin, xmax, ocxS, unit };
}
function renderForces(root, P, ctx, bi, N, dur) {
  const { CS } = plan(P);
  const {
    C,
    vert,
    n,
    LN,
    PN,
    SC,
    D,
    mx,
    OFF,
    stacked,
    Wmax,
    Hmax,
    pad,
    xmin,
    xmax,
    ocxS,
    unit,
    DS,
  } = geometry(P, CS);
  const kObj = bi("obj"),
    kRes = bi("result");
  const OUT = CS.map((cs) => outcome(P, cs));
  // motion trails: same scale on every panel, so a shorter trail means it stops sooner
  const BASE = {
    speeds: [16, 28, 40, 52],
    steady: [34, 34, 34, 34],
    slows: [52, 40, 28, 16],
    starts: [10, 18, 26, 34],
    turns: [34, 34, 34, 34],
    still: [],
  };
  const mags = (k) => OUT.filter((o) => o.kind === k).map((o) => o.mag);
  const fac = (o) =>
    o.kind === "slows"
      ? Math.min(...mags("slows")) / o.mag
      : o.kind === "speeds" || o.kind === "starts"
        ? o.mag / Math.max(...mags(o.kind))
        : 1;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const longest = Math.max(1, ...OUT.map((o) => sum(BASE[o.kind]) * fac(o)));
  const trailRoom = GRID.right - 20 - (ocxS + Wmax / 2 + 30);
  const lastCmp = n > 1 ? bi(`cmp:${n - 1}`) : kRes;
  const sameKind = OUT.every((o) => o.kind === OUT[0].kind);

  // where a falling (or rising) panel draws its speed streaks, so names in the panel before keep clear of them
  const streakBox = (jj) => {
    const o = OUT[jj],
      v = VEC[o.kind === "starts" ? o.netDir : P.motion] || [0, 0];
    if (!v[1]) return null;
    const pp = PN[jj],
      dd = D[jj],
      slackH = pp.w - 2 * pad - Wmax - (mx.left + mx.right) * unit,
      slackV = V1 - V0 - Hmax - (mx.up + mx.down) * unit;
    const x0 = pp.x + pad + mx.left * unit + slackH / 2 + (Wmax - dd.w) / 2,
      y0 = V0 + mx.up * unit + slackV / 2 + (Hmax - dd.h);
    const sl =
      { speeds: 40 + 50 * fac(o), starts: 40 + 50 * fac(o), steady: 44, slows: 22, turns: 44 }[
        o.kind
      ] || 0;
    const ys = v[1] > 0 ? [y0 + 22 - sl - 4, y0 + 44] : [y0 + dd.h - 52, y0 + dd.h - 30 + sl + 4];
    return { x: x0 - 62, y: ys[0], w: 48, h: ys[1] - ys[0] };
  };
  // the scene behind
  const scene = h("g", {}, root);
  if (C.ground === "grass") surface(scene, "grass", 0, W, V1 + 6, 10);
  if (P.context === "air") sky(scene, ctx, GRID.foot);

  CS.forEach((cs, j) => {
    const d = D[j],
      k = j === 0 ? kObj : bi(`cmp:${j}`),
      o = OUT[j];
    const g = h("g", { s: k, cls: j ? "rise" : null }, root);
    let x0,
      y0,
      gy = 0,
      p = null;
    if (vert) {
      p = PN[j];
      const slackH = p.w - 2 * pad - Wmax - (mx.left + mx.right) * unit;
      x0 = p.x + pad + mx.left * unit + slackH / 2 + (Wmax - d.w) / 2;
      const slackV = V1 - V0 - Hmax - (mx.up + mx.down) * unit;
      y0 = V0 + mx.up * unit + slackV / 2 + (Hmax - d.h);
    } else {
      const L = LN[j];
      gy = L.y + L.h - STRIP - 12;
      x0 = ocxS - d.w / 2;
      y0 = C.obj === "boat" ? gy + 12 * SC - d.h : gy - d.h;
      if (C.ground === "surface") surface(g, cs.factor, 0, W, gy, STRIP);
      if (C.ground === "floor") surface(g, "none", 0, W, gy, STRIP);
    }
    const flip = (C.obj === "boat" || C.obj === "car") && P.motion === "left";
    const dd = dims(C.obj, cs.factor),
      fitsArt = objFits(C.obj, P.object);
    const info = fitsArt
      ? drawObj(g, C.obj, cs.factor, x0, y0, flip, SC)
      : (pictureCard(g, P.object, x0 + (dd.w * SC) / 2, y0 + dd.h * SC, {
          w: dd.w * SC,
          h: dd.h * SC,
          model: "forces_magnets",
          hint: C.obj,
        }),
        { mid: y0 + (dd.h * SC) / 2 });
    if (fitsArt) noteArt(P.object || C.obj, C.obj);
    if (C.obj === "boat") {
      h("rect", { x: 0, y: gy, width: W, height: STRIP, fill: "var(--sea-1)" }, g);
      h(
        "line",
        { x1: 0, x2: W, y1: gy, y2: gy, stroke: "var(--water)", "stroke-width": "var(--sw-rule)" },
        g,
      );
    }
    const ocx = x0 + d.w / 2;

    // names and results: under each column (falling) or in the left column of each lane (sideways)
    const showRes = vert || j === 0 || !sameKind;
    const kr = j === 0 ? (sameKind && n > 1 && !vert ? lastCmp : kRes) : k,
      dl = j === 0 ? 0 : 900;
    const rg = h("g", { s: kr, delay: dl }, g);
    if (vert) {
      let extra = 0;
      const rowGap = 34;
      if (showCaseLabels(P)) {
        const cb = textBlock(g, p.cx, ROWS_V.lab, caseName(P, cs, j), {
          cls: "ts-label",
          maxW: p.w - 16,
          maxLines: 2,
          lh: 30,
          anchor: "middle",
          a: { fill: "var(--ink)" },
          edit: `text.label:case${j}`,
        });
        extra = cb.lines.length > 1 ? cb.lh - 10 : 0;
      }
      const ry = ROWS_V.res + extra;
      computed(
        textBlock(rg, p.cx, ry, shortResult(o), {
          cls: "ts-label",
          maxW: p.w - 16,
          maxLines: 1,
          anchor: "middle",
          a: { fill: "var(--ink)", cls: "strong" },
        }).el,
        cs.sizePath,
      );
      if (P.balance)
        computed(
          textBlock(rg, p.cx, ry + rowGap, o.mag ? "unbalanced forces" : "balanced forces", {
            cls: "ts-label",
            maxW: p.w - 16,
            maxLines: 1,
            anchor: "middle",
            a: { fill: "var(--ink-2)" },
          }).el,
          cs.sizePath,
        );
    } else {
      const colW = SX0 - GRID.left - 24;
      const slots = (showCaseLabels(P) ? 1 : 0) + 1 + (P.balance ? 1 : 0);
      let sl = gy - 18 - 36 * (slots - 1); // the last row keeps clear of the ground line
      if (showCaseLabels(P)) {
        const room = sl - (LN[j].y + 24);
        const cb = fitLabel(
          g,
          GRID.left,
          sl,
          caseName(P, cs, j),
          colW,
          Math.max(1, Math.floor(room / 30) + 1),
          Math.max(1, Math.floor(room / 26) + 1),
          "start",
          { fill: "var(--ink)", cls: "strong" },
          `text.label:case${j}`,
        );
        if (cb.lines.length > 1) cb.el.setAttribute("y", sl - (cb.h - cb.lh));
        sl += 36;
      }
      if (showRes) {
        computed(
          textBlock(rg, GRID.left, sl, shortResult(o), {
            cls: "ts-label",
            maxW: colW,
            maxLines: 1,
            anchor: "start",
            a: { fill: "var(--ink-2)" },
          }).el,
          cs.sizePath,
        );
        if (P.balance)
          computed(
            textBlock(rg, GRID.left, sl + 36, o.mag ? "unbalanced forces" : "balanced forces", {
              cls: "ts-label",
              maxW: colW,
              maxLines: 1,
              anchor: "start",
              a: { fill: "var(--ink-2)" },
            }).el,
            cs.sizePath,
          );
      }
    }

    // forces: each drawn from the object's edge in its direction (end to end when two point the same way),
    // its name clear of the arrow
    const placed = [];
    const hits = (bx) =>
      placed.some(
        (q) =>
          bx.x < q.x + q.w + 12 &&
          q.x < bx.x + bx.w + 12 &&
          bx.y < q.y + q.h + 6 &&
          q.y < bx.y + bx.h + 6,
      );
    cs.forces.forEach((f) => {
      const kf = j === 0 ? bi(`f:${f.i}`) : k;
      const [col, tcol] = COL[KINDS[f.kind].role];
      const base = {
        left: [x0, info.mid],
        right: [x0 + d.w, info.mid],
        up: [ocx, y0],
        down: [ocx, y0 + d.h],
      }[f.dir];
      const off = OFF[j].o[f.i] * unit,
        nth = OFF[j].nth[f.i],
        vv = VEC[f.dir];
      const at = [base[0] + vv[0] * off, base[1] + vv[1] * off];
      const fg = h("g", { s: kf, c: j === 0 ? ctx.rc(`f:${f.i}`, "result") : null }, g);
      const dsz = DS[j].forces.find((q) => q.i === f.i).size;
      const A = forceArrow(ctx, fg, at, f.dir, dsz, null, { unit, col });
      const [shaft, head] = A.g.children;
      shaft.setAttribute("pathLength", 1);
      shaft.dataset.s = kf;
      shaft.classList.add("draw");
      head.dataset.s = kf;
      head.style.setProperty("--d", "calc(700ms * var(--pace))");
      const len = dsz * unit,
        horiz = f.dir === "left" || f.dir === "right";
      const word = fWord(P, f),
        sizeTxt = P.units === "newtons" ? fmtN(f.size) : null,
        sp = f.i === P.varies - 1 ? cs.sizePath : `forces.${f.i}.size`;
      const ed = `text.label:f${f.i}`,
        sz = sizeTxt ? 32 : 0;
      if (horiz) {
        // centred over its own shaft, kept clear of the object and inside the scene; a second name the same way stacks above
        const left = f.dir === "left",
          mid = at[0] + (left ? -len / 2 : len / 2),
          ly = at[1] - 30;
        const lo = vert ? p.x : xmin,
          hi = vert ? Math.min(p.x + p.w, GRID.right) : xmax;
        const room = left ? x0 - 14 - lo : hi - (x0 + d.w + 14);
        const tb = fitLabel(
          fg,
          mid,
          ly,
          word,
          Math.max(120, Math.min(room, hi - lo)),
          2,
          3,
          "middle",
          { fill: tcol, cls: "strong" },
          ed,
        );
        let top = ly;
        if (tb.lines.length > 1) top = ly - (tb.h - tb.lh);
        const half = tb.w / 2;
        let sh = left
          ? Math.min(0, x0 - 14 - (mid + half))
          : Math.max(0, x0 + d.w + 14 - (mid - half));
        sh += Math.max(0, lo - (mid + sh - half));
        sh -= Math.max(0, mid + sh + half - hi);
        const box = () => ({
          x: mid + sh - half,
          y: top - 24 - sz,
          w: tb.w,
          h: (tb.lines.length - 1) * tb.lh + 30 + sz,
        });
        for (let guard = 0; guard < 4 && hits(box()); guard++) top -= box().h + 6;
        placed.push(box());
        tb.el.setAttribute("y", top);
        if (sh) tb.el.setAttribute("transform", `translate(${sh.toFixed(1)} 0)`);
        if (tb.cut) ctx.warn(`force label ${f.i + 1} is too long to fit`);
        if (sizeTxt)
          computed(
            T(fg, mid + sh, top - 32, sizeTxt, "ts-label", {
              "text-anchor": "middle",
              fill: tcol,
              cls: "strong",
            }),
            sp,
          );
      } else {
        // beside the shaft, in its band: below the object for a force down (above the panel's names), above it
        // for a force up (below the title). The first name sits right of the shaft, a second one the same way left.
        const up = f.dir === "up",
          side = nth % 2 ? -1 : 1,
          anchor = side > 0 ? "start" : "end";
        // a name may use the gap up to the next panel's object, stepping in only where it would meet that panel's
        // speed streaks; the last panel stays in its own
        const sb = n > 1 && j < n - 1 ? streakBox(j + 1) : null;
        const reaches =
          n > 1 && j < n - 1 && !stacked
            ? [PN[j + 1].cx - D[j + 1].w / 2 - 14, ...(sb ? [sb.x - 14] : [])]
            : [Math.min(p.x + p.w, GRID.right)];
        const floorY =
          C.ground === "grass" ? V1 - 2 : (showCaseLabels(P) ? ROWS_V.lab : ROWS_V.res) - 38;
        // first try: next to the shaft, in its band; if that cuts the name short, step out beside the object,
        // where the band can also run alongside it
        let best = null;
        outer: for (const t of [0, 1])
          for (const reachR of reaches) {
            const lx = ocx + side * (t ? d.w / 2 + 16 : 34);
            let first = up ? GRID.top + 24 : t ? y0 + 24 : base[1] + 26,
              last = up ? (t ? y0 + d.h - 10 : base[1] - 16) - sz : floorY - sz;
            const maxW = side > 0 ? reachR - lx : lx - Math.max(p.x, GRID.left),
              x0s = side > 0 ? lx : lx - maxW;
            // share the side with a name already placed there: stay above it (up) or below it (down)
            const mine = placed.filter((q) => q.x < x0s + maxW && x0s < q.x + q.w);
            if (up) last = Math.min(last, ...mine.map((q) => q.y - 10 - sz));
            else first = Math.max(first, ...mine.map((q) => q.y + q.h + 24));
            const span = Math.max(0, last - first);
            const tb = fitLabel(
              fg,
              lx,
              first,
              word,
              Math.max(60, maxW),
              Math.min(4, Math.floor(span / 30) + 1),
              Math.min(7, Math.floor(span / 26) + 1),
              anchor,
              { fill: tcol, cls: "strong" + (C.obj === "chute" ? " halo" : "") },
              ed,
            );
            const cut = tb.cut,
              tall = (tb.lines.length - 1) * tb.lh;
            // centre it on its own stretch of shaft, then keep it inside the band
            let ly = at[1] + (up ? -len / 2 : len / 2) - tall / 2 + (sizeTxt ? -6 : 10);
            ly = Math.max(first, Math.min(ly, last - tall));
            const box = {
              x: anchor === "start" ? lx : lx - tb.w,
              y: ly - 24,
              w: tb.w,
              h: tall + 30 + sz,
            };
            const clash =
              sb &&
              box.x < sb.x + sb.w &&
              sb.x < box.x + box.w &&
              box.y < sb.y + sb.h &&
              sb.y < box.y + box.h;
            if (best) best.tb.el.remove();
            best = { tb, lx, ly, tall, cut, box };
            if (!cut && !clash) break outer;
          }
        const { tb, lx, ly, tall, cut, box } = best;
        if (cut && j > 0)
          tb.el.remove(); // the first panel names it; the repeat would not fit here
        else {
          placed.push(box);
          tb.el.setAttribute("y", ly);
          if (cut) ctx.warn(`force label ${f.i + 1} is too long to fit`);
        }
        if (sizeTxt)
          computed(
            T(fg, lx, cut && j > 0 ? ly : ly + tall + 32, sizeTxt, "ts-label", {
              "text-anchor": anchor,
              fill: tcol,
              cls: "strong" + (C.obj === "chute" ? " halo" : ""),
            }),
            sp,
          );
      }
    });

    // motion: dots at equal times ahead of a sideways object; streaks behind a falling one
    const tg = h("g", { s: j === 0 ? kRes : k, delay: dl }, g);
    const md = o.kind === "starts" ? o.netDir : P.motion;
    const v = VEC[md] || [0, 0];
    if (!vert) {
      const gaps = BASE[o.kind].map((x) => Math.max(18, (x * fac(o) * trailRoom) / longest));
      const ty = C.obj === "boat" ? gy + STRIP / 2 : gy - 10;
      let px = v[0] > 0 ? x0 + d.w + 30 : x0 - 30;
      if (v[0])
        [0, ...gaps].forEach((gp, i) => {
          px += v[0] * gp;
          h(
            "circle",
            {
              cx: px,
              cy: ty,
              r: 6,
              fill: "var(--ink-2)",
              s: j === 0 ? kRes : k,
              delay: dl + 200 + i * 220,
            },
            tg,
          );
        });
    } else if (v[1]) {
      const sl =
        { speeds: 40 + 50 * fac(o), starts: 40 + 50 * fac(o), steady: 44, slows: 22, turns: 44 }[
          o.kind
        ] || 0;
      const top = y0 - 8,
        bot = y0 + d.h;
      [
        [x0 - 18, 0],
        [x0 - 38, 18],
        [x0 - 58, 6],
      ].forEach(([sx, off]) => {
        const ya = v[1] > 0 ? top + 30 + off : bot - 30 - off,
          yb = Math.max(GRID.top + 4, Math.min(V1 - 4, ya - v[1] * sl));
        if (Math.abs(yb - ya) < 8) return;
        h(
          "line",
          {
            x1: sx,
            x2: sx,
            y1: ya,
            y2: yb,
            stroke: "var(--ink-3)",
            "stroke-width": "var(--sw-struct)",
            "stroke-linecap": "round",
          },
          tg,
        );
      });
    }
  });
  return { dur };
}

function renderMagnets(root, P, ctx, bi, N, dur) {
  const n = P.pairs.length,
    ys = { 1: [390], 2: [300, 500], 3: [240, 400, 560] }[n];
  const MW = 340,
    MH = 96,
    GAP = 140,
    X = 520,
    MV = 50,
    rows = [];
  // the magnets lie on a table
  const tTop = ys[0] - 116,
    tBot = ys[n - 1] + 70;
  h(
    "rect",
    {
      x: 24,
      y: tTop,
      width: X + GAP / 2 + MW + MV + 30 - 24,
      height: tBot - tTop,
      rx: "var(--r-card)",
      fill: "var(--bench-top)",
    },
    root,
  );
  h(
    "rect",
    {
      x: 24,
      y: tBot - 4,
      width: X + GAP / 2 + MW + MV + 30 - 24,
      height: 18,
      fill: "var(--bench-front)",
    },
    root,
  );
  P.pairs.forEach((pr, i) => {
    const y = ys[i],
      kp = bi(`pair:${i}`),
      kr = bi(`res:${i}`),
      att = attracts(pr),
      mv = att ? GAP / 2 - 10 : MV;
    const row = h("g", { s: kp }, root);
    // earlier pairs step back once a newer pair comes in; their words stay readable
    const body = h("g", { c: ctx.rc(`res:${i}`, null, "soft") }, row);
    const mags = [];
    [
      [-1, pr.left],
      [1, pr.right],
    ].forEach(([side, face]) => {
      const cx = X + side * (GAP / 2 + MW / 2);
      const mg = h("g", {}, body);
      // left magnet: its right end faces the gap; right magnet: its left end faces the gap
      const flip = side < 0 ? face === "N" : face === "S";
      const ap = apparatus(mg, "magnet", cx, y + MH / 2, 1, {}, { w: MW, h: MH, flip });
      ap.querySelectorAll("text").forEach((t) =>
        computed(t, `pairs.${i}.${side < 0 ? "left" : "right"}`),
      );
      const dir = att ? (side < 0 ? "right" : "left") : side < 0 ? "left" : "right";
      // the push or pull shows only while this pair is the one being shown
      const ag = h("g", { s: kr, hide: ctx.b[`pair:${i + 1}`] ?? N, delay: 200 }, mg);
      forceArrow(ctx, ag, [cx - (dir === "right" ? 48 : -48), y - MH / 2 - 30], dir, 6, null, {
        unit: 16,
        col: "var(--focus)",
      });
      mags.push({ g: mg, dx: (dir === "right" ? 1 : -1) * mv });
    });
    const rx = X + GAP / 2 + MW + MV + 50;
    const wg = h("g", { s: kr, delay: 600 }, row);
    computed(
      T(wg, rx, y + 2, att ? "Attract" : "Repel", "ts-h3", {
        cls: "strong",
        fill: "var(--focus-text)",
      }),
      `pairs.${i}.right`,
    );
    computed(
      textBlock(wg, rx, y + 38, att ? "opposite poles" : "like poles", {
        cls: "ts-label",
        maxW: GRID.right - rx + 40,
        maxLines: 1,
        a: { fill: "var(--ink-2)" },
      }).el,
      `pairs.${i}.right`,
    );
    rows.push({ mags, kr });
  });
  const place = (k, u) => {
    for (const r of rows) {
      const f = k < r.kr ? 0 : k === r.kr ? eIO(u) : 1;
      for (const m of r.mags)
        m.g.setAttribute("transform", `translate(${(m.dx * f).toFixed(1)} 0)`);
    }
  };
  return {
    dur,
    tick: (k, u) => place(k, u),
    reset: () => place(-1, 0),
    still: () => place(1e9, 1),
  };
}

// Mixtures and separating: one mixture, one method. Sand and water through filter paper, salt or
// sugar water evaporated, iron filings pulled out of sand by a magnet, rice or pebbles sieved.
// The method must really work for the mixture (otherwise the slide shows the method that does, with a
// warning that says why, so changing the mixture alone is never refused),
// dissolved solids go through filter paper, and mass is worked out in code so it is always kept.

import { apparatus, particleLayout } from "../kit/batch-E.js";
import {
  clamp,
  computed,
  editable,
  eIO,
  flow,
  GRID,
  h,
  lerp,
  magnifier,
  measure,
  result,
  schemaCheck,
  T,
  TEXT_PARAM_FOR,
  TITLE_PARAM,
  textBlock,
  txt,
  wavy,
  withDefaults,
} from "../kit/index.js";
import {
  baseFill,
  bowl,
  dishD,
  grain,
  hotPlate,
  moundAt,
  moundD,
  scatter,
} from "./mixtures_separating/parts.js";

export const meta = {
  id: "mixtures_separating",
  name: "Mixtures and separating",
  kind: "scene",
  version: 1,
  subjects: ["Science"],
  years: ["Y3", "Y4", "Y5", "Y6", "KS3"],
  teaches:
    "How to separate a mixture: filtering, evaporating, sieving or using a magnet, and why each works only for some mixtures.",
};

/* ------------------------------------------------------------------ the science */
// a = the part that is left behind or picked out; b = the part that passes through, falls through,
// evaporates or stays. `works` lists the methods that really separate it.
const MIX = {
  "sand-water": {
    name: "Sand and water",
    a: "Sand",
    b: "Water",
    liquid: true,
    dissolved: false,
    grainA: "sand",
    works: ["filter", "evaporate"],
  },
  "salt-water": {
    name: "Salt water",
    a: "Salt",
    b: "Water",
    liquid: true,
    dissolved: true,
    grainA: "crystal",
    limit: 36,
    works: ["evaporate"],
  },
  "sugar-water": {
    name: "Sugar water",
    a: "Sugar",
    b: "Water",
    liquid: true,
    dissolved: true,
    grainA: "crystal",
    limit: 200,
    works: ["evaporate"],
  },
  "iron-sand": {
    name: "Iron filings and sand",
    a: "Iron filings",
    b: "Sand",
    liquid: false,
    base: "sand",
    grainA: "iron",
    plural: true,
    works: ["magnet"],
  },
  "rice-flour": {
    name: "Rice and flour",
    a: "Rice",
    b: "Flour",
    liquid: false,
    base: "flour",
    grainA: "rice",
    works: ["sieve"],
  },
  "pebbles-sand": {
    name: "Pebbles and sand",
    a: "Pebbles",
    b: "Sand",
    liquid: false,
    base: "sand",
    grainA: "pebble",
    plural: true,
    works: ["sieve"],
  },
};
const MIX_KEYS = Object.keys(MIX);
const METHODS = ["filter", "evaporate", "sieve", "magnet"];
const METHOD_LABEL = { filter: "Filter", evaporate: "Evaporate", sieve: "Sieve", magnet: "Magnet" };
/** The method the slide shows: exactly the one chosen. “Whichever works” (best) picks the first that
 *  works; a chosen method that does not work is refused in validate, never swapped on the slide. */
const useMethod = (mixKey, method) => {
  const m = MIX[mixKey] || MIX["sand-water"];
  return method === "best" || !m.works.includes(method) ? m.works[0] : method;
};

/** Why a method does not work for a mixture, in teacher words (null when it works). */
function whyNot(mixKey, method) {
  const m = MIX[mixKey];
  if (method === "best" || m.works.includes(method)) return null;
  const use = `Choose “${METHOD_LABEL[m.works[0]]}” (or “Whichever works”)`;
  if (m.dissolved) {
    if (method === "filter")
      return `The ${m.a.toLowerCase()} has dissolved: its pieces are too tiny to see, so they pass through filter paper with the water. ${use} to get the ${m.a.toLowerCase()} back.`;
    if (method === "sieve")
      return `The ${m.a.toLowerCase()} has dissolved, so it goes straight through a sieve with the water. ${use} to get the ${m.a.toLowerCase()} back.`;
    return `${m.a} is not magnetic, so a magnet will not pull it out of the water. ${use}.`;
  }
  if (mixKey === "sand-water")
    return method === "sieve"
      ? `Sand grains are smaller than the holes in a sieve, so they go through with the water. ${use} to catch the sand in filter paper.`
      : `Sand is not magnetic, so a magnet will not pull it out of the water. ${use}.`;
  if (method === "filter")
    return `Filtering separates a solid from a liquid, and there is no liquid in this mixture. ${use}.`;
  if (method === "evaporate") return `There is no water to evaporate in a dry mixture. ${use}.`;
  if (mixKey === "iron-sand")
    return `Iron filings and sand grains are about the same size, so they fall through a sieve together. Iron is magnetic: ${use.toLowerCase()}.`;
  return `Neither ${m.a.toLowerCase()} nor ${m.b.toLowerCase()} is magnetic, so a magnet picks up neither. Their pieces are different sizes: ${use.toLowerCase()}.`;
}

/* ------------------------------------------------------------------ params */
const MASS = (title, def, max, description) => ({
  type: "integer",
  title,
  minimum: 1,
  maximum: max,
  default: def,
  description,
});
export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Mixtures and separating",
  required: ["mixture", "method"],
  properties: {
    title: TITLE_PARAM("Separating a mixture"),
    mixture: {
      type: "string",
      title: "The mixture",
      enum: MIX_KEYS,
      "x-labels": MIX_KEYS.map((k) => MIX[k].name),
      default: "sand-water",
    },
    method: {
      type: "string",
      title: "How to separate it",
      description:
        "A method that will not work for this mixture is refused with the reason. “Whichever works” picks one that does.",
      enum: ["best", ...METHODS],
      "x-labels": [
        "Whichever works",
        "Filter it",
        "Evaporate the water",
        "Sieve it",
        "Use a magnet",
      ],
      default: "best",
    },
    words: {
      type: "string",
      title: "Words on the slide",
      enum: ["everyday", "science"],
      "x-labels": ["Everyday words", "Science words (solution, residue, filtrate)"],
      default: "everyday",
    },
    closeUp: {
      type: "boolean",
      title: "Show a close-up of the particles",
      description:
        "For salt or sugar water: a magnifier shows the dissolved solid is still there, in tiny pieces.",
      default: false,
    },
    masses: {
      type: "object",
      title: "Masses",
      description:
        "Weigh both parts before and after. The totals are worked out for you. 100 ml of water weighs 100 g.",
      default: { show: false, a: 20, b: 100 },
      properties: {
        show: { type: "boolean", title: "Show the masses", default: false },
        a: MASS("First part (g)", 20, 500, "Sand, salt, sugar, iron filings, rice or pebbles."),
        b: MASS("Second part (g)", 100, 1000, "Water, sand or flour."),
      },
    },
    reversible: {
      type: "boolean",
      title: "Show it can be mixed again (reversible)",
      default: false,
    },
    // names and pole letters take the label cap; the note under the mixture name a phrase
    text: TEXT_PARAM_FOR({
      a: "label",
      b: "label",
      mix: "label",
      N: "label",
      S: "label",
      before: "label",
      after: "label",
      mixNote: "phrase",
    }),
  },
};

export const presets = [
  {
    id: "y3-magnet",
    name: "Year 3: iron filings out of sand with a magnet",
    params: {
      title: "Pulling iron out of sand",
      mixture: "iron-sand",
      method: "magnet",
    },
  },
  {
    id: "y5-filter",
    name: "Year 5: separating sand and water",
    params: {
      title: "Separating sand and water",
      mixture: "sand-water",
      method: "filter",
    },
  },
  {
    id: "y5-evaporate",
    name: "Year 5: getting salt back by evaporating",
    params: {
      title: "Getting salt back from salt water",
      mixture: "salt-water",
      method: "evaporate",
      closeUp: true,
      reversible: true,
    },
  },
  {
    id: "ks3-mass",
    name: "KS3: no mass is lost when you separate",
    params: {
      title: "Mass is conserved",
      mixture: "salt-water",
      method: "evaporate",
      words: "science",
      masses: { show: true, a: 20, b: 100 },
    },
  },
];

/* ------------------------------------------------------------------ model of the data */
const lc = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
function model(P) {
  const m = MIX[P.mixture] || MIX["sand-water"];
  const method = useMethod(P.mixture, P.method);
  const sci = P.words === "science";
  const A = txt(P, "label:a", m.a),
    B = txt(P, "label:b", m.b),
    MX = txt(P, "label:mix", m.name);
  const a = lc(A),
    b = lc(B),
    mx = lc(MX);
  const ms = P.masses || {};
  const mass = ms.show ? { a: ms.a, b: ms.b, t: ms.a + ms.b } : null;
  const lens = !!(P.closeUp && m.dissolved && method !== "magnet");
  const pl = !!m.plural,
    is = pl ? "are" : "is",
    it = pl ? "them" : "it",
    s = pl ? "" : "s";
  return { m, method, sci, A, B, MX, a, b, mx, mass, lens, pour: method !== "magnet", is, it, s };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  const m = MIX[P.mixture];
  // a method that does not work is refused: the slide never shows a different method from the one asked for
  const no = whyNot(P.mixture, P.method);
  if (no) return result([{ path: "method", reason: no }]);
  const method = useMethod(P.mixture, P.method);
  if (P.masses && P.masses.show && m.limit) {
    const most = Math.floor((m.limit * P.masses.b) / 100);
    if (P.masses.a > most)
      R.push({
        path: "masses.a",
        reason: `Only about ${m.limit} g of ${m.a.toLowerCase()} dissolves in 100 g of water at room temperature, so ${P.masses.a} g will not all dissolve in ${P.masses.b} g. Use at most ${most} g, or more water.`,
      });
  }
  if (P.mixture === "sand-water" && P.method === "evaporate")
    W.push({
      path: "method",
      reason:
        "Evaporating leaves the sand, but the water is lost to the air. Filtering keeps both.",
    });
  if (P.closeUp && !(m.dissolved && method !== "magnet"))
    W.push({ path: "closeUp", reason: "The close-up only shows for salt or sugar water." });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P);
  const { a, b, mx, MX, method, m, is, it, s } = M;
  const items = [];
  items.push({
    key: "mix",
    caption: m.dissolved
      ? `${MX}: the ${a} has dissolved. You can’t see it, but it is still there.`
      : m.liquid
        ? `${MX}: the ${a} has not dissolved, so you can still see it.`
        : `${MX}: two solids mixed together.`,
  });
  if (M.lens)
    items.push({
      key: "closeUp",
      caption: `Close up: tiny pieces of ${a} are spread out among the ${b}.`,
    });
  items.push({
    key: "setup",
    caption: {
      filter: "Put filter paper in a funnel, over an empty beaker.",
      evaporate: `Pour the ${mx} into a dish and warm it gently.`,
      sieve: "Hold a sieve over an empty bowl.",
      magnet: "Hold a magnet just above the mixture.",
    }[method],
  });
  items.push({
    key: "separate",
    caption: {
      filter: `Pour it in. The ${b} passes through tiny holes in the paper. The ${a} is too big to.`,
      evaporate: `The ${b} evaporates into the air. The ${a} cannot evaporate, so it stays.`,
      sieve: `Shake the sieve. The ${b} falls through the holes. The ${a} ${is} too big to.`,
      magnet: `The ${a} ${is} magnetic, so the magnet pulls ${it} out. The ${b} is not magnetic.`,
    }[method],
  });
  items.push({
    key: "result",
    caption: {
      filter: `The ${a} is caught in the filter paper. The ${b} is in the beaker.`,
      evaporate: `The ${a} is left in the dish. The ${b} has gone into the air.`,
      sieve: `The ${a} stay${s} in the sieve. The ${b} is in the bowl.`,
      magnet: `The ${a} ${is} on the magnet. The ${b} stays in the tray.`,
    }[method],
  });
  if (M.mass)
    items.push({
      key: "mass",
      caption: `Before and after, the total mass is the same: ${M.mass.t} g. Nothing is lost.`,
    });
  if (P.reversible)
    items.push({
      key: "reverse",
      caption: m.dissolved
        ? `Add water again and the ${a} dissolves again. Dissolving is a reversible change.`
        : `Mix them again and you get the ${mx} back. Mixing is a reversible change.`,
    });
  const summary = {
    filter: "Filtering separates a solid that has not dissolved from a liquid.",
    evaporate: m.dissolved
      ? "Evaporating gets back a solid that has dissolved."
      : `Evaporating leaves the ${a} behind, but the ${b} is lost to the air.`,
    sieve: "A sieve separates solids whose pieces are different sizes.",
    magnet: "A magnet separates a magnetic material from one that is not magnetic.",
  }[method];
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
  const { a, b, m, method } = M;
  const N = {
    mix: m.dissolved
      ? `Ask: where has the ${a} gone? Taste is not a safe test in the lab, so ask how else we could find out. The ${a} has dissolved to make a solution.`
      : m.liquid
        ? `The ${a} is insoluble: stir it and it still settles. Ask what would happen if we stirred in salt instead.`
        : `In a mixture each material keeps its own properties, which is what lets us separate them.`,
    closeUp:
      "A model, not a photo: real particles are far too small to see. The dissolved pieces are still there, spread through the water.",
    setup: {
      filter:
        "Fold the filter paper into a cone and wet it so it sits in the funnel. The holes are far too small to see.",
      evaporate:
        "Adults heat; or leave the dish somewhere warm for a few days and it works more slowly. Stop heating before it is dry, so it does not spit.",
      sieve: "A sieve is a filter with big holes. Ask: which pieces will fit through?",
      magnet: "Wrap the magnet in cling film or a bag first, so the filings slide off afterwards.",
    }[method],
    separate: {
      filter: `Filter paper has holes big enough for water to pass, too small for ${a} grains. Wait: it drips slowly.`,
      evaporate: `The water turns into water vapour, which is invisible. The ${a} is left behind as crystals.`,
      sieve: `It is the size of the pieces that matters: small ${b} fits through, big ${a} does not.`,
      magnet:
        "Iron is magnetic; sand is not. A magnet pulls hardest at its ends (the poles), so most filings gather there.",
    }[method],
    result: {
      filter:
        "Some water stays in the wet sand until it dries. Words: the sand left on the paper is the residue; the liquid through is the filtrate.",
      evaporate: m.dissolved
        ? "To keep the water too, you would cool the vapour back into a liquid (distillation, later in school)."
        : "This works, but the water is lost. Filtering keeps both.",
      sieve:
        "Ask: could a sieve separate sand from water? (No: sand grains are smaller than the holes.)",
      magnet: "Ask: would a magnet work on salt and sand? (No: neither is magnetic.)",
    }[method],
    mass: "Mass is conserved: nothing is made or destroyed when we separate. In a real lab a little is lost on the equipment.",
    reverse: m.dissolved
      ? "Dissolving and evaporating are reversible: we can get the solid back. Burning is not."
      : "Mixing and separating are reversible changes: nothing new is made.",
  };
  return {
    steps: items.map((it) => N[it.key] || ""),
    summary: "Ask the class to choose a method for a new mixture and say why it works.",
  };
}

/* ------------------------------------------------------------------ render */
const BY = 540,
  SX = 200,
  RX = 822,
  RW = 390;
// each method has its own layout in scene units; the scene is scaled to fill the space left of the
// label column (as large as fits, centred), with the bench at y 570 on the slide
const LAY = {
  filter: { AX: 430, x0: 117, x1: 512, top: BY - 290, lim: 182, rev: [-70, BY - 146] },
  evaporate: { AX: 452, x0: 117, x1: 569, top: BY - 232, lim: 150, rev: [-123, BY - 110] },
  sieve: { AX: 540, x0: 85, x1: 720, top: BY - 240, lim: 150, rev: [-150, BY - 74] },
  magnet: { AX: 400, x0: 225, x1: 575, top: BY - 204, lim: 226 },
};
const XR = RX - 40,
  BENCH = 570,
  ZMAX = 1.8;
// labels: one step above the label token, still measured by textBlock
const LBL = { cls: "ts-label", lh: 40, a: { fill: "var(--ink)", style: "font-size:var(--fs-h3)" } };
/** A beaker that shows on a projector: a light glass tint and a firmer outline. */
function glassUp(bk, w, hh) {
  const inner = bk.firstChild;
  const air = inner.firstChild;
  air.style.setProperty("fill", "color-mix(in oklab,var(--glass-edge) 14%,var(--air))");
  h(
    "path",
    {
      d: `M${-w / 2 - 8} ${-hh} Q ${-w / 2} ${-hh} ${-w / 2} ${-hh + 8} V 0 H ${w / 2} V ${-hh}`,
      fill: "none",
      stroke: "var(--glass-edge)",
      "stroke-width": "var(--sw-arrow)",
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    },
    inner,
  );
  return inner;
}
export function render(root, P, ctx) {
  const { M, items } = plan(P);
  const { b: B, N } = ctx;
  const { m, method } = M;
  const bi = (k) => B[k];
  const LY = LAY[method];
  const AX = LY.AX;
  const L = (id) => `text.label:${id}`;

  /* the mixture's name: top left, left-aligned, the same in every preset, kept all the way through.
     Drawn first: a long name or note takes a second row, and the scene then sits below it */
  const head = (() => {
    const nameG = h("g", { s: 0, cls: "rise" }, root);
    const x = GRID.left,
      maxW = XR - GRID.left,
      y0 = GRID.top + 24;
    const t1 = textBlock(nameG, x, y0, M.MX, {
      cls: "ts-label",
      maxW: 560,
      maxLines: 2,
      lh: 36,
      a: { style: "fill:var(--ink);font-weight:var(--w-strong)" },
      edit: L("mix"),
    });
    const note = txt(
      P,
      "label:mixNote",
      m.dissolved
        ? M.sci
          ? `A solution: the ${M.a} has dissolved`
          : `The ${M.a} has dissolved`
        : m.liquid
          ? M.sci
            ? `The ${M.a} is insoluble`
            : `The ${M.a} has not dissolved`
          : "Two solids, mixed",
    );
    const nx = x + t1.w + 22,
      same = t1.lines.length === 1 && measure(nameG, note, "ts-cap") <= maxW - (nx - x);
    const tn = textBlock(nameG, same ? nx : x, same ? y0 : y0 + t1.h, note, {
      cls: "ts-cap",
      maxW: same ? maxW - (nx - x) : maxW,
      maxLines: same ? 1 : 2,
      lh: 32,
      edit: L("mixNote"),
    });
    return { two: !same, bottom: same ? y0 + 10 : y0 + t1.h + (tn.lines.length - 1) * tn.lh + 10 };
  })();

  /* the scene's scale: as large as fits left of the label column, below the header, and low enough
     that the words of the "mix again" arrow sit under the header too */
  const kRev = bi("reverse");
  const fitZ = (lim) => {
    const Z = Math.min(ZMAX, (XR - GRID.left) / (LY.x1 - LY.x0), (BENCH - lim) / (BY - LY.top));
    return {
      Z,
      TX: GRID.left - Z * LY.x0 + (XR - GRID.left - Z * (LY.x1 - LY.x0)) / 2,
      TY: BENCH - Z * BY,
    };
  };
  let lim = Math.max(LY.lim, head.two ? head.bottom + 16 : 0),
    fit = fitZ(lim);
  const revText = txt(
    P,
    "label:reverse",
    m.dissolved ? "Add water: it dissolves again" : "Mix them again",
  );
  const revO = {
    cls: LBL.cls,
    maxLines: 2,
    lh: 36,
    a: { style: "fill:var(--compare-text)", cls: "halo" },
    edit: L("reverse"),
  };
  const revW = (f) => Math.max(240, f.TX + f.Z * (AX + LY.rev[0] + 40) - GRID.left - 16);
  const revLines = (mw) => {
    const tmp = h("g", {}, root);
    const n = textBlock(tmp, 0, 0, revText, Object.assign({}, revO, { maxW: mw })).lines.length;
    tmp.remove();
    return n;
  };
  if (kRev != null && M.pour) {
    const srcTop0 = m.liquid ? BY - 190 : BY - 126;
    for (let i = 0; i < 10; i++) {
      const top =
        fit.TY + fit.Z * Math.min(srcTop0, LY.rev[1]) - 30 - (revLines(revW(fit)) - 1) * 36 - 28;
      if (top >= head.bottom + 12) break;
      lim += head.bottom + 12 - top;
      fit = fitZ(lim);
    }
  }
  const { Z, TX, TY } = fit;
  const F = (x, y) => [TX + Z * x, TY + Z * y];
  const kSep = bi("separate"),
    kSet = bi("setup"),
    kRes = bi("result");
  const ups = []; // functions of v (0..1, how far the separation has gone)
  /* the bench, then the scene (scaled) */
  apparatus(root, "bench", 640, F(0, BY)[1], 1, {}, { w: 1180 });
  const slide = root;
  root = h("g", { transform: `translate(${TX} ${TY}) scale(${Z})` }, slide);

  /* the mixture, where it starts */
  let srcTop;
  if (M.pour && m.liquid) {
    const bk = apparatus(root, "beaker", SX, BY, 1, {}, { w: 150, h: 190, level: 0 });
    const inner = glassUp(bk, 150, 190);
    const air = inner.firstChild;
    const g = h("g", {}, null);
    inner.insertBefore(g, air.nextSibling);
    const L0 = 108,
      sand = m.liquid && !m.dissolved ? 22 : 0;
    const liq = h("rect", { x: -70, width: 140, fill: "var(--liquid-bg)" }, g);
    const surf = h(
      "line",
      { x1: -70, x2: 70, stroke: "var(--water)", "stroke-width": "var(--sw-rule)" },
      g,
    );
    const layer = sand ? h("path", { fill: "var(--sand)" }, g) : null;
    const bits = sand
      ? scatter({ x: -60, y: -L0 + 10, w: 120, h: L0 - sand - 20 }, () => true, 9, 5, 18).map(
          ([x, y, r]) => ({ el: grain(g, "sand", x, y, r), y }),
        )
      : [];
    const lay = sand
      ? scatter({ x: -66, y: -5 - sand, w: 132, h: sand - 4 }, () => true, 22, 9, 9).map(
          ([x, y]) => ({ el: grain(g, "sand", x, y), y }),
        )
      : [];
    ups.push((v) => {
      if (method === "evaporate") return;
      const k = 1 - v,
        lh = L0 * k,
        top = -5 - lh;
      liq.setAttribute("y", top);
      liq.setAttribute("height", Math.max(0, lh));
      surf.setAttribute("y1", top);
      surf.setAttribute("y2", top);
      surf.style.opacity = lh > 1 ? 1 : 0;
      if (layer) {
        const sh = sand * k;
        layer.setAttribute("d", `M-70 -5 V ${-5 - sh} H 70 V -5 Z`);
      }
      bits.forEach((o) => {
        o.el.style.opacity = -5 - o.y < lh - 6 ? 1 : 0;
      });
      lay.forEach((o) => {
        o.el.style.opacity = -5 - o.y < sand * k ? 1 : 0;
      });
    });
    if (method === "evaporate") {
      // poured out at the set-up: the beaker is empty from then on
      for (const el of [liq, surf, layer, ...bits.map((o) => o.el), ...lay.map((o) => o.el)].filter(
        Boolean,
      ))
        el.dataset.h = kSet;
      liq.setAttribute("y", -5 - L0);
      liq.setAttribute("height", L0);
      surf.setAttribute("y1", -5 - L0);
      surf.setAttribute("y2", -5 - L0);
    }
    srcTop = BY - 190;
  } else if (M.pour) {
    const w = 220,
      hh = 80,
      top = BY - hh,
      x0 = SX - w / 2 + 12,
      x1 = SX + w / 2 - 12,
      H0 = 46;
    const g = h("g", {}, root);
    const heap = h("path", { fill: baseFill(m.base) }, g);
    const pts = scatter(
      { x: x0, y: top - H0, w: x1 - x0, h: H0 + 10 },
      (x, y) => y > top + 10 - moundAt(x0, x1, H0, x) + 8 && y < top + 8,
      12,
      3,
      22,
    );
    const gr = pts.map(([x, y, r]) => ({ el: grain(g, m.grainA, x, y, r), x, y }));
    bowl(root, SX, BY, w, hh);
    ups.push((v) => {
      const k = 1 - v,
        hg = H0 * k;
      heap.setAttribute("d", moundD(x0, x1, top + 10, hg));
      heap.style.opacity = k > 0.02 ? 1 : 0;
      gr.forEach((o) => {
        o.el.style.opacity = o.y > top + 10 - moundAt(x0, x1, hg, o.x) + 6 ? 1 : 0;
      });
    });
    srcTop = top - H0;
  }

  const kPour = method === "evaporate" ? kSet : kSep;

  /* close-up of a solution: a magnifier on the liquid; it goes once the set-up starts (slide units) */
  if (M.lens) {
    const k = bi("closeUp");
    const lx = 580;
    const g = h("g", { s: k, cls: "rise", hide: kSet }, slide);
    // key under the lens: the colours name the two substances. One row when it fits, else one per row
    // one row is centred under the lens; stacked rows start under the lens's right part, clear of the cone
    const KW = 2 * (XR - lx),
      KX = lx - 90,
      ko = {
        cls: "ts-small",
        maxW: XR - KX - 26,
        maxLines: 2,
        lh: 28,
        a: { style: "fill:var(--ink)" },
      };
    const keyG = h("g", {}, g);
    const keys = [
      [M.B, "var(--particle)", "var(--particle-edge)", "b"],
      [M.A, "var(--stone)", "var(--stone-shade)", "a"],
    ];
    const kb = keys.map(([t]) => {
      const tmp = h("g", {}, keyG);
      const tb = textBlock(tmp, 0, 0, t, ko);
      tmp.remove();
      return tb;
    });
    const row = kb.every((tb) => tb.lines.length === 1) && 26 + kb[0].w + 36 + 26 + kb[1].w <= KW;
    const keyH = row ? 28 : kb[0].h + kb[1].h + 8;
    // the lens sits below the header and above its key, which stays above the bench
    const lensTop = Math.max(200, head.bottom + 14),
      lr = Math.min(130, (BENCH - 14 - keyH - 26 - lensTop) / 2),
      ly = lensTop + lr;
    const [sx, sy] = F(SX, BY - 50);
    const mg = magnifier(ctx, g, { id: "sol", sx, sy, sr: 20 * Z, cx: lx, cy: ly, r: lr });
    const pr = 14,
      box = { x: lx - lr, y: ly - lr * 0.78, w: 2 * lr, h: lr * 1.78 };
    const pts = particleLayout("liquid", box, { r: pr, seed: 4 });
    const share = M.mass ? clamp(M.mass.a / M.mass.t, 0.1, 0.3) : 0.16;
    const step = Math.max(2, Math.round(1 / share));
    pts.forEach(([x, y], i) => {
      const solute = (i * 7) % step === 0;
      h(
        "circle",
        {
          cx: x,
          cy: y,
          r: pr,
          fill: solute ? "var(--stone)" : "var(--particle)",
          stroke: solute ? "var(--stone-shade)" : "var(--particle-edge)",
          "stroke-width": "var(--sw-hair)",
        },
        mg.inner,
      );
    });
    mg.rim();
    g.appendChild(keyG);
    let ky = ly + lr + 44;
    let x = row ? lx - (26 + kb[0].w + 36 + 26 + kb[1].w) / 2 : KX;
    keys.forEach(([t, f, st, id], i) => {
      h(
        "circle",
        { cx: x + 10, cy: ky - 8, r: 10, fill: f, stroke: st, "stroke-width": "var(--sw-hair)" },
        keyG,
      );
      textBlock(keyG, x + 26, ky, t, Object.assign({}, ko, { edit: L(id) }));
      if (row) x += 26 + kb[0].w + 36;
      else ky += kb[i].h + 8;
    });
  }

  /* the method: apparatus (set-up build) and what moves (separate build) */
  const setupG = h("g", { s: kSet, cls: "rise" }, root);
  const anchors = { setup: [], result: [] };
  let pourPts = null,
    revStart = null;
  if (method === "filter") {
    const bw = 130,
      bh = 140;
    const bk = apparatus(setupG, "beaker", AX, BY, 1, {}, { w: bw, h: bh, level: 0 });
    const inner = glassUp(bk, bw, bh);
    const g = h("g", {}, null);
    inner.insertBefore(g, inner.firstChild.nextSibling);
    const FL = 70;
    const liq = h("rect", { x: -bw / 2 + 5, width: bw - 10, fill: "var(--liquid-bg)" }, g);
    const surf = h(
      "line",
      { x1: -bw / 2 + 5, x2: bw / 2 - 5, stroke: "var(--water)", "stroke-width": "var(--sw-rule)" },
      g,
    );
    const fw = 150,
      ch = fw * 0.75,
      tipY = BY - bh + 50;
    apparatus(setupG, "funnel", AX, tipY, 1, {}, { w: fw });
    const apexY = tipY - fw * 0.55 + 6,
      paperTop = tipY - fw * 0.55 - ch - 4,
      hw = fw / 2 - 10,
      RH = 38;
    const edgeX = (d) => AX + (fw / 2) * (1 - d / ch);
    const res = h("path", { fill: "var(--sand)" }, setupG);
    // grains caught in the paper: they settle as the water runs through
    const inRes = (x, y) =>
      y < apexY - 4 &&
      y > apexY - RH + 4 &&
      Math.abs(x - AX) < (hw * (apexY - y)) / (apexY - paperTop) - 4;
    const caught = scatter({ x: AX - hw, y: apexY - RH, w: 2 * hw, h: RH }, inRes, 9, 21, 7).map(
      ([x, y]) => ({ el: grain(setupG, "sand", x, y), y }),
    );
    const drops = [0, 1].map(() => h("circle", { cx: AX, r: 5, fill: "var(--water)" }, setupG));
    ups.push((v, u) => {
      const lh = FL * v;
      liq.setAttribute("y", -5 - lh);
      liq.setAttribute("height", lh);
      surf.setAttribute("y1", -5 - lh);
      surf.setAttribute("y2", -5 - lh);
      surf.style.opacity = lh > 1 ? 1 : 0;
      const rh = RH * Math.min(1, v * 1.6),
        rw = (hw * rh) / (apexY - paperTop);
      res.setAttribute(
        "d",
        `M${AX} ${apexY} L ${AX - rw} ${apexY - rh} Q ${AX} ${apexY - rh - 8 * (rh / RH)} ${AX + rw} ${apexY - rh} Z`,
      );
      res.style.opacity = rh > 1 ? 1 : 0;
      caught.forEach((o) => {
        o.el.style.opacity = apexY - o.y < rh - 3 ? 1 : 0;
      });
      const bottom = BY - 5 - lh;
      drops.forEach((d, i) => {
        const f = ((u || 0) * 5 + i * 0.5) % 1;
        d.setAttribute("cy", tipY + 8 + f * (bottom - tipY - 14));
        d.style.opacity = v > 0 && v < 1 ? 1 : 0;
      });
    });
    anchors.setup.push({
      id: "setup1",
      text: "Filter paper in a funnel",
      x: edgeX(44) + 2,
      y: paperTop + 44,
    });
    anchors.result.push({
      id: "resA",
      text: `${M.A} stays in the filter paper` + (M.sci ? ": the residue" : ""),
      x: AX + 16,
      y: apexY - 16,
    });
    anchors.result.push({
      id: "resB",
      text: `${M.B} drips through` + (M.sci ? ": the filtrate" : ""),
      x: AX + 36,
      y: BY - 30,
    });
    pourPts = [
      [SX + 76, srcTop - 6],
      [SX + 112, paperTop + 4],
      [AX - fw / 2 + 20, paperTop + 2],
    ];
    revStart = [AX - 70, BY - bh - 6];
  } else if (method === "evaporate") {
    const hpH = 60,
      dw = 230,
      dd = 52,
      top = BY - hpH - dd;
    hotPlate(setupG, AX, BY, 220, hpH);
    const id = ctx.uid + "-dish";
    const cp = h("clipPath", { id }, h("defs", {}, setupG));
    h("path", { d: dishD(AX, top, dw, dd) }, cp);
    h(
      "path",
      {
        d: dishD(AX, top, dw, dd),
        fill: "color-mix(in oklab,var(--glass-edge) 14%,var(--air))",
        cls: "body",
      },
      setupG,
    );
    const cg = h("g", { "clip-path": `url(#${id})` }, setupG);
    const liq = h("rect", { x: AX - dw / 2, width: dw, fill: "var(--liquid-bg)" }, cg);
    const surf = h(
      "line",
      {
        x1: AX - dw / 2,
        x2: AX + dw / 2,
        stroke: "var(--water)",
        "stroke-width": "var(--sw-rule)",
      },
      cg,
    );
    const cr = scatter(
      { x: AX - 70, y: top + dd - 22, w: 140, h: 18 },
      (x, y) => y < top + dd - 4 - (Math.abs(x - AX) / 70) ** 2 * 14,
      m.grainA === "sand" ? 26 : 12,
      11,
      m.grainA === "sand" ? 9 : 13,
    ).map(([x, y, r]) => ({ el: grain(cg, m.grainA, x, y, r) }));
    h(
      "path",
      {
        d: dishD(AX, top, dw, dd),
        fill: "none",
        stroke: "var(--glass-edge)",
        "stroke-width": "var(--sw-arrow)",
        "stroke-linejoin": "round",
      },
      setupG,
    );
    const full = top + 10,
      depth = dd - 10;
    ups.push((v) => {
      const y = full + depth * v;
      liq.setAttribute("y", y);
      liq.setAttribute("height", Math.max(0, top + dd - y));
      surf.setAttribute("y1", y);
      surf.setAttribute("y2", y);
      surf.style.opacity = v < 0.98 ? 1 : 0;
      cr.forEach((o, i) => {
        o.el.style.opacity = clamp((v - 0.35 - i * 0.03) * 3);
      });
    });
    // water vapour leaves: drawn as it evaporates and kept in the still
    const vg = h("g", {}, root);
    [
      [-56, -8],
      [0, 0],
      [56, 8],
    ].forEach(([dx, sk], i) =>
      wavy(ctx, vg, AX + dx, top - 12, AX + dx + sk, top - 112, "var(--vapour)", {
        draw: kSep,
        delay: i * 250,
        n: 3,
      }),
    );
    anchors.setup.push({
      id: "setup1",
      text: M.sci ? "Evaporating dish" : "A dish",
      x: AX + dw / 2 + 2,
      y: top + 2,
    });
    anchors.setup.push({ id: "setup2", text: "Gentle heat", x: AX + 112, y: BY - hpH / 2 });
    // the vapour label points at the side of the rising vapour, below the mass block's zone
    anchors.result.push({
      id: "resB",
      text:
        m.dissolved || M.sci
          ? `${M.B} evaporates into the air as ${M.b} vapour`
          : `${M.B} evaporates into the air`,
      x: AX + 82,
      y: top - 56,
    });
    anchors.result.push({
      id: "resA",
      text: `${M.A}${m.grainA === "crystal" ? " crystals are" : " is"} left in the dish`,
      x: AX + 98,
      y: top + 32,
    });
    pourPts = [
      [SX + 76, srcTop - 6],
      [SX + 170, srcTop - 34],
      [AX - dw / 2 + 24, top - 6],
    ];
    revStart = [AX - dw / 2 - 8, top + 2];
  } else if (method === "sieve") {
    const bw = 280,
      bh = 70,
      btop = BY - bh,
      sw = 220,
      sr = sw / 2,
      sy = btop - 17 + sr * 0.3,
      rim = sy - sr;
    const fx0 = AX - bw / 2 + 16,
      fx1 = AX + bw / 2 - 16,
      FH = 30;
    const heap = h("path", { fill: baseFill(m.base) }, setupG);
    bowl(setupG, AX, BY, bw, bh);
    apparatus(setupG, "sieve", AX, sy, 1, {}, { w: sw });
    const inS = (x, y) => {
      const e = rim + sr * 0.7 * Math.sqrt(Math.max(0, 1 - ((x - AX) / sr) ** 2));
      return y < e - 8 && y > rim + 6 && Math.abs(x - AX) < sr - 14;
    };
    const rice = scatter(
      { x: AX - sr, y: rim, w: sw, h: sr * 0.7 },
      inS,
      14,
      7,
      m.grainA === "pebble" ? 26 : 18,
    )
      .sort((p, q) => q[1] - p[1])
      .map(([x, y, r]) => ({ el: grain(setupG, m.grainA, x, y, r) }));
    const fall = [0, 1, 2, 3].map((i) =>
      h("circle", { cx: AX - 60 + i * 40, r: 3, fill: "var(--ink-3)" }, setupG),
    );
    ups.push((v, u) => {
      heap.setAttribute("d", moundD(fx0, fx1, btop + 12, 12 + FH * v));
      heap.style.opacity = v > 0.02 ? 1 : 0;
      rice.forEach((o, i) => {
        o.el.style.opacity = v * rice.length > i ? 1 : 0;
      });
      fall.forEach((d, i) => {
        const f = ((u || 0) * 4 + i * 0.27) % 1;
        d.setAttribute("cy", rim + sr * 0.7 + 6 + f * (btop - rim - sr * 0.7));
        d.style.opacity = v > 0 && v < 1 ? 1 : 0;
      });
    });
    anchors.setup.push({ id: "setup1", text: "A sieve", x: AX + sr - 10, y: rim + 30 });
    anchors.result.push({
      id: "resA",
      text: `${M.A}: too big to fit through the holes`,
      x: AX + 50,
      y: rim + 34,
    });
    anchors.result.push({
      id: "resB",
      text: `${M.B} falls through into the bowl`,
      x: AX + 100,
      y: btop - 8,
    });
    pourPts = [
      [SX + 70, srcTop + 2],
      [SX + 180, rim - 70],
      [AX - sr + 10, rim - 12],
    ];
    revStart = [AX - bw / 2 - 10, btop - 4];
  } else {
    // magnet: the mixture is spread in a tray; the magnet is held above it
    const tw = 340,
      th = 44,
      ttop = BY - th,
      x0 = AX - tw / 2 + 14,
      x1 = AX + tw / 2 - 14,
      H0 = 34;
    const g = h("g", {}, root);
    h(
      "path",
      {
        d: moundD(x0, x1, ttop + 12, H0),
        fill: "color-mix(in oklab,var(--hue-gold) 58%,var(--bg))",
      },
      g,
    );
    // the sand: visible grains over the heap
    scatter(
      { x: x0 + 8, y: ttop - H0, w: x1 - x0 - 16, h: H0 + 10 },
      (x, y) => y > ttop + 12 - moundAt(x0, x1, H0, x) + 5 && y < ttop + 8,
      60,
      29,
      9,
    ).forEach(([x, y]) => grain(g, "sand", x, y));
    bowl(root, AX, BY, tw, th);
    const mw = 260,
      mh = 56,
      my = ttop - 104;
    const mg = apparatus(setupG, "magnet", AX, my, 1, {}, { w: mw, h: mh });
    mg.querySelectorAll("text").forEach((t) => t.remove());
    // the pole names: on the slide (not scaled), fitted inside each pole; big when they fit on one line
    const poleG = h("g", { s: kSet, cls: "rise" }, slide);
    [
      ["N", -1],
      ["S", 1],
    ].forEach(([id, sd]) => {
      const [cx, cy] = F(AX + (sd * mw) / 4, my - mh / 2),
        pw = (Z * mw) / 2 - 24,
        ph = Z * mh - 8,
        word = txt(P, `label:${id}`, id);
      const big = measure(poleG, word, "ts-big") <= pw;
      const o = big
        ? { cls: "ts-big", maxW: pw, maxLines: 1, lh: 52 }
        : { cls: "ts-label", maxW: pw, maxLines: Math.max(1, Math.floor(ph / 28)), lh: 28 };
      const tg = h("g", {}, poleG);
      const tb = textBlock(
        tg,
        cx,
        0,
        word,
        Object.assign(o, { anchor: "middle", a: { style: "fill:var(--cloud)" }, edit: L(id) }),
      );
      tg.setAttribute("transform", `translate(0 ${(cy - tb.h / 2 + tb.lh * 0.72).toFixed(1)})`);
    });
    // deeper pole colours, so they do not glare on dark themes; light letters on them
    mg.querySelectorAll("rect").forEach((r) => {
      const f = r.style.getPropertyValue("fill").trim();
      if (f === "var(--hue-red)" || f === "var(--hue-blue)")
        r.style.setProperty("fill", `color-mix(in oklab,${f} 76%,var(--shade))`);
    });
    // filings hang in short chains along the magnet face, longest at the poles (the ends)
    const tgt = [];
    const half = mw / 2 - 10;
    for (let cx = -half; cx <= half + 0.1; cx += 16) {
      const p = cx / half,
        n = 1 + Math.round(3 * Math.abs(p) ** 2);
      for (let k = 0; k < n; k++) tgt.push([AX + cx + p * k * 4, my + 11 + k * 15, 90 + p * 16]);
    }
    const start = scatter(
      { x: x0 + 24, y: ttop - H0, w: x1 - x0 - 48, h: H0 + 8 },
      (x, y) => y > ttop + 12 - moundAt(x0, x1, H0, x) + 6 && y < ttop + 6,
      tgt.length,
      13,
      9,
    );
    const fil = start.map(([x, y, r], i) => ({
      el: grain(root, "iron", 0, 0, 0),
      s: [x, y],
      t: tgt[i],
      r,
    }));
    // they fly up in an arc, bending towards the nearer pole
    ups.push((v) =>
      fil.forEach((o, i) => {
        const w = eIO(clamp((v - (i * 0.4) / fil.length) / 0.6));
        const bend = Math.sin(Math.PI * w) * (o.t[0] - AX) * 0.35;
        const x = lerp(o.s[0], o.t[0], w) + bend,
          y = lerp(o.s[1], o.t[1], w);
        o.el.setAttribute(
          "transform",
          `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(o.r * (1 - w) + o.t[2] * w).toFixed(0)})`,
        );
      }),
    );
    anchors.setup.push({ id: "setup1", text: "A magnet", x: AX + mw / 2 + 4, y: my - mh / 2 });
    anchors.result.push({
      id: "resA",
      text: `${M.A} stick${M.s} to the magnet`,
      x: AX + mw / 2 + 4,
      y: my + 30,
    });
    anchors.result.push({
      id: "resB",
      text: `${M.B} is not magnetic, so it stays in the tray`,
      x: AX + 100,
      y: ttop + 12 - moundAt(x0, x1, H0, AX + 100) - 2,
    });
    revStart = null;
  }

  /* the pour (one build only) */
  if (pourPts)
    flow(ctx, root, pourPts, "var(--ink-2)", { draw: kPour, g: { s: kPour, hide: kPour + 1 } });

  /* labels in the right-hand column: placed in order of the point they name, never touching */
  const massTop = 128;
  /* masses: computed, so the total is always kept. Its own zone at the top of the column, with the
     two totals as one focal line */
  let massBottom = 0;
  if (M.mass) {
    const k = bi("mass");
    const g = h("g", { s: k, cls: "rise" }, slide);
    const Ms = M.mass;
    const xa = RX - 30,
      xb = RX + 184,
      cell = {
        cls: "ts-label",
        maxW: xb - xa - 16,
        maxLines: 2,
        lh: 36,
        a: { style: "fill:var(--ink);font-weight:var(--w-body)" },
      };
    const cellB = Object.assign({}, cell, { maxW: GRID.right - xb });
    const hd = { style: "fill:var(--ink-2);font-size:var(--fs-cap);font-weight:var(--w-strong)" };
    const hdO = { cls: "ts-cap", maxLines: 3, lh: 28, a: hd };
    const h1 = textBlock(
      g,
      xa,
      massTop + 26,
      txt(P, "label:before", "Before"),
      Object.assign({ maxW: xb - xa - 16, edit: L("before") }, hdO),
    );
    const h2 = textBlock(
      g,
      xb,
      massTop + 26,
      txt(P, "label:after", "After"),
      Object.assign({ maxW: GRID.right - xb, edit: L("after") }, hdO),
    );
    const hdExtra = Math.max(h1.h, h2.h) - 28;
    const bAfter = method === "evaporate" ? `${M.b} vapour` : M.b;
    let y = massTop + 72 + hdExtra;
    for (const [va, na, nb, path] of [
      [Ms.a, M.a, M.a, "masses.a"],
      [Ms.b, M.b, bAfter, "masses.b"],
    ]) {
      const c1 = textBlock(g, xa, y, `${va} g ${na}`, cell),
        c2 = textBlock(g, xb, y, `${va} g ${nb}`, cellB);
      computed(c1.el, path);
      computed(c2.el, path);
      y += Math.max(c1.h, c2.h) + 6;
    }
    h(
      "line",
      {
        x1: xa,
        x2: GRID.right - 20,
        y1: y - 22,
        y2: y - 22,
        stroke: "var(--ink-3)",
        "stroke-width": "var(--sw-rule)",
      },
      g,
    );
    const ty = y + 32;
    computed(T(g, xa, ty, `${Ms.t} g = ${Ms.t} g`, "ts-big", { fill: "var(--focus)" }), "masses.a");
    massBottom = ty + 12;
  }

  const yMin = 150,
    yMax = 562,
    kMass = bi("mass");
  const column = (list, a) => {
    const g = h("g", a, slide);
    const lg = h("g", {}, g);
    const blocks = list.map((it) => {
      const s = txt(P, `label:${it.id}`, it.text);
      const bg = h("g", {}, g);
      const tb = textBlock(bg, RX, 0, s, {
        cls: LBL.cls,
        maxW: RW,
        maxLines: 2,
        lh: LBL.lh,
        a: LBL.a,
        edit: L(it.id),
      });
      return { it, bg, h: tb.h, w: tb.w };
    });
    blocks.sort((p, q) => p.it.y - q.it.y);
    const fy = (it) => F(it.x, it.y)[1];
    let y = yMin;
    for (const bl of blocks) {
      bl.top = Math.max(y, fy(bl.it) - 14);
      y = bl.top + bl.h + 30;
    }
    const over = y - 30 - yMax;
    if (over > 0) {
      for (const bl of blocks) bl.top -= over;
      if (blocks[0] && blocks[0].top < yMin - 4)
        ctx.warn("The labels do not fit down the right-hand side.");
    }
    for (const bl of blocks) {
      bl.bg.setAttribute("transform", `translate(0 ${bl.top + 28})`);
      const ly = bl.top + 16;
      const [ax, ay] = F(bl.it.x, bl.it.y);
      // the mass table takes the top of the column: a label it would meet gives way at that build
      const give = M.mass && bl.top < massBottom + 24 ? { hide: kMass } : {};
      if (give.hide != null) bl.bg.dataset.h = kMass;
      const lk = h("g", give, lg);
      h(
        "line",
        {
          x1: ax + 6,
          y1: ay,
          x2: RX - 14,
          y2: ly,
          stroke: "var(--ink-3)",
          "stroke-width": "var(--sw-lead)",
        },
        lk,
      );
      h("circle", { cx: ax, cy: ay, r: 5, fill: "var(--ink-2)" }, lk);
    }
    return g;
  };
  if (anchors.setup.length) column(anchors.setup, { s: kSet, cls: "rise", hide: kRes });
  column(anchors.result, { s: kRes, cls: "rise", delay: 0 });

  /* reversible: an arrow back to where the mixture started, its words above the curve, full contrast */
  if (kRev != null) {
    const g = h("g", { s: kRev, cls: "rise" }, root);
    const gt = h("g", { s: kRev, cls: "rise" }, slide);
    const s0 = M.pour ? revStart : [AX - 140, BY - 220],
      e0 = M.pour ? [SX + 30, srcTop - 8] : [AX - 186, BY - 52];
    const c0 = M.pour
      ? [(s0[0] + e0[0]) / 2 + 10, Math.min(s0[1], e0[1]) - 24]
      : [AX - 260, (s0[1] + e0[1]) / 2];
    flow(ctx, g, [s0, c0, e0], "var(--compare)", { dash: "10 8" });
    const apex = F(
      0.25 * s0[0] + 0.5 * c0[0] + 0.25 * e0[0],
      0.25 * s0[1] + 0.5 * c0[1] + 0.25 * e0[1],
    );
    const s = revText,
      o = Object.assign({ maxW: 460 }, revO);
    if (M.pour) {
      const mw = revW(fit),
        n = revLines(mw);
      textBlock(
        gt,
        GRID.left,
        F(0, Math.min(srcTop, s0[1]))[1] - 30 - (n - 1) * 36,
        s,
        Object.assign({}, o, { maxW: mw }),
      );
    } else
      textBlock(
        gt,
        apex[0] - 22,
        apex[1] + 10,
        s,
        Object.assign({}, o, { maxW: 300, anchor: "end" }),
      );
  }

  /* motion: the separation runs during its own build; everything else is still */
  let lastU = 0;
  const setV = (v, u) => {
    lastU = u == null ? lastU : u;
    ups.forEach((f) => f(v, lastU));
  };
  setV(1, 1);
  return {
    dur: { separate: method === "magnet" ? 2200 : 2800 },
    still() {
      setV(1, 1);
    },
    reset() {
      setV(0, 0);
    },
    tick(k, u) {
      setV(k < kSep ? 0 : k > kSep ? 1 : eIO(u), u);
    },
  };
}

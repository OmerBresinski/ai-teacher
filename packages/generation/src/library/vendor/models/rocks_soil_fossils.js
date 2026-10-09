// Rocks, soil and how fossils form. Three views on one model:
//  - fossil: a cross-section under the sea (or a river). The animal dies and sinks, its soft parts
//    rot, mud buries the hard parts, more layers build up over millions of years (youngest on top),
//    minerals replace the bone, and erosion wears the rock away until the fossil shows.
//  - soil: the layers of soil from the surface down to bedrock, then a lens on topsoil showing what
//    soil is made of (bits of rock, rotted plants, air and water).
//  - rocks: igneous, sedimentary and metamorphic rocks with named examples, and where fossils are found.
// Built on the kit; organisms and rock textures are model-private (rocks_soil_fossils/art.js).

import { organism } from "../kit/batch-D.js";
import {
  arrow,
  computed,
  editable,
  eIO,
  GRID,
  h,
  labelGround,
  lerp,
  magnifier,
  measure,
  noteArt,
  panels,
  pictureCard,
  result,
  rng,
  schemaCheck,
  sky,
  T,
  TEXT_PARAM_FOR,
  TITLE_PARAM,
  textBlock,
  txt,
  withDefaults,
} from "../kit/index.js";
import {
  drawOrg,
  knownRock,
  ORGS,
  ROCKS,
  rockSpecimen,
  TYPE_LOOK,
} from "./rocks_soil_fossils/art.js";

export const meta = {
  id: "rocks_soil_fossils",
  name: "Rocks, soil and fossils",
  kind: "scene",
  version: 1,
  subjects: ["Science", "Geography"],
  years: ["Y3", "Y4", "Y6"],
  teaches:
    "How a fossil forms in layers of rock over millions of years, what soil is made of and how it is layered, and the three kinds of rock.",
};

const ORG_KEYS = Object.keys(ORGS);
const SOIL_ORDER = ["litter", "topsoil", "subsoil", "broken", "bedrock"];
const SOIL_NAMES = {
  litter: "Leaf litter",
  topsoil: "Topsoil",
  subsoil: "Subsoil",
  broken: "Broken rock",
  bedrock: "Bedrock",
};
const TYPES = ["igneous", "sedimentary", "metamorphic"];
const TYPE_NAMES = { igneous: "Igneous", sedimentary: "Sedimentary", metamorphic: "Metamorphic" };
const TYPE_HOW = {
  igneous: "Hot, melted rock cools and hardens.",
  sedimentary: "Layers of mud, sand or shells are pressed together.",
  metamorphic: "Rock is changed by great heat or pressure.",
};
// a typical age for each living thing's fossils (millions of years), used when the time is left at 0
const TYPICAL = {
  ammonite: 180,
  ichthyosaur: 200,
  fish: 50,
  trilobite: 450,
  dinosaur: 150,
  shell: 100,
};
const TYPE_COL = {
  igneous: "var(--heat)",
  sedimentary: "var(--crust)",
  metamorphic: "var(--compare)",
};

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Rocks, soil and fossils",
  properties: {
    title: TITLE_PARAM("How a fossil forms"),
    view: {
      type: "string",
      title: "Show",
      enum: ["fossil", "soil", "rocks"],
      "x-labels": ["How a fossil forms", "Layers of soil", "Kinds of rock"],
      default: "fossil",
    },
    words: {
      type: "string",
      title: "Words on the slide",
      enum: ["simple", "science"],
      "x-labels": ["Simple words (Year 3)", "Science words (Year 6)"],
      default: "simple",
    },
    organism: {
      type: "string",
      title: "The living thing that becomes a fossil",
      enum: ORG_KEYS,
      "x-labels": ORG_KEYS.map((k) => ORGS[k].name),
      default: "ammonite",
    },
    timescale: {
      type: "number",
      title: "How long ago it died (millions of years)",
      description:
        "Fossils take millions of years to form. Type 180 for 180 million years, or leave it at 0 to use a typical age for the living thing.",
      minimum: 0,
      maximum: 4600,
      default: 0,
    },
    found: {
      type: "object",
      title: "Who found it",
      description: "An extra step at the end naming who found the fossil.",
      default: { show: false, text: "Found by Mary Anning" },
      properties: {
        show: { type: "boolean", title: "Say who found it", default: false },
        text: {
          type: "string",
          title: "Who found it, where and when",
          maxLength: 90,
          default: "Found by Mary Anning",
        },
      },
    },
    soil: {
      type: "array",
      title: "Soil layers, from the top down",
      "x-item": "a layer",
      minItems: 2,
      maxItems: 5,
      default: [{ kind: "topsoil" }, { kind: "subsoil" }, { kind: "broken" }, { kind: "bedrock" }],
      items: {
        type: "object",
        required: ["kind"],
        default: { kind: "subsoil" },
        properties: {
          kind: {
            type: "string",
            title: "Layer",
            enum: SOIL_ORDER,
            "x-labels": SOIL_ORDER.map((k) => SOIL_NAMES[k]),
            default: "subsoil",
          },
          label: {
            type: "string",
            title: "Name on the slide",
            description: "Leave empty to use the layer’s name.",
            maxLength: 40,
            default: "",
          },
          note: { type: "string", title: "What it is like", maxLength: 70, default: "" },
        },
      },
    },
    soilInside: {
      type: "boolean",
      title: "Show what soil is made of",
      description: "A last step that looks closely at topsoil.",
      default: true,
    },
    rocks: {
      type: "array",
      title: "Rocks",
      "x-item": "a rock",
      minItems: 1,
      maxItems: 6,
      default: [
        { name: "Granite", type: "igneous" },
        { name: "Sandstone", type: "sedimentary", fossils: true },
        { name: "Marble", type: "metamorphic" },
      ],
      items: {
        type: "object",
        required: ["name", "type"],
        default: { name: "Granite", type: "igneous" },
        properties: {
          name: { type: "string", title: "Name", minLength: 1, maxLength: 32 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */ },
          type: {
            type: "string",
            title: "Kind of rock",
            enum: TYPES,
            "x-labels": TYPES.map((t) => TYPE_NAMES[t]),
            default: "igneous",
          },
          fossils: { type: "boolean", title: "Can hold fossils", default: false },
        },
      },
    },
    text: TEXT_PARAM_FOR({
      nts: "label",
      sea: "label",
      organism: "label",
      mud: "label",
      layers: "phrase",
      younger: "label",
      older: "label",
      time: "label",
      minerals: "phrase",
      worn: "label",
      "type-igneous": "label",
      "type-sedimentary": "label",
      "type-metamorphic": "label",
      "how-igneous": "sentence",
      "how-sedimentary": "sentence",
      "how-metamorphic": "sentence",
      fossils: "phrase",
      "in-rock": "label",
      "in-plant": "label",
      "in-air": "label",
      "in-water": "label",
    }),
  },
};

export const presets = [
  {
    id: "y3-fossil",
    name: "Year 3: how a fossil forms",
    params: {
      title: "How a fossil forms",
      view: "fossil",
      words: "simple",
      organism: "ammonite",
      timescale: 180,
    },
  },
  {
    id: "y3-soil",
    name: "Year 3: layers of soil",
    params: {
      title: "Layers of soil",
      view: "soil",
      words: "simple",
      soilInside: true,
      soil: [
        { kind: "topsoil", note: "Dark, with roots and rotted plants" },
        { kind: "subsoil", note: "Paler, with small stones" },
        { kind: "broken", note: "Bits of the rock below" },
        { kind: "bedrock", note: "Solid rock" },
      ],
    },
  },
  {
    id: "y3-rocks",
    name: "Year 3: three kinds of rock",
    params: {
      title: "Three kinds of rock",
      view: "rocks",
      words: "simple",
      rocks: [
        { name: "Granite", type: "igneous" },
        { name: "Pumice", type: "igneous" },
        { name: "Sandstone", type: "sedimentary", fossils: true },
        { name: "Chalk", type: "sedimentary", fossils: true },
        { name: "Marble", type: "metamorphic" },
        { name: "Slate", type: "metamorphic" },
      ],
    },
  },
  {
    id: "y6-anning",
    name: "Year 6: Mary Anning’s ichthyosaur",
    params: {
      title: "Mary Anning’s ichthyosaur",
      view: "fossil",
      words: "science",
      organism: "ichthyosaur",
      timescale: 0,
      found: {
        show: true,
        text: "Found by Mary Anning and her brother Joseph at Lyme Regis, 1811–1812",
      },
    },
  },
];

/* ------------------------------------------------------------------ wording */
const sci = (P) => P.words === "science";
const fmtMy = (n) =>
  n >= 10 ? Math.round(n).toLocaleString("en-GB") : String(Math.round(n * 10) / 10);
const timeText = (P, n) => `about ${fmtMy(n)} million years`;
const orgName = (P) => txt(P, "label:organism", ORGS[P.organism].name);
const waterWord = (P) => (ORGS[P.organism].water === "river" ? "River" : "Sea");
const soilName = (L) => L.label || SOIL_NAMES[L.kind];
const age = (P) => (P.timescale > 0 ? P.timescale : TYPICAL[P.organism]);
// the layers as they lie in the ground: top down, each kind once (the first one listed keeps its wording)
function soilLayers(P) {
  const seen = new Set();
  return P.soil
    .map((L, i) => ({ L, i }))
    .sort((a, b) => SOIL_ORDER.indexOf(a.L.kind) - SOIL_ORDER.indexOf(b.L.kind) || a.i - b.i)
    .filter((o) => !seen.has(o.L.kind) && seen.add(o.L.kind));
}
// a rock the model knows is grouped by its real kind, and igneous rock never shows fossils
const kindOf = (r) => {
  const k = knownRock(r.name);
  return k ? ROCKS[k].type : r.type;
};
const hasFossils = (r) => !!r.fossils && kindOf(r) !== "igneous";
const showInside = (P) => P.soilInside && P.soil.some((L) => L.kind === "topsoil");

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  if (P.view === "fossil") {
    const O = ORGS[P.organism],
      T0 = P.timescale;
    if (T0 === 0) {
      /* 0 means a typical age for the living thing */
    } else if (T0 < 1)
      R.push({
        path: "timescale",
        reason: `Fossils take millions of years to form, so the time is at least 1 million years. Type it in millions: 180 means 180 million years, or 0 for a typical age.`,
      });
    else if (T0 < O.range[0] || T0 > O.range[1])
      R.push({
        path: "timescale",
        reason: `${O.plural} lived from about ${O.range[1]} to ${O.range[0]} million years ago, so the fossil is between ${O.range[0]} and ${O.range[1]} million years old. Change the time, or type 0 to use a typical age for ${O.plural.toLowerCase()}.`,
      });
  }
  if (P.view === "soil") {
    // the ground fixes the order, so the slide draws the layers top down and each kind once
    let last = -1;
    const seen = new Set();
    P.soil.forEach((L, i) => {
      const k = SOIL_ORDER.indexOf(L.kind);
      if (seen.has(L.kind))
        W.push({
          path: `soil.${i}.kind`,
          reason: `${SOIL_NAMES[L.kind]} is in the list twice. The slide shows it once.`,
        });
      else if (k < last)
        W.push({
          path: `soil.${i}.kind`,
          reason: `${SOIL_NAMES[L.kind]} lies above ${SOIL_NAMES[SOIL_ORDER[last]].toLowerCase()} in the ground, so the slide draws it higher up. From the top down the layers are ${SOIL_ORDER.map((s) => SOIL_NAMES[s].toLowerCase()).join(", ")}.`,
        });
      seen.add(L.kind);
      last = Math.max(last, k);
    });
    if (P.soilInside && !P.soil.some((L) => L.kind === "topsoil"))
      W.push({
        path: "soilInside",
        reason:
          "Looking at what soil is made of needs a topsoil layer, so the close-up step is left out. Add topsoil to show it.",
      });
  }
  if (P.view === "rocks") {
    P.rocks.forEach((r, i) => {
      const k = knownRock(r.name),
        t = kindOf(r);
      if (k && t !== r.type)
        W.push({
          path: `rocks.${i}.type`,
          reason: `${k[0].toUpperCase() + k.slice(1)} is ${t === "igneous" ? "an" : "a"} ${t} rock, not ${r.type}, so the slide puts it with the ${t} rocks.`,
        });
      if (r.fossils && t === "igneous")
        W.push({
          path: `rocks.${i}.fossils`,
          reason: `Igneous rock forms from melted rock, which would destroy any living thing, so it does not hold fossils. The slide shows none in it.`,
        });
      if (r.fossils && t === "metamorphic")
        W.push({
          path: `rocks.${i}.fossils`,
          reason:
            "Heat and pressure usually destroy fossils; only a few metamorphic rocks keep squashed ones.",
        });
    });
    for (const t of TYPES)
      if (P.rocks.filter((r) => kindOf(r) === t).length > 3)
        R.push({
          path: "rocks",
          reason: `There are more than three ${t} rocks. One slide shows at most three of each kind.`,
        });
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const items = [];
  let summary;
  if (P.view === "fossil") {
    const O = ORGS[P.organism],
      nm = orgName(P),
      hard = O.hard,
      w = waterWord(P).toLowerCase();
    items.push({
      key: "dies",
      caption: `The ${nm.toLowerCase()} dies and sinks to the ${w} bed. Its soft parts rot, leaving its ${hard}.`,
    });
    items.push({
      key: "buried",
      caption: sci(P)
        ? `Sediment (mud and sand) settles on top and buries the ${hard}.`
        : `Mud and sand settle on top and bury the ${hard}.`,
    });
    items.push({
      key: "layers",
      caption: sci(P)
        ? `Over millions of years more layers build up and press the sediment into sedimentary rock.`
        : `Over millions of years more layers build up and press the mud into rock.`,
    });
    items.push({
      key: "minerals",
      caption: `Water seeps through the rock. Minerals slowly replace the ${hard}, which ${O.hard === "bones" ? "turn" : "turns"} to stone.`,
    });
    items.push({
      key: "erode",
      caption: sci(P)
        ? `The rock is lifted up and eroded by rain, wind and waves until the fossil is exposed.`
        : `The rock is lifted up and worn away by rain, wind and waves until the fossil shows.`,
    });
    if (P.found && P.found.show)
      items.push({ key: "found", caption: `${P.found.text}.`.replace(/\.\.$/, ".") });
    summary = `A fossil forms over ${timeText(P, age(P))}. The youngest layers are on top.`;
  } else if (P.view === "soil") {
    soilLayers(P).forEach(({ L, i }, j) =>
      items.push({
        key: `layer:${i}`,
        caption:
          j === 0
            ? `${soilName(L)} is the top layer${L.note ? `: ${L.note.toLowerCase()}` : ""}.`
            : `Under that is ${soilName(L).toLowerCase()}${L.note ? `: ${L.note.toLowerCase()}` : ""}.`,
      }),
    );
    if (showInside(P))
      items.push({
        key: "inside",
        caption: "Close up, topsoil is tiny bits of rock mixed with rotted plants, air and water.",
      });
    summary =
      "Soil is made in layers: the deeper you dig, the more it is like the rock underneath.";
  } else {
    const types = TYPES.filter((t) => P.rocks.some((r) => kindOf(r) === t));
    types.forEach((t) =>
      items.push({
        key: `type:${t}`,
        caption: `${((n) => (/\brocks?\b/i.test(n) ? n : `${n} rock`))(txt(P, `label:type-${t}`, TYPE_NAMES[t]))}: ${txt(P, `label:how-${t}`, TYPE_HOW[t]).replace(/^./, (c) => c.toLowerCase())}`,
      }),
    );
    if (P.rocks.some(hasFossils))
      items.push({
        key: "fossils",
        caption:
          "Fossils are found in sedimentary rock, which formed from layers that buried living things.",
      });
    summary = `Rocks are grouped by how they formed: ${types
      .map((t) => txt(P, `label:type-${t}`, TYPE_NAMES[t]).toLowerCase())
      .join(", ")
      .replace(/, ([^,]*)$/, " and $1")}.`;
  }
  return { items, summary };
}
export function builds(raw) {
  const P = withDefaults(params, raw);
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

export function notes(raw) {
  const P = withDefaults(params, raw);
  const { items } = plan(P);
  const steps = items.map((it) => {
    const k = it.key;
    const O = ORGS[P.organism];
    if (k === "dies")
      return `Most fossils form in water, where mud buries a body quickly. Animals that die on land are usually eaten or rot away completely. Ask: why are the ${O.hard} left?`;
    if (k === "buried")
      return "Quick burial keeps scavengers and oxygen away. Not to scale: the animal and the layers are drawn bigger than life so they can be seen.";
    if (k === "layers")
      return `Each layer is younger than the one under it, so the deepest layers are the oldest. The time shown is ${timeText(P, age(P))} since the ${orgName(P).toLowerCase()} died.`;
    if (k === "minerals")
      return `The fossil keeps the shape of the ${O.hard}, but it is now made of stone. Ask: is a fossil the real ${O.hard}?`;
    if (k === "erode")
      return "Movements of the Earth lift old sea beds up into land. Cliffs and beaches, such as the Jurassic Coast, are good places to find fossils.";
    if (k === "found")
      return P.organism === "ichthyosaur" && /Anning/.test(P.found.text)
        ? "Mary Anning (1799–1847) found the first ichthyosaur skeleton to be recognised, with her brother Joseph. Scientists of the time rarely credited her."
        : "Ask: who finds fossils today, and where do they look?";
    if (k.startsWith("layer:")) {
      const L = P.soil[+k.slice(6)];
      return {
        litter: "Fallen leaves and twigs rot down and feed the topsoil.",
        topsoil:
          "Topsoil holds most of the living things and the rotted plant matter (humus), which makes it dark.",
        subsoil: "Subsoil has less humus, so it is paler. Some deep roots reach it.",
        broken: "Weathering breaks the bedrock into pieces: this is where new soil starts.",
        bedrock:
          "Bedrock is solid rock. Over a very long time, weathering slowly turns its surface into soil.",
      }[L.kind];
    }
    if (k === "inside")
      return "Try it: shake soil and water in a jar and leave it to settle. Stones and sand sink first, then silt and clay, and bits of plant float.";
    if (k.startsWith("type:")) {
      const t = k.slice(5);
      return {
        igneous:
          "Magma or lava cools into crystals: slowly underground (big crystals, like granite) or quickly at the surface (small crystals, like basalt).",
        sedimentary:
          "Sedimentary rocks often have layers or grains you can see, and they can be soft and crumbly.",
        metamorphic:
          "Limestone becomes marble and mudstone becomes slate when heat and pressure change them.",
      }[t];
    }
    if (k === "fossils")
      return "Melted rock would destroy a living thing, so igneous rock has no fossils. Heat and pressure usually destroy fossils in metamorphic rock too.";
    return "";
  });
  const summary =
    P.view === "fossil"
      ? "Ask the class to retell the five steps in order, and to say where the oldest rock is."
      : P.view === "soil"
        ? "Ask: which layer would a plant’s roots grow in? Where did the bits of rock in soil come from?"
        : "Sort real rock samples into the groups using grains, crystals, layers and fossils.";
  return { steps, summary };
}

/* ------------------------------------------------------------------ helpers */
function lab(
  p,
  x,
  y,
  s,
  {
    edit,
    comp,
    anchor = "start",
    maxW = 260,
    cls = "ts-small",
    a = {},
    fill = "var(--ink)",
    maxLines = 2,
  } = {},
) {
  const g = h("g", a, p);
  const tb = textBlock(g, x, y, s, { cls, maxW, maxLines, anchor, edit, a: { fill } });
  if (comp) computed(tb.el, comp);
  const x0 = anchor === "start" ? x : anchor === "end" ? x - tb.w : x - tb.w / 2;
  const box = { x: x0 - 10, y: y - 24, w: tb.w + 20, h: tb.h + 8 };
  g.insertBefore(labelGround(g, box), g.firstChild);
  g.box = box;
  g.tb = tb;
  return g;
}
const leader = (p, x1, y1, x2, y2, a = {}) =>
  h(
    "line",
    Object.assign(
      {
        x1,
        y1,
        x2,
        y2,
        stroke: "var(--ink-2)",
        "stroke-width": "var(--sw-lead)",
        "stroke-linecap": "round",
      },
      a,
    ),
    p,
  );
const join = (...r) => r.filter(Boolean).join(",") || null;

/* ------------------------------------------------------------------ render */
export function render(root, raw, ctx) {
  const P = withDefaults(params, raw);
  if (P.view === "soil") return renderSoil(root, P, ctx);
  if (P.view === "rocks") return renderRocks(root, P, ctx);
  return renderFossil(root, P, ctx);
}

function renderFossil(root, P, ctx) {
  const b = ctx.b,
    N = ctx.N,
    bi = (k) => b[k];
  const O = ORGS[P.organism],
    sc = Math.min(760 / O.w, 230 / O.h),
    ow = O.w * sc,
    oh = O.h * sc;
  const yS = 190,
    yBed = 580,
    yBot = 660,
    LH = 36;
  const yL1 = yBed - oh - 22,
    tops = [yL1 - LH, yL1 - 2 * LH, yL1 - 3 * LH],
    yTop = tops[2];
  const ox = 760,
    oy = yBed - oh / 2 - 3,
    ySurf = oy - oh / 2 - 2,
    cliffA = 600,
    cliffB = 700;
  const soft = `${N}:soft`;

  sky(root, ctx, yBot);
  h(
    "rect",
    { x: 0, y: yS, width: 1280, height: yBed - yS, fill: "var(--sea-1)", hide: bi("erode") },
    root,
  );
  h(
    "line",
    {
      x1: 0,
      x2: 1280,
      y1: yS,
      y2: yS,
      stroke: "var(--sea-2)",
      "stroke-width": "var(--sw-struct)",
      hide: bi("erode"),
    },
    root,
  );
  // the layers: mud on the body, then three more; each boundary a hairline
  const fills = ["var(--soil)", "var(--sand)", "var(--stone)", "var(--sand-shade)"];
  const band = (g, y0, y1, fill) => {
    h("rect", { x: 0, y: y0, width: 1280, height: y1 - y0, fill }, g);
    h(
      "line",
      { x1: 0, x2: 1280, y1: y0, y2: y0, stroke: "var(--ink-3)", "stroke-width": "var(--sw-hair)" },
      g,
    );
  };
  band(h("g", { s: bi("buried"), cls: "rise" }, root), yL1, yBed, fills[0]);
  tops.forEach((t, i) =>
    band(
      h("g", { s: bi("layers"), cls: "rise", delay: i * 700 }, root),
      t,
      i ? tops[i - 1] : yL1,
      fills[i + 1],
    ),
  );
  // older rock below the sea bed, there from the start
  band(root, yBed, yBed + 40, "var(--stone)");
  band(root, yBed + 40, yBot, "var(--stone-shade)");
  // erosion: the sky shows again where rock was worn away (clipped copy of the sky)
  const cid = ctx.uid + "-worn";
  const cp = h("clipPath", { id: cid }, h("defs", {}, root));
  h(
    "path",
    {
      d: `M${cliffA} ${yTop - 2} L1280 ${yTop - 2} L1280 ${ySurf} L${cliffB} ${ySurf} C${cliffB - 40} ${ySurf} ${cliffA + 20} ${yTop + 30} ${cliffA} ${yTop - 2} Z`,
    },
    cp,
  );
  const worn = h("g", { s: bi("erode"), "clip-path": `url(#${cid})` }, root);
  sky(worn, ctx, yBot);
  h(
    "line",
    {
      x1: cliffA,
      x2: 1280,
      y1: yTop,
      y2: yTop,
      stroke: "var(--ink-2)",
      "stroke-width": "var(--sw-rule)",
      "stroke-dasharray": "8 8",
      s: bi("erode"),
      c: soft,
    },
    root,
  );

  // the living thing: hard parts under soft parts; soft parts fade once it lands
  const an = h("g", { s: bi("dies") }, root);
  const mover = h("g", {}, an);
  const inner = h("g", { transform: `scale(${sc})` }, mover);
  drawOrg(
    inner,
    P.organism,
    "hard",
    "var(--marble)",
    "var(--ink-2)",
    "var(--ink-2)",
    "var(--sw-rule)",
  );
  const body = drawOrg(inner, P.organism, "soft", "var(--stone-shade)", "var(--ink-2)");
  const fossil = h("g", { s: bi("minerals"), cls: "wipe" }, root);
  drawOrg(
    h("g", { transform: `translate(${ox} ${oy}) scale(${sc})` }, fossil),
    P.organism,
    "hard",
    "var(--ink-3)",
    "var(--ink-2)",
    "var(--ink-2)",
  );
  const y0a = yS + oh / 2 + 16;
  const place = (u) => {
    const y = lerp(y0a, oy, eIO(Math.min(1, u / 0.55)));
    mover.setAttribute("transform", `translate(${ox} ${y.toFixed(1)})`);
    body.style.opacity = String(1 - Math.max(0, Math.min(1, (u - 0.6) / 0.4)));
  };
  place(1);

  // labels
  const mid = h("g", {}, root),
    lbl = h("g", {}, root);
  // the time box (top right) is sized first; "Not to scale" wraps in the room left of it
  const tg = h("g", { s: bi("layers") }, lbl);
  const head = txt(P, "label:time", "Time since it died");
  const tmp = h("g", {}, root);
  const hb = textBlock(tmp, 0, 0, head, { cls: "ts-small", maxW: 380, maxLines: 2, lh: 26 });
  const tLong = timeText(P, age(P)),
    tw = Math.max(hb.w, measure(root, tLong, "ts-label", { cls: "strong" }));
  tmp.remove();
  const boxX = GRID.right - tw - 20,
    yClock = 138 + hb.h + 6;
  textBlock(lbl, GRID.left, GRID.subY, txt(P, "label:nts", "Not to scale"), {
    cls: "ts-small",
    maxW: boxX - 28 - GRID.left,
    maxLines: 2,
    lh: 26,
    edit: "text.label:nts",
  });
  lab(lbl, 80, yS + 30, txt(P, "label:sea", waterWord(P)), {
    edit: "text.label:sea",
    a: { s: bi("dies"), hide: bi("layers") },
  });
  lab(lbl, ox - ow / 2 - 22, oy + 8, orgName(P), {
    edit: "text.label:organism",
    anchor: "end",
    maxW: 300,
    a: { s: bi("dies"), delay: 1200, hide: bi("buried") },
  });
  lab(lbl, ox - ow / 2 - 22, oy + 8, orgName(P), {
    edit: "text.label:organism",
    anchor: "end",
    maxW: 300,
    a: { s: bi("erode") },
  });
  const mudS = txt(P, "label:mud", sci(P) ? "Sediment" : "Mud and sand"),
    mudW = Math.max(220, Math.min(320, ox - ow / 2 - 160));
  const mudN = Math.min(3, Math.max(1, Math.floor((yBed - yL1 - 12) / 30)));
  const mudT = h("g", {}, root),
    mudL = textBlock(mudT, 0, 0, mudS, { cls: "ts-small", maxW: mudW, maxLines: mudN }).lines
      .length;
  mudT.remove();
  lab(lbl, 130, (yL1 + yBed) / 2 + 8 - (mudL - 1) * 15, mudS, {
    edit: "text.label:mud",
    maxW: mudW,
    maxLines: mudN,
    a: { s: bi("buried"), hide: bi("layers") },
  });
  lab(
    lbl,
    270,
    (yTop + yL1) / 2 + 8,
    txt(P, "label:layers", sci(P) ? "Layers of sedimentary rock" : "New layers of rock"),
    { edit: "text.label:layers", maxW: 440, a: { s: bi("layers"), hide: bi("minerals") } },
  );
  // younger on top, older below
  const ag = h("g", { s: bi("layers"), c: soft }, mid);
  arrow(
    ctx,
    ag,
    `M84 ${yBot - 46} L84 ${yTop + 12}`,
    84,
    yTop + 12,
    -Math.PI / 2,
    "var(--ink)",
    "var(--sw-struct)",
  );
  lab(lbl, 108, yTop + 34, txt(P, "label:younger", "Younger"), {
    edit: "text.label:younger",
    maxW: 150,
    maxLines: 1,
    a: { s: bi("layers") },
  });
  lab(lbl, 108, yBot - 46, txt(P, "label:older", "Older"), {
    edit: "text.label:older",
    maxW: 150,
    maxLines: 1,
    a: { s: bi("layers") },
  });
  // the time since it died, counted up while the layers build
  labelGround(tg, { x: boxX, y: 114, w: tw + 28, h: yClock - 114 + 14 });
  textBlock(tg, GRID.right - 4, 138, head, {
    cls: "ts-small",
    maxW: 380,
    maxLines: 2,
    lh: 26,
    anchor: "end",
    edit: "text.label:time",
  });
  const clock = computed(
    T(tg, GRID.right - 4, yClock, timeText(P, age(P)), "ts-label", {
      "text-anchor": "end",
      cls: "strong",
      fill: "var(--ink)",
    }),
    "timescale",
  );
  // minerals replace the hard parts
  const mg = lab(
    lbl,
    ox,
    yL1 - 16,
    txt(
      P,
      "label:minerals",
      sci(P)
        ? `Minerals replace the ${O.hard}`
        : `The ${O.hard} ${O.hard === "bones" ? "turn" : "turns"} to stone`,
    ),
    { edit: "text.label:minerals", anchor: "middle", maxW: 380, a: { s: bi("minerals") } },
  );
  leader(h("g", { s: bi("minerals") }, mid), ox, mg.box.y + mg.box.h, ox, ySurf + 6);
  lab(lbl, 1010, yTop + 34, txt(P, "label:worn", sci(P) ? "Eroded rock" : "Rock worn away"), {
    edit: "text.label:worn",
    anchor: "middle",
    maxW: 380,
    maxLines: 1,
    a: { s: bi("erode") },
  });
  if (b.found != null) {
    const fy = measure(root, P.found.text, "ts-small") > 880 ? yBed + 22 : yBed + 36; // keep two lines clear of the caption
    const fg = lab(lbl, ox, fy, P.found.text, { edit: "found.text", anchor: "middle", maxW: 880 });
    fg.dataset.s = bi("found");
    fg.setAttribute("class", "rise");
    leader(h("g", { s: bi("found") }, mid), ox, fg.box.y, ox, yBed - 4);
  }
  const bD = bi("dies"),
    bL = bi("layers");
  return {
    dur: { dies: 2600, layers: 2400 },
    still() {
      place(1);
      clock.textContent = timeText(P, age(P));
    },
    reset() {
      place(0);
      clock.textContent = timeText(P, 0);
    },
    tick(k, u) {
      if (k === bD) place(u);
      else if (k > bD) place(1);
      if (k === bL) clock.textContent = timeText(P, age(P) * eIO(u));
      else if (k > bL) clock.textContent = timeText(P, age(P));
    },
  };
}

function renderSoil(root, P, ctx) {
  const b = ctx.b,
    N = ctx.N,
    R = rng(11);
  const y0 = 262,
    yEnd = 660,
    yVis = 640;
  const W8 = { litter: 0.3, topsoil: 1, subsoil: 1.15, broken: 1, bedrock: 1.1 };
  const layers = soilLayers(P),
    tot = layers.reduce((s, o) => s + W8[o.L.kind], 0);
  let y = y0;
  const bands = layers.map(({ L, i }, j) => {
    const hh = ((yVis - y0) * W8[L.kind]) / tot;
    const o = { L, i, j, y0: y, y1: y + hh, k: b[`layer:${i}`] };
    y += hh;
    return o;
  });
  bands[bands.length - 1].y1 = yEnd;
  const wav = (yy, seed) => {
    const r = rng(seed),
      ph = r() * 6;
    let d = `M0 ${yy}`;
    for (let x = 40; x <= 1280; x += 40)
      d += ` L${x} ${(yy + 5 * Math.sin(ph + x / 90)).toFixed(1)}`;
    return d;
  };
  sky(root, ctx, y0 + 4);
  const FILL =
    ctx.name === "night"
      ? {
          litter: "var(--crust)",
          topsoil: "color-mix(in oklab,var(--hue-brown) 36%,var(--shade))",
          subsoil: "color-mix(in oklab,var(--hue-brown) 58%,var(--shade))",
          broken: "color-mix(in oklab,var(--hue-grey) 60%,var(--shade))",
          bedrock: "color-mix(in oklab,var(--hue-grey) 78%,var(--shade))",
        }
      : {
          litter: "var(--crust)",
          topsoil: "var(--soil-deep)",
          subsoil: "var(--soil)",
          broken: "var(--sand-shade)",
          bedrock: "var(--stone-shade)",
        };
  const bandG = [];
  // each band runs to the bottom; the next one down is drawn over it, so its wavy top shows
  for (const o of bands) {
    const g = h("g", { s: o.k, cls: "rise" }, root);
    bandG[o.j] = g;
    const top = o.j === 0 ? `M0 ${o.y0} L1280 ${o.y0}` : wav(o.y0, o.j * 7);
    h("path", { d: `${top} L1280 ${yEnd} L0 ${yEnd} Z`, fill: FILL[o.L.kind] }, g);
    if (o.j === 0)
      h(
        "path",
        { d: top, fill: "none", stroke: "var(--soil)", "stroke-width": "var(--sw-struct)" },
        g,
      );
    const yA = o.y0 + 10,
      yB = Math.min(o.y1, yVis) - 8,
      rx = () => 20 + R() * 1240,
      ry = () => yA + R() * (yB - yA);
    if (o.L.kind === "litter")
      for (let j = 0; j < 46; j++)
        h(
          "ellipse",
          {
            cx: rx(),
            cy: o.y0 + 4 + R() * (o.y1 - o.y0 - 6),
            rx: 9,
            ry: 3.5,
            transform: "",
            fill: j % 2 ? "var(--leaf)" : "var(--trunk)",
          },
          g,
        );
    if (o.L.kind === "topsoil")
      for (let j = 0; j < 60; j++)
        h(
          "ellipse",
          { cx: rx(), cy: ry(), rx: 2 + R() * 4, ry: 1.5 + R() * 2, fill: "var(--crust)" },
          g,
        );
    if (o.L.kind === "subsoil")
      for (let j = 0; j < 34; j++)
        h(
          "ellipse",
          { cx: rx(), cy: ry(), rx: 3 + R() * 5, ry: 2 + R() * 4, fill: "var(--stone)" },
          g,
        );
    if (o.L.kind === "broken")
      for (let j = 0; j < 30; j++) {
        const cx = rx(),
          cy = ry(),
          s = 9 + R() * 14,
          a0 = R() * 6;
        h(
          "path",
          {
            d: `M${cx + s * Math.cos(a0)} ${cy + s * Math.sin(a0) * 0.7} L${cx + s * Math.cos(a0 + 2)} ${cy + s * Math.sin(a0 + 2) * 0.7} L${cx + s * Math.cos(a0 + 3.4)} ${cy + s * Math.sin(a0 + 3.4) * 0.7} L${cx + s * Math.cos(a0 + 4.8)} ${cy + s * Math.sin(a0 + 4.8) * 0.7} Z`,
            fill: "var(--stone)",
            stroke: "var(--stone-shade)",
            "stroke-width": "var(--sw-hair)",
          },
          g,
        );
      }
    if (o.L.kind === "bedrock")
      for (let j = 0; j < 9; j++) {
        const cx = rx(),
          cy = ry();
        h(
          "path",
          {
            d: `M${cx} ${cy} l${8 + R() * 10} ${14 + R() * 10} l${-6 + R() * 12} ${12 + R() * 8}`,
            fill: "none",
            stroke: "var(--ink-3)",
            "stroke-width": "var(--sw-hair)",
          },
          g,
        );
      }
  }
  // plants and roots on the surface, with the first layer
  const k0 = bands[0].k,
    top = bands.find((o) => o.L.kind === "topsoil");
  const pg = h("g", { s: k0, cls: "rise" }, root);
  if (top)
    for (const [x, d] of [
      [380, 1],
      [420, -1],
    ])
      h(
        "path",
        {
          d: `M400 ${y0} C${x} ${y0 + 30} ${x + d * 30} ${y0 + 50} ${x + d * 40} ${Math.min(top.y1 - 6, y0 + 92)}`,
          fill: "none",
          stroke: "var(--trunk)",
          "stroke-width": "var(--sw-rule)",
          "stroke-linecap": "round",
        },
        pg,
      );
  for (const [x, s] of [
    [120, 0.9],
    [210, 0.7],
    [560, 0.8],
    [700, 1],
    [1180, 0.8],
  ])
    organism(pg, "grass", x, y0, s);
  organism(pg, "flower", 400, y0, 0.95);
  if (top)
    organism(h("g", { s: top.k, cls: "rise" }, root), "worm", 700, (top.y0 + top.y1) / 2 + 12, 0.8);

  // layer names on the right, inside their bands (the top one may sit in the sky)
  const lbl = h("g", {}, root),
    mid = h("g", {}, root);
  const LX = 800,
    maxW = GRID.right - LX - 16;
  const bInside = b.inside;
  for (const o of bands) {
    const gG = h("g", { s: o.k, cls: "rise" }, lbl); // the card stays solid; only the words recede
    const g = h(
      "g",
      { s: o.k, cls: "rise", c: bInside != null ? `${bInside}-${bInside + 1}:soft` : null },
      lbl,
    );
    const name = soilName(o.L); // the note is in the caption, so the card holds the name only
    const tmp = h("g", {}, root);
    const t1 = textBlock(tmp, 0, 0, name, { cls: "ts-label", maxW, maxLines: 2, lh: 32 });
    tmp.remove();
    const hh = t1.h + 4,
      w = t1.w;
    const bandH = Math.min(o.y1, yVis) - o.y0;
    let yTop = o.y0 + (bandH - hh) / 2;
    if (bandH < hh + 8) {
      if (o.j === 0) {
        yTop = o.y0 - hh - 22;
        leader(
          h("g", { s: o.k, c: ctx.rc(`layer:${o.i}`, bInside != null ? "inside" : null) }, mid),
          LX + 40,
          yTop + hh + 4,
          LX + 40,
          o.y0 + (o.y1 - o.y0) / 2,
        );
      } else ctx.warn(`No room inside the layer “${name}” for its label.`);
    }
    labelGround(gG, { x: LX - 12, y: yTop - 2, w: w + 24, h: hh + 6 });
    const e1 = textBlock(g, LX, yTop + 27, name, {
      cls: t1.cls,
      maxW,
      maxLines: 2,
      lh: 32,
      a: { fill: "var(--ink)" },
    });
    editable(e1.el, `soil.${o.i}.label`);
  }

  // close up: what topsoil is made of
  if (bInside != null && top) {
    const sy = (top.y0 + top.y1) / 2,
      M = magnifier(ctx, root, {
        id: "soil",
        sx: 610,
        sy,
        sr: 20,
        cx: 250,
        cy: 452,
        r: 150,
        a: { s: bInside, cls: "rise" },
      });
    const R2 = rng(5),
      cx = 250,
      cy = 452;
    const g = M.inner;
    h("rect", { x: cx - 160, y: cy - 160, width: 320, height: 320, fill: "var(--lens-bg)" }, g);
    const grains = [
      [-90, -70, 30],
      [-20, -96, 26],
      [60, -60, 34],
      [-70, 20, 34],
      [20, 0, 28],
      [96, 30, 26],
      [-30, 92, 30],
      [60, 100, 24],
      [-120, 80, 20],
      [130, -20, 18],
    ];
    for (const [dx, dy, r] of grains) {
      const a0 = R2() * 6;
      const pts = Array.from({ length: 6 }, (_, j) => {
        const t = a0 + (j * Math.PI) / 3,
          rr = r * (0.75 + R2() * 0.3);
        return `${(cx + dx + rr * Math.cos(t)).toFixed(1)} ${(cy + dy + rr * Math.sin(t)).toFixed(1)}`;
      });
      h(
        "path",
        {
          d: "M" + pts.join(" L") + " Z",
          fill: "var(--sand-shade)",
          stroke: "var(--stone-shade)",
          "stroke-width": "var(--sw-hair)",
        },
        g,
      );
      h(
        "path",
        {
          d: `M${cx + dx - r * 0.55} ${cy + dy + r * 0.55} A${r * 0.8} ${r * 0.8} 0 0 0 ${cx + dx + r * 0.6} ${cy + dy + r * 0.5}`,
          fill: "none",
          stroke: "var(--water)",
          "stroke-width": "var(--sw-struct)",
          "stroke-linecap": "round",
        },
        g,
      );
    }
    const humus = [
      [-34, -36],
      [100, -96],
      [-110, -16],
      [36, 54],
      [120, 84],
    ];
    for (const [dx, dy] of humus)
      h(
        "path",
        {
          d: `M${cx + dx - 16} ${cy + dy} C${cx + dx - 6} ${cy + dy - 12} ${cx + dx + 10} ${cy + dy - 10} ${cx + dx + 18} ${cy + dy + 2} C${cx + dx + 6} ${cy + dy + 8} ${cx + dx - 8} ${cy + dy + 8} ${cx + dx - 16} ${cy + dy} Z`,
          fill: "var(--trunk)",
        },
        g,
      );
    M.rim();
    const marks = [
      { id: "in-rock", s: sci(P) ? "Rock particles" : "Tiny bits of rock", at: [cx + 60, cy - 60] },
      {
        id: "in-plant",
        s: sci(P) ? "Humus (rotted plants)" : "Rotted plants",
        at: [cx + 100, cy - 96],
      },
      { id: "in-air", s: "Air", at: [cx + 66, cy + 50] },
      { id: "in-water", s: "Water", at: [cx + 96 + 15, cy + 30 + 12] },
    ];
    const lg = h("g", { s: bInside, cls: "rise", delay: 600 }, root);
    // a long name wraps to two lines; the rows then stack further apart and start higher so they stay above the foot
    const nl = marks.map((m) => {
      const t = h("g", {}, root);
      const n = textBlock(t, 0, 0, txt(P, `label:${m.id}`, m.s), { maxW: LX - 470, maxLines: 2 })
        .lines.length;
      t.remove();
      return n;
    });
    const gapOf = (n) => Math.max(64, n * 30 + 26),
      span = nl.slice(0, -1).reduce((a, n) => a + gapOf(n), 0);
    let ly = Math.min(360, GRID.bottom - 30 - span - (nl[nl.length - 1] - 1) * 30);
    marks.forEach((m, j) => {
      if (j) ly += gapOf(nl[j - 1]);
      const L = lab(lg, 440, ly, txt(P, `label:${m.id}`, m.s), {
        edit: `text.label:${m.id}`,
        maxW: LX - 470,
        maxLines: 2,
      });
      leader(lg, m.at[0], m.at[1], L.box.x, L.box.y + L.box.h / 2);
      lg.appendChild(L);
      h("circle", { cx: m.at[0], cy: m.at[1], r: 4, fill: "var(--ink)" }, lg);
    });
  }
  return {};
}

function renderRocks(root, P, ctx) {
  const b = ctx.b,
    N = ctx.N;
  const types = TYPES.filter((t) => P.rocks.some((r) => kindOf(r) === t));
  const cols = panels(types.length, 130, GRID.bottom);
  const bF = b.fossils;
  let sedEnd = 300;
  // a long kind name wraps inside its column; every column's rows then start below the deepest heading
  const HL = 34,
    hmax = Math.max(
      ...types.map((t, ci) => {
        const tmp = h("g", {}, root);
        const tb = textBlock(tmp, 0, 0, txt(P, `label:type-${t}`, TYPE_NAMES[t]), {
          cls: "ts-h3",
          maxW: cols[ci].w - 8,
          maxLines: 2,
          lh: HL,
        });
        tmp.remove();
        return tb.h - tb.lh;
      }),
    );
  const yBar = 190 + hmax,
    yR = 222 + hmax;
  types.forEach((t, ci) => {
    const c = cols[ci],
      k = b[`type:${t}`];
    const g = h(
      "g",
      { s: k, cls: "rise", c: bF != null && t !== "sedimentary" ? `${bF}-${bF + 1}:soft` : null },
      root,
    );
    textBlock(g, c.x, 176, txt(P, `label:type-${t}`, TYPE_NAMES[t]), {
      cls: "ts-h3",
      maxW: c.w - 8,
      maxLines: 2,
      lh: HL,
      edit: `text.label:type-${t}`,
      a: { fill: "var(--ink)" },
    });
    h(
      "rect",
      { x: c.x, y: yBar, width: Math.min(c.w, 120), height: 8, rx: 4, fill: TYPE_COL[t] },
      g,
    );
    const list = P.rocks.map((r, i) => ({ r, i })).filter((o) => kindOf(o.r) === t);
    const rowH = Math.min(200, (GRID.bottom - 60 - yR) / Math.max(list.length, 1));
    // the specimen gives way so the longest word of a name fits on its line unbroken
    const wordW = Math.max(
      0,
      ...list.flatMap((o) => o.r.name.split(/\s+/).map((wd) => measure(root, wd, "ts-label"))),
    );
    const rw = Math.max(120, Math.min(200, c.w * 0.5, c.w - 48 - wordW));
    list.forEach(({ r, i }, j) => {
      const cy = yR + rowH * j + rowH / 2,
        rh = Math.min(rowH - 22, 150);
      if (t === "sedimentary") sedEnd = cy + rh / 2;
      const kr = knownRock(r.name),
        look = kr ? ROCKS[kr].look : TYPE_LOOK[t];
      const sp = rockSpecimen(ctx, g, c.x + rw / 2, cy, rw, rh, look, i + 1);
      const nMax = Math.max(2, Math.min(3, Math.floor((rowH - 12) / 30))),
        tn = h("g", {}, root);
      const nL = textBlock(tn, 0, 0, r.name, {
        cls: "ts-label",
        maxW: c.w - rw - 26,
        maxLines: nMax,
        lh: 30,
      }).lines.length;
      tn.remove();
      textBlock(g, c.x + rw + 22, cy + 9 - (nL - 1) * 15, r.name, {
        cls: "ts-label",
        maxW: c.w - rw - 26,
        maxLines: nMax,
        lh: 30,
        edit: `rocks.${i}.name`,
        a: { fill: "var(--ink)" },
      });
      if (hasFossils(r) && bF != null) {
        const fg = h("g", { s: bF, cls: "pop", transform: "" }, root);
        const s2 = (Math.min(rw, rh) * 0.74) / 124;
        const fx = c.x + rw * 0.5,
          fy = cy + 2;
        // the icon follows the rock's own fossils: coal formed from swamp plants, so it never shows a sea shell
        const plantRock = /\b(coal|lignite|peat|anthracite)\b/i.test(r.name);
        if (plantRock)
          pictureCard(fg, "Plant fossils", fx, cy + rh * 0.3, {
            w: rw * 0.8,
            h: rh * 0.6,
            model: "rocks_soil_fossils",
            hint: "plant fossil",
          });
        else {
          drawOrg(
            h("g", { transform: `translate(${fx} ${fy}) scale(${s2})` }, fg),
            "ammonite",
            "hard",
            "var(--soil-deep)",
            "var(--paper)",
          );
          noteArt("ammonite fossil", "ammonite");
        }
      }
    });
  });
  if (bF != null) {
    const ci = types.indexOf("sedimentary");
    if (ci >= 0) {
      const c = cols[ci];
      const L = lab(
        root,
        c.x + 10,
        Math.min(GRID.bottom - 24, sedEnd + 46),
        txt(P, "label:fossils", "Fossils are found here"),
        { edit: "text.label:fossils", maxW: c.w - 20, maxLines: 1, a: { s: bF, cls: "rise" } },
      );
      L.setAttribute("fill", "var(--ink)");
    }
  }
  return {};
}

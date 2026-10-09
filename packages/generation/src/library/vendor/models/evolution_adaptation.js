// Adaptation, inheritance and evolution: a population that already varies, a pressure that
// acts on it, survivors that breed young like themselves, and the next generations shifting.
// Rows are generations (oldest at the top); the counts are worked out by the model, never
// typed. The last row can jump "many generations later", and is labelled so. Optional fossil
// layers (shape traits with a real fossil record only) show the same change over deep time.

import { organism } from "../kit/batch-D.js";
import {
  clamp,
  computed,
  editable,
  GRID,
  h,
  result,
  rng,
  schemaCheck,
  T,
  TEXT_PARAM,
  TITLE_PARAM,
  textBlock,
  txt,
  withDefaults,
} from "../kit/index.js";
import { ART_SIZE, fossilGiraffe, individual } from "./evolution_adaptation/art.js";

export const meta = {
  id: "evolution_adaptation",
  name: "Adaptation and evolution",
  kind: "scene",
  version: 1,
  subjects: ["Science"],
  years: ["Y6", "KS3"],
  teaches:
    "Living things vary, the ones best suited to their environment survive and breed, their young inherit those traits, and over many generations the population changes.",
};

/* ------------------------------------------------------------------ what the model knows */
const ORG = {
  moth: {
    label: "Peppered moth (wing colour)",
    noun: "moths",
    ends: ["pale", "dark"],
    colour: true,
    discrete: true,
  },
  beetle: {
    label: "Beetle (shell colour)",
    noun: "beetles",
    ends: ["green", "brown"],
    colour: true,
    discrete: true,
  },
  finch: {
    label: "Ground finch (beak size)",
    noun: "finches",
    ends: ["small-beaked", "big-beaked"],
    colour: false,
    discrete: false,
  },
  giraffe: {
    label: "Giraffe (neck length)",
    noun: "giraffes",
    ends: ["shorter-necked", "longer-necked"],
    colour: false,
    discrete: false,
    fossils: true,
  },
};
const LICHEN = "color-mix(in oklab, var(--hue-grey) 22%, var(--cloud))";
const SOOT = "color-mix(in oklab, var(--shade) 66%, var(--cloud))";
const SOIL = "color-mix(in oklab, var(--hue-brown) 55%, var(--cloud))";
const LEAVES = "color-mix(in oklab, var(--leaf) 45%, var(--cloud))";
const PRESS = {
  soot: {
    org: "moth",
    label: "Soot from factories",
    favours: 1,
    bg: [LICHEN, SOOT],
    pic: "bird",
    words: "Soot from factories darkens the tree bark. Birds eat the moths they can see.",
    cap: (E, O) => `Soot darkens the bark. Birds spot and eat more of the ${E[0]} ${O.noun}.`,
  },
  clean: {
    org: "moth",
    label: "Cleaner air",
    favours: 0,
    bg: [SOOT, LICHEN],
    pic: "bird",
    words: "Cleaner air: pale lichen grows back on the bark. Birds eat the moths they can see.",
    cap: (E, O) => `The bark turns pale again. Birds spot and eat more of the ${E[1]} ${O.noun}.`,
  },
  soil: {
    org: "beetle",
    label: "Living on brown soil",
    favours: 1,
    bg: [SOIL, SOIL],
    pic: "bird",
    words: "The beetles live on brown soil. Birds eat the beetles they can see.",
    cap: (E, O) => `Birds hunt over brown soil and eat more of the ${E[0]} ${O.noun}.`,
  },
  leaves: {
    org: "beetle",
    label: "Living on green leaves",
    favours: 0,
    bg: [LEAVES, LEAVES],
    pic: "bird",
    words: "The beetles live on green leaves. Birds eat the beetles they can see.",
    cap: (E, O) => `Birds hunt among green leaves and eat more of the ${E[1]} ${O.noun}.`,
  },
  drought: {
    org: "finch",
    label: "A drought",
    favours: 1,
    pic: "big-seeds",
    words: "A drought: the small seeds run out. Only big, hard seeds are left.",
    cap: (E, O) => `Only big, hard seeds are left. More of the ${E[0]} ${O.noun} starve.`,
  },
  wet: {
    org: "finch",
    label: "Wet years",
    favours: 0,
    pic: "small-seeds",
    words: "Wet years: lots of small, soft seeds and few big ones.",
    cap: (E, O) => `Small seeds are everywhere. More of the ${E[1]} ${O.noun} go hungry.`,
  },
  high: {
    org: "giraffe",
    label: "Food only high up",
    favours: 1,
    pic: "tree",
    words: "The low leaves have been eaten. Food is left only high in the trees.",
    cap: (E, O) => `Only high leaves are left. More of the ${E[0]} ${O.noun} go hungry.`,
  },
};
const ORG_KEYS = Object.keys(ORG),
  PRESS_KEYS = Object.keys(PRESS);
// The living thing leads. A change that acts on a different living thing is carried over to this
// one's change in the same direction (soot -> brown soil -> drought), so neither setting ever has
// to wait for the other; validate() says what is shown and which setting to change.
const carried = (P) => {
  if (PRESS[P.pressure]?.org === P.organism) return P.pressure;
  const own = PRESS_KEYS.filter((k) => PRESS[k].org === P.organism),
    f = PRESS[P.pressure]?.favours;
  return own.find((k) => PRESS[k].favours === f) || own[0];
};
const eff = (P) => (PRESS[P.pressure]?.org === P.organism ? P : { ...P, pressure: carried(P) });

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Adaptation and evolution",
  properties: {
    title: TITLE_PARAM("How a population adapts"),
    organism: {
      type: "string",
      title: "Living thing and the way it varies",
      enum: ORG_KEYS,
      "x-labels": ORG_KEYS.map((k) => ORG[k].label),
      default: "moth",
    },
    pressure: {
      type: "string",
      title: "What makes survival harder",
      description:
        "The change in the environment that acts on the variation. It must suit the living thing.",
      enum: PRESS_KEYS,
      "x-labels": PRESS_KEYS.map((k) => `${PRESS[k].label} (${ORG[PRESS[k].org].noun})`),
      default: "soot",
    },
    populationSize: {
      type: "integer",
      title: "How many in each generation",
      minimum: 6,
      maximum: 10,
      default: 8,
    },
    startCount: {
      type: "integer",
      title: "How many already have the helpful trait at the start",
      description: "Variation must be there before the change: at least one, and not all of them.",
      minimum: 0,
      maximum: 10,
      default: 2,
    },
    generations: {
      type: "integer",
      title: "Generations shown (rows)",
      minimum: 3,
      maximum: 6,
      default: 5,
    },
    lastRow: {
      type: "string",
      title: "The last row shows",
      enum: ["many", "next"],
      "x-labels": ["Many generations later", "Just the next generation"],
      default: "many",
    },
    showCounts: {
      type: "boolean",
      title: "Show how many in each generation have the trait",
      default: true,
    },
    showFossils: {
      type: "boolean",
      title: "Show fossil evidence",
      description:
        "Fossil layers, oldest at the bottom. Only for traits that fossils record (bones, not colour).",
      default: false,
    },
    arrangement: {
      type: "integer",
      title: "Shuffle the starting population",
      minimum: 1,
      maximum: 9,
      default: 1,
      "x-panel": "advanced",
    },
    text: TEXT_PARAM,
  },
};

export const presets = [
  {
    id: "y6-peppered-moths",
    name: "Year 6: peppered moths",
    params: {
      title: "Peppered moths and soot",
      organism: "moth",
      pressure: "soot",
      populationSize: 8,
      startCount: 2,
      generations: 5,
      lastRow: "many",
    },
  },
  {
    id: "y6-darwins-finches",
    name: "Year 6: Darwin's finches in a drought",
    params: {
      title: "Darwin's finches in a drought",
      organism: "finch",
      pressure: "drought",
      populationSize: 8,
      startCount: 3,
      generations: 4,
      lastRow: "next",
    },
  },
  {
    id: "y6-giraffe-fossils",
    name: "Year 6: giraffe necks and fossils",
    params: {
      title: "Giraffe necks over a long time",
      organism: "giraffe",
      pressure: "high",
      populationSize: 7,
      startCount: 2,
      generations: 4,
      lastRow: "many",
      showFossils: true,
    },
  },
  {
    id: "y5-beetles",
    name: "Year 6: camouflaged beetles",
    params: {
      title: "Which beetles survive?",
      organism: "beetle",
      pressure: "soil",
      populationSize: 6,
      startCount: 1,
      generations: 3,
      lastRow: "many",
      arrangement: 3,
    },
  },
];

/* ------------------------------------------------------------------ the population, worked out */
const ends = (P) => {
  const O = ORG[P.organism];
  return [txt(P, "label:end0", O.ends[0]), txt(P, "label:end1", O.ends[1])];
};

function simulate(P) {
  const O = ORG[P.organism],
    f = PRESS[P.pressure].favours,
    n = P.populationSize;
  const r = rng(P.arrangement * 7919 + n * 131 + P.startCount * 17 + ORG_KEYS.indexOf(P.organism));
  const fav = (v) => (f ? v >= 0.5 : v < 0.5);
  const pick = new Set();
  while (pick.size < Math.min(P.startCount, n)) pick.add(Math.floor(r() * n));
  const favV = () => (O.discrete ? (f ? 0.9 : 0.1) : f ? 0.66 + 0.28 * r() : 0.34 - 0.28 * r());
  const unV = () => (O.discrete ? (f ? 0.1 : 0.9) : f ? 0.06 + 0.3 * r() : 0.94 - 0.3 * r());
  let row = Array.from({ length: n }, (_, i) => ({
    v: pick.has(i) ? favV() : unV(),
    parent: null,
  }));
  // the pressure: about half of the less suited die before breeding (the least suited first),
  // and once the suited are common, bad luck takes one of them too
  const select = (inds) => {
    const fit = (i) => (f ? inds[i].v : 1 - inds[i].v);
    const idx = inds.map((x, i) => i);
    const un = idx.filter((i) => !fav(inds[i].v)).sort((a, b) => fit(a) - fit(b) || a - b);
    const fv = idx.filter((i) => fav(inds[i].v));
    const dead = new Set(un.slice(0, Math.ceil(un.length / 2)));
    if (fv.length >= 4) dead.add(fv[Math.floor(r() * fv.length)]);
    inds.forEach((x, i) => {
      x.eaten = dead.has(i);
    });
    return { fs: fv.filter((i) => !dead.has(i)), us: un.filter((i) => !dead.has(i)) };
  };
  // survivors breed: the share of young with the trait matches the share of survivors with it,
  // and each young one takes after one parent (offspring resemble their parents)
  const breed = (inds, { fs, us }) => {
    const c = us.length ? Math.round((n * fs.length) / (fs.length + us.length)) : n;
    const kids = [];
    for (let j = 0; j < c; j++) kids.push({ parent: fs[j % fs.length] });
    for (let j = 0; j < n - c; j++) kids.push({ parent: us[j % us.length] });
    kids.sort((a, b) => a.parent - b.parent);
    // continuous traits: young stay in their parent's band (the two counted kinds look clearly
    // different), and among the favoured the pressure keeps pulling towards the helpful end
    for (const k of kids) {
      const pv = inds[k.parent].v,
        hi = pv >= 0.5,
        pull = fav(pv) ? (f ? 0.15 : -0.15) : 0;
      k.v = O.discrete
        ? pv
        : clamp(pv + (r() - 0.5 + pull) * 0.12, hi ? 0.66 : 0.03, hi ? 0.97 : 0.34);
    }
    return kids;
  };
  const rows = [row];
  const cons = P.lastRow === "many" ? P.generations - 1 : P.generations;
  for (let g = 1; g < cons; g++) {
    row = breed(row, select(row));
    rows.push(row);
  }
  if (P.lastRow === "many") {
    let x = breed(row, select(row)); // the last shown generation still faces the pressure
    for (let g = 0; g < 30; g++) {
      x = breed(x, select(x));
    }
    x.forEach((i) => {
      i.parent = null;
      i.eaten = false;
    });
    rows.push(x);
  }
  const counts = rows.map((R) => R.filter((x) => fav(x.v)).length);
  return { rows, counts, f, n, cons, many: P.lastRow === "many" };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  const O = ORG[P.organism],
    Pick = PRESS[P.pressure],
    Pr = PRESS[carried(P)],
    E = ends(P);
  const good = E[Pr.favours],
    other = E[1 - Pr.favours];
  // the trait words must name what is drawn: a colour word on an end that is drawn another colour (green
  // beetles keyed "White" for Arctic hares) is refused, so the key never contradicts the picture
  const COLOURS =
    /\b(white|black|brown|green|grey|gray|red|yellow|orange|blue|purple|pink|pale|dark|light|sandy|golden|speckled|spotted|striped|ginger|tan|silver)\b/gi;
  const SAME = {
    moth: [
      ["pale", "light", "white", "speckled", "peppered", "spotted"],
      ["dark", "black", "sooty"],
    ],
    beetle: [["green"], ["brown", "dark"]],
  }[P.organism];
  E.forEach((e, j) => {
    const used = (String(e).match(COLOURS) || []).map((w) => w.toLowerCase());
    const bad = SAME ? used.filter((w) => !SAME[j].includes(w)) : used;
    if (bad.length)
      R.push({
        path: `text.label:end${j}`,
        reason: `The ${ORG[P.organism].noun} are drawn ${SAME ? SAME[j][0] : "by " + O.ends[j]}, so “${e}” would name a colour the picture does not show. Use words for what is drawn, such as “${O.ends[j]}”.`,
      });
  });
  if (R.length) return result(R);
  if (Pick.org !== P.organism)
    W.push({
      path: "pressure",
      reason: `“${Pick.label}” acts on ${ORG[Pick.org].noun}, not ${O.noun}, so the slide shows “${Pr.label}” for ${O.noun}. To show ${ORG[Pick.org].noun}, change the living thing too.`,
    });
  if (P.startCount < 1)
    R.push({
      path: "startCount",
      reason: `Natural selection needs variation that is already there. If no ${O.noun} start ${good}, none can survive to pass it on: living things can't change to order. Set at least 1.`,
    });
  else if (P.startCount >= P.populationSize)
    R.push({
      path: "startCount",
      reason: `If all of them are already ${good} there is no variation for the change to act on, so nothing would happen. Make at least one ${other}.`,
    });
  if (P.showFossils && !O.fossils)
    W.push({
      path: "showFossils",
      reason: O.colour
        ? `Fossils are left out: colour does not fossilise, so fossils can't show ${O.noun} changing colour. Use the giraffe, whose neck bones are found as fossils.`
        : `Fossils are left out: Darwin's finches have left almost no fossils, so a fossil row would be made up. Use the giraffe, whose short-necked relatives are found as fossils.`,
    });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds and notes */
function plan(P) {
  P = eff(P);
  const O = ORG[P.organism],
    Pr = PRESS[P.pressure],
    E = ends(P),
    M = simulate(P);
  const good = E[M.f],
    other = E[1 - M.f],
    n = M.n,
    c0 = M.counts[0],
    cl = M.counts[M.counts.length - 1];
  const few = c0 <= n / 3 ? "a few" : c0 < n / 2 ? "some" : "many";
  const most = c0 < n / 2 ? "most" : "some";
  const items = [
    {
      key: "variation",
      caption: `Born different: ${most} ${O.noun} are ${other}, ${few} are ${good}.`,
    },
    { key: "pressure", caption: Pr.cap(E, O) },
    {
      key: "breed",
      caption: `The survivors breed. Their young take after them: more are ${good}.`,
    },
  ];
  if (M.cons > 2)
    items.push({
      key: "shift",
      caption: `Each generation the same happens, and ${good} ${O.noun} become more common.`,
    });
  if (M.many)
    items.push({
      key: "many",
      caption: `Many generations on, ${cl === n ? "all" : "nearly all"} the ${O.noun} are ${good}: the population changed.`,
    });
  if (P.showFossils && O.fossils)
    items.push({
      key: "fossils",
      caption: "Older rock holds fossil relatives with shorter necks: it took millions of years.",
    });
  const summary = `${cl} of ${n} are ${good} now, up from ${c0} of ${n}: the ${O.noun} have adapted.`;
  return { O, Pr, E, M, items, summary, good, other };
}
export function builds(P) {
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

const PRESSURE_NOTE = {
  soot: "Around Manchester in the 1800s, soot killed the pale lichen and blackened the bark. Dark moths were first recorded in 1848; by the end of the century almost all moths there were dark. Ask: why are the pale moths now easier to see?",
  clean:
    "After the Clean Air Acts (from 1956) lichen grew back and pale moths became common again. The same idea works in reverse: what helps depends on the environment.",
  soil: "A model example, like the ones in textbooks: birds hunt by sight, so a beetle that matches the ground is less likely to be eaten. Ask: what would happen on green leaves?",
  leaves:
    "A model example: birds hunt by sight, so a beetle that matches the leaves is less likely to be eaten. Ask: what would happen on brown soil?",
  drought:
    "Peter and Rosemary Grant measured medium ground finches on Daphne Major (Galápagos). In the 1977 drought, birds with deeper beaks could crack the big seeds that were left; the next generation had measurably deeper beaks.",
  wet: "After the very wet year of 1983 small, soft seeds were everywhere on Daphne Major, and smaller-beaked finches did better. What helps depends on the environment.",
  high: "The classroom explanation: giraffes that could reach higher leaves got more food in hard times. Scientists still discuss it, and males fighting with their necks may also have played a part. Avoid the old idea that stretching made necks longer.",
};
export function notes(P) {
  const { O, M, items, good, other } = plan(P);
  const by = {
    variation: `Point out the differences before anything happens. Each one was born ${other} or ${good}: it inherited that from its parents and cannot change it. Ask: which would struggle if the environment changed?`,
    pressure: PRESSURE_NOTE[carried(P)] + " Faded ones did not survive to breed.",
    breed:
      "Only the survivors breed, and their young resemble them because characteristics are inherited from parents. No individual changed: the young were born that way.",
    shift: `Each row repeats the same steps. The counts on the right are worked out by the model from who survived, not typed in. Real populations are far bigger than ${M.n}.`,
    many:
      O.noun === "moths"
        ? "The last row skips many generations. For peppered moths this took about 50 years (one generation a year); big changes such as giraffe necks took millions of years."
        : "The last row skips many generations. Small changes like these can take tens of generations; big changes such as new body shapes take millions of years.",
    fossils:
      "Fossils record bones and shells, not colour. Fossil giraffe relatives with shorter necks, such as Samotherium (about 7 million years old), sit in older rock. The fossil shapes here are drawn simply.",
  };
  return {
    steps: items.map((it) => by[it.key]),
    summary: `The key idea: variation, then survival of the best suited, then inheritance, over many generations. Ask: what would happen if the environment changed back?`,
  };
}

/* ------------------------------------------------------------------ render */
const L = {
  labL: GRID.left,
  labW: 140,
  popL: 220,
  popR: 1044,
  cntL: 1066,
  cntW: 140,
  head: 142,
  top: 152,
  bot: 640,
};
const SKY = "color-mix(in oklab, var(--hue-blue) 10%, var(--cloud))";
const GROUND = {
  finch: "color-mix(in oklab, var(--hue-gold) 40%, var(--cloud))",
  giraffe: "color-mix(in oklab, var(--hue-brown) 45%, var(--cloud))",
};
// chips mix into --cloud, which stays light in every theme (Night too), so dark and pale both read
const CHIP_FAV = "color-mix(in oklab, var(--focus) 24%, var(--cloud))";
const CHIP_OTHER = "color-mix(in oklab, var(--hue-grey) 12%, var(--cloud))";
const CHIP_EDGE = "color-mix(in oklab, var(--hue-grey) 45%, var(--cloud))";
// a head-band label at label size, or at caption size (wider) when a long edit would not fit
const fitHead = (p, x, str, o, wideW) => {
  let t = textBlock(p, x, 0, str, { ...o, cls: "ts-label", lh: 30 });
  if (t.lines.some((l) => l.endsWith("…"))) {
    t.el.remove();
    t = textBlock(p, x, 0, str, { ...o, cls: "ts-cap", lh: 24, maxW: wideW });
  }
  return t;
};

export function render(root, P, ctx) {
  const { O, Pr, M } = plan(P);
  const b = ctx.b,
    N = ctx.N;
  const kind = P.organism,
    Z = ART_SIZE[kind],
    n = M.n,
    R = M.rows.length;
  const pitch = Math.min(170, (L.bot - L.top) / R);
  const fos = P.showFossils && O.fossils && b.fossils != null;
  // the whole population stage steps aside for the fossil build, and comes back for the summary
  const stage = h("g", fos ? { c: `${b.fossils}-${N}:off` } : {}, root);
  /* generation labels: the label column widens (and the population narrows) until every label
     fits its row, wrapped and at most shrunk to the minimum size */
  const isManyRow = (i) => M.many && i === R - 1;
  const rowId = (i) => (isManyRow(i) ? "label:many" : `label:row:${i}`);
  const rowWord = (i) =>
    txt(P, rowId(i), isManyRow(i) ? "Many generations later" : `Generation ${i + 1}`);
  const labLines = Math.max(1, Math.floor((pitch - 4) / 30));
  let labW = L.labW;
  // a plain "Generation n" stays on one line (wrapping a two-word label reads badly from the back)
  for (const w of [140, 160, 180, 220, 260, 300, 340, 380]) {
    labW = w;
    const tmp = h("g", {}, root);
    const ok = M.rows.every((_, i) => {
      const ls = textBlock(tmp, 0, 0, rowWord(i), {
        cls: "ts-cap",
        maxW: w,
        maxLines: labLines,
        lh: 30,
      }).lines;
      return (
        !ls.some((l) => l.endsWith("…")) &&
        (isManyRow(i) || ls.length === 1 || w >= 220) &&
        ls.join(" ").replace(/\s+/g, " ") === rowWord(i).trim().replace(/\s+/g, " ")
      );
    });
    tmp.remove();
    if (ok) break;
  }
  const popL = Math.max(L.popL, L.labL + labW + 16);
  const px = (L.popR - popL) / n;
  // every individual sits on its own light chip: the helpful trait on a focus chip, the rest neutral
  const chipH = pitch - 14,
    cw = px - 6,
    chipT = (i) => L.top + pitch * i + 3;
  const s = Math.min(2.6, (chipH - 8) / Z.h, (cw - 8) / Z.w);
  const rowIntro = (i) =>
    i === 0 ? 0 : i === 1 ? b.breed : M.many && i === R - 1 ? b.many : b.shift;
  const baseY = (i) => chipT(i) + chipH / 2 + (Z.h * s) / 2;
  const midY = (i) => L.top + pitch * (i + 0.5);
  const X = (j) => popL + px * (j + 0.5);
  const r = rng(11);
  // one that did not survive: a dashed empty slot with a faded copy, so it never melts into the ground
  const isFav = (v) => (M.f ? v >= 0.5 : v < 0.5);
  const chip = (p, v, x, top, w, hh, a = {}) =>
    h(
      "rect",
      {
        x: x - w / 2,
        y: top,
        width: w,
        height: hh,
        rx: "var(--r-card)",
        fill: isFav(v) ? CHIP_FAV : CHIP_OTHER,
        stroke: isFav(v) ? "var(--focus)" : CHIP_EDGE,
        "stroke-width": isFav(v) ? "var(--sw-struct)" : "var(--sw-rule)",
        ...a,
      },
      p,
    );
  const ghost = (p, v, x, top, w, hh, a = {}) => {
    const g = h("g", a, p);
    h(
      "rect",
      {
        x: x - w / 2,
        y: top,
        width: w,
        height: hh,
        rx: "var(--r-card)",
        fill: "color-mix(in oklab, var(--cloud) 40%, transparent)",
        stroke: "var(--ink-2)",
        "stroke-width": "var(--sw-struct)",
        "stroke-dasharray": "6 5",
      },
      g,
    );
    const sc = Math.min(s, (hh - 8) / Z.h);
    individual(g, kind, v, x, top + (hh + Z.h * sc) / 2, sc, { opacity: 0.58 });
    return g;
  };

  // the head band (between the title and the first row): the not-to-scale note on the left, the
  // trait word over the counts on the right; each wraps and shrinks into its own share of the band
  let subR = GRID.left;
  if (!O.colour) {
    const sub = textBlock(
      root,
      GRID.left,
      GRID.subY,
      txt(P, "label:scale", "Not to scale: differences drawn larger than life"),
      { cls: "ts-cap", maxW: 700, maxLines: 2, lh: 26, edit: "text.label:scale" },
    );
    subR = GRID.left + sub.w;
  }

  /* the setting: a thin habitat strip under each row (bark, soil, ground), never a dark band behind them */
  const env = Pr.bg;
  M.rows.forEach((row, i) => {
    const k = rowIntro(i),
      y = chipT(i) + chipH + 4,
      x = popL - 4,
      w = L.popR - popL + 8,
      hh = 3;
    const bg = h("g", { s: k }, stage);
    const lite = (c) => `color-mix(in oklab, ${c} 55%, var(--cloud))`;
    const fill = lite(env ? (i === 0 ? env[0] : env[1]) : GROUND[kind]);
    h("rect", { x, y, width: w, height: hh, rx: "var(--r-mark)", fill }, bg);
    if (env && i === 0 && env[1] !== env[0])
      h(
        "rect",
        { x, y, width: w, height: hh, rx: "var(--r-mark)", fill: lite(env[1]), s: b.pressure },
        bg,
      );
  });

  /* column header */
  const word = txt(P, `label:end${M.f}`, ends(P)[M.f]);
  if (P.showCounts) {
    const hx = L.cntL + L.cntW,
      hdW = Math.min(520, hx - subR - 28);
    const hd = fitHead(
      stage,
      hx,
      word.charAt(0).toUpperCase() + word.slice(1),
      {
        maxW: hdW - 48,
        maxLines: 2,
        anchor: "end",
        edit: `text.label:end${M.f}`,
        a: { "font-weight": "var(--w-strong)", fill: "var(--focus-text)" },
      },
      hdW - 48,
    );
    hd.el.setAttribute("y", L.head - 14 - (hd.lines.length - 1) * hd.lh);
    h(
      "rect",
      {
        x: hx - hd.w - 46,
        y: L.head - 44 - (hd.lines.length - 1) * hd.lh,
        width: 34,
        height: 34,
        rx: "var(--r-mark)",
        fill: CHIP_FAV,
        stroke: "var(--focus)",
        "stroke-width": "var(--sw-struct)",
      },
      stage,
    );
  }

  /* the rows: oldest generation at the top */
  const linkG = h("g", { s: b.breed, c: ctx.rc("breed", null, "soft") }, stage);
  M.rows.forEach((row, i) => {
    const k = rowIntro(i),
      last = i === R - 1;
    const next = i + 1 < R ? rowIntro(i + 1) : null;
    const fadeAt = i === 0 ? b.pressure : next;
    // nothing recedes: faded text loses contrast at the back of the room, and the change down
    // the rows is the point.
    const g = h("g", { s: k }, stage);
    const dl = i >= 2 && !(M.many && last) ? (i - 2) * 500 : 0;
    // generation label
    const isMany = isManyRow(i),
      id = rowId(i);
    const lab = textBlock(g, L.labL, 0, rowWord(i), {
      cls: "ts-cap",
      maxW: labW,
      maxLines: labLines,
      lh: 30,
      edit: `text.${id}`,
      a: { fill: "var(--ink)" },
    });
    lab.el.setAttribute("y", midY(i) - lab.h / 2 + 21);
    [...lab.el.children].forEach((t) => t.setAttribute("x", L.labL));
    if (dl) lab.el.style.setProperty("--d", `calc(${dl}ms * var(--pace))`);
    if (isMany)
      h(
        "line",
        {
          x1: popL - 10,
          x2: L.popR + 10,
          y1: L.top + pitch * i,
          y2: L.top + pitch * i,
          stroke: "var(--ink-3)",
          "stroke-width": "var(--sw-rule)",
          "stroke-dasharray": "4 8",
          s: k,
        },
        stage,
      );
    row.forEach((ind, j) => {
      const x = X(j),
        y = baseY(i);
      if (ind.eaten && fadeAt != null)
        ghost(g, ind.v, x, chipT(i), cw, chipH, {
          s: fadeAt,
          delay: fadeAt === b.pressure ? 1100 : 400,
        });
      const wrapG = h("g", { s: k, cls: "rise", delay: dl + j * 40 }, g);
      const a = {};
      if (ind.eaten && fadeAt != null) {
        a.hide = fadeAt;
        a.delay = fadeAt === b.pressure ? 1100 : 400;
      }
      const ig = h("g", a, wrapG);
      chip(ig, ind.v, x, chipT(i), cw, chipH);
      individual(ig, kind, ind.v, x, y, s);
      // links from parents to their young (first breeding only): parent's feet to the child's body.
      // Colour traits leave them out: the matching colours already show who took after whom.
      if (i === 1 && ind.parent != null && !O.colour) {
        const y0 = chipT(0) + chipH + 1,
          y1 = chipT(1) - 1;
        // a paper casing under an ink line, so the link reads on light and dark ground alike
        if (y1 - y0 >= 8)
          for (const [st, sw] of [
            ["var(--paper)", "var(--sw-arrow)"],
            ["var(--ink-2)", "var(--sw-rule)"],
          ])
            h(
              "path",
              {
                d: `M${X(ind.parent)} ${y0} L${x} ${y1}`,
                stroke: st,
                "stroke-width": sw,
                fill: "none",
                "stroke-linecap": "round",
                cls: "draw",
                pathLength: 1,
                s: b.breed,
                delay: 200 + j * 50,
              },
              linkG,
            );
      }
    });
    // the count: worked out, so clicking it focuses the setting it comes from
    if (P.showCounts) {
      const cg = h("g", { s: k, cls: "rise", delay: dl + 300 }, stage);
      const c = M.counts[i],
        y = midY(i);
      computed(
        T(cg, L.cntL, y + 4, `${c} of ${n}`, "ts-label", {
          "font-variant-numeric": "tabular-nums",
        }),
        "startCount",
      );
      h(
        "rect",
        {
          x: L.cntL,
          y: y + 16,
          width: L.cntW,
          height: 8,
          rx: "var(--r-mark)",
          fill: "var(--rule)",
        },
        cg,
      );
      h(
        "rect",
        {
          x: L.cntL,
          y: y + 16,
          width: Math.max(0.01, (L.cntW * c) / n),
          height: 8,
          rx: "var(--r-mark)",
          fill: "var(--focus)",
        },
        cg,
      );
    }
  });

  /* the pressure, at the point of the event: a big picture and its words in the empty stage
     under the first row, with the one key to the faded slots; all go when the young arrive */
  const ay0 = L.top + pitch + 18,
    pcx = L.popL + 150,
    wx = L.popL + 400,
    wW = L.popR - wx;
  const picH = Math.min(230, L.bot - ay0 - 30),
    py = ay0 + picH;
  const ev = h("g", { s: b.pressure, hide: b.breed, cls: "rise" }, root);
  if (Pr.pic === "bird" && env) {
    // the camouflage at a glance: the bird over a patch of the new habitat with one of each kind on it
    const bs = Math.min(1.9, (picH * 0.6) / 64),
      tx = GRID.left + 30 + 62 * bs,
      tw = wx - 32 - tx,
      th = Math.min(200, picH * 0.9),
      ty = py - th;
    h("rect", { x: tx, y: ty, width: tw, height: th, rx: "var(--r-card)", fill: env[1] }, ev);
    organism(ev, "bird", GRID.left + 4 + 30 * bs, py - th * 0.25, bs);
    if (kind === "beetle")
      for (let q = 0; q < 14; q++)
        h(
          "ellipse",
          {
            cx: tx + 12 + r() * (tw - 24),
            cy: ty + 8 + r() * (th - 16),
            rx: 3 + r() * 5,
            ry: 2 + r() * 2,
            fill: "color-mix(in oklab, var(--shade) 14%, transparent)",
          },
          ev,
        );
    const ts = Math.min(2.4, (th - 36) / Z.h, (tw / 2 - 28) / Z.w);
    [M.f ? 0.1 : 0.9, M.f ? 0.9 : 0.1].forEach((v, d) =>
      individual(ev, kind, v, tx + tw * (0.27 + d * 0.46), ty + (th + Z.h * ts) / 2, ts),
    );
  } else if (Pr.pic === "bird") organism(ev, "bird", pcx, py, picH / 64);
  else if (Pr.pic === "tree") organism(ev, "tree", pcx, py, picH / 170);
  else if (Pr.pic === "big-seeds")
    [-1, 0, 1].forEach((d) => organism(ev, "seed", pcx + d * 100, py - 30 - (d ? 0 : 50), 2.2));
  else
    [-2, -1, 0, 1, 2].forEach((d) =>
      organism(ev, "seed", pcx + d * 54, py - 40 - (d % 2 ? 30 : 0), 1),
    );
  const pwLines = clamp(Math.floor((L.bot - ay0 - 34 - 24 - 14 - 44 - 30) / 36) + 1, 2, 5);
  const pw = textBlock(ev, wx, ay0 + 34, txt(P, "label:pressure", Pr.words), {
    cls: "ts-label",
    maxW: wW,
    maxLines: pwLines,
    lh: 36,
    edit: "text.label:pressure",
    a: { fill: "var(--ink)" },
  });
  const gs = Math.min(s, 44 / Z.h),
    ly = ay0 + 34 + pw.h + 14 + Z.h * gs;
  const kg = h("g", { s: b.pressure, hide: b.breed, delay: 1100 }, root);
  ghost(
    kg,
    M.rows[0].find((x) => x.eaten)?.v ?? (M.f ? 0.1 : 0.9),
    wx + (Z.w * gs) / 2 + 4,
    ly - Z.h * gs - 6,
    Z.w * gs + 8,
    Z.h * gs + 12,
  );
  textBlock(
    kg,
    wx + Z.w * gs + 28,
    ly - (Z.h * gs) / 2 + 9,
    txt(P, "label:faded", "Faded: did not survive to breed"),
    {
      cls: "ts-cap",
      maxW: wW - Z.w * gs - 28,
      maxLines: 3,
      lh: 30,
      edit: "text.label:faded",
      a: { fill: "var(--ink)" },
    },
  );
  if (ly + 10 > L.bot)
    ctx.warn("the pressure wording is too long for the space under the first row");

  /* fossils: one rock column over the stage, oldest layer at the bottom; gone for the summary */
  if (fos) {
    const fg = h("g", { s: b.fossils, hide: N, cls: "rise" }, root);
    const fx0 = GRID.left - 4,
      fx1 = GRID.right + 4;
    // the rock column is scenery: it never takes clicks meant for the labels under it in other builds
    h(
      "rect",
      {
        x: fx0,
        y: L.top - 12,
        width: fx1 - fx0,
        height: L.bot - L.top + 12,
        fill: "var(--bg)",
        "pointer-events": "none",
      },
      fg,
    );
    // the heading sits in the head band, right, where the legend was, so the rock gets the full height
    const ft = fitHead(
      fg,
      fx1 - 4,
      txt(P, "label:fossils", "Fossils: oldest rock at the bottom"),
      {
        maxW: Math.min(600, fx1 - subR - 40),
        maxLines: 2,
        anchor: "end",
        edit: "text.label:fossils",
        a: { fill: "var(--ink)", "font-weight": "var(--w-strong)" },
      },
      fx1 - subR - 40,
    );
    ft.el.setAttribute("y", L.head - 14 - (ft.lines.length - 1) * ft.lh);
    const ly0 = L.top - 8,
      lay = 3,
      lh = (L.bot - ly0) / lay;
    if (lh < 44) ctx.warn("fossil layers are cramped: shorten the fossil wording");
    for (let i = 0; i < lay; i++) {
      const y = ly0 + i * lh,
        t = 0.9 - i * 0.4,
        d = (lay - 1 - i) * 300;
      h(
        "rect",
        {
          x: fx0,
          y,
          width: fx1 - fx0,
          height: lh - 4,
          rx: "var(--r-mark)",
          fill: `color-mix(in oklab, var(--hue-brown) ${10 + i * 8}%, var(--cloud))`,
          delay: d,
          "pointer-events": "none",
        },
        fg,
      );
      fossilGiraffe(
        fg,
        clamp(t, 0, 1),
        (fx0 + fx1) / 2 + (i - 1) * 150,
        y + lh - 14,
        Math.min(2.4, (lh - 20) / ART_SIZE.giraffe.h),
        { delay: d, "pointer-events": "none" },
      );
    }
  }
}

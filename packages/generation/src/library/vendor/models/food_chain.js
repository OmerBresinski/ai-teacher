// Food chains and webs: a habitat, the living things in it in feeding order, arrows from the
// eaten to the eater, then the words producer / prey / predator (or primary, secondary…
// consumer). A chain sits in its habitat with the Sun; a web lays living things out in
// feeding levels with every true link. Optional energy squares (100, 10, 1) for Year 6.

import { habitatObject, habitat as habitatScene } from "../kit/batch-D.js";
import {
  arrow,
  clamp,
  computed,
  editable,
  GRID,
  h,
  knock,
  labelGround,
  measure,
  namedPicture,
  overlaps,
  result,
  rng,
  schemaCheck,
  T,
  TEXT_PARAM,
  TITLE_PARAM,
  textBlock,
  txt,
  wavy,
  withDefaults,
} from "../kit/index.js";
import { drawOrganism, sizeOf } from "./food_chain/organisms.js";

export const meta = {
  id: "food_chain",
  name: "Food chains and webs",
  kind: "scene",
  version: 1,
  subjects: ["Science"],
  years: ["Y2", "Y3", "Y4", "Y5", "Y6"],
  teaches:
    "Who eats what in a habitat: chains start with a plant, arrows point to the eater, and energy passes along (only about a tenth at each step).",
};

/* ------------------------------------------------------------------ what lives where, and who eats whom */
// eats: what this living thing really eats among the library's organisms (food first that it eats most)
const K = {
  grass: { name: "Grass", hab: ["woodland", "savannah"], producer: true },
  tree: { name: "Oak leaves", hab: ["woodland"], producer: true },
  pondweed: { name: "Pondweed", hab: ["pond"], producer: true },
  plankton: { name: "Plant plankton", hab: ["ocean", "polar"], producer: true },
  acacia: { name: "Acacia tree", hab: ["savannah"], producer: true },
  rabbit: { name: "Rabbit", hab: ["woodland"], eats: ["grass"] },
  mouse: { name: "Mouse", hab: ["woodland"], eats: ["grass"] },
  caterpillar: { name: "Caterpillar", hab: ["woodland"], eats: ["tree"] },
  bird: { name: "Blue tit", hab: ["woodland"], eats: ["caterpillar"] },
  fox: { name: "Fox", hab: ["woodland"], eats: ["rabbit", "mouse", "bird"] },
  owl: { name: "Owl", hab: ["woodland"], eats: ["mouse", "bird"] },
  tadpole: { name: "Tadpole", hab: ["pond"], eats: ["pondweed"] },
  snail: { name: "Pond snail", hab: ["pond"], eats: ["pondweed"] },
  beetle: { name: "Diving beetle", hab: ["pond"], eats: ["tadpole"] },
  fish: { name: "Fish", hab: ["pond", "ocean", "polar"], eats: ["tadpole", "zooplankton"] },
  frog: { name: "Frog", hab: ["pond"], eats: ["snail"] },
  heron: { name: "Heron", hab: ["pond"], eats: ["fish", "frog"] },
  zooplankton: { name: "Animal plankton", hab: ["ocean", "polar"], eats: ["plankton"] },
  seal: { name: "Seal", hab: ["ocean", "polar"], eats: ["fish"] },
  polarbear: { name: "Polar bear", hab: ["polar"], eats: ["seal"] },
  zebra: { name: "Zebra", hab: ["savannah"], eats: ["grass"] },
  giraffe: { name: "Giraffe", hab: ["savannah"], eats: ["acacia"] },
  lion: { name: "Lion", hab: ["savannah"], eats: ["zebra", "giraffe"] },
};
const KINDS = Object.keys(K);
// What each kind's art really shows. A name outside its kind's list draws a labelled card in its place
// (the feeding rules still come from the kind), so a shark is never drawn as a seal.
export const ART = {
  grass: ["grass", "grasses"],
  tree: ["oak", "oak tree", "oak leaf", "leaf", "tree", "leaves"],
  pondweed: ["pondweed", "pond weed", "water plant", "weed", "algae"],
  plankton: ["plant plankton", "phytoplankton", "plankton", "algae"],
  acacia: ["acacia", "acacia tree", "tree"],
  rabbit: ["rabbit", "bunny"],
  mouse: ["mouse", "field mouse", "wood mouse"],
  caterpillar: ["caterpillar"],
  bird: ["blue tit", "great tit", "tit", "bird", "small bird"],
  fox: ["fox", "red fox"],
  owl: ["owl", "tawny owl", "barn owl"],
  tadpole: ["tadpole"],
  snail: ["pond snail", "water snail", "snail"],
  beetle: ["diving beetle", "great diving beetle", "water beetle", "beetle"],
  fish: [
    "fish",
    "stickleback",
    "herring",
    "arctic cod",
    "cod",
    "minnow",
    "mackerel",
    "sardine",
    "anchovy",
    "perch",
    "roach",
    "trout",
    "salmon",
    "capelin",
    "sand eel",
    "small fish",
  ],
  frog: ["frog", "common frog"],
  heron: ["heron", "grey heron"],
  zooplankton: ["animal plankton", "zooplankton", "krill", "copepod", "plankton"],
  seal: ["seal", "grey seal", "harbour seal", "ringed seal", "harp seal", "common seal"],
  polarbear: ["polar bear"],
  zebra: ["zebra"],
  giraffe: ["giraffe"],
  lion: ["lion", "lioness"],
};
/** Draw a living thing under its name: the kind's art if the name is that kind, else a labelled card. */
function drawNamed(p, o, x, y, s, a) {
  const z = sizeOf(o.kind);
  return namedPicture(
    p,
    o.name,
    o.kind,
    ART,
    (kind) => drawOrganism(p, kind, x, y, s, a),
    x,
    y,
    { w: Math.max(96, z.w * s), h: Math.max(72, z.h * s) },
    { a, model: "food_chain", hint: "organism" },
  );
}
const FISH_NAME = { pond: "Stickleback", ocean: "Herring", polar: "Arctic cod" };
const HABITATS = ["woodland", "pond", "ocean", "savannah", "polar"];
const HAB_WORDS = {
  woodland: "a woodland",
  pond: "a pond",
  ocean: "the ocean",
  savannah: "the savannah",
  polar: "the Arctic",
};
// each habitat's usual living things, for when the habitat changes under a list that does not live there
const HAB_SET = {
  woodland: {
    chain: [
      ["grass", "rabbit", "fox"],
      ["tree", "caterpillar", "bird", "fox"],
    ],
    web: ["grass", "tree", "rabbit", "mouse", "caterpillar", "bird", "fox"],
  },
  pond: {
    chain: [
      ["pondweed", "snail", "frog"],
      ["pondweed", "tadpole", "fish", "heron"],
    ],
    web: ["pondweed", "tadpole", "snail", "beetle", "fish", "frog", "heron"],
  },
  ocean: {
    chain: [
      ["plankton", "zooplankton", "fish"],
      ["plankton", "zooplankton", "fish", "seal"],
    ],
    web: ["plankton", "zooplankton", "fish", "seal"],
  },
  savannah: {
    chain: [
      ["grass", "zebra", "lion"],
      ["acacia", "giraffe", "lion"],
    ],
    web: ["grass", "acacia", "zebra", "giraffe", "lion"],
  },
  polar: {
    chain: [
      ["plankton", "zooplankton", "fish"],
      ["plankton", "zooplankton", "fish", "seal"],
      ["plankton", "zooplankton", "fish", "seal", "polarbear"],
    ],
    web: ["plankton", "zooplankton", "fish", "seal"],
  },
};
const kindName = (k, hab) => (k === "fish" ? FISH_NAME[hab] || "Fish" : K[k].name);
const eats = (a, b) => (K[a].eats || []).includes(b);
const nameOf = (P, i) =>
  (P.organisms[i] && P.organisms[i].name) || kindName(P.organisms[i].kind, P.habitat);
// stock names of every living thing: a name that is the stock name of another kind is left over from
// the kind it replaced (the panel changes the kind, not the name), so the slide uses the new kind's name
const STOCK = new Set([...Object.values(K).map((k) => k.name), ...Object.values(FISH_NAME)]);
const ownName = (o, hab) => {
  const w = String(o.name || "").trim(),
    own = kindName(o.kind, hab);
  if (!w) return own;
  if (STOCK.has(w) && w !== own && !(o.kind === "fish" && w === "Fish")) return own;
  return o.name;
};
const nameOfKind = (k, hab) => kindName(k, hab).toLowerCase();

/* What the slide shows, derived from the settings (validate, builds, notes and render all use it).
   - Names left over from another kind become the current kind's name.
   - Chain: read from the top, each animal's food below it is derived when the list does not match.
   - Web: the order does not matter, so a living thing listed twice shows once, and an animal
     whose food is missing gets it added (each animal's first food in this habitat). */
function norm(P) {
  const hab = P.habitat,
    W = [];
  let O = P.organisms.map((o, i) => ({ kind: o.kind, name: o.name, src: i }));
  // a new habitat brings its own living things: when nothing in the list lives there, the habitat's
  // usual chain (of the same length where there is one) or web is shown instead
  const away = O.filter((o) => !K[o.kind].hab.includes(hab));
  if (away.length && away.length === O.length) {
    const d =
      P.mode === "web"
        ? HAB_SET[hab].web
        : HAB_SET[hab].chain.find((c) => c.length === O.length) || HAB_SET[hab].chain[0];
    W.push(
      `${list(away.map((o) => kindName(o.kind, hab)))} ${away.length > 1 ? "do" : "does"} not live in ${HAB_WORDS[hab]}, so ${HAB_WORDS[hab]}${P.mode === "web" ? "’s usual food web" : "’s usual food chain"} is shown.`,
    );
    O = d.map((k, i) => ({
      kind: k,
      name: kindName(k, hab),
      src: i < P.organisms.length ? i : null,
    }));
  } else if (away.length) {
    // one or two that do not live here: in a web they drop out; in a chain each is swapped for one from
    // here that fits between its neighbours, or the habitat's usual chain is shown when none does
    const gone = list(away.map((o) => kindName(o.kind, hab)));
    if (P.mode === "web") {
      O = O.filter((o) => K[o.kind].hab.includes(hab));
      W.push(
        `${gone} ${away.length > 1 ? "do" : "does"} not live in ${HAB_WORDS[hab]}, so ${away.length > 1 ? "they are" : "it is"} left out.`,
      );
    } else {
      let ok = true;
      O.forEach((o, i) => {
        if (!ok || K[o.kind].hab.includes(hab)) return;
        const c = KINDS.find(
          (x) =>
            K[x].hab.includes(hab) &&
            !O.some((q) => q.kind === x) &&
            (i === 0 ? K[x].producer : eats(x, O[i - 1].kind)) &&
            (i === O.length - 1 || eats(O[i + 1].kind, x)),
        );
        if (c) O[i] = { kind: c, name: kindName(c, hab), src: o.src };
        else ok = false;
      });
      if (!ok) {
        const d = HAB_SET[hab].chain.find((c) => c.length === O.length) || HAB_SET[hab].chain[0];
        O = d.map((k, i) => ({
          kind: k,
          name: kindName(k, hab),
          src: i < P.organisms.length ? i : null,
        }));
      }
      W.push(
        `${gone} ${away.length > 1 ? "do" : "does"} not live in ${HAB_WORDS[hab]}, so ${ok ? `something that does takes ${away.length > 1 ? "their places" : "its place"}` : `${HAB_WORDS[hab]}’s usual food chain is shown`}.`,
      );
    }
  }
  O.forEach((o) => {
    if (K[o.kind] && K[o.kind].hab.includes(hab)) o.name = ownName(o, hab);
  });
  // a chain is one line: from a longer list (a web switched to a chain), the longest line in it is shown
  if (P.mode === "chain" && O.length > 5 && O.every((o) => K[o.kind].hab.includes(hab))) {
    const best = [];
    const walk = (path) => {
      const last = O[path[path.length - 1]].kind;
      let ext = false;
      O.forEach((o, j) => {
        if (!path.includes(j) && eats(o.kind, last)) {
          ext = true;
          walk([...path, j]);
        }
      });
      if (!ext && path.length > best.length && path.length <= 5)
        best.splice(0, best.length, ...path);
    };
    O.forEach((o, j) => {
      if (K[o.kind].producer) walk([j]);
    });
    if (best.length >= 2) {
      W.push(`A chain shows one line, so ${list(best.map((j) => the(O[j].name)))} are shown.`);
      O = best.map((j) => O[j]);
    }
  }
  // a chain reads from the top: when the thing below an animal is not its food, its usual food in
  // this habitat takes that place (a plant at the start), so choosing the top animal sets the chain
  if (P.mode === "chain" && O.length > 1 && O.every((o) => K[o.kind].hab.includes(hab)))
    for (let i = O.length - 1; i >= 1; i--) {
      const top = O[i].kind;
      if (K[top].producer || eats(top, O[i - 1].kind)) continue;
      const k = (K[top].eats || []).find(
        (x) =>
          K[x].hab.includes(hab) &&
          !!K[x].producer === (i === 1) &&
          !O.some((o, j) => j !== i - 1 && o.kind === x),
      );
      if (!k) continue;
      W.push(
        `${The(kindName(top, hab))} eats ${the(kindName(k, hab))}, so ${the(kindName(k, hab))} comes before it in the chain.`,
      );
      O[i - 1] = { kind: k, name: kindName(k, hab), src: O[i - 1].src };
    }
  if (P.mode === "web") {
    const seen = new Set();
    O = O.filter((o) => {
      if (seen.has(o.kind)) {
        W.push(`${kindName(o.kind, hab)} is listed twice, so it shows once.`);
        return false;
      }
      seen.add(o.kind);
      return true;
    });
    if (O.every((o) => K[o.kind].hab.includes(hab)))
      for (let added = true; added; ) {
        added = false;
        for (const o of [...O]) {
          if (K[o.kind].producer || O.some((f) => eats(o.kind, f.kind))) continue;
          const k = (K[o.kind].eats || []).find((x) => K[x].hab.includes(hab));
          if (k && O.length < 7) {
            O.push({ kind: k, name: kindName(k, hab), src: null });
            W.push(`${kindName(k, hab)} is added: ${the(o.name)} needs it for food.`);
            added = true;
          }
        }
      }
  }
  return { P: { ...P, organisms: O }, W };
}
const the = (s) => {
  const w = String(s).trim();
  return /^[A-Z]{2}/.test(w) ? w : "the " + w.charAt(0).toLowerCase() + w.slice(1);
};
const The = (s) => {
  const t = the(s);
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const list = (a) =>
  a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " or " + a[a.length - 1];

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Food chain",
  properties: {
    title: TITLE_PARAM("A food chain"),
    habitat: {
      type: "string",
      title: "Habitat",
      enum: HABITATS,
      "x-labels": ["Woodland and meadow", "Pond", "Ocean", "Savannah", "Arctic"],
      default: "woodland",
    },
    mode: {
      type: "string",
      title: "Show as",
      enum: ["chain", "web"],
      "x-labels": ["A food chain (one line)", "A food web (who eats whom)"],
      default: "chain",
    },
    organisms: {
      type: "array",
      title: "Living things",
      description:
        "In a chain, put them in order: the plant first, then each thing that eats the one before. In a web the order does not matter.",
      "x-item": "a living thing",
      minItems: 2,
      maxItems: 7,
      default: [
        { kind: "grass", name: "Grass" },
        { kind: "rabbit", name: "Rabbit" },
        { kind: "fox", name: "Fox" },
      ],
      items: {
        type: "object",
        required: ["kind"],
        default: { kind: "rabbit", name: "Rabbit" },
        properties: {
          kind: {
            type: "string",
            title: "Living thing",
            enum: KINDS,
            "x-labels": KINDS.map((k) =>
              k === "fish" ? "Fish (stickleback, herring, cod)" : K[k].name,
            ),
            default: "rabbit",
          },
          name: {
            type: "string",
            title: "Name on the slide",
            maxLength: 56 /* libfix: the chain lane; a web holds 32 (validate) */,
            minLength: 1,
            default: "Rabbit",
          },
        },
      },
    },
    vocabulary: {
      type: "string",
      title: "Words to teach",
      enum: ["eats", "prey", "consumer"],
      "x-labels": [
        "Just “is eaten by”",
        "Producer, prey and predator",
        "Producer and consumers (primary, secondary…)",
      ],
      default: "eats",
    },
    showEnergy: {
      type: "boolean",
      title: "Show energy squares",
      description:
        "Energy as countable squares: 100, then 10, then 1. Only about a tenth passes on at each step. For a chain of three.",
      default: false,
    },
    text: TEXT_PARAM,
  },
};

export const presets = [
  {
    id: "y2-grass-rabbit-fox",
    name: "Year 2: grass, rabbit, fox",
    params: {
      title: "A food chain",
      habitat: "woodland",
      mode: "chain",
      vocabulary: "eats",
      organisms: [
        { kind: "grass", name: "Grass" },
        { kind: "rabbit", name: "Rabbit" },
        { kind: "fox", name: "Fox" },
      ],
    },
  },
  {
    id: "y4-pond-web",
    name: "Year 4: a pond food web",
    params: {
      title: "A pond food web",
      habitat: "pond",
      mode: "web",
      vocabulary: "prey",
      organisms: [
        { kind: "pondweed", name: "Pondweed" },
        { kind: "tadpole", name: "Tadpole" },
        { kind: "snail", name: "Pond snail" },
        { kind: "beetle", name: "Diving beetle" },
        { kind: "fish", name: "Stickleback" },
        { kind: "frog", name: "Frog" },
        { kind: "heron", name: "Heron" },
      ],
    },
  },
  {
    id: "y6-ocean-chain",
    name: "Year 6: an ocean food chain",
    params: {
      title: "An ocean food chain",
      habitat: "ocean",
      mode: "chain",
      vocabulary: "consumer",
      organisms: [
        { kind: "plankton", name: "Plant plankton" },
        { kind: "zooplankton", name: "Animal plankton" },
        { kind: "fish", name: "Herring" },
        { kind: "seal", name: "Seal" },
      ],
    },
  },
  {
    id: "y6-energy",
    name: "Year 6: energy along a chain",
    params: {
      title: "Energy in a food chain",
      habitat: "savannah",
      mode: "chain",
      vocabulary: "consumer",
      showEnergy: true,
      organisms: [
        { kind: "grass", name: "Grass" },
        { kind: "zebra", name: "Zebra" },
        { kind: "lion", name: "Lion" },
      ],
    },
  },
];

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  let P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const Wn = [];
  if (R.length) return result(R);
  // libfix: a web stacks cards in columns, so each name has room for 32 letters (tools/laneFit); refused, never cut
  if (P.mode === "web") P.organisms.forEach((o, i) => { if (String(o.name || "").length > 32) R.push({ path: `organisms.${i}.name`, reason: `In a food web each name has room for 32 letters; “${o.name}” has ${String(o.name).length}. Shorten it.` }); });
  if (R.length) return result(R);
  const N0 = norm(P);
  Wn.push(...N0.W);
  P = N0.P;
  const O = P.organisms,
    hab = P.habitat;
  const at = (i, f = "kind") => (O[i].src == null ? "organisms" : `organisms.${O[i].src}.${f}`);
  const here = KINDS.filter((k) => K[k].hab.includes(hab)).map((k) =>
    k === "fish" ? FISH_NAME[hab].toLowerCase() : K[k].name.toLowerCase(),
  );
  const seen = {};
  O.forEach((o, i) => {
    if (seen[o.kind] != null)
      R.push({
        path: at(i),
        reason: `${K[o.kind].name} is in the list twice. Each living thing appears once.`,
      });
    seen[o.kind] = i;
    if (!K[o.kind].hab.includes(hab))
      R.push({
        path: at(i),
        reason: `${K[o.kind].name} does not live in ${HAB_WORDS[hab]}. Choose something that does, such as ${list(here.slice(0, 4))}.`,
      });
  });
  if (R.length) return result(R);
  if (P.mode === "chain") {
    if (O.length > 5)
      R.push({
        path: "organisms",
        reason: `A chain of ${O.length} will not fit on one slide. Use five or fewer, or show it as a food web.`,
      });
    if (!K[O[0].kind].producer)
      R.push({
        path: at(0),
        reason: `A food chain starts with a plant (a producer), because plants make their own food from sunlight. Put a plant first, not ${the(kindName(O[0].kind, hab))}.`,
      });
    for (let i = 1; i < O.length && !R.length; i++) {
      const a = O[i - 1].kind,
        b = O[i].kind,
        nb = kindName(b, hab),
        na = kindName(a, hab);
      if (eats(b, a)) continue;
      if (eats(a, b))
        R.push({
          path: at(i),
          reason: `${The(na)} eats ${the(nb)}, so ${the(nb)} comes first. In a chain each living thing eats the one before it.`,
        });
      else if (K[b].producer)
        R.push({
          path: at(i),
          reason: `${The(nb)} is a plant: it makes its own food and does not eat ${the(na)}. A plant can only start a chain.`,
        });
      else {
        const can = (K[b].eats || [])
          .filter((k) => K[k].hab.includes(hab))
          .map((k) => (k === "fish" ? FISH_NAME[hab].toLowerCase() : K[k].name.toLowerCase()));
        R.push({
          path: at(i),
          reason: `${The(nb)} does not eat ${the(na)}. Put something ${the(nb)} eats just before it${can.length ? `, such as ${list(can)}` : ""}.`,
        });
      }
    }
    if (P.showEnergy && O.length > 3)
      Wn.push(
        "Energy squares need a chain of three: the fourth living thing would get a tenth of one square, so they are hidden. Use three living things to show them.",
      );
  } else {
    if (!O.some((o) => K[o.kind].producer))
      R.push({
        path: "organisms",
        reason:
          "A food web needs at least one plant (a producer): all the energy in it comes from plants using sunlight.",
      });
    O.forEach((o, i) => {
      if (K[o.kind].producer) return;
      if (!O.some((f) => eats(o.kind, f.kind))) {
        const can = (K[o.kind].eats || [])
          .filter((k) => K[k].hab.includes(hab))
          .map((k) => (k === "fish" ? FISH_NAME[hab].toLowerCase() : K[k].name.toLowerCase()));
        R.push({
          path: at(i),
          reason: `Nothing in this web is food for ${the(kindName(o.kind, hab))}. Add something it eats${can.length ? `, such as ${list(can)}` : ""}.`,
        });
      }
    });
    if (!R.length && Math.max(...levels(P)) > 3)
      R.push({
        path: "organisms",
        reason:
          "This web has more than four feeding levels, which will not fit on one slide. Take out one of the top animals.",
      });
    if (P.showEnergy)
      Wn.push("Energy squares show on a food chain only, so they are hidden in a web.");
  }
  return result(R, Wn);
}

/* ------------------------------------------------------------------ model of the data */
// feeding level: plants 0, then one more than the highest thing it eats in this set
function levels(P) {
  const O = P.organisms,
    L = O.map((o) => (K[o.kind].producer ? 0 : null));
  for (let pass = 0; pass < O.length + 1; pass++)
    O.forEach((o, i) => {
      if (K[o.kind].producer) return;
      const f = O.map((x, j) => (eats(o.kind, x.kind) ? L[j] : null)).filter((v) => v != null);
      if (f.length) L[i] = Math.max(...f) + 1;
    });
  return L.map((v) => v ?? 1);
}
function plan(P) {
  const O = P.organisms;
  const web = P.mode === "web";
  const energy = !web && P.showEnergy && O.length <= 3;
  const nm = (i) => nameOf(P, i);
  const items = [];
  if (!web) {
    items.push({
      key: "sun",
      caption: `${The(nm(0))} uses energy from sunlight to make its own food.`,
    });
    for (let i = 1; i < O.length; i++) {
      items.push({
        key: `eat:${i}`,
        i,
        caption: energy
          ? `${The(nm(i))} eats ${the(nm(i - 1))}. Only ${i === 1 ? "10 units" : "1 unit"} of energy ${i === 1 ? "pass" : "passes"} on.`
          : `${The(nm(i))} eats ${the(nm(i - 1))}.${i === 1 ? " The arrow points to the eater." : ""}`,
      });
      if (energy)
        items.push({
          key: `lost:${i}`,
          i,
          caption: `The other ${i === 1 ? 90 : 9} units never reach ${the(nm(i))}: most is lost as heat.`,
        });
    }
  } else {
    const L = levels(P);
    const order = O.map((o, i) => i).sort((a, b) => L[a] - L[b] || a - b);
    items.push({
      key: "plants",
      caption: `${list(order.filter((i) => L[i] === 0).map((i, j) => (j ? the(nm(i)) : The(nm(i)))))} ${order.filter((i) => L[i] === 0).length > 1 ? "make" : "makes"} food from sunlight.`,
    });
    for (const i of order)
      if (L[i] > 0) {
        const f = mainFood(P, i);
        items.push({ key: `eat:${i}`, i, caption: `${The(nm(i))} eats ${the(nm(f))}.` });
      }
  }
  if (P.vocabulary !== "eats")
    items.push({
      key: "roles",
      caption:
        P.vocabulary === "prey"
          ? "Plants are producers. An eaten animal is prey; its eater is a predator."
          : "Plants are producers. Animals are consumers: primary, secondary and so on.",
    });
  if (web && links(P).some((l) => !l.main))
    items.push({
      key: "links",
      caption: "Most animals eat more than one thing, so the chains join up into a web.",
    });
  const summary = energy
    ? "Only about a tenth of the energy passes on at each step."
    : web
      ? "A food web is many food chains joined together."
      : `Energy passes along the chain from ${the(nm(0))} to ${the(nm(O.length - 1))}.`;
  return { items, energy, web, summary };
}
function mainFood(P, i) {
  const O = P.organisms;
  for (const k of K[O[i].kind].eats || []) {
    const j = O.findIndex((o) => o.kind === k);
    if (j >= 0) return j;
  }
  return -1;
}
function links(P) {
  const O = P.organisms;
  const out = [];
  O.forEach((o, i) => {
    const m = mainFood(P, i);
    O.forEach((f, j) => {
      if (eats(o.kind, f.kind)) out.push({ from: j, to: i, main: j === m });
    });
  });
  return out;
}
// role words, editable once for the whole slide through text.label:<role>
const ROLE = {
  producer: "producer",
  consumer: "plant eater",
  prey: "prey",
  predator: "predator",
  both: "prey and predator",
  c1: "primary consumer",
  c2: "secondary consumer",
  c3: "tertiary consumer",
  c4: "quaternary consumer",
};
function roleOf(P, i, L) {
  const O = P.organisms;
  const k = O[i].kind;
  if (K[k].producer) return "producer";
  if (P.vocabulary === "consumer") return "c" + Math.min(4, P.mode === "web" ? L[i] : i);
  const eaten = P.mode === "web" ? O.some((o) => eats(o.kind, k)) : i < O.length - 1;
  // an animal that eats only plants and is not eaten here is nobody's predator
  if (!eaten && (P.mode === "web" ? L[i] === 1 : i === 1)) return "consumer";
  return eaten
    ? i === 1 && P.mode === "chain"
      ? "prey"
      : P.mode === "web" && L[i] === 1
        ? "prey"
        : "both"
    : "predator";
}

export function builds(P) {
  P = norm(P).P;
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

export function notes(P) {
  P = norm(P).P;
  const { items, energy, web } = plan(P);
  const steps = items.map((it) => {
    if (it.key === "sun")
      return (
        "Plants are the start of every food chain: they use light from the Sun to make their own food. Ask: where does the plant get its energy?" +
        (energy ? " One square is one unit of energy." : "")
      );
    if (it.key === "plants")
      return "Start with the plants at the bottom: everything else in the web depends on them.";
    if (it.key.startsWith("lost:"))
      return "The lost energy is mostly heat from moving and keeping warm, plus waste and parts that are not eaten. This is why chains are short.";
    if (it.key === "roles")
      return P.vocabulary === "prey"
        ? "An animal can be prey and a predator at once. Ask: which animal here is both?"
        : "Primary consumers eat plants; secondary consumers eat primary consumers. Herbivores are usually primary consumers.";
    if (it.key === "links")
      return "Ask: what would happen to the others if one animal disappeared?";
    return it.i === 1 && !web
      ? "The arrow means “is eaten by”: it points from the food to the eater, the way the energy goes. Pupils often draw it backwards."
      : "Trace the arrow with your finger: from the food to the eater.";
  });
  return {
    steps,
    summary:
      "Not to scale: the living things are drawn about the same size so each can be seen. " +
      (energy
        ? "Real values vary; “about a tenth” is the rule of thumb."
        : "Ask the class to read the chain aloud using “is eaten by”."),
  };
}

/* ------------------------------------------------------------------ render */
const SQ = 13,
  PIT = 16; // energy squares: size and pitch in slide units
export function render(root, P, ctx) {
  P = norm(P).P;
  const { items, energy, web } = plan(P);
  const b = ctx.b,
    N = ctx.N;
  const O = P.organisms;
  const n = O.length;
  const bi = (key) => b[key] ?? 0;
  const L = levels(P);
  const roles = P.vocabulary !== "eats";
  const kRoles = roles ? bi("roles") : null;
  // in a web or with energy squares the role words show on their own build only, so they don't crowd the rest
  const kRolesEnd = roles && (web || energy) ? kRoles + 1 : null;
  const appear = (i) =>
    web ? (L[i] === 0 ? bi("plants") : bi(`eat:${i}`)) : i === 0 ? bi("sun") : bi(`eat:${i}`);
  const role = (i) => roleOf(P, i, L);
  const roleWord = (r) => txt(P, `label:${r}`, ROLE[r]);

  // measure the name (and role) blocks first: they set where living things stand
  const tmp = h("g", {}, root);
  const pitch = web ? 0 : energy ? 390 : (GRID.right - GRID.left - 120) / Math.max(1, n - 1);
  const labelOf = (i, maxW, nl = 2, rl = 2) => {
    const tb = textBlock(tmp, 0, 0, nameOf(P, i), {
      cls: "ts-label",
      maxW,
      maxLines: nl,
      lh: 30,
      anchor: "middle",
    });
    // the role word wraps onto a second line rather than widen the card past the name's width
    const rb = roles
      ? textBlock(tmp, 0, 0, roleWord(role(i)), {
          cls: "ts-cap",
          maxW,
          maxLines: rl,
          lh: 28,
          anchor: "middle",
          a: { cls: "strong" },
        })
      : { w: 0, h: 0 };
    const rh = roles ? rb.h + 6 : 0;
    return {
      w: Math.max(tb.w, rb.w) + 24,
      h: tb.h + rh + 14,
      rh,
      maxW,
      nl,
      rl,
      lines: tb.lines.length,
    };
  };
  // in a web, a crowded column gives each card fewer lines so card and picture fit its share of the height
  const perCol = L.map((l) => L.filter((m) => m === l).length);
  // a long name wraps onto a third line before it is ever cut
  const L0 = O.map((o, i) => {
    if (!web) {
      return labelOf(i, Math.min(240, (energy ? 360 : pitch) - 40), 3);
    }
    const room = (GRID.bottom - GRID.top - 30) / perCol[i] - 12 - 40;
    for (const [nl, rl] of [
      [2, 2],
      [3, 2],
      [2, 1],
      [3, 1],
      [1, 1],
    ]) {
      const lb = labelOf(i, 200, nl, rl);
      if (lb.h <= room || nl === 1) return lb;
    }
  });
  tmp.remove();

  const under = h("g", {}, root);
  const marks = [],
    labels = [];
  // label: paper card, name, then the role word (its own build)
  const drawLabel = (p, i, cx, top, a) => {
    const lb = L0[i];
    const g = h("g", a, p);
    // the card grows to take the role word only when that build comes
    if (roles) {
      const sm = { x: cx - lb.w / 2, y: top, w: lb.w, h: lb.h - lb.rh };
      labelGround(h("g", { hide: kRoles }, g), sm);
      if (kRolesEnd != null) labelGround(h("g", { s: kRolesEnd }, g), sm);
      labelGround(h("g", { s: kRoles, hide: kRolesEnd }, g), {
        x: cx - lb.w / 2,
        y: top,
        w: lb.w,
        h: lb.h,
      });
    } else labelGround(g, { x: cx - lb.w / 2, y: top, w: lb.w, h: lb.h });
    const tb = textBlock(g, cx, top + 30, nameOf(P, i), {
      cls: "ts-label",
      maxW: lb.w - 24 + 1,
      maxLines: lb.nl,
      /* +1: re-wrap at the measured width never needs one more line */ lh: 30,
      anchor: "middle",
      edit: O[i].src == null ? undefined : `organisms.${O[i].src}.name`,
      a: { fill: "var(--ink)" },
    });
    if (roles)
      textBlock(g, cx, top + 32 + tb.h, roleWord(role(i)), {
        cls: "ts-cap",
        maxW: lb.maxW,
        maxLines: lb.rl,
        lh: 28,
        anchor: "middle",
        edit: `text.label:${role(i)}`,
        a: {
          fill: "var(--ink-2)",
          cls: "strong rise",
          s: kRoles,
          hide: kRolesEnd,
          delay: 150 * (web ? L[i] : i),
        },
      });
    labels.push({ x: cx - lb.w / 2, y: top, w: lb.w, h: lb.h, i });
    return g;
  };
  const fit = (kind, bw, bh, cap = 1.5) => {
    const z = sizeOf(kind);
    return Math.min(bw / z.w, bh / z.h, cap);
  };

  if (!web) {
    /* -------------------------------- chain in its habitat */
    let xs = O.map((o, i) =>
      energy ? 300 + i * 370 : n === 1 ? 640 : 210 + (i * (1070 - 210)) / (n - 1),
    );
    // name cards that would touch (long role words) are packed edge to edge with a fixed gap, centred
    if (!energy && xs.some((x, i) => i && x - L0[i].w / 2 - (xs[i - 1] + L0[i - 1].w / 2) < 28)) {
      const tot = L0.reduce((a, l) => a + l.w, 0) + 28 * (n - 1);
      let x = Math.max(GRID.left, (GRID.W - tot) / 2);
      xs = L0.map((l) => {
        const c = x + l.w / 2;
        x += l.w + 28;
        return c;
      });
      if (x - 28 > GRID.right) ctx.warn("The names do not fit in one row.");
    }
    // ocean: names float in the water, clear of the sand and seabed
    const labH = Math.max(...L0.map((l) => l.h));
    const labTop = (P.habitat === "ocean" && !energy ? GRID.foot - 76 : GRID.bottom) - labH;
    const gapX = n > 1 ? (1070 - 210) / (n - 1) : 400;
    const base = labTop - 10;
    const boxH = energy ? 140 : 220,
      boxW = energy ? 220 : Math.min(gapX - 70, 280),
      cap = energy ? 1.5 : 3;
    const org = O.map((o, i) => {
      const s = fit(o.kind, boxW, boxH, cap),
        z = sizeOf(o.kind);
      return { x: xs[i], s, w: z.w * s, h: z.h * s, top: base - z.h * s };
    });
    const avoid = org
      .map((q) => ({ x: q.x - q.w / 2, y: q.top, w: q.w, h: q.h }))
      .concat(O.map((o, i) => ({ x: xs[i] - L0[i].w / 2, y: labTop, w: L0[i].w, h: labH })));
    // energy blocks over each living thing: 100 (10 x 10), 10 (5 x 2), 1 — one block per living thing
    const blk = energy
      ? [10, 5, 1].slice(0, n).map((cols, i) => {
          const nn = [100, 10, 1][i],
            rows = Math.ceil(nn / cols);
          const w = cols * PIT - (PIT - SQ),
            hh = rows * PIT - (PIT - SQ);
          const yb = Math.min(...org.map((q) => q.top)) - 44;
          return { x: xs[i] - w / 2, y: yb - hh, w, h: hh, cols, n: nn };
        })
      : [];
    blk.forEach((q) => avoid.push({ x: q.x - 10, y: q.y - 10, w: q.w + 90, h: q.h + 20 }));
    // keep scenery off the sunlight and the arrows: sample each path into small boxes
    const trace = (f) => {
      for (let t = 0; t <= 1.001; t += 0.05) {
        const [x, y] = f(t);
        avoid.push({ x: x - 12, y: y - 12, w: 24, h: 24 });
      }
    };
    const SX = GRID.left + 56,
      SY = 176,
      SR = 52;
    avoid.push({ x: SX - SR, y: SY - SR, w: SR * 2, h: SR * 2 });
    const rays = [
      [-0.3, 4],
      [0.05, 2],
    ].map(([fx, dy]) => {
      const tx = org[0].x + org[0].w * fx,
        ty = org[0].top + dy;
      // straight down onto the plant; with energy squares, bend round the 100 block
      const cx = energy ? SX + 10 + 40 * (fx + 0.3) : (SX + tx) / 2,
        cy = energy ? ty - 30 : (SY + ty) / 2;
      const a0 = Math.atan2(cy - SY, cx - SX),
        x1 = SX + Math.cos(a0) * (SR + 12),
        y1 = SY + Math.sin(a0) * (SR + 12);
      const a1 = Math.atan2(ty - cy, tx - cx),
        x2 = tx - Math.cos(a1) * 16,
        y2 = ty - Math.sin(a1) * 16;
      trace((t) => [
        (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2,
        (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2,
      ]);
      return { d: `M${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, x2, y2, ang: a1 };
    });
    const arcs = [];
    for (let i = 1; i < n; i++) {
      const A = energy ? blk[i - 1] : org[i - 1],
        Bq = energy ? blk[i] : org[i];
      const ax = energy ? A.x + A.w + 22 + measure(root, String(A.n), "ts-big") : A.x + A.w * 0.3,
        ay = energy ? A.y + A.h - 18 : A.top - 12;
      const bx = energy ? Bq.x - 8 : Bq.x - Bq.w * 0.3,
        by = energy ? Bq.y + 4 : Bq.top - 12;
      const peak = Math.min(ay, by) - (energy ? 60 : 70);
      const c1x = ax + (bx - ax) * 0.3,
        c2x = ax + (bx - ax) * 0.7;
      const mx = (ax + bx) / 2,
        my = peak + (Math.min(ay, by) - peak) * 0.25 - 2;
      trace((t) => {
        const u = 1 - t;
        return [
          u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx,
          u * u * u * ay + 3 * u * u * t * peak + 3 * u * t * t * peak + t * t * t * by,
        ];
      });
      avoid.push(
        !energy && i === 1
          ? { x: mx - 160, y: my - 62, w: 320, h: 72 }
          : { x: mx - 120, y: my - 34, w: 240, h: 44 },
      );
      arcs.push({ i, ax, ay, bx, by, peak, c1x, c2x, mx, my });
    }
    const hb = habitatScene(root, P.habitat, { ctx, seed: 4, avoid });
    // a woodland keeps a few far trees, only where they are clear of the living things, the light and the arrows
    if (P.habitat === "woodland" && hb)
      for (const [x, y, s] of [
        [60, 468, 0.6],
        [425, 466, 0.55],
        [860, 466, 0.5],
        [1200, 470, 0.6],
      ]) {
        const box = { x: x - 45 * s, y: y - 130 * s, w: 90 * s, h: 130 * s };
        if (
          avoid.some((q) => overlaps(box, q, 10)) ||
          (hb.placed || []).some((q) => overlaps(box, q.box, 10))
        )
          continue;
        habitatObject(hb.g, "tree", x, y, s);
      }
    root.appendChild(under);
    // the Sun, wholly in the sky, and two rays of light that land on the plant
    const sunG = h("g", { s: bi("sun") }, root);
    h("circle", { cx: SX, cy: SY, r: SR, fill: "var(--sun)", cls: "body" }, sunG);
    rays.forEach((r, j) =>
      arrow(ctx, sunG, r.d, r.x2, r.y2, r.ang, "var(--energy)", "var(--sw-struct)", {
        draw: bi("sun"),
        k: 0.6,
        delay: 200 * j,
      }),
    );
    // living things and their names
    O.forEach((o, i) => {
      const k = appear(i);
      marks.push(drawNamed(root, o, xs[i], base, org[i].s, { s: k, cls: "pop" }));
      drawLabel(root, i, xs[i], labTop, { s: k, cls: "rise", delay: 200 });
    });
    // arrows: from the eaten to the eater, the way the energy goes
    for (const { i, ax, ay, bx, by, peak, c1x, c2x, mx, my } of arcs) {
      const k = bi(`eat:${i}`);
      const ang = Math.atan2(by - peak, bx - c2x);
      arrow(
        ctx,
        under,
        `M${ax} ${ay} C ${c1x} ${peak}, ${c2x} ${peak}, ${bx} ${by}`,
        bx,
        by,
        ang,
        "var(--energy)",
        "var(--sw-arrow)",
        { draw: k, k: 0.9, delay: 300 },
      );
      const kg = h("g", { s: k, cls: "rise", delay: 700 }, root);
      if (energy)
        computed(
          knock(kg, mx, my, i === 1 ? "10 pass on" : "1 passes on", "ts-cap", {
            fill: "var(--energy-text)",
            cls: "strong",
          }).querySelector("text"),
          "showEnergy",
        );
      else if (i === 1)
        knockWrap(
          kg,
          mx,
          my,
          txt(P, "label:eatenBy", "is eaten by"),
          clamp(
            bx - ax - 20,
            Math.max(
              120,
              measure(
                root,
                txt(P, "label:eatenBy", "is eaten by").split(" ").slice(0, 3).join(" "),
                "ts-cap",
              ) + 4,
            ),
            300,
          ),
          { fill: "var(--ink)" },
          "text.label:eatenBy",
        );
    }
    if (energy)
      drawEnergy(
        root,
        ctx,
        P,
        blk,
        bi,
        xs,
        arcs.map((a) => ({ x0: a.mx - 90, x1: a.mx + 90, y0: a.my - 25 })),
      );
    if (hb && hb.placed)
      for (const q of hb.placed)
        if (labels.some((l) => overlaps(l, q.box, 4))) ctx.warn("scenery meets a label");
  } else {
    /* -------------------------------- web: feeding levels as columns, plants on the left */
    const R = Math.max(...L) + 1;
    const x0 = GRID.left,
      x1 = GRID.right;
    const colW = (x1 - x0) / R;
    const y0 = GRID.top + 30,
      y1 = GRID.bottom;
    const Y = new Array(n).fill(0);
    const cellH = [];
    for (let r = 0; r < R; r++) {
      const ids = O.map((o, i) => i).filter((i) => L[i] === r);
      const bary = (i) => {
        const f = O.map((x, j) => (eats(O[i].kind, x.kind) && L[j] < r ? Y[j] : null)).filter(
          (v) => v != null,
        );
        return f.length ? f.reduce((a, c) => a + c, 0) / f.length : (y0 + y1) / 2;
      };
      ids.sort((a, c) => bary(a) - bary(c) || a - c);
      const ch = (y1 - y0) / ids.length;
      ids.forEach((i, j) => {
        Y[i] = y0 + (j + 0.5) * ch;
        cellH[i] = ch;
      });
    }
    const pos = O.map((o, i) => {
      const lb = L0[i];
      const ch = Math.min(cellH[i], 260);
      const oh = clamp(ch - lb.h - 22, 36, 130);
      const s = fit(o.kind, Math.min(200, colW - 70), oh);
      const z = sizeOf(o.kind);
      const hOrg = z.h * s;
      const top = Y[i] - (hOrg + 10 + lb.h) / 2;
      const base = top + hOrg;
      return { x: x0 + (L[i] + 0.5) * colW, base, top, w: z.w * s, h: hOrg, s, labTop: base + 10 };
    });
    // a pond web sits in the water: one flat band of pond and a darker bed
    if (P.habitat === "pond") {
      const F = GRID.foot,
        wg = h("g", {}, root);
      h("rect", { x: 0, y: 140, width: GRID.W, height: F - 140, fill: "var(--sea-1)" }, wg);
      h(
        "path",
        {
          d: `M0 ${F - 64} C 320 ${F - 84} 760 ${F - 50} ${GRID.W} ${F - 74} V ${F} H 0 Z`,
          fill: "var(--sea-2)",
        },
        wg,
      );
    }
    root.appendChild(under);
    const boxes = O.map((o, i) => ({
      i,
      org: { x: pos[i].x - pos[i].w / 2, y: pos[i].top, w: pos[i].w, h: pos[i].h },
      lab: { x: pos[i].x - L0[i].w / 2, y: pos[i].labTop, w: L0[i].w, h: L0[i].h },
    }));
    O.forEach((o, i) => {
      const k = appear(i);
      marks.push(drawNamed(root, o, pos[i].x, pos[i].base, pos[i].s, { s: k, cls: "pop" }));
      drawLabel(root, i, pos[i].x, pos[i].labTop, { s: k, cls: "rise", delay: 200 });
    });
    // arrows run left to right, from the food to the eater; bend round anything in the way
    const kLinks = b.links ?? null;
    // arrows join the pictures (beside each drawing, level with its middle), well clear of the name cards
    const unit = (q) => ({
      l: Math.min(q.org.x, q.lab.x),
      r: Math.max(q.org.x + q.org.w, q.lab.x + q.lab.w),
      cy: q.org.y + q.org.h / 2,
    });
    for (const l of links(P)) {
      const A = unit(boxes[l.from]),
        Bq = unit(boxes[l.to]);
      const ax = A.r + 12,
        ay = A.cy,
        bx = Bq.l - 16,
        by = Bq.cy;
      const hit = (d) => {
        for (let t = 0.06; t <= 0.94; t += 0.03) {
          const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * d[0] + t * t * bx,
            y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * d[1] + t * t * by;
          const pt = { x: x - 3, y: y - 3, w: 6, h: 6 };
          if (boxes.some((q) => overlaps(pt, q.org, 6) || overlaps(pt, q.lab, 10))) return true;
        }
        return false;
      };
      const mx = (ax + bx) / 2,
        my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / len,
        ny = (bx - ax) / len;
      const cands = [0, 40, -40, 80, -80, 120, -120, 170, -170, 230, -230]
        .map((o) => [mx + nx * o, my + ny * o])
        .concat([
          [mx, y0 - 150],
          [mx, y0 - 100],
          [mx, y1 + 60],
          [mx, y1 + 110],
        ]);
      let ctl = null;
      for (const d of cands)
        if (!hit(d)) {
          ctl = d;
          break;
        }
      if (!ctl) {
        ctl = [mx, my];
        ctx.warn(`The arrow from ${nameOf(P, l.from)} to ${nameOf(P, l.to)} crosses a label.`);
      }
      const ang = Math.atan2(by - ctl[1], bx - ctl[0]);
      const k = l.main ? bi(`eat:${l.to}`) : kLinks;
      arrow(
        ctx,
        under,
        `M${ax} ${ay} Q ${ctl[0]} ${ctl[1]} ${bx} ${by}`,
        bx,
        by,
        ang,
        "var(--energy)",
        l.main ? "var(--sw-arrow)" : "var(--sw-struct)",
        { draw: k, k: l.main ? 0.9 : 0.75, delay: 300 },
      );
    }
  }
  // not to scale, top right (beside the title)
  // a long wording wraps to two lines (at most 300 wide) rather than run across the title
  const nts = txt(P, "label:scale", "Not to scale");
  const ntsW = Math.min(300, measure(root, nts, "ts-cap"));
  const titleW = P.title ? measure(root, P.title, "ts-title") : 0;
  const ntsY =
    (!web && energy) || GRID.left + titleW + 40 < GRID.right - ntsW ? GRID.titleY : GRID.top + 6;
  textBlock(root, GRID.right, ntsY, nts, {
    cls: "ts-cap",
    maxW: 300,
    maxLines: 2,
    lh: 28,
    anchor: "end",
    edit: "text.label:scale",
    a: { fill: "var(--ink-2)" },
  });
  return {
    dur: Object.fromEntries(items.map((it) => [it.key, it.key.startsWith("lost") ? 2400 : 2200])),
  };
}

// knockout label that wraps to two lines, growing upward from its baseline, instead of running off the slide
function knockWrap(p, x, y, s, maxW, a, edit) {
  const g = h("g", {}, p);
  const tb = textBlock(g, x, y, s, {
    cls: "ts-cap",
    maxW,
    maxLines: 2,
    lh: 28,
    anchor: "middle",
    edit,
    a,
  });
  const up = tb.h - tb.lh;
  if (up) tb.el.setAttribute("transform", `translate(0 ${-up})`);
  g.insertBefore(
    h("rect", {
      x: x - tb.w / 2 - 10,
      y: y - 25 - up,
      width: tb.w + 20,
      height: tb.h + 6,
      rx: "var(--r-mark)",
      fill: "var(--knockout)",
    }),
    tb.el,
  );
  return g;
}

/* energy squares (Isotype): one square is one unit; passed-on units fly on, lost units go hollow after */
function drawEnergy(root, ctx, P, blk, bi, xs, knocks) {
  const g = h("g", {}, root);
  const src = [];
  const cell = (q, j) => [q.x + (j % q.cols) * PIT, q.y + Math.floor(j / q.cols) * PIT];
  blk.forEach((q, i) => {
    const kIn = i === 0 ? bi("sun") : bi(`eat:${i}`);
    const kLost = i < blk.length - 1 && b(`lost:${i + 1}`) != null ? b(`lost:${i + 1}`) : null;
    const pass = i < blk.length - 1 ? blk[i + 1].n : q.n;
    const here = [];
    for (let j = 0; j < q.n; j++) {
      const [x, y] = cell(q, j);
      here.push([x, y]);
      const lost = kLost != null && j >= pass;
      const a = {
        x,
        y,
        width: SQ,
        height: SQ,
        rx: "var(--r-mark)",
        fill: "var(--energy)",
        s: kIn,
        hide: lost ? kLost : null,
      };
      if (i === 0) Object.assign(a, { cls: "pop", delay: j * 8 });
      else
        Object.assign(a, {
          cls: "fly",
          delay: 300 + j * 60,
          vars: { "--fx": src[i - 1][j][0] - x + "px", "--fy": src[i - 1][j][1] - y + "px" },
        });
      h("rect", a, g);
      if (lost)
        h(
          "rect",
          {
            x: x + 1,
            y: y + 1,
            width: SQ - 2,
            height: SQ - 2,
            rx: "var(--r-mark)",
            fill: "var(--lost-pale)",
            stroke: "var(--lost)",
            "stroke-width": "var(--sw-hair)",
            s: kLost,
            cls: "pop",
            delay: 400 + (j % 10) * 20,
          },
          g,
        );
    }
    src.push(here);
    computed(
      T(g, q.x + q.w + 14, q.y + q.h, String(q.n), "ts-big", {
        s: kIn,
        cls: "rise",
        delay: i ? 1100 : 600,
        fill: "var(--energy-text)",
      }),
      "showEnergy",
    );
    // heat leaves after the transfer
    // heat shows on its own build only
    if (kLost != null) {
      const hx = q.x + q.w * 0.25,
        hg = h("g", { hide: kLost + 1 }, g);
      for (const dx of [0, q.w * 0.5])
        wavy(ctx, hg, hx + dx, q.y - 8, hx + dx, q.y - 58, "var(--lost)", {
          draw: kLost,
          n: 2,
          delay: 600,
        });
      // "heat" stops short of the next arrow's words (one line; a long wording shrinks, then ends in …)
      const tx = hx + q.w * 0.5 + 18,
        stop = Math.min(GRID.right, ...knocks.filter((z) => z.x0 > tx).map((z) => z.x0 - 12));
      textBlock(hg, tx, q.y - 30, txt(P, "label:heat", "heat"), {
        cls: "ts-cap",
        maxW: Math.max(60, stop - tx),
        maxLines: 1,
        lh: 28,
        edit: "text.label:heat",
        a: { fill: "var(--heat-text)", cls: "strong halo", s: kLost, delay: 900 },
      });
    }
  });
  function b(k) {
    return ctx.b[k];
  }
  // key, top right: each line shows on the build that explains it, and again in the still
  // the key sits above the arrows' words; each line keeps to one line inside the slide edge
  const kx = 800,
    ky = Math.max(
      GRID.titleY + 44,
      Math.min(150, Math.min(...knocks.filter((z) => z.x1 > kx).map((z) => z.y0), 999) - 92),
    );
  const kN = ctx.N;
  const keyLine = (g, x, y, s, edit, a) =>
    textBlock(g, x, y, s, { cls: "ts-cap", maxW: GRID.right - x, maxLines: 1, lh: 28, edit, a });
  const twice = (k, draw) => {
    draw(h("g", { s: k, hide: k + 1 < kN ? k + 1 : null }, root));
    if (k + 1 < kN) draw(h("g", { s: kN }, root));
  };
  twice(bi("sun"), (kg) =>
    keyLine(kg, kx, ky, txt(P, "label:key", "1 square = 1 unit of energy"), "text.label:key", {
      fill: "var(--ink)",
      cls: "strong halo",
    }),
  );
  twice(bi("eat:1"), (kg) => {
    h(
      "rect",
      { x: kx, y: ky + 18, width: 22, height: 22, rx: "var(--r-mark)", fill: "var(--energy)" },
      kg,
    );
    keyLine(kg, kx + 34, ky + 38, txt(P, "label:passed", "passed on"), "text.label:passed", {
      fill: "var(--ink)",
      cls: "halo",
    });
  });
  twice(bi("lost:1"), (kg) => {
    h(
      "rect",
      {
        x: kx + 1,
        y: ky + 57,
        width: 20,
        height: 20,
        rx: "var(--r-mark)",
        fill: "var(--lost-pale)",
        stroke: "var(--lost)",
        "stroke-width": "var(--sw-hair)",
      },
      kg,
    );
    keyLine(
      kg,
      kx + 34,
      ky + 76,
      txt(P, "label:lostKey", "lost, mostly as heat"),
      "text.label:lostKey",
      { fill: "var(--ink)", cls: "halo" },
    );
  });
}

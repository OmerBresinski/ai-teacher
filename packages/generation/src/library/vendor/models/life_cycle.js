// Life cycles: a flowering plant, a bean, a frog, a butterfly, a chicken, a human or a mammal,
// as a ring or a line, in Reception words or scientific words, with an optional second cycle
// to compare (Year 5). Stage order and names are fixed per organism; wording is the teacher's.
import {
  arrow,
  editable,
  GRID,
  h,
  measure,
  nameFits,
  noteArt,
  overlaps,
  pictureCard,
  result,
  schemaCheck,
  T,
  TEXT_PARAM_FOR,
  TITLE_PARAM,
  textBlock,
  txt,
  withDefaults,
} from "../kit/index.js";
import { artSize, drawArt } from "./life_cycle/art.js";

export const meta = {
  id: "life_cycle",
  name: "Life cycles",
  kind: "scene",
  version: 1,
  subjects: ["Science"],
  years: ["Reception", "Y1", "Y2", "Y3", "Y4", "Y5"],
  teaches:
    "How a living thing grows, changes and makes new young, so its life cycle starts again; and how cycles differ between groups.",
};

/* ------------------------------------------------------------------ the science (fixed per organism) */
// stage: id, kind (art), rel (size within the cycle), w [simple, scientific], cap [simple, scientific],
// note, why (set when the stage cannot be left out)
const ORG = {
  "flowering-plant": {
    name: "a flowering plant",
    group: "plant",
    head: ["Flowering plant", "Flowering plant"],
    start: "starts as a seed",
    change: "grows, flowers and makes new seeds",
    short: "grows from a seed and makes new seeds",
    stages: [
      {
        id: "seed",
        kind: "seed",
        rel: 0.5,
        w: ["Seed", "Seed"],
        cap: [
          "A plant starts as a seed in the soil.",
          "A seed holds a tiny new plant and a store of food.",
        ],
        note: "Seeds need water and warmth to germinate, not light: the food store feeds them until the leaves grow.",
        why: "Every plant in this cycle starts as a seed: without it the cycle has no beginning.",
      },
      {
        id: "shoot",
        kind: "sprout",
        rel: 0.8,
        w: ["Shoot", "Germination"],
        cap: [
          "With water and warmth, a root grows down and a shoot grows up.",
          "Germination: with water and warmth, the root grows down and the shoot grows up.",
        ],
        note: "The root always grows down and the shoot up, whichever way up the seed is planted.",
        why: "Germination is how the seed becomes a plant. Without it the cycle jumps from seed to flower.",
      },
      {
        id: "flowers",
        kind: "flower",
        rel: 1,
        w: ["Plant with a flower", "Adult plant (flowering)"],
        cap: [
          "The plant grows leaves, then a flower.",
          "The adult plant grows flowers, which hold the parts that make seeds.",
        ],
        note: "Petals attract insects, the stamens make pollen and the carpel holds the ovules.",
        why: "The flower is where new seeds are made, so the cycle cannot close without it.",
      },
      {
        id: "pollination",
        kind: "flowerBee",
        rel: 1,
        sw: "pollination",
        w: ["A bee carries pollen", "Pollination"],
        cap: [
          "A bee carries pollen from flower to flower.",
          "Pollination: insects or the wind carry pollen to another flower.",
        ],
        note: "After pollination comes fertilisation: pollen joins with an ovule, which grows into a seed.",
      },
      {
        id: "dispersal",
        kind: "seedhead",
        rel: 1,
        sw: "dispersal",
        w: ["New seeds blow away", "Seed dispersal"],
        cap: [
          "The flower makes new seeds, which blow away.",
          "Seeds form, then spread away from the parent plant: seed dispersal.",
        ],
        note: "Seeds spread by wind, animals, water or by bursting out. Ask: why is it good for seeds to travel?",
      },
    ],
    close: [
      "A new seed lands in the soil, and the cycle starts again.",
      "A dispersed seed germinates, and the cycle starts again.",
    ],
    closeNote: "Only some seeds land where they can grow; that is why plants make so many.",
    sum: [
      "Seed, shoot, plant, flower, new seeds: then it starts again.",
      "A flowering plant’s life cycle: germination, growth, pollination, seed formation and dispersal.",
    ],
  },
  bean: {
    name: "a bean plant",
    group: "plant",
    head: ["Bean plant", "Bean plant"],
    start: "starts as a seed",
    change: "grows, flowers and makes pods of new seeds",
    short: "grows from a seed and makes new seeds",
    stages: [
      {
        id: "seed",
        kind: "seed",
        rel: 0.55,
        w: ["Bean", "Seed"],
        cap: ["A bean is a seed.", "A bean is a seed: it holds a tiny plant and its food store."],
        note: "Soak a broad bean and split it to see the tiny plant and its food store inside.",
        why: "A bean plant starts as a bean (a seed): without it the cycle has no beginning.",
      },
      {
        id: "shoot",
        kind: "sprout",
        rel: 0.8,
        w: ["Root and shoot", "Germination"],
        cap: [
          "With water and warmth, a root and a shoot grow.",
          "Germination: the root grows down first, then the shoot grows up.",
        ],
        note: "Germination needs water and warmth, not light. Grow one in a clear jar to watch the root.",
        why: "Germination is how the bean becomes a plant. Without it the cycle jumps from bean to flowers.",
      },
      {
        id: "plant",
        kind: "beanPlant",
        rel: 0.9,
        sw: "growth",
        w: ["Young plant", "Seedling"],
        cap: [
          "The shoot grows leaves and climbs up a cane.",
          "Once it has light, the seedling makes its own food in its leaves.",
        ],
        note: "Now the plant needs light: its leaves make food. Without light it grows pale and thin.",
      },
      {
        id: "flowers",
        kind: "beanFlowers",
        rel: 1,
        w: ["Flowers", "Flowering plant"],
        cap: [
          "The bean plant grows flowers.",
          "The plant flowers, and bees pollinate the flowers.",
        ],
        note: "Runner bean flowers are often red; broad bean flowers are white and black. Bees carry pollen between them.",
        why: "Pods grow from the flowers, so the flowers cannot be left out.",
      },
      {
        id: "pods",
        kind: "pods",
        rel: 1,
        w: ["Pods with new beans", "Pods (seeds form)"],
        cap: [
          "Each flower becomes a pod with new beans inside.",
          "Each pollinated flower becomes a pod: the seeds inside are new beans.",
        ],
        note: "Count the beans in a pod: each one can grow a new plant.",
        why: "The pods hold the new beans that start the cycle again.",
      },
    ],
    close: [
      "Plant a new bean, and the cycle starts again.",
      "A seed from the pod can germinate, so the cycle starts again.",
    ],
    closeNote:
      "Link to germination: what does a seed need, and what does a growing plant need as well?",
    sum: [
      "Bean, shoot, plant, flowers, pods of new beans: then it starts again.",
      "A bean’s life cycle: germination, growth, flowering, pollination and new seeds in pods.",
    ],
  },
  frog: {
    name: "a frog",
    group: "amphibian",
    head: ["Frog", "Frog (amphibian)"],
    start: "hatches from an egg in water",
    change: "changes shape as it grows (metamorphosis)",
    short: "hatches from an egg and changes shape",
    stages: [
      {
        id: "spawn",
        kind: "frogspawn",
        rel: 0.8,
        w: ["Frogspawn", "Eggs (frogspawn)"],
        cap: [
          "Frogs lay eggs in a pond: frogspawn.",
          "Frogs lay jelly-covered eggs in water: frogspawn.",
        ],
        note: "Common frogs lay spawn in early spring. Each dark dot is an egg inside a ball of jelly.",
        why: "Every frog starts as an egg in frogspawn: without it the cycle has no beginning.",
      },
      {
        id: "tadpole",
        kind: "tadpole",
        rel: 0.62,
        w: ["Tadpole", "Larva (tadpole)"],
        cap: [
          "A tadpole hatches. It swims and breathes underwater.",
          "A tadpole (larva) hatches. It lives in water and breathes with gills.",
        ],
        note: "Tadpoles hatch after about 1 to 3 weeks (faster in warm water) and eat algae. Back legs grow first, then front legs.",
        why: "The tadpole is the water stage every frog passes through. Without it there is no change to show.",
      },
      {
        id: "froglet",
        kind: "froglet",
        rel: 0.8,
        w: ["Froglet", "Froglet"],
        cap: [
          "The tadpole grows legs and its tail shrinks: a froglet.",
          "Legs grow, lungs develop and the tail shrinks: a froglet.",
        ],
        note: "Froglets leave the water after about 12 to 16 weeks.",
      },
      {
        id: "frog",
        kind: "frog",
        rel: 1,
        w: ["Frog", "Adult frog"],
        cap: [
          "The {prev} grows into a frog that can live on land.",
          "The adult frog breathes air and lives on land as well as in water.",
        ],
        note: "A frog takes about 2 to 3 years to grow into an adult that can breed.",
        why: "Only an adult frog can lay frogspawn, so it closes the cycle.",
      },
    ],
    close: [
      "The frog lays frogspawn, and the cycle starts again.",
      "Adults go back to water to lay eggs, so the cycle starts again.",
    ],
    closeNote: "Ask: why do frogs need a pond even though adults can live on land?",
    sum: [
      "Frogspawn, tadpole, froglet, frog: then it starts again.",
      "An amphibian’s life cycle: eggs and larvae in water, metamorphosis, adults on land and in water.",
    ],
  },
  butterfly: {
    name: "a butterfly",
    group: "insect",
    head: ["Butterfly", "Butterfly (insect)"],
    start: "hatches from an egg",
    change: "changes completely as it grows (metamorphosis)",
    short: "hatches from an egg and changes completely",
    stages: [
      {
        id: "eggs",
        kind: "leafEggs",
        rel: 0.75,
        w: ["Eggs on a leaf", "Egg"],
        cap: [
          "A butterfly lays tiny eggs on a leaf.",
          "An adult butterfly lays eggs on a food plant.",
        ],
        note: "Butterfly eggs are about the size of a pin head; they are drawn much bigger here.",
        why: "Every butterfly starts as an egg: without it the cycle has no beginning.",
      },
      {
        id: "caterpillar",
        kind: "caterpillar",
        rel: 0.85,
        w: ["Caterpillar", "Larva (caterpillar)"],
        cap: [
          "A hungry caterpillar hatches and eats and eats.",
          "A larva (caterpillar) hatches. It eats, grows and sheds its skin several times.",
        ],
        note: "Caterpillars moult (shed their skin) as they grow, because their skin cannot stretch.",
        why: "The caterpillar is the stage that eats and grows. Every butterfly’s cycle has it.",
      },
      {
        id: "chrysalis",
        kind: "chrysalis",
        rel: 0.85,
        w: ["Chrysalis", "Pupa (chrysalis)"],
        cap: [
          "The caterpillar makes a hard case: a chrysalis.",
          "The larva becomes a pupa. Inside the chrysalis, its body is rebuilt.",
        ],
        note: "Butterflies make a chrysalis. A cocoon is the silk case that many moths spin.",
        why: "The chrysalis is where the caterpillar turns into a butterfly. Without it the change makes no sense.",
      },
      {
        id: "butterfly",
        kind: "butterfly",
        rel: 1,
        w: ["Butterfly", "Adult butterfly"],
        cap: [
          "A butterfly comes out of the chrysalis.",
          "An adult butterfly comes out, with wings. This complete change is metamorphosis.",
        ],
        note: "The adult does not grow any more: its job is to find a mate and lay eggs. Many live only a few weeks.",
        why: "Only the adult butterfly can lay eggs, so it closes the cycle.",
      },
    ],
    close: [
      "The butterfly lays eggs, and the cycle starts again.",
      "The adult mates and lays eggs, so the cycle starts again.",
    ],
    closeNote: "Ask: which stage eats the most? Which stage does not eat at all? (The pupa.)",
    sum: [
      "Egg, caterpillar, chrysalis, butterfly: then it starts again.",
      "Complete metamorphosis: egg, larva, pupa and adult.",
    ],
  },
  chicken: {
    name: "a chicken",
    group: "bird",
    head: ["Chicken", "Chicken (bird)"],
    start: "hatches from an egg",
    change: "grows bigger but keeps its body shape",
    short: "hatches from an egg and just grows bigger",
    stages: [
      {
        id: "egg",
        kind: "egg",
        rel: 0.55,
        w: ["Egg", "Egg"],
        cap: [
          "A hen lays an egg.",
          "A hen lays an egg. If it is fertilised, a chick grows inside.",
        ],
        note: "Eggs from the shop are not fertilised, so they will never hatch.",
        why: "Every chicken starts as an egg: without it the cycle has no beginning.",
      },
      {
        id: "chick",
        kind: "chick",
        rel: 0.62,
        w: ["Chick", "Chick (hatchling)"],
        cap: [
          "A fluffy chick hatches out of the egg.",
          "After about 21 days of being kept warm, the chick hatches.",
        ],
        note: "The hen sits on her eggs to keep them warm (incubation) for about 21 days.",
        why: "Hatching is how a chicken’s life outside the egg begins, so the chick stays.",
      },
      {
        id: "young",
        kind: "hen",
        rel: 0.74,
        sw: "juvenile",
        w: ["Growing chicken", "Juvenile"],
        cap: [
          "The chick grows feathers and gets bigger.",
          "The juvenile grows adult feathers and keeps growing.",
        ],
        note: "A young chicken looks like a small adult: birds grow without changing body shape.",
      },
      {
        id: "hen",
        kind: "hen",
        rel: 1,
        w: ["Hen", "Adult hen"],
        cap: ["It grows into a hen.", "At about 5 to 6 months old, a hen starts to lay eggs."],
        note: "Male chickens are cockerels. A hen needs a cockerel for her eggs to be fertilised.",
        why: "Only an adult hen can lay eggs, so she closes the cycle.",
      },
    ],
    close: [
      "The hen lays an egg, and the cycle starts again.",
      "The adult hen lays eggs, so the cycle starts again.",
    ],
    closeNote:
      "Compare with a frog: both start as eggs, but a chick hatches looking like a small bird.",
    sum: [
      "Egg, chick, growing chicken, hen: then it starts again.",
      "A bird’s life cycle: egg, hatchling, juvenile and adult, with no metamorphosis.",
    ],
  },
  human: {
    name: "a human",
    group: "mammal",
    head: ["Human", "Human (mammal)"],
    start: "is born live",
    change: "grows bigger and changes slowly",
    short: "is born live and grows up",
    stages: [
      {
        id: "baby",
        kind: "baby",
        rel: 0.5,
        w: ["Baby", "Baby"],
        cap: [
          "A baby is born.",
          "Humans are mammals: a baby grows inside its mother and is born live.",
        ],
        note: "A baby feeds on milk, like all young mammals.",
        why: "Every human starts as a baby: without it the cycle has no beginning.",
      },
      {
        id: "child",
        kind: "child",
        rel: 0.74,
        sw: "childhood",
        w: ["Child", "Child"],
        cap: [
          "The baby grows into a child.",
          "Childhood: the body grows, and we learn to walk, talk and read.",
        ],
        note: "Children grow fastest in the first years, and again in puberty.",
      },
      {
        id: "teenager",
        kind: "adult",
        rel: 0.9,
        sw: "adolescence",
        w: ["Teenager", "Adolescent"],
        cap: [
          "The {prev} grows into a teenager.",
          "Adolescence: puberty changes the body from a child’s to an adult’s.",
        ],
        note: "Puberty usually starts between about 8 and 14, and the change takes a few years.",
      },
      {
        id: "adult",
        kind: "adult",
        rel: 1,
        w: ["Adult", "Adult"],
        cap: [
          "The {prev} grows into an adult.",
          "Adulthood: the body stops growing and can have children.",
        ],
        note: "Adults keep ageing; old age is part of adulthood. Be sensitive to pupils’ family circumstances.",
        why: "Only adults can have babies, so the adult stage closes the cycle.",
      },
    ],
    close: [
      "Adults can have babies, and the cycle starts again.",
      "Adults can reproduce, so the cycle starts again.",
    ],
    closeNote: "Not every adult has children; the cycle continues across the whole population.",
    sum: [
      "Baby, child, teenager, adult: then it starts again.",
      "A human life cycle: born live, then childhood, adolescence and adulthood.",
    ],
  },
  mammal: {
    name: "a rabbit",
    group: "mammal",
    head: ["Rabbit", "Rabbit (mammal)"],
    start: "is born live",
    change: "grows bigger without changing shape",
    short: "is born live and just grows bigger",
    stages: [
      {
        id: "baby",
        kind: "rabbit",
        rel: 0.44,
        w: ["Baby rabbit", "Newborn (born live)"],
        cap: [
          "A mother rabbit gives birth to baby rabbits.",
          "Mammals are born live: the young grow inside the mother first.",
        ],
        note: "Baby rabbits (kits) grow inside the mother for about a month and are born blind and without fur.",
        why: "Every rabbit starts as a baby born live: without it the cycle has no beginning.",
      },
      {
        id: "young",
        kind: "rabbit",
        rel: 0.7,
        w: ["Young rabbit", "Juvenile"],
        cap: [
          "The babies drink milk and grow into young rabbits.",
          "The young feed on their mother’s milk, then start eating plants.",
        ],
        note: "Young rabbits feed on milk for about 4 to 6 weeks.",
      },
      {
        id: "adult",
        kind: "rabbit",
        rel: 1,
        w: ["Adult rabbit", "Adult"],
        cap: [
          "They grow into adult rabbits.",
          "The adult looks like a bigger version of the young: there is no larval stage.",
        ],
        note: "Rabbits can breed from about 4 to 6 months old.",
        why: "Only adult rabbits can have babies, so the adult stage closes the cycle.",
      },
    ],
    close: [
      "Adult rabbits have babies, and the cycle starts again.",
      "Adults mate and have young, so the cycle starts again.",
    ],
    closeNote: "Most mammals are born live and fed on milk. (A few, like the platypus, lay eggs.)",
    sum: [
      "Baby rabbit, young rabbit, adult rabbit: then it starts again.",
      "A mammal’s life cycle: born live, fed on milk, grows into an adult. No metamorphosis.",
    ],
  },
};
const ORG_IDS = Object.keys(ORG);
const ORG_LABELS = [
  "Flowering plant",
  "Bean plant",
  "Frog (amphibian)",
  "Butterfly (insect)",
  "Chicken (bird)",
  "Human",
  "Mammal (a rabbit)",
];
const GROUP_NOTE = {
  plant: "Flowering plants grow from seeds and make new seeds after pollination.",
  amphibian:
    "Amphibians lay eggs in water; the young (tadpoles) live in water and change shape to live on land.",
  insect:
    "Many insects, like butterflies, go through complete metamorphosis: egg, larva, pupa, adult.",
  bird: "Birds lay eggs with hard shells; chicks hatch looking like small birds.",
  mammal: "Mammals give birth to live young and feed them milk; the young look like small adults.",
};
const STAGE_IDS = [...new Set(ORG_IDS.flatMap((o) => ORG[o].stages.map((s) => s.id)))];
const STAGE_WORD = (id) => {
  for (const o of ORG_IDS) {
    const s = ORG[o].stages.find((x) => x.id === id);
    if (s) return s.w[0];
  }
  return id;
};
const LARVAL =
  /\b(larva|larvae|larval|tadpoles?|caterpillars?|chrysalis|pupa|pupae|cocoons?|frogspawn|spawn)\b/i;

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Life cycles",
  properties: {
    title: TITLE_PARAM("The life cycle of a frog"),
    organism: {
      type: "string",
      title: "Living thing",
      enum: ORG_IDS,
      "x-labels": ORG_LABELS,
      default: "frog",
    },
    vocabulary: {
      type: "string",
      title: "Words",
      enum: ["simple", "scientific"],
      "x-labels": ["Everyday words (Reception to Year 2)", "Scientific words (Year 3 up)"],
      default: "simple",
    },
    layout: {
      type: "string",
      title: "Shape",
      description:
        "A ring shows that the cycle repeats; a line reads like a story with a return arrow. A comparison always shows two rows.",
      enum: ["ring", "line"],
      "x-labels": ["Ring", "Line"],
      default: "ring",
    },
    leaveOut: {
      type: "array",
      title: "Stages to leave out",
      description:
        "Leave out a stage your class has not met yet. Stages the cycle needs cannot be left out.",
      "x-item": "a stage",
      maxItems: 3,
      default: [],
      items: {
        type: "string",
        title: "Stage",
        enum: STAGE_IDS,
        "x-labels": STAGE_IDS.map(STAGE_WORD),
        default: "froglet",
      },
    },
    compare: {
      type: "object",
      title: "Compare with",
      description: "Show a second life cycle underneath, in its own step (Year 5).",
      default: { show: false, organism: "mammal" },
      properties: {
        show: { type: "boolean", title: "Compare with another living thing", default: false },
        organism: {
          type: "string",
          title: "Second living thing",
          enum: ORG_IDS,
          "x-labels": ORG_LABELS,
          default: "mammal",
        },
      },
    },
    notToScale: {
      type: "boolean",
      title: "Say “Not to scale”",
      description: "The stages are drawn at a readable size, not their real sizes.",
      default: true,
      "x-panel": "advanced",
    },
    // stage names, headings and "Not to scale" are names: the kit's label lane (40 letters). Five stage
    // names in a column each, in two compared rows, cannot hold longer wording at a size read from the back.
    text: TEXT_PARAM_FOR(
      Object.assign(
        { scale: "label" },
        ...ORG_IDS.map((o) =>
          Object.assign(
            { [`name:${o}`]: "label" },
            ...ORG[o].stages.map((s) => ({ [`${o}:${s.id}`]: "label" })),
          ),
        ),
      ),
    ),
  },
};

export const presets = [
  {
    id: "reception-caterpillar",
    name: "Reception: the hungry caterpillar’s life",
    params: {
      title: "The hungry caterpillar’s life",
      organism: "butterfly",
      vocabulary: "simple",
      layout: "line",
    },
  },
  {
    id: "y2-frog",
    name: "Year 2: frog life cycle",
    params: {
      title: "The life cycle of a frog",
      organism: "frog",
      vocabulary: "simple",
      layout: "ring",
    },
  },
  {
    id: "y3-flowering-plant",
    name: "Year 3: life cycle of a flowering plant",
    params: {
      title: "The life cycle of a flowering plant",
      organism: "flowering-plant",
      vocabulary: "scientific",
      layout: "ring",
    },
  },
  {
    id: "y5-compare",
    name: "Year 5: compare an amphibian and a mammal",
    params: {
      title: "Two life cycles: amphibian and mammal",
      organism: "frog",
      vocabulary: "scientific",
      compare: { show: true, organism: "mammal" },
    },
  },
];

/* ------------------------------------------------------------------ model of the data */
const STOP = new Set(["a", "an", "the", "on", "of", "in", "and", "with", "its", "new", "young"]);
const keyWords = (s) =>
  String(s)
    .replace(/[()]/g, " ")
    .split(/[\s,]+/)
    .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
/** Words that name what this organism's art shows ("Butterfly (insect)" -> butterfly, insect). */
const orgWords = (O) => [...O.head, O.name.replace(/^an? /, ""), ...O.head.flatMap(keyWords)];
/** Words that name what a stage's art shows (its stock names, their key words, the organism's name). */
const stageWords = (s, O) => [
  ...s.w,
  s.id,
  s.kind,
  ...s.w.flatMap(keyWords),
  ...O.head.flatMap(keyWords),
];
const V = (P) => (P.vocabulary === "scientific" ? 1 : 0);
const labelKey = (o, id) => `label:${o}:${id}`;
function cycle(P, o, all) {
  const O = ORG[o],
    v = V(P);
  const skip = all ? [] : P.leaveOut || [];
  const shown = O.stages.filter((s) => !skip.includes(s.id) || s.why);
  // a caption that names the stage before names the one actually shown before it
  const head = txt(P, `label:name:${o}`, O.head[v]);
  // the art is this organism's: a heading that names another living thing ("Ladybird" on the butterfly)
  // draws every stage as a labelled card, and a stage renamed to something its art is not draws a card
  const renamed = !nameFits(head, orgWords(O));
  const stages0 = shown.map((s) => {
    const label = txt(P, labelKey(o, s.id), s.w[v]);
    return {
      ...s,
      org: o,
      label,
      edit: `text.${labelKey(o, s.id)}`,
      card: renamed || !nameFits(label, stageWords(s, O)),
    };
  });
  // captions follow what is drawn: with any card or renamed stage, they are built from the names shown
  const own = !renamed && stages0.every((s, j) => !s.card && s.label === shown[j].w[v]);
  const lo = (s) => s.toLowerCase();
  const stages = stages0.map((s, j) =>
    Object.assign(s, {
      caption: own
        ? s.cap[v].replace("{prev}", j ? shown[j - 1].w[v].toLowerCase() : "")
        : j === 0
          ? `The life cycle of ${lo(head)} starts with: ${lo(s.label)}.`
          : `After the ${lo(stages0[j - 1].label)}: ${lo(s.label)}.`,
    }),
  );
  if (renamed)
    stages.forEach((s) => {
      s.cardName = head;
    }); // the stage name is drawn beside the card
  return { o, O, stages, head, headEdit: `text.label:name:${o}`, own, renamed };
}
function model(P) {
  const A = cycle(P, P.organism, false);
  const B =
    P.compare && P.compare.show && P.compare.organism !== P.organism
      ? cycle(P, P.compare.organism, true)
      : null;
  return { A, B, v: V(P) };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  const O = ORG[P.organism];
  (P.leaveOut || []).forEach((id, i) => {
    const st = O.stages.find((s) => s.id === id);
    // warnings, not refusals: changing the living thing must never be blocked by a stage list made for the old one
    if (!st)
      W.push(
        `“${STAGE_WORD(id)}” is not a stage in the life cycle of ${O.name}, so leaving it out changes nothing.`,
      );
    else if (st.why) W.push(`${st.why} It stays in the cycle.`);
  });
  if (P.compare && P.compare.show) {
    if (P.compare.organism === P.organism)
      W.push(
        "The second living thing is the same as the first, so no comparison is shown. Pick a different second living thing.",
      );
    else if (ORG[P.compare.organism].group === O.group)
      W.push(
        `Both are ${O.group}s, so the two cycles will look alike. A different group shows a clearer difference.`,
      );
  }
  // wording is the teacher's, except a stage name that states false science, and the legibility cap
  for (const [k, val] of Object.entries(P.text || {})) {
    const m = /^label:([\w-]+):([\w-]+)$/.exec(k);
    if (!m || typeof val !== "string") continue;
    const path = `text.${k}`;
    const org = ORG[m[1]];
    if (!org) continue;
    if (/\bcocoons?\b/i.test(val))
      R.push({
        path,
        reason:
          m[1] === "butterfly"
            ? "A butterfly makes a chrysalis, not a cocoon (a cocoon is the silk case a moth spins). Call this stage “chrysalis” or “pupa”."
            : `There is no cocoon in the life cycle of ${org.name}: a cocoon is the silk case a moth spins. Use the name of one of its own stages.`,
      });
    else if (m[1] === "mammal" && /\beggs?\b|\bhatch/i.test(val))
      R.push({
        path,
        reason: `${org.name[0].toUpperCase() + org.name.slice(1)} does not lay eggs or hatch: rabbits are born live and fed on milk. Use words like baby, young or adult.`,
      });
    else if (org.group === "bird" && /born live|\blive birth/i.test(val))
      R.push({
        path,
        reason:
          "Birds are not born live: a chick hatches from an egg. Use words like egg, chick or adult.",
      });
    else if ((org.group === "mammal" || org.group === "bird") && LARVAL.test(val))
      R.push({
        path,
        reason:
          org.group === "mammal"
            ? `Mammals have no larval stage: ${org.name.replace(/^an? /, "a ")} is born live and looks like a small adult. Use words like baby, young or adult.`
            : "Birds have no larval stage: a chick hatches looking like a small bird. Use words like egg, chick or adult.",
      });
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
// remove one item from a written list ("a, b and c"), keeping the commas and "and" right
function dropWord(t, w) {
  for (const [a, b] of [
    [`, ${w} and `, " and "],
    [`${w}, `, ""],
    [` and ${w}`, ""],
    [`, ${w}`, ""],
    [`${w} and `, ""],
  ])
    if (t.includes(a)) return t.replace(a, b);
  return t;
}
function plan(P) {
  const M = model(P);
  const items = [];
  M.A.stages.forEach((s) =>
    items.push({ key: `st:${s.id}`, caption: s.caption, note: s.note || "" }),
  );
  const lo0 = (s) => s.toLowerCase(),
    St = M.A.stages;
  items.push({
    key: "close",
    caption: M.A.own
      ? M.A.O.close[M.v]
      : `The ${lo0(St[St.length - 1].label)} makes new ${lo0(St[0].label)}, and the cycle starts again.`,
    note: M.A.O.closeNote,
  });
  if (M.B)
    items.push({
      key: "compare",
      caption: M.B.renamed
        ? `Now compare the life cycle of ${M.B.head.toLowerCase()}.`
        : `Now compare ${M.B.O.name}: it ${M.B.O.start} and ${M.B.O.change}.`,
      note: `${GROUP_NOTE[M.A.O.group]} ${GROUP_NOTE[M.B.O.group]}`,
    });
  const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
  const left = M.A.O.stages.filter((s) => !s.why && (P.leaveOut || []).includes(s.id));
  const low1 = (s) => s[0].toLowerCase() + s.slice(1);
  const own = !M.A.own
    ? M.A.stages.map((s, i) => (i ? low1(s.label) : cap1(s.label))).join(", ") +
      ": then it starts again."
    : !left.length
      ? M.A.O.sum[M.v]
      : M.v === 0
        ? M.A.stages.map((s, i) => (i ? low1(s.label) : cap1(s.label))).join(", ") +
          ": then it starts again."
        : left.reduce((t, s) => (s.sw ? dropWord(t, s.sw) : t), M.A.O.sum[1]);
  // two plants share one story: say it once, so the summary stays on one caption line
  const summary = !M.B
    ? own
    : M.A.renamed || M.B.renamed
      ? `${cap1(M.A.renamed ? M.A.head : M.A.O.name)} and ${M.B.renamed ? M.B.head : M.B.O.name}: two life cycles to compare.`
      : M.A.O.short === M.B.O.short
        ? `${cap1(M.A.O.name)} and ${M.B.O.name}: each ${M.A.O.short}.`
        : `${cap1(M.A.O.name)} ${M.A.O.short}; ${M.B.O.name} ${M.B.O.short}.`;
  const sumNote = M.B
    ? `Ask: what is the same in both cycles (growth, adults making young) and what is different (${M.A.O.group === "mammal" || M.B.O.group === "mammal" ? "eggs or live birth, " : ""}a change of shape or not)?`
    : "Ask the class to retell the cycle from any stage: a cycle has no first stage. Not to scale: young stages are drawn bigger than life so they can be seen.";
  return { M, items, summary, sumNote };
}
export function builds(P) {
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}
export function notes(P) {
  const { items, sumNote } = plan(P);
  return { steps: items.map((i) => i.note), summary: sumNote };
}

/* ------------------------------------------------------------------ render */
const LH = 32,
  RET = 30; // label line height; gap from the lowest label to the return arrow
const REL = (rel) => 0.7 + 0.3 * rel; // stages keep a hint of their growth, but every one reads from the back
function artScale(kind, size, rel) {
  const z = artSize(kind);
  return Math.min(size / z.w, size / z.h, 4) * REL(rel);
}
// the drawn extent of a stage's art at this slot size
function artExt(st, size) {
  if (st.card) return { w: size * 0.95, h: size * 0.8 };
  const z = artSize(st.kind),
    sc = artScale(st.kind, size, st.rel);
  return { w: z.w * sc, h: z.h * sc };
}
// a stage's art, centred in its slot (ring) or standing on the slot's floor (line)
function stageArt(g, st, x, y, size, floor, a) {
  if (st.card) {
    const e = artExt(st, size);
    const base = floor ? y + size / 2 : y + e.h / 2;
    return pictureCard(g, st.cardName || st.label, x, base, {
      w: e.w,
      h: e.h,
      a,
      model: "life_cycle",
      hint: st.label,
      // the shared cut-out is the adult: only the stage named as the living thing itself may use it
      noLibrary: !!st.cardName && st.cardName.toLowerCase() !== st.label.toLowerCase(),
    });
  }
  noteArt(st.label, st.kind);
  const z = artSize(st.kind),
    sc = artScale(st.kind, size, st.rel);
  const base = floor ? y + size / 2 - z.below * sc : y + (z.h * sc) / 2 - (z.below * sc) / 2;
  return drawArt(g, st.kind, x - z.cx * sc, base, sc, a);
}
let WARN = () => {},
  ROOT = null,
  LCLS = "ts-label",
  TINY = false;
const ELL = (r) => /…$/.test(r.lines[r.lines.length - 1] || "");
// a label's fit: wrap, then shrink (textBlock), then take more lines, up to cap. Overlong words are
// broken by the kit's wrap, so a 40-letter name always fits within the cap and is never cut short.
// Stage names share one type size per slide (LCLS), so a row never mixes big and small names.
function fit(s, maxW, ml0, cap = 12, a, cls = LCLS) {
  let r,
    first = null;
  const whole = String(s).split(/\s+/).filter(Boolean).join(" ");
  for (let ml = ml0; ml <= Math.max(ml0, cap); ml++) {
    const tmp = h("g", {}, ROOT);
    r = textBlock(tmp, 0, 0, s, { cls, maxW, maxLines: ml, lh: LH, a });
    tmp.remove();
    r = Object.assign({}, r, { ml, ok: !ELL(r), split: r.lines.join(" ") !== whole });
    delete r.el;
    if (r.ok && !r.split) return r;
    if (r.ok && !first) first = r;
  }
  // only a split word fits at this size ("Germinatio-n"): the small size may hold every word whole
  if (first && cls !== "ts-tiny") {
    const t = fit(s, maxW, ml0, cap, a, "ts-tiny");
    if (t.ok && !t.split) return t;
  }
  return first || r;
}
// a heading column is 180 wide, or as wide as its longest word (up to 240), so "(amphibian)" is never split
function HW(s) {
  return Math.min(
    240,
    Math.max(
      180,
      ...String(s)
        .split(/\s+/)
        .map((w) => measure(ROOT, w, "ts-label", { cls: "strong" }) + 2),
    ),
  );
}
// stage names in a row: each column as wide as the pitch allows, keeping the kit's 28-unit gap between names
const LANE = (avail, n) => Math.min(240, (avail - 28 * (n - 1)) / n);
function label(g, st, x, yTop, anchor, maxW, maxLines, a) {
  const f = fit(st.label, maxW, maxLines);
  const tb = textBlock(g, x, yTop + 24, st.label, {
    cls: f.cls === "ts-tiny" ? "ts-tiny" : LCLS,
    maxW,
    maxLines: f.ml,
    lh: LH,
    anchor,
    edit: st.edit,
    a: Object.assign({ fill: "var(--ink)" }, a),
  });
  if (tb.cls === "ts-tiny" || f.ml > maxLines) TINY = true; // needed the small size or extra lines: all names go small
  if (ELL(tb))
    WARN(`life_cycle: the stage name “${st.label}” is too long to show in full here; shorten it`);
  const box = {
    x: anchor === "start" ? x : anchor === "end" ? x - tb.w : x - tb.w / 2,
    y: yTop,
    w: tb.w,
    h: tb.h,
  };
  return { tb, box };
}

export function render(root, P, ctx) {
  // draw once at the label size; if any stage name had to drop to the small size, redraw them all small
  const n0 = root.childNodes.length;
  let out = draw(root, P, ctx, "ts-label");
  if (out.tiny) {
    while (root.childNodes.length > n0) root.lastChild.remove();
    out = draw(root, P, ctx, "ts-tiny");
  }
  for (const m of out.warns) ctx.warn(m);
  return {};
}
function draw(root, P, ctx, cls) {
  const { M } = plan(P);
  const b = ctx.b;
  const warns = [];
  WARN = (m) => {
    if (!warns.includes(m)) warns.push(m);
  };
  ROOT = root;
  LCLS = cls;
  TINY = false;
  const close = b.close,
    cmp = M.B ? b.compare : null;
  const boxes = [];
  // focus: the newest stage and the one it came from; at "close", the last and first; at "compare", the second cycle
  const stageC = (i, n) => {
    const parts = [];
    const bi = i;
    if (i === 0 && close > 1) {
      parts.push("1-2:soft");
      if (close > 2) parts.push(`2-${close}:quiet`);
    } else if (i > 0 && i < n - 1) {
      parts.push(`${bi + 1}-${bi + 2}:soft`);
      if (bi + 2 < close + 1) parts.push(`${bi + 2}-${close + 1}:quiet`);
    }
    if (cmp != null) parts.push(`${cmp}-${cmp + 1}:soft`);
    return parts.join(",") || null;
  };
  const arrowC = (i) => {
    const parts = [];
    if (i + 1 < close + 1) parts.push(`${i + 1}-${close + 1}:quiet`);
    if (cmp != null) parts.push(`${cmp}-${cmp + 1}:soft`);
    return parts.join(",") || null;
  };
  const closeC = cmp != null ? `${cmp}-${cmp + 1}:soft` : null;
  const arrows = h("g", {}, root),
    marks = h("g", {}, root);

  if (P.notToScale !== false) {
    // right end of the title band, wrapping to two lines (the engine's title stops short of it)
    const s = txt(P, "label:scale", "Not to scale"),
      sa = { fill: "var(--ink-2)" };
    const pre = fit(s, 300, 1, 2, sa, "ts-cap"),
      y = GRID.titleY - (pre.lines.length - 1) * 28;
    const tb = textBlock(root, GRID.right, y, s, {
      cls: "ts-cap",
      maxW: 300,
      maxLines: 2,
      lh: 28,
      anchor: "end",
      edit: "text.label:scale",
      a: sa,
    });
    if (ELL(tb))
      WARN("life_cycle: the “Not to scale” wording is too long for the title band; shorten it");
    boxes.push({
      x: GRID.right - tb.w,
      y: y - 22,
      w: tb.w,
      h: tb.h,
      what: "not to scale",
      band: true,
    });
  }

  const BELOW = 12 + RET + 6; // label gap under the floor, plus the return arrow under the labels
  if (!M.B && P.layout !== "line") ring(M.A);
  else if (!M.B) {
    const n = M.A.stages.length,
      avail = GRID.right - GRID.left,
      L = LANE(avail, n);
    const lb = Math.max(...M.A.stages.map((st) => fit(st.label, L, 4).h));
    row(M.A, {
      yFloor: Math.min(460, GRID.bottom - BELOW - lb),
      x0: GRID.left,
      maxLines: 4,
      size0: 250,
    });
  } else {
    // two rows share the height: measure both rows' labels, then size the art to what is left
    // the first column starts clear of the wider heading: a heading and a first label never touch
    const nMax = Math.max(M.A.stages.length, M.B.stages.length),
      ha = { cls: "strong" };
    const headW = Math.max(
      ...[M.A, M.B].map((C) => fit(C.head, HW(C.head), 3, 8, ha, "ts-label").w),
    );
    let x0 = GRID.left + 200,
      avail,
      L,
      pitch;
    for (let it = 0; it < 3; it++) {
      avail = GRID.right - x0;
      L = LANE(avail, nMax);
      pitch = nMax > 1 ? (avail - L) / (nMax - 1) : 0;
      const firstW = Math.max(...[M.A, M.B].map((C) => fit(C.stages[0].label, L, 3).w));
      x0 = Math.max(GRID.left + 200, GRID.left + headW + 32 + Math.max(0, firstW - L) / 2);
    }
    const lbH = (C) => Math.max(...C.stages.map((st) => fit(st.label, L, 3).h));
    const hA = lbH(M.A),
      hB = lbH(M.B);
    // the rows sit a little apart; when long names fill the height, the gap closes before the art goes below 48
    const room = (g) => (GRID.bottom - GRID.top - 10 - g - hA - hB - 2 * BELOW) / 2;
    const tight = room(32) < 48,
      top = GRID.top + (tight ? 0 : 10),
      gap = tight
        ? Math.max(12, Math.min(32, GRID.bottom - GRID.top - 96 - hA - hB - 2 * BELOW))
        : 32;
    const size = Math.max(
      48,
      Math.min(150, pitch * 0.8, pitch - 80, (GRID.bottom - top - gap - hA - hB - 2 * BELOW) / 2),
    );
    const fA = top + size,
      fB = fA + 12 + hA + RET + gap + size;
    row(M.A, { yFloor: fA, x0, maxLines: 3, size0: size, nMax, head: true });
    row(M.B, { yFloor: fB, x0, maxLines: 3, size0: size, nMax, head: true, second: true });
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlaps(boxes[i], boxes[j], 6))
        WARN(`life_cycle: ${boxes[i].what} meets ${boxes[j].what}`);
  for (const q of boxes)
    if (!q.band)
      if (q.x < 24 || q.x + q.w > 1256 || q.y < GRID.top - 40 || q.y + q.h > GRID.bottom + 4)
        WARN(`life_cycle: ${q.what} leaves the stage`);
  return { tiny: TINY && cls !== "ts-tiny", warns };

  /* ---- ring: an ellipse (wide, because the slide is wide); labels outward at the sides, inward at top and bottom */
  function ring(C) {
    const n = C.stages.length,
      cx = 640;
    const size0 = n <= 3 ? 230 : n === 4 ? 210 : n === 5 ? 180 : 150,
      rx0 = n <= 4 ? 330 : n === 5 ? 340 : 360;
    let size = size0,
      ext = C.stages.map((st) => artExt(st, size));
    const LOW = 0.45;
    // where each label goes, and how wide it may be, for a ring of half-width rx
    const slotOf = (t, i, rx) => {
      const c = Math.cos(t),
        sn = Math.sin(t),
        x = cx + rx * c,
        midW = 2 * rx - 40;
      if (sn > LOW) return { kind: "under", maxW: Math.abs(c) > 0.3 ? 260 : midW, ml: 2 };
      if (Math.abs(c) > 0.3) {
        const side = c > 0 ? 1 : -1,
          lx = x + side * (ext[i].w / 2 + 16);
        return {
          kind: "side",
          side,
          lx,
          maxW: Math.min(250, side > 0 ? GRID.right - lx : lx - GRID.left),
          ml: 4,
        };
      }
      if (sn < 0) return { kind: "over", maxW: midW, ml: 2 };
      return { kind: "none" };
    };
    // stages equally spaced along the ellipse (equal angles would bunch them at the sides)
    const SM = 720,
      angles = (rx, r) => {
        const P = (t) => [rx * Math.cos(t), r * Math.sin(t)],
          cum = [0];
        for (let j = 1; j <= SM; j++) {
          const [x0, y0] = P(-Math.PI / 2 + (2 * Math.PI * (j - 1)) / SM),
            [x1, y1] = P(-Math.PI / 2 + (2 * Math.PI * j) / SM);
          cum.push(cum[j - 1] + Math.hypot(x1 - x0, y1 - y0));
        }
        return C.stages.map((_, i) => {
          if (!i) return -Math.PI / 2;
          const L = (cum[SM] * i) / n;
          let j = 0;
          while (cum[j + 1] < L) j++;
          return (
            -Math.PI / 2 + (2 * Math.PI * (j + (L - cum[j]) / (cum[j + 1] - cum[j] || 1))) / SM
          );
        });
      };
    const lay = (rx, strict) => {
      // the top stage's label sits above it, so the ring fills the height left
      const topY = GRID.top + fit(C.stages[0].label, 2 * rx - 40, 2).h + 10 + ext[0].h / 2;
      let ry = 160,
        ts = angles(rx, ry),
        under;
      for (let it = 0; it < 4; it++) {
        under = C.stages.map((st, i) => {
          const q = slotOf(ts[i], i, rx);
          return ext[i].h / 2 + 10 + (q.kind === "under" ? fit(st.label, q.maxW, q.ml).h : 0);
        });
        // the lowest stage and its label just meet the foot of the stage
        ry = Math.max(
          90,
          Math.min(
            ...ts.map((t, i) =>
              Math.sin(t) > LOW ? (GRID.bottom - under[i] - topY) / (1 + Math.sin(t)) : 1e9,
            ),
          ),
        );
        ts = angles(rx, ry);
      }
      const cy = topY + ry;
      const fits = C.stages.every((st, i) => {
        const q = slotOf(ts[i], i, rx);
        if (q.kind === "none") return true;
        // strict: within its usual lines, at the usual size, no word split; else any fit that is not cut
        const f = fit(st.label, q.maxW, q.ml, strict ? q.ml : 12);
        return f.ok && (!strict || (!f.split && f.cls === LCLS));
      });
      // a narrower ring must never push two stages into each other
      const sb = ts.map((t, i) => ({
        x: cx + rx * Math.cos(t) - ext[i].w / 2,
        y: cy + ry * Math.sin(t) - ext[i].h / 2,
        w: ext[i].w,
        h: ext[i].h,
      }));
      const apart = sb.every((p, i) => sb.every((q, j) => j <= i || !overlaps(p, q, 8)));
      return { rx, ry, ts, cy, ok: fits && apart };
    };
    // a long side label pulls the ring in to give itself room, rather than being cut short; if the
    // stages would then meet, they are drawn a little smaller. First keep every label within its usual
    // lines; failing that, let labels take more lines.
    let G = null;
    for (const strict of [true, false]) {
      for (const f of [1, 0.85, 0.7]) {
        size = size0 * f;
        ext = C.stages.map((st) => artExt(st, size));
        for (let rx = rx0; rx >= 200 && !(G && G.ok); rx -= 20) G = lay(rx, strict);
        if (G.ok) break;
      }
      if (G.ok) break;
    }
    const { rx, ry, ts, cy } = G,
      pt = (t) => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
    const slots = C.stages.map((st, i) => {
      const t = ts[i],
        [x, y] = pt(t);
      const k = b[`st:${st.id}`];
      const e = ext[i];
      const g = h("g", { c: stageC(i, n) }, marks);
      stageArt(g, st, x, y, size, false, { s: k, cls: "pop", delay: i ? 700 : 0 });
      const q = slotOf(t, i, rx);
      let L;
      const la = { s: k, cls: "rise", delay: i ? 900 : 200 };
      if (q.kind === "under") L = label(g, st, x, y + e.h / 2 + 10, "middle", q.maxW, q.ml, la);
      else if (q.kind === "side")
        L = label(
          g,
          st,
          q.lx,
          y - fit(st.label, q.maxW, q.ml).h / 2 - 4,
          q.side > 0 ? "start" : "end",
          q.maxW,
          q.ml,
          la,
        );
      else if (q.kind === "over")
        L = label(
          g,
          st,
          x,
          y - e.h / 2 - 10 - fit(st.label, q.maxW, q.ml).h,
          "middle",
          q.maxW,
          q.ml,
          la,
        );
      const box = { x: x - e.w / 2, y: y - e.h / 2, w: e.w, h: e.h, what: `stage “${st.label}”` };
      boxes.push(box);
      if (L) boxes.push(Object.assign(L.box, { what: `label “${st.label}”` }));
      return { t, x, y, box, k };
    });
    // arcs: walk the ellipse from each stage until clear of its box, so arrows never touch a stage
    const out = (q, pad) => {
      const [x, y] = q;
      return (s) =>
        x < s.box.x - pad ||
        x > s.box.x + s.box.w + pad ||
        y < s.box.y - pad ||
        y > s.box.y + s.box.h + pad;
    };
    const arc = (A, Bs, t1, a) => {
      let t0 = A.t;
      while (!out(pt(t0), 10)(A) && t0 < t1) t0 += 0.004;
      let te = t1;
      while (!out(pt(te), 12 + ctx.tk.head)(Bs) && te > t0) te -= 0.004;
      if (te - t0 < 0.05) return WARN("life_cycle: stages too close for an arrow");
      const pts = [];
      for (let j = 0; j <= 40; j++) pts.push(pt(t0 + ((te - t0) * j) / 40));
      const d = "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ");
      const [ex, ey] = pts[40];
      const ang = Math.atan2(ry * Math.cos(te), -rx * Math.sin(te));
      arrow(
        ctx,
        arrows,
        d,
        ex,
        ey,
        ang,
        "var(--ink-3)",
        "var(--sw-arrow)",
        Object.assign({ k: 0.9 }, a),
      );
    };
    for (let i = 1; i < n; i++)
      arc(slots[i - 1], slots[i], slots[i].t, {
        draw: slots[i].k,
        delay: 100,
        g: { c: arrowC(i) },
      });
    if (n > 1)
      arc(slots[n - 1], slots[0], slots[0].t + 2 * Math.PI, {
        draw: close,
        delay: 100,
        g: { c: closeC },
      });
  }

  /* ---- row: stages left to right on one floor, labels under, the return arrow beneath */
  function row(C, o) {
    const n = C.stages.length,
      nM = o.nMax || n,
      avail = GRID.right - o.x0;
    const L = LANE(avail, nM),
      pitch = nM > 1 ? (avail - L) / (nM - 1) : 0;
    // the art leaves room for a readable arrow between neighbours
    const size = nM > 1 ? Math.min(o.size0, pitch * 0.8, pitch - 80) : o.size0,
      X0 = o.x0 + L / 2;
    const col = o.second ? "var(--compare)" : "var(--ink-3)";
    const yC = o.yFloor - size / 2;
    const kOf = (st, i) => (o.second ? cmp : b[`st:${st.id}`]);
    const dOf = (i) => (o.second ? 300 + i * 260 : i ? 700 : 0);
    const grpC = (i) => (o.second ? null : stageC(i, n));
    if (o.head) {
      const g = h(
        "g",
        { s: o.second ? cmp : 0, cls: o.second ? "rise" : null, c: o.second ? null : closeC },
        marks,
      );
      // the heading sits in the middle of its row's band (art and labels), wrapping and shrinking to fit
      const ha = { fill: o.second ? "var(--compare-text)" : "var(--ink)", cls: "strong" };
      const hw = HW(C.head),
        pre = fit(C.head, hw, 3, 8, ha, "ts-label"),
        lbH = Math.max(...C.stages.map((st) => fit(st.label, L, o.maxLines).h));
      const mid = (o.yFloor - size + o.yFloor + 12 + lbH) / 2,
        y0 = Math.max(o.yFloor - size, mid - pre.h / 2);
      const tb = textBlock(g, GRID.left, y0 + 22, C.head, {
        cls: "ts-label",
        maxW: hw,
        maxLines: pre.ml,
        lh: LH,
        edit: C.headEdit,
        a: ha,
      });
      if (ELL(tb))
        WARN(`life_cycle: the heading “${C.head}” is too long to show in full; shorten it`);
      boxes.push({ x: GRID.left, y: y0, w: tb.w, h: tb.h, what: `heading “${C.head}”` });
    }
    const slots = C.stages.map((st, i) => {
      const x = X0 + i * pitch,
        k = kOf(st, i);
      const g = h("g", { c: grpC(i) }, marks);
      stageArt(g, st, x, yC, size, true, { s: k, cls: "pop", delay: dOf(i) });
      const Lb = label(g, st, x, o.yFloor + 12, "middle", L, o.maxLines, {
        s: k,
        cls: "rise",
        delay: dOf(i) + 200,
      });
      const e = artExt(st, size),
        box = { x: x - e.w / 2, y: o.yFloor - e.h, w: e.w, h: e.h, what: `stage “${st.label}”` };
      boxes.push(box, Object.assign(Lb.box, { what: `label “${st.label}”` }));
      return { x, k, lb: Lb.box, e };
    });
    const ay = o.yFloor - Math.min(...slots.map((q) => q.e.h)) / 2;
    for (let i = 1; i < n; i++) {
      const A = slots[i - 1],
        Bs = slots[i];
      const g = { c: o.second ? null : arrowC(i) };
      const xa = A.x + A.e.w / 2 + 14,
        xe = Bs.x - Bs.e.w / 2 - 14 - ctx.tk.head * 0.65;
      if (xe - xa < 24) WARN("life_cycle: stages too close for an arrow");
      arrow(ctx, arrows, `M${xa} ${ay} L${xe} ${ay}`, xe, ay, 0, col, "var(--sw-arrow)", {
        draw: o.second ? cmp : Bs.k,
        delay: o.second ? 200 + i * 260 : 100,
        k: 0.9,
        g,
      });
    }
    if (n > 1) {
      const A = slots[n - 1],
        Bs = slots[0];
      const yb = Math.max(...slots.map((q) => q.lb.y + q.lb.h)) + RET;
      const ya = A.lb.y + A.lb.h + 10,
        ye = Bs.lb.y + Bs.lb.h + 10 + ctx.tk.head * 0.65;
      const d = `M${A.x} ${ya} C ${A.x} ${yb}, ${A.x} ${yb}, ${A.x - 36} ${yb} L ${Bs.x + 36} ${yb} C ${Bs.x} ${yb}, ${Bs.x} ${yb}, ${Bs.x} ${ye}`;
      arrow(ctx, arrows, d, Bs.x, ye, -Math.PI / 2, col, "var(--sw-arrow)", {
        draw: o.second ? cmp : close,
        delay: o.second ? 300 + n * 260 : 100,
        k: 0.9,
        g: { c: o.second ? null : closeC },
      });
      if (yb > GRID.bottom)
        WARN("life_cycle: the return arrow leaves the stage; use shorter stage names");
    }
  }
}

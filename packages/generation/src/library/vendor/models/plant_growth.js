// Plants: what they need and how they grow. One scene model, four views:
//   grow       a seed in a soil cutaway: seed, root, shoot, leaves (and flower), one stage per build
//   needs      a fair test: pots that change one thing each, then the result in each pot after N days
//   parts      a flowering plant with its parts named (and their jobs), one part per build
//   transport  a stem in coloured water: the colour climbs the stem and reaches the leaves or petals
// Outcomes in the fair test are worked out from the conditions (no light means pale and leggy,
// no water means wilted, a seed starts without light), so the slide cannot show false science.
import {
  computed,
  editable,
  eIO,
  GRID,
  ground,
  h,
  lerp,
  line,
  measure,
  nameFits,
  panels,
  result,
  schemaCheck,
  T,
  TEXT_PARAM_FOR,
  TITLE_PARAM,
  textBlock,
  txt,
  W,
  withDefaults,
  zoomInset,
} from "../kit/index.js";

const BEAN_WORDS = [
  "bean",
  "broad bean",
  "runner bean",
  "french bean",
  "bean seed",
  "bean plant",
  "seed",
  "plant",
  "our seed",
  "our plant",
  "my seed",
  "my plant",
];

export const meta = {
  id: "plant_growth",
  name: "Plants: what they need and how they grow",
  kind: "scene",
  version: 1,
  subjects: ["Science"],
  years: ["Reception", "Y1", "Y2", "Y3"],
  teaches:
    "How a seed grows into a plant, what plants need to grow well, the parts of a flowering plant and how water travels up the stem.",
};

/* ------------------------------------------------------------------ vocabulary */
const F = ["light", "water", "warmth"];
const FW = { light: "light", water: "water", warmth: "warmth" };
const PART_KINDS = ["flower", "petals", "leaves", "stem", "roots"];
const PART_WORDS = {
  roots: ["root", "roots"],
  stem: ["stem", "stems", "stalk", "stalks"],
  leaves: ["leaf", "leaves"],
  flower: ["flower", "flowers", "bloom", "blossom"],
  petals: ["petal", "petals"],
};
// names of other plant parts that this plant does not label: a label using one of them is false
const OTHER_PART_WORDS = [
  "seed",
  "seeds",
  "pollen",
  "bud",
  "buds",
  "fruit",
  "fruits",
  "branch",
  "branches",
  "bark",
  "thorn",
  "thorns",
  "stamen",
  "stamens",
  "anther",
  "anthers",
  "stigma",
  "stigmas",
  "sepal",
  "sepals",
  "bulb",
  "bulbs",
  "tuber",
  "tubers",
  "trunk",
  "trunks",
];
const RESULT = {
  healthy: "Tall, green and healthy",
  wilted: "Wilted and dry",
  nogrow: "Did not grow",
  dark: "Tall, thin and pale",
  cold: "Grew very slowly",
  darkcold: "Small, thin and pale",
};
const RESULT_SENTENCE = {
  healthy: "With light, water and warmth, the plant grew tall, green and healthy.",
  wilted: "With no water, the plant wilted and dried up.",
  nogrow: "With no water, the seed did not even start to grow.",
  dark: "In the dark it grew tall and thin, but pale and weak. It needs light to stay healthy.",
  cold: "In the cold it grew very slowly.",
  darkcold: "In the cold and dark it grew slowly, thin and pale.",
};
const PART_NAME = {
  flower: "Flower",
  petals: "Petals",
  leaves: "Leaves",
  stem: "Stem",
  roots: "Roots",
};
const PART_JOB = {
  flower: "Makes seeds so new plants can grow",
  petals: "Bright colours attract insects",
  leaves: "Make food for the plant using sunlight",
  stem: "Holds the plant up and carries water",
  roots: "Take in water and hold the plant in the soil",
};
// a part's name and job follow the part it points at unless the teacher has typed their own
const partLabel = (p) => String(p.label || "").trim() || PART_NAME[p.part];
const partJob = (p) => String(p.job || "").trim() || PART_JOB[p.part];
const STAGE = { sow: "Seed", root: "Root", shoot: "Shoot", leaves: "Leaves", flower: "Flower" };
const andList = (a) =>
  a.length <= 1 ? a[0] || "" : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const NUMW = ["no", "one", "two", "three", "four", "five"];
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const aOrAn = (w) => (/^[aeiou]/i.test(w) ? "an" : "a");
const diffs = (p, c) => F.filter((f) => !!p[f] !== !!c[f]);

/* ------------------------------------------------------------------ params */
const POT = {
  type: "object",
  required: ["label"],
  default: { label: "New pot", light: true, water: true, warmth: true },
  properties: {
    label: { type: "string", title: "Name on the pot", maxLength: 36 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */, minLength: 1 },
    light: { type: "boolean", title: "Light", default: true },
    water: { type: "boolean", title: "Water", default: true },
    warmth: {
      type: "boolean",
      title: "Warmth",
      description: "Off means somewhere cold but still light, like a cold windowsill in winter.",
      default: true,
    },
  },
};
const PART = {
  type: "object",
  required: ["part"],
  default: { part: "leaves", label: "", job: "" },
  properties: {
    part: {
      type: "string",
      title: "Part",
      enum: PART_KINDS,
      "x-labels": ["Flower", "Petals", "Leaves", "Stem", "Roots"],
      default: "leaves",
    },
    label: {
      type: "string",
      title: "Name",
      description: "Leave empty to use the name of the part.",
      maxLength: 40,
      default: "",
    },
    job: {
      type: "string",
      title: "Its job",
      description:
        "Shown when “Show what each part does” is on. Leave empty to use ours for the part.",
      maxLength: 90,
      default: "",
    },
  },
};
const DEFAULT_POTS = [
  { label: "Everything", light: true, water: true, warmth: true },
  { label: "No water", light: true, water: false, warmth: true },
  { label: "In the dark", light: false, water: true, warmth: true },
  { label: "Cold windowsill", light: true, water: true, warmth: false },
];
const DEFAULT_PARTS = PART_KINDS.map((part) => ({ part, label: "", job: "" }));

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Plants",
  properties: {
    title: TITLE_PARAM("How a plant grows"),
    view: {
      type: "string",
      title: "Show",
      enum: ["grow", "needs", "parts", "transport"],
      "x-labels": [
        "A seed growing",
        "What plants need (a fair test)",
        "Parts of a plant",
        "How water travels up the stem",
      ],
      default: "grow",
    },
    plantName: {
      type: "string",
      title: "Which seed",
      description: "Used in the captions, like “bean” or “sunflower”.",
      maxLength: 30,
      default: "bean",
    },
    showFlower: {
      type: "boolean",
      title: "Grow on to flowering",
      description: "Adds a last step where the plant flowers.",
      default: false,
    },
    showNeeds: {
      type: "boolean",
      title: "Show what each stage needs",
      description: "Water and warmth from the start, light once the leaves open.",
      default: false,
    },
    start: {
      type: "string",
      title: "Each pot starts with",
      enum: ["seedling", "seed"],
      "x-labels": ["A small seedling", "A seed"],
      default: "seedling",
    },
    days: { type: "integer", title: "Days we wait", minimum: 1, maximum: 60, default: 14 },
    pots: {
      type: "array",
      title: "Pots",
      description: "The first pot is the one to compare with. Each other pot changes one thing.",
      "x-item": "a pot",
      minItems: 2,
      maxItems: 4,
      items: POT,
      default: DEFAULT_POTS,
    },
    parts: {
      type: "array",
      title: "Parts to name",
      "x-item": "a part",
      minItems: 1,
      maxItems: 5,
      items: PART,
      default: DEFAULT_PARTS.slice(2).concat(DEFAULT_PARTS.slice(0, 1)),
    },
    showJobs: { type: "boolean", title: "Show what each part does", default: false },
    stemPlant: {
      type: "string",
      title: "Plant in the coloured water",
      enum: ["celery", "flower"],
      "x-labels": ["A celery stalk", "A white flower"],
      default: "celery",
    },
    dye: {
      type: "string",
      title: "Food colouring",
      enum: ["blue", "red"],
      "x-labels": ["Blue", "Red"],
      default: "blue",
    },
    showCut: { type: "boolean", title: "Show the stem cut across", default: true },
    hours: {
      type: "integer",
      title: "Hours we wait",
      minimum: 1,
      maximum: 72,
      default: 24,
      "x-panel": "advanced",
    },
    text: TEXT_PARAM_FOR({
      "stage:sow": "label",
      "stage:root": "label",
      "stage:shoot": "label",
      "stage:leaves": "label",
      "stage:flower": "label",
      nts: "label",
      "result:healthy": "phrase",
      "result:wilted": "phrase",
      "result:nogrow": "phrase",
      "result:dark": "phrase",
      "result:cold": "phrase",
      "result:darkcold": "phrase",
      "dye-water": "label",
      up: "phrase",
      cut: "phrase",
      tubes: "sentence",
    }),
  },
};

export const presets = [
  {
    id: "reception-bean",
    name: "Reception: growing a bean",
    params: {
      title: "Growing a bean",
      view: "grow",
      plantName: "bean",
      showFlower: false,
      showNeeds: false,
    },
  },
  {
    id: "y2-needs",
    name: "Year 2: what plants need",
    params: {
      title: "What do plants need to grow well?",
      view: "needs",
      start: "seedling",
      days: 14,
      pots: DEFAULT_POTS,
    },
  },
  {
    id: "y3-parts",
    name: "Year 3: parts of a flowering plant",
    params: {
      title: "Parts of a flowering plant",
      view: "parts",
      showJobs: true,
      parts: DEFAULT_PARTS,
    },
  },
  {
    id: "y3-transport",
    name: "Year 3: how water travels",
    params: {
      title: "How water travels through a plant",
      view: "transport",
      stemPlant: "celery",
      dye: "blue",
      hours: 24,
      showCut: true,
    },
  },
];

/* ------------------------------------------------------------------ model of the data */
function outcome(p, start) {
  if (!p.water) return start === "seed" ? "nogrow" : "wilted";
  if (!p.light && !p.warmth) return "darkcold";
  if (!p.light) return "dark";
  if (!p.warmth) return "cold";
  return "healthy";
}
function model(P) {
  const pots = (P.pots || []).map((p, i) => ({ ...p, i, out: outcome(p, P.start) }));
  const c = pots[0] || {};
  const tested = F.filter((f) => pots.some((p) => diffs(p, c).length === 1 && !!p[f] !== !!c[f]));
  const stages = ["sow", "root", "shoot", "leaves"].concat(P.showFlower ? ["flower"] : []);
  const parts = (P.parts || []).map((p, i) => ({ ...p, i }));
  return { pots, tested, stages, parts };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const Wn = [];
  if (R.length) return result(R);
  // the drawing is one broad bean: a seed growing or its parts are only shown under a bean's name, so a
  // sunflower is never drawn as a bean (the fair-test pots and the stem view show a generic seedling)
  if ((P.view === "grow" || P.view === "parts") && !nameFits(P.plantName, BEAN_WORDS))
    return result([
      {
        path: "plantName",
        reason: P.view === "parts"
          ? `The parts picture is one drawn flowering plant, so it can’t be named “${P.plantName}”. Call it a bean, or use a different diagram for ${P.plantName}.`
          : `The pictures show a broad bean, so they can’t show “${P.plantName}” growing. Call it a bean, or use a different diagram for ${P.plantName}.`,
      },
    ]);
  if (P.view === "needs") {
    const c = P.pots[0];
    P.pots.forEach((p, i) => {
      if (!i) return;
      const d = F.filter((f) => !!p[f] !== !!c[f]);
      if (!d.length)
        Wn.push(
          `“${p.label}” has the same conditions as “${c.label}”, so it does not test anything. Change one thing in it.`,
        );
      if (d.length > 1)
        Wn.push(
          `“${p.label}” changes ${NUMW[d.length]} things compared with “${c.label}” (${andList(d.map((f) => FW[f]))}), so it is not a fair test: you cannot tell which one made the difference. Change only one thing.`,
        );
    });
    if (P.pots.every((p) => F.every((f) => !!p[f] === !!c[f])))
      (Wn.length = 0), Wn.push("Every pot has the same conditions, so nothing is being tested.");
    if (P.start === "seed" && P.days < 7)
      R.push({
        path: "days",
        reason: `Seeds take about a week to come up, so after ${P.days} day${P.days === 1 ? "" : "s"} the pots would all look the same. Wait at least 7 days.`,
      });
    else if (P.start === "seedling" && P.days < 5)
      R.push({
        path: "days",
        reason: `After ${P.days} day${P.days === 1 ? "" : "s"} the seedlings would still look the same. Wait at least 5 days so the difference shows.`,
      });
  }
  if (P.view === "parts") {
    PART_KINDS.forEach((k) => {
      const n = P.parts.filter((p) => p.part === k).length;
      if (n > 1)
        Wn.push(
          `${cap1(NUMW[n])} labels point at the ${k}. Change one of them to point at a different part.`,
        );
    });
    P.parts.forEach((p, i) => {
      if (!String(p.label || "").trim()) return;
      const words = String(p.label)
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean);
      const own = PART_WORDS[p.part] || [];
      const other =
        PART_KINDS.find((k) => k !== p.part && PART_WORDS[k].some((w) => words.includes(w))) ||
        OTHER_PART_WORDS.find((w) => words.includes(w));
      if (other && !own.some((w) => words.includes(w)))
        R.push({
          path: `parts.${i}.label`,
          reason: `“${p.label}” is the name of a different part, but this label points at the ${p.part}. Rename it, or change which part it points at.`,
        });
    });
  }
  if (P.view === "transport" && P.hours < 3)
    R.push({
      path: "hours",
      reason: `Coloured water takes a few hours to climb a stem, so after ${P.hours} hour${P.hours === 1 ? "" : "s"} you would see almost nothing. Wait at least 3 hours (overnight works well).`,
    });
  return result(R, Wn);
}

/* ------------------------------------------------------------------ builds and notes */
function plan(P) {
  const M = model(P);
  const items = [];
  let summary = "";
  const nm = (P.plantName || "").trim();
  if (P.view === "grow") {
    const cap = {
      sow: `The ${nm && nm.toLowerCase() !== "seed" ? nm + " " : ""}seed is planted in damp soil. It needs water and warmth to start.`,
      root: "First a root grows down. It takes in water and holds the seed in place.",
      shoot: "Then a shoot pushes up towards the light, using food stored in the seed.",
      leaves: "Leaves open in the light. Now the plant can make its own food.",
      flower: "The plant grows taller and makes flowers. Flowers make new seeds.",
    };
    const note = {
      sow: "A seed needs water and warmth to start growing (germination), but not light: it starts underground in the dark.",
      root: "The seed swells with water and its coat splits. The root always grows first and always grows down, even if the seed is planted upside down. The fuzz near its tip is root hairs, which soak up water. Ask: why does the root come first?",
      shoot:
        "The shoot uses food stored in the seed until it reaches the light. That is why a seed can start in the dark. It comes up bent over like a hook, which protects its tip as it pushes through the soil. In a broad bean the two halves of the seed (the cotyledons, the food store) stay underground.",
      leaves:
        "Once the leaves are in the light the plant makes its own food. From now on it needs light, water and warmth. The seed underground shrinks as its stored food is used up.",
      flower:
        "Flowers make seeds, and the seeds grow into new plants. A real plant takes weeks to flower.",
    };
    M.stages.forEach((s) => items.push({ key: s, caption: cap[s], note: note[s] }));
    summary = {
      caption: `Seed, root, shoot, leaves${P.showFlower ? ", flower" : ""}: ${nm ? aOrAn(nm) + " " + nm : "a plant"} grows in the same order every time.`,
      note: "Not to scale: real roots spread much further than shown. Ask the class to put picture cards of each stage in order and say what the plant needs at each one.",
    };
  } else if (P.view === "needs") {
    const n = M.pots.length;
    const c = M.pots[0];
    const rest = M.pots.slice(1).map((p) => diffs(p, c).length),
      ch = rest.filter((d) => d === 1).length,
      same = rest.filter((d) => !d).length,
      many = rest.length - ch - same;
    const part = (k, one, more) => `${NUMW[k]} ${k === 1 ? one : more}`;
    const changes =
      ch === n - 1
        ? "Each changes one thing."
        : same === n - 1
          ? "Every pot is kept the same."
          : cap1(
              [
                ch && part(ch, "changes one thing", "change one thing"),
                many && part(many, "changes more than one", "change more than one"),
                same && part(same, "is the same as the first", "are the same as the first"),
              ]
                .filter(Boolean)
                .join("; "),
            ) + ".";
    items.push({
      key: "pots",
      caption: `${cap1(NUMW[n])} pots with the same plants and the same soil. ${changes}`,
      note: `Keep everything else the same: the same plant, pot, soil and amount of water. “${c.label}” is the pot we compare with. Ask: why must only one thing change?`,
    });
    items.push({
      key: "wait",
      caption: `We wait ${P.days} days and look after every pot in the same way.`,
      note: `Ask the class to predict each pot before you show it. Real ${P.start === "seed" ? "seeds take about a week to come up" : "seedlings change within a week or two"}.`,
    });
    M.pots.forEach((p) => {
      const d = diffs(p, c);
      items.push({
        key: `res:${p.i}`,
        caption: RESULT_SENTENCE[p.out],
        note:
          (p.i === 0 && p.out !== "healthy" ? `“${c.label}” is the pot we compare with. ` : "") +
          {
            healthy:
              p.i === 0
                ? "This is the plant we compare with: everything it needs."
                : d.length === 1
                  ? `This pot had ${FW[d[0]]} and “${c.label}” did not, so ${FW[d[0]]} made the difference.`
                  : "This plant had light, water and warmth, so it grew well.",
            wilted: "Without water the leaves and stem go floppy, then dry and brown.",
            nogrow: "A seed needs water to start growing. Without it, nothing happens.",
            dark: "A plant in the dark grows tall and thin as it searches for light, but its leaves stay small and yellow. It is not healthy. (The seed itself can start in the dark: it is the leaves that need light.)",
            cold: "Cold slows everything down. Most plants grow very slowly, or stop, when it is cold.",
            darkcold:
              p.i > 0 && d.length === 1
                ? `Only the ${FW[d[0]]} is different from “${c.label}”, so this is still a fair test: the difference comes from the ${d[0] === "warmth" ? "cold" : d[0] === "light" ? "dark" : "water"}.`
                : p.i === 0
                  ? "It has no light and no warmth. Compare each other pot with it."
                  : "Two things are missing here, so we cannot tell which one caused it. That is why a fair test changes one thing.",
          }[p.out],
      });
    });
    summary = {
      caption:
        M.tested.length && F.every((f) => M.pots[0][f])
          ? `Plants need ${andList(M.tested.map((f) => FW[f]))} to grow well.`
          : "Compare each pot with the first one to see what made the difference.",
      note: "Ask: which pot grew best, and what did it have that the others did not? Try it in class with cress: it shows a difference within a week.",
    };
  } else if (P.view === "parts") {
    items.push({
      key: "plant",
      caption: "This is a flowering plant. Each part has its own name.",
      note: "Ask the class to point to the parts they already know. Not to scale: real roots spread out much further.",
    });
    const PN = {
      flower: "Flowers make seeds. Insects carry pollen from flower to flower.",
      petals: "Bright petals and their smell attract insects such as bees.",
      leaves: "Leaves use sunlight to make food for the plant.",
      stem: "The stem holds the plant up towards the light and carries water from the roots to the leaves.",
      roots: "Roots anchor the plant in the soil and take in water and nutrients.",
    };
    M.parts.forEach((p) =>
      items.push({
        key: `part:${p.i}`,
        caption: P.showJobs
          ? `${partLabel(p)}: ${partJob(p).replace(/\.$/, "")}.`
          : `This part is called the ${partLabel(p).toLowerCase()}.`,
        note: PN[p.part],
      }),
    );
    summary = {
      caption: P.showJobs
        ? "Each part has a job that helps the plant live and grow."
        : `${andList(M.parts.map(partLabel))}: the parts of a plant.`,
      note: "Cover a label and ask the class to name the part, then say what it does.",
    };
  } else {
    const what = P.stemPlant === "celery" ? "celery stalk" : "white flower";
    items.push({
      key: "setup",
      caption: `A ${what} stands in water with ${P.dye} food colouring in it.`,
      note: "The stem should be freshly cut so the tubes are open. Ask: what do you think will happen?",
    });
    items.push({
      key: "rise",
      caption: "The coloured water travels up the stem through tiny tubes.",
      note: "Water moves up from the roots (here, the cut end) to every part of the plant. The colouring shows us where the water goes.",
    });
    items.push({
      key: "top",
      caption: `After ${P.hours} hours the colour reaches the ${P.stemPlant === "celery" ? "leaves" : "petals"}.`,
      note: "Ask: how did the colour get all the way up there?",
    });
    if (P.showCut)
      items.push({
        key: "cut",
        caption:
          "Cut across the stem and you can see the coloured dots: the tubes that carry water.",
        note: "Cut a real stalk across with the class: the dots of colour are the tubes.",
      });
    summary = {
      // the picture is a cut stalk with no roots (and celery has no flowers): the summary says what it shows
      caption: `Water travels up the stem to the ${P.stemPlant === "celery" ? "leaves" : "petals"}. In a growing plant it starts at the roots.`,
      note: "Link back to the parts of a plant: the stem carries water, the leaves use it to make food.",
    };
  }
  return { M, items, summary };
}
export function builds(P) {
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary.caption },
  };
}
export function notes(P) {
  const { items, summary } = plan(P);
  return { steps: items.map((it) => it.note || ""), summary: summary.note };
}

/* ------------------------------------------------------------------ drawing */
const C = {
  leaf: "var(--leaf)",
  leafSh: "var(--life-shade)",
  stem: "var(--life-shade)",
  pale: "color-mix(in oklab, var(--leaf) 26%, var(--seed))",
  paleSh: "color-mix(in oklab, var(--leaf) 38%, var(--seedhead))",
  dry: "color-mix(in oklab, var(--leaf) 30%, var(--seedhead))",
  drySh: "color-mix(in oklab, var(--leaf) 22%, var(--soil-deep))",
  soil: "var(--soil)",
  soilDeep: "var(--soil-deep)",
  soilDry: "color-mix(in oklab, var(--soil) 45%, var(--sand))",
  root: "color-mix(in oklab, var(--seed) 28%, var(--cloud))",
  seed: "var(--seed)",
  seedLine: "var(--seedhead)",
  pot: "color-mix(in oklab, var(--hue-brown) 62%, var(--hue-red))",
  potSh: "color-mix(in oklab, var(--hue-brown) 55%, var(--shade))",
  petal: "var(--berry)",
  petalSh: "var(--berry-shade)",
  centre: "var(--sun)",
  grass: "var(--hill-near)",
  dark: "color-mix(in oklab, var(--soil-deep) 45%, var(--shade))",
  cold: "color-mix(in oklab, var(--ice) 50%, var(--bg))",
};
const DEG = Math.PI / 180;
function leafD(x, y, len, ang, wd) {
  const c = Math.cos(ang),
    s = Math.sin(ang),
    tx = x + c * len,
    ty = y + s * len,
    mx = x + c * len * 0.5,
    my = y + s * len * 0.5,
    px = -s * wd,
    py = c * wd;
  return `M${x.toFixed(1)} ${y.toFixed(1)} Q${(mx + px).toFixed(1)} ${(my + py).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)} Q${(mx - px).toFixed(1)} ${(my - py).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)} Z`;
}
const quadAt = (a, b, c, t) => [
  (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0],
  (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1],
];

function roots(p, x, y, depth, spread = 1, a = {}) {
  const g = h("g", a, p),
    ol = h("g", {}, g),
    fg = h("g", {}, g);
  const st = { fill: "none", stroke: C.root, "stroke-linecap": "round" };
  const two = (d, w) => {
    h(
      "path",
      { d, fill: "none", stroke: BN.rootLine, "stroke-width": w + 3, "stroke-linecap": "round" },
      ol,
    );
    h("path", Object.assign({ d, "stroke-width": w }, st), fg);
  };
  two(`M${x} ${y} Q ${x - 8} ${y + depth * 0.5} ${x + 3} ${y + depth}`, 6);
  const n = Math.max(1, Math.round(depth / 40));
  for (let j = 0; j < n; j++)
    for (const side of [-1, 1]) {
      const y0 = y + depth * (0.18 + (0.7 * j) / Math.max(1, n)),
        len = depth * 0.5 * spread * (1 - (0.35 * j) / n);
      two(
        `M${x - 3} ${y0} Q ${x + side * len * 0.5} ${y0 + 4} ${x + side * len} ${y0 + len * 0.45}`,
        3.5,
      );
    }
  return g;
}
/** A plant from its base (x, y) up. Returns named groups so a part can be focused. */
function plant(p, o) {
  const {
    x,
    y,
    H,
    pairs = 3,
    leafLen = 60,
    leafW = 20,
    stemW = 7,
    droop = 0,
    flower = false,
    fr = 1,
    tMin = 0.3,
    tMax = 0.9,
  } = o;
  const lf = o.leaf || C.leaf,
    lfs = o.leafSh || C.leafSh;
  const g = h("g", o.a || {}, p);
  const P0 = [x, y],
    P2 = [x + droop * H * 0.45, y - H * (1 - droop * 0.4)],
    P1 = [x + droop * H * 0.05, y - H * 0.85];
  const gl = h("g", {}, g),
    gs = h("g", {}, g);
  const anchors = {};
  for (let i = 0; i < pairs; i++) {
    const t = tMin + (tMax - tMin) * (pairs === 1 ? 0.7 : i / (pairs - 1));
    const [bx, by] = quadAt(P0, P1, P2, t);
    const len = leafLen * (1 - (0.18 * i) / Math.max(1, pairs)),
      wd = leafW * (len / leafLen);
    const aL = (-150 - 60 * droop + 10 * i) * DEG,
      aR = (-30 + 60 * droop - 10 * i) * DEG;
    h("path", { d: leafD(bx, by, len, aL, wd), fill: lf, cls: "body" }, gl);
    h("path", { d: leafD(bx, by, len, aR, wd), fill: lfs, cls: "body" }, gl);
    if (i === Math.floor((pairs - 1) / 2))
      anchors.leaves = [bx + Math.cos(aL) * len * 0.55, by + Math.sin(aL) * len * 0.55];
  }
  h(
    "path",
    {
      d: `M${P0[0]} ${P0[1]} Q ${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}`,
      fill: "none",
      stroke: o.stem || C.stem,
      "stroke-width": stemW,
      "stroke-linecap": "round",
    },
    gs,
  );
  anchors.stem = quadAt(P0, P1, P2, 0.2);
  anchors.top = P2;
  let gp = null,
    gc = null;
  if (flower) {
    const ug = h("g", {}, g);
    gp = h("g", {}, g);
    gc = h("g", {}, g);
    const [fx, fy] = P2;
    const d = 34 * fr;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const px = fx + Math.cos(a) * d,
        py = fy + Math.sin(a) * d;
      h(
        "ellipse",
        {
          cx: px,
          cy: py,
          rx: 24 * fr,
          ry: 14 * fr,
          transform: `rotate(${i * 45} ${px} ${py})`,
          fill: "var(--bg)",
        },
        ug,
      );
    }
    h("circle", { cx: fx, cy: fy, r: d, fill: "var(--bg)" }, ug);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const px = fx + Math.cos(a) * d,
        py = fy + Math.sin(a) * d;
      h(
        "ellipse",
        {
          cx: px,
          cy: py,
          rx: 24 * fr,
          ry: 14 * fr,
          transform: `rotate(${i * 45} ${px} ${py})`,
          fill: o.petal || (i % 2 ? C.petalSh : C.petal),
          cls: "body",
        },
        gp,
      );
    }
    h("circle", { cx: fx, cy: fy, r: 18 * fr, fill: C.centre, cls: "body" }, gc);
    anchors.flower = [fx + 6 * fr, fy - 4 * fr];
    anchors.petals = [fx - d - 16 * fr, fy];
  }
  return { g, leaves: gl, stem: gs, petals: gp, centre: gc, anchors };
}
function pot(p, cx, top, soil, a = {}) {
  const g = h("g", a, p);
  const w = 196,
    hh = 100,
    r = 20,
    inset = 24;
  h("rect", { x: cx - w / 2 + 4, y: top - 6, width: w - 8, height: 10, rx: 4, fill: soil }, g);
  h(
    "polygon",
    {
      points: `${cx - w / 2 + 4},${top + r} ${cx + w / 2 - 4},${top + r} ${cx + w / 2 - inset},${top + hh} ${cx - w / 2 + inset},${top + hh}`,
      fill: C.pot,
      cls: "body",
    },
    g,
  );
  h(
    "polygon",
    {
      points: `${cx + w / 6},${top + r} ${cx + w / 2 - 4},${top + r} ${cx + w / 2 - inset},${top + hh} ${cx + w / 6 - 6},${top + hh}`,
      fill: C.potSh,
    },
    g,
  );
  h(
    "rect",
    { x: cx - w / 2 - 4, y: top, width: w + 8, height: r, rx: 4, fill: C.pot, cls: "body" },
    g,
  );
  h("rect", { x: cx + w / 6, y: top, width: w / 3 + 4, height: r, fill: C.potSh }, g);
  return g;
}
/* condition icons: sun, drop, thermometer; off = greyed with a slash across the icon only */
function icon(p, kind, x, y, r, on, badge = false) {
  const g = h("g", {}, p);
  if (badge)
    h(
      "circle",
      {
        cx: x,
        cy: y,
        r: r * 1.45,
        fill: "var(--paper)",
        stroke: on ? "var(--rule)" : "var(--ink)",
        "stroke-width": on ? "var(--sw-hair)" : "var(--sw-struct)",
      },
      g,
    );
  const col = on
    ? { light: "var(--sun)", water: "var(--water)", warmth: "var(--heat)" }[kind]
    : "var(--ink-3)";
  if (kind === "light") {
    h("circle", { cx: x, cy: y, r: r * 0.5, fill: col }, g);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      h(
        "line",
        {
          x1: x + Math.cos(a) * r * 0.7,
          y1: y + Math.sin(a) * r * 0.7,
          x2: x + Math.cos(a) * r,
          y2: y + Math.sin(a) * r,
          stroke: col,
          "stroke-width": "var(--sw-rule)",
          "stroke-linecap": "round",
        },
        g,
      );
    }
  } else if (kind === "water") {
    h(
      "path",
      {
        d: `M${x} ${y - r} C ${x + r * 0.3} ${y - r * 0.4} ${x + r * 0.75} ${y} ${x + r * 0.75} ${y + r * 0.3} A ${r * 0.75} ${r * 0.7} 0 0 1 ${x - r * 0.75} ${y + r * 0.3} C ${x - r * 0.75} ${y} ${x - r * 0.3} ${y - r * 0.4} ${x} ${y - r} Z`,
        fill: col,
      },
      g,
    );
  } else {
    h(
      "rect",
      {
        x: x - r * 0.22,
        y: y - r,
        width: r * 0.44,
        height: r * 1.3,
        rx: r * 0.22,
        fill: "var(--paper)",
        stroke: col,
        "stroke-width": "var(--sw-rule)",
      },
      g,
    );
    h("circle", { cx: x, cy: y + r * 0.55, r: r * 0.42, fill: col }, g);
    h("rect", { x: x - r * 0.1, y: y - r * 0.4, width: r * 0.2, height: r, fill: col }, g);
  }
  if (!on) {
    const q = badge ? r * 1.02 : r;
    h(
      "line",
      {
        x1: x - q,
        y1: y + q,
        x2: x + q,
        y2: y - q,
        stroke: "var(--ink)",
        "stroke-width": badge ? "var(--sw-arrow)" : "var(--sw-struct)",
        "stroke-linecap": "round",
      },
      g,
    );
  }
  return g;
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { M } = plan(P);
  // past labels recede less than the kit's soft step so their text keeps about 4.5:1 contrast
  h("style", {}, root).textContent =
    ".slide .pg-past{opacity:.86;transition:opacity var(--t-recede) var(--ease-out)} .slide .pg-job{font-size:var(--fs-label);fill:var(--ink-2)}";
  if (P.view === "needs") return renderNeeds(root, P, ctx, M);
  if (P.view === "parts") return renderParts(root, P, ctx, M);
  if (P.view === "transport") return renderTransport(root, P, ctx, M);
  return renderGrow(root, P, ctx, M);
}
// celery leaf stalks: [tip x, tip y, leaflet angle in degrees]
const CELERY_TOP = (cx, top) => [
  [cx - 84, top - 66, -125],
  [cx - 6, top - 98, -92],
  [cx + 78, top - 74, -60],
];
const notToScale = (root, P) =>
  editable(
    T(root, GRID.left, GRID.subY, txt(P, "label:nts", "Not to scale"), "ts-tiny"),
    "text.label:nts",
  );

/* ---- the grow view: a broad bean, drawn in unit space with the seed centre at (0, 0) and the
   soil surface at y = -BD. A broad bean germinates below ground: the cotyledons stay in the coat.
   The root and the shoot both leave from the hilum end (left), so the stem axis sits near x = -44
   and the whole stage is shifted right by SX to centre it in its panel. Every stage is laid out in
   the same frame as the tallest one, so nothing moves between builds. */
const BD = 64,
  SX = 34,
  DOWN = 186,
  SK = 1.32; // SK: the bean is drawn larger than life so its coat, scar and split read from the back // DOWN: deepest root below the seed centre, for every stage
const UP = { leaves: 262, flower: 352 }; // tallest stage's reach above the seed centre
const BN = {
  coat: "color-mix(in oklab, var(--hue-gold) 34%, var(--cloud))",
  coatSh: "color-mix(in oklab, var(--hue-gold) 62%, var(--cloud))",
  hl: "color-mix(in oklab, var(--hue-gold) 8%, var(--cloud))",
  rim: "color-mix(in oklab, var(--seedhead) 55%, var(--soil-deep))",
  hilum: "color-mix(in oklab, var(--soil-deep) 45%, var(--shade))",
  hilumRim: "color-mix(in oklab, var(--seedhead) 62%, var(--cloud))",
  old: "color-mix(in oklab, var(--seedhead) 48%, var(--cloud))",
  oldSh: "color-mix(in oklab, var(--seedhead) 74%, var(--cloud))",
  coty: "color-mix(in oklab, var(--hue-gold) 10%, var(--cloud))",
  cotySeam: "color-mix(in oklab, var(--hue-gold) 50%, var(--seedhead))",
  root: "color-mix(in oklab, var(--hue-gold) 14%, var(--cloud))",
  rootLine: "color-mix(in oklab, var(--soil-deep) 70%, var(--shade))",
  soil: "color-mix(in oklab, var(--soil) 66%, var(--soil-deep))",
  deep: "color-mix(in oklab, var(--soil) 38%, var(--soil-deep))",
  under: "color-mix(in oklab, var(--leaf) 55%, var(--seed))",
  stemLine: "var(--life-shade)",
  vein: "color-mix(in oklab, var(--leaf) 45%, var(--cloud))",
  veinSh: "color-mix(in oklab, var(--life-shade) 55%, var(--cloud))",
  petal: "var(--cloud)",
  blotch: "color-mix(in oklab, var(--hue-purple) 35%, var(--shade))",
};
const f1 = (v) => (+v).toFixed(1);
const jit = (i) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const cubicAt = (Q, t) =>
  [0, 1].map(
    (e) =>
      (1 - t) ** 3 * Q[0][e] +
      3 * (1 - t) ** 2 * t * Q[1][e] +
      3 * (1 - t) * t * t * Q[2][e] +
      t ** 3 * Q[3][e],
  );
const tanAt = (Q, t) => {
  const a = cubicAt(Q, Math.max(0, t - 0.01)),
    b = cubicAt(Q, Math.min(1, t + 0.01)),
    d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};
/** A filled stroke along cubic Q that narrows from w0 to w1: roots and stems taper like real ones. */
function taper(Q, w0, w1, n = 24) {
  const Ls = [],
    Rs = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      p = cubicAt(Q, t),
      [tx, ty] = tanAt(Q, t),
      w = lerp(w0, w1, t) / 2;
    Ls.push(`${f1(p[0] - ty * w)} ${f1(p[1] + tx * w)}`);
    Rs.push(`${f1(p[0] + ty * w)} ${f1(p[1] - tx * w)}`);
  }
  const e = cubicAt(Q, 1),
    [tx, ty] = tanAt(Q, 1),
    r = w1 / 2;
  return `M${Ls.join(" L")} Q ${f1(e[0] + tx * r * 1.6)} ${f1(e[1] + ty * r * 1.6)} ${Rs.reverse().join(" L")} Z`;
}
/** Root hairs along Q from t0 to t1, behind a bare tip: short pale strands that read on dark soil. */
function hairs(d, Q, t0, t1, n, len, w0, w1, seed0) {
  for (let i = 0; i < n; i++) {
    const t = lerp(t0, t1, (i + 0.5) / n),
      p = cubicAt(Q, t),
      [tx, ty] = tanAt(Q, t),
      w = lerp(w0, w1, t) / 2;
    const fade = 1 - 0.45 * Math.abs((i + 0.5) / n - 0.45) * 2; // longest in the middle of the zone
    for (const sd of [-1, 1]) {
      const r = jit(seed0 + i * 2 + (sd > 0)),
        a = sd * (58 + 50 * r) * DEG,
        L = len * fade * (0.55 + 0.7 * jit(seed0 + i * 5 + 3 * (sd > 0)));
      const nx = tx * Math.cos(a) - ty * Math.sin(a),
        ny = tx * Math.sin(a) + ty * Math.cos(a);
      const x0 = p[0] + nx * w * 0.6,
        y0 = p[1] + ny * w * 0.6;
      const bend = (jit(seed0 + i * 7 + sd) - 0.5) * L * 0.5;
      d.push(
        `M${f1(x0)} ${f1(y0)} Q${f1(x0 + nx * L * 0.5 - ny * bend)} ${f1(y0 + ny * L * 0.5 + nx * bend)} ${f1(x0 + nx * L)} ${f1(y0 + ny * L)}`,
      );
    }
  }
}
const ROOT0 = [-27 * SK, 29 * SK]; // where the root leaves the coat, beside the hilum
/** The root system: a tap root from beside the hilum, side roots, and a fuzz of root hairs. */
function beanRoots(p, depth, laterals, spread) {
  const g = h("g", {}, p),
    hd = [],
    O = ROOT0;
  const tap = [
    O,
    [O[0] - 10, O[1] + depth * 0.35],
    [O[0] + 8, O[1] + depth * 0.7],
    [O[0] + 2, O[1] + depth],
  ];
  const lat = [];
  for (let j = 0; j < laterals; j++) {
    const t = 0.2 + (0.5 * j) / Math.max(1, laterals - 1),
      [bx, by] = cubicAt(tap, t),
      sd = j % 2 ? 1 : -1;
    const len = (88 - (34 * j) / Math.max(1, laterals)) * spread,
      dn = 0.42 + 0.14 * jit(j + 50);
    const Q = [
      [bx, by],
      [bx + sd * len * 0.42, by + len * 0.02],
      [bx + sd * len * 0.8, by + len * dn * 0.45],
      [bx + sd * len, by + len * dn],
    ];
    lat.push(Q);
    hairs(hd, Q, 0.4, 0.88, 7, 11, 9, 3, 30 + j * 9);
  }
  hairs(hd, tap, depth < 120 ? 0.38 : 0.5, 0.9, depth < 120 ? 18 : 15, 19, 15, 3.5, 7);
  h(
    "path",
    {
      d: hd.join(" "),
      fill: "none",
      stroke: BN.root,
      "stroke-width": 1.9,
      "stroke-linecap": "round",
    },
    g,
  );
  const st = { fill: BN.root, stroke: BN.rootLine, "stroke-width": 2, "stroke-linejoin": "round" };
  lat.forEach((Q) =>
    h("path", Object.assign({ d: taper(Q, 9, 3, 14), "stroke-width": 1.6 }, st), g),
  );
  h("path", Object.assign({ d: taper(tap, 15, 3.5) }, st), g);
  return g;
}
/** Points from a to b with alternating sideways offsets: a torn edge. */
function jag(a, b, n, amp, s0) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    L = Math.hypot(dx, dy) || 1,
    nx = -dy / L,
    ny = dx / L,
    out = [];
  for (let i = 1; i < n; i++) {
    const t = i / n,
      o = (i % 2 ? 1 : -1) * amp * (0.6 + 0.6 * jit(s0 + i));
    out.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]);
  }
  return out;
}
const KIDNEY =
  "M-58 2 C-58 -22 -36 -36 -6 -36 C28 -36 58 -26 58 0 C58 24 40 36 20 35 C8 34 0 25 -12 25 C-22 25 -28 34 -38 34 C-52 34 -58 20 -58 2Z";
/** The bean: kidney-shaped coat with its concave side down, the dark hilum scar in the hollow,
    soft light from the top left. open: 0 whole, 1 coat cracked, 2 coat split wide. */
function beanSeed(p, open, spent, s = 1) {
  const g = h("g", { transform: `scale(${(s * SK).toFixed(3)})` }, p);
  h(
    "path",
    {
      d: KIDNEY,
      fill: spent ? BN.old : BN.coat,
      stroke: BN.rim,
      "stroke-width": 2.4,
      "stroke-linejoin": "round",
      cls: "body",
    },
    g,
  );
  h(
    "path",
    {
      d: "M-56 10 C-52 26 -46 33 -38 33 C-28 33 -22 24 -12 24 C0 24 8 33 20 34 C40 35 56 24 57 4 C48 19 34 23 20 21 C6 19 -2 15 -14 15 C-28 16 -44 22 -56 10Z",
      fill: spent ? BN.oldSh : BN.coatSh,
    },
    g,
  );
  h(
    "ellipse",
    {
      cx: -14,
      cy: -21,
      rx: 27,
      ry: 6.5,
      transform: "rotate(-5 -14 -21)",
      fill: BN.hl,
      opacity: spent ? 0.35 : 0.8,
    },
    g,
  );
  // the faint ridges of a broad-bean coat; a spent seed is shrivelled, so more of them
  const ridges = spent
    ? [
        "M12 -26 C26 -22 38 -14 44 -2",
        "M-2 -8 C14 -10 30 -4 38 8",
        "M-36 -18 C-24 -14 -16 -6 -14 4",
      ]
    : ["M14 -25 C27 -21 38 -13 44 -1"];
  ridges.forEach((d) =>
    h(
      "path",
      {
        d,
        fill: "none",
        stroke: spent ? BN.oldSh : BN.coatSh,
        "stroke-width": 2,
        "stroke-linecap": "round",
      },
      g,
    ),
  );
  h("ellipse", { cx: -12, cy: 26.5, rx: 16, ry: 6, fill: BN.hilumRim }, g);
  h("ellipse", { cx: -12, cy: 26.5, rx: 12, ry: 3.4, fill: BN.hilum }, g);
  if (open) {
    // the coat tears from beside the hilum up the end of the seed; the pale seed leaf shows through
    const A = [-27, 27],
      E1 = open > 1 ? [-56, 13] : [-57.6, 6],
      E2 = open > 1 ? [-51, -25] : [-57.8, -5];
    const pts = [
      A,
      ...jag(A, E1, 5, open > 1 ? 2.6 : 1.6, 3),
      E1,
      ...(open > 1 ? [[-59.5, -6]] : []),
      E2,
      ...jag(E2, A, 5, open > 1 ? 2.6 : 1.6, 11),
    ];
    h(
      "path",
      {
        d: "M" + pts.map((q) => `${f1(q[0])} ${f1(q[1])}`).join(" L") + "Z",
        fill: BN.coty,
        stroke: BN.rim,
        "stroke-width": 2.4,
        "stroke-linejoin": "round",
      },
      g,
    );
    if (open > 1)
      h(
        "path",
        {
          d: "M-30 22 C-40 12 -50 0 -58 -6",
          fill: "none",
          stroke: BN.cotySeam,
          "stroke-width": 2,
          "stroke-linecap": "round",
        },
        g,
      );
  }
  return g;
}
/** A stroked stem with a darker outline, so it reads on cream and on soil. */
function stemStroke(p, d, w, fill, line) {
  h(
    "path",
    {
      d,
      fill: "none",
      stroke: line,
      "stroke-width": w + 4,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    },
    p,
  );
  h(
    "path",
    {
      d,
      fill: "none",
      stroke: fill,
      "stroke-width": w,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    },
    p,
  );
}
const SHOOT0 = `M${-54 * SK} ${-6 * SK} C${-66 * SK} -36 -58 -52 -52 -64`; // inside the split, up to the soil surface
/** One leaflet with its base at (0, 0) along +x: pointed oval, midrib and side veins. */
function leaflet(p, x, y, ang, L, fill, vein) {
  const w = L * 0.46,
    g = h("g", { transform: `translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)})` }, p);
  h(
    "path",
    {
      d: `M0 0 C${f1(L * 0.2)} ${f1(-w * 0.66)} ${f1(L * 0.72)} ${f1(-w * 0.58)} ${f1(L)} 0 C${f1(L * 0.72)} ${f1(w * 0.58)} ${f1(L * 0.2)} ${f1(w * 0.66)} 0 0Z`,
      fill,
      stroke: "var(--life-shade)",
      "stroke-width": 1.2,
      cls: "body",
    },
    g,
  );
  const v = [`M${f1(L * 0.04)} 0 L${f1(L * 0.88)} 0`];
  [0.3, 0.52, 0.72].forEach((t) => {
    const x0 = L * t,
      d = L * 0.13;
    v.push(
      `M${f1(x0)} 0 Q${f1(x0 + d * 0.5)} ${f1(-w * 0.18)} ${f1(x0 + d)} ${f1(-w * 0.3)}`,
      `M${f1(x0)} 0 Q${f1(x0 + d * 0.5)} ${f1(w * 0.18)} ${f1(x0 + d)} ${f1(w * 0.3)}`,
    );
  });
  h(
    "path",
    { d: v.join(" "), fill: "none", stroke: vein, "stroke-width": 1.4, "stroke-linecap": "round" },
    g,
  );
}
/** A broad-bean leaf at a stem node: a stipule at the joint, a stalk, and a pair of leaflets
    joined at the stalk's tip (so they are attached, not floating). */
function beanLeaf(p, x, y, sd, L) {
  const ang = sd > 0 ? -38 : -142,
    c = Math.cos(ang * DEG),
    s = Math.sin(ang * DEG),
    pl = L * 0.3,
    ex = x + c * pl,
    ey = y + s * pl;
  h(
    "path",
    {
      d: `M${f1(x)} ${f1(y)} l${f1(sd * 11)} ${f1(-3)} l${f1(-sd * 6)} 9Z`,
      fill: "var(--life-shade)",
    },
    p,
  ); // stipule
  stemStroke(p, `M${f1(x)} ${f1(y)} L${f1(ex)} ${f1(ey)}`, 4, "var(--leaf)", "var(--life-shade)");
  leaflet(p, ex, ey, ang - 30 * sd, L * 0.92, "var(--life-shade)", BN.veinSh);
  leaflet(p, ex, ey, ang + 22 * sd, L, "var(--leaf)", BN.vein);
}
function beanBud(p, x, y, sz, down = false) {
  const base = down ? 90 : -90;
  [
    [base - 9, "var(--life-shade)"],
    [base + 8, "var(--leaf)"],
  ].forEach(([a, fill]) => {
    const cx = x + Math.cos(a * DEG) * sz * 0.5,
      cy = y + Math.sin(a * DEG) * sz * 0.5;
    h(
      "ellipse",
      {
        cx: f1(cx),
        cy: f1(cy),
        rx: f1(sz * 0.52),
        ry: f1(sz * 0.24),
        transform: `rotate(${a} ${f1(cx)} ${f1(cy)})`,
        fill,
        stroke: "var(--life-shade)",
        "stroke-width": 1.2,
        cls: "body",
      },
      p,
    );
  });
}
/** A broad-bean flower in a leaf joint, side on: green calyx, a white hooded standard petal with
    purple veins, and the dark-tipped wing petal showing beneath it. */
function beanFlower(p, x, y, ang) {
  const g = h("g", { transform: `translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)}) scale(1.35)` }, p);
  h("path", { d: "M14 4 C20 12 32 12 37 6 C34 2 24 1 14 4Z", fill: BN.blotch }, g); // wing, behind
  h("path", { d: "M2 0 C6 -4 11 -5 14 -3 L14 3 C10 5 6 4 2 0Z", fill: "var(--life-shade)" }, g); // calyx
  h(
    "path",
    {
      d: "M12 0 C14 -9 26 -18 37 -15 C44 -12 42 1 35 5 C27 9 17 6 12 0Z",
      fill: BN.petal,
      stroke: "var(--ink-3)",
      "stroke-width": 0.9,
      "stroke-linejoin": "round",
      cls: "body",
    },
    g,
  );
  h(
    "path",
    {
      d: "M15 -1 C22 -6 29 -10 36 -11 M17 1 C24 -1 31 -3 38 -3",
      fill: "none",
      stroke: "color-mix(in oklab, var(--hue-purple) 45%, var(--cloud))",
      "stroke-width": 0.9,
      "stroke-linecap": "round",
    },
    g,
  );
}
/** The stem and leaves: pale below ground, green above, nodes along it, a folded bud on top. */
function beanShoot(p, topY, nodes, flowers) {
  const g = h("g", {}, p);
  stemStroke(g, SHOOT0, 16, BN.under, BN.stemLine);
  const S = [
    [-52, -BD],
    [-44, -BD + (topY + BD) * 0.35],
    [-56, -BD + (topY + BD) * 0.72],
    [-46, topY],
  ];
  const lv = h("g", {}, g);
  h(
    "path",
    {
      d: taper(S, 16, 8),
      fill: "var(--leaf)",
      stroke: BN.stemLine,
      "stroke-width": 2,
      "stroke-linejoin": "round",
    },
    g,
  );
  nodes.forEach(([t, sd, size], i) => {
    const [x, y] = cubicAt(S, t);
    beanLeaf(lv, x + sd * 2, y, sd, size);
    if (flowers && flowers.includes(i))
      [-58, -24].forEach((a) => beanFlower(g, x - sd * 5, y - 4, sd > 0 ? -180 - a : a));
  });
  beanBud(g, -46, topY + 3, 30);
  return g;
}
/** The shoot breaking the surface bent over as a hook, its folded tip pointing down. */
function beanHook(p) {
  const g = h("g", {}, p);
  stemStroke(g, SHOOT0, 16, BN.under, BN.stemLine);
  stemStroke(
    g,
    "M-52 -64 C-48 -102 -50 -138 -28 -154 C-6 -168 18 -148 16 -116",
    17,
    "var(--leaf)",
    BN.stemLine,
  );
  beanBud(g, 16, -111, 26, true);
  return g;
}

function renderGrow(root, P, ctx, M) {
  // one frame for every stage, sized by the tallest: the plant fills the panel height and width
  const b = ctx.b,
    fl0 = P.showFlower,
    Tlim = P.showNeeds ? 176 : 120,
    LY = 630,
    SBmax = 594;
  const n = M.stages.length;
  const pans = panels(n, 120, 640);
  const up = fl0 ? UP.flower : UP.leaves,
    kV = (SBmax - 4 - Tlim) / (up + DOWN),
    kH = (pans[0].w / 2 + 22) / 132;
  const k = Math.min(1.25, kV, kH),
    SY = Tlim + (up - BD) * k,
    SB = Math.min(SBmax, SY + (BD + DOWN) * k + 6);
  ground(root, GRID.left, GRID.right, SY, SB, BN.soil, { rx: "var(--r-card)" });
  // a deeper soil layer: flat planes, no texture
  const clipId = ctx.uid + "-soil";
  const cp = h("clipPath", { id: clipId }, h("defs", {}, root));
  h(
    "rect",
    { x: GRID.left, y: SY, width: GRID.right - GRID.left, height: SB - SY, rx: "var(--r-card)" },
    cp,
  );
  const deepY = SY + (SB - SY) * 0.62,
    sg = h("g", { "clip-path": `url(#${clipId})` }, root);
  h(
    "path",
    {
      d: `M${GRID.left} ${f1(deepY + 6)} C ${GRID.left + 300} ${f1(deepY - 8)} ${GRID.right - 420} ${f1(deepY + 14)} ${GRID.right} ${f1(deepY - 4)} V ${SB} H ${GRID.left} Z`,
      fill: BN.deep,
    },
    sg,
  );
  ground(root, GRID.left, GRID.right, SY - 7, SY, C.grass);
  let prevLab = null;
  M.stages.forEach((st, i) => {
    const pn = pans[i],
      cx = pn.cx;
    const g = h("g", { s: b[st], c: ctx.rc(st, null, "pg-past") }, root);
    const gi = h("g", { cls: "rise" }, g);
    const gs = h(
      "g",
      { transform: `translate(${f1(cx)} ${f1(SY)}) scale(${k.toFixed(3)}) translate(${SX} ${BD})` },
      gi,
    );
    if (st === "sow") beanSeed(gs, 0, false);
    else if (st === "root") {
      beanRoots(gs, 110, 0, 1);
      beanSeed(gs, 1, false, 1.05);
    } else if (st === "shoot") {
      beanRoots(gs, 128, 3, 0.8);
      beanHook(gs);
      beanSeed(gs, 2, false, 1.05);
    } else {
      const fl = st === "flower",
        topY = fl ? -BD - 236 : -BD - 156;
      beanRoots(gs, 140, fl ? 6 : 5, fl ? 1.05 : 1);
      beanShoot(
        gs,
        topY,
        fl
          ? [
              [0.2, 1, 80],
              [0.42, -1, 76],
              [0.63, 1, 66],
              [0.83, -1, 54],
            ]
          : [
              [0.3, 1, 90],
              [0.58, -1, 84],
              [0.84, 1, 62],
            ],
        fl ? [1, 2] : null,
      );
      beanSeed(gs, 2, true, 0.94);
    }
    if (P.showNeeds) {
      const need =
        st === "leaves" || st === "flower" ? ["water", "warmth", "light"] : ["water", "warmth"];
      need.forEach((k2, j) => icon(g, k2, cx + (j - (need.length - 1) / 2) * 44, 142, 15, true));
    }
    const lab = textBlock(g, cx, LY, txt(P, "label:stage:" + st, STAGE[st]), {
      cls: "ts-label",
      maxW: pn.w - 70,
      maxLines: 1,
      anchor: "middle",
      edit: "text.label:stage:" + st,
    });
    // a short arrow from one stage name to the next: the order is the point
    if (prevLab) {
      const x0 = prevLab.cx + prevLab.w / 2 + 14,
        x1 = cx - lab.w / 2 - 14;
      if (x1 - x0 > 24)
        line(ctx, root, x0, LY - 10, x1, LY - 10, "var(--ink-2)", "var(--sw-struct)", {
          draw: b[st],
        });
    }
    prevLab = { cx, w: lab.w };
  });
}

function renderNeeds(root, P, ctx, M) {
  const b = ctx.b,
    SY = 476;
  const n = M.pots.length;
  const pans = panels(n, 120, 640);
  const grow = [];
  M.pots.forEach((p, i) => {
    const pn = pans[i],
      cx = pn.cx,
      out = p.out;
    const others = M.pots
      .filter((q) => q.i !== i)
      .map((q) => `${b["res:" + q.i]}-${b["res:" + q.i] + 1}:pg-past`)
      .join(",");
    const g = h("g", { s: b.pots, c: others || null }, root);
    if (!p.light || !p.warmth)
      h(
        "rect",
        {
          x: cx - 122,
          y: 206,
          width: 244,
          height: SY + 104 - 206,
          rx: "var(--r-card)",
          fill: !p.light ? C.dark : C.cold,
        },
        g,
      );
    // the start: identical in every pot
    const startG = h("g", out === "nogrow" ? {} : { hide: b.wait }, g);
    if (P.start === "seed")
      beanSeed(h("g", { transform: `translate(${cx} ${SY - 18}) scale(.42)` }, startG), 0, false);
    else
      plant(startG, {
        x: cx,
        y: SY - 4,
        H: 84,
        pairs: 1,
        leafLen: 44,
        leafW: 16,
        stemW: 6,
        tMin: 0.7,
      });
    // the result after N days, worked out from the conditions
    const fin = h("g", { s: b.wait }, g);
    const fg = h("g", {}, fin);
    const look = {
      healthy: { H: 240, pairs: 3, leafLen: 72, leafW: 23, stemW: 9 },
      dark: {
        H: 252,
        pairs: 2,
        leafLen: 32,
        leafW: 10,
        stemW: 5,
        leaf: C.pale,
        leafSh: C.paleSh,
        stem: C.pale,
      },
      wilted: {
        H: 186,
        pairs: 3,
        leafLen: 58,
        leafW: 18,
        stemW: 8,
        droop: 0.85,
        leaf: C.dry,
        leafSh: C.drySh,
        stem: C.drySh,
      },
      cold: { H: 108, pairs: 1, leafLen: 50, leafW: 17, stemW: 8, tMin: 0.6 },
      darkcold: {
        H: 118,
        pairs: 1,
        leafLen: 30,
        leafW: 10,
        stemW: 5,
        tMin: 0.6,
        leaf: C.pale,
        leafSh: C.paleSh,
        stem: C.pale,
      },
    }[out];
    if (look) {
      plant(fg, Object.assign({ x: cx, y: SY - 4 }, look));
      grow.push({ fg, cx });
    }
    pot(g, cx, SY, p.water ? C.soil : C.soilDry);
    F.forEach((f, j) => icon(g, f, cx + (j - 1) * 58, SY + 58, 17, !!p[f], true));
    textBlock(g, cx, SY + 136, p.label, {
      cls: "ts-label",
      maxW: Math.min(pn.w - 8, 250),
      maxLines: 2,
      lh: 28,
      anchor: "middle",
      edit: `pots.${i}.label`,
    });
    textBlock(g, cx, 152, txt(P, "label:result:" + out, RESULT[out]), {
      cls: "ts-label",
      maxW: Math.min(pn.w - 8, 250),
      maxLines: 2,
      lh: 30,
      anchor: "middle",
      edit: "text.label:result:" + out,
      a: { s: b["res:" + i], cls: "rise" },
    });
  });
  // day counter in the title band, only when the title leaves room for it
  let dc = null;
  const tw = P.title ? measure(root, P.title, "ts-title") : 0,
    cw = measure(root, `Day ${P.days}`, "ts-num");
  if (GRID.left + tw + 48 < GRID.right - cw) {
    dc = T(root, GRID.right, GRID.titleY, `Day ${P.days}`, "ts-num", {
      "text-anchor": "end",
      s: b.pots,
    });
    computed(dc, "days");
  }
  const set = (f) => {
    const s = lerp(0.3, 1, f);
    for (const { fg, cx } of grow)
      fg.setAttribute("transform", `translate(${cx} ${SY}) scale(${s}) translate(${-cx} ${-SY})`);
    if (dc) dc.textContent = `Day ${Math.round(f * P.days)}`;
  };
  set(1);
  return {
    tick(k, u) {
      set(k < b.wait ? 0 : k === b.wait ? eIO(u) : 1);
    },
    still() {
      set(1);
    },
    reset() {
      set(0);
    },
    dur: { wait: 1400 },
  };
}

function renderParts(root, P, ctx, M) {
  const b = ctx.b,
    SY = 506,
    cx = 640;
  notToScale(root, P);
  const soilG = h("g", {}, root);
  ground(soilG, cx - 176, cx + 176, SY, 640, C.soil);
  ground(soilG, cx - 176, cx + 176, SY - 8, SY, C.grass);
  const pl = h("g", { s: b.plant, cls: "rise" }, root);
  const rg = roots(pl, cx, SY - 2, 118, 1.7);
  const pt = plant(pl, {
    x: cx,
    y: SY,
    H: 286,
    pairs: 3,
    leafLen: 124,
    leafW: 38,
    stemW: 13,
    flower: true,
    fr: 1.55,
    tMin: 0.2,
    tMax: 0.62,
  });
  const groups = {
    roots: [rg],
    stem: [pt.stem],
    leaves: [pt.leaves],
    petals: [pt.petals],
    centre: [pt.centre],
  };
  const kindGroups = {
    roots: ["roots"],
    stem: ["stem"],
    leaves: ["leaves"],
    flower: ["petals", "centre"],
    petals: ["petals"],
  };
  for (const gname in groups) {
    const r = M.parts
      .filter((p) => !kindGroups[p.part].includes(gname))
      .map((p) => `${b["part:" + p.i]}-${b["part:" + p.i] + 1}:soft`)
      .join(",");
    if (r) for (const el of groups[gname]) el.dataset.c = r;
  }
  const anchor = {
    roots: [cx - 60, SY + 50],
    stem: [cx + 4, SY - 118],
    leaves: pt.anchors.leaves,
    flower: pt.anchors.flower,
    petals: pt.anchors.petals,
  };
  const sideOf = { flower: "right", stem: "right", petals: "left", leaves: "left", roots: "left" };
  const XL = 446,
    XR = 834,
    maxW = 370;
  for (const side of ["left", "right"]) {
    const list = M.parts
      .filter((p) => sideOf[p.part] === side)
      .map((p) => ({ p, a: anchor[p.part] }))
      .sort((u, v) => u.a[1] - v.a[1]);
    // draw each block at y = 0 to measure it, then stack top to bottom
    for (const it of list) {
      const k = b["part:" + it.p.i];
      it.g = h("g", { s: k, c: ctx.rc("part:" + it.p.i, null, "pg-past") }, root);
      const inner = h("g", {}, it.g);
      const x = side === "left" ? XL : XR,
        anc = side === "left" ? "end" : "start";
      const nb = textBlock(inner, x, 0, partLabel(it.p), {
        cls: "ts-label",
        maxW,
        maxLines: 2,
        lh: 30,
        anchor: anc,
        edit: `parts.${it.p.i}.label`,
        a: { cls: "halo" },
      });
      let hh = nb.h;
      if (P.showJobs) {
        const jb = textBlock(inner, x, nb.h + 4, partJob(it.p), {
          cls: "pg-job",
          maxW,
          maxLines: 3,
          lh: 34,
          anchor: anc,
          edit: `parts.${it.p.i}.job`,
        });
        hh += jb.h + 4;
      }
      it.inner = inner;
      it.hh = hh;
      it.top = it.a[1] + 10 - 24;
    }
    let prev = 128;
    for (const it of list) {
      it.top = Math.max(it.top, prev);
      prev = it.top + it.hh + 20;
    }
    const over = prev - 20 - GRID.bottom;
    if (over > 0) {
      let lim = 128;
      for (const it of list) {
        it.top = Math.max(lim, it.top - over);
        lim = it.top + it.hh + 20;
      }
      if (lim - 20 > GRID.bottom)
        ctx.warn(`plant_growth: the ${side} labels do not fit; shorten a job.`);
    }
    for (const it of list) {
      const base = it.top + 24;
      it.inner.setAttribute("transform", `translate(0 ${base})`);
      const lx = side === "left" ? XL + 12 : XR - 12,
        ly = base - 10;
      const ld = h("g", {}, it.g);
      it.g.insertBefore(ld, it.inner);
      h(
        "line",
        {
          x1: lx,
          y1: ly,
          x2: it.a[0],
          y2: it.a[1],
          stroke: "var(--ink-2)",
          "stroke-width": "var(--sw-lead)",
          "stroke-linecap": "round",
        },
        ld,
      );
      h("circle", { cx: it.a[0], cy: it.a[1], r: 6, fill: "var(--ink)" }, ld);
    }
  }
}

function renderTransport(root, P, ctx, M) {
  // the stalk stands centred, or on the left from the first build when the cut will open beside it
  const b = ctx.b,
    cx = 400,
    JT = 404,
    JB = 620,
    WL = 446,
    TOP = 268,
    SHIFT = 640 - cx,
    JW = 100;
  const dye = P.dye === "red" ? "var(--berry)" : "var(--water)";
  const under = h("g", {}, root);
  const mover = h("g", {}, root);
  const g = h("g", { s: b.setup }, mover);
  const celery = P.stemPlant === "celery";
  const clipId = ctx.uid + "-dye";
  const cp = h("clipPath", { id: clipId }, h("defs", {}, root));
  const clipR = h("rect", { x: 0, y: TOP - 40, width: W, height: WL - TOP + 40 }, cp);
  const xs = celery ? [-18, 0, 18] : [0];
  if (celery) {
    for (const [x1, y1, rot] of CELERY_TOP(cx, TOP)) {
      h(
        "path",
        {
          d: `M${cx} ${TOP + 8} Q ${(cx + x1) / 2} ${TOP - 10} ${x1} ${y1}`,
          fill: "none",
          stroke: "color-mix(in oklab, var(--leaf) 62%, var(--paper))",
          "stroke-width": 11,
          "stroke-linecap": "round",
        },
        g,
      );
      [-50, 0, 50].forEach((da, j) =>
        h(
          "path",
          {
            d: leafD(x1, y1, j === 1 ? 52 : 44, (rot + da) * DEG, 20),
            fill: j === 1 ? C.leaf : C.leafSh,
            cls: "body",
          },
          g,
        ),
      );
    }
    h(
      "path",
      {
        d: `M${cx - 34} ${JB - 8} L ${cx - 25} ${TOP + 4} L ${cx + 25} ${TOP + 4} L ${cx + 34} ${JB - 8} Z`,
        fill: "color-mix(in oklab, var(--leaf) 45%, var(--paper))",
        cls: "body",
      },
      g,
    );
    h(
      "path",
      {
        d: `M${cx + 10} ${JB - 8} L ${cx + 9} ${TOP + 4} L ${cx + 25} ${TOP + 4} L ${cx + 34} ${JB - 8} Z`,
        fill: "color-mix(in oklab, var(--leaf) 62%, var(--paper))",
      },
      g,
    );
  } else {
    h("path", { d: leafD(cx, 430, 90, -150 * DEG, 25), fill: C.leaf, cls: "body" }, g);
    h("path", { d: leafD(cx, 360, 82, -30 * DEG, 23), fill: C.leafSh, cls: "body" }, g);
    h(
      "line",
      {
        x1: cx,
        y1: JB - 8,
        x2: cx,
        y2: TOP,
        stroke: C.stem,
        "stroke-width": 13,
        "stroke-linecap": "round",
      },
      g,
    );
  }
  // dye strands: below the water line always coloured, above it revealed by the rising clip
  const strand = (p, a) =>
    xs.forEach((dx) =>
      h(
        "line",
        Object.assign(
          {
            x1: cx + dx,
            y1: JB - 10,
            x2: cx + dx,
            y2: TOP + 8,
            stroke: dye,
            "stroke-width": 4.5,
            "stroke-linecap": "round",
          },
          a || {},
        ),
        p,
      ),
    );
  const low = h("g", {}, g);
  strand(low, { y2: WL });
  const up = h("g", { "clip-path": `url(#${clipId})`, s: b.rise }, g);
  strand(up);
  // the colour reaches the top
  const topG = h("g", { s: b.top }, g);
  if (celery)
    for (const [x1, y1, rot] of CELERY_TOP(cx, TOP)) {
      h(
        "path",
        {
          d: `M${cx} ${TOP + 8} Q ${(cx + x1) / 2} ${TOP - 10} ${x1} ${y1}`,
          fill: "none",
          stroke: dye,
          "stroke-width": 4.5,
          "stroke-linecap": "round",
        },
        topG,
      );
      [-50, 0, 50].forEach((da, j) => {
        const a = (rot + da) * DEG,
          L = (j === 1 ? 52 : 44) * 0.7;
        h(
          "line",
          {
            x1,
            y1,
            x2: x1 + Math.cos(a) * L,
            y2: y1 + Math.sin(a) * L,
            stroke: dye,
            "stroke-width": 3.5,
            "stroke-linecap": "round",
          },
          topG,
        );
      });
    }
  if (!celery) {
    const fl = h("g", {}, g);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4,
        px = cx + Math.cos(a) * 44,
        py = TOP + Math.sin(a) * 44;
      h(
        "ellipse",
        {
          cx: px,
          cy: py,
          rx: 34,
          ry: 21,
          transform: `rotate(${i * 45} ${px} ${py})`,
          fill: "var(--snow)",
          stroke: "var(--rule)",
          "stroke-width": "var(--sw-hair)",
          cls: "body",
        },
        fl,
      );
      h(
        "ellipse",
        {
          cx: px,
          cy: py,
          rx: 29,
          ry: 13,
          transform: `rotate(${i * 45} ${px} ${py})`,
          fill: `color-mix(in oklab, ${dye} 55%, var(--snow))`,
        },
        topG,
      );
    }
    h(
      "circle",
      { cx, cy: TOP, r: 21, fill: "color-mix(in oklab, var(--leaf) 40%, var(--snow))" },
      fl,
    );
    g.appendChild(topG);
  }
  // the jar of coloured water in front of the stem
  h(
    "rect",
    {
      x: cx - JW,
      y: WL,
      width: JW * 2,
      height: JB - WL,
      rx: 10,
      fill: `color-mix(in oklab, ${dye} 55%, var(--bg))`,
      opacity: 0.8,
    },
    g,
  );
  h(
    "path",
    {
      d: `M${cx - JW} ${JT} V ${JB - 12} Q ${cx - JW} ${JB} ${cx - JW + 12} ${JB} H ${cx + JW - 12} Q ${cx + JW} ${JB} ${cx + JW} ${JB - 12} V ${JT}`,
      fill: "none",
      stroke: "var(--glass-edge)",
      "stroke-width": "var(--sw-struct)",
      "stroke-linecap": "round",
    },
    g,
  );
  // labels on the left
  const XL = cx - JW - 24;
  textBlock(g, XL, 540, txt(P, "label:dye-water", "Coloured water"), {
    cls: "ts-label",
    maxW: XL - GRID.left,
    maxLines: 2,
    lh: 30,
    anchor: "end",
    edit: "text.label:dye-water",
  });
  const ag = h("g", { s: b.rise, c: ctx.rc("rise", "cut", "pg-past") }, mover);
  line(ctx, ag, cx - 62, 420, cx - 62, 290, "var(--water)", "var(--sw-arrow)", { draw: b.rise });
  textBlock(ag, cx - 86, 350, txt(P, "label:up", "Water travels up the stem"), {
    cls: "ts-label",
    maxW: cx - 86 - GRID.left,
    maxLines: 2,
    lh: 30,
    anchor: "end",
    edit: "text.label:up",
  });
  const hl = T(mover, cx - 86, 280, `${P.hours} hours later`, "ts-label", {
    "text-anchor": "end",
    s: b.top,
    c: ctx.rc("top", "cut", "pg-past"),
  });
  computed(hl, "hours");
  // optional cut across the stem
  if (P.showCut) {
    const sy = 330;
    const src = { x: cx - 40, y: sy, w: 80, h: 44 };
    const box = { x: 720, y: 140, w: 480, h: 420 };
    const z = zoomInset(ctx, root, { src, box, under, a: { s: b.cut, style: "--d:500ms" } });
    textBlock(z.inner, box.x + 22, box.y + 32, txt(P, "label:cut", "Cut across the stem"), {
      cls: "ts-tiny",
      maxW: box.w - 44,
      maxLines: 2,
      lh: 26,
      edit: "text.label:cut",
    });
    const zx = box.x + box.w / 2,
      zy = box.y + 170;
    if (celery) {
      const oy = zy - 20,
        O = [
          [zx - 132, oy],
          [zx - 132, oy + 150],
          [zx + 132, oy + 150],
          [zx + 132, oy],
        ];
      h(
        "path",
        {
          d: `M${zx - 132} ${oy} C ${zx - 132} ${oy + 150} ${zx + 132} ${oy + 150} ${zx + 132} ${oy} Q ${zx + 133} ${oy - 26} ${zx + 106} ${oy - 22} C ${zx + 96} ${oy + 74} ${zx - 96} ${oy + 74} ${zx - 106} ${oy - 22} Q ${zx - 133} ${oy - 26} ${zx - 132} ${oy} Z`,
          fill: "color-mix(in oklab, var(--leaf) 45%, var(--paper))",
          stroke: "var(--leaf)",
          "stroke-width": "var(--sw-struct)",
          "stroke-linejoin": "round",
        },
        z.inner,
      );
      const cub = (t) =>
        [0, 1].map(
          (e) =>
            (1 - t) ** 3 * O[0][e] +
            3 * (1 - t) ** 2 * t * O[1][e] +
            3 * (1 - t) * t * t * O[2][e] +
            t ** 3 * O[3][e],
        );
      for (let i = 0; i < 9; i++) {
        const t = 0.06 + (0.88 * i) / 8;
        const [px, py] = cub(t);
        const dx = zx - px,
          dy = oy - 40 - py,
          D = Math.hypot(dx, dy);
        h("circle", { cx: px + (dx / D) * 17, cy: py + (dy / D) * 17, r: 9, fill: dye }, z.inner);
      }
    } else {
      h(
        "circle",
        {
          cx: zx,
          cy: zy + 30,
          r: 96,
          fill: "color-mix(in oklab, var(--leaf) 45%, var(--paper))",
          stroke: "var(--leaf)",
          "stroke-width": "var(--sw-struct)",
        },
        z.inner,
      );
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5;
        h(
          "circle",
          { cx: zx + Math.cos(a) * 66, cy: zy + 30 + Math.sin(a) * 66, r: 10, fill: dye },
          z.inner,
        );
      }
    }
    textBlock(
      z.inner,
      zx,
      box.y + 350,
      txt(P, "label:tubes", "The coloured dots are tubes that carry water"),
      {
        cls: "ts-small",
        maxW: box.w - 48,
        maxLines: 3,
        lh: 28,
        anchor: "middle",
        edit: "text.label:tubes",
      },
    );
  }
  const set = (f) => {
    const y = lerp(WL, TOP - 40, f);
    clipR.setAttribute("y", y);
    clipR.setAttribute("height", Math.max(0, WL - y));
  };
  const slide = () => mover.setAttribute("transform", `translate(${P.showCut ? 0 : SHIFT} 0)`);
  set(1);
  slide(1);
  return {
    tick(k, u) {
      set(k < b.rise ? 0 : k === b.rise ? eIO(u) : 1);
    },
    still() {
      set(1);
    },
    reset() {
      set(0);
    },
    dur: { rise: 1500 },
  };
}

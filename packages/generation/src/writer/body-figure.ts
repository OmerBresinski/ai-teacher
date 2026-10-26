/**
 * No freehand bodies (TEACH-247 part ad, STICKFIG). The drawer names what a labelled drawing is of
 * (`subject` on the labelled-diagram spec); a `living_body` is never drawn from primitives, which
 * can only make a stick figure (`diagrams.ts` `freehandBan`). On a full slide the stage tries
 * these library models, in order, where the lesson's catalogue has them (a model's fill draws only
 * what it can show); otherwise the figure fails and the fallback ladder places a picture of the
 * same thing (`fallbacks.ts` `asPicture`, every label kept as what the picture must show).
 */
export const BODY_MODELS = ["heart_circulation", "body_map"] as const;

/**
 * TEACH-247 part ay: the drawer's own tag is not enough (it is optional on a non-strict call, and
 * a whole plant came through as `abstract_or_process`). These words, in the writer's ask or the
 * drawer's spec, name an organism or a part of one; a labelled drawing that names one is never
 * drawn from primitives. Matched whole-word, any case, with the plural forms listed or `s`/`es`.
 */
export const LIVING_WORDS = [
  // People
  "person",
  "people",
  "persons",
  "child",
  "children",
  "human",
  "body",
  "bodies",
  "man",
  "men",
  "woman",
  "women",
  "boy",
  "girl",
  "baby",
  "babies",
  "adult",
  "teenager",
  "athlete",
  "soldier",
  "warrior",
  "legionary",
  "knight",
  "pharaoh",
  "king",
  "queen",
  "monk",
  "farmer",
  "pedestrian",
  "portrait",
  "father",
  "mother",
  "brother",
  "sister",
  "grandmother",
  "grandfather",
  "grandparent",
  "parent",
  "family",
  // Body parts and organs
  "face",
  "hand",
  "arm",
  "leg",
  "foot",
  "feet",
  "finger",
  "toe",
  "mouth",
  "nose",
  "ear",
  "eye",
  "tooth",
  "teeth",
  "tongue",
  "skin",
  "hair",
  "brain",
  "heart",
  "lung",
  "kidney",
  "liver",
  "stomach",
  "intestine",
  "gut",
  "muscle",
  "bone",
  "skeleton",
  "skull",
  "rib",
  "artery",
  "arteries",
  "vein",
  "capillary",
  "capillaries",
  "blood vessel",
  "organ",
  "cell",
  "tissue",
  "nerve",
  "neuron",
  "wrist",
  "elbow",
  "knee",
  "shoulder",
  "torso",
  // Animals
  "animal",
  "mammal",
  "bird",
  "fish",
  "insect",
  "reptile",
  "amphibian",
  "frog",
  "tadpole",
  "toad",
  "dog",
  "puppy",
  "puppies",
  "cat",
  "kitten",
  "horse",
  "cow",
  "sheep",
  "pig",
  "bear",
  "monkey",
  "camel",
  "lion",
  "tiger",
  "elephant",
  "whale",
  "dolphin",
  "shark",
  "snake",
  "lizard",
  "spider",
  "bee",
  "butterfly",
  "butterflies",
  "caterpillar",
  "ant",
  "worm",
  "snail",
  "mouse",
  "mice",
  "rabbit",
  "fox",
  "owl",
  "duck",
  "chicken",
  "hen",
  "beak",
  "paw",
  // Plants and other organisms
  "plant",
  "leaf",
  "leaves",
  "flower",
  "petal",
  "root",
  "stem",
  "tree",
  "seed",
  "seedling",
  "shoot",
  "bud",
  "grass",
  "fungus",
  "fungi",
  "mushroom",
  "bacterium",
  "bacteria",
  "organism",
  "chloroplast",
  "stoma",
  "stomata",
] as const;

/**
 * Processes a labelled drawing cannot teach from primitives: the ask goes to a library model, else
 * a picture. Matched as phrases, any case.
 */
export const PROCESS_WORDS = [
  "photosynthesis",
  "respiration",
  "digestion",
  "digestive",
  "circulation",
  "circulatory",
  "breathing",
  "gas exchange",
  "water cycle",
  "carbon cycle",
  "nitrogen cycle",
  "rock cycle",
  "life cycle",
  "food chain",
  "food web",
  "pollination",
  "fertilisation",
  "fertilization",
  "germination",
  "transpiration",
  "reproduction",
  "excretion",
  "metamorphosis",
  "mitosis",
  "meiosis",
  "natural selection",
  "evolution",
  "decomposition",
  "nutrient cycle",
] as const;

/**
 * Non-living uses of a living word, taken out before the match: a maths tree, gear teeth, a
 * circuit's cell, a plant pot, Isle of Man, a chart counting people. Each is a regex source.
 */
export const NOT_LIVING_PHRASES = [
  String.raw`\b(factor|binary|probability|decision|family|syntax|search|phylogenetic|sample space)\s+trees?\b`,
  String.raw`\btree\s+(diagram|structure|graph)s?\b`,
  String.raw`\b(child|parent|root|leaf)\s+nodes?\b`,
  String.raw`\b(gear|cog|saw|comb|zip|zipper)\s+(teeth|tooth)\b`,
  String.raw`\bsaw-?tooth\b`,
  String.raw`\b(teeth|tooth)\s+of\s+(a|the)\s+(gear|cog|saw|comb|zip)\b`,
  String.raw`\b(cell|mobile)\s+phones?\b`,
  String.raw`\b(electrochemical|electrolytic|fuel|solar|voltaic|galvanic|dry|wet|photovoltaic|load)\s+cells?\b`,
  String.raw`\b(table|spreadsheet|grid|storage|prison)\s+cells?\b`,
  String.raw`\b(plant|flower)\s+pots?\b`,
  String.raw`\b(power|nuclear|treatment|chemical|desalination|bottling)\s+plants?\b`,
  String.raw`\bstem[- ]and[- ]leaf\b`,
  String.raw`\b(square|cube|cubed|nth|real|complex|repeated|distinct)\s+roots?\b`,
  String.raw`\broots?\s+of\s+(an?|the)?\s*(equation|quadratic|polynomial|function|cubic)s?\b`,
  String.raw`\b(hand)\s+(lens|lenses|drill|pump|warmer)\b`,
  String.raw`\b(second|minute|hour|clock)\s+hands?\b`,
  String.raw`\bon the other hand\b`,
  String.raw`\b(left|right)[- ]hand(ed)?\b`,
  String.raw`\b(lever|robot|robotic|crane|balance|pivot)\s+arms?\b`,
  String.raw`\barms?\s+of\s+(a|the)\s+(lever|balance|crane|robot|seesaw|see-saw|spiral|galaxy)\b`,
  String.raw`\b(coat of arms|arms race)\b`,
  String.raw`\b(table|chair|tripod|stool)\s+legs?\b`,
  String.raw`\blegs?\s+of\s+(a|the)\s+(right[- ]angled\s+)?(triangle|tripod|table|journey)\b`,
  String.raw`\beyes?\s+of\s+(a|the)\s+(storm|hurricane|cyclone|needle)\b`,
  String.raw`\b(eye[- ]level|eyepiece|naked eye|bull'?s[- ]eye)\b`,
  String.raw`\b(clock|cliff|rock|coal|watch)\s+faces?\b`,
  String.raw`\bfaces?,?\s+(edges?|vert(ex|ices))\b`,
  String.raw`\bfaces?\s+of\s+(a|the)\s+(cube|cuboid|prism|pyramid|shape|solid|cliff|clock)\b`,
  String.raw`\b(bod(y|ies)\s+of\s+water|water\s+bod(y|ies)|free[- ]body|rigid\s+bod(y|ies)|celestial\s+bod(y|ies)|heavenly\s+bod(y|ies)|student\s+body|governing\s+body|car\s+body)\b`,
  String.raw`\bheart\s+of\s+(a|the)\s+(city|town|village|empire|matter)\b`,
  String.raw`\b(isle of man|man-made|manmade|man-power|manpower)\b`,
  String.raw`\bhuman\s+(geography|features?|factors?|activit(y|ies)|impacts?|settlements?|and physical)\b`,
  String.raw`\b(pipe organ|organ pipes?)\b`,
  String.raw`\bgold[- ]leaf\b`,
  String.raw`\b(computer|wireless|optical|usb)\s+(mouse|mice)\b`,
  String.raw`\bmouse\s+(clicks?|buttons?|pointer|cursor|pad|mat|wheel)\b`,
  String.raw`\b\d+(\.\d+)?\s*(feet|foot|ft)\b`,
  String.raw`\b(square|cubic)\s+(feet|foot)\b`,
  String.raw`\bnose[- ]cones?\b`,
  String.raw`\b(cave|bottle|volcano|jar|tunnel|river|estuary|flask|bay)\s+mouths?\b`,
  String.raw`\bmouths?\s+of\s+(an?|the|its)\s+(\w+\s+)?(cave|bottle|volcano|jar|tunnel|river|estuary|flask|bay)s?\b`,
  String.raw`\bhard\s+shoulders?\b`,
  String.raw`\b(egg\s+timer|egg\s+box)\b`,
  // A chart or count of living things is a chart: "bar chart of people by age", "population of fish".
  String.raw`\b(numbers?|population|populations|percentage|proportion|count|survey|chart|graph|table|tally|pictogram)\s+of\s+(\w+\s+){0,2}\w+`,
] as const;

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
const LIVING_RE = new RegExp(String.raw`\b(${LIVING_WORDS.map(esc).join("|")})(s|es)?\b`, "i");
const PROCESS_RE = new RegExp(String.raw`\b(${PROCESS_WORDS.map(esc).join("|")})\b`, "i");
const NOT_LIVING_RE = NOT_LIVING_PHRASES.map((p) => new RegExp(p, "gi"));
/**
 * Words that change sense in context, each dropped when its context is in the text: a circuit's
 * "cell" is a battery, a river's "mouth" is where it meets the sea, a lever's "arm" is a bar, and
 * the people on a family
 * tree are names in boxes (a chart of relations, not drawn bodies).
 */
const IN_CONTEXT: [RegExp, RegExp][] = [
  [
    /\b(circuit|battery|batteries|bulb|switch|ammeter|voltmeter|wire|resistor|voltage)s?\b/i,
    /\bcells?\b/gi,
  ],
  [/\b(rivers?|estuar(y|ies)|tributar(y|ies)|source|sea|confluence|delta)\b/i, /\bmouths?\b/gi],
  [/\b(levers?|pivots?|fulcrum|crane|robot(ic)?|seesaw|see-saw|moments?)\b/i, /\barms?\b/gi],
  [
    /\b(family (tree|map)s?|arbre (familial|g[ée]n[ée]alogique)|stammbaum|[áa]rbol geneal[óo]gico)\b/i,
    /\b(child|children|boy|girl|man|men|woman|women|adult|baby|babies|person|people|(grand)?(father|mother|parent|brother|sister|family)s?)\b/gi,
  ],
];

/** The drawer's subject tags (schema.ts); anything else counts as no tag. */
const SUBJECTS = new Set([
  "living_body",
  "object_or_machine",
  "place_or_map",
  "abstract_or_process",
]);

/** Library models for a blocked ask, by what it names (tried before the body models). */
const ROUTE_MODELS: [RegExp, string][] = [
  [/\b(water cycle|evaporat\w*|condens\w*|precipitation)\b/i, "water_cycle"],
  [/\b(circulat\w*|heart|blood|arter(y|ies)|veins?)\b/i, "heart_circulation"],
  [/\bfood (chain|web)s?\b/i, "food_chain"],
  [/\b(life cycles?|metamorphosis|tadpoles?|caterpillars?)\b/i, "life_cycle"],
  // The KS3 photosynthesis model (part ax) where the lesson's catalogue has it.
  [/\bphotosynthesis\b/i, "photosynthesis"],
  [
    /\b(photosynthesis|plants?|leaf|leaves|roots?|stems?|flowers?|seeds?|germination|pollination|transpiration)\b/i,
    "plant_growth",
  ],
  [/\b(rock cycle|fossils?)\b/i, "rocks_soil_fossils"],
  [/\b(evolution|adaptation|natural selection)\b/i, "evolution_adaptation"],
  [/\b(carbon|nitrogen|nutrient) cycle\b/i, "cycle_wheel"],
];

/** Why a freehand labelled drawing is not drawn, and the library models to try in its place. */
export type FreehandBan = {
  reason: "tagged" | "untagged" | "living-word" | "process";
  /** The word or phrase that matched (living-word, process). */
  word?: string;
  /** Library models to try on a full slide, in order, before a picture. */
  models: string[];
};

/** The text a freehand drawing is judged on: the writer's ask and the drawer's spec, never the slide. */
export function freehandText(ask: { shows?: string; labels?: string[] }, spec?: unknown): string {
  const s = (spec ?? {}) as { alt?: unknown; title?: unknown; labels?: unknown };
  const specLabels = Array.isArray(s.labels)
    ? s.labels.map((l) =>
        typeof l === "string" ? l : String((l as { text?: unknown })?.text ?? ""),
      )
    : [];
  return [ask.shows ?? "", ...(ask.labels ?? []), s.alt, s.title, ...specLabels]
    .filter((x): x is string => typeof x === "string" && !!x)
    .join("\n");
}

/** A living word or process phrase in the text, after the non-living uses are taken out. */
export function livingOrProcessWord(text: string): { word: string; process: boolean } | undefined {
  // "STEM" in capitals is the acronym (science, technology, engineering, maths), not a plant's stem.
  let t = text.replace(/\bSTEMS?\b/g, " ");
  for (const re of NOT_LIVING_RE) t = t.replace(re, " ");
  const p = PROCESS_RE.exec(t);
  if (p) return { word: (p[1] ?? "").toLowerCase(), process: true };
  let living = t;
  for (const [context, word] of IN_CONTEXT)
    if (context.test(text)) living = living.replace(word, " ");
  const m = LIVING_RE.exec(living);
  return m ? { word: (m[1] ?? "").toLowerCase(), process: false } : undefined;
}

/**
 * TEACH-247 part ay: a freehand labelled drawing (the drawer's spec) that may not be drawn from
 * primitives, or undefined when it may. Banned when the drawer tagged it `living_body`, when the
 * tag is missing or not one of the four, when the ask or spec names an organism or a body part,
 * or when the ask is a science process. Other kinds are never banned here.
 */
export function freehandBan(
  ask: { kind?: string; shows?: string; labels?: string[] },
  spec: unknown,
): FreehandBan | undefined {
  const s = spec as { kind?: unknown; subject?: unknown } | undefined;
  if (s?.kind !== "labelled-diagram") return undefined;
  const text = freehandText(ask, spec);
  const hit = livingOrProcessWord(text);
  const routed = ROUTE_MODELS.filter(([re]) => re.test(text)).map(([, id]) => id);
  // A process tries only the models it names; an organism also tries the body models.
  const bodyModels = [...new Set([...routed, ...BODY_MODELS])];
  if (s.subject === "living_body") return { reason: "tagged", models: bodyModels };
  if (typeof s.subject !== "string" || !SUBJECTS.has(s.subject))
    return {
      reason: "untagged",
      ...(hit ? { word: hit.word } : {}),
      models: hit && !hit.process ? bodyModels : routed,
    };
  if (!hit) return undefined;
  return hit.process
    ? { reason: "process", word: hit.word, models: routed }
    : { reason: "living-word", word: hit.word, models: bodyModels };
}

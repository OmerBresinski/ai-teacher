import type { CatalogueEntry } from "../library/catalogue";
import type { Brief } from "./fixes";
import type { WriterStage } from "./schema";
import { nonFatalSync } from "./services";

/*
 * The writer prompt's A/B options (WRITER-FIX-PLAN, "trim the writer's menus" and "A/B arms"), all
 * off by default so production sends the pinned text unchanged until a test decides:
 *  - trimMenus: the theme, diagram-kind and model menus (and their schema enums) keep only the
 *    rows that can apply to the lesson's year and subject family; unsure keeps everything;
 *  - cacheOrder: the system text's invariant parts first, the lesson-specific menus and examples
 *    last, so a cached prefix is shared across lessons;
 *  - examples: the "Example slides from other lessons" block as pinned (`all`), removed (`none`),
 *    or 2-3 chosen by code (`matched`).
 * Code only drops and reorders the pinned lines; no prompt word changes.
 */

type J = Record<string, unknown>;

export type WriterPromptOptions = {
  trimMenus?: boolean;
  cacheOrder?: boolean;
  examples?: "all" | "none" | "matched";
};
export const PROMPT_OPTIONS_OFF: Required<WriterPromptOptions> = {
  trimMenus: false,
  cacheOrder: false,
  examples: "all",
};

/** True when every option is at its default (the pinned text goes out byte for byte). */
export const optionsOff = (o?: WriterPromptOptions) =>
  !o?.trimMenus && !o?.cacheOrder && (o?.examples ?? "all") === "all";

/** A short tag for the run record: "off", or e.g. "trim+cache+ex-matched". */
export function promptOptionsTag(o?: WriterPromptOptions): string {
  if (optionsOff(o)) return "off";
  return [
    o?.trimMenus ? "trim" : "",
    o?.cacheOrder ? "cache" : "",
    (o?.examples ?? "all") !== "all" ? `ex-${o?.examples}` : "",
  ]
    .filter(Boolean)
    .join("+");
}

/* ------------------------------------------------------------------ */
/* The lesson's year and subject family                               */
/* ------------------------------------------------------------------ */

const tokenOf = (n: number) => (n <= 6 ? `Y${n}` : n <= 9 ? "KS3" : n <= 11 ? "KS4" : "KS5");

/**
 * The library's year tokens for a year group (Reception, Y1-Y6, KS3, KS4, KS5). A mixed class
 * ("Year 1/2", "Reception/Year 1", "Years 5 and 6", "Y3-4") is the union of its years; a range
 * ("Years 3 to 6") fills in between. [] when no year can be read (keep everything).
 */
export function yearTokens(yearGroup: string): string[] {
  const out = new Set<string>();
  if (/\breception\b|\bYR\b|\bEYFS\b/i.test(yearGroup)) out.add("Reception");
  if (/\b(?:years?|yrs?|y)\s*\d/i.test(yearGroup)) {
    const nums = [...yearGroup.matchAll(/\d{1,2}/g)].map((m) => Number(m[0]));
    const ranges = [
      ...yearGroup.matchAll(/(\d{1,2})\s*(?:-|–|to)\s*(?:years?\s*|y\s*)?(\d{1,2})/gi),
    ];
    for (const r of ranges) for (let n = Number(r[1]); n <= Number(r[2]); n++) nums.push(n);
    for (const n of nums) if (n >= 1 && n <= 13) out.add(tokenOf(n));
  }
  return ALL_YEARS.filter((y) => out.has(y));
}

/** The single token of a one-year group (the first of a mixed one); undefined when unread. */
export const yearToken = (yearGroup: string): string | undefined => yearTokens(yearGroup)[0];

export type Family =
  | "maths"
  | "science"
  | "geography"
  | "history"
  | "computing"
  | "music"
  | "art"
  | "pe"
  | "pshe"
  | "cross";

/** Word-bounded; the short acronyms (PE, RE) match in capitals only. */
const FAMILY_RE: [Family, RegExp][] = [
  ["maths", /\b(maths?|mathematics|numeracy|arithmetic)\b/i],
  ["science", /\b(science|biology|chemistry|physics)\b/i],
  ["geography", /\bgeography\b/i],
  ["history", /\bhistory\b/i],
  ["computing", /\b(computing|computer science)\b|\bICT\b/i],
  ["music", /\bmusic\b/i],
  ["art", /\b(art|design)\b/i],
  ["pe", /\bphysical education\b|\bPE\b/],
  ["pshe", /\b(pshe|rse|citizenship|religious)\b|\bRE\b/i],
  [
    "cross",
    /\b(english|french|spanish|german|languages?|mfl|psychology|sociology|economics|business|drama)\b/i,
  ],
];

/** The subject's family, or undefined when no family or more than one matches (keep everything). */
export function subjectFamily(subject: string): Family | undefined {
  const hits = FAMILY_RE.filter(([, re]) => re.test(subject)).map(([f]) => f);
  return hits.length === 1 ? hits[0] : undefined;
}

/** Kinds and models every subject keeps. */
const CROSS_KINDS = [
  "line-graph",
  "bar-chart",
  "pie",
  "table",
  "flow",
  "cycle",
  "timeline",
  "layers",
  "venn",
  "carroll",
  "labelled-diagram",
];
const CROSS_MODELS = ["timeline", "data_chart", "sort_venn_carroll", "cycle_wheel"];

/** Subject-specific kinds and models per family (the plan's table). */
export const FAMILY_MENUS: Record<Family, { kinds: string[]; models: string[] }> = {
  maths: {
    kinds: ["bar-model", "number-line", "equal-groups", "fraction-shapes"],
    models: [
      "counting_subitising",
      "number_bonds",
      "number_line",
      "place_value",
      "column_methods",
      "equal_groups",
      "balance_equations",
      "sequences_patterns",
      "fractions",
      "bar_model",
      "measuring_scales",
      "clock_time",
      "coins_money",
      "area_perimeter",
      "shape_2d",
      "shape_3d_nets",
      "angles_turns",
      "coordinate_grid",
    ],
  },
  science: {
    kinds: ["particles", "cubes"],
    models: [
      "life_cycle",
      "plant_growth",
      "food_chain",
      "body_map",
      "heart_circulation",
      "classify_key",
      "evolution_adaptation",
      "microhabitat_survey",
      "materials_test",
      "mixtures_separating",
      "collision_theory",
      "light_shadows",
      "sound_vibration",
      "circuits",
      "forces_magnets",
      "rocks_soil_fossils",
      "water_cycle",
      "earth_sun_moon",
      "seasons_weather",
      "volcano_earthquake",
      "measuring_scales",
    ],
  },
  geography: {
    kinds: ["hydrograph", "river"],
    models: [
      "seasons_weather",
      "volcano_earthquake",
      "rivers_coasts",
      "climate_biomes",
      "map_skills",
      "place_change",
      "water_cycle",
      "coordinate_grid",
      "hist_map",
    ],
  },
  history: { kinds: [], models: ["hist_map", "place_change"] },
  computing: { kinds: [], models: ["algorithm_grid", "coordinate_grid"] },
  music: { kinds: [], models: ["rhythm_grid"] },
  art: { kinds: [], models: ["colour_mixing"] },
  pe: { kinds: [], models: ["movement_court"] },
  pshe: { kinds: [], models: ["community_helpers", "body_map"] },
  cross: { kinds: [], models: [] },
};

/** Theme ids by the years they suit (a table in code; the theme lines keep their wording). */
const ALL_YEARS = ["Reception", "Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "KS3", "KS4", "KS5"];
const span = (from: string, to: string) =>
  ALL_YEARS.slice(ALL_YEARS.indexOf(from), ALL_YEARS.indexOf(to) + 1);
export const THEME_YEARS: Record<string, string[]> = {
  playground: span("Reception", "Y2"),
  crayon: span("Y1", "Y4"),
  splash: span("Reception", "Y6"),
  treehouse: span("Y3", "Y6"),
  chalk: ALL_YEARS,
  "reading-room": span("KS3", "KS5"),
  studio: span("KS3", "KS5"),
  "exam-hall": span("KS4", "KS5"),
};

/** What a lesson can use: undefined fields keep everything. */
export type Lens = { years?: string[]; family?: Family };
export const lensOf = (b: Pick<Brief, "yearGroup" | "subject">): Lens => {
  const years = yearTokens(b.yearGroup);
  const family = subjectFamily(b.subject);
  return { ...(years.length ? { years } : {}), ...(family ? { family } : {}) };
};

/** Every diagram kind the menus know (a value outside it, such as a look's "picture", is kept). */
const ALL_KINDS = new Set([...CROSS_KINDS, ...Object.values(FAMILY_MENUS).flatMap((f) => f.kinds)]);
export const keepKind = (kind: string, l: Lens) =>
  !l.family ||
  !ALL_KINDS.has(kind) ||
  CROSS_KINDS.includes(kind) ||
  FAMILY_MENUS[l.family].kinds.includes(kind);
export const keepTheme = (id: string, l: Lens) =>
  !l.years || !THEME_YEARS[id] || l.years.some((y) => (THEME_YEARS[id] as string[]).includes(y));
/** A catalogue entry for this lesson: its years include the lesson's, and its family is the lesson's or cross. */
export const keepModel = (e: CatalogueEntry, l: Lens) =>
  (!l.years || l.years.some((y) => e.years.includes(y))) &&
  (!l.family || CROSS_MODELS.includes(e.id) || FAMILY_MENUS[l.family].models.includes(e.id));

/** The catalogue for the lesson: everything unless trimMenus. */
export function trimModels(
  entries: CatalogueEntry[],
  b: Pick<Brief, "yearGroup" | "subject">,
  o?: WriterPromptOptions,
): CatalogueEntry[] {
  if (!o?.trimMenus) return entries;
  const l = lensOf(b);
  return entries.filter((e) => keepModel(e, l));
}

/* ------------------------------------------------------------------ */
/* The system text                                                     */
/* ------------------------------------------------------------------ */

const lineId = (line: string) => /^- ([a-z][a-z-]*):/.exec(line)?.[1];

/** The block (blank-line separated) whose first line starts with `head`. */
const isBlock = (head: string) => (b: string) => b.startsWith(head);
const THEMES = isBlock("Themes:");
const PICTURE_STYLE = isBlock("Picture style");
const LAYOUTS = isBlock("Layouts.");
const ACTIVITIES = isBlock("Activity layouts.");
const PICTURES = isBlock("Pictures and diagrams:");
const KINDS = isBlock("Diagram kinds:");
const MODELS = isBlock("Models (");
const EXAMPLES = isBlock("Example slides from other lessons");

/** A menu block with only the rows `keep` accepts (lines that are not rows always stay). */
const keepRows = (block: string, keep: (id: string) => boolean) =>
  block
    .split("\n")
    .filter((line) => {
      const id = lineId(line);
      return !id || id === "model" || keep(id);
    })
    .join("\n");

/** The "Diagram kinds:" block as the repair reads it, trimmed to the lesson. */
export function trimKindsBlock(
  block: string,
  b: Pick<Brief, "yearGroup" | "subject">,
  o?: WriterPromptOptions,
): string {
  if (!o?.trimMenus) return block;
  const l = lensOf(b);
  return keepRows(block, (id) => keepKind(id, l));
}

/* Examples ----------------------------------------------------------- */

/**
 * The pinned examples (the same seven at every stage), described for matching: the writer stages
 * each suits, its family, whether it is led by a picture, and its topic words.
 */
export const EXAMPLE_META: Record<
  string,
  { stages: WriterStage[]; family: Family; picture: boolean; topic: string[] }
> = {
  "A bean grows": {
    stages: ["KS1", "KS2"],
    family: "science",
    picture: true,
    topic: ["bean", "seed", "shoot", "seedling", "plant", "grow", "germinate"],
  },
  "The Crystal Palace, 1851": {
    stages: ["KS2", "KS3-5"],
    family: "history",
    picture: true,
    topic: ["crystal", "palace", "exhibition", "victorian", "1851"],
  },
  "Which keeps you dry?": {
    stages: ["KS1", "KS2"],
    family: "science",
    picture: true,
    topic: ["waterproof", "material", "plastic", "cotton", "absorb", "dry"],
  },
  "Float or sink?": {
    stages: ["KS1", "KS2"],
    family: "science",
    picture: true,
    topic: ["float", "sink", "floating", "sinking"],
  },
  "Round 4,738 to the nearest hundred": {
    stages: ["KS2"],
    family: "maths",
    picture: false,
    topic: ["round", "rounding", "hundred", "place", "value"],
  },
  "Acceleration from a graph": {
    stages: ["KS3-5"],
    family: "science",
    picture: false,
    topic: ["acceleration", "velocity", "motion", "graph"],
  },
  "Work out the speed": {
    stages: ["KS3-5"],
    family: "science",
    picture: false,
    topic: ["speed", "distance", "time", "motion"],
  },
};

const words = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
      .flatMap((w) => [w, w.replace(/(ing|es|s)$/, "")]),
  );

/** Whether an example shares a topic word with the lesson's topic (it could leak into the deck). */
export function topicOverlap(topic: string, heading: string): boolean {
  const meta = EXAMPLE_META[heading];
  const own = words([heading, ...(meta?.topic ?? [])].join(" "));
  const lesson = words(topic);
  return [...lesson].some((w) => w.length >= 4 && own.has(w));
}

/**
 * The examples a lesson sees under `matched`: no topic-word overlap; at least 2 led by a picture
 * (the same stage and family first, then the same stage, then the same family, then any), then
 * up to 3 in all from the same stage and family. Kept in the pinned order.
 */
export function matchedExamples(
  headings: string[],
  b: Pick<Brief, "topic" | "subject">,
  stage: WriterStage,
): string[] {
  const fam = subjectFamily(b.subject);
  const famOk = (h: string) => !fam || fam === "cross" || EXAMPLE_META[h]?.family === fam;
  const stageOk = (h: string) => !!EXAMPLE_META[h]?.stages.includes(stage);
  const ok = headings.filter((h) => EXAMPLE_META[h] && !topicOverlap(b.topic, h));
  const tiers = [(h: string) => stageOk(h) && famOk(h), stageOk, famOk, () => true];
  const picked: string[] = [];
  for (const t of tiers)
    for (const h of ok)
      if (picked.length < 2 && EXAMPLE_META[h]?.picture && t(h) && !picked.includes(h))
        picked.push(h);
  for (const h of ok)
    if (picked.length < 3 && (tiers[0] as (h: string) => boolean)(h) && !picked.includes(h))
      picked.push(h);
  return headings.filter((h) => picked.includes(h));
}

const headingOf = (line: string) =>
  nonFatalSync(
    () => String((JSON.parse(line) as { heading?: unknown }).heading ?? ""),
    () => "",
  );

/** The examples block for the option (undefined: no block). */
function examplesBlock(
  block: string,
  b: Pick<Brief, "topic" | "subject">,
  stage: WriterStage,
  mode: WriterPromptOptions["examples"],
): string | undefined {
  if (mode === "none") return undefined;
  if (mode !== "matched") return block;
  const [head, ...lines] = block.split("\n");
  const rows = lines.filter(Boolean);
  const keep = new Set(matchedExamples(rows.map(headingOf), b, stage));
  const kept = rows.filter((l) => keep.has(headingOf(l)));
  return kept.length ? [head, ...kept].join("\n") : undefined;
}

/* The whole text ----------------------------------------------------- */

/**
 * The writer's system text under the options. Off: the text as given, byte for byte. The text is
 * read as blank-line separated blocks; trimming drops menu rows, `examples` drops or filters the
 * example block, and `cacheOrder` reorders blocks: the rules, the picture style, the pictures
 * and diagrams rules and the activity paragraph (the same for every lesson), the stage's layouts
 * and activity rows, then the lesson's themes, diagram kinds (with the model line), models and
 * examples.
 */
export function shapeSystem(
  system: string,
  b: Pick<Brief, "topic" | "subject" | "yearGroup">,
  stage: WriterStage,
  o?: WriterPromptOptions,
): string {
  if (optionsOff(o)) return system;
  const trailing = /\n*$/.exec(system)?.[0] ?? "";
  let blocks = system.slice(0, system.length - trailing.length).split("\n\n");
  const l = lensOf(b);
  if (o?.trimMenus)
    blocks = blocks.map((x) =>
      THEMES(x)
        ? keepRows(x, (id) => keepTheme(id, l))
        : KINDS(x)
          ? keepRows(x, (id) => keepKind(id, l))
          : x,
    );
  blocks = blocks.flatMap((x) => {
    if (!EXAMPLES(x)) return [x];
    const e = examplesBlock(x, b, stage, o?.examples);
    return e ? [e] : [];
  });
  if (o?.cacheOrder) blocks = cacheOrdered(blocks);
  return blocks.join("\n\n") + trailing;
}

function cacheOrdered(blocks: string[]): string[] {
  const take = (f: (b: string) => boolean) => blocks.filter(f);
  const named = [THEMES, PICTURE_STYLE, LAYOUTS, ACTIVITIES, PICTURES, KINDS, MODELS, EXAMPLES];
  const rules = blocks.filter((x) => !named.some((f) => f(x)));
  // The activity paragraph is the same at every stage; its rows carry the stage's Fits. The
  // model menu line stays at the end of the kinds list: it exists only when the lesson has models,
  // and it reads "a kind above".
  const act = take(ACTIVITIES)[0]?.split("\n") ?? [];
  const actHead = act.filter((x) => !lineId(x)).join("\n");
  const actRows = act.filter((x) => !!lineId(x)).join("\n");
  return [
    ...rules,
    ...take(PICTURE_STYLE),
    ...take(PICTURES),
    ...(actHead ? [actHead] : []),
    ...take(LAYOUTS),
    ...(actRows ? [actRows] : []),
    ...take(THEMES),
    ...take(KINDS),
    ...take(MODELS),
    ...take(EXAMPLES),
  ];
}

/* The schema --------------------------------------------------------- */

/**
 * The writer schema with the theme enum and the diagram kinds trimmed to the lesson (trimMenus):
 * a dropped kind's `dg-<kind>-<slot>` defs leave every anyOf and the defs, and any `kind` enum
 * loses it. The model enum is trimmed upstream (the catalogue `trimModels` keeps).
 */
export function shapeSchema(
  schema: J,
  b: Pick<Brief, "yearGroup" | "subject">,
  o?: WriterPromptOptions,
): J {
  if (!o?.trimMenus) return schema;
  const l = lensOf(b);
  const s = JSON.parse(JSON.stringify(schema)) as J;
  const defs = (s.$defs ?? {}) as Record<string, J>;
  const kindOfDef = (name: string) => /^dg-(.+)-(side|full)$/.exec(name)?.[1];
  const dropped = new Set(
    Object.keys(defs)
      .map(kindOfDef)
      .filter((k): k is string => !!k && k !== "model" && !keepKind(k, l)),
  );
  const refDropped = (x: unknown) => {
    const r = (x as J | null)?.$ref;
    const k = typeof r === "string" ? kindOfDef(r.replace("#/$defs/", "")) : undefined;
    return !!k && dropped.has(k);
  };
  const walk = (x: unknown, key?: string): void => {
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    if (!x || typeof x !== "object") return;
    const o2 = x as J;
    if (Array.isArray(o2.anyOf)) o2.anyOf = o2.anyOf.filter((y) => !refDropped(y));
    if (key === "kind" && Array.isArray(o2.enum))
      o2.enum = o2.enum.filter((k) => !(typeof k === "string" && !keepKind(k, l)));
    if (key === "theme" && Array.isArray(o2.enum))
      o2.enum = o2.enum.filter((t) => !(typeof t === "string" && !keepTheme(t, l)));
    for (const [k, v] of Object.entries(o2)) walk(v, k);
  };
  walk(s);
  for (const name of Object.keys(defs)) {
    const k = kindOfDef(name);
    if (k && dropped.has(k)) delete defs[name];
  }
  return s;
}

/**
 * Panel list capacity (TEACH-75 part v, ruling 215): the published character limits, measured by
 * the renderer, never guessed or copied from the pilot. For each age (early KS1, primary KS2,
 * secondary KS3) and row count (2-6), each field gets a `cap` (the longest text that stays
 * comfortable, the writer's limit) and a `hardMax` (the longest that still fits at the floors; past
 * it the field is named in `over`), on every theme. Measured as the pilot's `caps.mjs` does: with
 * icons and a pie; each list field is the smaller of two runs, every row long and one row long
 * beside short siblings; `withLead` holds the row caps beside a one-line lead. A cap of 0 means
 * that count is never comfortable even beside short siblings: a field that gives 0 beside the
 * stand-in rows is re-measured beside `TINY` ones, so a 0 left in the table means the count itself
 * does not hold there (six rows at early and primary), never that a stand-in overflowed. `pictures` is the same table measured with a 4:3 photo on every
 * row (Greg's D1 pick, 14 Oct): the panel then narrows and each row's words sit beside a tile. Regenerate: `bun packages/slides/src/templates/panel-list-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import type { Theme } from "@tj/domain/documents";
import { THEMES } from "../themes";
import type { Stage, TemplateInput } from "./index";
import { type Cap, type PanelCaps, type PanelRow, panelListFits } from "./panel-list";
import type { AgeKey } from "./panel-list-deps";

export const PANEL_AGES: Record<AgeKey, Stage> = { early: "ks1", primary: "ks2", secondary: "ks3" };
const HEADING = "Food groups";
/** The one-line lead every `withLead` cell is measured beside. */
export const PANEL_FIT_LEAD = "Eat a little of each.";
const SHORT: PanelRow[] = [
  { name: "Fruit", text: "Gives us vitamins.", icon: "apple" },
  { name: "Fish", text: "Builds strong muscles.", icon: "fish" },
  { name: "Water", text: "Keeps us cool.", icon: "water" },
  { name: "Leaves", text: "Give us fibre.", icon: "leaf" },
  { name: "Sun", text: "Gives vitamin D.", icon: "sun" },
  { name: "Heart", text: "Pumps the blood.", icon: "heart" },
];
/**
 * The siblings a field is re-measured beside when `SHORT`'s gave 0 (TEACH-68 part b): at five or
 * six rows a 20-character sibling line is already over its own limit, so its overflow sank every
 * field to 0 although short rows fit. Each sibling here is within any limit the cell has.
 */
const TINY: PanelRow[] = [
  { name: "Fruit", text: "Vitamins.", icon: "apple" },
  { name: "Fish", text: "Muscles.", icon: "fish" },
  { name: "Water", text: "Cools us.", icon: "water" },
  { name: "Leaf", text: "Fibre.", icon: "leaf" },
  { name: "Sun", text: "Vitamin D.", icon: "sun" },
  { name: "Heart", text: "Pumps.", icon: "heart" },
];

/**
 * Measuring text: classroom sentences at about 5.6 characters a word with the space (the writers'
 * mean, CAPS-AUDIT), so a cap in characters and its `words` agree with real writing.
 */
const PASSAGE =
  "Plants need light and water to grow strong roots and green leaves. The heart pumps blood through arteries to every part of the body. Volcanoes erupt when melted rock rises through cracks in the crust. Ancient Egyptians preserved bodies so the spirit could live forever. Animals change as they grow from babies into adults.";

/** About `n` characters of the passage from word `seed`, cut at a word, capitalised. */
export function panelSample(n: number, seed = 0): string {
  const words = PASSAGE.split(" ");
  const rot = [...words.slice(seed % words.length), ...words.slice(0, seed % words.length)];
  let out = "";
  for (const w of [...rot, ...rot, ...rot]) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > n) break;
    out = next;
  }
  const s = out || "Word";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const sample = panelSample;
const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The row picture every `pictures` cell is measured with: a landscape photo, no subjects. */
const ROW_PICTURE = { photo: "https://x.test/row.jpg", aspect: 4 / 3, alt: "" } as const;
let withPictures = false;
const inputOf = (rows: PanelRow[], heading = HEADING, lead?: string): TemplateInput => ({
  template: "panel-list",
  heading,
  rows: withPictures ? rows.map((r) => ({ ...r, icon: null, picture: ROW_PICTURE })) : rows,
  ...(lead ? { lead } : {}),
  panel: withPictures ? null : { shares: rows.map((_, i) => rows.length - i) },
});

/** The longest `chars` (step 1) for which `ok` holds, by binary search on [0, max]. */
function longest(ok: (chars: number) => boolean, max = 420): number {
  if (!ok(1)) return 0;
  let lo = 1;
  let hi = max;
  if (ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * A field's cap and hard maximum. `seed` is the sample the field was filled from: the limit
 * published is that sample's real length at the longest passing budget (a sample is cut at a
 * word, so a budget of 41 may hold a 37-character text).
 */
function capOf(
  themes: readonly Theme[],
  stage: Stage,
  make: (chars: number) => TemplateInput,
  seed: number,
): Cap {
  const len = (ch: number) => (ch ? sample(ch, seed).length : 0);
  const cap = longest((ch) => panelListFits(make(ch), themes, stage).comfortable);
  return {
    cap: len(cap),
    hardMax: len(longest((ch) => panelListFits(make(ch), themes, stage).fits)),
    words: cap ? wordsIn(sample(cap, seed)) : 0,
  };
}
const minCap = (a: Cap, b: Cap): Cap => ({
  cap: Math.min(a.cap, b.cap),
  hardMax: Math.min(a.hardMax, b.hardMax),
  words: Math.min(a.words ?? 0, b.words ?? 0),
});

/** A list field's limit: every row long, and row 0 long beside short siblings, the smaller. */
function rowCap(
  themes: readonly Theme[],
  stage: Stage,
  n: number,
  field: "name" | "text",
  lead?: string,
  siblings: PanelRow[] = SHORT,
): Cap {
  const base = siblings.slice(0, n);
  const allLong = (ch: number) =>
    inputOf(
      base.map((r, i) => ({ ...r, [field]: sample(ch, i * 3) })),
      HEADING,
      lead,
    );
  const oneLong = (ch: number) =>
    inputOf(
      base.map((r, i) => (i ? r : { ...r, [field]: sample(ch, 0) })),
      HEADING,
      lead,
    );
  return minCap(capOf(themes, stage, allLong, 0), capOf(themes, stage, oneLong, 0));
}

export function measurePanelCaps(
  age: AgeKey,
  n: number,
  themes: readonly Theme[] = THEMES,
): PanelCaps {
  withPictures = false;
  const plain = measureCells(age, n, themes);
  withPictures = true;
  try {
    return { ...plain, pictures: measureCells(age, n, themes) };
  } finally {
    withPictures = false;
  }
}

type Cells = Omit<PanelCaps, "pictures">;
/** Each 0 in `a` (a cap or a hard maximum) taken from `b`, its words with it. */
function fillZeros(a: Cells, b: () => Cells): Cells {
  const zero = (c: Cap) => c.cap === 0 || c.hardMax === 0;
  if (![a.heading, a.lead, a.name, a.text, a.withLead.name, a.withLead.text].some(zero)) return a;
  const f = b();
  const pick = (x: Cap, y: Cap): Cap => ({
    cap: x.cap || y.cap,
    hardMax: x.hardMax || y.hardMax,
    words: x.cap ? x.words : y.words,
  });
  return {
    heading: pick(a.heading, f.heading),
    lead: pick(a.lead, f.lead),
    name: pick(a.name, f.name),
    text: pick(a.text, f.text),
    withLead: {
      name: pick(a.withLead.name, f.withLead.name),
      text: pick(a.withLead.text, f.withLead.text),
    },
  };
}

/** A cell beside `SHORT` siblings; a field that gave 0 there is re-measured beside `TINY`'s. */
function measureCells(age: AgeKey, n: number, themes: readonly Theme[]): Cells {
  return fillZeros(measureBeside(age, n, themes, SHORT), () => measureBeside(age, n, themes, TINY));
}

function measureBeside(
  age: AgeKey,
  n: number,
  themes: readonly Theme[],
  siblings: PanelRow[],
): Cells {
  const stage = PANEL_AGES[age];
  const rows = siblings.slice(0, n);
  return {
    heading: capOf(themes, stage, (ch) => inputOf(rows, sample(ch, 2)), 2),
    lead: capOf(themes, stage, (ch) => inputOf(rows, HEADING, sample(ch, 5)), 5),
    name: rowCap(themes, stage, n, "name", undefined, siblings),
    text: rowCap(themes, stage, n, "text", undefined, siblings),
    withLead: {
      name: rowCap(themes, stage, n, "name", PANEL_FIT_LEAD, siblings),
      text: rowCap(themes, stage, n, "text", PANEL_FIT_LEAD, siblings),
    },
  };
}

if (import.meta.main) {
  const table = Object.fromEntries(
    (Object.keys(PANEL_AGES) as AgeKey[]).map((age) => [
      age,
      Object.fromEntries([2, 3, 4, 5, 6].map((n) => [String(n), measurePanelCaps(age, n)])),
    ]),
  );
  writeFileSync(
    new URL("./panel-list-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}

/**
 * Panel list capacity (TEACH-75 part v, ruling 215): the published character limits, measured by
 * the renderer, never guessed or copied from the pilot. For each age (early KS1, primary KS2,
 * secondary KS3) and row count (2-6), each field gets a `cap` (the longest text that stays
 * comfortable, the writer's limit) and a `hardMax` (the longest that still fits at the floors; past
 * it the field is named in `over`), on every theme. Measured as the pilot's `caps.mjs` does: with
 * icons and a pie; each list field is the smaller of two runs, every row long and one row long
 * beside short siblings; `withLead` holds the row caps beside a one-line lead. A cap of 0 means
 * that count is never comfortable. Regenerate: `bun packages/slides/src/templates/panel-list-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import type { Theme } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { sample } from "./capacity";
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

const inputOf = (rows: PanelRow[], heading = HEADING, lead?: string): TemplateInput => ({
  template: "panel-list",
  heading,
  rows,
  ...(lead ? { lead } : {}),
  panel: { shares: rows.map((_, i) => rows.length - i) },
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
  return {
    cap: len(longest((ch) => panelListFits(make(ch), themes, stage).comfortable)),
    hardMax: len(longest((ch) => panelListFits(make(ch), themes, stage).fits)),
  };
}
const minCap = (a: Cap, b: Cap): Cap => ({
  cap: Math.min(a.cap, b.cap),
  hardMax: Math.min(a.hardMax, b.hardMax),
});

/** A list field's limit: every row long, and row 0 long beside short siblings, the smaller. */
function rowCap(
  themes: readonly Theme[],
  stage: Stage,
  n: number,
  field: "name" | "text",
  lead?: string,
): Cap {
  const base = SHORT.slice(0, n);
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
  const stage = PANEL_AGES[age];
  const rows = SHORT.slice(0, n);
  return {
    heading: capOf(themes, stage, (ch) => inputOf(rows, sample(ch, 2)), 2),
    lead: capOf(themes, stage, (ch) => inputOf(rows, HEADING, sample(ch, 5)), 5),
    name: rowCap(themes, stage, n, "name"),
    text: rowCap(themes, stage, n, "text"),
    withLead: {
      name: rowCap(themes, stage, n, "name", PANEL_FIT_LEAD),
      text: rowCap(themes, stage, n, "text", PANEL_FIT_LEAD),
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

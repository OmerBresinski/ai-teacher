import CAPACITY from "@tj/slides/templates/items-row-capacity.json" with { type: "json" };
import type { WriterStage } from "./schema";

/*
 * The items row's fit (TEACH-75 part u), from the renderer's measured table
 * (`items-row-capacity.json`), never hand-copied: per item count, the most characters an item's
 * line and name hold while the slide stays comfortable, with icons (the smaller budget) and no
 * lead. It feeds the fit table (`fitTable`, so `charsOver` repairs an overflowing row) and the
 * strict schema's caps. The writer offers 2-4 items: 5-6 are never comfortable (cap 0).
 */
type Cap = { cap: number; hardMax: number };
type Cell = {
  items: number;
  icons: boolean;
  withLead: boolean;
  name: Cap;
  text: Cap;
  lead: Cap;
  heading: Cap;
};
/** The writer's stage groups read the age profiles (ruling 212). */
const AGE: Record<string, string> = { KS1: "early", KS2: "primary", "KS3-5": "secondary" };
/** Most items the writer offers: the comfortable maximum. */
export const ITEMS_ROW_MAX = 4;

const cells = (stage: string, lead = false): Cell[] =>
  ((CAPACITY as unknown as Record<string, Cell[]>)[AGE[stage] ?? ""] ?? []).filter(
    (c) => c.icons && c.withLead === lead && c.items <= ITEMS_ROW_MAX && c.text.cap > 0,
  );

/** The row's layout entry in the fit table at a stage group. */
export function rowFit(stage: string) {
  return {
    fields: ["item text"],
    variants: cells(stage).map((c) => ({
      label: `${c.items} items`,
      counts: { items: c.items },
      figure: false,
      keyCards: false,
      chars: c.text.cap,
      ceiling: c.text.cap,
      columnLabel: c.name.cap,
      limit: {
        item: c.text.cap,
        total: (c.text.cap + c.name.cap) * c.items,
        shown: (c.text.cap + c.name.cap) * c.items,
      },
    })),
  };
}

/** The schema's caps: the longest line, name and lead any count allows (each count's own is the fit table's). */
export function rowCaps(stage: WriterStage): { text: number; name: number; lead: number } {
  const c = cells(stage);
  const l = cells(stage, true);
  return {
    text: Math.max(1, ...c.map((x) => x.text.cap)),
    name: Math.max(1, ...c.map((x) => x.name.cap)),
    lead: Math.max(1, ...l.map((x) => x.lead.cap)),
  };
}

/**
 * Characters per word when a cap becomes the words the writer is shown: slot-fill's
 * `CHARS_PER_WORD` (8, the 95th percentile, so a field written to its word budget fits its cap).
 * Held here because slot-fill reaches this module through fixes.ts; items-row.test.ts pins the two
 * equal.
 */
export const ROW_CHARS_PER_WORD = 8;
const words = (chars: number) => Math.max(1, Math.floor(chars / ROW_CHARS_PER_WORD));

/** "2 to 3 items each 8; 4 each 7": counts in a run with the same budget share one clause. */
function eachClause(budgets: [number, number][]): string {
  const runs: { from: number; to: number; w: number }[] = [];
  for (const [n, w] of budgets) {
    const last = runs.at(-1);
    if (last && last.w === w && last.to === n - 1) last.to = n;
    else runs.push({ from: n, to: n, w });
  }
  return runs
    .map(
      (r, i) =>
        `${r.from === r.to ? r.from : `${r.from} to ${r.to}`}${i ? "" : " items"} each ${r.w}`,
    )
    .join("; ");
}

/**
 * The menu's Fits, generated from the same measured cells as the fit table and the schema
 * (`cells`), never hand-typed: each count's item line in words; a lead clause only for the counts
 * that still hold a lead (none at KS1, whose schema allows no lead); and, at KS3-5 (where the
 * pilot's menu set one), the heading the row holds at every count.
 */
export function rowMenuFits(stage: WriterStage): string {
  const plain = cells(stage);
  const parts: string[] = [];
  if (stage === "KS3-5")
    parts.push(`heading up to ${words(Math.min(...plain.map((c) => c.heading.cap)))} words`);
  parts.push(eachClause(plain.map((c) => [c.items, words(c.text.cap)])));
  const led = cells(stage, true).filter((c) => c.lead.cap > 0);
  if (led.length)
    parts.push(
      `with a lead of up to ${words(Math.min(...led.map((c) => c.lead.cap)))} words: ${eachClause(led.map((c) => [c.items, words(c.text.cap)]))}`,
    );
  else parts.push("lead is null");
  const leadless = plain.filter((c) => !led.some((l) => l.items === c.items)).map((c) => c.items);
  if (led.length && leadless.length) parts.push(`${leadless.join(" or ")} items take no lead`);
  return `Fits: ${parts.join("; ")}.`;
}

/**
 * The writer's menu line for the items row, per stage: the pilot's `writer/MENU-v3.md` wording,
 * its Fits generated from the measured table (`rowMenuFits`). Not wired into any bundle's system
 * text yet.
 */
// writer-prompt: owned by TEACH-110 s
const ROW_MENU_WORDS = {
  // writer-prompt: owned by TEACH-110 s
  KS1: "- items-row: 2 to 4 named parts that work together, or the named stages of one short process, in a row on a connecting line, each a name pupils learn and one short line; ordered is true for stages. Five or more parts take two slides; five or more stages go to steps. Not for steps pupils carry out (steps), an idea with its reasons (explain), or a contrast (split-compare). Stages that each need a picture go to picture-sequence if its captions hold them; if not, here, ordered.",
  // writer-prompt: owned by TEACH-110 s
  KS2: "- items-row: 2 to 4 named parts that work together, or the named stages of one short process, in a row on a connecting line, each a name pupils learn and one short line; ordered is true for stages. Five parts go to panel-list, five or more stages to steps. Not for steps pupils carry out (steps), an idea with its reasons (explain), or a contrast (split-compare). Stages that each need a picture go to picture-sequence if its captions hold them; if not, here, ordered.",
  // writer-prompt: owned by TEACH-110 s
  "KS3-5":
    "- items-row: 2 to 4 named parts that work together, or the named stages of one short process, in a row on a connecting line, each a name pupils learn and one short line; ordered is true for stages. Five parts go to panel-list, five or more stages to steps. Not for steps pupils carry out (steps), an idea with its reasons (explain), or a contrast (split-compare). Stages that each need a picture go to picture-sequence if its captions hold them; if not, here, ordered.",
} as const satisfies Record<WriterStage, string>;
// writer-prompt: owned by TEACH-110 s
export const ITEMS_ROW_MENU: Record<WriterStage, string> = Object.fromEntries(
  (Object.keys(ROW_MENU_WORDS) as WriterStage[]).map((k) => [
    k,
    `${ROW_MENU_WORDS[k]} ${rowMenuFits(k)}`,
  ]),
) as Record<WriterStage, string>;

/** The shared line for icons, leads and accents, verbatim from MENU-v3 section B. */
// writer-prompt: owned by TEACH-110 s
export const ITEMS_ROW_SHARED_LINE =
  'Icons, leads and accents: on items-row and panel-list, give only the items the content has, fewer rather than filler: a line that restates its name or the heading ("Harvest: the farmer harvests the crop") is padding. An item\'s icon names one concrete thing in one or two lower-case words, such as heart or root, which code draws or replaces with numbers; give every item one, or every item null when any is an idea no simple drawing shows. lead is null or one short line under the heading that frames the items, never repeating them or the heading. accentWord copies one to three words of the heading exactly, or is null.';

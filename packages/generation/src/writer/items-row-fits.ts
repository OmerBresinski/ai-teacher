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

/** The shared line for icons, leads and accents, verbatim from MENU-v3 section B. */
// writer-prompt: owned by TEACH-110 s
export const ITEMS_ROW_SHARED_LINE =
  'Icons, leads and accents: on items-row and panel-list, give only the items the content has, fewer rather than filler: a line that restates its name or the heading ("Harvest: the farmer harvests the crop") is padding. An item\'s icon names one concrete thing in one or two lower-case words, such as heart or root, which code draws or replaces with numbers; give every item one, or every item null when any is an idea no simple drawing shows. lead is null or one short line under the heading that frames the items, never repeating them or the heading. accentWord copies one to three words of the heading exactly, or is null.';

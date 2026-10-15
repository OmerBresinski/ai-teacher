import ITEMS_ROW_CAPACITY from "@tj/slides/templates/items-row-capacity.json" with { type: "json" };
import PANEL_LIST_CAPACITY from "@tj/slides/templates/panel-list-capacity.json" with {
  type: "json",
};
import SPLIT_COMPARE_CAPACITY from "@tj/slides/templates/split-compare-capacity.json" with {
  type: "json",
};
import type { WriterStage } from "./schema";

/*
 * The writer's menu lines for the three pilot layouts (items-row, panel-list, split-compare), one
 * constant per layout and the only source of their words (TEACH-110 part s). The wording is the
 * pilot pack v4.6's (pilot/writer/MENU-v4.6.md, the text the proof and Greg's blind comparison ran
 * on). Every number in a line (item and side counts, words per heading, lead, item, side, title and
 * quote) is generated here from the renderer's measured capacity tables, never typed: a port of the
 * pilot's generator (pilot/writer/tools/gen-v4.5.py, which v4.6 reuses byte for byte). A menu that
 * promised more rows or words than the slide holds was a real bug (#523, #524); a table change now
 * moves the menu with it. layout-menu.test.ts checks every number back against the tables and pins
 * the assembled system text per key stage.
 *
 * A budget in words is min(editorial budget, the comfortable cap in characters / the stage's chars
 * per word). The writer's system text is assembled from these lines (`assembleWriterSystem`); never
 * paste a menu line into a bundle.
 */
type Age = "early" | "primary" | "secondary";
type Fields = Record<string, number>;
const AGES: readonly Age[] = ["early", "primary", "secondary"];
const STAGE_OF: Record<Age, WriterStage> = { early: "KS1", primary: "KS2", secondary: "KS3-5" };
export const MENU_AGE: Record<WriterStage, Age> = {
  KS1: "early",
  KS2: "primary",
  "KS3-5": "secondary",
};

/* Editorial budgets (the pilot's, unchanged since v4.4). */
const SLIDE_WORDS = 40;
const ITEM_SENT: Record<Age, number> = { early: 8, primary: 12, secondary: 12 };
const SIDE_SENT: Record<Age, number> = { early: 14, primary: 20, secondary: 22 };
const QUOTE = 6;
const MIN_ITEM: Record<Age, number> = { early: 3, primary: 4, secondary: 4 };
const MIN_SIDE = 4;
const MIN_QUOTE = 3;
const MIN_LEAD = 3;
const HEAD_WORDS: Record<Age, number> = { early: 4, primary: 8, secondary: 9 };
const TITLE_CHARS = 24;
/** The counts each list layout may offer before the tables decide (panel-list 2-5: Greg, 14 Oct). */
const EDIT_COUNTS = { "items-row": [2, 4], "panel-list": [2, 5] } as const;
/** Row-picture counts the ruling offers (build/ROW-PICTURES.md); each must fit. */
const ROWPIC_MAX: Record<Age, number> = { early: 4, primary: 4, secondary: 5 };
/** Characters per word, the 80th percentile per stage (pilot build/CPW-BY-STAGE.md). */
export const MENU_CHARS_PER_WORD: Record<Age, number> = {
  early: 5.8,
  primary: 6.6,
  secondary: 7.0,
};

/** The most whole words whose characters stay within `chars` at this age. */
export function menuWords(chars: number, age: Age): number {
  let w = 0;
  while ((w + 1) * MENU_CHARS_PER_WORD[age] <= chars + 1e-9) w += 1;
  return w;
}

type CapCell = { cap: number };
type RowCell = { items: number; icons: boolean; withLead: boolean } & Record<string, unknown>;
type PanelCell = Record<string, CapCell> & {
  withLead: Record<string, CapCell>;
  pictures?: Record<string, CapCell> & { withLead: Record<string, CapCell> };
};
const ROW = ITEMS_ROW_CAPACITY as unknown as Record<Age, RowCell[]>;
const PANEL = PANEL_LIST_CAPACITY as unknown as Record<Age, Record<string, PanelCell>>;
const SPLIT = SPLIT_COMPARE_CAPACITY as unknown as Record<
  WriterStage,
  Record<string, Record<string, Record<string, CapCell>>>
>;

/** A list variant: plain (icons), "num" (items-row, every icon null), "pics" (panel-list, a picture per item). */
export type ListVariant = "" | "num" | "pics";
/** A split-compare zone: "" words only, "p" pictures or diagrams, "q" quotes. */
export type SideZone = "" | "p" | "q";
type ListLayout = "items-row" | "panel-list";
const ZONE_KEY: Record<SideZone, string> = { "": "text", p: "picture", q: "quote" };

const capOf = (x: unknown) => (x as CapCell).cap;

/** A list layout's comfortable caps (characters) for one cell of its table, or undefined. */
export function listCaps(
  c: ListLayout,
  a: Age,
  n: number,
  lead = false,
  v: ListVariant = "",
): Fields | undefined {
  if (c === "items-row") {
    const cell = (ROW[a] ?? []).find(
      (x) => x.items === n && x.icons === (v !== "num") && x.withLead === lead,
    );
    if (!cell) return undefined;
    const d: Fields = {
      heading: capOf(cell.heading),
      name: capOf(cell.name),
      text: capOf(cell.text),
    };
    if (lead) d.lead = capOf(cell.lead);
    return d;
  }
  const row = PANEL[a]?.[String(n)];
  const x = v === "pics" ? row?.pictures : row;
  if (!x) return undefined;
  const d: Fields = { heading: capOf(x.heading), name: capOf(x.name), text: capOf(x.text) };
  if (lead)
    Object.assign(d, {
      lead: capOf(x.lead),
      name: capOf(x.withLead.name),
      text: capOf(x.withLead.text),
    });
  return d;
}

/** A split-compare zone's comfortable caps (characters), or undefined. */
export function sideCaps(a: Age, n: number, z: SideZone): Fields | undefined {
  const x = SPLIT[STAGE_OF[a]]?.[String(n)]?.[ZONE_KEY[z]];
  if (!x) return undefined;
  return Object.fromEntries(Object.entries(x).map(([f, c]) => [f, c.cap]));
}

const allPositive = (d: Fields | undefined): d is Fields =>
  !!d && Object.values(d).every((x) => x > 0);
const must = (d: Fields | undefined, what: string): Fields => {
  if (!d) throw new Error(`layout menu: no capacity cell for ${what}`);
  return d;
};

function itemBudget(c: ListLayout, a: Age, n: number, lead = false, v: ListVariant = ""): number {
  const caps = must(listCaps(c, a, n, lead, v), `${c} ${a} ${n}`);
  const edit = Math.min(
    Math.floor((SLIDE_WORDS - (lead ? menuWords(caps.lead ?? 0, a) : 0)) / n),
    ITEM_SENT[a],
  );
  return Math.min(edit, menuWords(caps.text ?? 0, a));
}
const okCount = (c: ListLayout, a: Age, n: number, v: ListVariant = "") =>
  allPositive(listCaps(c, a, n, false, v)) && itemBudget(c, a, n, false, v) >= MIN_ITEM[a];
const range = (lo: number, hi: number) =>
  Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

/** The counts each list layout offers per age and variant, decided by the tables. */
const VNS = new Map<string, number[]>();
const key = (c: ListLayout, a: Age, v: ListVariant) => `${c}|${a}|${v}`;
for (const a of AGES) {
  for (const c of ["items-row", "panel-list"] as const) {
    const ok = range(EDIT_COUNTS[c][0], EDIT_COUNTS[c][1]).filter((n) => okCount(c, a, n));
    const first = ok[0];
    if (first === undefined || ok.join() !== range(first, ok.at(-1) ?? first).join())
      throw new Error(`layout menu: ${c} at ${a} offers no contiguous counts (${ok})`);
    VNS.set(key(c, a, ""), ok);
  }
  const plainMax = (VNS.get(key("items-row", a, "")) ?? []).at(-1) ?? 0;
  VNS.set(
    key("items-row", a, "num"),
    range(0, EDIT_COUNTS["items-row"][1]).filter(
      (n) => n > plainMax && okCount("items-row", a, n, "num"),
    ),
  );
  const pics = range(2, ROWPIC_MAX[a]).filter((n) => okCount("panel-list", a, n, "pics"));
  if (pics.join() !== range(2, ROWPIC_MAX[a]).join())
    throw new Error(
      `layout menu: panel-list at ${a} cannot hold row pictures at every ruled count (${pics})`,
    );
  VNS.set(key("panel-list", a, "pics"), pics);
  if (VNS.get(key("panel-list", a, ""))?.[0] !== 2)
    throw new Error(`layout menu: panel-list at ${a} must start at 2`);
}
const NS = (c: ListLayout, a: Age, v: ListVariant = "") => VNS.get(key(c, a, v)) ?? [];
const allNs = (c: ListLayout, a: Age) =>
  [...new Set([...NS(c, a), ...NS(c, a, c === "items-row" ? "num" : "pics")])].sort(
    (x, y) => x - y,
  );
const leadOk = (c: ListLayout, a: Age, n: number, v: ListVariant = "") => {
  const caps = listCaps(c, a, n, true, v);
  return (
    allPositive(caps) &&
    menuWords(caps.lead ?? 0, a) >= MIN_LEAD &&
    itemBudget(c, a, n, true, v) >= MIN_ITEM[a]
  );
};
const leadNs = (c: ListLayout, a: Age, v: ListVariant = "") =>
  NS(c, a, v).filter((n) => leadOk(c, a, n, v));
const leadWords = (c: ListLayout, a: Age, v: ListVariant = "") =>
  Math.min(
    ...leadNs(c, a, v).map((n) => menuWords(must(listCaps(c, a, n, true, v), c).lead ?? 0, a)),
  );
const headWords = (c: ListLayout, a: Age, lead = false, v: ListVariant = "") =>
  Math.min(
    HEAD_WORDS[a],
    ...(lead ? leadNs(c, a, v) : NS(c, a, v)).map((n) =>
      menuWords(must(listCaps(c, a, n, lead, v), c).heading ?? 0, a),
    ),
  );

const quoteBudget = (a: Age, n: number) =>
  Math.min(QUOTE, menuWords(must(sideCaps(a, n, "q"), `quote ${a} ${n}`).quote ?? 0, a));
function sideBudget(a: Age, n: number, z: SideZone): number {
  const caps = must(sideCaps(a, n, z), `split-compare ${a} ${n}${z}`);
  return Math.min(
    Math.floor(SLIDE_WORDS / n) - (z === "q" ? quoteBudget(a, n) : 0),
    SIDE_SENT[a],
    menuWords(caps.text ?? 0, a),
  );
}
const zoneOk = (a: Age, n: number, z: SideZone) =>
  allPositive(sideCaps(a, n, z)) &&
  sideBudget(a, n, z) >= MIN_SIDE &&
  (z !== "q" || quoteBudget(a, n) >= MIN_QUOTE);
const ZONES: readonly SideZone[] = ["", "p", "q"];
const SC_KEYS = Object.fromEntries(
  AGES.map((a) => [
    a,
    ZONES.flatMap((z) => [2, 3].filter((n) => zoneOk(a, n, z)).map((n) => `${n}${z}`)),
  ]),
) as Record<Age, string[]>;
for (const a of AGES)
  for (const k of ["2", "3", "2p"])
    if (!SC_KEYS[a].includes(k))
      throw new Error(`layout menu: split-compare at ${a} cannot offer ${k}`);

/* Rendering, clause for clause the pilot generator's. */
const span = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo} to ${hi}`);
function runs(pairs: [number, number][]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1]?.[1] === pairs[i]?.[1]) j += 1;
    out.push([pairs[i]?.[0] ?? 0, pairs[j]?.[0] ?? 0, pairs[i]?.[1] ?? 0]);
    i = j + 1;
  }
  return out;
}
const fmt = (pairs: [number, number][], unit: string) =>
  runs(pairs)
    .map(([x, y, w]) => `${span(x, y)} ${unit}: up to ${w} words each`)
    .join("; ");
const headNote = (c: ListLayout, a: Age, v: ListVariant = "") => {
  const hw = headWords(c, a, false, v);
  return hw < HEAD_WORDS[a] ? `heading up to ${hw} words; ` : "";
};
function fitsItems(c: ListLayout, a: Age, v: ListVariant = ""): string {
  let s =
    headNote(c, a, v) +
    fmt(
      NS(c, a, v).map((n) => [n, itemBudget(c, a, n, false, v)]),
      "items",
    );
  const ln = leadNs(c, a, v);
  if (ln.length) {
    const hl = headWords(c, a, true, v);
    s +=
      `; with a lead of up to ${leadWords(c, a, v)} words` +
      (hl < headWords(c, a, false, v) ? ` (heading up to ${hl})` : "") +
      `: ${fmt(
        ln.map((n) => [n, itemBudget(c, a, n, true, v)]),
        "items",
      )}`;
  }
  return s;
}
function fitsRow(a: Age): string {
  let s = fitsItems("items-row", a);
  const num = NS("items-row", a, "num");
  if (num.length) {
    const hn = headWords("items-row", a, false, "num");
    s += `; ${num
      .map(
        (n) =>
          `${n} items, every icon null: ${hn < HEAD_WORDS[a] ? `heading up to ${hn} words, ` : ""}up to ${itemBudget("items-row", a, n, false, "num")} words each`,
      )
      .join("; ")}`;
  }
  return s;
}
function fitsPics(a: Age): string {
  const c = "panel-list";
  const d: string[] = [];
  const hp = headWords(c, a, false, "pics");
  if (hp !== headWords(c, a)) d.push(`heading up to ${hp} words`);
  const pn = NS(c, a);
  const pp = NS(c, a, "pics");
  for (const n of pp)
    if (!pn.includes(n) || itemBudget(c, a, n, false, "pics") !== itemBudget(c, a, n))
      d.push(`${n} items: up to ${itemBudget(c, a, n, false, "pics")} words each`);
  const ln = leadNs(c, a);
  const lp = leadNs(c, a, "pics");
  const lw = lp.length ? leadWords(c, a, "pics") : 0;
  const ld = lp
    .filter(
      (n) => !ln.includes(n) || itemBudget(c, a, n, true, "pics") !== itemBudget(c, a, n, true),
    )
    .map((n) => `${n} items: up to ${itemBudget(c, a, n, true, "pics")} words each`);
  if (lp.length && (ld.length || lw !== leadWords(c, a)))
    d.push(`with a lead of up to ${lw} words${ld.length ? `: ${ld.join("; ")}` : ""}`);
  const gone = pn.filter((n) => !pp.includes(n));
  if (gone.length) d.push(`${span(gone[0] ?? 0, gone.at(-1) ?? 0)} items: not offered`);
  return `the same${d.length ? `, except ${d.join("; ")}` : ""}`;
}
const ZONE_LABEL: Record<SideZone, string> = {
  "": "words only",
  p: "with pictures",
  q: "with quotes",
};
const fitsSides = (a: Age) =>
  ZONES.flatMap((z) =>
    [2, 3]
      .filter((n) => SC_KEYS[a].includes(`${n}${z}`))
      .map(
        (n) =>
          `${n} sides ${ZONE_LABEL[z]}: up to ${sideBudget(a, n, z)} words each${z === "q" ? `, plus a quote of up to ${quoteBudget(a, n)} words` : ""}`,
      ),
  ).join("; ");
const titleWords = (a: Age) =>
  Math.min(
    ...SC_KEYS[a].map((k) =>
      menuWords(
        Math.min(
          TITLE_CHARS,
          must(sideCaps(a, Number(k[0]), k.slice(1) as SideZone), k).title ?? 0,
        ),
        a,
      ),
    ),
  );
const no3 = (a: Age, z: SideZone) => (SC_KEYS[a].includes(`3${z}`) ? "2 or 3" : "2");
function media(a: Age): string {
  let pic = `All sides or none carry a picture${no3(a, "p") === "2 or 3" ? "" : " (2 sides only)"}, a diagram when the difference is in how each is built or works`;
  if (SC_KEYS[a].some((k) => k.endsWith("q")))
    pic += `, or for people's viewpoints a quote in their voice${no3(a, "q") === "2 or 3" ? "" : " (2 sides only)"}`;
  return `${pic}.`;
}
const NUMW: Record<number, string> = { 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six" };
const countWords = (c: ListLayout, a: Age) => {
  const ns = allNs(c, a);
  return span(ns[0] ?? 0, ns.at(-1) ?? 0);
};

/** What each layout offers at a stage, as the menu states it: part s sizes the schema's arrays from it. */
export function layoutOffer(stage: WriterStage) {
  const a = MENU_AGE[stage];
  return {
    "items-row": {
      counts: allNs("items-row", a),
      icons: NS("items-row", a),
      numbered: NS("items-row", a, "num"),
      lead: leadNs("items-row", a),
    },
    "panel-list": {
      counts: allNs("panel-list", a),
      plain: NS("panel-list", a),
      pictures: NS("panel-list", a, "pics"),
      lead: leadNs("panel-list", a),
      picturesLead: leadNs("panel-list", a, "pics"),
    },
    "split-compare": { sides: SC_KEYS[a] },
  };
}

const byStage = (line: (a: Age) => string) =>
  Object.fromEntries(AGES.map((a) => [STAGE_OF[a], line(a)])) as Record<WriterStage, string>;

// writer-prompt: owned by TEACH-110 s
export const ITEMS_ROW_WRITER_MENU: Record<WriterStage, string> = byStage((a) => {
  const more = NUMW[(allNs("items-row", a).at(-1) ?? 0) + 1] ?? "";
  return `- items-row: ${countWords("items-row", a)} named parts that work together, or the named stages of one short process (flow shape parts of a whole, or sequence), in a row on a connecting line, each a name pupils learn and one short line; ordered is true for stages. ${more} or more parts go to a labelled diagram or two slides, ${more.toLowerCase()} or more stages to steps. Not for steps pupils carry out (steps), an idea with its reasons (explain), a set of kinds or examples (panel-list), or a contrast (split-compare). Stages each told by a picture and its name go to picture-sequence; stages that each need a line on what happens come here, ordered. motif: vessel for circulation, river for water or journeys, road for routes or history, stem for growth, else null (a plain line). Fits: ${fitsRow(a)}.`;
});

// writer-prompt: owned by TEACH-110 s
export const PANEL_LIST_WRITER_MENU: Record<WriterStage, string> = byStage(
  (a) =>
    `- panel-list: a set of ${countWords("panel-list", a)} kinds, examples or rules of one group (flow shape a set of kinds or examples), as a list beside a title panel, each a name and one fact about it, when order does not matter. Three or more kinds of one group always come here, even when each fact differs on the same feature; two members come here when the point is the set, not how they differ. Parts that work together and stages go to items-row; a set whose members each need a paragraph takes a slide each; more members take two slides. When each member is a thing pupils need to see (an organism, a rock, a place, an object), every item gets a picture of it alone, one object or simple scene with no labels (a small tile), and the panel is null; rules, reasons and ideas take picture null. Otherwise the panel holds a photo of the whole group, a pie of the items' shares of one known whole, or nothing. Fits: ${fitsItems("panel-list", a)}. With a picture on every item: ${fitsPics(a)}. Each limit holds only for its own item count and whether the items carry pictures.`,
);

// writer-prompt: owned by TEACH-110 s
export const SPLIT_COMPARE_WRITER_MENU: Record<WriterStage, string> = byStage(
  (a) =>
    `- split-compare: a vs: 2 or 3 things set against each other (flow shape a contrast) in edge-to-edge colour fields, each a title and a sentence or two, when the contrast is the point: opposites, two or three viewpoints, before and after, or two kinds that differ on the same features, each side answering the same question in the same order. Three or more kinds of one group are a set, not a vs, even when they differ on the same feature and each wants a picture or diagram: panel-list; so are two examples of one idea. Four or more things compared on several features go to a table. ${media(a)} What the sides share goes in the heading, or in a few words each side opens with; the rest of each side says how it differs, never padded. A side's title names its thing in up to ${titleWords(a)} words; a longer idea goes in the side's text, never split across title and text. Fits: ${fitsSides(a)}. Each limit holds only for its own side count and zone, so settle how many sides and whether they carry pictures or quotes before writing.`,
);

/** Each layout's menu, by the slot name its line takes in a system template (`{{menu:<layout>}}`). */
export const LAYOUT_WRITER_MENUS = {
  "items-row": ITEMS_ROW_WRITER_MENU,
  "panel-list": PANEL_LIST_WRITER_MENU,
  "split-compare": SPLIT_COMPARE_WRITER_MENU,
} as const;

/**
 * A writer system text from its template: each `{{menu:<layout>}}` slot (exactly once each) becomes
 * that layout's line for the stage. Throws on a missing, repeated or unknown slot, so a template can
 * never ship with a hand copy in place of a slot or a slot left unfilled.
 */
export function assembleWriterSystem(template: string, stage: WriterStage): string {
  let out = template;
  for (const [layout, menu] of Object.entries(LAYOUT_WRITER_MENUS)) {
    const slot = `{{menu:${layout}}}`;
    if (out.split(slot).length !== 2)
      throw new Error(`writer system: ${slot} must appear exactly once`);
    out = out.replace(slot, () => menu[stage]);
  }
  if (out.includes("{{menu:")) throw new Error("writer system: an unknown {{menu:...}} slot");
  for (const layout of Object.keys(LAYOUT_WRITER_MENUS))
    if (out.split(`\n- ${layout}: `).length !== 2)
      throw new Error(`writer system: ${layout} has a second menu line`);
  return out;
}

/** A field's caps, keyed by the writer's field name (`heading`, `lead`, `name`, `text`, `title`, `quote`). */
export type LayoutFieldCaps = Record<"items-row" | "panel-list" | "split-compare", Fields>;

/**
 * The loosest comfortable cap (characters) each pilot layout's fields reach over every cell the
 * menu offers at a stage, from the same measured tables as the menu's Fits (`layoutOffer`). The
 * schema's string caps come from here; each count's own cap is the layout's to enforce at the
 * drawn size (pilot-fit.ts), and it reads the same tables.
 */
export function layoutFieldCaps(stage: WriterStage): LayoutFieldCaps {
  const a = MENU_AGE[stage];
  const o = layoutOffer(stage);
  const top = (cells: (Fields | undefined)[]): Fields => {
    const out: Fields = {};
    for (const c of cells)
      for (const [k, v] of Object.entries(c ?? {})) if (v > 0) out[k] = Math.max(out[k] ?? 0, v);
    return out;
  };
  const row = o["items-row"];
  const panel = o["panel-list"];
  return {
    "items-row": top([
      ...row.icons.map((n) => listCaps("items-row", a, n)),
      ...row.numbered.map((n) => listCaps("items-row", a, n, false, "num")),
      ...row.lead.map((n) => listCaps("items-row", a, n, true)),
    ]),
    "panel-list": top([
      ...panel.plain.map((n) => listCaps("panel-list", a, n)),
      ...panel.pictures.map((n) => listCaps("panel-list", a, n, false, "pics")),
      ...panel.lead.map((n) => listCaps("panel-list", a, n, true)),
      ...panel.picturesLead.map((n) => listCaps("panel-list", a, n, true, "pics")),
    ]),
    "split-compare": top(
      o["split-compare"].sides.map((k) => sideCaps(a, Number(k[0]), k.slice(1) as SideZone)),
    ),
  };
}

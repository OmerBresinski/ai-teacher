import { SHORT_ANSWER_WORDS } from "@tj/slides/templates/end-answers";
import END_ANSWERS_CAPACITY from "@tj/slides/templates/end-answers-capacity.json" with {
  type: "json",
};
import HINGE_CAPACITY from "@tj/slides/templates/hinge-capacity.json" with { type: "json" };
import ITEMS_ROW_CAPACITY from "@tj/slides/templates/items-row-capacity.json" with { type: "json" };
import PANEL_LIST_CAPACITY from "@tj/slides/templates/panel-list-capacity.json" with {
  type: "json",
};
import PRACTICE_CAPACITY from "@tj/slides/templates/practice-capacity.json" with { type: "json" };
import QUICK_CAPACITY from "@tj/slides/templates/question-set-capacity.json" with { type: "json" };
import SPLIT_COMPARE_CAPACITY from "@tj/slides/templates/split-compare-capacity.json" with {
  type: "json",
};
import { headingWords } from "./fit-fits";
import HINGE_CARDS from "./hinge-cards.gen.json" with { type: "json" };
import type { WriterStage } from "./schema";
import {
  CHARS_PER_WORD,
  MIN_SHOWN_WORDS,
  needMedianOf,
  needOf,
  offerable,
  probeRoom,
  shownFor,
  wordsWithin,
} from "./shown-cap";
import { type WaveCMenuOpts, waveCMenuBlock } from "./wave-c";

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
 * A budget in words is min(editorial budget, the words shown for the comfortable cap): about 75%
 * of the measured characters at the stage's chars per word (`shown-cap.ts`, the one place that
 * converts). No body field is offered under `MIN_SHOWN_WORDS`, and one more item never halves the
 * shown cap (`offerable`); the measured caps stay the schema's and the fit check's hard limit. The writer's system text is assembled from these lines (`assembleWriterSystem`); never
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
/** Body floors: an item, side or lead shown under `MIN_SHOWN_WORDS` is not offered (loop 1). */
const MIN_ITEM: Record<Age, number> = {
  early: MIN_SHOWN_WORDS,
  primary: MIN_SHOWN_WORDS,
  secondary: MIN_SHOWN_WORDS,
};
const MIN_SIDE = MIN_SHOWN_WORDS;
/** A quote is a few words in a person's voice, a label more than body text. */
const MIN_QUOTE = 3;
const MIN_LEAD = MIN_SHOWN_WORDS;
/**
 * A heading's words by age: the measured slide-heading cap (`headingWords`, fit-fits.ts), the
 * same number the fit layouts show; was typed 4 / 8 / 9 (decision desk, 17 Oct 2026: headings rise
 * to the measured caps). A cell that measures a shorter heading still says so in its line.
 */
const HEAD_WORDS: Record<Age, number> = {
  early: headingWords("KS1"),
  primary: headingWords("KS2"),
  secondary: headingWords("KS3-5"),
};
const TITLE_CHARS = 24;
/** The counts each list layout may offer before the tables decide (panel-list 2-5: Greg, 14 Oct). */
const EDIT_COUNTS = { "items-row": [2, 4], "panel-list": [2, 5] } as const;
/** Row-picture counts the ruling offers (build/ROW-PICTURES.md); each must fit. */
const ROWPIC_MAX: Record<Age, number> = { early: 4, primary: 4, secondary: 5 };
/** Characters per word by age: `shown-cap.ts` `CHARS_PER_WORD`, the one constant. */
export const MENU_CHARS_PER_WORD: Record<Age, number> = {
  early: CHARS_PER_WORD.KS1,
  primary: CHARS_PER_WORD.KS2,
  secondary: CHARS_PER_WORD["KS3-5"],
};

/** The most whole words whose characters stay within `chars` at this age (the hard cap). */
export function menuWords(chars: number, age: Age): number {
  return wordsWithin(chars, STAGE_OF[age]);
}
/**
 * The words the menu shows for a body field's measured cap of `chars` at this age (`shownWords`).
 * Headings and side titles are labels, not body: they show their measured words (heading median
 * fill was 56%, 7% at 90% or more; CRAMMING-ROOT-CAUSE.md "Not causes"), and at 75% a KS1 side
 * title would show one word.
 */
/**
 * A hinge option count's shown words: its room is the probe's comfortable words, never more than
 * its measured hard maximum holds at the stage's long-word rate (GOLD-THROUGH-PROD.md, 18 Oct).
 */
function hingeShown(a: Age, c: HingeCap, n: number): number {
  const cell = c.byCount?.[String(n)] ?? c;
  const st = STAGE_OF[a];
  const room = Math.min(cell.words, wordsWithin(cell.maxChars ?? cell.chars, st));
  return shownFor(cell.chars, st, "hinge.option", cell.chars, room);
}

export function menuShown(chars: number, age: Age, need?: string, roomChars = chars): number {
  // Need-aware where `need` names a row of content-need.json (CAP-NEED-AUDIT.md, 18 Oct 2026).
  return shownFor(chars, STAGE_OF[age], need, roomChars);
}

type CapCell = { cap: number; hardMax?: number };
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
    Math.floor((SLIDE_WORDS - (lead ? menuShown(caps.lead ?? 0, a, `${c}.lead`) : 0)) / n),
    ITEM_SENT[a],
  );
  // The editorial budget never holds a cell under its content need (CAP-NEED-AUDIT.md, 18 Oct).
  const need = needOf(`${c}.item`, STAGE_OF[a]) ?? 0;
  return Math.min(Math.max(edit, need), menuShown(caps.text ?? 0, a, `${c}.item`));
}
const okCount = (c: ListLayout, a: Age, n: number, v: ListVariant = "") =>
  allPositive(listCaps(c, a, n, false, v)) && itemBudget(c, a, n, false, v) >= MIN_ITEM[a];
/** The counts in `ns` (ascending) whose shown item budget is offerable: floor and no cliff. */
const offeredCounts = (
  c: ListLayout,
  a: Age,
  ns: number[],
  lead = false,
  v: ListVariant = "",
  ok: (n: number) => boolean = (n) => okCount(c, a, n, v),
) =>
  offerable(
    ns.map((n): [number, number] => [n, ok(n) ? itemBudget(c, a, n, lead, v) : 0]),
    MIN_ITEM[a],
  ).map(([n]) => n);
const range = (lo: number, hi: number) =>
  Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

/** The counts each list layout offers per age and variant, decided by the tables. */
const VNS = new Map<string, number[]>();
const key = (c: ListLayout, a: Age, v: ListVariant) => `${c}|${a}|${v}`;
for (const a of AGES) {
  for (const c of ["items-row", "panel-list"] as const) {
    const ok = offeredCounts(c, a, range(EDIT_COUNTS[c][0], EDIT_COUNTS[c][1]));
    const first = ok[0];
    if (first === undefined || ok.join() !== range(first, ok.at(-1) ?? first).join())
      throw new Error(`layout menu: ${c} at ${a} offers no contiguous counts (${ok})`);
    VNS.set(key(c, a, ""), ok);
  }
  const plainMax = (VNS.get(key("items-row", a, "")) ?? []).at(-1) ?? 0;
  VNS.set(
    key("items-row", a, "num"),
    offeredCounts("items-row", a, range(plainMax + 1, EDIT_COUNTS["items-row"][1]), false, "num"),
  );
  const pics = offeredCounts("panel-list", a, range(2, ROWPIC_MAX[a]), false, "pics");
  // The ruling's counts (2 up to ROWPIC_MAX) are offered while their shown caps hold the floor;
  // a count that would go under it is dropped (loop 1, 17 Oct), never squeezed.
  if (pics[0] !== 2)
    throw new Error(`layout menu: panel-list at ${a} cannot hold row pictures at 2 (${pics})`);
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
    menuShown(caps.lead ?? 0, a, `${c}.lead`) >= MIN_LEAD &&
    itemBudget(c, a, n, true, v) >= MIN_ITEM[a]
  );
};
const leadNs = (c: ListLayout, a: Age, v: ListVariant = "") =>
  offeredCounts(c, a, NS(c, a, v), true, v, (n) => leadOk(c, a, n, v));
const leadWords = (c: ListLayout, a: Age, v: ListVariant = "") =>
  Math.min(
    ...leadNs(c, a, v).map((n) =>
      menuShown(must(listCaps(c, a, n, true, v), c).lead ?? 0, a, `${c}.lead`),
    ),
  );
const headWords = (c: ListLayout, a: Age, lead = false, v: ListVariant = "") =>
  Math.min(
    HEAD_WORDS[a],
    ...(lead ? leadNs(c, a, v) : NS(c, a, v)).map((n) =>
      menuWords(must(listCaps(c, a, n, lead, v), c).heading ?? 0, a),
    ),
  );

const quoteBudget = (a: Age, n: number) =>
  Math.min(QUOTE, menuShown(must(sideCaps(a, n, "q"), `quote ${a} ${n}`).quote ?? 0, a));
/**
 * Pictured sides are offered this share of their measured comfortable characters (PROCESS 7.2's 80%
 * headroom). Past the cap the words win and the pictures shrink to slivers: y4-romans s3 (16 Oct)
 * wrote 112 characters against KS2's 101 under a 15-word line, and its photos fell to 29% of the
 * field (build/PICS-TRACE-16OCT.md). Words-only and quote sides overflow into type, not pictures.
 */
export const PIC_SIDE_HEADROOM = 0.8;
function sideBudget(a: Age, n: number, z: SideZone): number {
  const caps = must(sideCaps(a, n, z), `split-compare ${a} ${n}${z}`);
  // The shown share (75%) is stricter than the pictures' 80% headroom, so it keeps that headroom
  // without stacking the two (0.6 of the cap would drop KS1's pictured sides below the floor). A
  // need above the share may rise only to the headroom, never to the full cap (18 Oct 2026).
  const chars = caps.text ?? 0;
  const room = z === "p" ? chars * PIC_SIDE_HEADROOM : chars;
  const edit = Math.min(
    Math.floor(SLIDE_WORDS / n) - (z === "q" ? quoteBudget(a, n) : 0),
    SIDE_SENT[a],
  );
  // The editorial budget never holds a side under its content need (CAP-NEED-AUDIT.md, 18 Oct).
  const need = needOf("split-compare.side", STAGE_OF[a]) ?? 0;
  return Math.min(Math.max(edit, need), menuShown(chars, a, "split-compare.side", room));
}
/**
 * Cells the menu never offers, whatever they measure. KS2 three pictured sides: the KS2 gold side
 * text (ruling 162 amended by Greg 18 Oct, item 31 A) measures them at 4 words a side, which reads
 * choppy; they stay off the menu as before that change ("2 sides only").
 */
const NOT_OFFERED: Partial<Record<Age, readonly string[]>> = { primary: ["3p"] };
const zoneOk = (a: Age, n: number, z: SideZone) =>
  !NOT_OFFERED[a]?.includes(`${n}${z}`) &&
  allPositive(sideCaps(a, n, z)) &&
  sideBudget(a, n, z) >= MIN_SIDE &&
  (z !== "q" || quoteBudget(a, n) >= MIN_QUOTE);
const ZONES: readonly SideZone[] = ["", "p", "q"];
const SC_KEYS = Object.fromEntries(
  AGES.map((a) => [
    a,
    ZONES.flatMap((z) =>
      offerable(
        [2, 3].map((n): [number, number] => [n, zoneOk(a, n, z) ? sideBudget(a, n, z) : 0]),
        MIN_SIDE,
      ).map(([n]) => `${n}${z}`),
    ),
  ]),
) as Record<Age, string[]>;
for (const a of AGES)
  for (const k of ["2", "2p"])
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
/** The side counts split-compare's table measures at an age: "2 or 3". */
const sideSpan = (a: Age) => {
  const ns = [...new Set(SC_KEYS[a].map((k) => Number(k[0])))].sort();
  return ns.length > 1 ? `${ns.slice(0, -1).join(", ")} or ${ns.at(-1)}` : `${ns[0]}`;
};
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
  let pic = `When each side is a thing a camera or diagram can show, every side carries a picture${no3(a, "p") === "2 or 3" ? "" : " (2 sides only)"}, or a diagram when the difference is in how each is built or works`;
  if (SC_KEYS[a].some((k) => k.endsWith("q")))
    pic += `; for people's viewpoints, every side carries a quote in their voice${no3(a, "q") === "2 or 3" ? "" : " (2 sides only)"}`;
  return `${pic}. Sides carry neither only when nothing can show them.`;
}
/**
 * A layout's text length in words the description can say, generated from the same budgets as its
 * Fits, so the description never promises more than the tightest cell holds (a "sentence or two"
 * over a 7-word side read as a target and crammed; build/CRAMMING-ROOT-CAUSE.md, TEACH-110 part ae).
 */
const lengthWord = (w: number) =>
  w <= 6 ? "a phrase" : w <= 14 ? "a short sentence" : "a sentence or two";
const lengthSpan = (budgets: number[]) => {
  const lo = lengthWord(Math.min(...budgets));
  const hi = lengthWord(Math.max(...budgets));
  return lo === hi ? lo : `${lo} to ${hi}`;
};
/** Every item budget a list layout's Fits offer at an age: plain, row variant, and with a lead. */
const itemLength = (c: ListLayout, a: Age) =>
  lengthSpan(
    (["", c === "items-row" ? "num" : "pics"] as const).flatMap((v) => [
      ...NS(c, a, v).map((n) => itemBudget(c, a, n, false, v)),
      ...leadNs(c, a, v).map((n) => itemBudget(c, a, n, true, v)),
    ]),
  );
/** Every side budget split-compare's Fits offer at an age. */
const sideLength = (a: Age) =>
  lengthSpan(SC_KEYS[a].map((k) => sideBudget(a, Number(k[0]), k.slice(1) as SideZone)));
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
  return `- items-row: ${countWords("items-row", a)} named parts of one whole that work together (flow shape parts of a whole), in a row on a connecting line, each a name pupils learn and its job in one short line. ${more} or more parts go to a labelled diagram or two slides. Never the steps of a method or calculation, even in order (steps or equation-hero), or the stages of a process (steps or picture-sequence); not for an idea with its reasons (explain), a set of kinds or examples (panel-list), or a contrast (split-compare). motif: vessel for circulation, stem for a plant, else null (a plain line). Fits: ${fitsRow(a)}.`;
});

// writer-prompt: owned by TEACH-110 s
export const PANEL_LIST_WRITER_MENU: Record<WriterStage, string> = byStage(
  (a) =>
    `- panel-list: a set of ${countWords("panel-list", a)} kinds, examples or rules of one group (flow shape a set of kinds or examples), as a list beside a title panel, each a name and one fact, in ${itemLength("panel-list", a)}, when order does not matter. Three or more kinds of one group always come here, even when each fact differs on the same feature; two members come here when the point is the set, not how they differ. Parts that work together go to items-row, and the steps of a method, numbered or not, go to steps or equation-hero; a set whose members each need a paragraph takes a slide each; more members take two slides. When each member is a thing pupils need to see (an organism, a rock, a place, an object), every item gets a picture of it alone, one object or simple scene with no labels (a small tile), and the panel is null. Otherwise the panel holds a pie when the items are shares of one known whole, else a photo of the whole group whenever a camera can show the members together; null only when neither fits. Rules, reasons and ideas take picture null and icons. Fits: ${fitsItems("panel-list", a)}. With a picture on every item: ${fitsPics(a)}. Each limit holds only for its own item count and whether the items carry pictures.`,
);

// writer-prompt: owned by TEACH-110 s
export const SPLIT_COMPARE_WRITER_MENU: Record<WriterStage, string> = byStage(
  (a) =>
    `- split-compare: a vs: ${sideSpan(a)} things set against each other (flow shape a contrast) in edge-to-edge colour fields, each a title and ${sideLength(a)}, when the contrast is the point: opposites, viewpoints, before and after a change in the world, or two kinds that differ on the same features, each side answering the same question in the same order. Never a mistake against its correction (the misconception slide), two worked examples of one method, or two uses of one rule or sentence pattern (equation-hero or explain): every side is true and a thing in its own right. Three or more kinds of one group are a set, not a vs, even when they differ on the same feature and each wants a picture or diagram: panel-list; so are two examples of one idea. Four or more things compared on several features go to a table. ${media(a)} What the sides share goes in the heading, or in a few words each side opens with; the rest of each side says how it differs, never padded. A side's title names its thing in up to ${titleWords(a)} words; a longer idea goes in the side's text, never split across title and text. Fits: ${fitsSides(a)}. Each limit holds only for its own side count and zone, so settle how many sides and whether they carry pictures or quotes before writing.`,
);

/*
 * The question layouts (TEACH-110 part v, the B wave): hinge (TEACH-256 b), quick check
 * (`question-set`, TEACH-101 g), practice and exit ticket (TEACH-230 b). Their numbers come from
 * the same tables the templates fit with: `hinge-cards.gen.json` (the hinge's writer table, per
 * option count), `question-set-capacity.json` and `practice-capacity.json`. The end-of-deck
 * Answers slides are built by code from the practice and exit answers and are never offered.
 */
/** A practice task or exit question is at most this many words, whatever the slide holds. */
const TASK_SENT: Record<Age, number> = { early: 15, primary: 25, secondary: 30 };
/** Below this a task, question or option count is not offered. */
const MIN_TASK: Record<Age, number> = {
  early: MIN_SHOWN_WORDS,
  primary: MIN_SHOWN_WORDS,
  secondary: MIN_SHOWN_WORDS,
};
/**
 * A quick-check question is one line by design (recall), not body text, so it is exempt from
 * `MIN_SHOWN_WORDS`: at 75% of one measured line it shows 3 to 4 words, and a 5-word floor would
 * drop question-set at every stage (a product ruling, not an engineering one; loop 1, 17 Oct).
 */
const MIN_QUICK_Q = 3;
/** Practice with a picture at KS1 holds at most 3 tasks (the gold's default, practice-exit NOTES). */
const PIC_MAX: Record<Age, number> = { early: 3, primary: 4, secondary: 4 };
/**
 * Hinge picture-tile names: the gold's 2 words. No capacity table measures tile labels;
 * question-offer.test.ts renders a full row of tiles at this length on every stage and theme.
 */
export const TILE_WORDS = 2;
/**
 * The end Answers ledger's answer forms (TEACH-191 part b): a short answer is what the ledger
 * parses as one (`SHORT_ANSWER_WORDS`, `end-answers.ts` `answerItem`), and the longest model
 * sentence is the longest sentence class the ledger's capacity table measures
 * (`end-answers-capacity.json`, "N-word sentences"). Working is one calculation line, the form the
 * table measures for worked answers.
 */
const longestSentence = Math.max(
  ...Object.values(END_ANSWERS_CAPACITY as Record<string, Record<string, number>>).flatMap((k) =>
    Object.keys(k).map((x) => Number(/^(\d+)-word sentences$/.exec(x)?.[1] ?? 0)),
  ),
);
export const ANSWER_WORDS = { short: SHORT_ANSWER_WORDS, sentence: longestSentence } as const;

type QuickCell = { questions: CapCell; answers: CapCell };
const QUICK = QUICK_CAPACITY as unknown as Record<Age, Record<string, QuickCell>>;
type WorkCell = { n: number; cap: number };
const WORK = PRACTICE_CAPACITY as unknown as Record<
  Age,
  Record<"practice" | "practice+picture" | "practice+figure" | "exit", WorkCell[]>
>;
const HINGE = (
  HINGE_CARDS as { groups: Record<WriterStage, { stem: number; options: Record<string, number> }> }
).groups;

const quickOffer = (a: Age) =>
  Object.entries(QUICK[a] ?? {})
    .map(([n, c]) => ({
      n: Number(n),
      // Room in ordinary words (`probeRoom`): the stage's long-word rate on the one-line cap
      // showed 6 words where the gold's 7-9-word questions sit on one line (18 Oct 2026).
      q: shownFor(
        c.questions.cap,
        STAGE_OF[a],
        "question-set.question",
        c.questions.cap,
        probeRoom(c.questions.cap, c.questions.hardMax ?? c.questions.cap, STAGE_OF[a]),
      ),
      // Never past the answers rule's short phrase (`ANSWER_WORDS.short`), at every stage, so the
      // two agree (KS2 by ruling 162 amended, item 31 A; KS3 brought in line 18 Oct 2026).
      a: Math.min(menuShown(c.answers.cap, a, "question-set.answer"), ANSWER_WORDS.short),
    }))
    .filter((x) => x.q >= MIN_QUICK_Q && x.a >= 1)
    .sort((x, y) => x.n - y.n);
/** A count's words hold its field's median need at this age (waives the no-cliff rule). */
const holdsMedian = (a: Age, need: string) => (w: number) =>
  w >= (needMedianOf(need, STAGE_OF[a]) ?? Number.POSITIVE_INFINITY);

/**
 * Practice and the exit ticket are exempt from the no-cliff rule where the count still holds the
 * median need (CAP-NEED-AUDIT.md rows 1d, 3b):
 * the cliff dropped KS1's 3 pictured tasks (the gold's default) and KS3's 3 exit questions, the
 * count "together check the objectives" asks for. The floor still holds.
 */
const workBudget = (a: Age, cells: WorkCell[], need: string, max = 99): [number, number][] => {
  const sorted = cells.filter((c) => c.n <= max).sort((x, y) => x.n - y.n);
  // Which counts reach the floor is today's rule (the 75% share): a need never adds a count whose
  // room is under it. The need only raises the words shown for a count already offered.
  const floorOk = sorted.findIndex(
    (c) => Math.min(TASK_SENT[a], menuShown(c.cap, a)) < MIN_TASK[a],
  );
  return offerable(
    sorted
      .slice(0, floorOk < 0 ? sorted.length : floorOk)
      .map((c): [number, number] => [c.n, Math.min(TASK_SENT[a], menuShown(c.cap, a, need))]),
    MIN_TASK[a],
    holdsMedian(a, need),
  );
};
const practiceOffer = (a: Age) => ({
  plain: workBudget(a, WORK[a].practice, "practice.task"),
  // A picture and a figure are measured apart: offer the smaller per count.
  pic: offerable(
    workBudget(a, WORK[a]["practice+picture"], "practice.task", PIC_MAX[a]).map(
      ([n, w]): [number, number] => {
        const f = WORK[a]["practice+figure"].find((c) => c.n === n);
        return [n, f ? Math.min(w, menuShown(f.cap, a, "practice.task")) : w];
      },
    ),
    MIN_TASK[a],
    holdsMedian(a, "practice.task"),
  ),
});
const exitOffer = (a: Age) => workBudget(a, WORK[a].exit, "exit-ticket.question");
/**
 * The hinge's option offer is #539's renderer-measured `hinge-capacity.json`: one word budget per
 * age, measured with the most options the age takes (3 at KS1, 4 otherwise), so it holds for fewer.
 * The question's budget is the writer's hinge card table (`hinge-cards.gen.json`, regenerated by
 * #539 from the same layout).
 */
type HingeCap = {
  words: number;
  chars: number;
  options: number;
  /** Each option count measured on its own (18 Oct 2026); absent, the most-options figure. */
  maxChars?: number;
  byCount?: Record<string, { words: number; chars: number; maxChars?: number }>;
};
const HINGE_CAP = HINGE_CAPACITY as unknown as Record<Age, HingeCap>;
const hingeOffer = (a: Age) => {
  const g = HINGE[STAGE_OF[a]];
  const c = HINGE_CAP[a];
  if (!g || !c) throw new Error(`layout menu: no hinge table for ${a}`);
  return {
    question: menuShown(g.stem, a, "hinge.question"),
    // Each count's own measured room (fewer cards hold longer options), need-aware.
    options: offerable(
      Array.from({ length: c.options - 1 }, (_, i): [number, number] => [
        i + 2,
        hingeShown(a, c, i + 2),
      ]),
      MIN_SHOWN_WORDS,
      // Decision 32: the option count follows the options' length, so the most options stay
      // offered for short options beside the longer cells for fewer (no cliff).
      () => true,
    ),
  };
};
const ends = (p: [number, number][], what: string) => {
  const lo = p[0]?.[0];
  const hi = p.at(-1)?.[0];
  if (lo === undefined || hi === undefined) throw new Error(`layout menu: ${what} offers nothing`);
  return [lo, hi] as const;
};
/**
 * The most practice tasks a slide holds unless every task is a one-line calculation (decision 30,
 * 18 Oct 2026): word tasks take at most this many per slide; 5 to 6 are calculation-only cells.
 */
export const WORD_TASK_MAX = 4;

/** Runs of counts with one budget, each clause whole: "3 to 4 tasks: up to 10 words each". */
const countClauses = (pairs: [number, number][], one: string, many: string) =>
  runs(pairs)
    .map(
      ([x, y, w]) =>
        `${span(x, y)} ${x === y && x === 1 ? one : many}: up to ${w} words${y > 1 ? " each" : ""}`,
    )
    .join("; ");

// writer-prompt: owned by TEACH-110 v
// A wrong option's working is the belief's own result, computed correctly (TEACH-110 part ae,
// 19 Oct 2026, build/FULLMENU-RUN4.md: a KS3 hinge gave "Add 4, giving 5x = 28" for 5x + 4 = 24,
// correctness 2/5). Stated as a constraint: no worked example (no style or writing examples).
export const HINGE_WRONG_WORKING =
  "A wrong option that states working or a result gives what its belief truly produces: the mistaken step and every step after it carried out correctly, so the belief is the option's only error.";

// writer-prompt: owned by TEACH-110 v
export const HINGE_WRITER_MENU: Record<WriterStage, string> = byStage((a) => {
  const o = hingeOffer(a);
  const [lo, hi] = ends(o.options, `hinge at ${a}`);
  // Decision 32 (18 Oct 2026): options too long for the most options, such as a belief written as a
  // full sentence, take one option fewer; short options keep the most.
  const most = o.options.find(([n]) => n === hi)?.[1] ?? 0;
  const fewer = o.options.find(([n]) => n === hi - 1)?.[1] ?? 0;
  const sentences =
    hi >= 4 && fewer > most
      ? ` Options that need more words than ${hi} options allow, as a belief written as a full sentence does, take ${hi - 1} options.`
      : "";
  return `- hinge: one multiple-choice question that checks the idea just taught (flow shape check), before the lesson moves on: ${span(lo, hi)} options with exactly one right, the correct one first (code shuffles them), then each wrong option a belief pupils plausibly hold at this point, with that belief in its why (teacher notes only; the correct option's why is null). ${HINGE_WRONG_WORKING} The heading is the question itself; a longer setup goes on the slide before it. When every option is a thing one of the icon names shows, each option takes that icon and a name (picture tiles); otherwise every icon is null. Not for several questions (question-set or practice), an answer pupils write (practice), or the closing check (exit-ticket). Fits: the question up to ${o.question} words; ${countClauses(o.options, "option", "options")}; options with icons: up to ${TILE_WORDS} words each. Each limit holds only for its own option count.${sentences}`;
});

// writer-prompt: owned by TEACH-110 v
// The question length is the Fits' words alone: the line count differs by stage (KS2 one line;
// KS1 and KS3 up to two, `question-set.ts` comfort, TEACH-215 part j) and a fixed "fits one line"
// contradicted the KS1 and KS3 Fits (TEACH-110 part ae, 19 Oct 2026).
export const QUESTION_SET_WRITER_MENU: Record<WriterStage, string> = byStage((a) => {
  const q = quickOffer(a);
  const [lo, hi] = ends(
    q.map((x): [number, number] => [x.n, x.q]),
    `question-set at ${a}`,
  );
  const ans = (w: number) =>
    w === 1 ? "each answer one word or number" : `each answer up to ${w} words`;
  const parts: string[] = [];
  for (let i = 0; i < q.length; ) {
    let j = i;
    while (j + 1 < q.length && q[j + 1]?.q === q[i]?.q && q[j + 1]?.a === q[i]?.a) j += 1;
    const x = q[i] as (typeof q)[number];
    parts.push(`${span(x.n, q[j]?.n ?? x.n)} questions: up to ${x.q} words each, ${ans(x.a)}`);
    i = j + 1;
  }
  return `- question-set: a quick check: ${span(lo, hi)} short questions pupils answer at once from memory, aloud or on whiteboards (flow shape recall or check), each with its answer, which the slide reveals one click at a time. Each answer is a number, a word or a short phrase. Not for one question whose wrong options are beliefs to spot (hinge), tasks that take pupils time to work out or write (practice), or the closing check (exit-ticket); questions about a picture or diagram go to practice. Fits: ${parts.join("; ")}. Each limit holds only for its own question count.`;
});

// writer-prompt: owned by TEACH-110 v
export const PRACTICE_WRITER_MENU: Record<WriterStage, string> = byStage((a) => {
  const p = practiceOffer(a);
  const [lo, hi] = ends(p.plain, `practice at ${a}`);
  // Decision 30 (18 Oct 2026): past WORD_TASK_MAX tasks a slide holds only one-line calculations.
  const words = p.plain.filter(([n]) => n <= WORD_TASK_MAX);
  const calc = p.plain.filter(([n]) => n > WORD_TASK_MAX);
  const calcFits = runs(calc)
    .map(
      ([x, y, w]) =>
        `; ${span(x, y)} tasks, only when every task is a one-line calculation: up to ${w} words each`,
    )
    .join("");
  return `- practice: ${span(lo, hi)} tasks pupils work on alone in their books, each taking time to work out, calculate or write (flow shape check), each with the answer a pupil should reach, and a picture or diagram when the tasks work from one. More tasks take a second practice slide. Not for quick recall answered at once (question-set), one multiple-choice question (hinge), or the closing check (exit-ticket). Fits: ${countClauses(words, "task", "tasks")}${calcFits}; with a picture or diagram: ${countClauses(
    p.pic.filter(([n]) => n <= WORD_TASK_MAX),
    "task",
    "tasks",
  )}. Each limit holds only for its own task count and whether the slide has a picture or diagram.`;
});

// writer-prompt: owned by TEACH-110 v
export const EXIT_TICKET_WRITER_MENU: Record<WriterStage, string> = byStage((a) => {
  const e = exitOffer(a);
  const [lo, hi] = ends(e, `exit-ticket at ${a}`);
  return `- exit-ticket: ${span(lo, hi)} questions pupils answer alone at the end of the lesson (flow shape check), where the context puts the exit ticket, each with its answer, together checking the lesson's objectives. Not for checks during the lesson (question-set, hinge or practice). Fits: ${countClauses(e, "question", "questions")}.`;
});

// writer-prompt: owned by TEACH-110 v. One line for the three layouts that carry answers.
export const ANSWERS_RULE = `Answers on question-set, practice and exit-ticket are what a pupil should write, never a mark scheme: a number with its unit, a word or a phrase of up to ${ANSWER_WORDS.short} words, or True or False with a few words correcting a false statement; on practice and exit-ticket, an explain or describe task's answer may be one model sentence of up to ${ANSWER_WORDS.sentence} words, and the steps of a calculation go in working, as one calculation line, else null; the answer itself holds no working. Code reveals a quick check's answers on its slide and gathers the practice and exit-ticket answers onto Answers slides at the end of the deck.`;

/** What the question layouts offer at a stage: the schema's array bounds come from here. */
export function questionOffer(stage: WriterStage) {
  const a = MENU_AGE[stage];
  const q = quickOffer(a);
  const p = practiceOffer(a);
  return {
    hinge: ends(hingeOffer(a).options, "hinge"),
    "question-set": ends(
      q.map((x): [number, number] => [x.n, x.q]),
      "question-set",
    ),
    practice: ends(p.plain, "practice"),
    "exit-ticket": ends(exitOffer(a), "exit-ticket"),
  };
}

/** Each layout's menu, by the slot name its line takes in a system template (`{{menu:<layout>}}`). */
export const LAYOUT_WRITER_MENUS = {
  "items-row": ITEMS_ROW_WRITER_MENU,
  "panel-list": PANEL_LIST_WRITER_MENU,
  "split-compare": SPLIT_COMPARE_WRITER_MENU,
  hinge: HINGE_WRITER_MENU,
  "question-set": QUESTION_SET_WRITER_MENU,
  practice: PRACTICE_WRITER_MENU,
  "exit-ticket": EXIT_TICKET_WRITER_MENU,
} as const;
/** Shared rules a template takes by slot (`{{rule:<name>}}`), each exactly once. */
export const WRITER_RULES = { answers: ANSWERS_RULE } as const;

/**
 * A writer system text from its template: each `{{menu:<layout>}}` slot (exactly once each) becomes
 * that layout's line for the stage. Throws on a missing, repeated or unknown slot, so a template can
 * never ship with a hand copy in place of a slot or a slot left unfilled.
 */
export function assembleWriterSystem(
  template: string,
  stage: WriterStage,
  waveCOpts: WaveCMenuOpts = {},
): string {
  let out = template;
  for (const [layout, menu] of Object.entries(LAYOUT_WRITER_MENUS)) {
    const slot = `{{menu:${layout}}}`;
    if (out.split(slot).length !== 2)
      throw new Error(`writer system: ${slot} must appear exactly once`);
    out = out.replace(slot, () => menu[stage]);
  }
  // Wave C (TEACH-110 part v): its lines as one block, in a template that offers it (v4.8).
  const block = "{{menu:wave-c}}";
  const blocks = out.split(block).length - 1;
  if (blocks > 1) throw new Error(`writer system: ${block} must appear at most once`);
  if (blocks) out = out.replace(block, () => waveCMenuBlock(stage, waveCOpts));
  for (const [name, rule] of Object.entries(WRITER_RULES)) {
    const slot = `{{rule:${name}}}`;
    if (out.split(slot).length !== 2)
      throw new Error(`writer system: ${slot} must appear exactly once`);
    out = out.replace(slot, () => rule);
  }
  if (out.includes("{{menu:") || out.includes("{{rule:"))
    throw new Error("writer system: an unknown {{menu:...}} or {{rule:...}} slot");
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

/** Word caps per item count: `{ 2: 12, 3: 11 }`. */
export type CountCaps = Record<number, number>;
const countCaps = (pairs: [number, number][]): CountCaps => Object.fromEntries(pairs);

/**
 * Every word cap the menu's Fits clauses state at a stage, as data (TEACH-110 part af): the same
 * numbers the menu lines print, read from the same functions, so an eval scores a slide's fill
 * against the cap the writer was shown without parsing prompt prose. A heading cap is the one the
 * menu states for that variant, or the stage's `HEAD_WORDS` where it states none.
 */
export function menuWordCaps(stage: WriterStage) {
  const a = MENU_AGE[stage];
  const listOf = (c: ListLayout, v: ListVariant, lead: boolean) =>
    countCaps(
      (lead ? leadNs(c, a, v) : NS(c, a, v)).map((n): [number, number] => [
        n,
        itemBudget(c, a, n, lead, v),
      ]),
    );
  const leadCap = (c: ListLayout, v: ListVariant = "") =>
    leadNs(c, a, v).length ? leadWords(c, a, v) : null;
  const headCap = (c: ListLayout, v: ListVariant, lead: boolean) =>
    (lead ? leadNs(c, a, v) : NS(c, a, v)).length ? headWords(c, a, lead, v) : HEAD_WORDS[a];
  const p = practiceOffer(a);
  const h = hingeOffer(a);
  const q = quickOffer(a);
  return {
    "items-row": {
      heading: {
        icons: headCap("items-row", "", false),
        num: headCap("items-row", "num", false),
        lead: headCap("items-row", "", true),
      },
      lead: leadCap("items-row"),
      items: {
        icons: listOf("items-row", "", false),
        num: listOf("items-row", "num", false),
        lead: listOf("items-row", "", true),
      },
    },
    "panel-list": {
      heading: {
        plain: headCap("panel-list", "", false),
        pics: headCap("panel-list", "pics", false),
        lead: headCap("panel-list", "", true),
        picsLead: headCap("panel-list", "pics", true),
      },
      lead: { plain: leadCap("panel-list"), pics: leadCap("panel-list", "pics") },
      items: {
        plain: listOf("panel-list", "", false),
        pics: listOf("panel-list", "pics", false),
        lead: listOf("panel-list", "", true),
        picsLead: listOf("panel-list", "pics", true),
      },
    },
    "split-compare": {
      title: titleWords(a),
      /** Keyed `<sides><zone>`: "2", "3", "2p", "2q" (the zones `SideZone` names). */
      sides: Object.fromEntries(
        SC_KEYS[a].map((k) => [k, sideBudget(a, Number(k[0]), k.slice(1) as SideZone)]),
      ) as Record<string, number>,
      quote: countCaps(
        SC_KEYS[a]
          .filter((k) => k.endsWith("q"))
          .map((k): [number, number] => [Number(k[0]), quoteBudget(a, Number(k[0]))]),
      ),
    },
    hinge: { question: h.question, options: countCaps(h.options), tile: TILE_WORDS },
    "question-set": {
      questions: countCaps(q.map((x): [number, number] => [x.n, x.q])),
      answers: countCaps(q.map((x): [number, number] => [x.n, x.a])),
    },
    practice: { plain: countCaps(p.plain), picture: countCaps(p.pic) },
    "exit-ticket": { questions: countCaps(exitOffer(a)) },
  };
}
export type MenuWordCaps = ReturnType<typeof menuWordCaps>;

/** One shown menu cell: its words, the most the slide holds (room) and its need row. */
export type ShownCell = { cell: string; shown: number; room: number; need: string };

/**
 * Every need-aware body cell the menu offers at a stage, with the room it was shown against
 * (CAP-NEED-AUDIT.md, 18 Oct 2026). For the test that no shown cap exceeds its room and none sits
 * under its need where the room allows it.
 */
export function shownCells(stage: WriterStage): ShownCell[] {
  const a = MENU_AGE[stage];
  const out: ShownCell[] = [];
  for (const c of ["items-row", "panel-list"] as const)
    for (const v of (c === "items-row" ? ["", "num"] : ["", "pics"]) as ListVariant[])
      for (const lead of [false, true])
        for (const n of lead ? leadNs(c, a, v) : NS(c, a, v)) {
          const caps = must(listCaps(c, a, n, lead, v), `${c} ${a} ${n}`);
          out.push({
            cell: `${c} ${n}${v}${lead ? "+lead" : ""} item`,
            shown: itemBudget(c, a, n, lead, v),
            room: menuWords(caps.text ?? 0, a),
            need: `${c}.item`,
          });
        }
  for (const k of SC_KEYS[a]) {
    const z = k.slice(1) as SideZone;
    const chars = must(sideCaps(a, Number(k[0]), z), k).text ?? 0;
    out.push({
      cell: `split-compare ${k} side`,
      shown: sideBudget(a, Number(k[0]), z),
      room: menuWords(z === "p" ? chars * PIC_SIDE_HEADROOM : chars, a),
      need: "split-compare.side",
    });
  }
  const c = HINGE_CAP[a];
  for (const [n, w] of hingeOffer(a).options)
    out.push({
      cell: `hinge ${n} option`,
      shown: w,
      room: Math.min(
        (c.byCount?.[String(n)] ?? c).words,
        wordsWithin((c.byCount?.[String(n)] ?? c).maxChars ?? c.chars, STAGE_OF[a]),
      ),
      need: "hinge.option",
    });
  for (const [n, cell] of Object.entries(QUICK[a] ?? {})) {
    const x = quickOffer(a).find((q) => q.n === Number(n));
    if (!x) continue;
    out.push({
      cell: `question-set ${n} question`,
      shown: x.q,
      room: probeRoom(
        cell.questions.cap,
        cell.questions.hardMax ?? cell.questions.cap,
        STAGE_OF[a],
      ),
      need: "question-set.question",
    });
    out.push({
      cell: `question-set ${n} answer`,
      shown: x.a,
      room: menuWords(cell.answers.cap, a),
      need: "question-set.answer",
    });
  }
  const p = practiceOffer(a);
  for (const [kind, offer, cells] of [
    ["practice", p.plain, WORK[a].practice],
    ["practice+picture", p.pic, WORK[a]["practice+picture"]],
    ["exit", exitOffer(a), WORK[a].exit],
  ] as const)
    for (const [n, w] of offer) {
      const caps = [cells, kind === "practice+picture" ? WORK[a]["practice+figure"] : []]
        .flat()
        .filter((x) => x.n === n)
        .map((x) => x.cap);
      out.push({
        cell: `${kind} ${n}`,
        shown: w,
        room: menuWords(Math.min(...caps), a),
        need: kind === "exit" ? "exit-ticket.question" : "practice.task",
      });
    }
  return out;
}

/** The question layouts' field caps (characters), keyed `field` (top) or `list[].field` (members). */
export type QuestionFieldCaps = Record<
  "hinge" | "question-set" | "practice" | "exit-ticket",
  Fields
>;

/**
 * The loosest measured cap (characters) each question layout's fields reach over the counts its
 * menu offers at a stage: the same tables as their Fits. Code logs every field against these
 * (`slotFillArrival`, the fill scorer's `capWords`); the writer never sees them as `maxLength`.
 * Practice and exit answers go to the end Answers slides and are measured there, so not here.
 */
export function questionFieldCaps(stage: WriterStage): QuestionFieldCaps {
  const a = MENU_AGE[stage];
  const o = questionOffer(stage);
  const within = ([lo, hi]: readonly [number, number], n: number) => n >= lo && n <= hi;
  const loosest = (cells: WorkCell[], counts: number[]) =>
    Math.max(0, ...cells.filter((c) => counts.includes(c.n)).map((c) => c.cap));
  const quick = Object.entries(QUICK[a] ?? {}).filter(([n]) =>
    within(o["question-set"], Number(n)),
  );
  const p = practiceOffer(a);
  const hinge = HINGE_CAP[a];
  const stem = HINGE[stage]?.stem;
  return {
    hinge: {
      heading: stem ?? 0,
      // The loosest offered count's own measured room (fewer options hold more, 18 Oct 2026).
      "options[].text": Math.max(
        hinge?.chars ?? 0,
        ...hingeOffer(a).options.map(([n]) => hinge?.byCount?.[String(n)]?.chars ?? 0),
      ),
    },
    "question-set": {
      "items[].question": Math.max(0, ...quick.map(([, c]) => c.questions.cap)),
      "items[].answer": Math.max(0, ...quick.map(([, c]) => c.answers.cap)),
    },
    practice: {
      "items[].question": Math.max(
        loosest(
          WORK[a].practice,
          p.plain.map(([n]) => n),
        ),
        loosest(
          WORK[a]["practice+picture"],
          p.pic.map(([n]) => n),
        ),
      ),
    },
    "exit-ticket": {
      "items[].question": loosest(
        WORK[a].exit,
        exitOffer(a).map(([n]) => n),
      ),
    },
  };
}

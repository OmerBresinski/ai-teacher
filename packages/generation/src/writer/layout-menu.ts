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
import HINGE_CARDS from "./hinge-cards.gen.json" with { type: "json" };
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
/**
 * Pictured sides are offered this share of their measured comfortable characters (PROCESS 7.2's 80%
 * headroom). Past the cap the words win and the pictures shrink to slivers: y4-romans s3 (16 Oct)
 * wrote 112 characters against KS2's 101 under a 15-word line, and its photos fell to 29% of the
 * field (build/PICS-TRACE-16OCT.md). Words-only and quote sides overflow into type, not pictures.
 */
export const PIC_SIDE_HEADROOM = 0.8;
function sideBudget(a: Age, n: number, z: SideZone): number {
  const caps = must(sideCaps(a, n, z), `split-compare ${a} ${n}${z}`);
  const chars = (caps.text ?? 0) * (z === "p" ? PIC_SIDE_HEADROOM : 1);
  return Math.min(
    Math.floor(SLIDE_WORDS / n) - (z === "q" ? quoteBudget(a, n) : 0),
    SIDE_SENT[a],
    menuWords(chars, a),
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
  let pic = `When each side is a thing a camera or diagram can show (an object, a place, a living thing, a scene before or after a change), every side carries a picture${no3(a, "p") === "2 or 3" ? "" : " (2 sides only)"}, or a diagram when the difference is in how each is built or works`;
  if (SC_KEYS[a].some((k) => k.endsWith("q")))
    pic += `; when the sides are people's viewpoints, every side carries a quote in their voice${no3(a, "q") === "2 or 3" ? "" : " (2 sides only)"}`;
  return `${pic}. Sides carry neither only when they are ideas that no picture, diagram or quote shows.`;
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
  return `- items-row: ${countWords("items-row", a)} named parts of one whole that work together (flow shape parts of a whole), in a row on a connecting line, each a name pupils learn and its job in one short line. ${more} or more parts go to a labelled diagram or two slides. Never the steps of a method or calculation, even in order (steps or equation-hero), or the stages of a process (steps or picture-sequence); not for an idea with its reasons (explain), a set of kinds or examples (panel-list), or a contrast (split-compare). motif: vessel for circulation, stem for a plant, else null (a plain line). Fits: ${fitsRow(a)}.`;
});

// writer-prompt: owned by TEACH-110 s
export const PANEL_LIST_WRITER_MENU: Record<WriterStage, string> = byStage(
  (a) =>
    `- panel-list: a set of ${countWords("panel-list", a)} kinds, examples or rules of one group (flow shape a set of kinds or examples), as a list beside a title panel, each a name and one fact about it, when order does not matter. Three or more kinds of one group always come here, even when each fact differs on the same feature; two members come here when the point is the set, not how they differ. Parts that work together go to items-row, and the steps of a method, numbered or not, go to steps or equation-hero; a set whose members each need a paragraph takes a slide each; more members take two slides. When each member is a thing pupils need to see (an organism, a rock, a place, an object), every item gets a picture of it alone, one object or simple scene with no labels (a small tile), and the panel is null. Otherwise the panel holds a pie when the items are shares of one known whole, else a photo of the whole group whenever a camera can show the members together (the tools on a workbench, the instruments of a band); it is null only when neither fits. Rules, reasons and ideas take picture null, and icons when every item has a fitting one (see Icons). Fits: ${fitsItems("panel-list", a)}. With a picture on every item: ${fitsPics(a)}. Each limit holds only for its own item count and whether the items carry pictures.`,
);

// writer-prompt: owned by TEACH-110 s
export const SPLIT_COMPARE_WRITER_MENU: Record<WriterStage, string> = byStage(
  (a) =>
    `- split-compare: a vs: ${sideSpan(a)} things set against each other (flow shape a contrast) in edge-to-edge colour fields, each a title and a sentence or two, when the contrast is the point: opposites, viewpoints, before and after a change in the world, or two kinds that differ on the same features, each side answering the same question in the same order. Never a mistake against its correction (the misconception slide), two worked examples of one method, or two uses of one rule or sentence pattern (equation-hero or explain): every side is true and a thing in its own right. Three or more kinds of one group are a set, not a vs, even when they differ on the same feature and each wants a picture or diagram: panel-list; so are two examples of one idea. Four or more things compared on several features go to a table. ${media(a)} What the sides share goes in the heading, or in a few words each side opens with; the rest of each side says how it differs, never padded. A side's title names its thing in up to ${titleWords(a)} words; a longer idea goes in the side's text, never split across title and text. Fits: ${fitsSides(a)}. Each limit holds only for its own side count and zone, so settle how many sides and whether they carry pictures or quotes before writing.`,
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
const MIN_TASK: Record<Age, number> = { early: 3, primary: 4, secondary: 4 };
const MIN_QUICK_Q = 4;
const MIN_OPTION = 2;
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
      q: menuWords(c.questions.cap, a),
      a: menuWords(c.answers.cap, a),
    }))
    .filter((x) => x.q >= MIN_QUICK_Q && x.a >= 1)
    .sort((x, y) => x.n - y.n);
const workBudget = (a: Age, cells: WorkCell[], max = 99): [number, number][] =>
  cells
    .filter((c) => c.n <= max)
    .map((c): [number, number] => [c.n, Math.min(TASK_SENT[a], menuWords(c.cap, a))])
    .filter(([, w]) => w >= MIN_TASK[a]);
const practiceOffer = (a: Age) => ({
  plain: workBudget(a, WORK[a].practice),
  // A picture and a figure are measured apart: offer the smaller per count.
  pic: workBudget(a, WORK[a]["practice+picture"], PIC_MAX[a]).map(([n, w]): [number, number] => {
    const f = WORK[a]["practice+figure"].find((c) => c.n === n);
    return [n, f ? Math.min(w, menuWords(f.cap, a)) : w];
  }),
});
const exitOffer = (a: Age) => workBudget(a, WORK[a].exit);
/**
 * The hinge's option offer is #539's renderer-measured `hinge-capacity.json`: one word budget per
 * age, measured with the most options the age takes (3 at KS1, 4 otherwise), so it holds for fewer.
 * The question's budget is the writer's hinge card table (`hinge-cards.gen.json`, regenerated by
 * #539 from the same layout).
 */
type HingeCap = { words: number; options: number };
const HINGE_CAP = HINGE_CAPACITY as unknown as Record<Age, HingeCap>;
const hingeOffer = (a: Age) => {
  const g = HINGE[STAGE_OF[a]];
  const c = HINGE_CAP[a];
  if (!g || !c) throw new Error(`layout menu: no hinge table for ${a}`);
  return {
    question: menuWords(g.stem, a),
    options: Array.from({ length: c.options - 1 }, (_, i): [number, number] => [i + 2, c.words]),
  };
};
const ends = (p: [number, number][], what: string) => {
  const lo = p[0]?.[0];
  const hi = p.at(-1)?.[0];
  if (lo === undefined || hi === undefined) throw new Error(`layout menu: ${what} offers nothing`);
  return [lo, hi] as const;
};
/** Runs of counts with one budget, each clause whole: "3 to 4 tasks: up to 10 words each". */
const countClauses = (pairs: [number, number][], one: string, many: string) =>
  runs(pairs)
    .map(
      ([x, y, w]) =>
        `${span(x, y)} ${x === y && x === 1 ? one : many}: up to ${w} words${y > 1 ? " each" : ""}`,
    )
    .join("; ");

// writer-prompt: owned by TEACH-110 v
export const HINGE_WRITER_MENU: Record<WriterStage, string> = byStage((a) => {
  const o = hingeOffer(a);
  const [lo, hi] = ends(o.options, `hinge at ${a}`);
  return `- hinge: one multiple-choice question that checks the idea just taught (flow shape check), before the lesson moves on: ${span(lo, hi)} options with exactly one right, the correct one first (code shuffles them), then each wrong option a belief pupils plausibly hold at this point, with that belief in its why (teacher notes only; the correct option's why is null). The heading is the question itself; a longer setup goes on the slide before it. When every option is a thing one of the icon names shows, each option takes that icon and a name (picture tiles); otherwise every icon is null. Not for several questions (question-set or practice), an answer pupils write (practice), or the closing check (exit-ticket). Fits: the question up to ${o.question} words; ${countClauses(o.options, "option", "options")}; options with icons: up to ${TILE_WORDS} words each. Each limit holds only for its own option count.`;
});

// writer-prompt: owned by TEACH-110 v
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
  return `- question-set: a quick check: ${span(lo, hi)} short questions pupils answer at once from memory, aloud or on whiteboards (flow shape recall or check), each with its answer, which the slide reveals one click at a time. Each question fits one line; each answer is a number, a word or a short phrase. Not for one question whose wrong options are beliefs to spot (hinge), tasks that take pupils time to work out or write (practice), or the closing check (exit-ticket); questions about a picture or diagram go to practice. Fits: ${parts.join("; ")}. Each limit holds only for its own question count.`;
});

// writer-prompt: owned by TEACH-110 v
export const PRACTICE_WRITER_MENU: Record<WriterStage, string> = byStage((a) => {
  const p = practiceOffer(a);
  const [lo, hi] = ends(p.plain, `practice at ${a}`);
  return `- practice: ${span(lo, hi)} tasks pupils work on alone in their books, each taking time to work out, calculate or write (flow shape check), each with the answer a pupil should reach, and a picture or diagram when the tasks work from one. More tasks take a second practice slide. Not for quick recall answered at once (question-set), one multiple-choice question (hinge), or the closing check (exit-ticket). Fits: ${countClauses(p.plain, "task", "tasks")}; with a picture or diagram: ${countClauses(p.pic, "task", "tasks")}. Each limit holds only for its own task count and whether the slide has a picture or diagram.`;
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
export function assembleWriterSystem(template: string, stage: WriterStage): string {
  let out = template;
  for (const [layout, menu] of Object.entries(LAYOUT_WRITER_MENUS)) {
    const slot = `{{menu:${layout}}}`;
    if (out.split(slot).length !== 2)
      throw new Error(`writer system: ${slot} must appear exactly once`);
    out = out.replace(slot, () => menu[stage]);
  }
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

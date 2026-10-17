import { type MenuWordCaps, menuWordCaps } from "../src/writer/layout-menu";
import type { WriterStage } from "../src/writer/schema";

/*
 * Fill scoring for the writer's output (TEACH-110 part af): every capped field's length against
 * the cap the menu showed the writer, field by field, and a check that each slide the writer
 * planned fits its layout's cap before a word is written. A port of the lab's
 * `writer-smoke/fill.py` (CRAMMING-ROOT-CAUSE.md, 17 Oct 2026) with one change: the caps come from
 * `menuWordCaps` (the numbers the menu prints, as data), never from parsing the prompt's prose.
 * Fit layouts (no menu line of their own) are scored from the stage's `slot-fill` log events,
 * whose `capWords` are the slot-fill table's. No model calls.
 */

type J = Record<string, unknown>;

/** One capped field: what the writer wrote against what it was shown. */
export interface FieldFill {
  /** The lesson (brief id) the field is from, so a pooled report keeps lessons apart. */
  lesson: string;
  /** Deck position: title 1, objectives 2, `slides[i]` is i + 3, the close follows them. */
  slide: number;
  template: string;
  path: string;
  words: number;
  cap: number;
  /** Not a heading, side title, label or instruction: the fields the cramming study counts. */
  body: boolean;
}

/** The writer's own log events the scorer reads (`ev: "slot-fill"`, `ev: "pilot-fit"`). */
export interface WriterEvent {
  /** Set when events of several lessons are pooled (`fillReport`). */
  lesson?: string;
  ev?: string;
  slide?: number;
  route?: string;
  path?: string;
  fields?: { path: string; words: number; capWords: number }[];
}

/** A pilot-fit outcome that left the slide over its measured room (fill.py's "measured"). */
const MEASURED_OVER = new Set(["tight", "trimmed", "still-over", "clipped"]);

export const words = (s: unknown): number =>
  typeof s === "string" ? s.split(/\s+/).filter(Boolean).length : 0;

const NOT_BODY = ["heading", "title", "label", "instruction"];
const isBody = (path: string) => !NOT_BODY.some((x) => path.includes(x));

/** The writer stage a lesson's key stage writes at (`stageOf` in stages/write.ts). */
export function writerStageOf(ks: string): WriterStage {
  return ks === "ks1" ? "KS1" : ks === "ks2" ? "KS2" : "KS3-5";
}

const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);
const text = (x: unknown): unknown => (typeof x === "object" && x !== null ? (x as J).text : x);

/**
 * The capped fields of one slide written to a menu layout, or null for any other template (a fit
 * layout is scored from its slot-fill event instead). A field whose cell the menu does not offer
 * (an item count it never shows) gets no cap and is left out, as fill.py leaves it out.
 */
export function menuSlideFields(
  s: J,
  caps: MenuWordCaps,
): { path: string; words: number; cap: number | undefined }[] | null {
  const t = s.template;
  const out: { path: string; words: number; cap: number | undefined }[] = [];
  if (t === "items-row" || t === "panel-list") {
    const items = arr(s.items);
    const n = items.length;
    const lead = typeof s.lead === "string" && s.lead.trim() !== "";
    let heading: number;
    let item: number | undefined;
    let leadCap: number | null;
    if (t === "items-row") {
      const c = caps["items-row"];
      const num = n > 0 && items.every((i) => i.icon == null) && c.items.num[n] !== undefined;
      heading = lead ? c.heading.lead : num ? c.heading.num : c.heading.icons;
      item = lead ? c.items.lead[n] : num ? c.items.num[n] : c.items.icons[n];
      leadCap = c.lead;
    } else {
      const c = caps["panel-list"];
      const pics = n > 0 && items.every((i) => i.picture != null && i.picture !== false);
      heading = pics
        ? lead
          ? c.heading.picsLead
          : c.heading.pics
        : lead
          ? c.heading.lead
          : c.heading.plain;
      item = pics
        ? lead
          ? c.items.picsLead[n]
          : c.items.pics[n]
        : lead
          ? c.items.lead[n]
          : c.items.plain[n];
      leadCap = pics ? c.lead.pics : c.lead.plain;
    }
    out.push({ path: "heading", words: words(s.heading), cap: heading });
    if (lead) out.push({ path: "lead", words: words(s.lead), cap: leadCap ?? undefined });
    items.forEach((it, i) => {
      out.push({ path: `items[${i}].text`, words: words(it.text), cap: item });
    });
    return out;
  }
  if (t === "split-compare") {
    const c = caps["split-compare"];
    const sides = arr(s.sides);
    const n = sides.length;
    const z = sides.some((x) => x.quote) ? "q" : sides.some((x) => x.picture) ? "p" : "";
    sides.forEach((x, i) => {
      out.push({ path: `sides[${i}].title`, words: words(x.title), cap: c.title });
      out.push({ path: `sides[${i}].text`, words: words(x.text), cap: c.sides[`${n}${z}`] });
      if (x.quote) out.push({ path: `sides[${i}].quote`, words: words(x.quote), cap: c.quote[n] });
    });
    return out;
  }
  if (t === "hinge") {
    const c = caps.hinge;
    const options = Array.isArray(s.options) ? (s.options as unknown[]) : [];
    out.push({ path: "heading(question)", words: words(s.heading), cap: c.question });
    options.forEach((o, i) => {
      const icon = typeof o === "object" && o !== null && (o as J).icon != null;
      out.push({
        path: `options[${i}]`,
        words: words(text(o)),
        cap: icon ? c.tile : c.options[options.length],
      });
    });
    return out;
  }
  if (t === "question-set" || t === "practice" || t === "exit-ticket") {
    const items = arr(s.items);
    const n = items.length;
    let q: number | undefined;
    let a: number | undefined;
    if (t === "question-set") {
      q = caps["question-set"].questions[n];
      a = caps["question-set"].answers[n];
    } else if (t === "practice") {
      q = (s.picture ? caps.practice.picture : caps.practice.plain)[n];
    } else q = caps["exit-ticket"].questions[n];
    items.forEach((it, i) => {
      out.push({ path: `items[${i}].question`, words: words(it.question), cap: q });
      if (a !== undefined)
        out.push({ path: `items[${i}].answer`, words: words(it.answer), cap: a });
    });
    return out;
  }
  return null;
}

/** Every capped field in a writer output: its slides and its close, menu or slot-fill caps. */
export function deckFields(
  writer: J,
  stage: WriterStage,
  events: WriterEvent[],
  lesson = "",
): FieldFill[] {
  const caps = menuWordCaps(stage);
  const slotFill = new Map<number, WriterEvent>();
  for (const e of events)
    if (e.ev === "slot-fill" && e.slide !== undefined) slotFill.set(e.slide, e);
  const slides = arr(writer.slides);
  const all: [number, J][] = slides.map((s, i) => [i + 3, s]);
  if (writer.close && typeof writer.close === "object")
    all.push([slides.length + 3, writer.close as J]);
  const out: FieldFill[] = [];
  for (const [no, s] of all) {
    const template = String(s.template ?? "");
    let fields: { path: string; words: number; cap: number | undefined }[] | null = null;
    if (!("fit" in s)) fields = menuSlideFields(s, caps);
    if (fields === null) {
      const seen = new Set<string>();
      fields = [];
      for (const f of slotFill.get(no)?.fields ?? []) {
        if (seen.has(f.path)) continue;
        seen.add(f.path);
        fields.push({ path: f.path, words: f.words, cap: f.capWords });
      }
    }
    for (const f of fields)
      if (f.cap && f.cap > 0)
        out.push({
          lesson,
          slide: no,
          template,
          path: f.path,
          words: f.words,
          cap: f.cap,
          body: isBody(f.path),
        });
  }
  return out;
}

export interface FillBuckets {
  "<50": number;
  "50-70": number;
  "70-90": number;
  "90-100": number;
  ">100": number;
}

export interface FillStats {
  fields: number;
  /** Percent of fields in each fill band (fill.py's bands; 90-100 holds exactly-at-cap). */
  buckets: FillBuckets;
  /** Percent at 90–100% of cap: the near-cap share loop 1 halves. */
  nearCapPct: number;
  /** Percent over cap. */
  overPct: number;
  /** Median of words / cap, as a percent. */
  medianFillPct: number | null;
}

export interface FillReport {
  /** Body fields (the cramming study's set). */
  body: FillStats;
  /** Every capped field, headings and titles included. */
  all: FillStats;
  byLayout: Record<string, FillStats>;
  /** Slides with a field over cap, a measured overflow, or half their body fields at 90%+. */
  crammed: {
    lesson: string;
    slide: number;
    template: string;
    why: "over cap" | "measured" | "dense";
  }[];
  /** Slides the renderer's fit left over their measured room (pilot-fit) or slot-fill blamed. */
  clippedSlides: { lesson: string; slide: number }[];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function fillStats(ratios: number[]): FillStats {
  const n = ratios.length;
  const pct = (k: number) => (n === 0 ? 0 : round1((100 * k) / n));
  const count = (lo: number, hi: number) => ratios.filter((r) => r >= lo && r < hi).length;
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median =
    n === 0 ? null : n % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  const near = count(0.9, 1.0001);
  return {
    fields: n,
    buckets: {
      "<50": pct(count(0, 0.5)),
      "50-70": pct(count(0.5, 0.7)),
      "70-90": pct(count(0.7, 0.9)),
      "90-100": pct(near),
      ">100": pct(count(1.0001, Number.POSITIVE_INFINITY)),
    },
    nearCapPct: pct(near),
    overPct: pct(ratios.filter((r) => r > 1).length),
    medianFillPct: median === null ? null : Math.round(100 * median),
  };
}

export function fillReport(fields: FieldFill[], events: WriterEvent[]): FillReport {
  const ratio = (f: FieldFill) => f.words / f.cap;
  const body = fields.filter((f) => f.body);
  const byLayout: Record<string, number[]> = {};
  for (const f of body) {
    const list = byLayout[f.template] ?? [];
    list.push(ratio(f));
    byLayout[f.template] = list;
  }
  // Slides are numbered per lesson: a slide is its lesson and number.
  const key = (lesson: string | undefined, slide: number) => `${lesson ?? ""}#${slide}`;
  const measured = new Map<string, { lesson: string; slide: number }>();
  for (const e of events) {
    if (e.slide === undefined) continue;
    const over =
      (e.ev === "pilot-fit" && e.path !== undefined && MEASURED_OVER.has(e.path)) ||
      (e.ev === "slot-fill" && e.route === "writer-fault");
    if (over) measured.set(key(e.lesson, e.slide), { lesson: e.lesson ?? "", slide: e.slide });
  }
  const bySlide = new Map<string, FieldFill[]>();
  for (const f of fields) {
    const k = key(f.lesson, f.slide);
    bySlide.set(k, [...(bySlide.get(k) ?? []), f]);
  }
  const crammed: FillReport["crammed"] = [];
  for (const [k, own] of bySlide) {
    const first = own[0];
    if (!first) continue;
    const ownBody = own.filter((f) => f.body);
    const hi = ownBody.filter((f) => ratio(f) >= 0.9).length;
    const why = own.some((f) => f.words > f.cap)
      ? "over cap"
      : measured.has(k)
        ? "measured"
        : ownBody.length > 0 && hi * 2 >= ownBody.length
          ? "dense"
          : null;
    if (why)
      crammed.push({ lesson: first.lesson, slide: first.slide, template: first.template, why });
  }
  return {
    body: fillStats(body.map(ratio)),
    all: fillStats(fields.map(ratio)),
    byLayout: Object.fromEntries(
      Object.entries(byLayout).map(([t, rs]) => [t, fillStats(rs)] as const),
    ),
    crammed,
    clippedSlides: [...measured.values()],
  };
}

/*
 * The plan-only check: the writer's `flow` (written before its `slides` key) names each slide's
 * shape and, in its own words, its size ("Four pictured items, four words each"). The shape picks
 * the menu layout; the size's count and words per item are read from the plan and checked against
 * that layout's cap for the count. The plan is the model's prose, so a size that names no count is
 * `unparsed`, not a pass; a shape no menu layout takes is not checked.
 */

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  "twenty-five": 25,
  thirty: 30,
  forty: 40,
};
const NUM = `(\\d+|${Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|")})`;
const toNum = (s: string | undefined) =>
  s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s.toLowerCase()];

/** The first "<n> [adjectives] <unit>" in a size, and "<w> words" (per item) if stated. */
export function parseSize(size: string, units: string[]): { count?: number; words?: number } {
  const s = size.toLowerCase();
  const unit = new RegExp(`\\b${NUM}\\s+(?:[a-z-]+\\s+){0,2}?(?:${units.join("|")})\\b`);
  const w = new RegExp(`\\b${NUM}\\s+words?\\b`);
  const count = toNum(unit.exec(s)?.[1]);
  const per = toNum(w.exec(s)?.[1]);
  return {
    ...(count !== undefined ? { count } : {}),
    ...(per !== undefined ? { words: per } : {}),
  };
}

export type PlanVerdict = "fits" | "near-cap" | "over" | "no-cell" | "unparsed";

export interface PlannedSlide {
  slide: number;
  shape: string;
  size: string;
  layout: string | null;
  count?: number;
  words?: number;
  cap?: number;
  verdict: PlanVerdict | "unchecked";
}

export interface PlanFitReport {
  /**
   * Always true: the writer's flow names a shape and a free-text size, never a layout id or an
   * item count, so the layout is inferred from the shape and the count read from the size.
   */
  approximate: true;
  planned: number;
  checked: number;
  counts: Record<PlanVerdict, number>;
  slides: PlannedSlide[];
}

/**
 * The flow shapes the writer prompt names (its step 2 list) that a menu layout takes. Matched
 * against the plan's `shape`; fill.test.ts checks every one is still in each stage's system text,
 * so a renamed shape fails a test instead of turning slides `unchecked`.
 */
export const PLAN_SHAPES = {
  parts: "parts of a whole",
  set: "a set of kinds or examples",
  contrast: "a contrast",
  check: "check",
  recall: "recall",
} as const;

const ITEM_UNITS = [
  "items",
  "parts",
  "kinds",
  "examples",
  "members",
  "things",
  "rules",
  "cards",
  "boxes",
  "tiles",
];

/** The menu layout a planned slide's shape and size point at, and the nouns its size counts. */
function layoutForPlan(
  p: { shape: string; size: string },
  last: boolean,
): { layout: string; units: string[] } | null {
  const shape = p.shape.toLowerCase();
  const size = p.size.toLowerCase();
  if (shape.includes(PLAN_SHAPES.parts)) return { layout: "items-row", units: ITEM_UNITS };
  if (shape.includes(PLAN_SHAPES.set)) return { layout: "panel-list", units: ITEM_UNITS };
  if (shape.includes(PLAN_SHAPES.contrast))
    return { layout: "split-compare", units: ["sides", "things", "columns"] };
  if (shape === PLAN_SHAPES.check || shape === PLAN_SHAPES.recall) {
    if (/\boptions?\b|choices?\b/.test(size))
      return { layout: "hinge", units: ["options", "choices"] };
    if (/\btasks?\b/.test(size)) return { layout: "practice", units: ["tasks", "questions"] };
    if (last) return { layout: "exit-ticket", units: ["questions"] };
    if (/\bquestions?\b/.test(size)) return { layout: "question-set", units: ["questions"] };
  }
  return null;
}

export function planFit(flow: unknown, stage: WriterStage): PlanFitReport {
  const caps = menuWordCaps(stage);
  const rows = arr(flow);
  const slides: PlannedSlide[] = rows.map((r, i) => {
    const shape = String(r.shape ?? "");
    const size = String(r.size ?? "");
    const look = String((r.look_at as J | undefined)?.kind ?? "none");
    const slide = typeof r.slide === "number" ? r.slide : i + 1;
    // Slides 1 and 2 are the title and the objectives: no menu layout takes them.
    const hit = slide <= 2 ? null : layoutForPlan({ shape, size }, i === rows.length - 1);
    if (!hit) return { slide, shape, size, layout: null, verdict: "unchecked" };
    const { count, words: w } = parseSize(size, hit.units);
    const base = {
      slide,
      shape,
      size,
      layout: hit.layout,
      ...(count !== undefined ? { count } : {}),
      ...(w !== undefined ? { words: w } : {}),
    };
    if (count === undefined) return { ...base, verdict: "unparsed" };
    const pictured = look === "picture" || /\bpictur|\bphoto|\bdiagram/.test(size.toLowerCase());
    let cap: number | undefined;
    switch (hit.layout) {
      case "items-row":
        cap = caps["items-row"].items.icons[count] ?? caps["items-row"].items.num[count];
        break;
      case "panel-list":
        cap = (pictured ? caps["panel-list"].items.pics : caps["panel-list"].items.plain)[count];
        break;
      case "split-compare": {
        const sides = caps["split-compare"].sides;
        cap = /\bquot/.test(size.toLowerCase())
          ? sides[`${count}q`]
          : pictured
            ? (sides[`${count}p`] ?? sides[`${count}`])
            : sides[`${count}`];
        break;
      }
      case "hinge":
        cap = caps.hinge.options[count];
        break;
      case "practice":
        cap = (pictured ? caps.practice.picture : caps.practice.plain)[count];
        break;
      case "exit-ticket":
        cap = caps["exit-ticket"].questions[count];
        break;
      case "question-set":
        cap = caps["question-set"].questions[count];
        break;
    }
    if (cap === undefined) return { ...base, verdict: "no-cell" };
    const verdict: PlanVerdict =
      w === undefined || w < 0.9 * cap ? "fits" : w <= cap ? "near-cap" : "over";
    return { ...base, cap, verdict };
  });
  const counts: Record<PlanVerdict, number> = {
    fits: 0,
    "near-cap": 0,
    over: 0,
    "no-cell": 0,
    unparsed: 0,
  };
  for (const s of slides) if (s.verdict !== "unchecked") counts[s.verdict] += 1;
  return {
    approximate: true,
    planned: slides.length,
    checked: slides.filter((s) => s.verdict !== "unchecked").length,
    counts,
    slides,
  };
}

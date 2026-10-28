import { bannerFit } from "./banner-text-fits";
import { writerBundle } from "./bundle";
import { gridFit } from "./cards-grid-fits";
import { EXIT_TICKET } from "./close";
import { coverFit } from "./cover-fits";
import fitData from "./fit-table.gen.json" with { type: "json" };
import hingeData from "./hinge-cards.gen.json" with { type: "json" };
import { hookFit } from "./hook-fits";
import { rowFit } from "./items-row-fits";
import { compoundSubjects } from "./lost-picture";
import objectivesRoom from "./objectives-room.gen.json" with { type: "json" };
import { nonFatalSync } from "./services";
import { fitNeedKey, shownFor, wordsWithin, writerStageOfKey } from "./shown-cap";

/*
 * The writer stage's pure fixes, ported from the pinned harness (TEACH-110 part b): the
 * incomplete-output gate (K3), the seeded hinge shuffle, the ask/ask_without honesty rule, the
 * repair's menu and fault wording, the restage fallbacks, and the user-turn template filler.
 */

type S = Record<string, unknown>;
export type Stage = "ks1" | "ks2" | "ks3" | "ks4" | "ks5";
export type Brief = {
  id: string;
  topic: string;
  subject: string;
  /** The lesson's past period and fiction flag (ruling 163, B1), read by `isHistoricalLesson`. */
  historicalPeriod?: string;
  fictionInPeriod?: boolean;
  yearGroup: string;
  year: number;
  keyStage: Stage;
  challenge?: "support" | "core" | "stretch";
  theme: string;
  readingLevel: string;
  language: string;
  durationMin: number;
  exitTicketOnSlides: boolean;
  slides: { min: number; max: number };
  teacherTheme?: string;
};

/** The prompt files' stage key. */
export const promptStage = (k: Stage) => (k === "ks1" ? "KS1" : k === "ks2" ? "KS2" : "KS3-5");

/** `objectiveCount` at the middle of the brief's slide range. */
export function objectiveCount(b: Brief): string {
  const n = Math.round((b.slides.min + b.slides.max) / 2);
  // Detailed asks for three, not four: a fourth objective at KS1 leaves 44 characters a line.
  return n <= 7 ? "one or two" : n <= 11 ? "two or three" : "three";
}

/**
 * K3: why a writer output is incomplete, or undefined when it is whole. A stream cut at the token
 * limit, JSON that does not close, or a deck more than 2 under the count fails the job instead of
 * saving the flow's placeholders as a headings-only deck. A tier's deck 1 or 2 under its minimum
 * ships and is logged (`count-miss` in stage.ts, TEACH-110 part ao): never a retry, which would
 * double the cost and splice two attempts' slides.
 */
export function writerIncomplete(o: {
  finishReason?: string | null;
  text: string;
  minSlides: number;
}): string | undefined {
  if (o.finishReason === "length") return "finish_reason length (token limit)";
  if (o.finishReason === "content-filter" || o.finishReason === "content_filter")
    return "finish_reason content-filter";
  if (o.finishReason === "error") return "finish_reason error";
  const out = nonFatalSync(
    () => JSON.parse(o.text) as { slides?: unknown[]; close?: unknown },
    () => undefined,
  );
  if (out === undefined) return "writer JSON does not parse";
  // `slides` holds slide 3 onwards (title and objectives are their own keys).
  // `close` is the lesson's last slide, its own field (TEACH-110 part ab).
  const n = (Array.isArray(out?.slides) ? out.slides.length : 0) + (out?.close ? 1 : 0);
  // A small count miss (up to 2 under, or any over) ships as written and is logged (count.ts,
  // ADR 0036); more than 2 under the count, title and objectives included, is incomplete.
  if (n + 2 < o.minSlides - 2)
    return `${n + 2} slides with title and objectives, more than 2 under ${o.minSlides}`;
  return undefined;
}

/** A 32-bit FNV-1a hash of a string (seeds the hinge shuffle). */
export function fnv(x: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The single-answer templates whose key is an index into the writer's own list. */
const KEYED = new Set(["hinge", "choose", "odd-one-out"]);

/**
 * The writer writes the correct option (hinge) or card (choose, odd-one-out) first and gives no
 * index: a counted `correct` was read from 1 but written from 0 by gpt-6.1-sol on 5 of 6 proof
 * keys (pilot build/ANSWER-BUG.md). The key is fixed at 1 here, before `shuffleHinge` or the
 * activity template's seeded shuffle moves it. A slide that already has `correct` (a saved or
 * replayed writer output from before the change) keeps it, read from 1 as before.
 */
export function answerFirst(slide: S): S {
  if (!KEYED.has(String(slide.template)) || slide.correct !== undefined) return slide;
  return { ...slide, correct: 1 };
}

/**
 * An older writer slide (counted `correct`, read from 1) in the answer-first shape: the keyed
 * option or card moved to the front and `correct` dropped. For fixtures and replays of outputs
 * written before the change; other slides pass through.
 */
export function toAnswerFirst(slide: S): S {
  const list = slide.template === "hinge" ? "options" : "cards";
  const items = slide[list];
  const c = Number(slide.correct);
  if (!KEYED.has(String(slide.template)) || !Array.isArray(items) || !Number.isInteger(c))
    return slide;
  const { correct: _, ...rest } = slide;
  if (c < 1 || c > items.length) return rest;
  return { ...rest, [list]: [items[c - 1], ...items.filter((_, i) => i !== c - 1)] };
}

/** A whole older writer output (`{ slides }`) in the answer-first shape (`toAnswerFirst`). */
export function answerFirstMain(main: unknown): unknown {
  const m = main as { slides?: unknown };
  if (!m || !Array.isArray(m.slides)) return main;
  return { ...m, slides: m.slides.map((s) => toAnswerFirst(s as S)) };
}

/** A schema whose `$defs.hinge` drops the counted `correct` (the repair schema; see keepAnswerKey). */
export function withoutHingeKey<T extends S>(schema: T): T {
  const defs = schema.$defs as Record<string, S> | undefined;
  const hinge = defs?.hinge;
  if (!defs || !hinge || !(hinge.properties as S | undefined)?.correct) return schema;
  const { correct: _, ...props } = hinge.properties as S;
  const required = (hinge.required as string[]).filter((k) => k !== "correct");
  return { ...schema, $defs: { ...defs, hinge: { ...hinge, required, properties: props } } };
}

/**
 * A repaired or restaged hinge's key, found by the answer's words: the option the pre-repair key
 * named, matched (trimmed, case and spacing folded) in the new options. The repair's own
 * `correct` is never used (the repair schema no longer asks for it). Returns null when the answer
 * is gone, so the caller keeps the pre-repair slide. Other slides pass through.
 */
export function keepAnswerKey(before: S, after: S): S | null {
  // A repair that turns another slide into a hinge would bring a counted key: refused.
  if (before.template !== "hinge") return after.template === "hinge" ? null : after;
  const b = before.options;
  const c = Number(before.correct);
  if (!Array.isArray(b) || !Number.isInteger(c) || c < 1 || c > b.length) return after;
  if (after.template !== "hinge" || !Array.isArray(after.options)) return null;
  // An option is a string or, on a pack, {text, icon, why}: compared by its words (an object's
  // String() is "[object Object]", which matched every option and re-keyed the hinge to 1).
  const norm = (x: unknown) =>
    String((x && typeof x === "object" ? (x as S).text : x) ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  const want = norm(b[c - 1]);
  const at = (after.options as unknown[]).findIndex((o) => norm(o) === want);
  return at < 0 ? null : { ...after, correct: at + 1 };
}

/**
 * Seeded hinge shuffle: the writer put the answer at B on 76% of hinges. The options are permuted
 * by a seeded Fisher-Yates (same seed, same order), so the correct option's position is uniform
 * across seeds; `correct` follows its option. Notes and answer keys are written later from the
 * slide as shown, so they match the new order.
 */
export function shuffleHinge(slide: S, seed: string): S {
  const opts = slide.options;
  const c = Number(slide.correct);
  if (slide.template !== "hinge" || !Array.isArray(opts) || opts.length < 2) return slide;
  if (!Number.isInteger(c) || c < 1 || c > opts.length) return slide;
  let st = fnv(seed) || 1;
  const rnd = () => {
    // mulberry32
    st = (st + 0x6d2b79f5) >>> 0;
    let t = st;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = opts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return { ...slide, options: order.map((i) => opts[i]), correct: order.indexOf(c - 1) + 1 };
}

/** "B: ..." for a multiple-choice slide whose `correct` (1-based option) is set, unless already lettered. */
export function withCorrectLetter(answers: string | null, slide: S | undefined) {
  const c = Number(slide?.correct);
  if (!answers || !Number.isInteger(c) || c < 1 || c > 6) return answers;
  const letter = String.fromCharCode(64 + c);
  return new RegExp(`^\\s*${letter}\\b`).test(answers) ? answers : `${letter}: ${answers}`;
}

/**
 * An `ask` written for one visual is not shown with another: a repaired figure whose kind changed
 * while its ask stayed the same shows its `ask_without` line instead.
 */
export function keepAsksHonest(before: S, after: S): S {
  const out = { ...after };
  for (const k of ["picture", "diagram", "figure"]) {
    const b = before[k] as S | undefined;
    const a = out[k] as S | undefined;
    if (!a || typeof a !== "object" || typeof a.ask !== "string") continue;
    const kindOf = (f?: S) => (f && typeof f === "object" ? (f.kind ?? "picture") : undefined);
    if (!b || kindOf(b) !== kindOf(a))
      if (!b || b.ask === a.ask) out[k] = { ...a, ask: a.ask_without ?? null };
  }
  return out;
}

/** The layouts a slide may switch to in a fit repair (same job, other room). */
export const SWITCH: Record<string, string[]> = {
  "visual-text": ["big-visual", "steps", "explain"],
  "big-visual": ["visual-text"],
  explain: ["visual-text", "steps"],
  steps: ["visual-text", "explain"],
  compare: ["visual-text", "explain"],
  "equation-hero": ["steps"],
  "picture-sequence": ["compare"],
  discussion: ["question-set"],
  "question-set": ["practice"],
  practice: ["question-set"],
  "exit-ticket": [],
  hinge: [],
};

const { compare: _compare, ...kept } = SWITCH;
/**
 * The switches on a pilot pack (production): compare is retired there (ruling 218), so nothing
 * switches to or from it, and a picture sequence whose captions run over may become a split.
 * Without a pack, `SWITCH` as before.
 */
export const PACK_SWITCH: Record<string, string[]> = {
  ...kept,
  "picture-sequence": ["split-compare"],
};

/** The layouts a fit repair may give the slide: its own and those it may switch to. */
export const switchesFor = (template: string, pack: boolean): string[] => [
  template,
  ...((pack ? PACK_SWITCH : SWITCH)[template] ?? []),
];

/** The layouts menu cut to the header, the slide's own layout and those it may switch to. */
export function layoutsFor(menu: string, template: string, pack = false): string {
  const keep = new Set(switchesFor(template, pack));
  return menu
    .split("\n")
    .filter((l, k) => k === 0 || keep.has(/^- ([a-z-]+):/.exec(l)?.[1] ?? ""))
    .join("\n")
    .trim();
}

/**
 * The fault a stand-alone or reroute call is given: which figure is missing, what it was to show
 * and, for a diagram, its parts, so the slide can carry that content in words.
 */
export function lostFault(
  f: { type: string; kind?: string; shows: string; labels?: string[] },
  why?: string,
): string {
  const what = f.type === "diagram" ? `${f.kind ?? "diagram"} diagram` : "picture";
  const parts = f.labels?.length ? `; its parts: ${f.labels.join(", ")}` : "";
  const because = why ? ` (${why})` : "";
  return `missing: the ${what} of "${f.shows}" cannot be shown${because}${parts}; the slide must stand alone without it`;
}

/** The measured characters per field (`@tj/slides` `measureFit`, carried as data). */
type FitLimit = { item: number; total: number; instruction?: number };
type FitVariant = {
  label: string;
  limit?: FitLimit;
  limitBare?: FitLimit;
  noInstruction?: boolean;
  counts: Record<string, number>;
  figure: boolean;
  keyCards?: boolean;
  chars: number;
  /** The layout's own heading cap (the cover's title), over the group's `heading`. */
  heading?: number;
  instruction?: number;
  charsNoInstruction?: number;
  stem?: number;
  keyLabel?: number;
  columnLabel?: number;
};
type FitLayout = { fields: string[]; variants: FitVariant[] };
type FitGroup = {
  heading: number;
  formula: number;
  formulaBesideFigure: number;
  layouts: Record<string, { fields: string[]; variants: FitVariant[] }>;
};
let FIT: Record<string, FitGroup> | undefined;
/** The pinned table plus the layouts measured outside it (UX ruling 203), per group; built once. */
const baseFit = (): Record<string, FitGroup> => {
  if (FIT) return FIT;
  const groups = (fitData as unknown as { groups: Record<string, FitGroup> }).groups;
  FIT = Object.fromEntries(
    Object.entries(groups).map(([g, F]) => [
      g,
      { ...F, layouts: { ...F.layouts, ...extraLayouts(g) } },
    ]),
  );
  return FIT;
};
/** Ruling 203 layouts' fit, from the renderer's own capacity tables. */
function extraLayouts(group: string): FitGroup["layouts"] {
  return {
    "cards-grid": gridFit(group),
    "items-row": rowFit(group),
    "banner-text": bannerFit(group),
    hook: hookFit(group),
    ...(coverFit(group) ? { title: coverFit(group) as FitLayout } : {}),
  };
}
/**
 * The measured fit per stage group. With `hingeCards` (HEART1 R3 s6, TEACH-110 part r) the hinge
 * rows are what the cards hold at full size (`hinge-cards.gen.json`, 2 to 4 options) instead of
 * the lab's caps, which let an option shrink and wrap to 4 lines in a 3-across card. Opt-in per
 * writer bundle, so a bundle that does not ask keeps the lab's numbers.
 */
export const fitTable = (o: { hingeCards?: boolean } = {}): Record<string, FitGroup> => {
  const groups = baseFit();
  if (!o.hingeCards) return groups;
  const cards = (hingeData as { groups: Record<string, HingeCards> }).groups;
  return Object.fromEntries(
    Object.entries(groups).map(([g, f]) => {
      const c = cards[g];
      if (!c || !f.layouts.hinge) return [g, f];
      const variants = Object.entries(c.options).map(([k, item]): FitVariant => {
        const n = Number(k);
        return {
          label: `${n} options`,
          counts: { options: n },
          figure: false,
          keyCards: false,
          chars: item,
          stem: c.stem,
          limit: { item, total: c.stem + n * item },
        };
      });
      return [g, { ...f, layouts: { ...f.layouts, hinge: { ...f.layouts.hinge, variants } } }];
    }),
  );
};
type HingeCards = { stem: number; options: Record<string, number> };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A text's words, as a reader counts them. */
export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
/** "1 word", "N words". */
export const nWords = (n: number) => `${n} word${n === 1 ? "" : "s"}`;

/**
 * A measured overflow restated in words (a pack's menu gives its Fits in words): the room in
 * characters scaled by the text's own characters per word, so cutting `over` words brings it near
 * its room. Always at least one word over.
 */
export function wordsOver(words: number, chars: number, room: number) {
  const w = Math.max(1, words);
  const fit = Math.max(0, Math.min(w - 1, Math.floor((w * room) / Math.max(1, chars))));
  return { words: w, room: fit, over: w - fit };
}

/**
 * Each text field over its measured limit, as `field: N characters, room M (K over)`, or on a
 * pack run (`words`) as `field: N words, room about M (K over)`. The slide's way of filling its
 * layout is matched by its item count and figure.
 */
export function charsOver(slide: unknown, stage: string, words = false): string[] {
  const s = (slide ?? {}) as S;
  const F = fitTable()[stage];
  const L = F?.layouts[String(s.template)];
  if (!F || !L) return [];
  const listKey = ["points", "questions", "options", "columns", "sequence", "grid", "items"].find(
    (k) => Array.isArray(s[k]),
  );
  const items = listKey ? (s[listKey] as unknown[]) : [];
  const fig = !!(s.figure ?? s.picture);
  const fitting = L.variants.filter(
    (v) =>
      v.chars > 0 &&
      v.figure === fig &&
      (listKey ? (v.counts[listKey] ?? 0) >= items.length : true),
  );
  const v =
    fitting.sort((a, b) => (a.counts[listKey ?? ""] ?? 0) - (b.counts[listKey ?? ""] ?? 0))[0] ??
    L.variants.filter((x) => x.chars > 0).sort((a, b) => a.chars - b.chars)[0];
  if (!v) return [];
  const hasIns = typeof s.instruction === "string" && s.instruction.trim().length > 0;
  const lim = (hasIns ? v.limit : (v.limitBare ?? v.limit)) ?? {
    item: hasIns ? v.chars : (v.charsNoInstruction ?? v.chars),
    total: Number.POSITIVE_INFINITY,
    ...(v.instruction ? { instruction: v.instruction } : {}),
  };
  const out: string[] = [];
  let all = 0;
  let allWords = 0;
  const line = (field: string, n: number, w: number, cap: number) => {
    if (!words) return `${field}: ${n} characters, room ${cap} (${n - cap} over)`;
    const o = wordsOver(w, n, cap);
    return `${field}: ${nWords(o.words)}, room about ${o.room} (${o.over} over)`;
  };
  const over = (field: string, text: unknown, cap: number | undefined, counts = true) => {
    const t = typeof text === "string" ? text : "";
    if (counts) {
      all += t.length;
      allWords += wordCount(t);
    }
    if (cap && t.length > cap) out.push(line(field, t.length, wordCount(t), cap));
  };
  // A layout's own title cap (the cover's three lines, `cover-fits.ts`) wins over the group's.
  over("heading", s.heading, v.heading ?? F.heading, false);
  if (typeof s.lead === "string") over("lead", s.lead, lim.item);
  if (typeof s.instruction === "string")
    over("instruction", s.instruction, v.noInstruction ? 1 : lim.instruction);
  if (typeof s.stem === "string") over("stem", s.stem, v.stem);
  if (typeof s.formula === "string")
    over("formula", s.formula, fig ? F.formulaBesideFigure : F.formula, false);
  items.forEach((it, k) => {
    const o = (it ?? {}) as S;
    const text = typeof it === "string" ? it : (o.text ?? o.caption);
    over(`${listKey}[${k + 1}]`, text, lim.item);
    if (typeof o.label === "string")
      over(`${listKey}[${k + 1}].label`, o.label, v.keyLabel ?? v.columnLabel, false);
    if (typeof o.name === "string")
      over(`${listKey}[${k + 1}].name`, o.name, v.keyLabel ?? v.columnLabel, false);
  });
  // The figure's ask, or its ask_without when the figure is not shown, is on the slide too.
  const asked = ["figure", "picture", "diagram"]
    .flatMap((k) => {
      const f = s[k] as S | null | undefined;
      return f && typeof f === "object" ? [str(f.ask), str(f.ask_without)] : [];
    })
    .reduce((a, b) => (b.length > a.length ? b : a), "");
  all += asked.length;
  allWords += wordCount(asked);
  if (all > lim.total) out.push(line("all the slide's text", all, allWords, lim.total));
  return out;
}

/** Whether a writer slide asks for any picture or diagram (its figure, a card's or a panel's). */
export function asksVisual(s: S): boolean {
  if (["figure", "picture", "diagram"].some((k) => s[k] && typeof s[k] === "object")) return true;
  const cards = [...((s.columns as unknown[]) ?? []), ...((s.sequence as unknown[]) ?? [])];
  return cards.some((c) => !!c && typeof c === "object" && !!(c as S).picture);
}
/** Layouts that take one picture in their own field: `figure` or `picture`. */
const FIGURE_FIELD: Record<string, string> = {
  "visual-text": "figure",
  "big-visual": "figure",
  steps: "figure",
  "question-set": "figure",
  practice: "figure",
  "exit-ticket": "figure",
  discussion: "picture",
  title: "picture",
  // TEACH-247 part ba: the question picture at the foot of the reasons panel.
  reasons: "picture",
};
/**
 * A slide the flow's `look` says shows a picture, but which asks for none, gets that picture from
 * look's `shows` phrase. A diagram look needs a kind the flow does not give, so it is only reported.
 */
export function withLook(
  s: S,
  look: { kind: string; shows: string | null } | undefined,
): { slide: S; how?: string } {
  if (look?.kind !== "picture" || !look.shows?.trim() || asksVisual(s)) return { slide: s };
  const tpl = String(s.template);
  const pic = {
    shows: look.shows,
    must_see: [look.shows],
    subject: "generic",
    ask: null,
    ask_without: null,
  };
  if (tpl === "explain")
    return { slide: { ...s, template: "visual-text", figure: pic }, how: "explain-to-visual-text" };
  const field = FIGURE_FIELD[tpl];
  // A reasons slide takes a picture only where its schema offered one (pack `reasonsPicture`).
  if (tpl === "reasons" && !("picture" in s)) return { slide: s };
  return field ? { slide: { ...s, [field]: pic }, how: `${field}-from-look` } : { slide: s };
}

/**
 * Ruling 196 (prod-01: "a split view of a snowy Arctic landscape and a sandy desert landscape" was
 * dropped and left an empty frame): the title picture shows one thing, the first its request names.
 */
export function titleOneThing(s: S): { slide: S; how?: string } {
  const pic = s.picture as { shows?: unknown } | null | undefined;
  if (s.template !== "title" || !pic || typeof pic.shows !== "string") return { slide: s };
  const shows = pic.shows
    .replace(/\bsplit (view|scene|image) of\b/i, "")
    .replace(/^.*?\b(photographs?|photos?|pictures?|images?) of\s+/i, "");
  const one = compoundSubjects(shows)[0]?.replace(/^(a|an|the)\s+/i, "");
  // only the thing the request leads with ("a family portrait with two children, their parents
  // and ..." is one portrait, not "their parents")
  const lead = (shows.split(/,|\band\b|\bbeside\b/i)[0] ?? "").toLowerCase();
  if (!one || !lead.includes(one)) return { slide: s };
  return {
    slide: { ...s, picture: { ...pic, shows: one, must_see: [one] } },
    how: "title-one-thing",
  };
}

/**
 * The room a slide has, in the writer's units, for a stand-alone or reroute call: characters, or on
 * a pack run (`words`, as `charsOver` and `repairTerms` take it) words as the menu shows them (one
 * source: the heading at `wordsWithin`, a body field at `shownFor`, the comfortable room), so the
 * room line and the menu agree. A field whose room is under one word is left out, never "1 word".
 */
export function roomLine(slide: unknown, stage: string, words = false): string {
  const s = { ...((slide ?? {}) as S) };
  for (const k of ["figure", "picture", "diagram"]) s[k] = null;
  const F = fitTable()[stage];
  const L = F?.layouts[String(s.template)];
  if (!F || !L) return "";
  const listKey = ["points", "questions", "options", "columns", "sequence", "grid", "items"].find(
    (k) => Array.isArray(s[k]),
  );
  const n = listKey ? (s[listKey] as unknown[]).length : 0;
  const v = L.variants
    .filter((x) => x.chars > 0 && !x.figure && (x.limit || x.chars))
    .sort(
      (a, b) => Math.max(0, ...Object.values(a.counts)) - Math.max(0, ...Object.values(b.counts)),
    )
    .find((x) => Math.max(0, ...Object.values(x.counts)) >= n);
  const lim = v?.limit;
  if (!lim) return "";
  if (!words)
    return `room: the heading up to ${F.heading} characters; each item up to ${lim.item} characters; all the slide's text up to ${lim.total} characters${lim.instruction ? `; an instruction up to ${lim.instruction} characters` : ""}`;
  const ws = writerStageOfKey(stage);
  const template = String(s.template);
  const parts = [
    ["the heading", wordsWithin(F.heading, ws)],
    ["each item", shownFor(lim.item, ws, fitNeedKey(template, "points[]"))],
    ["all the slide's text", shownFor(lim.total, ws)],
    ...(lim.instruction ? [["an instruction", shownFor(lim.instruction, ws)] as const] : []),
  ] as const;
  const kept = parts.filter(([, n]) => n >= 1).map(([f, n]) => `${f} up to ${nWords(n)}`);
  return kept.length ? `room: ${kept.join("; ")}` : "";
}

/** Points over the room, summed over a slide's overflow faults ("overflow: x 354/328pt"). */
export function overflowPt(faults: string[]): number {
  let t = 0;
  for (const f of faults) {
    const m = /^(?:overflow|clipped): .*?(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*pt/.exec(f);
    if (m) t += Math.max(0, Number(m[1]) - Number(m[2]));
  }
  return t;
}
export const OVERFLOW = /^(overflow|clipped|cut):/;
/** A request's content words, sorted (two requests for the same subject compare equal). */
export const plainWords = (t: string) =>
  [...new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? [])].sort().join(" ");

/** Sequence kinds whose parts can stand as a slide's steps. */
export const SEQUENCE_KINDS = new Set(["flow", "cycle", "timeline"]);
const POINTING =
  /\b(look at|looking at|trace|see|the (?:diagram|graph|map|picture|chart|table|photo|image|figure|timeline|flow)|shown (?:here|below|above)|in the (?:picture|diagram|graph|map))\b/i;
export function stripPointing(text: string): string {
  const parts = text.match(/[^.?!]+[.?!]*\s*/g) ?? [text];
  return parts
    .filter((p) => !POINTING.test(p))
    .join("")
    .trim();
}
/**
 * The fixed fallback when a restaging call fails or is rejected: a sequence kind's parts become
 * the slide's steps, in order; any other kind's figure is dropped and code removes the sentences
 * that point at it.
 */
/** seqSteps (BAKEOFF base4f): a flow spec's labelled links as steps, in the writer's order. */
export function linkSteps(spec: Record<string, unknown> | undefined): string[] {
  const n0 = spec?.nodes;
  const l0 = spec?.links;
  const nodes = Array.isArray(n0) ? n0.map((x) => str(x)) : [];
  const links = Array.isArray(l0) ? (l0 as Record<string, unknown>[]) : [];
  const out = links
    .filter((l) => str(l?.label).trim())
    .map((l) => {
      const a = nodes[Number(l.from)] ?? "";
      const b = nodes[Number(l.to)] ?? "";
      const lab = str(l.label).trim();
      if (!a || !b) return "";
      return a === b ? `${a}: ${lab}` : `${a} \u2192 ${b}: ${lab}`;
    })
    .filter(Boolean);
  return out.length === links.length ? out : [];
}
export function fixedFallback(
  slide: S,
  lost: { type: string; kind?: string; labels?: string[] },
  parts: string[],
  maxSteps: number,
): { slide: S; how: string } {
  const heading = String(slide.heading ?? "");
  if (
    lost.type === "diagram" &&
    SEQUENCE_KINDS.has(lost.kind ?? "") &&
    parts.length >= 2 &&
    parts.length <= maxSteps
  )
    return {
      slide: { template: "steps", heading, points: parts, figure: null },
      how: "sequence-as-steps",
    };
  const out: S = { ...slide, figure: null, picture: null, diagram: null };
  for (const k of ["lead", "instruction", "stem", "prompt"])
    if (typeof out[k] === "string") out[k] = stripPointing(out[k] as string);
  for (const k of ["points", "questions"])
    if (Array.isArray(out[k]))
      out[k] = (out[k] as unknown[])
        .map((p) =>
          typeof p === "string"
            ? stripPointing(p)
            : p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
              ? { ...(p as object), text: stripPointing((p as { text: string }).text) }
              : p,
        )
        .filter((p) => (typeof p === "string" ? p.trim() : true));
  const tpl = String(out.template);
  if (
    [
      "visual-text",
      "big-visual",
      "diagram-text",
      "picture-text",
      "big-diagram",
      "big-picture",
    ].includes(tpl)
  )
    out.template = "explain";
  // A lost diagram's named parts are kept as the slide's points when it has none of its own, so
  // what the drawing named is still taught (PICTURES-DIAGRAMS fix 4); explain holds up to three.
  const own = Array.isArray(out.points) && out.points.length > 0;
  if (lost.type === "diagram" && !own && parts.length >= 2 && parts.length <= 3) {
    if (!["explain", "steps", "equation-hero"].includes(String(out.template)))
      out.template = "explain";
    if (out.template === "explain")
      return { slide: { ...out, points: parts }, how: "figure-as-points" };
  }
  return { slide: out, how: "figure-dropped" };
}

/**
 * A fit fault in the repair's own units: which field and how many characters over its measured
 * room (on a pack run, `words`: how many words, as the pack's menu counts), never "about N lines". A fault no field explains keeps its slot name with the overflow
 * said as a share of the room.
 */
export function repairTerms(fault: string, slide?: unknown, stage?: string, words = false): string {
  const m = /^(overflow|clipped): (.*?)\s*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*pt\b(.*)$/.exec(fault);
  if (!m) return fault;
  const fields = slide && stage ? charsOver(slide, stage, words) : [];
  if (fields.length) return `${m[1]}: ${fields.join("; ")}`;
  const used = Number(m[3]);
  const room = Number(m[4]);
  const cut = Math.max(1, Math.ceil(((used - room) / used) * 100));
  return `${m[1]}: ${(m[2] ?? "").trim() || "the text"} needs about ${cut}% fewer ${words ? "words" : "characters"} to fit${m[5] ?? ""}`;
}

/** A repair answer is {fix, slide, to_notes}: the slide replaces the old one, to_notes joins its notes. */
export function applyRepair(
  slides: (S | undefined)[],
  notes: Map<number, { notes: string; answers: string[] }>,
  i: number,
  out: unknown,
) {
  const o = out as { slide?: S; to_notes?: string | string[] };
  if (!o.slide || typeof o.slide !== "object") return;
  slides[i] = o.slide;
  const moved = Array.isArray(o.to_notes) ? o.to_notes : [o.to_notes ?? ""];
  const extra = moved
    .map((x) => String(x).trim())
    .filter((x) => x && !/^none\.?$/i.test(x))
    .join("\n");
  if (extra) {
    const n = notes.get(i) ?? { notes: "", answers: [] };
    notes.set(i, { ...n, notes: n.notes ? `${n.notes}\n\n${extra}` : extra });
  }
}

/**
 * The objectives slide's measured room, in characters a line, for `n` objectives at `stage`
 * (`objectives-room.gen.json`, from `scripts/objectives-room.ts`): the longest line at which `n`
 * objectives (1 to 4, one objective its own entry) stay at the body size or larger in every theme.
 */
export function pupilCharLimit(stage: Stage, n: number): number {
  const room = (objectivesRoom as Record<string, Record<string, number>>)[promptStage(stage)];
  const chars = room?.[n === 1 ? "1 objective" : `${n} objectives`] ?? room?.["4 objectives"];
  return chars ?? (stage === "ks1" ? 48 : stage === "ks2" ? 60 : 72);
}

/** The pupil line's word limit: the objectives slide's measured room for this many objectives. */
export function pupilWordLimit(stage: Stage, n: number): number {
  return Math.max(6, Math.floor(pupilCharLimit(stage, n) / 6));
}

const STOP = new Set(
  "a an and are as at be by can do does for from how i in into is it its of on or our that the their them they this to use using we what when where which who why will with you your about after before each more most some such than then these those through up very".split(
    " ",
  ),
);
/** A word's crude stem: lower case, letters only, a plural or verb ending off. */
const stem = (w: string) =>
  w
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/(?:ing|ed|es|s|ly)$/, "");
/** The content words of a line, stemmed, stop words out. */
export function contentStems(text: string): Set<string> {
  return new Set(
    text
      .split(/[^A-Za-z']+/)
      .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()))
      .map(stem)
      .filter((w) => w.length > 2),
  );
}
/**
 * Whether a pupil line is about its own objective: it shares at least one content word (stemmed,
 * stop words out) with objective `k`, and no other objective shares more. A line in the wrong
 * place (the model swapped two, or split one) fails this and takes the teacher's wording.
 */
export function lineMatchesObjective(line: string, k: number, objectives: string[]): boolean {
  const words = contentStems(line);
  const shared = (o: string) => [...contentStems(o)].filter((w) => words.has(w)).length;
  const own = shared(objectives[k] ?? "");
  // A tie keeps the line where it is: objectives as close as "unit fractions of amounts" and
  // "non-unit fractions of amounts" share every word a short pupil line uses.
  return own >= 1 && objectives.every((o, j) => j === k || shared(o) <= own);
}

/**
 * What is wrong with the pupil-wording call's lines for `n` objectives, or undefined when they
 * can be shown: exactly `n` lines (a line is matched to its objective by position, so a sixth line
 * or a split objective puts one objective's words beside another's number), each a non-empty
 * string within the slide's measured room in characters and words.
 */
export function pupilLinesProblem(
  lines: unknown,
  n: number,
  stage: Stage,
  objectives?: string[],
): string | undefined {
  if (!Array.isArray(lines)) return "no lines";
  if (lines.length !== n) return `${lines.length} lines for ${n} objectives`;
  const chars = pupilCharLimit(stage, n);
  const words = pupilWordLimit(stage, n);
  for (const [k, line] of lines.entries()) {
    if (typeof line !== "string" || !line.trim()) return `line ${k + 1} is empty`;
    const t = line.trim();
    if (t.length > chars) return `line ${k + 1} is ${t.length} characters, room ${chars}`;
    const w = t.split(/\s+/).length;
    if (w > words) return `line ${k + 1} is ${w} words, limit ${words}`;
    if (objectives && !lineMatchesObjective(t, k, objectives))
      return `line ${k + 1} is not about objective ${k + 1}`;
  }
  return undefined;
}

/** Leading words that say nothing about the objective itself. */
const LEAD_FILLER =
  /^(?:(?:all\s+|most\s+|some\s+)?(?:pupils|students|children|learners)\s+(?:will|should|can|must)\s+(?:be\s+able\s+to\s+)?|(?:to\s+)?be\s+able\s+to\s+|i\s+can\s+|we\s+(?:will|are\s+learning\s+to)\s+|to\s+)/i;
/** A trailing qualifier: a condition on the task, not one of its terms. */
const TAIL_QUALIFIER =
  /,\s+(?:where|when|so\s+that|in\s+order\s+to|in\s+a\s+range\s+of\s+contexts|in\s+context|over\s+time|using\s+(?:a|an|the)\s+[^,.;]+)(?:[^,.;]*)\.?$/i;

/**
 * A teacher's objective made shorter without losing what it names (TEACH-110 part an): leading
 * filler ("Pupils will be able to"), parentheticals ("(for example 1/2 of 8)") and a trailing
 * qualifier (", where the answer is a whole number") go, in that order, only until the line is
 * within `max`. Nothing else is cut: a listed term ("fractions and decimals"), a clause or a noun
 * phrase is never dropped, so the result may still be longer than `max`, and then the slide's own
 * type steps (down to its floor) hold it. The first letter is capitalised and a full stop ends it.
 */
export function shortenObjective(text: string, max: number): string {
  const tidy = (x: string) => {
    const t = x
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .trim()
      .replace(/[\s,;:.]+$/, "");
    return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
  };
  let t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const steps = [
    (x: string) => x.replace(LEAD_FILLER, ""),
    (x: string) => x.replace(/\s*\([^)]*\)/g, ""),
    (x: string) => x.replace(/[.\s]+$/, "").replace(TAIL_QUALIFIER, ""),
  ];
  for (const step of steps) {
    const next = tidy(step(t));
    if (next && next.length >= 12) t = next;
    if (t.length <= max) return t;
  }
  return t;
}

/**
 * The lines shortened until the slide holds them (`fits`: the objectives slide laid with these
 * lines reports nothing over). The longest line is shortened first, ten characters at a time, so
 * the cut falls where it costs least. Gives up (returns the shortest it reached) at 24 characters.
 */
export function fitObjectives(
  lines: string[],
  fits: (lines: string[]) => boolean,
  log?: (e: object) => void,
): string[] {
  let out = [...lines];
  // Each line once, longest first: only filler, parentheticals and trailing qualifiers go.
  const order = out.map((l, k) => ({ l, k })).sort((a, b) => b.l.length - a.l.length);
  for (const { k } of order) {
    if (fits(out)) return out;
    const line = out[k] ?? "";
    const next = shortenObjective(line, 0);
    if (next !== line) out = out.map((l, j) => (j === k ? next : l));
  }
  // Still over: the full lines stay, the slide sets them under its floor, and it is logged.
  if (!fits(out)) log?.({ ev: "objectives-under-floor", lines: out.map((l) => l.length) });
  return out;
}

export type FillExtras = {
  objectives?: { teacher: string; pupil: string }[];
  context?: string;
  [k: string]: unknown;
};
/**
 * Fills one of the pinned user-turn templates: brief fields ({{topic}}, {{slides.min}}),
 * {{flag ? "a" : "b"}}, the objective count, the approved objectives as numbered lines,
 * {{context block…}}, and any extra named block.
 */
export function fillTemplate(text: string, b: Brief, x: FillExtras = {}): string {
  const get = (path: string): unknown =>
    path.split(".").reduce<unknown>((o, k) => (o as S | undefined)?.[k], b);
  // An exact count (ADR 0036) reads "Slides: 10", never "10 to 10".
  const exact = b.slides !== undefined && b.slides.min === b.slides.max;
  const src = exact ? text.replace("{{slides.min}} to {{slides.max}}", "{{slides.min}}") : text;
  return src.trim().replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    const expr = raw.trim();
    const t = expr.match(/^([\w.]+)\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"$/);
    if (t) return get(t[1] as string) ? (t[2] as string) : (t[3] as string);
    const d = expr.match(/^([\w.]+)\s*\?\?\s*"([^"]*)"$/);
    // An extra (`maxChars` on the pupil call) wins over the brief's field of the same name.
    if (d) {
      const k = d[1] as string;
      return String((Object.hasOwn(x, k) ? x[k] : undefined) ?? get(k) ?? d[2]);
    }
    if (expr.startsWith("count:") && expr.includes("objectiveCount")) return objectiveCount(b);
    if (expr.startsWith("for each objective") && expr.includes("teacher wording only"))
      return (x.objectives ?? []).map((o, k) => `${k + 1}. ${o.teacher}`).join("\n");
    if (expr.startsWith("for each objective"))
      return (x.objectives ?? [])
        .map((o, k) => `${k + 1}. Teacher: ${o.teacher}${o.pupil ? ` | Pupils: ${o.pupil}` : ""}`)
        .join("\n");
    if (expr.startsWith("context block")) return x.context ?? "";
    if (expr.startsWith("for each final slide")) return String(x.slidesAsShown ?? "");
    if (expr === "objectives") return JSON.stringify({ objectives: x.objectives ?? [] });
    if (expr in x) return String(x[expr]);
    // `locale.*` tokens are left for the locale step (every model call fills them).
    if (expr.startsWith("locale.")) return `{{${raw}}}`;
    const v = get(expr);
    if (v === undefined) throw new Error(`template: no value for {{${expr}}}`);
    return String(v);
  });
}

/** The flow's visual decision (`look_at` in this schema). */
export function lookOf(
  f:
    | {
        look?: { kind: string; shows: string | null };
        look_at?: { kind: string; shows: string | null };
      }
    | undefined,
): { kind: string; shows: string } | undefined {
  const l = f?.look ?? f?.look_at;
  return l ? { kind: l.kind, shows: l.shows ?? "" } : undefined;
}

/** Flow layouts whose slide template has another name (the flow plans `figure-slide`). */
export const FLOW_LAYOUT_TEMPLATE: Readonly<Record<string, string>> = { "figure-slide": "figure" };
/** The flow's layout name for a writer schema def (`visual-text~points-0-fig`). */
export const flowLayoutOf = (defKey: string) => defKey.replace("~", " ");
/** The template the writer writes for a flow layout (`visual-text points-0-fig` -> `visual-text`). */
export function templateOfLayout(layout: string): string {
  const head = layout.trim().split(/\s+/)[0] ?? "";
  return FLOW_LAYOUT_TEMPLATE[head] ?? head;
}
/** How far past the next unmatched flow entry a written slide may find its own. */
export const FLOW_LOOKAHEAD = 3;
type FlowEntry = { slide: number; layout?: string };

/**
 * Matches each written slide to the flow entry that plans it, in order, by the template the
 * writer wrote (before any activity, table or quick-check rewrite): the next unmatched entry
 * whose layout names that template, at most `FLOW_LOOKAHEAD` entries on. When the writer writes
 * fewer slides than its flow (the close moves up), an index would read another slide's plan and
 * its picture would land where the layout has no room (genlab Y1 plants, 26 Oct: a practice
 * slide's "seedling and flowering plant in rain" was generated for the exit ticket, 31 s and
 * $0.0063, then never shown). A flow without layouts is read by index, as before. A slide is
 * matched once; asking again returns the same entry. `flowNow` reads the flow when a slide opens
 * (it streams in before the slides).
 */
export function flowMatcher<E extends FlowEntry>(flowNow: () => readonly E[] | undefined) {
  const byIdx = new Map<number, E | undefined>();
  let next = 0;
  return (idx: number, written: string): E | undefined => {
    if (byIdx.has(idx)) return byIdx.get(idx);
    const list = flowNow() ?? [];
    let got: E | undefined;
    if (!list.some((f) => typeof f.layout === "string"))
      got = list.find((f) => f.slide === idx + 1);
    else
      for (let j = next; j < Math.min(list.length, next + FLOW_LOOKAHEAD + 1); j++) {
        const f = list[j] as E;
        if (typeof f.layout === "string" && templateOfLayout(f.layout) === written) {
          got = f;
          next = j + 1;
          break;
        }
      }
    byIdx.set(idx, got);
    return got;
  };
}

/** A written slide that no flow entry plans: its deck number, template and heading. */
export type OffPlanSlide = {
  slide: number;
  template: string;
  heading: string | null;
  planned: string | null;
};

/**
 * The written slides with the ones no flow entry plans taken out, when the deck runs longer than
 * its flow (TEACH-247 part bm). v4.18c Photosynthesis r1 planned 11 slides and the writer wrote a
 * 12th, an `explain` "A note for the teacher", shown to pupils. A slide is off plan when
 * `flowMatcher` finds no entry for it. Only as many as the deck runs over the flow are dropped, the
 * latest first, and never the last slide or an exit ticket (the lesson's check). An off-plan slide
 * in a deck no longer than its flow swapped its planned layout (Romans r1: the exit ticket written
 * as a question set): it is kept, and reported as `kept`. A flow without layouts drops nothing.
 * `slides` are the written slides after the title, close included (deck numbers 3 on).
 */
export function offPlanSlides<E extends FlowEntry>(
  flow: readonly E[] | undefined,
  title: S | undefined,
  slides: readonly S[],
): { slides: S[]; dropped: OffPlanSlide[]; kept: OffPlanSlide[] } {
  const all = [...slides];
  if (!flow?.some((f) => typeof f.layout === "string"))
    return { slides: all, dropped: [], kept: [] };
  const of = flowMatcher(() => flow);
  if (title) of(0, String(title.template ?? ""));
  const off = all.flatMap((s, k) => (of(k + 2, String(s.template ?? "")) ? [] : [k]));
  const excess = Math.max(0, 2 + all.length - flow.length);
  const droppable = off.filter(
    (k) => k !== all.length - 1 && String(all[k]?.template ?? "").split("~")[0] !== EXIT_TICKET,
  );
  const drop = new Set(excess ? droppable.slice(-excess) : []);
  const row = (k: number): OffPlanSlide => ({
    slide: k + 3,
    template: String(all[k]?.template ?? ""),
    heading: typeof all[k]?.heading === "string" ? (all[k]?.heading as string) : null,
    planned: flow.find((f) => f.slide === k + 3)?.layout ?? null,
  });
  return {
    slides: all.filter((_, k) => !drop.has(k)),
    dropped: off.filter((k) => drop.has(k)).map(row),
    kept: off.filter((k) => !drop.has(k)).map(row),
  };
}

/** The writer's user turn: the pinned `user.txt` filled with the brief and the approved objectives. */
export function contextBlock(
  b: Brief,
  objectives?: { teacher: string; pupil: string }[],
  user: string = writerBundle().user,
): string {
  return fillTemplate(user, b, objectives ? { objectives } : {});
}

// BAKEOFF shared harness: one streamed planning call, slides materialised as they complete, pictures
// and diagrams in parallel, notes per slide, code checks, one bounded repair, timings and cost.
// The layout step is an `ArmPlugin` (arm T: templates; K: blocks + recipes; R: reference slides).
// See BAKEOFF/HARNESS.md.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Slide, Theme } from "@tj/domain/documents";
import { renderDiagram } from "../../packages/slides/src/diagrams/index";
import { type DiagramSlot, slotBox, slotOf } from "../../packages/slides/src/diagrams/limits";
import { FIT_VERSION, getTheme, withKeyStage } from "../../packages/slides/src/themes";
import {
  type AbArm,
  abArm,
  abCaptions,
  abCheckDef,
  abCodeArm,
  abExitTicket,
  abFigureSync,
  abFiles,
  abFixes,
  abGas8,
  abHookFirst,
  abMatch6,
  abNotesAlt,
  abObjRetry,
  abOrphan6,
  abR1t,
  abR1t2,
  abShared,
  hookFirstOrder,
  sha,
} from "./ab/arms";
import { localAlt, localiseSlideAlts, slideWords } from "./ab/caption";
import { continueForFit } from "./ab/continue";
import { exitTicketSlide, type PlacedExitTicket, readExitTicket } from "./ab/exit-ticket";
import { gasFaults, rescaleGas } from "./ab/gas8";
import { isQuestionSlide } from "./ab/lib";
import { orphansAfterFit, unmatchedItems } from "./ab/pics6";
import { applyStage2, covers, restageLayoutOnly, seenOf } from "./ab/stage2";
import { flattenR1t } from "./ab/structural";
import { type CheckResult, checkSlide, duplicateFaults, slideNoEmDash } from "./checks";
import { figureTextMismatch, specKey, syncFigure } from "./figure-sync";
import { isEngland, type Locale, locale, localise, setLocale } from "./locale";
import { OBJECTIVES_CONFIG, objectivesCall, pupilCall, pupilSchema } from "./objectives";
import { PartialJson, type Path } from "./partial";
import {
  judgeRepair,
  POINTING_WORDS,
  repairable,
  sameFigure,
  teaching,
  words as wordsOf,
} from "./repair";
import {
  CHECKDEF_TEMPLATES,
  coverage,
  lessonNotes,
  notesText,
  objectiveRepairSchema,
  renderedLines,
  repairObjectives,
} from "./round4";
import {
  aspectOf,
  BAKEOFF,
  chat,
  chatStream,
  type DiagramAsk,
  diagramSpec,
  guarded,
  Ledger,
  type PhotoAsk,
  type PhotoResult,
  pictureService,
  replayStream,
  STEP_EST,
  shareBudget,
  writeJson,
} from "./services";

/* ------------------------------------------------------------------ */
/* Types: brief, plugin                                                */
/* ------------------------------------------------------------------ */

export type Stage = "ks1" | "ks2" | "ks3" | "ks4" | "ks5";
export type Brief = {
  /** Round 8: the teacher's locale (from their account); England when absent. */
  locale?: Locale;
  id: string;
  topic: string;
  subject: string;
  yearGroup: string;
  year: number;
  keyStage: Stage;
  /** Round 4 (Greg): task demand, separate from reading level; default core. */
  challenge?: "support" | "core" | "stretch";
  theme: "splash" | "studio";
  readingLevel: string;
  language: string;
  durationMin: number;
  exitTicketOnSlides: boolean;
  tier: "standard";
  slides: { min: number; max: number };
  /** A theme the teacher chose: it wins over the design call's `design.theme`. */
  teacherTheme?: string;
};

/** A visual a slide asks for, as the plugin reads it off the slide JSON. */
export type VisualAsk =
  | {
      key: string;
      type: "photo";
      shows: string;
      mustSee: string[];
      named: boolean;
      /** The slot's width / height, so search prefers that shape and generation renders at it. */
      aspect?: number;
      /** The slot crops to its own box (compare cards, sequences): the flow's early job (no aspect) does not take it. */
      fixedShape?: boolean;
      /** Pictures meant to be compared on one slide (a sequence, compare cards) share an id: made together. */
      set?: string;
      /** The set shows one subject at stages (false: different things compared). */
      sameSubject?: boolean;
    }
  | {
      key: string;
      type: "diagram";
      kind: string;
      shows: string;
      labels: string[];
      /** R2 (b3-r2): the writer's own spec, drawn by code when it parses and fits. */
      spec?: unknown;
    };

/** What the harness knows about one visual when it materialises a slide. */
/**
 * The notes call's line for a placed diagram. By default the ask's raw labels ("Time (s), 0, 10,
 * 12, 22..."), which flatten a table or a set of shapes past reading (rootcause/base6-loss.txt
 * cluster B: blank answer keys). With `alt` (base6b-notes), the drawn spec's alt text, which states
 * the values; the labels stay as the fallback when the spec has no alt.
 */
export function notesDiagramLine(
  kind: string | undefined,
  labels: string[] | undefined,
  spec: unknown,
  alt: boolean,
): string {
  const s = spec as { alt?: unknown; drawn?: { alt?: unknown } } | undefined;
  const text = alt ? String(s?.alt ?? s?.drawn?.alt ?? "").trim() : "";
  return `Diagram (${kind}): ${text || (labels ?? []).join(", ")}`;
}

export type VisualState =
  | { status: "pending" }
  | { status: "failed" }
  | { status: "photo"; photo: PhotoResult }
  | { status: "diagram"; spec: unknown };

export type MaterialiseCtx = {
  brief: Brief;
  theme: Theme;
  stage: Stage;
  index: number;
  /** The whole streamed output so far (objectives, flow, slides done). */
  plan: Plan;
  /** Visual states by key (keys as the plugin's `visuals` returned them for this slide). */
  visual: (key: string) => VisualState;
};
export type Materialised = {
  slide: Pick<Slide, "kind" | "elements" | "background">;
  /** Over-capacity marks from the layout (text over its zone, a diagram that would not draw). */
  over: string[];
  /** Round 2: why a diagram on the slide could not draw (the slide was laid out words only). */
  diagram?: string[];
};

export type Design = { theme?: string; picture_style?: "photo" | "illustration" };
export type FlowEntry = {
  slide: number;
  does: string;
  /** Round 9: the writer's visual decision for the slide (schema `look`: kind and what it shows). */
  look?: { kind: string; shows: string | null };
};
export type Plan = {
  design?: Design;
  objectives?: { teacher: string; pupil: string }[];
  flow?: {
    slide: number;
    does: string;
    look?: { kind: string; shows: string | null };
    /** Round 4: the objective numbers this slide teaches or checks. */
    teaches?: number[];
  }[];
  slides: (Record<string, unknown> | undefined)[];
  /** exit1: the writer's exit_ticket as code placed it (ab/exit-ticket.ts). */
  exitTicket?: PlacedExitTicket;
};

export interface ArmPlugin {
  id: string;
  /** System prompt, strict JSON schema, model and effort for the one planning call. */
  prompt(brief: Brief): {
    system: string;
    schema: object;
    model: string;
    effort?: "minimal" | "low" | "medium" | "high";
  };
  /** The visuals one finished slide asks for (keys unique within the slide, e.g. "picture", "seq.2"). */
  visuals(
    slide: Record<string, unknown>,
    index: number,
    ctx: Omit<MaterialiseCtx, "index" | "visual">,
  ): VisualAsk[];
  /** Lay one slide out from its JSON and the visuals' current states. Called again whenever a visual lands. */
  materialise(slide: Record<string, unknown>, ctx: MaterialiseCtx): Materialised;
  /** The questions on a slide (for the answerable check and the notes' answers). */
  questions(slide: Record<string, unknown>): string[];
  /** The slide's own words (for checks, the picture director and the diagram spec call). */
  words(slide: Record<string, unknown>): string;
  /** Round 2: the slide with its failed diagram turned into a picture request of the same thing (or undefined). */
  asPicture?(slide: Record<string, unknown>): Record<string, unknown> | undefined;
  /** Round 7: the slide with its schematic pictures (`which` picks them) asked for as diagrams. */
  asDiagram?(
    slide: Record<string, unknown>,
    which: (shows: string) => boolean,
  ): Record<string, unknown> | undefined;
  /** Round 5: the slide as words only, with any sentence pointing at its missing visual removed. */
  asWords?(
    slide: Record<string, unknown>,
    opts?: { keepPointing?: boolean },
  ): Record<string, unknown> | undefined;
  /**
   * Round 4: a table that cannot draw, as words that keep its data. Round 6: as cards or labelled
   * points (a row's first cell names it), never cells joined by separators.
   */
  asTableText?(
    slide: Record<string, unknown>,
    table: TableData,
  ): Record<string, unknown> | undefined;
  /** Optional: a provisional slide from its flow entry alone (Greg 6 Oct, decision a), replaced when its content arrives. */
  placeholder?(flow: FlowEntry, ctx: Omit<MaterialiseCtx, "visual">): Materialised;
  /** Optional: the objectives slide from approved objectives (two-phase runs), before the design call answers. */
  codeObjectives?(ctx: Omit<MaterialiseCtx, "visual">): Materialised;
  /** Optional: the prompt files' stage key (T: KS1 | KS2 | KS3-5; R: KS1 | KS2 | KS3-4 | KS5). */
  promptStage?(brief: Brief): string;
  /** Optional: the title slide made in code from the brief before the call returns anything. */
  codeTitle?(brief: Brief, ctx: Omit<MaterialiseCtx, "index" | "plan" | "visual">): Materialised;
}

/* ------------------------------------------------------------------ */
/* Context block (the main call's user turn)                           */
/* ------------------------------------------------------------------ */

/** lesson-objectives.ts `objectiveCount`, at the middle of the brief's slide range. */
export function objectiveCount(b: Brief): string {
  const n = Math.round((b.slides.min + b.slides.max) / 2);
  return n <= 7 ? "one or two" : n <= 11 ? "two or three" : "three or four";
}

/** A placed picture as the notes call sees it: its alt (what it is), plus the subjects seen in it. */
export function placedPictureText(
  photo: { alt?: string; subjects?: { name: string }[] } | undefined,
  request: string,
): string {
  const alt = photo?.alt?.trim();
  const seen = (photo?.subjects ?? []).map((x) => x.name).filter(Boolean);
  return `${alt || request}${seen.length ? ` (visible: ${seen.join(", ")})` : ""}`;
}

/**
 * K3 (D11, 7 Oct): why a writer output is incomplete, or undefined when it is whole. A stream cut
 * at the token limit, JSON that does not close, or fewer slides than the brief allows fails the run
 * (one retry in ab/run.sh) instead of saving the flow's placeholders as a headings-only deck.
 */
/** request.json (audit F7): hashes of the system and user exactly as sent (localised), and the locale. */
export function sentShas(system: string, user: string, l: Locale = locale()) {
  const sys = localise(system, l);
  const usr = localise(user, l);
  return {
    sentSystemSha: sha(sys),
    sentSystemChars: sys.length,
    sentUserSha: sha(usr),
    locale: l,
  };
}

export function writerIncomplete(o: {
  finishReason?: string | null;
  text: string;
  minSlides: number;
}): string | undefined {
  if (o.finishReason === "length") return "finish_reason length (token limit)";
  let out: { slides?: unknown[] };
  try {
    out = JSON.parse(o.text);
  } catch {
    return "writer JSON does not parse";
  }
  // `slides` holds slide 3 onwards (title and objectives are their own keys).
  const n = Array.isArray(out?.slides) ? out.slides.length : 0;
  if (n < o.minSlides - 2)
    return `${n} slides after title and objectives, under ${o.minSlides - 2}`;
  return undefined;
}

/** A 32-bit FNV-1a hash of a string (seeds the hinge shuffle). */
function fnv(x: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * Seeded hinge shuffle (D11, 7 Oct): the writer put the answer at B on 76% of hinges. The options
 * are permuted by a seeded Fisher-Yates (same seed, same order), so the correct option's position is
 * uniform across seeds; `correct` follows its option. The notes and answer keys are written later from
 * the slide as shown (and `withCorrectLetter` reads `correct`), so they match the new order.
 */
export function shuffleHinge(
  slide: Record<string, unknown>,
  seed: string,
): Record<string, unknown> {
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
export function withCorrectLetter(
  answers: string | null,
  slide: Record<string, unknown> | undefined,
) {
  const c = Number(slide?.correct);
  if (!answers || !Number.isInteger(c) || c < 1 || c > 6) return answers;
  const letter = String.fromCharCode(64 + c);
  return new RegExp(`^\\s*${letter}\\b`).test(answers) ? answers : `${letter}: ${answers}`;
}

/** Diagram kinds that are data: a picture cannot stand in for them (round 5 fallback order). */
export const DATA_KINDS = new Set([
  "table",
  "line-graph",
  "bar-chart",
  "bar-model",
  "number-line",
  "pie",
  "venn",
  "carroll",
  "hydrograph",
]);
/**
 * Round 8 (boundary audit B7): no keyword rule judges what a request means (the round 6-7
 * isApparatus, SCHEMATIC and PORTRAIT regexes are gone). A placed picture is refused only by an
 * LLM verdict carried on it (`veto`, the director's or judge's reason); code enforces, never decides.
 */
export function pictureVeto(r: object): string | undefined {
  const v = (r as { veto?: unknown }).veto;
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Round 7 (r7 y12 s8: the repair redrew a graph as a table and kept "Compare the curves"): an
 * `ask` written for one visual is not shown with another. A repaired figure whose kind changed
 * while its ask stayed the same shows its `ask_without` line instead.
 */
export function keepAsksHonest(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...after };
  for (const k of ["picture", "diagram", "figure"]) {
    const b = before[k] as Record<string, unknown> | undefined;
    const a = out[k] as Record<string, unknown> | undefined;
    if (!a || typeof a !== "object" || typeof a.ask !== "string") continue;
    const kindOf = (f?: Record<string, unknown>) =>
      f && typeof f === "object" ? (f.kind ?? "picture") : undefined;
    if (!b || kindOf(b) !== kindOf(a))
      if (!b || b.ask === a.ask) out[k] = { ...a, ask: a.ask_without ?? null };
  }
  return out;
}

/** A failed diagram may become a picture of the same thing unless it is data or a schematic. */
/**
 * Round 8: a diagram call's task line and slot. Round 9 (regression audit cause 3): the slot is the
 * box the layout really gives (limits.ts slotBox, measured from layoutTemplate: 348 x 284 beside
 * text, 788 x 223-235 across), not the 403 x 378 / 844 x 380 round 8 told the drawer.
 */
export function diagramContext(
  s: Record<string, unknown> | undefined,
  stage = "ks3",
): {
  task?: string;
  slot: { placement: "beside text" | "across the slide"; w: number; h: number; name: DiagramSlot };
} {
  const name = slotOf(String(s?.template ?? ""));
  const f = (s?.figure ?? s?.diagram) as { ask?: unknown } | undefined;
  return {
    ...(f && typeof f.ask === "string" && f.ask.trim() ? { task: f.ask } : {}),
    slot: {
      placement: name === "full" ? "across the slide" : "beside text",
      ...slotBox(stage, name),
      name,
    },
  };
}

/** Round 8: the layouts a slide may switch to in a fit repair (same job, other room). */
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

/** The layouts menu cut to the header, the slide's own layout and those it may switch to. */
export function layoutsFor(menu: string, template: string): string {
  const keep = new Set([template, ...(SWITCH[template] ?? [])]);
  return menu
    .split("\n")
    .filter((l, k) => k === 0 || keep.has(/^- ([a-z-]+):/.exec(l)?.[1] ?? ""))
    .join("\n")
    .trim();
}

/**
 * Round 9 (regression audit cause 4/5): the fault a stand-alone or reroute call is given: which
 * figure is missing, what it was to show and, for a diagram, its parts, so the slide can carry that
 * content in words (or a readable layout) with no line pointing at it.
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

/** Round 9: catalogue/fit.json, the measured characters per field (lab/bakeoff/fit-table.ts). */
type FitLimit = { item: number; total: number; instruction?: number };
type FitVariant = {
  label: string;
  /** Round 9 calibration (round9/calibrate.py): each item, all the text, the instruction. */
  limit?: FitLimit;
  limitBare?: FitLimit;
  noInstruction?: boolean;
  counts: Record<string, number>;
  figure: boolean;
  keyCards?: boolean;
  chars: number;
  instruction?: number;
  charsNoInstruction?: number;
  stem?: number;
  keyLabel?: number;
  columnLabel?: number;
};
type FitGroup = {
  heading: number;
  formula: number;
  formulaBesideFigure: number;
  layouts: Record<string, { fields: string[]; variants: FitVariant[] }>;
};
let fitCache: Record<string, FitGroup> | undefined;
export function fitTable(): Record<string, FitGroup> {
  if (!fitCache) {
    const f = `${BAKEOFF}/catalogue/fit.json`;
    fitCache = existsSync(f)
      ? (JSON.parse(readFileSync(f, "utf8")) as { groups: Record<string, FitGroup> }).groups
      : {};
  }
  return fitCache;
}

/**
 * Round 9: each text field over its measured limit, as `field: N characters, room M (K over)`. The
 * slide's way of filling its layout is matched by its item count and figure (the smallest room of
 * the ways that hold that count, so the repair aims under every one of them).
 */
export function charsOver(slide: unknown, stage: string): string[] {
  const s = (slide ?? {}) as Record<string, unknown>;
  const F = fitTable()[stage];
  const L = F?.layouts[String(s.template)];
  if (!F || !L) return [];
  const listKey = ["points", "questions", "options", "columns", "sequence"].find((k) =>
    Array.isArray(s[k]),
  );
  const items = listKey ? (s[listKey] as unknown[]) : [];
  const fig = !!(s.figure ?? s.picture);
  const countKey: Record<string, string> = {
    options: "options",
    columns: "columns",
    sequence: "sequence",
    questions: "questions",
    points: "points",
  };
  const fitting = L.variants.filter(
    (v) =>
      v.chars > 0 &&
      v.figure === fig &&
      (listKey ? (v.counts[countKey[listKey] ?? listKey] ?? 0) >= items.length : true),
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
  const over = (field: string, text: unknown, cap: number | undefined, counts = true) => {
    const t = typeof text === "string" ? text : "";
    if (counts) all += t.length;
    if (cap && t.length > cap)
      out.push(`${field}: ${t.length} characters, room ${cap} (${t.length - cap} over)`);
  };
  over("heading", s.heading, F.heading, false);
  if (typeof s.lead === "string") over("lead", s.lead, lim.item);
  if (typeof s.instruction === "string")
    over("instruction", s.instruction, v.noInstruction ? 1 : lim.instruction);
  if (typeof s.stem === "string") over("stem", s.stem, v.stem);
  if (typeof s.formula === "string")
    over("formula", s.formula, fig ? F.formulaBesideFigure : F.formula, false);
  items.forEach((it, k) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const text = typeof it === "string" ? it : (o.text ?? o.caption);
    over(`${listKey}[${k + 1}]`, text, lim.item);
    if (typeof o.label === "string")
      over(`${listKey}[${k + 1}].label`, o.label, v.keyLabel ?? v.columnLabel, false);
  });
  // Round 9 (prompt audit 6): the figure's ask, or its ask_without when the figure is not shown,
  // is on the slide too; the longer counts toward the total.
  all += Math.max(
    0,
    ...["figure", "picture", "diagram"].flatMap((k) => {
      const f = s[k] as Record<string, unknown> | null | undefined;
      return f && typeof f === "object" ? [str(f.ask).length, str(f.ask_without).length] : [];
    }),
  );
  if (all > lim.total)
    out.push(
      `all the slide's text: ${all} characters, room ${lim.total} (${all - lim.total} over)`,
    );
  return out;
}

/** Whether a writer slide asks for any picture or diagram (its figure, a card's or a panel's). */
export function asksVisual(s: Record<string, unknown>): boolean {
  if (["figure", "picture", "diagram"].some((k) => s[k] && typeof s[k] === "object")) return true;
  const cards = [...((s.columns as unknown[]) ?? []), ...((s.sequence as unknown[]) ?? [])];
  return cards.some(
    (c) => !!c && typeof c === "object" && !!(c as Record<string, unknown>).picture,
  );
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
};
/**
 * Round 9 (coordinator 6): a slide the flow's `look` says shows a picture, but which asks for
 * none, gets that picture from look's `shows` phrase (an explain slide becomes visual-text, its
 * picture beside the same words). A diagram look needs a kind the flow does not give, so it is only
 * reported (look-unmet). Never throws.
 */
export function withLook(
  s: Record<string, unknown>,
  look: { kind: string; shows: string | null } | undefined,
): { slide: Record<string, unknown>; how?: string } {
  if (!look || look.kind !== "picture" || !look.shows?.trim() || asksVisual(s)) return { slide: s };
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
  return field ? { slide: { ...s, [field]: pic }, how: `${field}-from-look` } : { slide: s };
}

/**
 * Round 9 (review B2): the room a slide has, in the writer's units, for a stand-alone or reroute
 * call: each item, all the text, the instruction, for the slide's layout without its figure.
 */
export function roomLine(slide: unknown, stage: string): string {
  const s = { ...((slide ?? {}) as Record<string, unknown>) };
  for (const k of ["figure", "picture", "diagram"]) s[k] = null;
  const F = fitTable()[stage];
  const L = F?.layouts[String(s.template)];
  if (!F || !L) return "";
  const listKey = ["points", "questions", "options", "columns", "sequence"].find((k) =>
    Array.isArray(s[k]),
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
  return `room: the heading up to ${F.heading} characters; each item up to ${lim.item} characters; all the slide's text up to ${lim.total} characters${lim.instruction ? `; an instruction up to ${lim.instruction} characters` : ""}`;
}

/** Round 9: points over the room, summed over a slide's overflow faults ("overflow: x 354/328pt"). */
export function overflowPt(faults: string[]): number {
  let t = 0;
  for (const f of faults) {
    const m = /^(?:overflow|clipped): .*?(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*pt/.exec(f);
    if (m) t += Math.max(0, Number(m[1]) - Number(m[2]));
  }
  return t;
}
export const OVERFLOW = /^(overflow|clipped|cut):/;
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** A request's content words, sorted (two requests for the same subject compare equal). */
export const plainWords = (t: string) =>
  [...new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? [])].sort().join(" ");

/**
 * Round 9 (review S1, coordinator 3): the fixed fallback when a restaging call fails or is
 * rejected. A sequence kind's parts become the slide's steps, in order, one part per line; any
 * other kind's figure is dropped and code removes the sentences that point at it.
 */
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
export function fixedFallback(
  slide: Record<string, unknown>,
  lost: { type: string; kind?: string; labels?: string[] },
  parts: string[],
  maxSteps: number,
): { slide: Record<string, unknown>; how: string } {
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
  const out: Record<string, unknown> = { ...slide, figure: null, picture: null, diagram: null };
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
  return { slide: out, how: "figure-dropped" };
}

/**
 * Round 9 (regression audit cause 2b): a fit fault in the repair's own units: which field and how
 * many characters over its measured room, never "about N lines" (round 8 said a 49 pt overflow was
 * "about 1 line", and 31 of 35 rewords were reverted). A fault no field explains (a picture aspect,
 * a heading wrap) keeps its slot name with the overflow said as a share of the room.
 */
export function repairTerms(fault: string, slide?: unknown, stage?: string): string {
  const m = /^(overflow|clipped): (.*?)\s*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*pt\b(.*)$/.exec(fault);
  if (!m) return fault;
  const fields = slide && stage ? charsOver(slide, stage) : [];
  if (fields.length) return `${m[1]}: ${fields.join("; ")}`;
  const used = Number(m[3]);
  const room = Number(m[4]);
  const cut = Math.max(1, Math.ceil(((used - room) / used) * 100));
  return `${m[1]}: ${(m[2] ?? "").trim() || "the text"} needs about ${cut}% fewer characters to fit${m[5] ?? ""}`;
}

export const pictureFallbackOk = (kind: string | undefined, _shows: string) =>
  !!kind && !DATA_KINDS.has(kind) && !MEANING_KINDS.has(kind);
/** Round 8: code-drawn kinds whose meaning a picture cannot carry (counts, shares, states, links). */
export const MEANING_KINDS = new Set(["equal-groups", "fraction-shapes", "particles", "flow"]);

/** Round 8: the teaching point a picture is for: the line that sends pupils to it, else the lead. */
export function pointOf(s: Record<string, unknown>): string {
  for (const k of ["figure", "picture", "diagram"]) {
    const f = s[k] as { ask?: unknown } | null | undefined;
    if (f && typeof f.ask === "string" && f.ask.trim()) return f.ask;
  }
  return typeof s.lead === "string" ? s.lead : typeof s.ask === "string" ? s.ask : "";
}

/** A table's data as header and rows. */
export type TableData = { header?: string[]; rows: string[][] };

/**
 * A table's header and rows from its drawn-or-not spec, else from the ask's labels when they divide
 * into whole rows of the header's length (header first).
 */
export function tableRows(v: VisualState | undefined, ask: { labels?: string[] }): TableData {
  const spec = (v as { spec?: { header?: string[]; rows?: string[][] } } | undefined)?.spec;
  let header = spec?.header;
  let rows = spec?.rows;
  if (!rows?.length) {
    const l = ask.labels ?? [];
    const cols = l.findIndex((x) => /^[\d.,−-]+$/.test(x.trim()));
    if (cols > 0 && (l.length - cols) % cols === 0) {
      header = l.slice(0, cols);
      rows = [];
      for (let k = cols; k < l.length; k += cols) rows.push(l.slice(k, k + cols));
    }
  }
  return { ...(header?.length ? { header } : {}), rows: rows ?? [] };
}

/** A step the run can't go on without: waits for other holds to release, then throws past the cap. */
async function mustHold(ledger: Ledger, what: string, est: number) {
  // Round 5: a step the run cannot go on without waits up to 5 minutes for peers' holds.
  const held = await ledger.holdWhenFree(what, est, 300_000);
  if (!held) throw new Error(`cap $${ledger.capUsd} would be passed by ${what} (held $${est})`);
  return held;
}

/**
 * The pupil line's word limit (round 4 fix, y1 "Compare size, body covering: cat, kitten, hen,
 * chick."): the objectives slide's measured room for this many objectives at this key stage
 * (`catalogue/T.json` objectives variant, maxCharsPerItem ÷ 6, prompts CHANGELOG 41). The fixed
 * 8/10/12 words it replaces gave KS1 two objectives 8 words where the slide holds about 20.
 */
export function pupilWordLimit(stage: Stage, n: number, catalogue = `${BAKEOFF}/catalogue/T.json`) {
  const key = stage === "ks1" ? "KS1" : stage === "ks2" ? "KS2" : "KS3-5";
  try {
    const c = JSON.parse(readFileSync(catalogue, "utf8")) as {
      templates: {
        id: string;
        capacity?: Record<string, { variants: { label: string; maxCharsPerItem: number }[] }>;
      }[];
    };
    const o = c.templates.find((t) => t.id === "objectives");
    const v = o?.capacity?.[key]?.variants.find((x) => x.label === `${n} objectives`);
    if (v?.maxCharsPerItem) return Math.max(6, Math.floor(v.maxCharsPerItem / 6));
  } catch {}
  return OBJECTIVES_CONFIG.pupilMaxWords[stage];
}

export type FillExtras = {
  objectives?: { teacher: string; pupil: string }[];
  context?: string;
  [k: string]: unknown;
};
/**
 * Fills one of the prompt agent's user-turn templates (prompts/shared/*.txt, prompts/<arm>/*): brief
 * fields ({{topic}}, {{slides.min}}), {{flag ? "a" : "b"}}, the objective count, the approved
 * objectives as numbered lines, {{context block…}}, and any extra named block ({{objectives}} as JSON).
 */
export function fillTemplate(text: string, b: Brief, x: FillExtras = {}): string {
  const get = (path: string): unknown =>
    path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], b);
  return text.trim().replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    const expr = raw.trim();
    const t = expr.match(/^([\w.]+)\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"$/);
    if (t) return get(t[1] as string) ? (t[2] as string) : (t[3] as string);
    const d = expr.match(/^([\w.]+)\s*\?\?\s*"([^"]*)"$/);
    if (d) return String(get(d[1] as string) ?? d[2]);
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
    // Arm "locale": the key stage is England's ladder, so other countries' briefs drop it.
    if (expr === "keyStageNote") return isEngland(b.locale) ? ` (${b.keyStage})` : "";
    if (expr in x) return String(x[expr]);
    const v = get(expr);
    if (v === undefined) throw new Error(`template: no value for {{${expr}}}`);
    return String(v);
  });
}

/** The main call's user turn: prompts/shared/user.txt filled (with the approved objectives in two-phase runs), else a plain field list. */
/** The flow's visual decision: round 9's `look`, or round 5's `look_at` (same kind enum and shows). */
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
export function contextBlock(b: Brief, objectives?: { teacher: string; pupil: string }[]): string {
  const f = `${abShared() ?? `${BAKEOFF}/prompts/shared`}/user.txt`;
  // exit1: code adds the exit-ticket slide inside the brief's count, so its user.txt gives the writer
  // {{writerSlides.min}}..{{writerSlides.max}} (one fewer). Unused by every other arm's template.
  if (existsSync(f))
    return fillTemplate(readFileSync(f, "utf8"), b, {
      objectives,
      "writerSlides.min": b.slides.min - 1,
      "writerSlides.max": b.slides.max - 1,
    });
  return [
    `Topic: ${b.topic}`,
    `Subject: ${b.subject}`,
    `Year group: ${b.yearGroup} (${b.keyStage})`,
    `Reading level: ${b.readingLevel}`,
    `Language: ${b.language}`,
    `Lesson length: ${b.durationMin} minutes`,
    `Slides: ${b.slides.min} to ${b.slides.max}`,
    `Exit ticket: ${b.exitTicketOnSlides ? "on the last slide" : "on the worksheet, not the slides"}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

export type RunOpts = {
  arm: ArmPlugin;
  brief: Brief;
  outDir: string;
  capUsd: number;
  pgPort: number;
  /** Play a recorded main output back instead of calling the model (no spend on the main call). */
  replay?: string;
  /** Round 2: answer the repair from a recorded repair.jsonl (slide -> out) instead of calling it. */
  replayRepair?: string;
  /** A/B (7 Oct): a run directory whose objectives.json holds the approved objectives to reuse. */
  objectivesFrom?: string;
  /** exit1 code-only replay: the exit_ticket placed when the recorded writer has none (a fixture). */
  exitFixture?: { questions: string[] };
  /** exit1 code-only replay: place as on slides without changing the recorded user turn. */
  exitOnSlides?: boolean;
  /** Skip pictures and diagrams (layout-only dry run). */
  noVisuals?: boolean;
  /** A/B round 3: run only the writer (main) call; save request.json, main.json, cost.json, then stop. */
  writerOnly?: boolean;
  /** Reuse the pictures of an earlier run dir of the same replayed stream (offline re-layout; no spend). */
  reuseVisuals?: string;
  /** With reuseVisuals: these slides (1-based) fetch their pictures afresh; the rest reuse. */
  freshSlides?: number[];
  /** `generate`: every generic picture made in the house photo look (side-by-side B). */
  generic?: "stock-first" | "generate";
  /** No picture-library lookups. */
  noLibrary?: boolean;
  /** A directory shared by runs launched together: the cap holds across all of them. */
  budgetDir?: string;
  /** Skip the notes calls. */
  noNotes?: boolean;
  /** Skip the repair pass. */
  noRepair?: boolean;
  /** Let `design.theme` restyle the lesson. Off in the bake-off: every arm renders on the brief's fixed theme and the choice is only recorded. */
  modelTheme?: boolean;
  /** The run's picture-generation cap (bank), default $0.06. */
  bankCapUsd?: number;
};

export type RunResult = {
  lessonFile: string;
  timings: Record<string, number>;
  cost: Record<string, number>;
  checks: CheckResult[];
};

export async function runLesson(o0: RunOpts): Promise<RunResult> {
  // Writer-only: no pictures, diagrams, notes or repair; the request itself is unchanged.
  const o: RunOpts = o0.writerOnly ? { ...o0, noVisuals: true, noNotes: true, noRepair: true } : o0;
  const { arm, brief } = o;
  setLocale(brief.locale);
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const timings: Record<string, number> = {};
  const mark = (k: string) => {
    if (timings[k] === undefined) timings[k] = ms();
  };
  const logFile = `${o.outDir}/log.jsonl`;
  writeJson(`${o.outDir}/brief.json`, brief);
  const log = (e: object) => appendFileSync(logFile, `${JSON.stringify({ ms: ms(), ...e })}\n`);
  const ledger = new Ledger(o.capUsd);
  // One hard cap shared by runs launched side by side (--budget-dir): each counts the others.
  if (o.budgetDir) shareBudget(ledger, o.budgetDir, `${arm.id}-${brief.id}-${process.pid}`);
  let themeId: string = brief.teacherTheme ?? brief.theme;
  const base = {
    brief,
    theme: withKeyStage(brief.keyStage, () => getTheme(themeId, brief.keyStage)),
    stage: brief.keyStage,
  };
  const plan: Plan = { slides: [] };
  const lessonId = `bakeoff-${arm.id}-${brief.id}`;
  const lessonFile = `${o.outDir}/lesson.json`;

  // ── state ──
  const visuals = new Map<string, VisualState>();
  const asks = new Map<number, VisualAsk[]>();
  const laid = new Map<number, Materialised>();
  // Round 7: each slide as streamed, for the ask_without report (the fallbacks swap the slide).
  const firstSlides = new Map<number, Record<string, unknown>>();
  const notes = new Map<number, { notes: string; answers: string[] }>();
  /** Coordinator (7 Oct): continuation slides laid after slide i (the strip's overflowing items). */
  const continued = new Map<number, Materialised[]>();
  let title: Materialised | undefined;
  let flowSeen = 0;

  /** R1 stage 2 (b4-r1t2): the writer's own slides (items and tiles), and the slides stage 2 removed. */
  const rawR1t = new Map<number, Record<string, unknown>>();
  const removedSlides = new Set<number>();
  const save = (why: string) => {
    const slides: Slide[] = [];
    const n = Math.max(plan.slides.length, plan.flow?.length ?? 0, flowSeen, 1);
    for (let i = 0; i < n; i++) {
      const m = laid.get(i) ?? (i === 0 ? title : undefined);
      if (!m || removedSlides.has(i)) continue;
      slides.push({ id: `s${i + 1}`, ...m.slide, notes: notes.get(i)?.notes ?? "" } as Slide);
      for (const [k, c] of (continued.get(i) ?? []).entries())
        slides.push({ id: `s${i + 1}c${k + 1}`, ...c.slide, notes: "" } as Slide);
    }
    stampPictureSources(slides, visuals);
    // locale4: stock captions keep only the teacher's place (ab/caption.ts).
    if (abCaptions())
      for (const [k, sl] of slides.entries())
        slides[k] = localiseSlideAlts(sl, locale().country, brief.topic);
    // base6c/base7c: title, hook, objectives (Chalkie's order). Only the saved order changes; every
    // earlier step still sees the objectives at index 1. The exit ticket stays last either way.
    const shipped = abHookFirst() ? hookFirstOrder(slides) : slides;
    writeJson(lessonFile, {
      version: 1,
      id: lessonId,
      title: (plan.slides[0]?.heading as string) ?? brief.topic,
      themeId,
      // The web view re-fits (shrinks) text in any lesson without the current fit version (arm K's find).
      fitVersion: FIT_VERSION,
      subject: brief.subject,
      ageBand: brief.keyStage,
      yearGroup: brief.yearGroup,
      language: brief.language,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      slides: shipped,
      ...(plan.exitTicket ? { exitTicket: plan.exitTicket } : {}),
      bakeoff: { arm: arm.id, brief: brief.id, objectives: plan.objectives ?? [] },
    });
    log({ ev: "save", why, slides: slides.length });
  };

  const relay = (i: number, why: string) => {
    const s = plan.slides[i];
    if (!s) return;
    const visual = (key: string) =>
      visuals.get(`${i}:${key}`) ?? ({ status: o.noVisuals ? "failed" : "pending" } as VisualState);
    const m = withKeyStage(brief.keyStage, () =>
      arm.materialise(s, { ...base, index: i, plan, visual }),
    );
    laid.set(i, m);
    save(`${why} s${i + 1}`);
  };

  // ── a. title in code ──
  if (arm.codeTitle) {
    title = withKeyStage(brief.keyStage, () => arm.codeTitle?.(brief, base));
    save("code title");
    mark("title");
  }

  // ── visuals ──
  const reused = o.reuseVisuals ? reusedPhotos(o.reuseVisuals) : undefined;
  const reusedDia = o.reuseVisuals ? reusedDiagrams(o.reuseVisuals) : undefined;
  const reusedJsonl = new Map<string, unknown>();
  if (o.reuseVisuals && existsSync(`${o.reuseVisuals}/diagrams.jsonl`))
    for (const l of readFileSync(`${o.reuseVisuals}/diagrams.jsonl`, "utf8").split("\n"))
      if (l.trim()) {
        const r = JSON.parse(l) as { key: string; spec?: unknown };
        if (r.spec) reusedJsonl.set(r.key, r.spec);
      }
  const specsFile = `${o.outDir}/diagram-specs.json`;
  const reusedSpecs =
    o.reuseVisuals && existsSync(specsFile)
      ? (JSON.parse(readFileSync(specsFile, "utf8")) as Record<string, unknown>)
      : undefined;
  const pics =
    o.noVisuals || (reused && !o.freshSlides?.length)
      ? undefined
      : pictureService({
          runDir: o.outDir,
          pgPort: o.pgPort,
          ledger,
          // Room for every picture plus its one regeneration, with parallel reservations (y1 run4: at
          // $0.02-0.035 the guard refused 5 slots before any judge saw them).
          bankCapUsd: o.bankCapUsd ?? 0.15,
          ...(o.generic ? { generic: o.generic } : {}),
          ...(o.noLibrary ? { noLibrary: true } : {}),
          styleOf: () => ({
            style: plan.design?.picture_style,
            palette: [
              base.theme.colors.accent,
              base.theme.colors.accent2,
              base.theme.colors.background,
              base.theme.colors.ink,
            ],
          }),
        });
  if (pics) ledger.outside = pics.aiSpend;
  const jobs: Promise<void>[] = [];
  const lessonInfo = {
    id: lessonId,
    title: brief.topic,
    yearGroup: brief.yearGroup,
    subject: brief.subject,
    base: {} as Record<string, unknown>,
  };
  /** Early picture jobs from the flow, keyed by slide index; a slide's single picture takes it over. */
  const early = new Map<number, Promise<PhotoResult | undefined>>();
  /** Aborts an early flow job a slide doesn't take over (compare cards, sequences): no spend for nothing. */
  const earlyAbort = new Map<number, AbortController>();
  /** match6 (faults-3-6-8 #6b): each picture slot's writer must_see, by visual key. */
  const mustSeeAt = new Map<string, string[]>();
  const startPhoto = (
    i: number,
    a: Extract<VisualAsk, { type: "photo" }>,
    words: { heading: string; text: string; point?: string },
    signal?: AbortSignal,
  ) => {
    const k = `${i}:${a.key}`;
    const fresh = o.freshSlides?.includes(i + 1);
    mustSeeAt.set(k, a.mustSee);
    if (reused && !fresh) {
      // The flow's early job stands for the slide's first picture (it takes the job over).
      const first = [...reused.keys()].find(
        (x) => x.startsWith(`${i}:`) && !x.includes("seq.") && !x.includes("col."),
      );
      return Promise.resolve(reused.get(a.key === "early" && first ? first : k));
    }
    if (!pics) return;
    visuals.set(k, { status: "pending" });
    const ask: PhotoAsk = {
      key: k,
      shows: a.shows,
      mustSee: a.mustSee,
      named: a.named,
      ...(a.aspect ? { aspect: a.aspect } : {}),
      ...(a.fixedShape ? { fixedShape: true } : {}),
      ...(plan.design?.picture_style ? { style: plan.design.picture_style } : {}),
      slide: { heading: words.heading, text: words.text, point: words.point ?? "" },
      index: i,
      ...(signal ? { signal } : {}),
      // Round 9 (coordinator F): the flow's look named a picture: the director must find one.
      ...(/^picture/.test(lookOf(plan.flow?.find((x) => x.slide === i + 1))?.kind ?? "")
        ? { final: true }
        : {}),
    };
    log({ ev: "picture-start", key: k, shows: a.shows, aspect: a.aspect });
    return pics.find(ask, lessonInfo);
  };
  const startSet = (
    i: number,
    group: Extract<VisualAsk, { type: "photo" }>[],
    words: { heading: string; text: string },
  ) => {
    for (const a of group) mustSeeAt.set(`${i}:${a.key}`, a.mustSee);
    if (reused && !o.freshSlides?.includes(i + 1))
      return Promise.resolve(group.map((a) => reused.get(`${i}:${a.key}`)));
    if (!pics) return;
    const asks: PhotoAsk[] = group.map((a) => {
      const k = `${i}:${a.key}`;
      visuals.set(k, { status: "pending" });
      log({ ev: "picture-start", key: k, shows: a.shows, aspect: a.aspect, set: a.set });
      return {
        key: k,
        shows: a.shows,
        mustSee: a.mustSee,
        named: a.named,
        ...(a.aspect ? { aspect: a.aspect } : {}),
        ...(a.fixedShape ? { fixedShape: true } : {}),
        ...(a.sameSubject === false ? { sameSubject: false } : {}),
        ...(plan.design?.picture_style ? { style: plan.design.picture_style } : {}),
        slide: { heading: words.heading, text: words.text, point: "" },
        index: i,
      };
    });
    return pics.findSet(asks, lessonInfo);
  };
  /** Round 9: why the director vetoed a picture, by visual key (the reroute call is told). */
  const vetoed = new Map<string, string>();
  const landPhoto = (i: number, key: string, p: Promise<PhotoResult | undefined>) =>
    jobs.push(
      // A picture job never throws into the run (round 2): a failure is a failed picture.
      p
        .catch((e) => {
          log({ ev: "picture-error", key: `${i}:${key}`, err: String(e).slice(0, 200) });
          return undefined;
        })
        .then((r0) => {
          const veto = r0 ? pictureVeto(r0) : undefined;
          if (veto) {
            vetoed.set(`${i}:${key}`, veto);
            log({ ev: "picture-veto", key: `${i}:${key}`, why: veto, request: r0?.request });
          }
          // match6: a several-thing slot ships its picture only when the judge saw every thing.
          const unmatched =
            abMatch6() && r0 && !veto
              ? unmatchedItems(mustSeeAt.get(`${i}:${key}`) ?? [], seenOf(r0 as never))
              : [];
          if (unmatched.length)
            log({ ev: "match6-drop", key: `${i}:${key}`, unmatched, request: r0?.request });
          const r = veto || unmatched.length ? undefined : r0;
          visuals.set(`${i}:${key}`, r ? { status: "photo", photo: r } : { status: "failed" });
          // One picture at most once per lesson unless the same request asks for it (K's y1 smoke:
          // the title photo came back on another slide). The later slide loses it and falls back.
          for (const k of repeatedPictures(visuals)) {
            visuals.set(k, { status: "failed" });
            log({ ev: "picture-duplicate", key: k });
            relay(Number(k.split(":")[0]), "picture");
          }
          log({
            ev: "picture-done",
            key: `${i}:${key}`,
            ok: !!r,
            src: r?.src,
            provider: r?.provider,
            ...(r ? { id: pictureId(r), style: r.style ?? "photo" } : {}),
            ...(r?.period ? { period: r.period } : {}),
          });
          mark("lastPicture");
          timings.lastPicture = ms();
          relay(i, "picture");
        }),
    );
  const startDiagram = (
    i: number,
    a: Extract<VisualAsk, { type: "diagram" }>,
    words: string,
    heading = "",
  ) => {
    const k = `${i}:${a.key}`;
    // figureSync: a stored spec whose numbers the slide's words no longer say (a repaired y5 bar) is
    // not served again; the diagram takes the live path (an R2 writer spec is drawn by code, no call).
    const stored = reusedDia ? (reusedSpecs?.[String(i)] ?? reusedJsonl.get(k)) : undefined;
    const staleReuse =
      abFigureSync() && stored
        ? figureTextMismatch(stored, plan.slides[i] as Record<string, unknown> | undefined)
        : undefined;
    if (staleReuse) log({ ev: "figure-stale-reuse", key: k, why: staleReuse });
    if (reusedDia && !staleReuse) {
      // Offline re-layout: the drawing the earlier run placed on this slide (no spec call).
      // Round 1: a recorded spec (`<outDir>/diagram-specs.json`, slide index -> spec) is drawn
      // again through drawDiagram instead of reusing the old SVG, so the offline re-layout
      // exercises the live diagram path (a spec that cannot draw readably falls back to words).
      // Round 6: the spec the earlier run's diagram call returned (diagrams.jsonl), so a diagram
      // that failed its layout then is laid out again by today's code.
      const spec = reusedSpecs?.[String(i)] ?? reusedJsonl.get(k);
      const d = reusedDia.get(i);
      visuals.set(
        k,
        spec
          ? { status: "diagram", spec }
          : d
            ? { status: "diagram", spec: { drawn: d } }
            : { status: "failed" },
      );
      log({ ev: "diagram-done", key: k, ok: !!(spec ?? d), reused: true });
      relay(i, "diagram");
      return;
    }
    visuals.set(k, { status: "pending" });
    const ask: DiagramAsk = {
      key: k,
      kind: a.kind,
      shows: a.shows,
      labels: a.labels,
      ...(a.spec ? { spec: a.spec } : {}),
      words,
      yearGroup: brief.yearGroup,
      ...diagramContext(plan.slides[i] as Record<string, unknown> | undefined, brief.keyStage),
      stage: brief.keyStage,
      theme: themeId,
      // lib arm: a library model's fill call reads the lesson; its builds strip goes under the run.
      ...(a.kind === "model"
        ? {
            lib: { lesson: `${brief.subject}: ${brief.topic}`, outDir: o.outDir },
            question: isQuestionSlide(plan.slides[i] as Record<string, unknown> | undefined),
          }
        : {}),
    };
    log({ ev: "diagram-start", key: k, kind: a.kind });
    jobs.push(
      diagramSpec(ask, ledger, log)
        .catch((e) => {
          log({ ev: "diagram-error", key: k, err: String(e).slice(0, 200) });
          return undefined;
        })
        .then((raw) => {
          const spec = raw && dropEchoTitle(raw, heading);
          visuals.set(k, spec ? { status: "diagram", spec } : { status: "failed" });
          log({ ev: "diagram-done", key: k, ok: !!spec });
          // Round 5: specs are saved so a later run can replay them as a pre-launch smoke gate.
          if (spec)
            appendFileSync(
              `${o.outDir}/diagrams.jsonl`,
              `${JSON.stringify({ key: k, kind: a.kind, spec })}\n`,
            );
          timings.lastDiagram = ms();
          relay(i, "diagram");
        }),
    );
  };

  // ── b. the streamed planning call ──
  const slideIndexOf = slideIndexer();
  // exit1: the writer's exit_ticket (after its slides) becomes the last slide, through the slide path.
  const placeExit = (v: unknown, how: "writer" | "fixture") => {
    const et = readExitTicket(v);
    if (!et || plan.exitTicket) return;
    const planned = Math.max(plan.slides.length, 2);
    const x = exitTicketSlide(et, Boolean(o.exitOnSlides ?? brief.exitTicketOnSlides), planned);
    plan.exitTicket = x.placed;
    plan.flow = [...(plan.flow ?? []), x.flow as NonNullable<Plan["flow"]>[number]];
    flowSeen = Math.max(flowSeen, planned + 1);
    log({ ev: "exit-ticket", how, ...x.placed });
    onValue(["slides", planned - 2] as Parameters<typeof onValue>[0], x.slide);
  };
  const onValue = (path: Path, v: unknown) => {
    const [top] = path;
    if (top === "exit_ticket" && path.length === 1 && abExitTicket()) return placeExit(v, "writer");
    const idx = slideIndexOf(path, v);
    if (top === "design" && path.length === 1) {
      plan.design = v as Design;
      applyDesign();
    }
    if (top === "objectives" && path.length === 1 && Array.isArray(v) && !twoPhase) {
      plan.objectives = v as Plan["objectives"];
      // The picture stock path judges photos against the lesson's objectives (illustrate.ts).
      lessonInfo.base = {
        facts: {
          objectives: (plan.objectives ?? []).map((x, k) => ({ id: `o${k + 1}`, text: x.teacher })),
          outline: [],
        },
      };
      log({ ev: "objectives", n: plan.objectives?.length });
      mark("objectives");
    }
    // Each flow entry starts its slide's picture the moment it closes (smoke 2: the whole flow took
    // 22 s to stream, so waiting for it delayed the first pictures by up to that much).
    if (top === "flow" && path.length === 2) {
      const f = v as NonNullable<Plan["flow"]>[number];
      const i = f.slide - 1;
      flowSeen = Math.max(flowSeen, i + 1);
      // Decision a: the slide appears from its flow entry at once, provisional until its content arrives.
      if (arm.placeholder && i >= 2 && !laid.has(i)) {
        laid.set(
          i,
          withKeyStage(
            brief.keyStage,
            () => arm.placeholder?.(f, { ...base, index: i, plan }) as Materialised,
          ),
        );
        save(`placeholder s${i + 1}`);
        mark("firstPlaceholder");
      }
      // Round 8 (dataflow audit A, item 4): the flow plans; it starts no picture. Every picture
      // and diagram comes from its slide's own request, started when that slide closes.
    }
    if (top === "flow" && path.length === 1) {
      plan.flow = v as Plan["flow"];
      mark("flow");
      log({ ev: "flow", n: plan.flow?.length });
      // Round 4: coverage as planned, before any slide is written (logged; repaired after the stream).
      if (plan.flow?.some((f) => Array.isArray(f.teaches)))
        log({
          ev: "coverage-flow",
          ...coverage(plan.flow, plan.objectives?.length ?? 0, () => undefined),
        });
    }
    // Slide 2 belongs to code in the two-phase flow (pupil wording call); a streamed one is ignored.
    if (idx === 1 && twoPhase && arm.codeObjectives) return;
    if (idx !== undefined) {
      let s = v as Record<string, unknown>;
      // Round 6 (r5 y11 s6 drew garbled apparatus): apparatus is a photo, as in round 3. A drawn
      // apparatus is never placed; a slide whose photo cannot be found stands alone in words.
      const first = withKeyStage(brief.keyStage, () => arm.visuals(s, idx, { ...base, plan }));
      // Round 8 (boundary audit B7): no keyword rule swaps a picture for a diagram or a diagram
      // for a picture; the writer's kind stands, and the picture director decides a picture's route.
      void first;
      // Round 6: no em dashes on slides (Greg 1 Oct; r5 y8).
      s = slideNoEmDash(s);
      // D11 fix (base3 onwards): the hinge's correct option lands at a seeded, uniform position.
      // b3-r1t (writer-only stage): items to text and the first tile as the picture, for the rest of the harness.
      if (abR1t2()) rawR1t.set(idx, s);
      if (abR1t()) s = flattenR1t(s);
      if (abFixes()) s = shuffleHinge(s, `${brief.id}:${idx}:${String(s.stem ?? "")}`);
      // Round 9 (coordinator 6): the flow's look is the writer's visual decision. A slide whose
      // look names a picture but which asks for none gets the picture from look's phrase.
      // A/B base (coordinator 7 Oct): round 5's flow names it look_at; the same field, read the same way.
      const look = lookOf(plan.flow?.find((x) => x.slide === idx + 1));
      const added = withLook(s, look);
      if (added.how) {
        log({ ev: "look-added", slide: idx + 1, how: added.how, shows: look?.shows });
        s = added.slide;
      } else if (look && look.kind !== "none" && !asksVisual(s))
        log({ ev: "look-unmet", slide: idx + 1, kind: look.kind, shows: look.shows });
      plan.slides[idx] = s;
      firstSlides.set(idx, s);
      const as = withKeyStage(brief.keyStage, () => arm.visuals(s, idx, { ...base, plan }));
      asks.set(idx, as);
      const words = arm.words(s);
      const heading = String(s.heading ?? "");
      const photos = as.filter(
        (a): a is Extract<VisualAsk, { type: "photo" }> => a.type === "photo",
      );
      const e = early.get(idx);
      // Same-subject sets are made together (one strip, one subject); the rest one by one.
      const sets = new Map<string, Extract<VisualAsk, { type: "photo" }>[]>();
      for (const a of photos) if (a.set) sets.set(a.set, [...(sets.get(a.set) ?? []), a]);
      for (const group of sets.values()) {
        if (group.length < 2) continue;
        const all = startSet(idx, group, { heading, text: words });
        if (all)
          for (const [n, a] of group.entries())
            landPhoto(
              idx,
              a.key,
              all.then((r) => r[n]),
            );
      }
      // Round 5: an early job this slide will not take over is stopped (y1 r4: "a cow with a calf
      // and a hen with a chick" was generated and judged twice for a compare slide that never used it).
      const takes = !!e && !!photos[0] && !photos[0].fixedShape && !photos[0].set;
      if (e && !takes) {
        earlyAbort.get(idx)?.abort();
        log({
          ev: "early-dropped",
          slide: idx + 1,
          why: photos.length ? "slide uses its own slots" : "no picture on the slide",
        });
      }
      photos.forEach((a, n) => {
        if (a.set && (sets.get(a.set)?.length ?? 0) >= 2 && (pics || reused)) return;
        // The slide's first picture takes over the flow's early job (already running).
        if (n === 0 && e && takes) {
          visuals.set(`${idx}:${a.key}`, { status: "pending" });
          landPhoto(idx, a.key, e);
          return;
        }
        const p = startPhoto(idx, a, { heading, text: words, point: pointOf(s) });
        if (p) landPhoto(idx, a.key, p);
      });
      if (!o.noVisuals)
        for (const a of as)
          if (a.type === "diagram") startDiagram(idx, a, `${heading}\n${words}`, heading);
      relay(idx, "slide");
      if (idx === 1) mark("objectivesSlide");
      if (idx >= 2) mark("firstTeachingSlide");
    }
  };
  function applyDesign() {
    const d = plan.design ?? {};
    const chosen = brief.teacherTheme ? brief.teacherTheme : o.modelTheme ? d.theme : undefined;
    let ok = false;
    if (chosen && chosen !== themeId) {
      try {
        base.theme = withKeyStage(brief.keyStage, () => getTheme(chosen, brief.keyStage));
        ok = base.theme.id === chosen;
      } catch {
        ok = false;
      }
      if (ok) themeId = chosen;
    }
    timings.design = ms();
    log({
      ev: "design",
      theme: themeId,
      modelTheme: d.theme ?? null,
      teacherTheme: brief.teacherTheme ?? null,
      unknownTheme: !!chosen && !ok && chosen !== themeId,
      pictureStyle: d.picture_style ?? null,
    });
    // The title (and anything already laid) takes the chosen theme.
    if (arm.codeTitle) title = withKeyStage(brief.keyStage, () => arm.codeTitle?.(brief, base));
    for (const i of laid.keys()) if (plan.slides[i]) relay(i, "theme");
    save("design");
  }

  // ── b0. two phases (Greg 6 Oct, decision b): an objectives call, the teacher signs off (auto here),
  // then the design call takes the approved objectives. Only when the prompt agent's files exist.
  // A/B: the arm's own shared prompts (round 5's, ab/prompts/<arm>/shared).
  const shared0 = abShared() ?? `${BAKEOFF}/prompts/shared`;
  const twoPhase =
    !o.replay &&
    !o.objectivesFrom &&
    existsSync(`${shared0}/objectives.txt`) &&
    existsSync(`${shared0}/objectives-schema.json`);
  let signOffMs = 0;
  // A replay (pictures-only re-run) takes the recorded run's approved objectives, so the objectives
  // slide and the picture judge's lesson facts match the original run (both round-1 branches added this).
  // A/B (7 Oct): every arm reuses round 5's approved objectives for a brief (`objectivesFrom`), so
  // the writer's user turn is the same in every arm and the same as round 5's.
  const recordedObj = plan.objectives
    ? ""
    : o.objectivesFrom
      ? `${o.objectivesFrom}/objectives.json`
      : o.replay
        ? `${dirname(o.replay)}/objectives.json`
        : "";
  if (recordedObj && existsSync(recordedObj)) {
    const rec = JSON.parse(readFileSync(recordedObj, "utf8")) as {
      objectives?: { teacher: string; pupil: string }[];
    };
    if (rec.objectives?.length) {
      plan.objectives = rec.objectives;
      lessonInfo.base = {
        facts: {
          objectives: rec.objectives.map((x, k) => ({ id: `o${k + 1}`, text: x.teacher })),
          outline: [],
        },
      };
    }
  }
  let user = contextBlock(brief, plan.objectives);
  /** Slide 2 from code, with the pupil lines that have arrived (the model never writes slide 2). */
  const laySlide2 = (why: string) => {
    if (!arm.codeObjectives) return;
    const shown = { ...plan, objectives: (plan.objectives ?? []).filter((x) => x.pupil.trim()) };
    laid.set(
      1,
      withKeyStage(
        brief.keyStage,
        () => arm.codeObjectives?.({ ...base, index: 1, plan: shown }) as Materialised,
      ),
    );
    save(why);
  };
  // A/B: recorded objectives (round 5's, --objectives-from, or a replay) carry no pupil lines, and no
  // pupil call runs, so slide 2 is laid from the teacher wording, the same in every arm.
  if (abArm() && !twoPhase && plan.objectives?.length) {
    for (const x of plan.objectives) if (!x.pupil.trim()) x.pupil = x.teacher;
    laySlide2("objectives slide (recorded objectives, teacher wording)");
  }
  let pupilJob: Promise<void> = Promise.resolve();
  if (twoPhase) {
    // (1) Teacher objectives: Sol, Luna when no first objective has streamed by 8 s (code defaults).
    const heldObj = await mustHold(ledger, "objectives call", STEP_EST.objectives * 2);
    const run = await objectivesCall(
      {
        system: readFileSync(`${shared0}/objectives.txt`, "utf8"),
        user: existsSync(`${shared0}/objectives-user.txt`)
          ? fillTemplate(readFileSync(`${shared0}/objectives-user.txt`, "utf8"), brief)
          : user,
        schema: JSON.parse(readFileSync(`${shared0}/objectives-schema.json`, "utf8")),
        name: "objectives",
        maxTokens: 3000,
      },
      chatStream,
      () => mark("objectiveFirst"),
    );
    // An abandoned primary call's usage never arrives: its reserve is booked as spent.
    ledger.add("objectives", run.result.usd + (run.abandoned ? STEP_EST.objectives : 0));
    heldObj();
    mark("objectivesAll");
    const objectives = run.teacher.map((teacher) => ({ teacher, pupil: "" }));
    plan.objectives = objectives;
    lessonInfo.base = {
      facts: {
        objectives: objectives.map((x, k) => ({ id: `o${k + 1}`, text: x.teacher })),
        outline: [],
      },
    };
    log({
      ev: "objectives",
      n: objectives.length,
      phase: "objectives call",
      ran: run.ran,
      model: run.model,
      ...(run.abandoned ? { abandoned: run.abandoned } : {}),
      gate10s: (timings.objectivesAll ?? 0) <= 10_000,
    });
    writeJson(`${o.outDir}/objectives.json`, {
      objectives,
      ran: run.ran,
      model: run.model,
      ...(run.abandoned ? { abandoned: run.abandoned } : {}),
      usage: run.result.usage,
      usd: run.result.usd,
      ms: run.result.ms,
      firstTokenMs: run.result.firstTokenMs,
    });
    // The teacher signs off: auto-approved at once in the bake-off.
    signOffMs = ms();
    timings.signOff = signOffMs;
    log({ ev: "sign-off", auto: true, objectives: objectives.length });
    // (2) At sign-off, the pupil wording runs beside the design call and fills slide 2 directly.
    const pupilSys = `${shared0}/pupil-objectives.txt`;
    if (existsSync(pupilSys)) {
      const schemaFile = `${shared0}/pupil-objectives-schema.json`;
      const userFile = `${shared0}/pupil-objectives-user.txt`;
      const teacherLines = objectives.map((x, k) => `${k + 1}. ${x.teacher}`).join("\n");
      const held = ledger.tryHold("pupil objectives", STEP_EST.objectives);
      const pupilUser = () =>
        existsSync(userFile)
          ? fillTemplate(readFileSync(userFile, "utf8"), brief, {
              objectives,
              maxWords: pupilWordLimit(brief.keyStage, objectives.length),
            })
          : `${brief.yearGroup} ${brief.subject}: ${brief.topic}\n\nTeacher objectives:\n${teacherLines}`;
      // Built inside the promise chain: a template fault falls back to teacher wording, never kills the run.
      pupilJob = (
        held
          ? Promise.resolve()
              .then(() =>
                pupilCall(
                  {
                    system: readFileSync(pupilSys, "utf8"),
                    user: pupilUser(),
                    schema: existsSync(schemaFile)
                      ? JSON.parse(readFileSync(schemaFile, "utf8"))
                      : pupilSchema(objectives.length),
                    name: "pupil_objectives",
                    maxTokens: 1500,
                  },
                  chatStream,
                  (line, k) => {
                    const x = objectives[k];
                    if (!x) return;
                    x.pupil = line;
                    if (k === 0) mark("slide2First");
                    laySlide2(`pupil objective ${k + 1}`);
                  },
                ),
              )
              .then((r) => {
                ledger.add("objectives", r.result.usd);
                log({
                  ev: "pupil-objectives",
                  n: r.pupil.length,
                  model: OBJECTIVES_CONFIG.pupil.model,
                  usd: r.result.usd,
                });
              })
          : Promise.reject(new Error("cap refused the pupil call"))
      )
        .catch((e) => log({ ev: "pupil-objectives-error", err: String(e).slice(0, 200) }))
        .finally(() => {
          held?.();
          // Any line still missing shows the teacher wording, so slide 2 is never short.
          for (const x of objectives) if (!x.pupil.trim()) x.pupil = x.teacher;
          laySlide2("objectives slide (pupil wording)");
          mark("slide2");
          mark("objectivesSlide");
        });
    } else {
      log({ ev: "pupil-objectives-skipped", why: "no shared/pupil-objectives.txt yet" });
      for (const x of objectives) x.pupil = x.teacher;
      laySlide2("objectives slide (teacher wording)");
      mark("slide2");
      mark("objectivesSlide");
    }
    // The design call's user turn: shared/user.txt with the approved teacher objectives.
    user = contextBlock(
      brief,
      objectives.map((x) => ({ teacher: x.teacher, pupil: "" })),
    );
  }
  const parser = new PartialJson(onValue);
  const p = arm.prompt(brief);
  writeJson(`${o.outDir}/request.json`, {
    model: p.model,
    effort: p.effort,
    user,
    systemChars: p.system.length,
    // A/B: which arm, and the system and schema (hashes; the texts are pinned files). systemSha is
    // the arm's template before localising (the legacy importer's key); sentSystemSha and
    // sentUserSha hash the localised text actually sent, for this locale (audit F7).
    ...(abArm()
      ? {
          abArm: abArm(),
          ...(abCodeArm() ? { codeArm: abCodeArm() } : {}),
          systemSha: sha(p.system),
          schemaSha: sha(JSON.stringify(p.schema)),
          ...sentShas(p.system, user),
        }
      : {}),
  });
  const heldMain = await mustHold(ledger, "main call", o.replay ? 0 : STEP_EST.main);
  const main = o.replay
    ? await replayStream(o.replay, (d) => parser.push(d))
    : await chatStream(
        {
          model: p.model,
          effort: p.effort,
          system: p.system,
          user,
          schema: p.schema,
          name: "lesson",
          maxTokens: 9000,
        },
        (d) => {
          appendFileSync(`${o.outDir}/stream.txt`, d);
          parser.push(d);
        },
      ).catch((e) => {
        // No usage on a failed stream: book an estimate (input + what arrived, 4 chars a token).
        const est = ((p.system.length + user.length) / 4) * 2e-6 + (parser.text.length / 4) * 10e-6;
        ledger.add("mainFailedEstimate", est);
        heldMain();
        log({
          ev: "main-error",
          err: String(e).slice(0, 300),
          chars: parser.text.length,
          estUsd: est,
        });
        writeJson(
          `${o.outDir}/cost.json`,
          ledger.costJson({ note: "main call failed; estimate only" }),
        );
        throw e;
      });
  ledger.add("main", main.usd);
  heldMain();
  writeJson(`${o.outDir}/main.json`, {
    text: main.text,
    usage: main.usage,
    usd: main.usd,
    ms: main.ms,
    firstTokenMs: main.firstTokenMs,
    finishReason: "finishReason" in main ? (main.finishReason ?? null) : null,
  });
  mark("streamDone");
  if (abExitTicket() && !plan.exitTicket) {
    if (o.exitFixture) placeExit(o.exitFixture, "fixture");
    else log({ ev: "exit-missing" });
  }
  // K3 (base3 onwards): an incomplete writer output fails the run; it never ships a headings deck.
  const incomplete = abFixes()
    ? writerIncomplete({
        finishReason: "finishReason" in main ? main.finishReason : undefined,
        text: main.text,
        // exit1: the writer plans one fewer; code adds the exit ticket.
        minSlides: brief.slides.min - (abExitTicket() ? 1 : 0),
      })
    : undefined;
  if (incomplete) {
    log({ ev: "main-incomplete", why: incomplete, chars: main.text.length });
    writeJson(`${o.outDir}/cost.json`, ledger.costJson({ note: "writer output incomplete" }));
    throw new Error(`writer output incomplete: ${incomplete}`);
  }
  if (o.writerOnly) {
    writeJson(`${o.outDir}/cost.json`, ledger.costJson());
    log({
      ev: "summary",
      writerOnly: true,
      slides: plan.slides.length,
      usd: main.usd,
      ms: main.ms,
    });
    return { lessonFile, timings, cost: ledger.costJson(), checks: [] };
  }
  const n = plan.slides.length;
  // Early jobs for slides that turned out to have no picture still land (cost is spent) but are not placed.
  for (const [i, e] of early)
    if (!asks.get(i)?.some((a) => a.type === "photo")) jobs.push(e.then(() => undefined));
  mark("editable");
  save("all slides");

  // ── c. notes: a second small call per slide, all in parallel (unless the main schema carries notes) ──
  const notesJobs: Promise<void>[] = [];
  const shared = abShared() ?? `${BAKEOFF}/prompts/shared`;
  // A/B: every arm's notes prompt is round 8's (coordinator: candidate 13 is base code), in its shared/.
  const notesDir = shared;
  const hasNotesPrompt =
    existsSync(`${notesDir}/notes.txt`) && existsSync(`${notesDir}/notes-schema.json`);
  // Round 4: a notes schema with a top-level `slides` array is one call per lesson, after repair.
  const lessonNotesCall =
    hasNotesPrompt &&
    "slides" in
      ((
        JSON.parse(readFileSync(`${notesDir}/notes-schema.json`, "utf8")) as { properties?: object }
      ).properties ?? {});
  for (let i = 0; i < n; i++) {
    const s = plan.slides[i];
    if (!s) continue;
    if (typeof s.notes === "string") {
      notes.set(i, { notes: s.notes, answers: (s.answers as string[]) ?? [] });
      continue;
    }
    if (o.noNotes || !hasNotesPrompt || lessonNotesCall) continue;
    const system = readFileSync(`${notesDir}/notes.txt`, "utf8");
    const schema = JSON.parse(readFileSync(`${notesDir}/notes-schema.json`, "utf8"));
    const u = `${user}\n\nLesson:\n${main.text}\n\nSlide: ${i + 1}`;
    notesJobs.push(
      (async () => {
        const held = await mustHold(ledger, `notes s${i + 1}`, STEP_EST.notes);
        const r = await chat({
          model: "gpt-6-luna",
          effort: "low",
          system,
          user: u,
          schema,
          name: "notes",
        });
        ledger.add("notes", r.usd);
        held();
        const out = r.out as { notes: string; answers: string[] } | undefined;
        if (out) notes.set(i, out);
        log({ ev: "notes", slide: i + 1, ms: r.ms, usd: r.usd });
      })().catch((e) => log({ ev: "notes-error", slide: i + 1, err: String(e).slice(0, 200) })),
    );
  }
  await pupilJob;
  await Promise.all(notesJobs);
  if (notesJobs.length) mark("notes");
  // Visual jobs may add more jobs as they land: wait until none are left.
  for (let k = 0; k < jobs.length; k = jobs.length) await Promise.all(jobs.slice(k));
  for (let i = 0; i < n; i++) relay(i, "final");
  mark("visualsDone");

  // ── c2. R1 stage 2 (b4-r1t2): a picture counts as shown only when the judge's `visible` covers every
  // must_see; items that need an unshown picture (or name a thing no picture on the slide shows) are dropped,
  // an emptied check slide is removed, and its objectives go to the objective repair below.
  if (abR1t2() && rawR1t.size) {
    const shownAt = (num: number, k: number) => {
      const i = num - 1;
      const raw = rawR1t.get(i);
      const pics = raw
        ? Array.isArray(raw.pictures)
          ? (raw.pictures as Record<string, unknown>[])
          : [raw.picture ?? raw.figure]
        : [];
      const pic = pics[k] as Record<string, unknown> | undefined;
      const v = visuals.get(
        `${i}:${k === 0 ? (raw && "figure" in raw && raw.figure ? "figure" : "picture") : `tile.${k}`}`,
      );
      if (v?.status === "diagram") return true;
      if (v?.status !== "photo" || !pic) return false;
      // Round 6 metric fix: a judged generated/library pick counts its request; tiles count too.
      const seen = seenOf(v.photo);
      return covers((pic.must_see as string[]) ?? [], seen);
    };
    const title0 = rawR1t.get(0) ?? (plan.slides[0] as Record<string, unknown>);
    const writer = Array.from(
      { length: Math.max(0, plan.slides.length - 2) },
      (_, k) => rawR1t.get(k + 2) ?? (plan.slides[k + 2] as Record<string, unknown>),
    );
    const r = applyStage2(
      { title: title0, slides: writer, flow: plan.flow as never },
      shownAt,
      plan.objectives?.length ?? 0,
    );
    for (const d of r.dropped) log({ ev: "stage2-drop", ...d });
    const changed: [number, Record<string, unknown>][] = [
      [0, r.title],
      ...r.slides.map((x, j) => [j + 2, x] as [number, Record<string, unknown>]),
    ];
    for (const [k, raw] of changed) {
      if (!r.dropped.some((d) => d.slide === k + 1)) continue;
      // A title whose lead needed an unshown picture keeps its heading alone.
      const lead = raw.lead as { text?: string } | null | undefined;
      plan.slides[k] = flattenR1t(k === 0 && lead && !lead.text ? { ...raw, lead: null } : raw);
      relay(k, "stage2");
    }
    for (const num of r.removed) {
      removedSlides.add(num - 1);
      for (const f of plan.flow ?? []) if (f.slide === num) f.teaches = [];
      log({ ev: "stage2-removed", slide: num });
    }
    if (r.unchecked.length) log({ ev: "stage2-unchecked", objectives: r.unchecked });
    save("stage 2");
  }

  // ── d. code checks ──
  const check = () => {
    const out = baseCheck();
    // Round 6: a slide that repeats another goes to repair to be made different or merged.
    const dup = duplicateFaults(
      Array.from({ length: n }, (_, i) => i)
        .filter((i) => repairable(plan.slides[i] as Record<string, unknown>, i))
        .map((i) => {
          const sl = plan.slides[i] as Record<string, unknown>;
          return { index: i, heading: String(sl.heading ?? ""), words: arm.words(sl) };
        }),
    );
    for (const [i, f] of dup) out[i]?.faults.push(f);
    // gas8 (faults-3-6-8 #8): practical data the lesson's own stated quantities cannot give.
    if (abGas8())
      for (const h of gasFaults(gasTexts()))
        if (repairable(plan.slides[h.slide] as Record<string, unknown>, h.slide))
          out[h.slide]?.faults.push(h.fault);
    return out;
  };
  const gasTexts = () =>
    Array.from({ length: n }, (_, i) =>
      plan.slides[i] ? arm.words(plan.slides[i] as Record<string, unknown>) : "",
    );
  const baseCheck = () =>
    Array.from({ length: n }, (_, i) =>
      checkSlide({
        specs: (asks.get(i) ?? []).flatMap((a) => {
          const v = visuals.get(`${i}:${a.key}`) as { status?: string; spec?: unknown } | undefined;
          return a.type === "diagram" && v?.status === "diagram" && v.spec ? [v.spec] : [];
        }),
        index: i,
        slide: laid.get(i)?.slide,
        over: laid.get(i)?.over ?? [],
        ...(laid.get(i)?.diagram ? { diagram: laid.get(i)?.diagram } : {}),
        questions: plan.slides[i] ? arm.questions(plan.slides[i] as Record<string, unknown>) : [],
        answers: notes.get(i)?.answers,
        notesChecked: notes.has(i),
        words: plan.slides[i] ? arm.words(plan.slides[i] as Record<string, unknown>) : "",
      }),
    );
  let checks = check();
  const count = {
    slides: n,
    min: brief.slides.min,
    max: brief.slides.max,
    inRange: n >= brief.slides.min && n <= brief.slides.max,
  };
  log({
    ev: "checks",
    failing: checks
      .filter((c) => c.faults.length)
      .map((c) => `s${c.slide}: ${c.faults.join("; ")}`),
    count,
  });

  // ── e. one bounded repair: failing slides only, one call each, one round ──
  const repairSys = `${shared}/repair.txt`;
  /** Round 9 (review B1): the stand-alone and reroute prompt (prompt-engineer's). */
  const restageSys = `${shared}/restage.txt`;
  // The arm's per-stage repair schema and layouts menu (prompts/<arm>/repair-schema.<stage>.json, layouts.<stage>.txt).
  const stageKey =
    arm.promptStage?.(brief) ??
    (brief.keyStage === "ks1" ? "KS1" : brief.keyStage === "ks2" ? "KS2" : "KS3-5");
  const armDir = `${BAKEOFF}/prompts/${arm.id}`;
  // A/B: the arm's own repair schema (its slide shapes), generated with its writer schema.
  const repairSchema = abArm()
    ? abFiles(abArm() as AbArm, stageKey).repairSchema
    : existsSync(`${armDir}/repair-schema.${stageKey}.json`)
      ? `${armDir}/repair-schema.${stageKey}.json`
      : `${armDir}/repair-schema.json`;
  const repairUser = `${shared}/repair-user.txt`;
  // Round 2 guards (repair.ts): never the title or objectives slide; a repaired slide that drops a
  // figure, leaves a slot empty, splits a sentence across cards or loses words is rejected and the
  // original kept with its flag; a new figure the repaired slide asks for is fetched like any other.
  // Round 7 (prompts "round 7 draft"): visual requests carry ask / ask_without, and the arm shows
  // the right one by construction, so a visual-dangling fault only reports.
  const hasAsks = (x: unknown): boolean =>
    !!x &&
    typeof x === "object" &&
    ("ask_without" in x ||
      Object.values(x as object).some((v) => (Array.isArray(v) ? v.some(hasAsks) : hasAsks(v))));
  const asksPrompt = plan.slides.some(hasAsks);
  // Round 8: dangling and unanswerable are reported metrics (checks.json summary.dangling), never
  // hidden and never a repair trigger: the ask / ask_without pair is the fix by construction.
  const VISUAL_DANGLING = /^(dangling|unanswerable):/;
  void asksPrompt;
  const pickFailing = () =>
    checks
      .map((c) => ({ ...c, faults: c.faults.filter((f) => !VISUAL_DANGLING.test(f)) }))
      .filter((c) => {
        const i = c.slide - 1;
        const ok = c.faults.length > 0 && repairable(plan.slides[i] as Record<string, unknown>, i);
        if (c.faults.length && !ok)
          log({ ev: "repair-not-allowed", slide: c.slide, faults: c.faults });
        return ok;
      });
  let failing = pickFailing();
  const recorded = new Map<number, unknown>();
  if (o.replayRepair && existsSync(o.replayRepair))
    for (const l of readFileSync(o.replayRepair, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as { slide: number; out?: unknown };
      if (r.out) recorded.set(r.slide, r.out);
    }
  /** Wait for every visual job, including any a landed job started. */
  const settle = async () => {
    for (let k = 0; k < jobs.length; k = jobs.length) await Promise.all(jobs.slice(k));
  };
  /** Swap slide i to `next`, carry visuals its figures keep, fetch the new ones, re-lay it. */
  const swapSlide = async (i: number, next0: Record<string, unknown>) => {
    // chalkie-gap Y5-B: a figure on a rewritten slide is re-checked against the new words; it is
    // kept when it agrees, redrawn from the words when it can be, and dropped otherwise.
    // A/B switch figureSync (off by default): every other arm swaps exactly as before.
    const before0 = plan.slides[i] as Record<string, unknown> | undefined;
    const sync = abFigureSync()
      ? syncFigure(before0, slideNoEmDash(next0))
      : { action: "keep" as const, slide: slideNoEmDash(next0), why: "" };
    if (sync.action === "redrawn" || sync.action === "drop")
      log({ ev: "figure-sync", slide: i + 1, action: sync.action, why: sync.why });
    const next =
      sync.action === "drop"
        ? (withKeyStage(brief.keyStage, () => arm.asWords?.(sync.slide)) ??
          (({ figure: _f, diagram: _d, ...rest }) => rest)(sync.slide))
        : sync.slide;
    const oldAsks = asks.get(i) ?? [];
    const newAsks = withKeyStage(brief.keyStage, () => arm.visuals(next, i, { ...base, plan }));
    const state = new Map(oldAsks.map((a) => [a.key, visuals.get(`${i}:${a.key}`)]));
    plan.slides[i] = next;
    asks.set(i, newAsks);
    const words = arm.words(next);
    const heading = String(next.heading ?? "");
    for (const a of newAsks) {
      const k = `${i}:${a.key}`;
      const was = oldAsks.find(
        (b) =>
          sameFigure({ type: b.type, shows: b.shows }, { type: a.type, shows: a.shows }) &&
          // the same request is not the same drawing: a spec that changed is drawn again
          (!abFigureSync() ||
            b.type !== "diagram" ||
            a.type !== "diagram" ||
            specKey((b as { spec?: unknown }).spec) === specKey(a.spec)),
      );
      const v0 = was ? state.get(was.key) : undefined;
      // a drawing whose numbers the new words no longer say is never carried (y5 s7: a bar of 20
      // beside "⅗ of 30 = 18"); the figure is fetched again from the repaired slide
      const stale =
        abFigureSync() && v0?.status === "diagram" ? figureTextMismatch(v0.spec, next) : undefined;
      if (stale) log({ ev: "figure-stale", slide: i + 1, key: a.key, why: stale });
      const v = stale ? undefined : v0;
      if (v && v.status !== "pending") {
        visuals.set(k, v);
        continue;
      }
      // A figure the repaired slide newly asks for: fetched the same way, never left as a slot.
      if (a.type === "photo") {
        const p = startPhoto(i, a, { heading, text: words });
        if (p) landPhoto(i, a.key, p);
        else visuals.set(k, { status: "failed" });
      } else if (!o.noVisuals) startDiagram(i, a, `${heading}\n${words}`, heading);
      else visuals.set(k, { status: "failed" });
    }
    await settle();
    relay(i, "repair");
    return { oldAsks, state };
  };
  const restore = (
    i: number,
    slide: Record<string, unknown> | undefined,
    n0: { notes: string; answers: string[] } | undefined,
    saved: { oldAsks: VisualAsk[]; state: Map<string, VisualState | undefined> },
  ) => {
    plan.slides[i] = slide;
    if (n0) notes.set(i, n0);
    else notes.delete(i);
    asks.set(i, saved.oldAsks);
    for (const [k, v] of saved.state) if (v) visuals.set(`${i}:${k}`, v);
    relay(i, "repair-reverted");
  };
  // ── e0. round 4 objective coverage: one targeted repair when an objective has no teaching or
  // checking slide (y11 round 3 dropped catalysts), before the fit repair so new slides get checks.
  const objRepairSys = `${shared}/objective-repair.txt`;
  if (
    plan.flow?.some((f) => Array.isArray(f.teaches)) &&
    existsSync(objRepairSys) &&
    existsSync(repairSchema) &&
    (plan.objectives?.length ?? 0) > 0
  ) {
    const flow = plan.flow;
    const slides = plan.slides as Record<string, unknown>[];
    const held = await ledger.holdWhenFree("objective repair", STEP_EST.objectiveRepair);
    if (held) {
      const out = await repairObjectives({
        plan: { flow, slides },
        objectives: (plan.objectives ?? []).map((x) => x.teacher),
        context: user,
        system: readFileSync(objRepairSys, "utf8"),
        schema: objectiveRepairSchema(JSON.parse(readFileSync(repairSchema, "utf8"))),
        chat,
        log,
        onUsd: (v) => ledger.add("repair", v),
        retry: abObjRetry(),
        checks: abCheckDef() ? CHECKDEF_TEMPLATES : undefined,
      }).finally(held);
      if (out.repaired) {
        plan.flow = out.plan.flow as Plan["flow"];
        for (let i = 2; i < n; i++)
          if (out.plan.slides[i] !== slides[i])
            await swapSlide(i, out.plan.slides[i] as Record<string, unknown>);
        checks = check();
        failing = pickFailing();
        save("objective repair");
      }
    } else log({ ev: "objective-repair-refused" });
  }
  /** The "Diagram kinds:" block of shared/base-visuals.<stage>.txt (the repair's menu of kinds). */
  const diagramKinds = () => {
    for (const f of [`${shared}/base-visuals.${stageKey}.txt`, `${shared}/base-visuals.txt`])
      if (existsSync(f)) {
        const m = readFileSync(f, "utf8").match(/Diagram kinds:[\s\S]*?(?=\n\s*\n|$)/);
        if (m) return m[0].trim();
      }
    return "";
  };
  const kinds = (f: string[]) => new Set(f.map((x) => x.split(":")[0]));
  const path = new Map<number, string>();
  const repairOne = async (
    c: CheckResult,
    mode: "fit" | "stand-alone" | "reroute" = "fit",
    ro: {
      /** A reason to reject the call's slide (the reroute's same-picture guard). */
      guard?: (after: Record<string, unknown>) => string | undefined;
      /** Words the restaged slide may lose (the figure's own and its pointing words). */
      exempt?: ReadonlySet<string>;
      /** Fit: keep a reword that cut the overflow without clearing it (the measure-and-retry loop). */
      keepPartial?: boolean;
    } = {},
  ): Promise<boolean> => {
    // Round 9 (review B1): restaging (stand-alone, reroute) has its own prompt, never repair.txt.
    const sysFile = mode === "fit" ? repairSys : restageSys;
    if (!existsSync(sysFile) || !existsSync(repairSchema)) return false;
    const system = readFileSync(sysFile, "utf8");
    const i = c.slide - 1;
    const ask = asks.get(i) ?? [];
    const found = ask
      .map((a) => visuals.get(`${i}:${a.key}`))
      .flatMap((v) =>
        v?.status === "photo"
          ? [`The picture placed shows: ${v.photo.about ?? v.photo.alt}`]
          : v?.status === "failed"
            ? ["No picture could be found for this slide."]
            : [],
      );
    const placed = ask.flatMap((a) => {
      const v = visuals.get(`${i}:${a.key}`);
      return v?.status === "photo" ? [`${a.key}: ${v.photo.about ?? v.photo.alt}`] : [];
    });
    const tpl = existsSync(repairUser) ? readFileSync(repairUser, "utf8") : "";
    // Round 8 (dataflow audit C): the repair sees its slide's layout, the layouts it may switch to
    // and, only when the slide has a diagram, the diagram kinds; faults in its own terms.
    const own = String((plan.slides[i] as Record<string, unknown>)?.template ?? "");
    const menu = existsSync(`${armDir}/layouts.${stageKey}.txt`)
      ? layoutsFor(readFileSync(`${armDir}/layouts.${stageKey}.txt`, "utf8"), own)
      : "";
    // Round 9: a reroute (a picture that cannot be shown) may ask for a diagram of a supported kind.
    const hasDiagram = mode === "reroute" || ask.some((a) => a.type === "diagram");
    const faultLines = c.faults.map((f) => repairTerms(f, plan.slides[i], stageKey));
    // Round 9 (review B2): a restaging call is told its room in characters.
    if (mode !== "fit") {
      const room = roomLine(plan.slides[i], stageKey);
      if (room) faultLines.push(room);
    }
    const u = tpl
      ? fillTemplate(tpl, brief, {
          context: user,
          N: i + 1,
          [String(tpl.match(/\{\{(the diagram kinds[^}]*)\}\}/)?.[1] ?? "-")]: hasDiagram
            ? diagramKinds()
            : "",
          "the arm's layouts menu for this key stage: <arm>/layouts.<stage>.txt": menu,
          "the slide's JSON exactly as the main call wrote it": JSON.stringify(plan.slides[i]),
          [String(tpl.match(/\{\{(one line per placed picture[^}]*)\}\}/)?.[1] ?? "-")]:
            placed.length ? placed.join("\n") : "none",
          [String(tpl.match(/\{\{(one line per fault[^}]*)\}\}/)?.[1] ?? "-")]: [
            ...faultLines,
            ...found,
          ]
            .sort()
            .join("\n"),
        })
      : `${user}\n\nSlide ${i + 1}:\n${JSON.stringify(plan.slides[i])}\n\nWhat the check found:\n${[...c.faults, ...found].map((f) => `- ${f}`).join("\n")}`;
    let out: unknown;
    let usd = 0;
    if (o.replayRepair || (mode !== "fit" && o.replay)) {
      out = mode === "fit" ? recorded.get(i + 1) : undefined;
      if (!out) return false;
    } else {
      const r = await guarded(
        ledger,
        `repair s${i + 1}`,
        STEP_EST.repair,
        () =>
          chat({
            model: "gpt-6-luna",
            effort: "low",
            system,
            user: u,
            schema: JSON.parse(readFileSync(repairSchema, "utf8")),
            name: "slide",
          }),
        log,
      );
      if (r) ledger.add("repair", r.usd);
      out = r?.out;
      usd = r?.usd ?? 0;
    }
    appendFileSync(
      `${o.outDir}/repair.jsonl`,
      `${JSON.stringify({ slide: i + 1, mode, faults: c.faults, input: plan.slides[i], out })}\n`,
    );
    const o2 = out as { slide?: Record<string, unknown>; to_notes?: unknown; fix?: string };
    if (!o2?.slide || typeof o2.slide !== "object") {
      log({ ev: "repair", slide: i + 1, usd, ok: false });
      return false;
    }
    const before = plan.slides[i] as Record<string, unknown>;
    o2.slide = keepAsksHonest(before, o2.slide);
    // R1 stage 2 (b4-r1t2): restage changes the layout and the figure, never the words.
    if (abR1t2() && mode !== "fit") o2.slide = restageLayoutOnly(before, o2.slide);
    const moved = (Array.isArray(o2.to_notes) ? o2.to_notes : [o2.to_notes ?? ""]).map(String);
    const verdict = judgeRepair(before, o2.slide, moved, {
      diagramFault: c.faults.some((f) => f.startsWith("diagram:")),
      // A/B: every arm repairs with round 5's repair.txt, which may move one whole unit to the
      // notes or split; it is judged by round 5's rule (word loss), not round 8's fit-only rule.
      fit:
        !abArm() &&
        mode === "fit" &&
        c.faults.some((f) => /^(overflow|clipped|cut|overlap):/.test(f)),
      // Round 9 (review S2): a restaged slide may lose its figure and the words that pointed at
      // it, never a question, an item or the slide's other words.
      ...(mode !== "fit" ? { restage: true, exempt: ro.exempt ?? POINTING_WORDS } : {}),
    });
    const guarded0 = ro.guard?.(o2.slide);
    const why = [...(verdict.ok ? [] : verdict.why), ...(guarded0 ? [guarded0] : [])];
    if (why.length) {
      log({
        ev: "repair-rejected",
        slide: i + 1,
        mode,
        fix: o2.fix,
        why,
        faults: c.faults,
      });
      return false;
    }
    // orphan6 (faults-3-6-8 #6a): a fit repair that moved the only words naming a pictured thing
    // drops the picture, so a kept picture never shows an item the slide no longer asks about.
    if (abOrphan6() && mode === "fit") {
      const orphans = orphansAfterFit(o2.slide, moved);
      if (orphans.length) {
        o2.slide = { ...o2.slide, picture: null };
        visuals.set(`${i}:picture`, { status: "failed" });
        log({ ev: "orphan6-drop", slide: i + 1, orphans, moved });
      }
    }
    const n0 = notes.get(i);
    const saved = await swapSlide(i, o2.slide);
    applyRepair(plan.slides, notes, i, out);
    // The same fault kind still there, or a new one: keep the original slide (and its flag).
    // A slide the notes call never reached has no answers to check (offline replays, a failed
    // notes call): to_notes alone must not raise an "unanswered" fault and revert the repair.
    const now = (check()[i]?.faults ?? []).filter((f) => n0 || !f.startsWith("unanswered"));
    const was = kinds(c.faults);
    const fresh = [...kinds(now)].filter((k) => !was.has(k));
    const worse =
      mode !== "fit"
        ? now.some((f) => /^(dangling|unanswerable):/.test(f))
        : ro.keepPartial
          ? // Round 9 (review S6): a first reword that cut the overflow is kept for the second.
            fresh.length > 0 || overflowPt(now) >= overflowPt(c.faults)
          : [...kinds(now)].some((k) => was.has(k)) || now.length > c.faults.length;
    if (worse) restore(i, before, n0, saved);
    else if (c.faults.some((f) => f.startsWith("diagram:"))) path.set(i, "diagram-repaired");
    log({ ev: "repair", slide: i + 1, mode, usd, ok: true, fix: o2.fix, reverted: worse, now });
    return !worse;
  };
  /**
   * Round 9 (review S6, coordinator 8): measure and retry. An overflowing slide gets at most two
   * rewords; a first that cut the overflow is kept, re-measured, and the second is told exactly
   * which fields are still over and by how many characters. Other faults get the one repair.
   */
  const fitLoop = async (c: CheckResult): Promise<boolean> => {
    if (!c.faults.some((f) => OVERFLOW.test(f))) return repairOne(c);
    const first = await repairOne(c, "fit", { keepPartial: true });
    const i = c.slide - 1;
    const left = (check()[i]?.faults ?? []).filter((f) => OVERFLOW.test(f));
    if (!left.length) return first;
    const again = await repairOne(
      {
        slide: c.slide,
        faults: [...left, "still over after one reword: cut the characters given above"],
      },
      "fit",
    );
    log({ ev: "fit-retry", slide: c.slide, first, again, left });
    return again;
  };
  if (!o.noRepair && failing.length) {
    if (!existsSync(repairSys) || !existsSync(repairSchema))
      log({ ev: "repair-skipped", why: "no repair prompt yet", failing: failing.length });
    else {
      await Promise.all(failing.map((c) => fitLoop(c)));
      mark("repaired");
    }
  }
  // gas8 runs before figure-sync (base7), so figure-sync checks each figure against the rescaled
  // words and a rescale can never leave a figure printing the old volumes.
  // gas8: a slide the one repair left impossible (or never repaired) gets the text-safe version,
  // every claimed gas volume scaled under the stated reactant's maximum.
  // One factor for the whole lesson, so volumes compared across slides keep their order.
  const gasHits = abGas8() ? gasFaults(gasTexts()) : [];
  const gasAll = gasHits.flatMap((x) => x.volumes);
  if (abGas8())
    for (const h of gasHits) {
      if (!repairable(plan.slides[h.slide] as Record<string, unknown>, h.slide)) continue;
      await swapSlide(
        h.slide,
        rescaleGas(plan.slides[h.slide] as Record<string, unknown>, gasAll, h.vmax),
      );
      const left = gasFaults(gasTexts()).some((x) => x.slide === h.slide);
      log({ ev: "gas8-fallback", slide: h.slide + 1, fault: h.fault, cleared: !left });
    }
  // chalkie-gap Y5-B: after repair, every drawn figure is checked against its slide's words; one
  // that disagrees is dropped (failed), so the fallback below restages the slide without it.
  if (abFigureSync()) await settle();
  for (const [k, v] of abFigureSync() ? visuals : []) {
    if (v.status !== "diagram") continue;
    const i = Number(k.split(":")[0]);
    const why = figureTextMismatch(v.spec, plan.slides[i] as Record<string, unknown> | undefined);
    if (!why) continue;
    log({ ev: "figure-text-mismatch", slide: i + 1, key: k, why, dropped: true });
    visuals.set(k, { status: "failed" });
    relay(i, "figure-text-mismatch");
  }
  // A diagram that still cannot draw: a picture of the same thing when it is a real, concrete
  // thing (the picture director, the diagram's `shows` as the request); else words only.
  // Round 3 profile (R2 y11: checks at 51 s, done at 100 s): the slides' fallbacks ran one after
  // another; they run side by side now.
  /**
   * Round 9 (review B2, S1; coordinator 2-3): restage a slide whose figure cannot be shown. One
   * call (restage.txt) with the slide's room; a result that overflows gets the fit loop; the final
   * measured check decides. A failed, rejected or still-overflowing call falls to the fixed
   * fallback in code, and if that overflows, to the slide with its figure and pointing sentences
   * removed. Every outcome is logged.
   */
  const restage = async (
    i: number,
    lost: { type: string; kind?: string; shows: string; labels?: string[]; key?: string },
    mode: "stand-alone" | "reroute",
    why?: string,
    guard?: (after: Record<string, unknown>) => string | undefined,
  ): Promise<string> => {
    const orig = plan.slides[i] as Record<string, unknown>;
    const exempt = new Set([
      ...POINTING_WORDS,
      ...wordsOf(lost.shows),
      ...(lost.labels ?? []).flatMap((l) => wordsOf(l)),
    ]);
    const over = () => (check()[i]?.faults ?? []).filter((f) => OVERFLOW.test(f));
    if (!o.noRepair) {
      const ok = await repairOne({ slide: i + 1, faults: [lostFault(lost, why)] }, mode, {
        guard,
        exempt,
      });
      if (ok) {
        const left = over();
        if (left.length) await fitLoop({ slide: i + 1, faults: left } as CheckResult);
        if (!over().length) return mode === "reroute" ? "rerouted" : "rewrite";
        log({ ev: "restage-overflow", slide: i + 1, mode, left: over() });
      }
    }
    // The fixed fallback, from the slide as it was before the call.
    const v = lost.key ? visuals.get(`${i}:${lost.key}`) : undefined;
    const spec = (v?.status === "diagram" ? v.spec : undefined) as
      | Record<string, unknown>
      | undefined;
    const fromSpec = (spec?.nodes ?? spec?.steps ?? spec?.events) as unknown[] | undefined;
    const parts = (fromSpec ?? lost.labels ?? [])
      .map((p) =>
        typeof p === "string"
          ? p
          : [
              str((p as Record<string, unknown>).date),
              str((p as Record<string, unknown>).text ?? (p as Record<string, unknown>).label),
            ]
              .filter(Boolean)
              .join(": "),
      )
      .filter((p) => p.trim());
    const maxSteps = Math.max(
      0,
      ...(fitTable()[stageKey]?.layouts.steps?.variants ?? [])
        .filter((x) => x.chars > 0 && !x.figure)
        .map((x) => x.counts.points ?? 0),
    );
    const n0 = notes.get(i);
    const fb = fixedFallback(orig, lost, parts, maxSteps);
    let saved = await swapSlide(i, fb.slide);
    if (!over().length) {
      log({ ev: "restage-fallback", slide: i + 1, mode, how: fb.how });
      return fb.how;
    }
    restore(i, orig, n0, saved);
    const strip = fixedFallback(orig, { type: "photo" }, [], 0);
    saved = await swapSlide(i, strip.slide);
    void saved;
    // Coordinator (7 Oct; r8 y5 s10): the last resort never ships overflow. The strip is laid on the
    // fit ladder already (spacing, then the stage's small type: the theme's minimum size); what
    // still does not fit moves to continuation slides of the same layout, items in order.
    if (over().length) {
      const fits = (sl: Record<string, unknown>) => {
        const m = withKeyStage(brief.keyStage, () =>
          arm.materialise(sl, {
            ...base,
            index: i,
            plan,
            visual: () => ({ status: "failed" }) as VisualState,
          }),
        );
        const f = checkSlide({
          specs: [],
          index: i,
          slide: m.slide,
          over: m.over ?? [],
          questions: [],
          answers: undefined,
          notesChecked: true,
          words: "",
        });
        return { ok: !f.faults.some((x) => OVERFLOW.test(x)), m };
      };
      const cont = continueForFit(plan.slides[i] as Record<string, unknown>, (sl) => fits(sl).ok);
      if (cont) {
        saved = await swapSlide(i, cont.first);
        continued.set(
          i,
          cont.rest.map((sl) => fits(sl).m),
        );
        save(`continued s${i + 1}`);
        log({
          ev: "restage-fallback",
          slide: i + 1,
          mode,
          how: "strip-continued",
          extra: cont.rest.length,
          overflow: over(),
        });
        return "strip-continued";
      }
    }
    log({ ev: "restage-fallback", slide: i + 1, mode, how: "strip", overflow: over() });
    return "strip";
  };
  const fallback = async (i: number, fo: { noPicture?: boolean } = {}) => {
    const dAsk = (asks.get(i) ?? []).find((a) => a.type === "diagram") as
      | Extract<VisualAsk, { type: "diagram" }>
      | undefined;
    if (!dAsk || path.has(i)) return;
    if (!laid.get(i)?.diagram?.length && visuals.get(`${i}:${dAsk.key}`)?.status === "diagram") {
      path.set(i, "diagram");
      return;
    }
    const s = plan.slides[i] as Record<string, unknown>;
    // Round 5 (visual or fallback): a diagram whose spec never came back (an API error, y7 r4) is
    // asked once more before anything else.
    const k = `${i}:${dAsk.key}`;
    if (visuals.get(k)?.status === "failed" && !o.noVisuals && !o.replay) {
      const sl = plan.slides[i] as Record<string, unknown>;
      startDiagram(
        i,
        dAsk,
        `${String(sl.heading ?? "")}\n${arm.words(sl)}`,
        String(sl.heading ?? ""),
      );
      await settle();
      relay(i, "diagram retry");
      if (!laid.get(i)?.diagram?.length && visuals.get(k)?.status === "diagram") {
        path.set(i, "diagram-retry");
        return;
      }
    }
    // Then a picture of the same thing: any kind that shows a thing or process (particles, flow,
    // cycle, layers...), not only concrete ones; data kinds (graphs, tables) cannot be pictures.
    const pic =
      !fo.noPicture && pictureFallbackOk(dAsk.kind, dAsk.shows) ? arm.asPicture?.(s) : undefined;
    if (pic) {
      const n0 = notes.get(i);
      const saved = await swapSlide(i, pic);
      const got = (asks.get(i) ?? []).some((a) => visuals.get(`${i}:${a.key}`)?.status === "photo");
      if (got) {
        path.set(i, "picture");
        return;
      }
      restore(i, s, n0, saved);
    }
    // Round 4 (y11 s6 "Read the results" lost its data table and asked for a trend from nothing):
    // a table is words already, so one that cannot draw keeps its data as text lines.
    const t = tableRows(visuals.get(`${i}:${dAsk.key}`), dAsk);
    const asText = dAsk.kind === "table" && t.rows.length ? arm.asTableText?.(s, t) : undefined;
    if (asText) {
      await swapSlide(i, asText);
      path.set(i, "table-text");
      return;
    }
    // Words only as the last resort. Round 6: the pointing words stay for now, so the stand-alone
    // stage below rewrites them (a call) before it strips them.
    const words = arm.asWords?.(s, { keepPointing: true });
    if (words && JSON.stringify(words) !== JSON.stringify(s)) await swapSlide(i, words);
    // Round 9 (regression audit cause 4): the slide is rewritten to stand alone in one small call
    // (gpt-6-luna, low): no line may point at the missing figure, and tabular content becomes a
    // readable layout. The figure is named in the fault so its content can be carried in words.
    path.set(i, `words-${await restage(i, dAsk, "stand-alone")}`);
  };
  // Round 9 (regression audit cause 5): a picture the director vetoed or no source found is
  // rerouted in one small call: a diagram of a supported kind when one shows it, else the slide
  // rewritten to stand alone. Only the slide's own figure (not a compare card or sequence panel).
  const pictureLost = async (i: number) => {
    if (path.has(i) || i < 2) return;
    const lost = (asks.get(i) ?? []).find(
      (a): a is Extract<VisualAsk, { type: "photo" }> =>
        a.type === "photo" &&
        !a.set &&
        !a.fixedShape &&
        visuals.get(`${i}:${a.key}`)?.status === "failed",
    );
    if (!lost) return;
    const why = vetoed.get(`${i}:${lost.key}`);
    // Round 9 (review B1): a reroute that asks for the vetoed picture again is rejected and the
    // slide goes to the stand-alone rewrite.
    const same = (after: Record<string, unknown>) => {
      const again = (arm.visuals(after, i, { ...base, plan }) as VisualAsk[]).some(
        (a) =>
          a.type === "photo" &&
          (sameFigure({ type: "photo", shows: a.shows }, { type: "photo", shows: lost.shows }) ||
            plainWords(a.shows) === plainWords(lost.shows)),
      );
      return again ? "re-asks the picture that could not be shown" : undefined;
    };
    let how = await restage(
      i,
      { type: "photo", shows: lost.shows, key: lost.key },
      "reroute",
      why,
      same,
    );
    // Round 9 (coordinator 5): a diagram the reroute asked for goes through the drawer, its one
    // retry and the fit checks like any other (never back to a picture).
    if (how === "rerouted" && (asks.get(i) ?? []).some((a) => a.type === "diagram")) {
      await fallback(i, { noPicture: true });
      how = `to-${path.get(i) ?? "diagram"}`;
    }
    path.set(i, `picture-${how}`);
  };
  await Promise.all(Array.from({ length: n }, (_, i) => fallback(i)));
  await Promise.all(Array.from({ length: n }, (_, i) => pictureLost(i)));
  for (const [i, p] of path) log({ ev: "visual-path", slide: i + 1, path: p });
  // ── e2. round 6: visual or rewrite. Words that point at a visual the slide does not show (r5 y2
  // s3/s5, y4 s4, y12 s7) are rewritten to stand alone; failing that, the pointing sentences go.
  // Never a silent text-only slide: every one is logged with how it ended.
  // Round 7: the swap is by construction (ask / ask_without in the arm); the referent regex only
  // reports. The rewrite-or-strip below runs only for a slide with no ask fields (older prompts).
  const DANGLING = /^(dangling|unanswerable):/;
  const standAlone = async (i: number) => {
    const s0 = plan.slides[i] as Record<string, unknown> | undefined;
    if (!s0 || !repairable(s0, i)) return;
    const hit = check()[i]?.faults.find((f) => DANGLING.test(f));
    if (!hit) return;
    if (asksPrompt) {
      log({ ev: "stand-alone", slide: i + 1, fault: hit, how: "report" });
      return;
    }
    let how = "left";
    const fault = `${hit}; no visual can be made for it, so the words must stand alone`;
    if (!o.noRepair && (await repairOne({ slide: i + 1, faults: [fault] }, "stand-alone")))
      how = "rewrite";
    else {
      const s = plan.slides[i] as Record<string, unknown>;
      const words = arm.asWords?.(s);
      // A strip that leaves a fragment ("Tell your partner why.") is no slide: it stays flagged.
      const count = (x: Record<string, unknown>) =>
        (arm.words(x).match(/\S+/g) ?? []).length - String(x.heading ?? "").split(/\s+/).length;
      const kept = words ? count(words) / Math.max(1, count(s)) : 0;
      if (words && JSON.stringify(words) !== JSON.stringify(s) && kept >= 0.6) {
        const n0 = notes.get(i);
        const saved = await swapSlide(i, words);
        if (check()[i]?.faults.some((f) => DANGLING.test(f))) restore(i, s, n0, saved);
        else how = "strip";
      }
    }
    log({ ev: "stand-alone", slide: i + 1, fault: hit, how });
  };
  await Promise.all(Array.from({ length: n }, (_, i) => standAlone(i)));
  // ── f. round 4 notes: one call on the final slides as rendered, only placed visuals listed ──
  if (lessonNotesCall && !o.noNotes) {
    const placed = (i: number) =>
      (asks.get(i) ?? []).flatMap((a) => {
        const v = visuals.get(`${i}:${a.key}`);
        // Round 5 (notes audit: marble chips described as magnesium): what the placed picture is,
        // its own alt and the subjects the judge saw in it, not what was asked for.
        if (v?.status === "photo") {
          const photo =
            abCaptions() && v.photo?.alt
              ? {
                  ...v.photo,
                  alt: localAlt(v.photo.alt, {
                    country: locale().country,
                    context: `${slideWords(laid.get(i)?.slide)} ${a.shows} ${brief.topic}`,
                  }),
                }
              : v.photo;
          return [`Picture: ${placedPictureText(photo, a.shows)}`];
        }
        if (v?.status === "diagram" && a.type === "diagram")
          return [notesDiagramLine(a.kind, a.labels, v.spec, abNotesAlt())];
        return [];
      });
    // Title and objectives slides get no notes (audit d): they are left out of the call.
    const lines = Array.from({ length: n }, (_, i) => i)
      .filter((i) => i >= 2)
      .map((i) => renderedLines(i + 1, (laid.get(i)?.slide.elements ?? []) as never, placed(i)))
      .join("\n\n");
    const userNotes = fillTemplate(readFileSync(`${notesDir}/notes-user.txt`, "utf8"), brief, {
      objectives: plan.objectives,
      context: user,
      slidesAsShown: lines,
    });
    const held = await ledger.holdWhenFree("lesson notes", STEP_EST.notes * n);
    if (held) {
      const got = await lessonNotes({
        slides: n,
        first: 3,
        system: readFileSync(`${notesDir}/notes.txt`, "utf8"),
        user: userNotes,
        schema: JSON.parse(readFileSync(`${notesDir}/notes-schema.json`, "utf8")),
        chat,
        log,
        onUsd: (v) => ledger.add("notes", v),
      }).finally(held);
      for (const [k, s0] of got) {
        if (k < 3 || k > n) continue;
        // Audit b: a multiple-choice answer starts with the correct letter as rendered.
        const a0 = Array.isArray(s0.answers) ? s0.answers : s0.answers;
        const lettered = Array.isArray(a0)
          ? a0.map((x, j) => (j === 0 ? (withCorrectLetter(x, plan.slides[k - 1]) ?? x) : x))
          : withCorrectLetter(a0, plan.slides[k - 1]);
        const s = { ...s0, answers: lettered };
        // Round 8: one answer per question (notes schema v2); an old notes file's single string
        // answers the whole slide.
        const answers = Array.isArray(s.answers)
          ? s.answers.map(String)
          : s.answers
            ? Array<string>(12).fill(String(s.answers))
            : [];
        notes.set(k - 1, { notes: notesText(s), answers });
      }
      writeJson(`${o.outDir}/notes.json`, { slides: [...got.values()] });
      mark("notes");
    } else log({ ev: "notes-refused" });
  }
  checks = check();
  // Round 7: every slide that shows an `ask_without` line, and why its visual is not there.
  const askWithout: { slide: number; key: string; why: string; line: string }[] = [];
  for (const [i, s0] of firstSlides) {
    const holders: [string, Record<string, unknown>][] = [];
    for (const k of ["picture", "diagram", "figure"]) {
      const f = s0[k];
      if (f && typeof f === "object") holders.push([k, f as Record<string, unknown>]);
    }
    (Array.isArray(s0.columns) ? (s0.columns as Record<string, unknown>[]) : []).forEach((c, n) => {
      if (c?.picture && typeof c.picture === "object")
        holders.push([`col.${n}`, c.picture as Record<string, unknown>]);
    });
    if (s0.template === "picture-sequence") holders.push(["seq.0", s0]);
    for (const [k, f] of holders) {
      const line = typeof f.ask_without === "string" ? f.ask_without.trim() : "";
      if (!line) continue;
      const keys = (asks.get(i) ?? []).map((a) => a.key);
      const key =
        keys.find((x) => x === k) ??
        (["picture", "diagram", "figure"].includes(k)
          ? keys.find((x) => ["picture", "diagram", "figure"].includes(x))
          : keys.find((x) => x.startsWith(k.split(".")[0] ?? k))) ??
        k;
      const st = visuals.get(`${i}:${key}`)?.status ?? "none";
      const dropped = laid.get(i)?.diagram;
      const p = path.get(i);
      const now = plan.slides[i] as Record<string, unknown>;
      const gone = !hasAsks(now);
      const why =
        st === "failed" || st === "none"
          ? `${st}${p ? `, then ${p}` : ""}`
          : dropped?.length
            ? `layout dropped: ${dropped.join("; ").slice(0, 160)}`
            : gone
              ? `fallback ${p ?? "swap"}`
              : st === "pending"
                ? "never landed"
                : p === "picture"
                  ? "diagram failed; a picture with the stand-alone line"
                  : "";
      if (why) askWithout.push({ slide: i + 1, key: k, why, line: line.slice(0, 160) });
    }
  }
  for (const a of askWithout) log({ ev: "ask-without", ...a });
  // Teaching slides left with no picture or diagram (round 2 summary).
  const textOnlyTeach = Array.from({ length: n }, (_, i) => i).filter(
    (i) =>
      i > 1 &&
      teaching(plan.slides[i] as Record<string, unknown>) &&
      !(laid.get(i)?.slide.elements ?? []).some((e) => e.type === "image"),
  );
  const dangling = checks.flatMap((c) =>
    c.faults
      .filter((f) => /^(dangling|unanswerable):/.test(f))
      .map((f) => ({ slide: c.slide, fault: f })),
  );
  const summary = {
    dangling,
    textOnlyTeach: textOnlyTeach.length,
    textOnlySlides: textOnlyTeach.map((i) => i + 1),
    visualPaths: Object.fromEntries([...path].map(([i, p]) => [i + 1, p])),
    askWithout,
    capRefused: ledger.refused,
  };
  log({ ev: "summary", ...summary });
  save("done");
  mark("done");
  const cost = { ...ledger.parts, picturesDirector: pics?.aiSpend() ?? 0 };
  const total = Object.values(cost).reduce((a, b) => a + b, 0);
  const keys = [
    "title",
    "objectiveFirst",
    "objectivesAll",
    "signOff",
    "design",
    "firstPlaceholder",
    "objectivesSlide",
    "slide2First",
    "slide2",
    "firstTeachingSlide",
    "editable",
    "lastPicture",
    "lastDiagram",
    "notes",
    "done",
  ];
  const lastVisual = Math.max(timings.lastPicture ?? 0, timings.lastDiagram ?? 0) || undefined;
  writeJson(`${o.outDir}/timings.json`, {
    // From the request (the objectives phase and single-phase runs).
    ms: { ...Object.fromEntries(keys.map((k) => [k, timings[k]])), lastVisual },
    // Two-phase runs: the design phase measured from the teacher's sign-off (decision b).
    ...(twoPhase
      ? {
          fromSignOff: Object.fromEntries(
            [
              "design",
              "slide2",
              "firstPlaceholder",
              "firstTeachingSlide",
              "editable",
              "lastPicture",
              "lastDiagram",
              "notes",
              "done",
            ]
              .filter((k) => timings[k] !== undefined)
              .map((k) => [k, (timings[k] as number) - signOffMs]),
          ),
          objectivesGate10s: (timings.objectivesAll ?? Infinity) <= 10_000,
        }
      : {}),
    theme: {
      used: themeId,
      model: plan.design?.theme ?? null,
      teacher: brief.teacherTheme ?? null,
    },
    pictureStyle: plan.design?.picture_style ?? null,
    all: timings,
    mainCall: { ms: main.ms, firstTokenMs: main.firstTokenMs },
  });
  writeJson(`${o.outDir}/cost.json`, {
    ...cost,
    total: Number(total.toFixed(5)),
    main: (cost as Record<string, number>).main ?? 0,
  });
  writeJson(`${o.outDir}/checks.json`, { count, summary, slides: checks });
  return { lessonFile, timings, cost: { ...cost, total }, checks };
}

/**
 * Round 3: which lesson slide a streamed value is. The T schema (prompts/T/make_schema.py) makes
 * slide 1 and 2 structural: top-level `title` and `objectives` objects, then `slides` = slide 3 on.
 * Older schemas (and K/R) put every slide in `slides`. The two layouts are told apart by the
 * stream itself: a top-level `title` object switches the offset on.
 */
export function slideIndexer() {
  let split = false;
  return (path: Path, v: unknown): number | undefined => {
    const isSlide = !!v && typeof v === "object" && !Array.isArray(v);
    if (path.length === 1 && path[0] === "title" && isSlide) {
      split = true;
      return 0;
    }
    if (path.length === 1 && path[0] === "objectives" && isSlide) return 1;
    if (path.length === 2 && path[0] === "slides" && typeof path[1] === "number")
      return path[1] + (split ? 2 : 0);
    return undefined;
  };
}

/** Render helper for plugins: a diagram spec's SVG at a size, at the stage's type scale. */
export const drawDiagram = (
  spec: unknown,
  theme: Theme,
  stage: Stage,
  size: { w: number; h: number },
) => withKeyStage(stage, () => renderDiagram(spec, theme, size));

/** A repair answer is {fix, slide, to_notes}: the slide replaces the old one, to_notes is added to its notes. */
export function applyRepair(
  slides: (Record<string, unknown> | undefined)[],
  notes: Map<number, { notes: string; answers: string[] }>,
  i: number,
  out: unknown,
) {
  // The repair schema's to_notes is an array of strings (every run's repair crashed on `.trim()`
  // of an array, so no repair was ever applied); a plain string is accepted too.
  const o = out as { slide?: Record<string, unknown>; to_notes?: string | string[] };
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

/** The diagram drawings an earlier run placed, by slide index (offline re-layout). */
export function reusedDiagrams(
  runDir: string,
): Map<number, { src: string; aspect: number; alt: string }> {
  const out = new Map<number, { src: string; aspect: number; alt: string }>();
  const lesson = JSON.parse(readFileSync(`${runDir}/lesson.json`, "utf8")) as
    | Slide[]
    | { slides: Slide[] };
  (Array.isArray(lesson) ? lesson : lesson.slides).forEach((sl, i) => {
    for (const e of sl.elements as unknown as Record<string, unknown>[])
      if (e.type === "image" && e.name === "Diagram" && typeof e.src === "string")
        out.set(i, { src: e.src, aspect: Number(e.w) / Number(e.h), alt: String(e.alt ?? "") });
  });
  return out;
}

/** Keys of photos that repeat a picture an earlier slide already shows for a different request. */
export function repeatedPictures(visuals: Map<string, VisualState>): string[] {
  const first = new Map<string, { slide: number; request?: string }>();
  const shown = [...visuals]
    .filter(([, v]) => v.status === "photo")
    .map(([k, v]) => ({
      k,
      slide: Number(k.split(":")[0]),
      photo: (v as { photo: PhotoResult }).photo,
    }))
    .sort((a, b) => a.slide - b.slide || a.k.localeCompare(b.k));
  const drop: string[] = [];
  for (const p of shown) {
    const f = first.get(p.photo.src);
    if (!f) first.set(p.photo.src, { slide: p.slide, request: p.photo.request });
    else if (f.request !== p.photo.request) drop.push(p.k);
  }
  return drop;
}

/** A diagram's own title is dropped when it only repeats the slide heading. */
export function dropEchoTitle<T>(spec: T, heading: string): T {
  const t = (spec as { title?: unknown }).title;
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  if (typeof t !== "string" || !heading || norm(t) !== norm(heading)) return spec;
  const { title: _, ...rest } = spec as Record<string, unknown>;
  return rest as T;
}

/** The photos an earlier run placed, by visual key, with the request, subjects and alt its slides carried. */
export function reusedPhotos(runDir: string): Map<string, PhotoResult> {
  const byKey = new Map<string, PhotoResult>();
  const els = new Map<string, Record<string, unknown>>();
  const lesson = JSON.parse(readFileSync(`${runDir}/lesson.json`, "utf8")) as
    | Slide[]
    | { slides: Slide[] };
  for (const sl of Array.isArray(lesson) ? lesson : lesson.slides)
    for (const e of sl.elements as unknown as Record<string, unknown>[])
      if (e.type === "image" && typeof e.src === "string") els.set(e.src, e);
  for (const line of readFileSync(`${runDir}/log.jsonl`, "utf8").split("\n")) {
    if (!line.includes('"picture-done"')) continue;
    const r = JSON.parse(line) as { key: string; ok: boolean; src?: string; provider?: string };
    if (!r.ok || !r.src) continue;
    const e = els.get(r.src) ?? {};
    byKey.set(r.key, {
      src: r.src,
      alt: String(e.alt ?? ""),
      request: String(e.request ?? ""),
      provider: r.provider,
      ...(e.subjects ? { subjects: e.subjects as PhotoResult["subjects"] } : {}),
      aspect: aspectOf(r.src),
    } as PhotoResult);
  }
  return byKey;
}

/** The bank's id for a placed picture (its source id), else its storage file name. */
export function pictureId(p: PhotoResult): string {
  const id = (p.source as { id?: string } | undefined)?.id;
  return id || (p.src.split("/").pop() ?? p.src).replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Ruling 163 gate (eval `gates.py ruling163`): every placed picture's image element carries its
 * `source` (PhotoSource: `provider` commons, pexels or generated, and `id`), plus `style` (photo,
 * illustration or drawn) and `period` (the request's period, when it has one) on the element.
 * Matched by src against the landed pictures; diagrams and open slots are left alone.
 */
export function stampPictureSources(slides: Slide[], visuals: Map<string, VisualState>) {
  const bySrc = new Map<string, PhotoResult>();
  for (const v of visuals.values()) if (v.status === "photo") bySrc.set(v.photo.src, v.photo);
  for (const s of slides)
    for (const e of (s as { elements?: Record<string, unknown>[] }).elements ?? []) {
      if (e.type !== "image") continue;
      const p = bySrc.get(String(e.src));
      if (!p) continue;
      const src = (p.source ?? {}) as Record<string, unknown>;
      e.source = {
        ...src,
        provider: (src.provider as string) ?? p.provider ?? "generated",
        id: (src.id as string) ?? pictureId(p),
      };
      e.style = p.style ?? "photo";
      if (p.period) e.period = p.period;
      else delete e.period;
    }
}

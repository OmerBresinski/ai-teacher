import { writerBundle } from "./bundle";
import fitData from "./fit-table.gen.json" with { type: "json" };
import objectivesRoom from "./objectives-room.gen.json" with { type: "json" };
import { nonFatalSync } from "./services";

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
  yearGroup: string;
  year: number;
  keyStage: Stage;
  challenge?: "support" | "core" | "stretch";
  theme: string;
  readingLevel: string;
  language: string;
  durationMin: number;
  exitTicketOnSlides: boolean;
  tier: string;
  slides: { min: number; max: number };
  teacherTheme?: string;
};

/** The prompt files' stage key. */
export const promptStage = (k: Stage) => (k === "ks1" ? "KS1" : k === "ks2" ? "KS2" : "KS3-5");

/** `objectiveCount` at the middle of the brief's slide range. */
export function objectiveCount(b: Brief): string {
  const n = Math.round((b.slides.min + b.slides.max) / 2);
  return n <= 7 ? "one or two" : n <= 11 ? "two or three" : "three or four";
}

/**
 * K3: why a writer output is incomplete, or undefined when it is whole. A stream cut at the token
 * limit, JSON that does not close, or no written slide fails the job instead of
 * saving the flow's placeholders as a headings-only deck.
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
    () => JSON.parse(o.text) as { slides?: unknown[] },
    () => undefined,
  );
  if (out === undefined) return "writer JSON does not parse";
  // `slides` holds slide 3 onwards (title and objectives are their own keys).
  const n = Array.isArray(out?.slides) ? out.slides.length : 0;
  // A count miss ships as written and is logged (count.ts, ADR 0036); only an output with no
  // written slide at all is incomplete (the headings-only deck K3 exists to stop).
  if (n === 0) return "no slides after title and objectives";
  return undefined;
}

/** A 32-bit FNV-1a hash of a string (seeds the hinge shuffle). */
export function fnv(x: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 0x01000193) >>> 0;
  return h;
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
export const fitTable = (): Record<string, FitGroup> =>
  (fitData as unknown as { groups: Record<string, FitGroup> }).groups;

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Each text field over its measured limit, as `field: N characters, room M (K over)`. The slide's
 * way of filling its layout is matched by its item count and figure.
 */
export function charsOver(slide: unknown, stage: string): string[] {
  const s = (slide ?? {}) as S;
  const F = fitTable()[stage];
  const L = F?.layouts[String(s.template)];
  if (!F || !L) return [];
  const listKey = ["points", "questions", "options", "columns", "sequence"].find((k) =>
    Array.isArray(s[k]),
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
    const o = (it ?? {}) as S;
    const text = typeof it === "string" ? it : (o.text ?? o.caption);
    over(`${listKey}[${k + 1}]`, text, lim.item);
    if (typeof o.label === "string")
      over(`${listKey}[${k + 1}].label`, o.label, v.keyLabel ?? v.columnLabel, false);
  });
  // The figure's ask, or its ask_without when the figure is not shown, is on the slide too.
  all += Math.max(
    0,
    ...["figure", "picture", "diagram"].flatMap((k) => {
      const f = s[k] as S | null | undefined;
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
  return field ? { slide: { ...s, [field]: pic }, how: `${field}-from-look` } : { slide: s };
}

/** The room a slide has, in the writer's units, for a stand-alone or reroute call. */
export function roomLine(slide: unknown, stage: string): string {
  const s = { ...((slide ?? {}) as S) };
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
 * room, never "about N lines". A fault no field explains keeps its slot name with the overflow
 * said as a share of the room.
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

/** The pupil line's word limit: the objectives slide's measured room for this many objectives. */
export function pupilWordLimit(stage: Stage, n: number): number {
  const room = (objectivesRoom as Record<string, Record<string, number>>)[promptStage(stage)];
  const chars = room?.[`${n} objectives`];
  if (chars) return Math.max(6, Math.floor(chars / 6));
  return stage === "ks1" ? 8 : stage === "ks2" ? 10 : 12;
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

/** The writer's user turn: the pinned `user.txt` filled with the brief and the approved objectives. */
export function contextBlock(
  b: Brief,
  objectives?: { teacher: string; pupil: string }[],
  user: string = writerBundle().user,
): string {
  return fillTemplate(user, b, objectives ? { objectives } : {});
}

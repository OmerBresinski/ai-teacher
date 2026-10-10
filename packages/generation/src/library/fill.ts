/**
 * A library model the writer asked for, filled, checked and drawn (TEACH-247 part h, ADR 0035;
 * ported from lab/bakeoff/ab/lib.ts at lab/lib-next 8fbfb912):
 * 1. one fill call (the drawer's small model) sets the model's params from its schema, the slide's
 *    words, the writer's intent and the lesson;
 * 2. code checks them: the kit's schemaCheck, then the model's own validate(); one repair call with
 *    the refusals;
 * 3. what the intent asks that the model cannot draw (lib-meta `cannot`), and on a question slide
 *    the last build before the answer (lib-meta `answerKeys`), or no model;
 * 4. the model is drawn as an SVG (render.ts), and its printed numbers must be the slide's
 *    (consistency.ts, TEACH-247 part i): a drawing that disagrees is the drawer's.
 * Any failure returns the drawer kind to fall back to, never an empty slot. Never throws, except a
 * budget or abort error from the call, which stops the job as every other call's does.
 */

import type { DiagramSource } from "@tj/domain/documents";
import { TYPE_FLOOR } from "@tj/slides/diagrams";
import { nonFatal, nonFatalSync } from "../writer/services";
import { BASE_KIND, FALLBACK_KIND, LIB_META, LIB_PROMPTS } from "./catalogue";
import { drawingWordsMismatch } from "./consistency";
import { drawLibraryModel } from "./guard";
import {
  boundsRefusals,
  drawnLines,
  inspectDrawnSvg,
  kit,
  type LibraryDrawing,
  loadModel,
} from "./render";
import type { J, LibRefusal } from "./types";

/** Params the filler never sets: the slide's heading is the title; wording overrides are the teacher's. */
const NOT_FILLED = ["title", "text"];

/**
 * The params a model's drawing is built from, given the params as they will draw (TEACH-247 part
 * i). One the fill leaves out is refused, never defaulted: a default draws a different number from
 * the slide's ("half of 16" with no group size drew 2 groups of 2). The always-needed ones are also
 * `required` in the schema the filler sees.
 */
export const DRAWING_PARAMS: Record<string, { always: string[]; when?: (p: J) => string[] }> = {
  equal_groups: {
    always: [],
    when: (p) => (p.layout === "grid" ? ["grid"] : ["groups", "size"]),
  },
  fractions: { always: ["fractions"], when: (p) => (p.operation === "of" ? ["amount"] : []) },
  bar_model: {
    always: ["type"],
    when: (p) =>
      p.type === "fraction"
        ? ["amount", "fraction"]
        : p.type === "percentage"
          ? ["amount", "percent"]
          : p.type === "multiplicative"
            ? ["parts", "times"]
            : ["parts"],
  },
  number_line: {
    always: ["from", "to"],
    when: (p) => (p.task === "round" ? ["round"] : p.task === "position" ? ["marks"] : ["jumps"]),
  },
  number_bonds: { always: ["whole", "parts"] },
  place_value: { always: ["number"] },
  column_methods: { always: ["a", "b"] },
  coins_money: { always: ["amount"], when: (p) => (p.task === "change" ? ["paid"] : []) },
};

/** The drawing-defining params `own` (what the filler sent) leaves out, as refusals. */
export function missingDrawingParams(id: string, own: J, params: J): LibRefusal[] {
  const d = DRAWING_PARAMS[id];
  if (!d) return [];
  const need = [...d.always, ...(d.when?.(params) ?? [])];
  return [...new Set(need)]
    .filter((k) => own[k] === undefined || own[k] === null)
    .map((k) => ({
      path: k,
      reason: `${k} is missing: the drawing is built from it, and the model's default would draw a different number`,
    }));
}

/**
 * An equivalence draws the finer partition with the coarser one marked (S10 paid L y2 s9: "2/4 =
 * 1/2" drawn as halves only). The fractions model cuts the bar for the first fraction, then for
 * the second, and keeps the first cuts only when the second's parts divide them; sent finer first,
 * the quarter cuts were hidden when the halves came in. So the coarser fraction goes first whenever
 * the other's denominator is a multiple of it. Any other params are returned as they are.
 */
export function orderedParams(id: string, own: J): J {
  if (id !== "fractions" || own.operation !== "equivalent" || !Array.isArray(own.fractions))
    return own;
  const fr = own.fractions as unknown[];
  if (fr.length !== 2) return own;
  const den = (f: unknown) => {
    const m = /^\s*\d+\s*\/\s*(\d+)\s*$/.exec(String((f as J | null)?.value ?? ""));
    return m ? Number(m[1]) : undefined;
  };
  const a = den(fr[0]);
  const b = den(fr[1]);
  if (!a || !b || a <= b || a % b !== 0) return own;
  return { ...own, fractions: [fr[1], fr[0]] };
}

/** The model's params schema as the filler sees it: no title or wording overrides, no $schema or x- keys. */
export function fillSchema(params: J, id?: string): J {
  const strip = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(strip);
    if (!n || typeof n !== "object") return n;
    const o: J = {};
    for (const [k, v] of Object.entries(n as J))
      if (k !== "$schema" && !k.startsWith("x-")) o[k] = strip(v);
    return o;
  };
  const s = strip(params) as J & { properties: J; required?: string[] };
  for (const k of NOT_FILLED) delete s.properties[k];
  if (s.required) s.required = s.required.filter((k) => !NOT_FILLED.includes(k));
  const always = (id && DRAWING_PARAMS[id]?.always) || [];
  if (always.length) s.required = [...new Set([...(s.required ?? []), ...always])];
  return s;
}

/**
 * The optional panels (lib-meta `optionalPanels`) to switch off: each the fill left unset whose
 * `when` patterns the writer's intent does not match (diagrams-07: the heart's pulse panel).
 */
export function panelsOff(id: string, own: J, intent: string): J {
  const off: J = {};
  for (const p of LIB_META[id]?.optionalPanels ?? [])
    if (
      (own[p.param] === undefined || own[p.param] === null) &&
      !p.when.some((w) => new RegExp(w, "i").test(intent))
    )
      off[p.param] = false;
  return off;
}

/**
 * schemaCheck on what the filler sent, then validate() on it with the model's defaults. With
 * `intent` (flag `libraryPanelsOff`), optional panels the intent does not name are off first.
 */
export async function checkParams(
  id: string,
  out: unknown,
  intent?: string,
): Promise<{ params?: J; refusals: LibRefusal[]; warnings: string[] }> {
  const m = await loadModel(id);
  if (!m) return { refusals: [{ path: "model", reason: `no model ${id}` }], warnings: [] };
  if (!out || typeof out !== "object" || Array.isArray(out))
    return { refusals: [{ path: "(all)", reason: "no params object" }], warnings: [] };
  const k = await kit();
  let own = { ...(out as J) };
  for (const key of NOT_FILLED) delete own[key];
  own = orderedParams(id, own);
  const shape = k.schemaCheck(fillSchema(m.params, id), own);
  if (shape.length) return { refusals: shape, warnings: [] };
  // A value outside the bounds the drawing holds to (or a __proto__ / constructor key) is refused,
  // never clamped: a clamp would draw a different number from the one the slide asked for.
  const bounds = boundsRefusals(fillSchema(m.params), own);
  if (bounds.length) return { refusals: bounds, warnings: [] };
  const params = k.withDefaults(
    m.params,
    intent === undefined ? own : { ...own, ...panelsOff(id, own, intent) },
  );
  const missing = missingDrawingParams(id, own, params);
  if (missing.length) return { refusals: missing, warnings: [] };
  return nonFatalSync(
    () => {
      const v = m.validate(params);
      return v.ok
        ? { params, refusals: [], warnings: v.warnings ?? [] }
        : { refusals: v.refusals, warnings: [] };
    },
    (e) => ({
      refusals: [{ path: "(all)", reason: `validate threw: ${String(e).slice(0, 160)}` }],
      warnings: [],
    }),
  );
}

/** What `intent` asks of model `id` that it cannot draw (empty: it can, as far as we know). */
export function capabilityRefusals(id: string, intent: string): LibRefusal[] {
  return (LIB_META[id]?.cannot ?? [])
    .filter((c) => c.when.some((w) => new RegExp(w, "i").test(intent)))
    .map((c) => ({ path: "intent", reason: `${id} cannot draw ${c.what}` }));
}

/**
 * The build a question slide draws: the last of the model's builds before the first that shows
 * the answer. Undefined when there is none, or no answer keys are known (then no model).
 */
export async function questionStep(id: string, params: J): Promise<number | undefined> {
  const keys = LIB_META[id]?.answerKeys;
  if (!keys?.length) return undefined;
  const m = await loadModel(id);
  if (!m?.builds) return undefined;
  const builds = m.builds;
  const steps = nonFatalSync(
    () => builds(params).steps,
    () => undefined,
  );
  if (!steps) return undefined;
  const first = steps.findIndex((s) => keys.includes(s.key.split(":")[0] as string));
  if (first <= 0) return undefined;
  return first - 1;
}

/** One fill or repair call: the drawer's structured call on the small model. */
export type LibFiller = (r: { system: string; user: string; schema: J }) => Promise<unknown>;

export type LibraryAsk = {
  key: string;
  model: string;
  intent: string;
  alt?: string;
  words: string;
  /** The slide's heading and the model's caption: what the drawing is checked against. */
  heading?: string;
  caption?: string;
  yearGroup: string;
  lesson: string;
  question?: boolean;
  /** Words printed over words fall back (flag `libraryLabelOverlap`, diagrams-09). */
  labelOverlap?: boolean;
  /**
   * The label floor (flag `libraryLabelFloor`, needs `place`): the kit's type tokens grow until the
   * smallest words show at `TYPE_FLOOR` where the drawing is placed; the grown drawing must then
   * keep its words apart and inside the model's stage, or it falls back.
   */
  labelFloor?: boolean;
  /** Optional panels off unless the intent names them (flag `libraryPanelsOff`, diagrams-07). */
  panelsOff?: boolean;
  /**
   * Checks only logged (the writer's checks "log", TEACH-312 part i): a drawn model never falls
   * back for what a check reads (capability, label floor, words mismatch, overlap, type floor);
   * each is logged as "lib-check-logged". Only a model that cannot be filled or drawn falls back.
   */
  logOnly?: boolean;
  /**
   * The box the drawing is placed in on the 960 x 540 slide (flag `libraryModelBody`): a drawing
   * whose smallest words would show under the drawer's `TYPE_FLOOR` there falls back
   * (diagrams-06). Absent: no type-floor gate (today's behaviour).
   */
  place?: { w: number; h: number };
  /**
   * The lesson theme's body font stack (`theme.fonts.body`): the face the drawing's words are
   * measured in and set in (TEACH-247 part o). Absent: Lexend.
   */
  font?: string;
};
/** A library drawing's source as the image element stores it (`ImageElement.diagram`). */
export type LibrarySource = Extract<DiagramSource, { kind: "library" }>;
export type LibraryResult =
  | {
      ok: true;
      drawing: LibraryDrawing;
      params: J;
      attempts: number;
      /** What it was drawn from, for the slide's image element (TEACH-97 part h). */
      source: LibrarySource;
    }
  /** The drawer kind to fall back to, and why the model was not drawn. */
  | { ok: false; fallbackKind: string; reason: string };

/**
 * The smallest type a drawn library SVG shows at, in points on the 960 x 540 slide, once it is
 * contained in `place` (its view box scaled to fit, as the slide's image element does).
 */
export function placedTypeSize(
  svg: string,
  place: { w: number; h: number },
): { scale: number; minPt: number; word?: string } {
  const { viewBox, words } = inspectDrawnSvg(svg);
  const [, , vw, vh] = viewBox;
  const scale = vw > 0 && vh > 0 ? Math.min(place.w / vw, place.h / vh) : 0;
  let min: { fs: number; words: string } | undefined;
  for (const w of words) if (!min || w.fs < min.fs) min = w;
  return {
    scale,
    minPt: min ? min.fs * scale : Number.POSITIVE_INFINITY,
    ...(min ? { word: min.words } : {}),
  };
}

/**
 * Pairs of words in a drawn library SVG whose boxes overlap (more than `tol` view-box units each
 * way), read back with `inspectDrawnSvg` as the drawer's label check reads its own (diagrams-09:
 * the fractions model's "7" printed over "3/5 of 35 = 21", 0.48 of the "7"). Two words count when the
 * other covers over `share` of the smaller one's box each way: over all 202 presets the most a
 * stacked pair covers is 0.3 ("6" over "six"). The same word at the same place is one word drawn
 * twice (a halo copy), not an overlap. Words Present never shows together (TEACH-247 part p) are
 * not either.
 */
export const OVERLAP_SHARE = 0.4;
export function overlappingWords(svg: string, share = OVERLAP_SHARE): [string, string, number][] {
  const { words } = inspectDrawnSvg(svg);
  const out: [string, string, number][] = [];
  for (let i = 0; i < words.length; i++)
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i];
      const b = words[j];
      if (!a || !b) continue;
      // Words never on screen together (two builds' passing labels) do not overlap.
      if (a.shown && b.shown && !a.shown.some((i) => b.shown?.includes(i))) continue;
      if (a.shown?.length === 0 || b.shown?.length === 0) continue;
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox <= 2 || oy <= 2) continue;
      // How much of the smaller word's box the other covers, each way (stacked lines graze).
      const k = Math.min(
        ox / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0)),
        oy / Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0)),
      );
      if (a.words === b.words && k > 0.95) continue;
      if (k > share) out.push([a.words, b.words, Math.round(k * 100) / 100]);
    }
  return out;
}

/**
 * What went wrong with a drawing's words once its type grew (the label floor), against the same
 * drawing at the kit's own sizes: a word split across lines or lost ("Oxygen-p" / "oor"), or a
 * line set less than 0.9 of its type size below the one above (lines on top of one another).
 * Undefined when neither.
 */
export function grownTextFault(baseSvg: string, grownSvg: string): string | undefined {
  const words = (svg: string) =>
    drawnLines(svg)
      .flatMap((t) => t.lines.join(" ").split(/\s+/))
      .filter(Boolean)
      .sort()
      .join(" ");
  const grown = drawnLines(grownSvg);
  if (words(baseSvg) !== words(grownSvg)) return "its words split or change across lines";
  for (const t of grown)
    if (t.pitch.some((d) => d < 0.9 * t.fs))
      return `its lines "${t.lines.join(" / ").slice(0, 30)}" sit on top of one another`;
  return undefined;
}

/** The label floor's draws after the first, and the most the type may grow (flag `libraryLabelFloor`). */
const LABEL_FLOOR_TRIES = 3;
export const LABEL_FLOOR_MAX = 2;

const tokens = (t: string, v: Record<string, string>) =>
  t.replace(/\{\{(\w+)\}\}/g, (m, k: string) => v[k] ?? m);

export async function libraryDiagram(
  ask: LibraryAsk,
  filler: LibFiller,
  log: (e: J) => void = () => {},
): Promise<LibraryResult> {
  const fallback = (reason: string): LibraryResult => {
    const fallbackKind = BASE_KIND[ask.model] ?? FALLBACK_KIND;
    log({ ev: "lib-fallback", key: ask.key, model: ask.model, to: fallbackKind, reason });
    return { ok: false, fallbackKind, reason };
  };
  /** A check's verdict: a fallback, or with `logOnly` a log line and the drawing kept. */
  const checkFault = (reason: string | undefined): LibraryResult | undefined => {
    if (!reason) return undefined;
    if (!ask.logOnly) return fallback(reason);
    log({ ev: "lib-check-logged", key: ask.key, model: ask.model, reason });
    return undefined;
  };
  const m = await nonFatal(
    () => loadModel(ask.model),
    () => undefined,
  );
  if (!m) return fallback(`no shipped model ${ask.model}`);
  const schema = fillSchema(m.params, ask.model);
  const user = tokens(LIB_PROMPTS.fillUser, {
    model: `${m.meta.id} (${m.meta.name})`,
    lesson: ask.lesson,
    year: ask.yearGroup,
    intent: ask.intent,
    words: ask.words,
    schema: JSON.stringify(schema),
  }).trim();
  let last: unknown;
  let refusals: LibRefusal[] = [];
  let params: J | undefined;
  let attempts = 0;
  for (let attempt = 0; attempt < 2 && !params; attempt++) {
    attempts = attempt + 1;
    const turn =
      attempt === 0
        ? user
        : `${user}\n\n${tokens(LIB_PROMPTS.repairUser, {
            params: JSON.stringify(last),
            refusals: refusals.map((r) => `${r.path}: ${r.reason}`).join("\n"),
          }).trim()}`;
    let callFault = "";
    last = await nonFatal(
      () => filler({ system: LIB_PROMPTS.fill.trim(), user: turn, schema }),
      (e) => {
        callFault = String(e).slice(0, 160);
        return undefined;
      },
    );
    if (callFault) return fallback(`the fill call failed: ${callFault}`);
    const c = await checkParams(ask.model, last, ask.panelsOff ? ask.intent : undefined);
    log({ ev: "lib-fill", key: ask.key, model: ask.model, attempt, ok: !!c.params });
    if (c.params) params = c.params;
    else refusals = c.refusals;
  }
  if (!params)
    return fallback(
      `refused: ${refusals
        .slice(0, 3)
        .map((r) => `${r.path}: ${r.reason}`)
        .join("; ")}`,
    );
  const cannot = capabilityRefusals(ask.model, ask.intent);
  const cf = checkFault(cannot.map((r) => r.reason).join("; "));
  if (cf) return cf;
  let step: number | undefined;
  if (ask.question) {
    step = await questionStep(ask.model, params);
    if (step === undefined) return fallback("a question slide and no build before the answer");
  }
  const p = params;
  const face = ask.font === undefined ? {} : { font: ask.font };
  // The full drawing (with a question slide's answer) is checked against the slide's words.
  let full = await nonFatal(
    () => drawLibraryModel(ask.model, p, face),
    (e) => String(e).slice(0, 160),
  );
  if (typeof full === "string") return fallback(`it did not draw: ${full}`);
  // The label floor: grow the type until the smallest words reach the floor where it is placed.
  let typeScale = 1;
  if (ask.labelFloor && ask.place) {
    const place = ask.place;
    const offBefore = new Set(full.offSlide);
    const baseSvg = full.svg;
    for (let i = 0; i < LABEL_FLOOR_TRIES; i++) {
      const svg = full.svg;
      const t = nonFatalSync(
        () => placedTypeSize(svg, place),
        () => undefined,
      );
      if (!t || t.minPt >= TYPE_FLOOR - 0.01) break;
      typeScale = Math.min(LABEL_FLOOR_MAX, typeScale * (TYPE_FLOOR / t.minPt) * 1.02);
      const ts = typeScale;
      const grown = await nonFatal(
        () => drawLibraryModel(ask.model, p, { typeScale: ts, ...face }),
        (e) => String(e).slice(0, 160),
      );
      if (typeof grown === "string")
        return fallback(`it did not draw at the label floor: ${grown}`);
      full = grown;
      if (ts >= LABEL_FLOOR_MAX) break;
    }
    log({ ev: "lib-label-floor", key: ask.key, model: ask.model, typeScale });
    if (typeScale !== 1) {
      const grownSvg = full.svg;
      const fault = nonFatalSync(
        () => grownTextFault(baseSvg, grownSvg),
        (e) => `its words could not be read: ${String(e).slice(0, 60)}`,
      );
      const f = checkFault(fault && `at the label floor ${fault}`);
      if (f) return f;
    }
    const off = full.offSlide.filter((w) => !offBefore.has(w));
    const f = checkFault(
      off.length
        ? `at the label floor its words leave the model: ${off.slice(0, 2).join(", ").slice(0, 60)}`
        : undefined,
    );
    if (f) return f;
  }
  const drawnFull = full;
  // Only the words that describe the drawing: the slide's heading and the model's caption.
  const about =
    ask.heading !== undefined || ask.caption !== undefined
      ? [ask.heading, ask.caption].filter(Boolean).join("\n")
      : ask.words;
  const mismatch = drawingWordsMismatch(ask.model, drawnFull.svg, about);
  const mf = checkFault(mismatch && `it disagrees with the slide: ${mismatch}`);
  if (mf) return mf;
  const drawn =
    step === undefined
      ? drawnFull
      : await nonFatal(
          () =>
            drawLibraryModel(ask.model, p, {
              step,
              ...(typeScale !== 1 ? { typeScale } : {}),
              ...face,
            }),
          (e) => String(e).slice(0, 160),
        );
  if (typeof drawn === "string") return fallback(`it did not draw: ${drawn}`);
  // Words over words (flag `libraryLabelOverlap`): the drawer's text-box reading of the still.
  if (ask.labelOverlap || ask.labelFloor) {
    const o = nonFatalSync(
      () => overlappingWords(drawn.svg),
      () => undefined,
    );
    const of = checkFault(
      !o
        ? "its words could not be read for overlaps"
        : o.length
          ? `its words overlap: ${o
              .slice(0, 2)
              .map(([a, b]) => `"${a.slice(0, 20)}" over "${b.slice(0, 20)}"`)
              .join(", ")}`
          : undefined,
    );
    if (of) return of;
  }
  // The type floor (flag `libraryModelBody`): words under 18 pt where the drawing is placed.
  if (ask.place) {
    const t = nonFatalSync(
      () => placedTypeSize(drawn.svg, ask.place as { w: number; h: number }),
      () => undefined,
    );
    if (t) log({ ev: "lib-type", key: ask.key, model: ask.model, scale: t.scale, minPt: t.minPt });
    const tf = checkFault(
      !t
        ? "its words could not be measured for the type floor"
        : t.minPt < TYPE_FLOOR - 0.01
          ? `its words show at ${Math.round(t.minPt * 10) / 10} pt ("${String(t.word).slice(0, 30)}"), under the ${TYPE_FLOOR} pt floor`
          : undefined,
    );
    if (tf) return tf;
  }
  log({
    ev: "lib-drawn",
    key: ask.key,
    model: ask.model,
    attempts,
    builds: drawn.builds,
    bytes: drawn.bytes,
    ...(drawn.warnings.length ? { warnings: drawn.warnings.slice(0, 3) } : {}),
  });
  return {
    ok: true,
    drawing: { ...drawn, alt: ask.alt || drawn.alt },
    params,
    attempts,
    source: {
      kind: "library",
      model: ask.model,
      params: params as Record<string, unknown>,
      ...(step === undefined ? {} : { step }),
      ...(typeScale !== 1 ? { typeScale } : {}),
    },
  };
}

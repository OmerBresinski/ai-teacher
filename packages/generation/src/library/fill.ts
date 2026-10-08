/**
 * A library model the writer asked for, filled, checked and drawn (TEACH-247 part h, ADR 0035;
 * ported from lab/bakeoff/ab/lib.ts at lab/lib-next 8fbfb912):
 * 1. one fill call (the drawer's small model) sets the model's params from its schema, the slide's
 *    words, the writer's intent and the lesson;
 * 2. code checks them: the kit's schemaCheck, then the model's own validate(); one repair call with
 *    the refusals;
 * 3. what the intent asks that the model cannot draw (lib-meta `cannot`), and on a question slide
 *    the last build before the answer (lib-meta `answerKeys`), or no model;
 * 4. the model is drawn as an SVG (render.ts).
 * Any failure returns the drawer kind to fall back to, never an empty slot. Never throws, except a
 * budget or abort error from the call, which stops the job as every other call's does.
 */
import { nonFatal } from "../writer/services";
import { BASE_KIND, FALLBACK_KIND, LIB_META, LIB_PROMPTS } from "./catalogue";
import { kit, type LibraryDrawing, loadModel, renderLibraryModel } from "./render";
import type { J, LibRefusal } from "./types";

/** Params the filler never sets: the slide's heading is the title; wording overrides are the teacher's. */
const NOT_FILLED = ["title", "text"];

/** The model's params schema as the filler sees it: no title or wording overrides, no $schema or x- keys. */
export function fillSchema(params: J): J {
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
  return s;
}

/** schemaCheck on what the filler sent, then validate() on it with the model's defaults. */
export async function checkParams(
  id: string,
  out: unknown,
): Promise<{ params?: J; refusals: LibRefusal[]; warnings: string[] }> {
  const m = await loadModel(id);
  if (!m) return { refusals: [{ path: "model", reason: `no model ${id}` }], warnings: [] };
  if (!out || typeof out !== "object" || Array.isArray(out))
    return { refusals: [{ path: "(all)", reason: "no params object" }], warnings: [] };
  const k = await kit();
  const own = { ...(out as J) };
  for (const key of NOT_FILLED) delete own[key];
  const shape = k.schemaCheck(fillSchema(m.params), own);
  if (shape.length) return { refusals: shape, warnings: [] };
  const params = k.withDefaults(m.params, own);
  try {
    const v = m.validate(params);
    return v.ok
      ? { params, refusals: [], warnings: v.warnings ?? [] }
      : { refusals: v.refusals, warnings: [] };
  } catch (e) {
    return {
      refusals: [{ path: "(all)", reason: `validate threw: ${String(e).slice(0, 160)}` }],
      warnings: [],
    };
  }
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
  let steps: { key: string }[];
  try {
    steps = m.builds(params).steps;
  } catch {
    return undefined;
  }
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
  yearGroup: string;
  lesson: string;
  question?: boolean;
};
export type LibraryResult =
  | { ok: true; drawing: LibraryDrawing; params: J; attempts: number }
  /** The drawer kind to fall back to, and why the model was not drawn. */
  | { ok: false; fallbackKind: string; reason: string };

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
  const m = await nonFatal(
    () => loadModel(ask.model),
    () => undefined,
  );
  if (!m) return fallback(`no shipped model ${ask.model}`);
  const schema = fillSchema(m.params);
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
    const c = await checkParams(ask.model, last);
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
  if (cannot.length) return fallback(cannot.map((r) => r.reason).join("; "));
  let step: number | undefined;
  if (ask.question) {
    step = await questionStep(ask.model, params);
    if (step === undefined) return fallback("a question slide and no build before the answer");
  }
  const p = params;
  const drawn = await nonFatal(
    () => renderLibraryModel(ask.model, p, step === undefined ? {} : { step }),
    (e) => String(e).slice(0, 160),
  );
  if (typeof drawn === "string") return fallback(`it did not draw: ${drawn}`);
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
  };
}

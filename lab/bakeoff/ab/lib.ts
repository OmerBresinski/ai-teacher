// lib arm (9 Oct): base4 + the writer may call a library model (research/animated-models/library).
// 1. The writer sees a short catalogue (id, what it teaches, years; available models for its stage)
//    and may write figure `{kind: "model", model: <id>, intent: "<what this slide must show>", alt}`.
// 2. A small gpt-6-luna call fills that model's params from its params schema, the slide's words,
//    the intent and the lesson context.
// 3. Code checks: the library's schemaCheck, then the model's validate(). On a refusal, one repair
//    call with the reasons; still refused -> base4's own drawer for the nearest base4 kind, or no figure.
// 4. The lab renders the final build (light theme) into the figure zone, plus a builds strip.
// Every word the models read is the prompt-engineer's (arms3/lib/REQUEST.md), in lib-words/ beside this file.
// bun lab/bakeoff/ab/lib.ts  -> writes ab/prompts/lib/{T,shared} from base4's files (base4 untouched).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { AB, STAGES } from "./arms";

type J = Record<string, unknown>;
type Stage = (typeof STAGES)[number];

export const LIBRARY =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/research/animated-models/library";
export const LIB_ARMS3 = `${AB}/arms3/lib`;
export const LIB_PROMPTS = `${AB}/prompts/lib`;

/** Flex audit (8 Oct, flex/SUMMARY.md): "baked in" models mislead off-preset, so the writer never sees them. */
export const UNAVAILABLE: Record<string, string> = {
  rivers_coasts:
    "baked in (course view): one west-to-east course; every real river drawn wrong, with no 'not a real map' note",
  place_change: "baked in: about 19 objects with wrong date windows (1960 shows 'no transport')",
};
/** The years a writer stage covers (Reception sits with KS1). */
export const STAGE_YEARS: Record<Stage, string[]> = {
  KS1: ["Reception", "Y1", "Y2"],
  KS2: ["Y3", "Y4", "Y5", "Y6"],
  "KS3-5": ["KS3", "KS4", "KS5"],
};
/** A refused model falls back to base4's own drawer for this kind (none listed: no figure). */
export const BASE_KIND: Record<string, string> = {
  equal_groups: "equal-groups",
  fractions: "fraction-shapes",
  bar_model: "bar-model",
  number_line: "number-line",
  data_chart: "bar-chart",
  timeline: "timeline",
  sort_venn_carroll: "venn",
  life_cycle: "cycle",
  water_cycle: "cycle",
};
/** Params the filler never sets: the slide's heading is the title, and wording overrides are the teacher's. */
const NOT_FILLED = ["title", "text"];

/* ------------------------------------------------------------------ the library under bun */

export type LibModel = {
  meta: { id: string; name: string; years: string[]; subjects: string[]; teaches: string };
  params: J & { properties: Record<string, J> };
  presets: { id: string; name: string; params: J }[];
  validate: (p: J) => {
    ok: boolean;
    refusals: { path: string; reason: string }[];
    warnings: string[];
  };
};
type Contract = {
  schemaCheck: (s: J, v: unknown) => { path: string; reason: string }[];
  withDefaults: (s: J, v: unknown) => J;
};
/** The kit touches two browser globals at import; meta, params, presets and validate are pure. */
function shim() {
  const g = globalThis as Record<string, unknown>;
  g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.requestAnimationFrame ??= () => 0;
}
let cache: Promise<{ models: Map<string, LibModel>; kit: Contract }> | undefined;
export function library() {
  cache ??= (async () => {
    shim();
    const reg = (await import(`${LIBRARY}/models/registry.js`)).default as string[];
    const models = new Map<string, LibModel>();
    for (const f of reg) {
      const m = (await import(`${LIBRARY}/models/${f}`)) as LibModel;
      models.set(m.meta.id, m);
    }
    const kit = (await import(`${LIBRARY}/kit/contract.js`)) as Contract;
    return { models, kit };
  })();
  return cache;
}

/* ------------------------------------------------------------------ the writer's catalogue */

export type CatalogueEntry = { id: string; teaches: string; years: string[] };
/** Available models whose years meet the stage's, in the library's gallery order. */
export async function catalogue(stage: Stage): Promise<CatalogueEntry[]> {
  const { models } = await library();
  const want = STAGE_YEARS[stage];
  return [...models.values()]
    .filter((m) => !UNAVAILABLE[m.meta.id] && m.meta.years.some((y) => want.includes(y)))
    .map((m) => ({ id: m.meta.id, teaches: m.meta.teaches, years: m.meta.years }));
}

/** The prompt-engineer's writer wording (arms3/lib/WRITER.json), else the placeholders. */
export type WriterWords = {
  /** The "- model: ..." line in the Diagram kinds list. */
  menuLine: string;
  /** The line above the catalogue. */
  header: string;
  /** One catalogue line from an entry: "{id}", "{teaches}", "{years}" are filled by code. */
  line: string;
  /** Per-model catalogue text instead of meta.teaches (optional, by id). */
  teaches?: Record<string, string>;
  /** Schema field descriptions: model, intent, alt. */
  fields?: Record<string, string>;
};
/** The prompt-engineer's words: lib-words/ beside this file (writer.json, lib-fill*.txt, lib-repair-user.txt). */
export const LIB_WORDS = `${import.meta.dir}/lib-words`;
export function writerWords(): WriterWords {
  return JSON.parse(readFileSync(`${LIB_WORDS}/writer.json`, "utf8")) as WriterWords;
}
const yearsText = (ys: string[]) =>
  ys.length > 2 ? `${ys[0]}-${ys[ys.length - 1]}` : ys.join(", ");
export function catalogueLines(entries: CatalogueEntry[], w: WriterWords = writerWords()) {
  return entries.map((e) =>
    w.line
      .replace("{id}", e.id)
      .replace("{teaches}", w.teaches?.[e.id] ?? e.teaches)
      .replace("{years}", yearsText(e.years)),
  );
}

/** base4's system text with the model menu line and the catalogue; nothing else changes. */
export function libSystem(base: string, entries: CatalogueEntry[], w = writerWords()): string {
  const head = "\nDiagram kinds:\n";
  const at = base.indexOf(head);
  if (at < 0) throw new Error("no Diagram kinds list in base4's system text");
  let end = at + head.length;
  while (base.startsWith("- ", end)) end = base.indexOf("\n", end) + 1;
  const block = `${w.menuLine}\n\n${w.header}\n${catalogueLines(entries, w).join("\n")}\n`;
  return base.slice(0, end) + block + base.slice(end);
}

/** base4's writer schema with dg-model-side and dg-model-full beside the other kinds. */
export function libSchema(base: J, ids: string[], w = writerWords()): J {
  const s = JSON.parse(JSON.stringify(base)) as J;
  const defs = s.$defs as Record<string, J & { anyOf?: J[] }>;
  const d = (k: string) => (w.fields?.[k] ? { description: w.fields[k] } : {});
  const def = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "model", "intent", "alt"],
    properties: {
      kind: { type: "string", enum: ["model"] },
      model: { type: "string", enum: ids, ...d("model") },
      intent: { type: "string", ...d("intent") },
      alt: { type: "string", ...d("alt") },
    },
  };
  for (const slot of ["side", "full"]) {
    const holder = defs[`diagram-${slot}`];
    if (!holder?.anyOf) throw new Error(`base4 schema has no diagram-${slot} anyOf`);
    defs[`dg-model-${slot}`] = def;
    holder.anyOf.push({ $ref: `#/$defs/dg-model-${slot}` });
  }
  return s;
}

/** Writes ab/prompts/lib from base4's: T/system and T/schema transformed, everything else copied. */
export async function writeLibPrompts() {
  const base = `${AB}/prompts/base4`;
  for (const dir of ["T", "shared"]) {
    mkdirSync(`${LIB_PROMPTS}/${dir}`, { recursive: true });
    for (const f of readdirSync(`${base}/${dir}`))
      if (!/^(system|schema)\./.test(f))
        copyFileSync(`${base}/${dir}/${f}`, `${LIB_PROMPTS}/${dir}/${f}`);
  }
  for (const st of STAGES) {
    const entries = await catalogue(st);
    const sys = libSystem(readFileSync(`${base}/T/system.${st}.txt`, "utf8"), entries);
    const schema = libSchema(
      JSON.parse(readFileSync(`${base}/T/schema.${st}.json`, "utf8")) as J,
      entries.map((e) => e.id),
    );
    writeFileSync(`${LIB_PROMPTS}/T/system.${st}.txt`, sys);
    writeFileSync(`${LIB_PROMPTS}/T/schema.${st}.json`, `${JSON.stringify(schema, null, 1)}\n`);
    console.log(st, entries.length, "models;", "system", sys.length, "chars");
  }
  for (const f of LIB_FILES) copyFileSync(`${LIB_WORDS}/${f}`, `${LIB_PROMPTS}/shared/${f}`);
}

/* ------------------------------------------------------------------ the fill call */

/** Fill and repair prompt files: written from lib-words/ into prompts/lib/shared/ by writeLibPrompts. */
export const LIB_FILES = ["lib-fill.txt", "lib-fill-user.txt", "lib-repair-user.txt"] as const;
const isPlaceholder = (s: string) => s.includes("[PLACEHOLDER lib arm");
export function libPrompt(name: (typeof LIB_FILES)[number]): string {
  const f = `${LIB_PROMPTS}/shared/${name}`;
  return readFileSync(existsSync(f) ? f : `${LIB_WORDS}/${name}`, "utf8");
}
/** True while any lib prompt is still a stand-in (a paid run refuses: see libPaidFaults). */
export function libPlaceholders(): string[] {
  const out: string[] = LIB_FILES.filter((n) => isPlaceholder(libPrompt(n)));
  if (writerWords().menuLine.includes("[PLACEHOLDER")) out.push("writer menu line and catalogue");
  return out;
}
const fillTokens = (t: string, v: Record<string, string>) =>
  t.replace(/\{\{(\w+)\}\}/g, (m, k: string) => v[k] ?? m);

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

export type FillReq = {
  model: string;
  intent: string;
  /** The slide's words as the drawer sees them. */
  words: string;
  yearGroup: string;
  /** Lesson context: topic and subject. */
  lesson: string;
};
export type Refusal = { path: string; reason: string };
/** One fill or repair call: system, user, schema -> the model's JSON (or undefined) and its cost. */
export type Filler = (r: {
  system: string;
  user: string;
  schema: J;
  attempt: number;
}) => Promise<{ out: unknown; usd: number }>;
export type FillResult =
  | { ok: true; params: J; attempts: number; usd: number; warnings: string[] }
  | { ok: false; refusals: Refusal[]; attempts: number; usd: number; params?: unknown };

/** schemaCheck on what the filler sent, then validate() on it with the model's defaults. */
export async function checkParams(
  id: string,
  out: unknown,
): Promise<{ params?: J; refusals: Refusal[]; warnings: string[] }> {
  const { models, kit } = await library();
  const m = models.get(id);
  if (!m) return { refusals: [{ path: "model", reason: `no model ${id}` }], warnings: [] };
  if (!out || typeof out !== "object" || Array.isArray(out))
    return { refusals: [{ path: "(all)", reason: "no params object" }], warnings: [] };
  const own = { ...(out as J) };
  for (const k of NOT_FILLED) delete own[k];
  const shape = kit.schemaCheck(fillSchema(m.params), own);
  if (shape.length) return { refusals: shape, warnings: [] };
  const params = kit.withDefaults(m.params, own);
  let v: ReturnType<LibModel["validate"]>;
  try {
    v = m.validate(params);
  } catch (e) {
    return {
      refusals: [{ path: "(all)", reason: `validate threw: ${String(e).slice(0, 160)}` }],
      warnings: [],
    };
  }
  return v.ok
    ? { params, refusals: [], warnings: v.warnings ?? [] }
    : { refusals: v.refusals, warnings: [] };
}

/** Fill, check, and one repair with the refusal reasons. */
export async function fillAndCheck(
  req: FillReq,
  filler: Filler,
  log: (e: object) => void = () => {},
): Promise<FillResult> {
  const { models } = await library();
  const m = models.get(req.model);
  if (!m || UNAVAILABLE[req.model]) {
    const reason = m
      ? `model ${req.model} is unavailable (${UNAVAILABLE[req.model]})`
      : `no model ${req.model}`;
    log({ ev: "lib-refused", model: req.model, reason });
    return { ok: false, refusals: [{ path: "model", reason }], attempts: 0, usd: 0 };
  }
  const schema = fillSchema(m.params);
  const system = libPrompt("lib-fill.txt").trim();
  const user = fillTokens(libPrompt("lib-fill-user.txt"), {
    model: `${m.meta.id} (${m.meta.name})`,
    lesson: req.lesson,
    year: req.yearGroup,
    intent: req.intent,
    words: req.words,
    schema: JSON.stringify(schema),
  }).trim();
  let usd = 0;
  let last: unknown;
  let refusals: Refusal[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const turn =
      attempt === 0
        ? user
        : `${user}\n\n${fillTokens(libPrompt("lib-repair-user.txt"), {
            params: JSON.stringify(last),
            refusals: refusals.map((r) => `${r.path}: ${r.reason}`).join("\n"),
          }).trim()}`;
    const r = await filler({ system, user: turn, schema, attempt });
    usd += r.usd;
    last = r.out;
    const c = await checkParams(req.model, r.out);
    log({
      ev: "lib-fill",
      model: req.model,
      attempt,
      usd: r.usd,
      ok: !!c.params,
      ...(c.params ? {} : { refusals: c.refusals, out: r.out }),
    });
    if (c.params)
      return { ok: true, params: c.params, attempts: attempt + 1, usd, warnings: c.warnings };
    refusals = c.refusals;
  }
  return { ok: false, refusals, attempts: 2, usd, params: last };
}

/* ------------------------------------------------------------------ the lab's diagram path */

export type LibAsk = {
  key: string;
  /** The slide asks pupils something (D30): the model must not show the answer. */
  question?: boolean;
  shows: string;
  words: string;
  yearGroup: string;
  spec?: unknown;
  lib?: { lesson: string; outDir?: string };
};
/** A rendered model: the final build as a PNG data URI, at its own aspect. */
export type Drawn = { src: string; aspect: number; alt?: string };
export type LibDeps = {
  filler: Filler;
  /** `step`: draw that build (0-based) instead of the final one (question slides). */
  render: (
    id: string,
    params: J,
    outDir?: string,
    step?: number,
  ) => Promise<Drawn & { warnings: string[] }>;
};
/** A model figure: drawn by the library, or the base4 kind to fall back to, or nothing (logged). */
export async function libDiagram(
  ask: LibAsk,
  deps: LibDeps,
  log: (e: object) => void,
): Promise<{ libDrawn?: Drawn & { model: string }; fallbackKind?: string; usd: number }> {
  const spec = (ask.spec ?? {}) as { model?: string; intent?: string; alt?: string };
  const id = String(spec.model ?? "");
  const r = await fillAndCheck(
    {
      model: id,
      intent: String(spec.intent ?? ask.shows),
      words: ask.words,
      yearGroup: ask.yearGroup,
      lesson: ask.lib?.lesson ?? "",
    },
    deps.filler,
    log,
  );
  const fallback = () => {
    const fallbackKind = BASE_KIND[id];
    log({ ev: "lib-fallback", key: ask.key, model: id, to: fallbackKind ?? "no figure" });
    return { ...(fallbackKind ? { fallbackKind } : {}), usd: r.usd };
  };
  if (!r.ok) {
    log({
      ev: "lib-fill-failed",
      key: ask.key,
      model: id,
      refusals: r.refusals,
      attempts: r.attempts,
    });
    return fallback();
  }
  // D30 (b): what the intent asks against what the model can draw (lib-meta.json `cannot`).
  const cannot = capabilityRefusals(id, String(spec.intent ?? ask.shows));
  if (cannot.length) {
    log({ ev: "lib-capability-refused", key: ask.key, model: id, refusals: cannot });
    return fallback();
  }
  // D30 (a): a question slide draws the model's last build before its answer, or no model.
  let step: number | undefined;
  if (ask.question) {
    step = await questionStep(id, r.params);
    log({ ev: "lib-question-step", key: ask.key, model: id, step: step ?? null });
    if (step === undefined) return fallback();
  }
  try {
    const out = ask.lib?.outDir
      ? `${ask.lib.outDir}/lib/${ask.key.replace(/[^\w.-]+/g, "_")}`
      : undefined;
    const d = await deps.render(id, r.params, out, step);
    if (out)
      writeFileSync(
        `${out}/params.json`,
        JSON.stringify({ model: id, intent: spec.intent, params: r.params, step }, null, 1),
      );
    log({
      ev: "lib-drawn",
      key: ask.key,
      model: id,
      attempts: r.attempts,
      aspect: d.aspect,
      warnings: d.warnings,
    });
    return {
      libDrawn: { src: d.src, aspect: d.aspect, alt: spec.alt ?? ask.shows, model: id },
      usd: r.usd,
    };
  } catch (e) {
    log({ ev: "lib-render-failed", key: ask.key, model: id, err: String(e).slice(0, 200) });
    return fallback();
  }
}

/* ------------------------------------------------------------------ D30: questions, capability */

type MetaEntry = { answerKeys: string[]; cannot: { what: string; when: string[] }[] };
let metaCache: Record<string, MetaEntry> | undefined;
/** Per-model data (ab/lib-meta.json): build keys that show the answer, and what a model cannot draw. */
export function libMeta(): Record<string, MetaEntry> {
  metaCache ??= JSON.parse(readFileSync(`${import.meta.dir}/lib-meta.json`, "utf8")).models;
  return metaCache as Record<string, MetaEntry>;
}
/** The things `intent` asks of model `id` that it cannot draw (empty: it can, as far as we know). */
export function capabilityRefusals(id: string, intent: string): Refusal[] {
  return (libMeta()[id]?.cannot ?? [])
    .filter((c) => c.when.some((w) => new RegExp(w, "i").test(intent)))
    .map((c) => ({ path: "intent", reason: `${id} cannot draw ${c.what}` }));
}
/** A slide that asks pupils something: a question template, or a question mark in its own words. */
export function isQuestionSlide(slide: Record<string, unknown> | undefined): boolean {
  if (!slide) return false;
  if (["hinge", "question-set", "practice", "quiz"].includes(String(slide.template))) return true;
  const { figure: _f, picture: _p, ...words } = slide;
  return JSON.stringify(words).includes("?");
}
/**
 * The build a question slide draws: the last of the model's own builds (builds(P).steps, keys as
 * the model names them) before the first that shows the answer (lib-meta.json answerKeys).
 * Undefined when there is no such build, the model has no build list, or no answer keys are known.
 */
export async function questionStep(id: string, params: J): Promise<number | undefined> {
  const keys = libMeta()[id]?.answerKeys;
  if (!keys?.length) return undefined;
  const { models, kit } = await library();
  const m = models.get(id) as
    | (LibModel & { builds?: (p: J) => { steps: { key: string }[] } })
    | undefined;
  if (!m?.builds) return undefined;
  let steps: { key: string }[];
  try {
    steps = m.builds(kit.withDefaults(m.params, params)).steps;
  } catch {
    return undefined;
  }
  const first = steps.findIndex((s) => keys.includes(s.key.split(":")[0] as string));
  if (first === 0) return undefined;
  return first < 0 ? undefined : first - 1;
}

/** Fill-call estimate for the ledger hold: luna, one attempt (diagram calls observed $0.0013 each). */
export const LIB_FILL_EST = 0.002;

/** The paid path: gpt-6-luna (the picture director's model) fills; the library engine draws. */
export async function lunaDeps(
  ledger: import("../services").Ledger,
  log: (e: object) => void,
): Promise<LibDeps> {
  const { chat, guarded } = await import("../services");
  const { renderModel } = await import("./librender");
  return {
    filler: async ({ system, user, schema, attempt }) => {
      const r = await guarded(
        ledger,
        `lib fill ${attempt}`,
        LIB_FILL_EST,
        () =>
          chat({
            model: "gpt-6-luna",
            effort: "low",
            system,
            user,
            schema,
            name: "params",
            strict: false,
          }),
        log,
      );
      if (r) ledger.add("lib", r.usd);
      return { out: r?.out, usd: r?.usd ?? 0 };
    },
    render: renderModel,
  };
}

if (import.meta.main) await writeLibPrompts();

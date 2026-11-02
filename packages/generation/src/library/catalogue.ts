/// <reference path="./assets.d.ts" />
/**
 * The writer's library catalogue (TEACH-247 part h, ADR 0035; ported from lab/bakeoff/ab/lib.ts at
 * lab/lib-next 8fbfb912). Every word the writer and the fill call read is the prompt-engineer's,
 * byte for byte from `words/lib-words/` (writer.json, lib-fill*.txt, lib-repair-user.txt); code
 * only places them: the menu line and the catalogue after base4's "Diagram kinds:" list, and a
 * `dg-model-full` def beside the full slot's kinds. Library models are full slides only.
 */
import { CURRICULUM, curriculumYear } from "../curriculum";
import type { WriterStage } from "../writer/schema";
import { MODEL_LOADERS } from "./models";
import type { J } from "./types";
import libMeta from "./words/lib-meta.json" with { type: "json" };
import fillSystem from "./words/lib-words/lib-fill.txt" with { type: "text" };
import fillUser from "./words/lib-words/lib-fill-user.txt" with { type: "text" };
import repairUser from "./words/lib-words/lib-repair-user.txt" with { type: "text" };
import writerWordsJson from "./words/lib-words/writer.json" with { type: "json" };

/** The prompt-engineer's writer wording (lib-words/writer.json). */
export type WriterWords = {
  menuLine: string;
  header: string;
  line: string;
  teaches?: Record<string, string>;
  fields?: Record<string, string>;
};
export const WRITER_WORDS = writerWordsJson as WriterWords;
export const LIB_PROMPTS = {
  fill: fillSystem as string,
  fillUser: fillUser as string,
  repairUser: repairUser as string,
};

/**
 * Registered models production does not ship, and why (the PR lists them). The shipped set is
 * `MODEL_LOADERS`: every model lab/library registers at 32dd891e (library round 2) that draws
 * outside a browser.
 */
export const EXCLUDED: Record<string, string> = {
  states_of_matter: "needs SVG transform lists (DOMPoint, baseVal) that only a layout engine has",
  river_real: "draws from 29 MB of river data loaded at run time (prepare), not bundled",
};

/** A model that fails its fill falls back to the drawer as this kind (the lab's BASE_KIND). */
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
/**
 * Models whose failure goes to a picture, never the drawer (TEACH-251 part ac): the drawer cannot
 * draw a real map (romans verify5 s4: two schema faults), and a Commons map of the place can. Every
 * library fallback counts (a map that marks nothing, a refused fill, a failed draw); the stage's
 * fallback then asks for a picture of what the model was to show.
 */
export const PICTURE_FALLBACK = new Set(["hist_map"]);
/** The drawer kind for a model with no base kind: a labelled drawing of the intent. */
export const FALLBACK_KIND = "labelled-diagram";

/** The years a writer stage covers (Reception sits with KS1). */
export const STAGE_YEARS: Record<WriterStage, string[]> = {
  KS1: ["Reception", "Y1", "Y2"],
  KS2: ["Y3", "Y4", "Y5", "Y6"],
  "KS3-5": ["KS3", "KS4", "KS5"],
};

export type CatalogueEntry = { id: string; teaches: string; years: string[] };

/**
 * Models kept for a lesson in any subject (flag `libraryMenuFilter`): general representations
 * (chronology, data, sorting, cycles) that any subject's lesson may draw on.
 */
export const GENERAL_MODELS = ["timeline", "data_chart", "sort_venn_carroll", "cycle_wheel"];

/** The lesson's year as the models' `meta.years` name it ("Year 5" -> Y5, Year 8 -> KS3). */
export function yearToken(yearGroup: string): string | undefined {
  if (/reception|\bEYFS\b/i.test(yearGroup)) return "Reception";
  const n = Number(/(\d+)/.exec(yearGroup)?.[1]);
  if (!Number.isFinite(n) || n < 1 || n > 13) return undefined;
  return n <= 6 ? `Y${n}` : n <= 9 ? "KS3" : n <= 11 ? "KS4" : "KS5";
}

/** The lesson's subject as the models' `meta.subjects` name it (undefined: no match known). */
export function subjectToken(subject: string): string[] | undefined {
  const s = subject.toLowerCase();
  if (/math/.test(s)) return ["Maths"];
  if (/science|biolog|chemist|physic/.test(s)) return ["Science"];
  if (/geograph/.test(s)) return ["Geography"];
  if (/histor/.test(s)) return ["History"];
  if (/\bre\b|religio/.test(s)) return ["RE"];
  if (/pshe|wellbeing|citizenship/.test(s)) return ["PSHE"];
  if (/\bpe\b|physical education|sport/.test(s)) return ["PE"];
  if (/comput/.test(s)) return ["Computing"];
  if (/music/.test(s)) return ["Music"];
  if (/design and tech|\bd ?& ?t\b/.test(s)) return ["Design and technology"];
  if (/\bart\b/.test(s)) return ["Art", "Art and design"];
  return undefined;
}

/**
 * The lesson a catalogue is filtered for (flag `libraryMenuFilter`); with `objectives` (flag
 * `libraryMenuRank`) the kept models are also ordered by relevance to them. With `topic`, a
 * subject the code cannot read is read from the topic and objectives instead (`inferSubjects`).
 */
export type MenuFilter = {
  yearGroup: string;
  subject: string;
  objectives?: string[];
  topic?: string;
};

const STOP = new Set(
  "a an and are as at be by can for from how in into is it its of on or that the their them they this to use using what when where which why with will pupils pupil learners children understand know identify describe explain recognise show work out find able".split(
    " ",
  ),
);
/** Content words, lower case, crudely stemmed (plural, -ing, -ed): the ranking's only text step. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.replace(/(?:ies)$/, "y").replace(/(?:ing|ed|es|s)$/, "") || raw);
  }
  return out;
}

/**
 * The catalogue ordered by relevance to the lesson's objectives (flag `libraryMenuRank`): each
 * model scores the objective content words found in its id, name and teaches line; higher first,
 * ties in gallery order. Deterministic; never drops a model.
 */
export function rankByObjectives<T extends { id: string; teaches: string; name?: string }>(
  entries: T[],
  objectives: string[],
): T[] {
  const want = contentWords(objectives.join(" "));
  const score = (e: T) => {
    const have = contentWords(`${e.id.replace(/_/g, " ")} ${e.name ?? ""} ${e.teaches}`);
    let n = 0;
    for (const w of want) if (have.has(w)) n++;
    return n;
  };
  return entries
    .map((e, i) => ({ e, i, s: score(e) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.e);
}

/** A word names a subject only when the year's vocabulary uses it for at most this many. */
export const TELLING_WORD_SUBJECTS = 2;
/** Fewer telling words than this in the whole lesson is too little to narrow the menu on. */
export const MIN_TELLING_WORDS = 2;

/**
 * The lesson's subjects as the models' `meta.subjects` name them, read from its topic and
 * objectives when the brief has no subject (TEACH-247 part cu: blank in 63 of 63 runs).
 * Deterministic, no model call. The vocabulary is the year's statutory curriculum statements plus
 * the teaches lines of the models for that year, each word tagged with the subjects that use it. A
 * lesson word is telling when at most `TELLING_WORD_SUBJECTS` subjects use it ("meander":
 * geography and science; "number" or "start": many, so neither counts). Every subject with a
 * telling word is kept, so a cross-curricular lesson keeps all of them and a subject is dropped
 * only when no word points at it. Undefined (filter nothing, as before) when the lesson has fewer
 * than `MIN_TELLING_WORDS` telling words. English and languages count for telling but are never
 * returned: no model carries them, and a teacher who picks them gets an unfiltered menu.
 */
export async function inferSubjects(lesson: {
  topic: string;
  objectives: readonly string[];
  yearGroup: string;
}): Promise<string[] | undefined> {
  const want = contentWords([lesson.topic, ...lesson.objectives].join(" "));
  if (want.size === 0) return undefined;
  const vocab = await subjectVocab(lesson.yearGroup);
  const hits = new Map<string, number>();
  let telling = 0;
  for (const w of want) {
    const subs = vocab.get(w);
    if (!subs || subs.size > TELLING_WORD_SUBJECTS) continue;
    telling++;
    for (const s of subs) hits.set(s, (hits.get(s) ?? 0) + 1);
  }
  if (telling < MIN_TELLING_WORDS) return undefined;
  const out = [...hits.keys()].filter((s) => !NO_MODEL_SUBJECTS.has(s));
  if (out.includes("Art")) out.push("Art and design");
  return out.length ? out : undefined;
}
/** Curriculum subjects no model carries: they make a word less telling, never a menu subject. */
const NO_MODEL_SUBJECTS = new Set(["English", "Languages"]);

const vocabByYear = new Map<string, Promise<Map<string, Set<string>>>>();
/** word -> subjects using it, for one year: its curriculum statements and its models' lines. */
function subjectVocab(yearGroup: string): Promise<Map<string, Set<string>>> {
  const year = yearToken(yearGroup) ?? "";
  const hit = vocabByYear.get(year);
  if (hit) return hit;
  const built = (async () => {
    const vocab = new Map<string, Set<string>>();
    const add = (text: string, subjects: readonly string[]) => {
      for (const w of contentWords(text)) {
        const v = vocab.get(w) ?? new Set<string>();
        for (const s of subjects) v.add(s);
        vocab.set(w, v);
      }
    };
    const n = curriculumYear(yearGroup);
    if (n !== undefined)
      for (const s of CURRICULUM) {
        if (n < s.years[0] || n > s.years[1]) continue;
        add(s.text, curriculumModelSubjects(s.subject));
      }
    const { loadModel } = await import("./render");
    for (const id of GALLERY_ORDER) {
      if (GENERAL_MODELS.includes(id)) continue;
      const m = await loadModel(id);
      if (!m?.meta.years.includes(year)) continue;
      add(`${id.replace(/_/g, " ")} ${m.meta.name} ${m.meta.teaches}`, modelSubjects(m.meta));
    }
    return vocab;
  })();
  vocabByYear.set(year, built);
  return built;
}
/** A curriculum subject as the models name it ("mathematics" -> Maths); English stays English. */
function curriculumModelSubjects(subject: string): string[] {
  if (/^english$/i.test(subject)) return ["English"];
  if (/^languages$/i.test(subject)) return ["Languages"];
  return foldArt(subjectToken(subject) ?? [subject]);
}
/** A model's subjects, art folded as below. */
function modelSubjects(meta: { subjects?: string[] }): string[] {
  return foldArt(meta.subjects ?? []);
}
/** "Art and design" folded into "Art", so the two names count as one subject. */
function foldArt(subjects: readonly string[]): string[] {
  return [...new Set(subjects.map((s) => (s === "Art and design" ? "Art" : s)))];
}

/**
 * Shipped models whose years meet the stage's, in the library's gallery order. With `filter`
 * (flag `libraryMenuFilter`, CROSSCHECK point 1): only models for the lesson's year, and for its
 * subject or general (`GENERAL_MODELS`). A year or subject the code cannot read filters nothing
 * on that axis. An empty list means no Models block, no model kind line and no model schema
 * branch (`libSystem` and `libSchema` add nothing for it).
 */
export async function catalogue(
  stage: WriterStage,
  filter?: MenuFilter,
): Promise<CatalogueEntry[]> {
  const { loadModel } = await import("./render");
  const want = STAGE_YEARS[stage];
  const year = filter && yearToken(filter.yearGroup);
  const subjects =
    filter &&
    (subjectToken(filter.subject) ??
      (filter.topic !== undefined && !filter.subject.trim()
        ? await inferSubjects({
            topic: filter.topic,
            objectives: filter.objectives ?? [],
            yearGroup: filter.yearGroup,
          })
        : undefined));
  const out: CatalogueEntry[] = [];
  const names = new Map<string, string>();
  for (const id of GALLERY_ORDER) {
    if (!MODEL_LOADERS[id]) continue;
    const m = await loadModel(id);
    if (!m?.meta.years.some((y) => want.includes(y))) continue;
    if (filter) {
      if (year && !m.meta.years.includes(year)) continue;
      const own = m.meta.subjects ?? [];
      if (subjects && !GENERAL_MODELS.includes(id) && !own.some((x) => subjects.includes(x)))
        continue;
    }
    out.push({ id, teaches: m.meta.teaches, years: m.meta.years });
    names.set(id, m.meta.name);
  }
  if (!filter?.objectives?.length) return out;
  return rankByObjectives(
    out.map((e) => ({ ...e, name: names.get(e.id) })),
    filter.objectives,
  ).map(({ name: _n, ...e }) => e);
}
/** lab/library/models/registry.js order (MODEL_LOADERS keeps it). */
const GALLERY_ORDER = Object.keys(MODEL_LOADERS);

const yearsText = (ys: string[]) =>
  ys.length > 2 ? `${ys[0]}-${ys[ys.length - 1]}` : ys.join(", ");
export function catalogueLines(entries: CatalogueEntry[], w: WriterWords = WRITER_WORDS) {
  return entries.map((e) =>
    w.line
      .replace("{id}", e.id)
      .replace("{teaches}", w.teaches?.[e.id] ?? e.teaches)
      .replace("{years}", yearsText(e.years)),
  );
}

/** base4's system text with the model menu line and the catalogue; nothing else changes. */
export function libSystem(base: string, entries: CatalogueEntry[], w = WRITER_WORDS): string {
  if (!entries.length) return base;
  const head = "\nDiagram kinds:\n";
  const at = base.indexOf(head);
  if (at < 0) throw new Error("no Diagram kinds list in base4's system text");
  let end = at + head.length;
  while (base.startsWith("- ", end)) end = base.indexOf("\n", end) + 1;
  const block = `${w.menuLine}\n\n${w.header}\n${catalogueLines(entries, w).join("\n")}\n`;
  return base.slice(0, end) + block + base.slice(end);
}

/** The writer schema with dg-model-full beside the full slot's kinds (the side slot keeps base4's). */
export function libSchema(base: J, ids: string[], w = WRITER_WORDS): J {
  if (!ids.length) return base;
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
  for (const slot of ["full"]) {
    const holder = defs[`diagram-${slot}`];
    if (!holder?.anyOf) throw new Error(`writer schema has no diagram-${slot} anyOf`);
    defs[`dg-model-${slot}`] = def;
    holder.anyOf.push({ $ref: `#/$defs/dg-model-${slot}` });
  }
  return s;
}

type MetaEntry = {
  answerKeys?: string[];
  cannot?: { what: string; when: string[] }[];
  /** Panels or steps beyond the slide's idea: off unless the intent names them (`libraryPanelsOff`). */
  optionalPanels?: { param: string; what: string; when: string[] }[];
};
/** Per-model data the code reads after the fill (lab ab/lib-meta.json; not prompt text). */
export const LIB_META = (libMeta as { models: Record<string, MetaEntry> }).models;

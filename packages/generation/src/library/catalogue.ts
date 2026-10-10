/// <reference path="./assets.d.ts" />
/**
 * The writer's library catalogue (TEACH-247 part h, ADR 0035; ported from lab/bakeoff/ab/lib.ts at
 * lab/lib-next 8fbfb912). Every word the writer and the fill call read is the prompt-engineer's,
 * byte for byte from `words/lib-words/` (writer.json, lib-fill*.txt, lib-repair-user.txt); code
 * only places them: the menu line and the catalogue after base4's "Diagram kinds:" list, and a
 * `dg-model-full` def beside the full slot's kinds. Library models are full slides only.
 */
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

/** The lesson a catalogue is filtered for (flag `libraryMenuFilter`). */
export type MenuFilter = { yearGroup: string; subject: string };

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
  const subjects = filter && subjectToken(filter.subject);
  const out: CatalogueEntry[] = [];
  for (const id of GALLERY_ORDER) {
    if (!MODEL_LOADERS[id]) continue;
    const m = await loadModel(id);
    if (!m?.meta.years.some((y) => want.includes(y))) continue;
    if (filter) {
      if (year && !m.meta.years.includes(year)) continue;
      const own = (m.meta as { subjects?: string[] }).subjects ?? [];
      if (subjects && !GENERAL_MODELS.includes(id) && !own.some((x) => subjects.includes(x)))
        continue;
    }
    out.push({ id, teaches: m.meta.teaches, years: m.meta.years });
  }
  return out;
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

/// <reference path="./assets.d.ts" />
/**
 * The writer's library catalogue (TEACH-247 part h, ADR 0035; ported from lab/bakeoff/ab/lib.ts at
 * lab/lib-next 8fbfb912). Every word the writer and the fill call read is the prompt-engineer's,
 * byte for byte from `words/lib-words/` (writer.json, lib-fill*.txt, lib-repair-user.txt); code
 * only places them: the menu line and the catalogue after base4's "Diagram kinds:" list, and a
 * `dg-model-{side,full}` def beside each slot's kinds.
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

/** Shipped models whose years meet the stage's, in the library's gallery order. */
export async function catalogue(stage: WriterStage): Promise<CatalogueEntry[]> {
  const { loadModel } = await import("./render");
  const want = STAGE_YEARS[stage];
  const out: CatalogueEntry[] = [];
  for (const id of GALLERY_ORDER) {
    if (!MODEL_LOADERS[id]) continue;
    const m = await loadModel(id);
    if (m?.meta.years.some((y) => want.includes(y)))
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

/** The writer schema with dg-model-side and dg-model-full beside the other kinds. */
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
  for (const slot of ["side", "full"]) {
    const holder = defs[`diagram-${slot}`];
    if (!holder?.anyOf) throw new Error(`writer schema has no diagram-${slot} anyOf`);
    defs[`dg-model-${slot}`] = def;
    holder.anyOf.push({ $ref: `#/$defs/dg-model-${slot}` });
  }
  return s;
}

type MetaEntry = { answerKeys: string[]; cannot: { what: string; when: string[] }[] };
/** Per-model data the code reads after the fill (lab ab/lib-meta.json; not prompt text). */
export const LIB_META = (libMeta as { models: Record<string, MetaEntry> }).models;

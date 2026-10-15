import b1 from "./bundles/pilot-v4.4/base-KS1.schema.json" with { type: "json" };
import b2 from "./bundles/pilot-v4.4/base-KS2.schema.json" with { type: "json" };
import b3 from "./bundles/pilot-v4.4/base-KS3.schema.json" with { type: "json" };
import l44 from "./bundles/pilot-v4.4/layouts.json" with { type: "json" };
import s1 from "./bundles/pilot-v4.4/system-KS1.txt" with { type: "text" };
import s2 from "./bundles/pilot-v4.4/system-KS2.txt" with { type: "text" };
import s3 from "./bundles/pilot-v4.4/system-KS3.txt" with { type: "text" };
import b51 from "./bundles/pilot-v4.5/base-KS1.schema.json" with { type: "json" };
import b52 from "./bundles/pilot-v4.5/base-KS2.schema.json" with { type: "json" };
import b53 from "./bundles/pilot-v4.5/base-KS3.schema.json" with { type: "json" };
import l45 from "./bundles/pilot-v4.5/layouts.json" with { type: "json" };
import s51 from "./bundles/pilot-v4.5/system-KS1.txt" with { type: "text" };
import s52 from "./bundles/pilot-v4.5/system-KS2.txt" with { type: "text" };
import s53 from "./bundles/pilot-v4.5/system-KS3.txt" with { type: "text" };
import b61 from "./bundles/pilot-v4.6/base-KS1.schema.json" with { type: "json" };
import b62 from "./bundles/pilot-v4.6/base-KS2.schema.json" with { type: "json" };
import b63 from "./bundles/pilot-v4.6/base-KS3.schema.json" with { type: "json" };
import l46 from "./bundles/pilot-v4.6/layouts.json" with { type: "json" };
import t61 from "./bundles/pilot-v4.6-menu/system-KS1.template.txt" with { type: "text" };
import t62 from "./bundles/pilot-v4.6-menu/system-KS2.template.txt" with { type: "text" };
import t63 from "./bundles/pilot-v4.6-menu/system-KS3.template.txt" with { type: "text" };
import { assembleWriterSystem } from "./layout-menu";

/*
 * The pilot writer pack (TEACH-110 part s): the menu and schema the prompt-engineer generates
 * (pilot/writer/MENU-v<n>.md, schema-v<n>.json) and the base schema and system text they were
 * written for, as byte-exact files. `pilotRequest` builds the writer's request the way the real
 * writer smokes did (smoke-real4/run.ts): base schema + library models + production's per-lesson
 * flow parts, the pack's flow shapes, its layouts spliced in and its retired layouts removed. No
 * words of the menu are written here; a new version is a new folder and one line below.
 */
type J = Record<string, any>;
type Ks = "KS1" | "KS2" | "KS3";
export type PilotPack = {
  id: string;
  layouts: {
    flowShapes: string[];
    retired: string[];
    stages: Record<string, { $defs: J }>;
    /** JSON pointers into the base schema and the node each one becomes (v4.5 on). */
    basePatches?: J;
  };
  base: Record<Ks, J>;
  system: Record<Ks, string>;
  /**
   * No string caps reach a model (v4.6 on): Sol's strict decoder obeys a `maxLength` by stopping
   * the string mid-word. Code checks the caps instead, from `capsFrom`'s request.
   */
  uncapped?: boolean;
  /** The pack whose request carries the caps code checks against (slot-fill's cap table). */
  capsFrom?: string;
};

export const PILOT_PACKS = {
  "v4.4": {
    id: "v4.4",
    layouts: l44 as PilotPack["layouts"],
    base: { KS1: b1, KS2: b2, KS3: b3 },
    system: { KS1: s1, KS2: s2, KS3: s3 },
  },
  // v4.5: answers count from 1 (the hinge writes its correct option first), a compact JSON and a
  // short flow before slide 1, set vs contrast by content (MENU-v4.5.md, build/HINGE-ANSWER.md).
  "v4.5": {
    id: "v4.5",
    layouts: l45 as PilotPack["layouts"],
    base: { KS1: b51, KS2: b52, KS3: b53 },
    system: { KS1: s51, KS2: s52, KS3: s53 },
  },
  // v4.6: no maxLength or pattern anywhere a model reads (writer and repairs); v4.5's prose,
  // budgets and charCaps byte for byte (MENU-v4.6.md). Bases arrive patched and stripped.
  "v4.6": {
    id: "v4.6",
    layouts: l46 as PilotPack["layouts"],
    base: { KS1: b61, KS2: b62, KS3: b63 },
    // The layouts' menu lines come from the menu constants (layout-menu.ts), whose numbers are
    // the measured capacity tables; the rest of the text is the pack's, byte for byte.
    system: {
      KS1: assembleWriterSystem(t61, "KS1"),
      KS2: assembleWriterSystem(t62, "KS2"),
      KS3: assembleWriterSystem(t63, "KS3-5"),
    },
    uncapped: true,
    capsFrom: "v4.5",
  },
} as const satisfies Record<string, PilotPack>;
export type PilotPackId = keyof typeof PILOT_PACKS;
/** The pack the pilot proof runs (TEACH-110 s makes it the default once u/v/w are on master). */
export const PILOT_PACK_ID: PilotPackId = "v4.6";

/**
 * A schema with no string length caps: `maxLength` dropped, a `pattern` (the `^.{1,N}$` caps)
 * becomes `minLength: 1`. Item counts, enums and integer bounds stay: they never cut a string.
 */
export function stripStringCaps<T>(node: T): T {
  if (Array.isArray(node)) return node.map(stripStringCaps) as T;
  if (!node || typeof node !== "object") return node;
  const out: J = {};
  for (const [k, v] of Object.entries(node as J)) {
    if (k === "maxLength") continue;
    if (k === "pattern" && typeof v === "string") {
      out.minLength = 1;
      continue;
    }
    out[k] = k === "$comment" ? v : stripStringCaps(v);
  }
  return out as T;
}

/** A pack's base patches: each JSON pointer's node replaced; a pointer that is not there throws. */
export function withPatches(base: J, patches: J | undefined): J {
  for (const [ptr, node] of Object.entries(patches ?? {})) {
    if (!ptr.startsWith("/")) continue; // "$comment"
    const keys = ptr
      .slice(1)
      .split("/")
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    const last = keys.pop() as string;
    const at = keys.reduce<J | undefined>((o, k) => o?.[k], base);
    if (!at || !(last in at)) throw new Error(`pilot pack: no ${ptr} in the base schema`);
    at[last] = structuredClone(node);
  }
  return base;
}

const ksOf = (stageKey: string): Ks =>
  stageKey === "KS1" || stageKey === "KS2" ? stageKey : "KS3";
const isLayout = (d: J) => typeof d?.properties?.template === "object";

/**
 * The writer's schema and system text from a pack. `prod` is production's schema for this lesson
 * (its flow length and `teaches` enum are per lesson); `withLibrary` adds the library models as
 * production does (`libSchema`).
 */
export function pilotRequest(
  id: PilotPackId,
  stageKey: string,
  prod: J,
  withLibrary: (schema: J) => J,
): { schema: J; system: string; caps?: J } {
  const pack: PilotPack = PILOT_PACKS[id];
  const ks = ksOf(stageKey);
  const schema = structuredClone(
    withLibrary(withPatches(structuredClone(pack.base[ks]), pack.layouts.basePatches)),
  ) as J;
  const fp = schema.properties.flow;
  const pf = prod.properties?.flow;
  if (pf) {
    fp.minItems = pf.minItems;
    fp.maxItems = pf.maxItems;
    fp.items.properties.teaches = pf.items.properties.teaches;
  }
  fp.items.properties.shape.enum = [...pack.layouts.flowShapes];
  const defs = pack.layouts.stages[ks === "KS3" ? "KS3-5" : ks]?.$defs ?? {};
  const refs = schema.properties.slides.items.anyOf as J[];
  for (const [k, d] of Object.entries(defs)) {
    schema.$defs[k] = d;
    // Shared defs (the icon names) are referenced by the layouts, never offered as a slide.
    if (isLayout(d) && !refs.some((r) => r.$ref === `#/$defs/${k}`))
      refs.push({ $ref: `#/$defs/${k}` });
  }
  const gone = (k: string) => pack.layouts.retired.includes(k.split("~")[0] as string);
  for (const k of Object.keys(schema.$defs)) if (gone(k)) delete schema.$defs[k];
  schema.properties.slides.items.anyOf = refs.filter(
    (r) => !gone(String(r.$ref).split("/").pop() ?? ""),
  );
  if (pack.uncapped) {
    // The library models are added from production's schema, which still caps its strings.
    const caps = pack.capsFrom
      ? pilotRequest(pack.capsFrom as PilotPackId, stageKey, prod, withLibrary).schema
      : undefined;
    return { schema: stripStringCaps(schema), system: pack.system[ks], ...(caps ? { caps } : {}) };
  }
  return { schema, system: pack.system[ks] };
}

/**
 * The fit repair's schema for one pilot slide: the repair's own envelope (`fix`, `slide`,
 * `to_notes`) with `slide` fixed to the layout, and only the defs that layout reaches (its pictures,
 * diagrams, icon names). Every other layout's def stays out, so the call is small.
 */
export function pilotRepairSchema(repair: J, writer: J, template: string): J {
  const out = structuredClone(repair) as J;
  const pool: J = { ...(out.$defs ?? {}), ...(writer.$defs ?? {}) };
  out.properties.slide = { anyOf: [{ $ref: `#/$defs/${template}` }] };
  const keep: J = {};
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as J)) {
      if (k === "$ref" && typeof v === "string") {
        const name = v.replace("#/$defs/", "");
        if (!keep[name] && pool[name]) {
          keep[name] = pool[name];
          walk(pool[name]);
        }
      } else walk(v);
    }
  };
  walk(out.properties);
  out.$defs = keep;
  // A capped repair would cut its own fix, as the writer's decoder did.
  return stripStringCaps(out);
}

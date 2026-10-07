// R2 (D11 / RADICAL.md §R2, 7 Oct): the writer writes a structured diagram's spec; code draws it with
// no drawer call; a spec that does not parse or fit goes to the existing drawer call as its request.
// The per-kind spec defs come from the drawer's own schema (`drawerJsonSchema`, the one source of
// truth), in strict form, with the main list and count fields capped at SLOT_LIMITS for the slot
// the template gives (side beside text, full across the slide). Freeform kinds keep {kind, shows, labels}.
// bun lab/bakeoff/ab/r2.ts  -> writes ab/prompts/b3-r2/T/schema.<stage>.json from base3's.
import { readFileSync, writeFileSync } from "node:fs";
import {
  DIAGRAM_KINDS,
  drawerJsonSchema,
  dropNulls,
  MEANING_SCHEMAS,
  meaningFaults,
  mendSpec,
  openaiSchemaFaults,
  parseDiagram,
  strictForm,
  withLongLabels,
} from "../../../packages/slides/src/diagrams/index";
import {
  type DiagramSlot,
  SLOT_LIMITS,
  type StageGroup,
} from "../../../packages/slides/src/diagrams/limits";
import {
  capDrawerSchema,
  type DiagramAsk,
  diagramFaultOf,
  MAIN_LIST,
  slotFault,
} from "../services";
import { AB, STAGES } from "./arms";

/** RADICAL §R2: the structured kinds the writer specs itself. */
export const R2_KINDS = [
  "bar-model",
  "number-line",
  "line-graph",
  "bar-chart",
  "pie",
  "table",
  "flow",
  "cycle",
  "timeline",
  "layers",
  "venn",
  "carroll",
  "equal-groups",
  "fraction-shapes",
] as const;
/** Kinds that stay `{kind, shows, labels}` and go through the drawer (coordinates, particles, ...). */
export const R2_FREEFORM = DIAGRAM_KINDS.filter(
  (k) => !(R2_KINDS as readonly string[]).includes(k),
);

type J = Record<string, unknown>;
const unwrap = (n: unknown): J | undefined => {
  const o = n as J | undefined;
  if (!o) return undefined;
  if (Array.isArray(o.anyOf)) return (o.anyOf as J[]).find((x) => x.type && x.type !== "null");
  return o;
};

/**
 * One kind's writer def in one slot at one stage: the drawer's strict schema, the main list and count
 * fields capped at the slot's measured count (capDrawerSchema with no request labels), the title null,
 * plus `shows` (what the drawing is for, the alt and the fallback request). Undefined when the slot
 * holds none of this kind (KS1 side carroll) or its minimum is over the slot's count.
 */
export function r2Def(kind: string, stage: StageGroup, slot: DiagramSlot): J | undefined {
  const lim = SLOT_LIMITS.limits[stage][slot][kind];
  if (lim && lim.items <= 0) return undefined;
  const { $schema: _d, ...open } = drawerJsonSchema(kind as never);
  const strict = strictForm(open) as J;
  const field = MAIN_LIST[kind];
  const before = field ? unwrap((strict.properties as J)[field]) : undefined;
  const origMax = before?.maxItems as number | undefined;
  const out = capDrawerSchema(strict, kind, lim?.items, 0);
  const props = out.properties as J;
  const list = field ? unwrap(props[field]) : undefined;
  // capDrawerSchema reads 0 requested labels as "no notes" for a line graph; here the cap is the slot's.
  if (kind === "line-graph" && list && lim)
    list.maxItems = Math.min(origMax ?? lim.items, lim.items);
  if (list && lim && ((list.minItems as number | undefined) ?? 0) > lim.items) return undefined;
  if (lim?.chars && list) {
    const note = `each label at most ${lim.chars} characters in this slot`;
    list.description = list.description ? `${list.description}; ${note}` : note;
  }
  const { kind: k, ...rest } = props;
  out.properties = {
    kind: k,
    shows: { type: "string", description: "what the drawing is for, in a sentence" },
    ...rest,
  };
  out.required = Object.keys(out.properties as J);
  return out;
}

/** The writer's freeform diagram def: round 5's shape on the kinds code does not draw from a spec. */
const freeform = (kinds: readonly string[]): J => ({
  type: "object",
  additionalProperties: false,
  required: ["kind", "shows", "labels"],
  properties: {
    kind: { type: "string", enum: [...kinds] },
    shows: { type: "string" },
    labels: { type: "array", items: { type: "string" } },
  },
});

/**
 * base3's writer schema with its diagram def replaced: `diagram-side` and `diagram-full` are anyOf
 * the per-kind spec defs for that slot plus the freeform def. A big-visual figure takes the full defs;
 * every other diagram (visual-text, steps' figure, equation-hero) the side defs.
 * `menu` is the writer menu's own kinds; R2's kinds are added (equal-groups, fraction-shapes).
 */
export function r2WriterSchema(base: J, stage: StageGroup): J {
  const s = JSON.parse(JSON.stringify(base)) as J;
  const defs = s.$defs as J;
  const old = defs.diagram as { properties: { kind: { enum: string[] } } };
  const menu = old.properties.kind.enum;
  const free = menu.filter((k) => !(R2_KINDS as readonly string[]).includes(k));
  for (const slot of ["side", "full"] as const) {
    const any: J[] = [];
    for (const k of R2_KINDS) {
      const d = r2Def(k, stage, slot);
      if (!d) continue;
      defs[`dg-${k}-${slot}`] = d;
      any.push({ $ref: `#/$defs/dg-${k}-${slot}` });
    }
    any.push({ $ref: "#/$defs/diagram-freeform" });
    defs[`diagram-${slot}`] = { anyOf: any };
  }
  defs["diagram-freeform"] = freeform(free);
  delete defs.diagram;
  // Re-point every reference: inside big-visual to the full defs, elsewhere to the side defs.
  const repoint = (n: unknown, to: string): unknown => {
    if (Array.isArray(n)) return n.map((x) => repoint(x, to));
    if (!n || typeof n !== "object") return n;
    const o: J = {};
    for (const [k, v] of Object.entries(n as J))
      o[k] = k === "$ref" && v === "#/$defs/diagram" ? `#/$defs/diagram-${to}` : repoint(v, to);
    return o;
  };
  for (const [name, d] of Object.entries(defs))
    if (!name.startsWith("dg-") && !name.startsWith("diagram-"))
      defs[name] = repoint(d, name === "big-visual" ? "full" : "side");
  s.properties = repoint(s.properties, "side");
  return s;
}

/** The writer's spec on a diagram figure, or undefined for a freeform `{kind, shows, labels}` figure. */
export function writerSpecOf(f: J): J | undefined {
  if (!(R2_KINDS as readonly string[]).includes(String(f.kind))) return undefined;
  if (
    Array.isArray(f.labels) &&
    Object.keys(f).every((k) => ["kind", "shows", "labels"].includes(k))
  )
    return undefined;
  const { shows: _s, ...spec } = f;
  return spec;
}

/** A spec's words, as the labels a drawer fallback, the checks and the slide's words read. */
export function labelsOf(spec: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key = "") => {
    // Numbers are words too (a bar-model whole, a number line's marks); link indices are not.
    if (typeof v === "number" && !["from", "to", "in"].includes(key)) out.push(String(v));
    else if (typeof v === "string") {
      if (!["kind", "alt", "shows", "style", "unknown", "show_count"].includes(key) && v.trim())
        out.push(v.trim());
    } else if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v as J)) if (k !== "alt") walk(x, k);
  };
  walk(spec);
  return [...new Set(out)];
}

/**
 * The writer's spec checked the way the drawer's output is (services.ts specCalls): nulls dropped,
 * a meaning-form spec checked as sent, mended, parsed, and drawn in its own slot. Returns the spec to
 * draw, or the fault that sends it to the drawer. Never throws.
 */
export function acceptWriterSpec(
  spec: unknown,
  ask: DiagramAsk,
): { spec?: unknown; fault: string } {
  try {
    const sent = dropNulls(spec);
    const meaning =
      typeof (sent as J)?.kind === "string" && ((sent as J).kind as string) in MEANING_SCHEMAS;
    const out = mendSpec(sent);
    const fault =
      meaningFaults(meaning ? sent : out) ||
      diagramFaultOf(out, (o) => withLongLabels(() => parseDiagram(o))) ||
      slotFault(out, ask);
    return fault ? { fault } : { spec: out, fault: "" };
  } catch (e) {
    return { fault: `it does not draw: ${String(e).slice(0, 120)}` };
  }
}

/** Strict-mode size and nesting facts for a writer schema (the $0 dry run). */
export function schemaFacts(schema: J) {
  const defs = (schema.$defs ?? {}) as J;
  let props = 0;
  let enums = 0;
  let strChars = 0;
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const o = n as J;
    if (o.properties && typeof o.properties === "object") {
      props += Object.keys(o.properties as J).length;
      strChars += Object.keys(o.properties as J).join("").length;
    }
    if (Array.isArray(o.enum)) {
      enums += o.enum.length;
      strChars += o.enum.map(String).join("").length;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(schema);
  // Object nesting depth with $refs expanded (OpenAI strict: at most 10 levels).
  const depth = (n: unknown, seen: string[] = []): number => {
    if (Array.isArray(n)) return Math.max(0, ...n.map((x) => depth(x, seen)));
    if (!n || typeof n !== "object") return 0;
    const o = n as J;
    if (typeof o.$ref === "string") {
      const name = o.$ref.replace("#/$defs/", "");
      if (seen.includes(name)) return 0;
      return depth(defs[name], [...seen, name]);
    }
    const here = o.type === "object" ? 1 : 0;
    let m = 0;
    for (const [k, v] of Object.entries(o)) if (k !== "$defs") m = Math.max(m, depth(v, seen));
    return here + m;
  };
  return {
    bytes: JSON.stringify(schema).length,
    defs: Object.keys(defs).length,
    properties: props,
    enumValues: enums,
    nameAndEnumChars: strChars,
    depth: depth(schema),
    strictFaults: openaiSchemaFaults(schema, true),
  };
}

if (import.meta.main) {
  for (const st of STAGES) {
    const base = JSON.parse(readFileSync(`${AB}/prompts/base3/T/schema.${st}.json`, "utf8")) as J;
    const out = r2WriterSchema(base, st);
    writeFileSync(`${AB}/prompts/b3-r2/T/schema.${st}.json`, `${JSON.stringify(out, null, 1)}\n`);
    console.log(st, JSON.stringify(schemaFacts(out)), "base3", schemaFacts(base).bytes);
  }
}

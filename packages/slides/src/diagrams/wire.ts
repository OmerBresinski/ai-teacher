/**
 * r5: the diagram spec on the wire, derived from the drawer's own schema (`DiagramSpecSchema`), the
 * one source of truth. Round 4 broke every particles spec because production kept a hand mirror and
 * the lab sent the drawer's schema with a tuple in it; nothing here is typed out twice.
 *
 * - `DiagramWireSchema`: the drawer's schema with text limits stated, not enforced (each string says
 *   "at most N characters"), and cross-field refinements left to the drawer's parse. A writer call
 *   never fails on a long label; the drawer's parse decides whether the drawing is drawn.
 * - `diagramJsonSchema(kind?)`: that schema as the JSON schema a provider is sent.
 * - `openaiSchemaFaults(json)`: what OpenAI's structured outputs refuse in a JSON schema.
 * - `strictForm(json)`: a JSON schema in the shape OpenAI's strict mode needs.
 */
import { z } from "zod";
import { MEANING_SCHEMAS } from "./meaning";
import { type DiagramKind, DiagramSpecSchema } from "./schema";

type Def = Record<string, unknown> & { type: string; checks?: unknown[] };
type Any = z.ZodType & { _zod: { def: Def }; clone: (def?: Def) => z.ZodType };
const checkName = (c: unknown) => (c as { _zod?: { def?: { check?: string } } })._zod?.def?.check;
const checkMax = (c: unknown) =>
  (c as { _zod?: { def?: { maximum?: number } } })._zod?.def?.maximum;

function withMeta(from: z.ZodType, to: z.ZodType, extra?: string): z.ZodType {
  const meta = z.globalRegistry.get(from) as { description?: string } | undefined;
  const description = [extra, meta?.description].filter(Boolean).join("; ");
  return meta || extra ? to.meta({ ...meta, ...(description ? { description } : {}) }) : to;
}

/** `schema` with string lengths stated in its description and object refinements dropped. */
export function relaxed(schema: z.ZodType): z.ZodType {
  const s = schema as Any;
  const def = s._zod.def;
  switch (def.type) {
    case "string": {
      const checks = (def.checks ?? []) as unknown[];
      const max = checks.map(checkMax).find((m) => typeof m === "number");
      const kept = checks.filter((c) => !["max_length", "min_length"].includes(checkName(c) ?? ""));
      return withMeta(
        schema,
        s.clone({ ...def, checks: kept }),
        max ? `at most ${max} characters` : undefined,
      );
    }
    case "object": {
      const shape = def.shape as Record<string, z.ZodType>;
      const out: Record<string, z.ZodType> = {};
      for (const [k, v] of Object.entries(shape)) out[k] = relaxed(v);
      return withMeta(schema, s.clone({ ...def, shape: out, checks: [] }));
    }
    case "array":
      return withMeta(schema, s.clone({ ...def, element: relaxed(def.element as z.ZodType) }));
    case "default":
    case "prefault":
      // Defaults are the drawer's: on the wire the field is optional, and the drawer's parse fills it.
      return withMeta(schema, relaxed(def.innerType as z.ZodType).optional());
    case "optional":
    case "nullable":
    case "readonly":
    case "nonoptional":
      return withMeta(schema, s.clone({ ...def, innerType: relaxed(def.innerType as z.ZodType) }));
    case "union":
      return withMeta(
        schema,
        s.clone({ ...def, options: (def.options as z.ZodType[]).map(relaxed) }),
      );
    default:
      return schema;
  }
}

/** The diagram spec a writer is held to on the wire (see the file comment). */
export const DiagramWireSchema = relaxed(DiagramSpecSchema) as unknown as typeof DiagramSpecSchema;

/** One kind's wire schema. */
export function diagramWireSchema(kind: DiagramKind): z.ZodType {
  const opts = (DiagramWireSchema as unknown as { options: z.ZodType[] }).options;
  const found = opts.find(
    (o) => (o as unknown as { shape: { kind: { value: string } } }).shape.kind.value === kind,
  );
  if (!found) throw new Error(`no diagram kind ${kind}`);
  return found;
}

/**
 * The JSON schema a provider is sent for one kind (or the whole union): draft-7, a discriminated
 * union as `anyOf` with `enum` tags (OpenAI reads `anyOf`, not `oneOf`).
 */
export function diagramJsonSchema(kind?: DiagramKind): Record<string, unknown> {
  const schema = kind ? diagramWireSchema(kind) : DiagramWireSchema;
  return openaiForm(
    z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any", io: "input" }),
  ) as Record<string, unknown>;
}

/**
 * Round 8: the JSON schema the lab's drawer model is sent for one kind: its meaning form
 * (meaning.ts) where one exists, else the drawn form; limits stated, refinements left to the parse.
 * Production's writer keeps `diagramJsonSchema` until the round is cut.
 */
export function drawerJsonSchema(kind: DiagramKind): Record<string, unknown> {
  const meaning = MEANING_SCHEMAS[kind as keyof typeof MEANING_SCHEMAS];
  if (!meaning) return diagramJsonSchema(kind);
  return openaiForm(
    z.toJSONSchema(relaxed(meaning), { target: "draft-7", unrepresentable: "any", io: "input" }),
  ) as Record<string, unknown>;
}

/** `oneOf` read as `anyOf` and `const` as a one-value `enum`, as production's wire does. */
export function openaiForm(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(openaiForm);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "oneOf") out.anyOf = openaiForm(v);
    else if (k === "const") out.enum = [v];
    else out[k] = openaiForm(v);
  }
  return out;
}

const REFUSED = [
  "prefixItems",
  "additionalItems",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
  "propertyNames",
  "unevaluatedProperties",
  "contains",
];
const SCHEMA_KEYS = ["type", "anyOf", "oneOf", "enum", "const", "$ref"];

/**
 * What OpenAI's structured outputs refuse or cannot use, as `path: reason` (empty when it is safe).
 * `strict` also asks what strict mode needs: every object closed, every property required.
 */
export function openaiSchemaFaults(json: unknown, strict = false): string[] {
  const faults: string[] = [];
  const walk = (n: unknown, path: string, isSchema: boolean) => {
    if (Array.isArray(n)) {
      n.forEach((x, i) => {
        walk(x, `${path}[${i}]`, isSchema);
      });
      return;
    }
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (isSchema) {
      if (Array.isArray(o.items)) faults.push(`${path}: a tuple (items is a list)`);
      for (const k of REFUSED) if (k in o) faults.push(`${path}: ${k}`);
      if (!SCHEMA_KEYS.some((k) => k in o)) faults.push(`${path}: a schema with no type`);
      if (strict && "default" in o) faults.push(`${path}: default`);
      if (strict && o.type === "object") {
        if (o.additionalProperties !== false) faults.push(`${path}: an open object`);
        const props = Object.keys((o.properties as object) ?? {});
        const req = new Set((o.required as string[]) ?? []);
        const missing = props.filter((p) => !req.has(p));
        if (missing.length) faults.push(`${path}: optional ${missing.join(", ")}`);
      }
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === "properties" || k === "definitions" || k === "$defs") {
        for (const [pk, pv] of Object.entries((v as Record<string, unknown>) ?? {}))
          walk(pv, `${path}.${pk}`, true);
      } else if (k === "items" || k === "additionalProperties") {
        if (v && typeof v === "object") walk(v, `${path}[]`, true);
      } else if (k === "anyOf" || k === "oneOf") walk(v, path, true);
    }
  };
  walk(json, "", true);
  return faults;
}

/**
 * `json` in the form OpenAI's strict mode takes: every object closed with every property required,
 * a property that was optional made nullable (the writer sends null; `dropNulls` removes them
 * before the parse), and no `default`.
 */
export function strictForm(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(strictForm);
  if (!json || typeof json !== "object") return json;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>))
    if (k !== "default") o[k] = strictForm(v);
  if (o.type === "object" && o.properties) {
    const props = o.properties as Record<string, unknown>;
    const req = new Set((o.required as string[]) ?? []);
    for (const [k, v] of Object.entries(props))
      if (!req.has(k)) props[k] = { anyOf: [v, { type: "null" }] };
    o.required = Object.keys(props);
    o.additionalProperties = false;
  }
  return o;
}

/** A strict-mode answer with its nulls taken out, so optional fields read as absent. */
export function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (!v || typeof v !== "object") return v;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>))
    if (x !== null) o[k] = dropNulls(x);
  return o;
}

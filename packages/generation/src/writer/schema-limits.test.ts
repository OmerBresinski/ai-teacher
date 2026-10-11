import { describe, expect, test } from "bun:test";
import { libSchema } from "../library/catalogue";
import { withActivities } from "./activities";
import { type WriterBundleId, writerBundle } from "./bundle";
import { type WriterStage, writerSchema } from "./schema";
import { withSlotFill } from "./slot-fill";

/*
 * The writer's strict schema against OpenAI's Structured Outputs limits, with no call made.
 * Source: https://developers.openai.com/api/docs/guides/structured-outputs ("Supported schemas"),
 * read 11 Oct 2026:
 * - "A schema may have up to 5000 object properties total, with up to 10 levels of nesting."
 * - "total string length of all property names, definition names, enum values, and const values
 *   cannot exceed 120,000 characters."
 * - "A schema may have up to 1000 enum values across all enum properties."
 * - a single string enum with more than 250 values: "the total string length of all enum values
 *   cannot exceed 15,000 characters".
 * - "additionalProperties: false must always be set in objects"; "all fields ... must be
 *   specified as required".
 * The page lists `pattern` and `format` as the supported string keywords and `maxLength` among
 * those unsupported only for fine-tuned models; slot-fill round 1 (lab/slotfill) saw Sol cut a
 * string at its `maxLength` cap, so the base model enforces it. The live run confirms acceptance.
 */
const LIMITS = {
  properties: 5000,
  nesting: 10,
  names: 120_000,
  enumValues: 1000,
  bigEnum: { values: 250, chars: 15_000 },
} as const;

type J = Record<string, unknown>;
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
/** The schema as the stage sends it: library models, activities, then slot-fill when on. */
function sent(id: WriterBundleId, st: WriterStage, slides = { min: 13, max: 20 }): J {
  const b = writerBundle(id);
  const base = libSchema(writerSchema(st, slides, b, { objectives: 4 }), LIBRARY_IDS);
  const acts = withActivities(base, st);
  return b.features?.slotFill ? withSlotFill(acts, st) : acts;
}
/** A long library menu, so the enum count is measured at its widest. */
const LIBRARY_IDS = Array.from({ length: 40 }, (_, i) => `library_model_${i}`);

function measure(schema: J) {
  const defs = (schema.$defs ?? {}) as Record<string, J>;
  let properties = 0;
  let names = Object.keys(defs).reduce((n, k) => n + k.length, 0);
  let enumValues = 0;
  const bigEnums: number[] = [];
  const open: string[] = [];
  const visit = (x: unknown, path: string) => {
    if (!x || typeof x !== "object") return;
    const s = x as J;
    if (s.type === "object" || s.properties) {
      const props = (s.properties ?? {}) as J;
      const keys = Object.keys(props);
      properties += keys.length;
      names += keys.reduce((n, k) => n + k.length, 0);
      if (s.additionalProperties !== false) open.push(`${path}: additionalProperties`);
      const req = new Set((s.required ?? []) as string[]);
      for (const k of keys) if (!req.has(k)) open.push(`${path}.${k}: not required`);
      for (const [k, v] of Object.entries(props)) visit(v, `${path}.${k}`);
    }
    if (Array.isArray(s.enum)) {
      enumValues += s.enum.length;
      const chars = s.enum.reduce((n: number, v) => n + String(v).length, 0);
      names += chars;
      if (s.enum.length > LIMITS.bigEnum.values) bigEnums.push(chars);
    }
    if (s.const !== undefined) names += String(s.const).length;
    if (s.items) visit(s.items, `${path}[]`);
    if (Array.isArray(s.anyOf)) for (const b of s.anyOf) visit(b, path);
  };
  visit({ ...schema, $defs: undefined }, "$");
  for (const [k, d] of Object.entries(defs)) visit(d, `$defs.${k}`);
  // Nesting: object levels along any path from the root, through $refs (a cycle would be infinite).
  const depth = (x: unknown, seen: string[]): number => {
    if (!x || typeof x !== "object") return 0;
    const s = x as J;
    if (typeof s.$ref === "string") {
      const n = s.$ref.replace("#/$defs/", "");
      if (seen.includes(n)) throw new Error(`recursive $ref ${n}`);
      return depth(defs[n], [...seen, n]);
    }
    const kids = [
      ...Object.values((s.properties ?? {}) as J),
      ...(s.items ? [s.items] : []),
      ...((s.anyOf ?? []) as unknown[]),
    ];
    const below = Math.max(0, ...kids.map((k) => depth(k, seen)));
    return (s.properties ? 1 : 0) + below;
  };
  return { properties, names, enumValues, bigEnums, open, nesting: depth(schema, []) };
}

describe.each(["base4f-p123", "base4g"] as const)(
  "writer schema %s within OpenAI's limits",
  (id) => {
    test.each(STAGES)("%s", (st) => {
      const m = measure(sent(id, st));
      expect(m.properties).toBeLessThanOrEqual(LIMITS.properties);
      expect(m.nesting).toBeLessThanOrEqual(LIMITS.nesting);
      expect(m.names).toBeLessThanOrEqual(LIMITS.names);
      expect(m.enumValues).toBeLessThanOrEqual(LIMITS.enumValues);
      for (const chars of m.bigEnums) expect(chars).toBeLessThanOrEqual(LIMITS.bigEnum.chars);
      expect(m.open).toEqual([]);
    });
  },
);

describe("base4g's slot-fill slots", () => {
  /** Picture and diagram briefs are read by code and other calls, not shown as slide text. */
  const BRIEF = new Set(["shows", "must_see", "subject", "fit", "template"]);
  test.each(STAGES)("%s: every on-slide string slot in a fit def carries maxLength", (st) => {
    const s = sent("base4g", st);
    const uncapped: string[] = [];
    const walk = (x: unknown, path: string) => {
      if (!x || typeof x !== "object") return;
      const v = x as J;
      if (v.type === "string" && !v.enum && typeof v.maxLength !== "number") uncapped.push(path);
      for (const [k, p] of Object.entries((v.properties ?? {}) as J))
        if (!BRIEF.has(k)) walk(p, `${path}.${k}`);
      if (v.items) walk(v.items, `${path}[]`);
      if (Array.isArray(v.anyOf)) for (const b of v.anyOf) walk(b, path);
    };
    const defs = Object.entries(s.$defs as Record<string, J>).filter(([n]) => n.includes("~"));
    expect(defs.length).toBeGreaterThan(20);
    for (const [n, d] of defs) walk(d, n);
    expect(uncapped).toEqual([]);
  });
});

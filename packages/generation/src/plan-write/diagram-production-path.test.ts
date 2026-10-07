import { describe, expect, test } from "bun:test";
import {
  DIAGRAM_SAMPLES,
  type DiagramKind,
  DIAGRAM_KINDS as DRAWER_KINDS,
  diagramJsonSchema,
  drawDiagram,
  openaiSchemaFaults,
  parseDiagram,
  readabilityFaults,
  strictForm,
  TEMPLATE_SPECS,
  withLongLabels,
} from "@tj/slides/diagrams";
import { getTheme, withKeyStage } from "@tj/slides/themes";
import Ajv from "ajv";
import { z } from "zod";
import { DIAGRAM_KINDS, DiagramSpecSchema, DrawerSpecSchema } from "./diagram-spec";
import LESSONS from "./fixtures/diagram-lesson-specs.json";

/*
 * r5: every diagram kind through the exact production path. Round 4 lost every particles spec to a
 * schema the drawer never saw (a hand mirror, and a tuple OpenAI refused with a 400); the drawer's
 * own tests stayed green. Here a model-style JSON spec goes: the JSON schema the provider is sent,
 * the wire schema the answer is validated with, the drawer's parse (labels a little long allowed),
 * then drawDiagram in a real zone at the lesson's key stage, then the readability checks again.
 *
 * Specs: the realistic menu samples and templates of every kind at every key stage, and the specs
 * written for real lessons (y5, y7, y9, y10, y11; bake-off rounds 2 to 4) at their own key stage.
 */

const KS = ["ks1", "ks2", "ks3", "ks4", "ks5"] as const;
const ZONES = { side: { w: 348, h: 284 }, full: { w: 788, h: 235 } };
const theme = getTheme("studio");
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
const validatorFor = (kind: DiagramKind) => {
  let v = validators.get(kind);
  if (!v) {
    v = ajv.compile(diagramJsonSchema(kind));
    validators.set(kind, v);
  }
  return v;
};

type Case = { name: string; ks: string; spec: Record<string, unknown>; refused?: string };
const menu = Object.entries({ ...DIAGRAM_SAMPLES, ...TEMPLATE_SPECS }) as [
  string,
  Record<string, unknown>,
][];
const CASES: Case[] = [
  ...KS.flatMap((ks) => menu.map(([name, spec]) => ({ name: `menu ${name}`, ks, spec }))),
  ...(LESSONS as Case[]),
];

/** The production path for one spec; the zone it drew in, or why it did not. */
function produce(c: Case): { zone?: string; fault?: string } {
  const json = JSON.parse(JSON.stringify(c.spec));
  const kind = json.kind as DiagramKind;
  if (!DRAWER_KINDS.includes(kind)) return { fault: `unknown kind ${kind}` };
  const v = validatorFor(kind);
  if (!v(json)) return { fault: `JSON schema: ${ajv.errorsText(v.errors)}` };
  const wire = DiagramSpecSchema.safeParse(json);
  if (!wire.success) return { fault: `wire: ${wire.error.issues[0]?.message}` };
  const parsed = withLongLabels(() => parseDiagram(json));
  if (!parsed) return { fault: "the drawer's parse refused it" };
  return withKeyStage(c.ks, () => {
    const why: string[] = [];
    for (const [zn, z] of Object.entries(ZONES)) {
      const r = drawDiagram(json, theme, { x: 0, y: 0, ...z });
      if (!r.ok) {
        why.push(`${zn}: ${r.reasons[0]}`);
        continue;
      }
      const f = readabilityFaults(r.spec, theme, { ...z, fs: r.fs });
      if (f.length) return { fault: `${zn} drew with faults: ${f.slice(0, 2).join("; ")}` };
      return { zone: zn };
    }
    return { fault: why.join(" | ") };
  });
}

const RESULTS = CASES.map((c) => ({ c, ...produce(c) }));

describe("diagrams through the production path", () => {
  test("every lesson spec (y5 to y11, rounds 2 to 4) draws at its key stage", () => {
    const bad = RESULTS.filter((r) => !r.c.name.startsWith("menu") && !r.c.refused && r.fault).map(
      (r) => `${r.c.ks} ${r.c.name}: ${r.fault}`,
    );
    expect(bad).toEqual([]);
  });

  test("a lesson spec the drawer is meant to refuse stays refused (it would read wrong)", () => {
    const refused = RESULTS.filter((r) => r.c.refused);
    expect(refused.length).toBeGreaterThan(0);
    for (const r of refused) expect(r.zone).toBeUndefined();
  });

  test("every kind draws at every key stage from its menu specs", () => {
    const missing: string[] = [];
    for (const kind of DRAWER_KINDS)
      for (const ks of KS) {
        const mine = RESULTS.filter(
          (r) => r.c.name.startsWith("menu") && r.c.ks === ks && r.c.spec.kind === kind,
        );
        if (!mine.length) missing.push(`${kind}: no menu spec`);
        else if (!mine.some((r) => r.zone))
          missing.push(`${ks} ${kind}: ${mine.map((r) => `${r.c.name} ${r.fault}`).join("; ")}`);
      }
    expect(missing).toEqual([]);
  });

  test("every spec passes the schemas and the drawer's parse (the draw may still refuse)", () => {
    const bad = RESULTS.filter(
      (r) =>
        !r.c.refused && r.fault && /^(JSON schema|wire|the drawer's parse|unknown)/.test(r.fault),
    ).map((r) => `${r.c.name}: ${r.fault}`);
    expect(bad).toEqual([]);
  });

  test("the cases cover all 17 kinds, cubes included", () => {
    expect(DRAWER_KINDS).toContain("cubes");
    expect(DRAWER_KINDS.length).toBe(19); // round 8: equal-groups, fraction-shapes
    const seen = new Set(CASES.map((c) => c.spec.kind));
    for (const k of DRAWER_KINDS) expect(seen.has(k)).toBe(true);
  });
});

describe("one diagram schema", () => {
  test("the wire schema is derived from the drawer's: same kinds, same fields", () => {
    const keys = (s: unknown) =>
      (s as { options: { shape: Record<string, unknown> }[] }).options
        .map((o) => `${(o.shape.kind as { value: string }).value}:${Object.keys(o.shape).sort()}`)
        .sort();
    expect(keys(DiagramSpecSchema)).toEqual(keys(DrawerSpecSchema));
  });

  test("the prompts name only kinds the drawer draws", () => {
    for (const k of DIAGRAM_KINDS) expect(DRAWER_KINDS).toContain(k);
  });

  test("a label over its limit passes the wire and is left to the drawer's parse", () => {
    const long = { kind: "flow", alt: "x", steps: [{ label: "y".repeat(60) }, { label: "b" }] };
    expect(DiagramSpecSchema.safeParse(long).success).toBe(true);
    expect(DrawerSpecSchema.safeParse(long).success).toBe(false);
  });
});

describe("OpenAI structured outputs", () => {
  test("every kind's schema has nothing OpenAI refuses (no tuples, oneOf, allOf, untyped nodes)", () => {
    const bad: string[] = [];
    for (const kind of DRAWER_KINDS) {
      for (const f of openaiSchemaFaults(diagramJsonSchema(kind))) bad.push(`${kind} wire${f}`);
      // The drawer's schema as production's call.ts would print it, with no wire form at all.
      const opt = (
        DrawerSpecSchema.options as unknown as { shape: { kind: { value: string } } }[]
      ).find((o) => o.shape.kind.value === kind);
      const raw = z.toJSONSchema(opt as never, { target: "draft-7", unrepresentable: "any" });
      for (const f of openaiSchemaFaults(raw).filter((x) => !x.endsWith("oneOf")))
        bad.push(`${kind} drawer${f}`);
    }
    expect(bad).toEqual([]);
  });

  test("every kind's schema converts to strict mode (closed objects, all required, no defaults)", () => {
    const bad: string[] = [];
    for (const kind of DRAWER_KINDS)
      for (const f of openaiSchemaFaults(strictForm(diagramJsonSchema(kind)), true))
        bad.push(`${kind}${f}`);
    expect(bad).toEqual([]);
  });

  test("the whole writer wire (the union inside a slide) prints without a tuple", () => {
    const wire = z.toJSONSchema(z.object({ diagram: DiagramSpecSchema }), {
      target: "draft-7",
      unrepresentable: "any",
    });
    expect(openaiSchemaFaults(wire).filter((f) => !f.endsWith("oneOf"))).toEqual([]);
  });
});

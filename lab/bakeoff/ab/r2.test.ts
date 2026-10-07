import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MEANING_SAMPLES } from "../../../packages/slides/src/diagrams/meaning-samples";
import { DIAGRAM_SAMPLES } from "../../../packages/slides/src/diagrams/samples";
import { openaiSchemaFaults } from "../../../packages/slides/src/diagrams/wire";
import type { DiagramAsk } from "../services";
import { AB, STAGES } from "./arms";
import {
  acceptWriterSpec,
  labelsOf,
  R2_KINDS,
  r2Def,
  r2WriterSchema,
  schemaFacts,
  writerSpecOf,
} from "./r2";

type J = Record<string, unknown>;

/** The JSON-schema subset strict mode uses, enough to say whether an instance is representable. */
function valid(node: J, v: unknown, defs: J): string[] {
  if (typeof node.$ref === "string")
    return valid(defs[node.$ref.replace("#/$defs/", "")] as J, v, defs);
  if (Array.isArray(node.anyOf)) {
    const all = (node.anyOf as J[]).map((n) => valid(n, v, defs));
    return all.some((e) => !e.length)
      ? []
      : (all.sort((a, b) => a.length - b.length)[0] ?? ["anyOf"]);
  }
  if (Array.isArray(node.enum) && !node.enum.includes(v))
    return [`${JSON.stringify(v)} not in enum`];
  switch (node.type) {
    case "null":
      return v === null ? [] : ["not null"];
    case "string":
      return typeof v === "string" ? [] : ["not a string"];
    case "boolean":
      return typeof v === "boolean" ? [] : ["not a boolean"];
    case "integer":
    case "number": {
      if (typeof v !== "number" || (node.type === "integer" && !Number.isInteger(v)))
        return ["not a number"];
      if (typeof node.minimum === "number" && v < node.minimum) return [`${v} < ${node.minimum}`];
      if (typeof node.maximum === "number" && v > node.maximum) return [`${v} > ${node.maximum}`];
      return [];
    }
    case "array": {
      if (!Array.isArray(v)) return ["not an array"];
      if (typeof node.minItems === "number" && v.length < node.minItems)
        return [`${v.length} < minItems ${node.minItems}`];
      if (typeof node.maxItems === "number" && v.length > node.maxItems)
        return [`${v.length} > maxItems ${node.maxItems}`];
      return v.flatMap((x) => valid(node.items as J, x, defs));
    }
    case "object": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return ["not an object"];
      const props = (node.properties ?? {}) as J;
      const o = v as J;
      const out: string[] = [];
      for (const r of (node.required as string[]) ?? []) if (!(r in o)) out.push(`missing ${r}`);
      if (node.additionalProperties === false)
        for (const k of Object.keys(o)) if (!(k in props)) out.push(`extra ${k}`);
      for (const [k, x] of Object.entries(o))
        if (props[k]) out.push(...valid(props[k] as J, x, defs).map((e) => `${k}: ${e}`));
      return out;
    }
  }
  return [];
}

/** A drawer-form sample in the writer's strict shape: absent optional fields sent as null. */
function asWriter(node: J, v: unknown, defs: J): unknown {
  if (typeof node.$ref === "string")
    return asWriter(defs[node.$ref.replace("#/$defs/", "")] as J, v, defs);
  if (Array.isArray(node.anyOf)) {
    if (v === undefined) return null;
    const hit = (node.anyOf as J[]).find(
      (n) => n.type !== "null" && !valid(n, asWriter(n, v, defs), defs).length,
    );
    return hit ? asWriter(hit, v, defs) : v;
  }
  if (node.type === "array" && Array.isArray(v))
    return v.map((x) => asWriter(node.items as J, x, defs));
  if (node.type === "object" && v && typeof v === "object") {
    const o: J = {};
    for (const [k, p] of Object.entries((node.properties ?? {}) as J))
      o[k] = asWriter(p as J, (v as J)[k], defs);
    return o;
  }
  return v === undefined ? null : v;
}

const MEANING = new Set(["flow", "bar-model", "timeline", "equal-groups", "fraction-shapes"]);
/** Every sample of a kind (meaning form where the drawer fills one), title dropped (R2 sends none). */
const samplesOf = (kind: string): J[] => {
  const from = MEANING.has(kind) ? MEANING_SAMPLES : (DIAGRAM_SAMPLES as Record<string, unknown>);
  return Object.values(from)
    .filter((x) => (x as J).kind === kind)
    .map((x) => {
      const { title: _t, ...rest } = x as J;
      return rest;
    });
};
const sampleOf = (kind: string): J => samplesOf(kind)[0] as J;
/** The sample cut to the slot's cap on its main list, as a writer held to the schema must. */
const trimmed = (s: J, def: J): J => {
  const out = { ...s };
  for (const [k, p] of Object.entries(def.properties as J)) {
    const n = (Array.isArray((p as J).anyOf) ? ((p as J).anyOf as J[])[0] : p) as J;
    if (n?.type === "array" && typeof n.maxItems === "number" && Array.isArray(out[k]))
      out[k] = (out[k] as unknown[]).slice(0, n.maxItems);
  }
  return out;
};
const ask = (kind: string, slot: "side" | "full", stage = "ks3"): DiagramAsk => ({
  key: "3:fig",
  kind,
  shows: "test",
  labels: [],
  words: "",
  yearGroup: "Year 8",
  stage,
  theme: "studio",
  slot: { placement: slot === "full" ? "across the slide" : "beside text", w: 0, h: 0, name: slot },
});

describe("R2: per-kind spec defs", () => {
  test("every structured kind has a strict-clean def in every stage and slot (KS1 side carroll none)", () => {
    for (const st of STAGES)
      for (const slot of ["side", "full"] as const)
        for (const k of R2_KINDS) {
          const d = r2Def(k, st, slot);
          if (st === "KS1" && slot === "side" && k === "carroll") {
            expect(d).toBeUndefined();
            continue;
          }
          expect(d, `${st} ${slot} ${k}`).toBeDefined();
          expect(openaiSchemaFaults(d, true)).toEqual([]);
          expect(Object.keys((d as J).properties as J).slice(0, 2)).toEqual(["kind", "shows"]);
        }
  });
  test("the slot caps are schema caps: a 7-box flow is unrepresentable beside text at KS1", () => {
    const d = r2Def("flow", "KS1", "side") as J;
    const flow = { ...sampleOf("flow"), nodes: ["a", "b", "c", "d", "e", "f", "g"] };
    const w = asWriter(d, { ...flow, shows: "x" }, {});
    expect(valid(d, w, {}).join()).toMatch(/nodes: 7 > maxItems 3/);
  });
});

describe("R2: writer schema", () => {
  for (const st of STAGES) {
    const base = JSON.parse(readFileSync(`${AB}/prompts/base3/T/schema.${st}.json`, "utf8")) as J;
    const r2 = r2WriterSchema(base, st);
    test(`${st}: pinned file is the generator's output, strict-clean, big-visual takes full defs`, () => {
      const file = JSON.parse(readFileSync(`${AB}/prompts/b3-r2/T/schema.${st}.json`, "utf8"));
      expect(file).toEqual(r2);
      const f = schemaFacts(r2);
      expect(f.strictFaults).toEqual([]);
      expect(f.depth).toBeLessThanOrEqual(10);
      expect(f.properties).toBeLessThan(5000);
      expect(f.enumValues).toBeLessThan(1000);
      expect(JSON.stringify(r2)).not.toContain('"#/$defs/diagram"');
      const defs = r2.$defs as J;
      expect(JSON.stringify(defs["big-visual"])).toContain("diagram-full");
      expect(JSON.stringify(defs["visual-text"])).toContain("diagram-side");
      // Everything outside the diagram defs is base3's.
      const strip = (s: J) => {
        const d = { ...(s.$defs as J) };
        for (const k of Object.keys(d)) if (/^(dg-|diagram)/.test(k)) delete d[k];
        return JSON.stringify({ ...s, $defs: d }).replace(/diagram-(side|full)/g, "diagram");
      };
      expect(strip(r2)).toBe(strip(base));
    });
  }
});

describe("R2: spec round trip per kind (writer form -> schema -> code draws)", () => {
  const base = JSON.parse(readFileSync(`${AB}/prompts/base3/T/schema.KS3-5.json`, "utf8")) as J;
  const r2 = r2WriterSchema(base, "KS3-5");
  const defs = r2.$defs as J;
  for (const k of R2_KINDS) {
    test(k, () => {
      const drawn: string[] = [];
      for (const [n, sample] of samplesOf(k).entries())
        for (const slot of ["full", "side"] as const) {
          const def = defs[`dg-${k}-${slot}`] as J;
          const w = asWriter(def, { ...trimmed(sample, def), shows: `A ${k}` }, defs) as J;
          const errs = valid({ $ref: `#/$defs/diagram-${slot}` }, w, defs);
          if (errs.length) {
            console.log(`  ${k}#${n} ${slot}: not representable: ${errs.slice(0, 2).join("; ")}`);
            continue;
          }
          const spec = writerSpecOf(w);
          expect(spec).toBeDefined();
          // equal-groups is numbers only (total, groups); every other kind carries words.
          if (k !== "equal-groups") expect(labelsOf(spec).length).toBeGreaterThan(0);
          const r = acceptWriterSpec(spec, ask(k, slot));
          if (!r.fault) drawn.push(`#${n} ${slot}`);
          else console.log(`  ${k}#${n} ${slot}: ${r.fault}`);
        }
      console.log(`  ${k}: drawn ${drawn.join(", ")}`);
      expect(drawn.length, `${k} drew in no slot`).toBeGreaterThan(0);
    });
  }
  test("a spec that does not draw goes back with its fault (the drawer fallback)", () => {
    const flow = { ...sampleOf("flow"), links: [{ from: 0, to: 9, label: null }] };
    const r = acceptWriterSpec(flow, ask("flow", "full"));
    expect(r.spec).toBeUndefined();
    expect(r.fault.length).toBeGreaterThan(0);
  });
  test("a freeform figure keeps the drawer path", () => {
    expect(writerSpecOf({ kind: "labelled-diagram", shows: "x", labels: ["a"] })).toBeUndefined();
    expect(writerSpecOf({ kind: "flow", shows: "x", labels: ["a", "b"] })).toBeUndefined();
  });
});

describe("R2: wiring (arm-t ask -> diagramSpec) with no model call", () => {
  test("a visual-text slide's spec figure becomes a spec ask, and code draws it with no spend", async () => {
    const { armT } = await import("../arm-t");
    const { diagramSpec, Ledger } = await import("../services");
    const { setAbArm } = await import("./arms");
    const { getTheme } = await import("../../../packages/slides/src/themes");
    const vctx = { theme: getTheme("studio", "ks3"), stage: "ks3" } as never;
    const flow = samplesOf("flow")[1] as J;
    const slide = {
      template: "visual-text",
      heading: "A chain",
      lead: null,
      points: ["One"],
      figure: { ...flow, shows: "the chain" },
    };
    setAbArm("b3-r2");
    try {
      const asks = armT.visuals(slide as never, 3, vctx) as {
        type: string;
        spec?: unknown;
        labels: string[];
      }[];
      const a = asks.find((x) => x.type === "diagram");
      expect(a?.spec).toBeDefined();
      expect(a?.labels.length).toBeGreaterThan(0);
      const ledger = new Ledger(0);
      const events: J[] = [];
      const out = await diagramSpec(
        { ...ask("flow", "side"), ...(a as object), key: "3:figure" } as DiagramAsk,
        ledger,
        (e) => events.push(e as J),
      );
      expect(out).toBeDefined();
      expect(events.map((e) => e.ev)).toEqual(["r2-spec-drawn"]);
      expect(Object.values(ledger.parts).reduce((x, y) => x + y, 0)).toBe(0);
      setAbArm("base3");
      const base = armT.visuals(slide as never, 3, vctx) as { spec?: unknown }[];
      expect(base.every((x) => x.spec === undefined)).toBe(true);
    } finally {
      setAbArm(undefined);
    }
  });
});

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writerBundle } from "./bundle";
import { charsOver, fitTable } from "./fixes";
import { replayRun, replayServices } from "./replay-fixture";
import { type WriterStage, writerSchema } from "./schema";
import {
  CHARS_PER_WORD,
  fitKey,
  fitsLines,
  SHAPES,
  slotFillArrival,
  slotFillSystem,
  slotLayouts,
  variantDefName,
  withSlotFill,
} from "./slot-fill";
import { validate } from "./strict-subset";

type J = Record<string, unknown>;
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
const split = (st: WriterStage) =>
  withSlotFill(
    writerSchema(st, { min: 9, max: 12 }, writerBundle("base4g"), { objectives: 3 }),
    st,
  );
const defsOf = (s: J) => s.$defs as Record<string, J>;
const resolve = (s: J, root: J): J =>
  s.$ref ? resolve(defsOf(root)[String(s.$ref).replace("#/$defs/", "")] as J, root) : s;

/** A value for a schema with every capped string at exactly its cap, ending a sentence. */
function fill(s0: J, root: J): unknown {
  const s = resolve(s0, root);
  if (s.anyOf) {
    const branches = s.anyOf as J[];
    return fill(branches.find((b) => b.type !== "null") ?? (branches[0] as J), root);
  }
  if (s.enum) return (s.enum as unknown[])[0];
  if (s.type === "null") return null;
  if (s.type === "string") {
    const n = typeof s.maxLength === "number" ? s.maxLength : 12;
    const words = "Blood moves round the body in tubes ".repeat(60);
    return `${words.slice(0, Math.max(0, n - 1)).trimEnd()}.`.padEnd(n, ".").slice(0, n);
  }
  if (s.type === "integer" || s.type === "number")
    return typeof s.minimum === "number" ? s.minimum : 1;
  if (s.type === "boolean") return true;
  if (s.type === "array")
    return Array.from({ length: (s.minItems as number) ?? 1 }, () => fill(s.items as J, root));
  if (s.type === "object") {
    const out: J = {};
    for (const [k, p] of Object.entries((s.properties ?? {}) as Record<string, J>))
      out[k] = fill(p, root);
    return out;
  }
  return null;
}

describe("slot schema generation per layout", () => {
  for (const st of STAGES)
    test(`${st}: every measured variant becomes one strict def keyed by fit`, () => {
      const s = split(st);
      const defs = defsOf(s);
      const slides = (s.properties as J).slides as J;
      const refs = ((slides.items as J).anyOf as J[]).map((b) =>
        String(b.$ref).replace("#/$defs/", ""),
      );
      const F = fitTable()[st];
      for (const [layout, vs] of Object.entries(slotLayouts(st))) {
        if (layout === "title") continue;
        for (const v of vs) {
          const name = variantDefName(layout, fitKey(v));
          const d = defs[name];
          // "with a figure" ways of a layout with no figure slot (exit-ticket) are not offered, and
          // the cards grid, banner and hook are measured but have no def unless the writer offers them.
          if (!d) {
            expect(["exit-ticket", "cards-grid", "banner-text", "hook"]).toContain(layout);
            continue;
          }
          expect(refs).toContain(name);
          const p = d.properties as Record<string, J>;
          expect(Object.keys(p).slice(0, 2)).toEqual(["template", "fit"]);
          expect(p.fit).toEqual({ type: "string", enum: [fitKey(v)] });
          expect(d.required).toEqual(Object.keys(p));
          expect(d.additionalProperties).toBe(false);
          expect(p.heading).toEqual({ type: "string", maxLength: F?.heading });
          for (const [list, n] of Object.entries(v.counts)) {
            expect((p[list] as J).minItems).toBe(n);
            expect((p[list] as J).maxItems).toBe(n);
          }
        }
        // The unsplit layout def is gone: strict mode is sent only what is referenced.
        expect(defs[layout]).toBeUndefined();
      }
      const title = (s.properties as J).title as J;
      expect((title.anyOf as J[]).length).toBe(2);
    });

  test("every $ref resolves", () => {
    for (const st of STAGES) {
      const s = split(st);
      const text = JSON.stringify(s);
      for (const m of text.matchAll(/"#\/\$defs\/([^"]+)"/g))
        expect(defsOf(s)[m[1] as string]).toBeDefined();
      // Every on-slide string slot's cap: schema-limits.test.ts.
    }
  });

  test("off by default: the writer's schema is unchanged", () => {
    expect(writerBundle("base4f-p123").features?.slotFill).toBeUndefined();
    const s = writerSchema("KS2", { min: 9, max: 12 });
    expect(JSON.stringify(s)).not.toContain('"fit"');
    expect(JSON.stringify(s)).not.toContain("maxLength");
  });
});

describe("overflow is impossible when the caps are kept", () => {
  for (const st of STAGES)
    test(`${st}: every variant filled to its caps passes the writer's measure`, () => {
      const s = split(st);
      let n = 0;
      for (const [name, d] of Object.entries(defsOf(s))) {
        if (!name.includes("~")) continue;
        const slide = fill(d, s) as J;
        expect(validate(d, slide, s)).toEqual([]);
        const a = slotFillArrival(slide, st, s);
        expect(a.over).toEqual([]);
        expect(a.breaches).toEqual([]);
        // Filled exactly to its caps: each such field is a logged cut (round 2), never an overflow.
        expect(a.cuts.length).toBeGreaterThan(0);
        const { fit: _fit, ...plain } = slide;
        expect(charsOver(plain, st)).toEqual([]);
        n++;
      }
      expect(n).toBeGreaterThan(35);
    });
});

describe("a broken cap is a logged writer fault, kept as written", () => {
  const s = split("KS2");
  const name = variantDefName("visual-text", "points-2-fig");
  const ok = fill(defsOf(s)[name] as J, s) as J;

  test("a field over its cap: breach, overflow, a writer fault, words kept", () => {
    const long = { ...ok, lead: `${"The heart pumps blood all round the body. ".repeat(12)}` };
    const a = slotFillArrival(long, "KS2", s);
    expect(a.route).toBe("writer-fault");
    expect(a.breaches.some((b) => b.includes("lead"))).toBe(true);
    expect(a.over.length).toBeGreaterThan(0);
    expect(a.slide.lead).toBe(long.lead);
    expect("fit" in a.slide).toBe(false);
  });

  test("a field that reaches its cap is a cut, even ending a sentence", () => {
    const cap = (((defsOf(s)[name] as J).properties as J).lead as J).maxLength as number;
    for (const lead of ["a".repeat(cap), `${"a".repeat(cap - 1)}.`]) {
      const a = slotFillArrival({ ...ok, lead }, "KS2", s);
      expect(a.cuts).toContain("lead");
      expect(a.route).toBe("writer-fault");
    }
  });

  test("a sentence field, or a string of sentences, that stops mid-sentence is a cut", () => {
    const a = slotFillArrival({ ...ok, lead: "The heart pumps blood" }, "KS2", s);
    expect(a.cuts).toContain("lead");
    const pts = (ok.points as string[]).map((p, i) => (i ? p : "It beats. It pumps by"));
    expect(slotFillArrival({ ...ok, points: pts }, "KS2", s).cuts).toContain("points[0]");
    // A phrase item needs no full stop.
    const phrase = (ok.points as string[]).map((p, i) => (i ? p : "Four chambers"));
    expect(slotFillArrival({ ...ok, points: phrase }, "KS2", s).cuts).not.toContain("points[0]");
  });

  test("a count that does not match its fit is a breach", () => {
    const a = slotFillArrival({ ...ok, points: [...(ok.points as string[]), "x."] }, "KS2", s);
    expect(a.breaches.length).toBeGreaterThan(0);
    expect(a.route).toBe("writer-fault");
  });

  test("a slide with no fit (an old output) is still laid, by today's path", () => {
    const { fit: _f, ...old } = ok;
    const a = slotFillArrival(old, "KS2", s);
    expect(a.breaches).toEqual(["fit: missing"]);
    expect(a.slide).toEqual(old);
  });
});

describe("old output still parses through the stage", () => {
  const b = "y1-science-animals-young";
  const run = async (slotFill: boolean) => {
    const events: J[] = [];
    const base = replayServices(b);
    const res = await replayRun(b, {
      services: { ...base, log: (e) => events.push(e as J) },
      hooks: { slotFill },
    });
    return { res, events };
  };

  test("the same deck with slot-fill on; every slide logged as a writer fault", async () => {
    const off = await run(false);
    const on = await run(true);
    expect(on.res.slides.length).toBe(off.res.slides.length);
    expect(on.res.slides.map((x) => x.kind)).toEqual(off.res.slides.map((x) => x.kind));
    const sf = on.events.filter((e) => e.ev === "slot-fill");
    expect(sf.length).toBeGreaterThan(0);
    for (const e of sf) {
      expect(e.route).toBe("writer-fault");
      expect(e.breaches).toEqual(["fit: missing"]);
    }
    expect(off.events.some((e) => e.ev === "slot-fill")).toBe(false);
  });
});

describe("the prompt", () => {
  test("the Fits lines become word budgets from the schema's own caps, and the text is shorter", () => {
    const keys = { KS1: "systemKS1", KS2: "systemKS2", "KS3-5": "systemKS3_5" } as const;
    for (const st of STAGES) {
      const sys = (writerBundle("base4g") as unknown as Record<string, string>)[keys[st]] ?? "";
      if (!sys) continue;
      const schema = split(st);
      const out = slotFillSystem(sys, schema, st);
      // NET LENGTH MUST NOT GROW (Greg, 10 Oct).
      expect(out.length).toBeLessThanOrEqual(sys.length);
      expect(out).not.toMatch(/TODO-PROMPT/);
      // No budget in rendered lines is left: every Fits sentence is in words.
      expect(out).not.toMatch(/Fits: [^\n]*\bline/);
      expect(out).not.toMatch(/heading is up to \d+ lines?\./);
      expect(out.match(/Each slide carries one idea/g)?.length).toBe(1);
      // The flow names each slide's shape, in the schema enum's own words; layout fits it first.
      expect(out).toContain(`its shape (${SHAPES.slice(0, -1).join(", ")}, or ${SHAPES.at(-1)})`);
      expect(out).toMatch(/^3\. Layout\. [^\n]*fits its shape first/m);
      expect(out).not.toMatch(/before size/);
      const flowItem = (schema.properties as J).flow as J;
      expect(((flowItem.items as J).properties as J).shape).toEqual({
        type: "string",
        enum: [...SHAPES],
      });
      // What the writer reads is what it is held to: each variant's numbers come from its def.
      const { lines } = fitsLines(schema, st);
      for (const [name, def] of Object.entries(defsOf(schema))) {
        const [layout, key] = name.split("~");
        if (!layout || !key) continue;
        const own = lines[layout] ?? "";
        const line = own.startsWith("Fits: as ") ? (lines[own.slice(9, -1)] ?? "") : own;
        expect(line).toContain(key);
        const props = def.properties as Record<string, J>;
        const lead = (props.lead ?? props.stem) as J | undefined;
        if (typeof lead?.maxLength === "number")
          expect(line).toMatch(
            new RegExp(
              `\\b${key}\\b[^;]* ${Math.max(1, Math.floor(lead.maxLength / CHARS_PER_WORD))}\\b`,
            ),
          );
      }
      // Everything outside the layouts menu and steps 2 and 3 is byte-identical.
      const keep = (t: string) =>
        t
          .split("\n")
          .filter(
            (l) => !/^(- [a-z-]+: |Layouts\. |2\. Flow\. |3\. Layout\. |4\. Write\. )/.test(l),
          );
      expect(keep(out)).toEqual(keep(sys));
    }
  });
});

// Review S2/S3 (19 Oct 2026): base4g (no pack) is byte-identical to master. The hashes and words
// below were taken from master's slot-fill.ts on the same schema (934 prompts and arrivals equal).
describe("off a pack run, slot-fill is master's", () => {
  const keys = { KS1: "systemKS1", KS2: "systemKS2", "KS3-5": "systemKS3_5" } as const;
  test.each([
    [
      "KS1",
      "0ec8577ca6ae9a083e4fd9a9f333bcd358d79354",
      "Fits: points-0-fig 23; points-2-fig 9, each 6;",
    ],
    [
      "KS2",
      "5bf2ebbb6ed16530b4f17fc809c082076b289640",
      "Fits: points-0-fig 30; points-2-fig 13, each 9;",
    ],
    [
      "KS3-5",
      "0cb4547029100f9bf2affb5b859676d246cbb0e4",
      "Fits: points-0-fig 30; points-2-fig 25, each 17;",
    ],
  ] as const)("%s: the prompt as master's, lead words literal", (st, sha, visualText) => {
    const sys = (writerBundle("base4g") as unknown as Record<string, string>)[keys[st]] ?? "";
    const out = slotFillSystem(sys, split(st), st);
    expect(createHash("sha1").update(out).digest("hex")).toBe(sha);
    expect(fitsLines(split(st), st).lines["visual-text"]?.startsWith(visualText)).toBe(true);
  });
  test("a hinge option past its count's room is not a cut, and fields log master's words", () => {
    const schema = split("KS2");
    // 60 characters: inside the def's 100, past the 4-option count's measured room (pack only).
    const slide = {
      template: "hinge",
      fit: "options-4",
      heading: "Which is right?",
      stem: "Pick the one.",
      options: [`${"Sun ".repeat(15).trim()}.`, "b", "c", "d"],
    } as J;
    const base = slotFillArrival(structuredClone(slide), "KS2", schema);
    expect(base.cuts).toEqual([]);
    expect(base.route).toBe("as-written");
    expect(base.fields[0]).toEqual({ path: "heading", words: 3, capWords: 8 });
    const pack = slotFillArrival(structuredClone(slide), "KS2", schema, undefined, true);
    expect(pack.cuts).toContain("options[0]");
  });
});

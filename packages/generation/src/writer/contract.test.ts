import { describe, expect, test } from "bun:test";
import { diagramJsonSchema, mendSpec, parseDiagram } from "@tj/slides/diagrams";
import { isGeneratedSlide } from "@tj/slides/reflow";
import { getTheme } from "@tj/slides/themes";
import { WRITER_BUNDLES, writerBundle } from "./bundle";
import { COUNT_LINE, contractSystem, drawerLimits, PINNED_LINES } from "./contract";
import { clampSpec, diagramFaultOf, drawWriterDiagram } from "./diagrams";
import { type Brief, fillTemplate, fixedFallback } from "./fixes";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import prod from "./fixtures/prod-01a12146/drawer-faults.json" with { type: "json" };
import { codeObjectives, codeTitle, materialise } from "./materialise";
import { coverage, repairObjectives } from "./notes";
import { writerSchema } from "./schema";
import { writerSystem } from "./stage";

/*
 * The writer's contract (rootcause WRITER-CONTRACT and PICTURES-DIAGRAMS, 9 Oct 2026): the
 * drawer's limits reach the writer from the drawer's schema, drawer output is mended, every
 * objective is held to a slide, the count is exact, and writer slides are the AI's.
 */

type J = Record<string, unknown>;
const brief = fixture.brief as unknown as Brief;
const P = writerBundle();
const props = (k: string) =>
  (diagramJsonSchema(k as never) as { properties: Record<string, J> }).properties;

describe("the writer's diagram limits come from the drawer's schema", () => {
  test("every number in the freeform menu lines is the drawer schema's", () => {
    const L = drawerLimits();
    expect(L.labelled.labels).toBe(props("labelled-diagram").labels?.maxItems as number);
    expect(L.particles.panels).toBe(props("particles").panels?.maxItems as number);
    expect(L.particles.notes).toBe(props("particles").notes?.maxItems as number);
    expect(L.particles.keyChars).toBe(18);
    const sys = writerSystem({ ...brief, keyStage: "ks3" });
    expect(sys).toContain(`with up to ${L.labelled.labels} parts labelled`);
    expect(sys).toContain(`a key up to ${L.particles.keyChars} characters`);
    expect(sys).toContain(`at most ${L.particles.notes} notes`);
  });

  test("no stage's system text keeps the contradicting lines (particles were offered for 'comparing conditions')", () => {
    for (const b of Object.values(WRITER_BUNDLES))
      for (const t of [b.systemKS1, b.systemKS2, b.systemKS3_5]) {
        const out = contractSystem(t);
        expect(out).not.toContain("comparing conditions");
        expect(out).not.toContain("up to 8 parts labelled");
        expect(out).not.toContain(PINNED_LINES.count);
        expect(out).toContain(COUNT_LINE);
        expect(out).toContain("Organisms, populations and variants are never particles");
      }
  });

  test("a bundle without a pinned line fails loudly, never ships the old contradiction", () => {
    expect(() => contractSystem("no such lines")).toThrow(/pinned line not found/);
  });

  test("the writer schema's freeform labels hold the drawer's label cap; the pinned schema is unchanged", () => {
    const free = (s: J) =>
      (((s.$defs as Record<string, J>)["diagram-freeform"] as J).properties as J).labels as J;
    const s = writerSchema("KS3-5", { min: 10, max: 10 });
    expect(free(s).maxItems).toBe(drawerLimits().labelled.labels);
    expect(
      free(writerSchema("KS3-5", { min: 9, max: 12 }, P, { pinned: true })).maxItems,
    ).toBeUndefined();
  });
});

describe("drawer output goes through mendSpec (production faults, lessons 01a12146 and 01a1214c)", () => {
  for (const c of prod.cases)
    test(`${c.job} slide ${c.slide} attempt ${c.attempt}: the logged fault, then a drawing`, () => {
      // The rebuilt spec gives production's own fault line.
      expect(diagramFaultOf(c.spec, parseDiagram)).toBe(c.fault);
      const mended = clampSpec(mendSpec(c.spec));
      expect(diagramFaultOf(mended, parseDiagram)).toBe("");
      expect(parseDiagram(mended)).toBeDefined();
    });

  test("the drawer path returns the mended spec, not a fault (slide 8's first attempt)", async () => {
    const c = prod.cases[0] as (typeof prod.cases)[number];
    const calls: string[] = [];
    const r = await drawWriterDiagram(
      {
        key: "diagram",
        kind: "particles",
        shows: "moth populations",
        labels: [],
        words: "Natural selection",
        yearGroup: "Year 9",
      } as never,
      {
        callDrawer: async (req) => {
          calls.push(req.user);
          return { out: c.spec };
        },
        drawerSystem: "x",
        theme: getTheme("chalk", "ks3"),
      },
    );
    expect(calls).toHaveLength(1);
    expect(r.via).toBe("drawer");
    const spec = r.spec as J;
    expect(spec.arrows).toBeUndefined();
    expect(spec.key).toBeUndefined();
  });

  test("a lost diagram's named parts stay on the slide as points, never a bare drop", () => {
    const fb = fixedFallback(
      { template: "visual-text", heading: "Moths", lead: "Two kinds.", points: [] },
      { type: "diagram", kind: "particles" },
      ["Light moths", "Dark moths"],
      5,
    );
    expect(fb.how).toBe("figure-as-points");
    expect(fb.slide).toMatchObject({ template: "explain", points: ["Light moths", "Dark moths"] });
  });
});

describe("every objective has a slide", () => {
  test("the schema holds teaches to the approved objectives' numbers", () => {
    const s = writerSchema("KS3-5", { min: 10, max: 10 }, P, { objectives: 3 });
    const flow = (s.properties as Record<string, J>).flow as J;
    const teaches = ((flow.items as J).properties as Record<string, J>).teaches as J;
    expect((teaches.items as J).enum).toEqual([1, 2, 3]);
    expect([flow.minItems, flow.maxItems]).toEqual([10, 10]);
  });

  // Lesson 01a1214c: objective 2's only "check" was a slide whose flow said check but whose written
  // template taught. The repair logged stillMissing [2]; the summary logged coverage 0.
  const flow = [
    { slide: 1, teaches: [] },
    { slide: 2, teaches: [] },
    { slide: 3, does: "teach", teaches: [1] },
    { slide: 4, does: "quick quiz on 1", teaches: [1] },
    { slide: 5, does: "teach", teaches: [2] },
    { slide: 6, does: "check understanding", teaches: [2] },
  ];
  const tpl = ["title", "objectives", "explain", "hinge", "visual-text", "explain"];
  test("coverage by the written templates reports the miss the old summary metric hid", () => {
    expect(coverage(flow, 2, () => undefined).missing).toEqual([]);
    expect(coverage(flow, 2, (k) => tpl[k - 1]).missing).toEqual([2]);
  });

  test("the repair is told what each missing objective lacks, is held to its numbers, and a partial fix is kept", async () => {
    const plan = { flow, slides: tpl.map((template) => ({ template })) };
    let seen: { user: string; schema: J } | undefined;
    const res = await repairObjectives({
      plan,
      objectives: ["one", "two", "three"],
      context: "ctx",
      system: "sys",
      schema: {
        properties: { changes: { items: { properties: { n: {}, teaches: {}, slide: {} } } } },
      },
      chat: async (r) => {
        seen = { user: r.user, schema: r.schema as J };
        return {
          out: { changes: [{ n: 6, teaches: [2], slide: { template: "question-set" } }] },
          usd: 0,
          ms: 1,
        };
      },
      log: () => {},
      onUsd: () => {},
    });
    expect(seen?.user).toContain("Missing objectives: 2, 3");
    expect(seen?.user).toContain(
      "- 2: no hinge, question-set, practice, exit-ticket or discussion slide checks it",
    );
    expect(seen?.user).toContain("- 3: no slide teaches it; no hinge");
    const t = (
      (seen as { schema: J }).schema as { properties: { changes: { items: { properties: J } } } }
    ).properties.changes.items.properties.teaches as J;
    expect((t.items as J).enum).toEqual([1, 2, 3]);
    expect(res.repaired).toBe(true);
    expect(res.after?.missing).toEqual([3]);
  });
});

describe("the slide count is the teacher's", () => {
  test("an exact count reads as one number in the writer's context", () => {
    const user = fillTemplate(
      P.user,
      { ...brief, slides: { min: 10, max: 10 } },
      { objectives: [] },
    );
    expect(user).toContain("Slides: 10");
    expect(user).not.toContain("10 to 10");
    const ranged = fillTemplate(
      P.user,
      { ...brief, slides: { min: 9, max: 12 } },
      { objectives: [] },
    );
    expect(ranged).toContain("Slides: 9 to 12");
  });
});

describe("writer slides are the AI's (the false 'clashing' fault)", () => {
  test("title, objectives and written slides carry authoredBy ai, so the editor reads them as generated", () => {
    const theme = getTheme("chalk", "ks3");
    const base = { brief, theme, stage: "ks3" as const };
    const plan = { slides: [], objectives: [{ teacher: "Name animals", pupil: "Name animals" }] };
    const hinge = materialise(
      {
        template: "hinge",
        heading: "Which?",
        stem: "Which is a mammal?",
        options: ["Cat", "Fish"],
        correct: 1,
      },
      { ...base, index: 3, plan, visual: () => ({ status: "pending" }) } as never,
    );
    for (const m of [
      codeTitle(brief, base),
      codeObjectives({ ...base, index: 1, plan } as never),
      hinge,
    ]) {
      expect(m.slide.elements.length).toBeGreaterThan(0);
      expect(m.slide.elements.every((e) => (e as J).authoredBy === "ai")).toBe(true);
      expect(isGeneratedSlide(m.slide as never)).toBe(true);
    }
  });
});

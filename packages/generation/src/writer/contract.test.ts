import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  diagramJsonSchema,
  LIMIT_TEXT,
  limitLines,
  mendSpec,
  parseDiagram,
} from "@tj/slides/diagrams";
import { isGeneratedSlide } from "@tj/slides/reflow";
import { getTheme } from "@tj/slides/themes";
import { WRITER_BUNDLES, writerBundle } from "./bundle";
import { COUNT_LINE, contractSystem, drawerLimits, PINNED_LINES } from "./contract";
import { diagramFaultOf, drawWriterDiagram } from "./diagrams";
import { type Brief, fillTemplate, fixedFallback } from "./fixes";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import prod from "./fixtures/prod-01a12146/drawer-faults.json" with { type: "json" };
import { codeObjectives, codeTitle, materialise } from "./materialise";
import { coverage, repairObjectives } from "./notes";
import { replayRun, replayServices, savedSlides } from "./replay-fixture";
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

describe("drawer output goes through mendSpec, and nothing is cut to fit (lessons 01a12146 and 01a1214c)", () => {
  for (const c of prod.cases)
    test(`${c.job} slide ${c.slide} attempt ${c.attempt}: the logged fault; mended only where meaning is kept`, () => {
      // The rebuilt spec gives production's own fault line.
      expect(diagramFaultOf(c.spec, parseDiagram)).toBe(c.fault);
      const after = diagramFaultOf(mendSpec(c.spec), parseDiagram);
      // Arrows on a compare are left out (no data lost); a count, a label set or a key past its
      // limit is never cut or raised: it stays a fault for the drawer's repair.
      if (/^spec: a compare draws no arrow/.test(c.fault)) expect(after).toBe("");
      else expect(after).not.toBe("");
    });

  const ask = {
    key: "diagram",
    kind: "particles",
    shows: "moth populations",
    labels: [],
    words: "Natural selection",
    yearGroup: "Year 9",
  } as never;
  const drawer = (answers: unknown[], calls: string[]) => ({
    callDrawer: async (req: { user: string }) => {
      calls.push(req.user);
      return { out: answers[Math.min(calls.length - 1, answers.length - 1)] };
    },
    drawerSystem: "x",
    theme: getTheme("chalk", "ks3"),
  });

  test("a spec past a limit goes back to the drawer with that limit, and its repaired answer draws", async () => {
    const over = prod.cases[3] as (typeof prod.cases)[number]; // 8 labels
    const fixed = { ...over.spec, labels: over.spec.labels?.slice(0, 6) };
    const calls: string[] = [];
    const r = await drawWriterDiagram(
      { ...(ask as object), kind: "labelled-diagram" } as never,
      drawer([over.spec, fixed], calls) as never,
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("labels: Too big: expected array to have <=6 items");
    expect(r.via).toBe("drawer");
    expect((r.spec as { labels: unknown[] }).labels).toHaveLength(6);
  });

  test("a population of one is never drawn as two: a second miss falls to the restage ladder", async () => {
    const one = prod.cases[2] as (typeof prod.cases)[number]; // panels with count 1
    const calls: string[] = [];
    const r = await drawWriterDiagram(ask, drawer([one.spec], calls) as never);
    expect(calls).toHaveLength(2);
    expect(r.via).toBe("none");
    expect(r.spec).toBeUndefined();
    expect(r.fault).toContain("panels.1.count");
  });

  test("the drawer and the writer state a label's limit from one source", () => {
    expect(limitLines()).toContain(`each ${LIMIT_TEXT.label}.`);
    expect(writerSystem({ ...brief, keyStage: "ks3" })).toContain(
      `each label ${LIMIT_TEXT.label}.`,
    );
    expect(limitLines()).toContain(LIMIT_TEXT.particles);
    expect(writerSystem({ ...brief, keyStage: "ks3" })).toContain(LIMIT_TEXT.particles);
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

describe("a count miss ships whole and is logged (ADR 0036)", () => {
  const b = "y11-chemistry-rates-of-reaction";
  const main = JSON.parse(
    JSON.parse(readFileSync(join(import.meta.dir, "fixtures/replay", b, "main.json"), "utf8")).text,
  ) as { slides: unknown[] };
  const total = main.slides.length + 2;

  test("an N+1 deck (the writer wrote one more than asked) ships every slide, warns, orphans no picture", async () => {
    const logs: J[] = [];
    const asked = new Set<number>();
    const reopened: number[] = [];
    const out = await replayRun(b, {
      brief: (br) => ({ ...br, slides: { min: total - 1, max: total - 1 } }),
      services: { ...replayServices(b), log: (e) => logs.push(e as J) },
      hooks: {
        onAsks: (i, asks) => {
          if (asks.length) asked.add(i);
        },
        onReopen: (i) => reopened.push(i),
      },
    });
    // Same deck as the saved replay at its own count: nothing trimmed, nothing moved.
    expect(out.slides.length).toBe(savedSlides(b).length);
    expect(out.plan.slides.length).toBe(total);
    expect(logs.filter((e) => e.ev === "count-miss")).toEqual([
      { ev: "count-miss", level: "warn", requested: total - 1, delivered: total },
    ]);
    // Every slide that asked for a picture is still in the deck; none was reopened or dropped.
    expect([...asked].every((i) => i < out.plan.slides.length)).toBe(true);
    expect(reopened).toEqual([]);
  });

  test("the count asked for logs nothing", async () => {
    const logs: J[] = [];
    await replayRun(b, {
      brief: (br) => ({ ...br, slides: { min: total, max: total } }),
      services: { ...replayServices(b), log: (e) => logs.push(e as J) },
    });
    expect(logs.some((e) => e.ev === "count-miss")).toBe(false);
  });
});

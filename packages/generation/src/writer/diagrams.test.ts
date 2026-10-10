import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { stripBuilds, svgOfDataUrl } from "@tj/slides/diagram-builds";
import { DIAGRAM_SAMPLES, MEANING_SAMPLES, openaiSchemaFaults } from "@tj/slides/diagrams";

import { getTheme } from "@tj/slides/themes";
import { BudgetExceeded } from "../types";
import pinnedDefs from "./bundles/base4/diagram-defs.gen.json" with { type: "json" };
import {
  acceptWriterSpec,
  type DrawerCall,
  diagramAskOf,
  drawWriterDiagram,
  labelsOf,
  questionSafe,
  R2_FREEFORM,
  R2_KINDS,
  r2Def,
  type WriterDiagramAsk,
  writerDiagramElement,
  writerSpecOf,
} from "./diagrams";
import saved from "./fixtures/base4-diagrams.json" with { type: "json" };

/** Saved base4 runs (lab/ab 92f1b36d): writer figures with what the lab did, and drawn elements. */
type Fixture = {
  rows: {
    lesson: string;
    slide: number;
    theme: string;
    stage: string;
    rect: { x: number; y: number; w: number; h: number };
    specs: unknown[];
    sha256: string;
  }[];
  figures: {
    lesson: string;
    key: string;
    template: string;
    stage: string;
    theme: string;
    figure: unknown;
    labCode: boolean;
    labDrawn: boolean;
  }[];
};
const fixture = saved as unknown as Fixture;

type J = Record<string, unknown>;
const STAGES = ["KS1", "KS2", "KS3-5"] as const;
const studio = getTheme("studio");

const ask = (
  kind: string,
  slot: "side" | "full",
  stage = "ks3",
  spec?: unknown,
): WriterDiagramAsk => ({
  key: "3:figure",
  kind,
  shows: "test",
  labels: spec ? labelsOf(spec) : [],
  ...(spec !== undefined ? { spec } : {}),
  words: "The slide's words.",
  yearGroup: "Year 8",
  stage,
  slot: { placement: slot === "full" ? "across the slide" : "beside text", w: 0, h: 0, name: slot },
});

const MEANING = new Set(["flow", "bar-model", "timeline", "equal-groups", "fraction-shapes"]);
/** Every sample of a kind (meaning form where the drawer fills one), title dropped (R2 sends none). */
const samplesOf = (kind: string): J[] => {
  const from = (MEANING.has(kind) ? MEANING_SAMPLES : DIAGRAM_SAMPLES) as Record<string, unknown>;
  return Object.values(from)
    .filter((x) => (x as J).kind === kind)
    .map((x) => {
      const { title: _t, ...rest } = x as J;
      return rest;
    });
};

const noCall: DrawerCall = async () => {
  throw new Error("no model call expected");
};

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
  test("the slot caps are schema caps: a flow beside text at KS1 holds at most 3 boxes", () => {
    const d = r2Def("flow", "KS1", "side") as J;
    const nodes = (d.properties as J).nodes as J;
    const list = (Array.isArray(nodes.anyOf) ? (nodes.anyOf as J[])[0] : nodes) as J;
    expect(list.maxItems).toBe(3);
  });
  test("the freeform kinds are the drawer's other kinds", () => {
    expect(R2_FREEFORM).toContain("labelled-diagram");
    expect(R2_FREEFORM).toContain("particles");
    for (const k of R2_KINDS) expect(R2_FREEFORM).not.toContain(k);
  });
});

describe("R2: spec round trip per kind (writer spec -> code draws, no call)", () => {
  for (const k of R2_KINDS) {
    test(k, async () => {
      let drawn = 0;
      for (const sample of samplesOf(k))
        for (const slot of ["full", "side"] as const) {
          const f = { ...sample, shows: `A ${k}` };
          const spec = writerSpecOf(f);
          expect(spec).toBeDefined();
          if (k !== "equal-groups") expect(labelsOf(spec).length).toBeGreaterThan(0);
          const r = await drawWriterDiagram(ask(k, slot, "ks3", spec), {
            callDrawer: noCall,
            drawerSystem: "",
            theme: studio,
          });
          if (r.via === "code") drawn += 1;
        }
      // Every structured kind has a sample that code draws in some slot with no model call.
      expect(drawn, `${k} drew in no slot`).toBeGreaterThan(0);
    });
  }
  test("a spec that does not draw goes back with its fault", () => {
    const flow = { ...(samplesOf("flow")[0] as J), links: [{ from: 0, to: 9, label: null }] };
    const r = acceptWriterSpec(flow, ask("flow", "full"), studio);
    expect(r.spec).toBeUndefined();
    expect(r.fault.length).toBeGreaterThan(0);
  });
  test("a freeform figure keeps the drawer path", () => {
    expect(writerSpecOf({ kind: "labelled-diagram", shows: "x", labels: ["a"] })).toBeUndefined();
    expect(writerSpecOf({ kind: "flow", shows: "x", labels: ["a", "b"] })).toBeUndefined();
    const a = diagramAskOf(
      "4:diagram",
      { kind: "particles", shows: "x", labels: ["solid"] },
      {
        words: "",
        yearGroup: "Year 7",
      },
    );
    expect(a.spec).toBeUndefined();
    expect(a.labels).toEqual(["solid"]);
  });
});

describe("the drawer fallback (base4's round 5 drawer call)", () => {
  const good = samplesOf("cycle")[0] as J;
  test("a spec that does not draw goes to the drawer with its fault; one retry told why", async () => {
    const bad = { kind: "cycle", alt: "x", steps: [] };
    const users: string[] = [];
    let n = 0;
    const call: DrawerCall = async (req) => {
      users.push(req.user);
      expect(req.model).toBe("gpt-6-luna");
      expect(req.strict).toBe(false);
      expect(req.timeoutMs).toBeGreaterThan(0);
      n += 1;
      return { out: n === 1 ? { kind: "cycle", steps: 3 } : good };
    };
    const r = await drawWriterDiagram(ask("cycle", "full", "ks3", bad), {
      callDrawer: call,
      drawerSystem: "SYSTEM",
      theme: studio,
    });
    expect(r.via).toBe("drawer");
    expect(n).toBe(2);
    expect(users[0]).toContain("The writer's spec, which did not draw");
    expect(users[1]).toContain("Your last spec did not draw:");
  });
  test("a drawer that fails twice, or throws, gives no spec (the stage restages); never throws", async () => {
    const bad: DrawerCall = async () => ({ out: { kind: "cycle" } });
    const r = await drawWriterDiagram(ask("cycle", "side"), {
      callDrawer: bad,
      drawerSystem: "",
      theme: studio,
    });
    expect(r).toMatchObject({ via: "none" });
    const r2 = await drawWriterDiagram(ask("particles", "side"), {
      callDrawer: noCall,
      drawerSystem: "",
      theme: studio,
    });
    expect(r2.via).toBe("none");
    expect(r2.fault).toContain("drawer call failed");
  });
});

describe("question slides keep the answer back (D16 rule 4)", () => {
  test("a bar model loses its combined total and filled bar totals; a ? total stays", () => {
    const s = {
      kind: "bar-model",
      alt: "x",
      combined: "£30",
      bars: [
        { label: "A", total: "£18", parts: [{ value: 1 }] },
        { label: "B", total: "?", parts: [{ value: 1 }] },
      ],
    };
    const q = questionSafe(s) as J;
    expect(q.combined).toBeUndefined();
    expect((q.bars as J[])[0]?.total).toBeUndefined();
    expect((q.bars as J[])[1]?.total).toBe("?");
    expect(questionSafe({ kind: "flow", x: 1 })).toEqual({ kind: "flow", x: 1 });
  });
  test("drawn on a question slide, a bar model has no combined total", async () => {
    const bm = { ...(samplesOf("bar-model").find((x) => x.combined) as J), shows: "x" };
    const spec = writerSpecOf(bm);
    const r = await drawWriterDiagram(
      { ...ask("bar-model", "full", "ks2", spec), question: true },
      { callDrawer: noCall, drawerSystem: "", theme: studio },
    );
    if (r.spec) expect((r.spec as J).combined).toBeUndefined();
  });
});

describe("never throws: the diagram corpus and its mutations", () => {
  const corpus: unknown[] = [
    ...Object.values(DIAGRAM_SAMPLES),
    ...Object.values(MEANING_SAMPLES),
    ...fixture.figures.map((f) => f.figure),
    ...fixture.rows.flatMap((r) => r.specs),
  ];
  const mutate = (s: unknown): unknown[] => {
    const o = (s && typeof s === "object" ? s : {}) as J;
    const out: unknown[] = [s, null, undefined, 7, "flow", [], { kind: o.kind }];
    for (const k of Object.keys(o)) {
      out.push(
        { ...o, [k]: null },
        { ...o, [k]: [] },
        { ...o, [k]: "x".repeat(400) },
        { ...o, [k]: -1 },
      );
      if (Array.isArray(o[k])) out.push({ ...o, [k]: Array(60).fill((o[k] as unknown[])[0]) });
    }
    return out;
  };
  test(`${corpus.length} specs and their mutations`, async () => {
    let n = 0;
    for (const s of corpus)
      for (const m of mutate(s)) {
        const kind = String((m as J | null)?.kind ?? "flow");
        for (const slot of ["side", "full"] as const) {
          const a = ask(kind, slot, "ks2", m);
          expect(() => acceptWriterSpec(m, a, studio)).not.toThrow();
          expect(() => writerSpecOf((m ?? {}) as J)).not.toThrow();
          expect(() => labelsOf(m)).not.toThrow();
          expect(() => questionSafe(m)).not.toThrow();
          expect(() =>
            writerDiagramElement(m, studio, "ks2", { x: 0, y: 0, w: 348, h: 284 }),
          ).not.toThrow();
          n += 1;
        }
      }
    const r = await drawWriterDiagram(ask("flow", "side", "ks1", { kind: "flow", nodes: null }), {
      callDrawer: async () => ({ out: "garbage" }),
      drawerSystem: "",
      theme: studio,
    });
    expect(r.via).toBe("none");
    expect(n).toBeGreaterThan(1000);
  }, 180_000);
});

describe("replay: saved base4 writer outputs (lab/ab 92f1b36d)", () => {
  test("every drawn diagram is the lab's SVG byte for byte once its build tags are stripped", () => {
    let same = 0;
    for (const row of fixture.rows) {
      const hit = row.specs.some((spec) => {
        const el = writerDiagramElement(spec, getTheme(row.theme), row.stage, row.rect, () => "x");
        const svg = el && svgOfDataUrl(el.src);
        return !!svg && createHash("sha256").update(stripBuilds(svg)).digest("hex") === row.sha256;
      });
      if (hit) same += 1;
      // readGraph and labels3 (TEACH-110 part e) redraw measured line graphs and particle keys on
      // purpose: those drawings may differ from base4's, no other kind may.
      else
        expect({
          row: `${row.lesson} slide ${row.slide}`,
          redrawn: row.specs.some((s) =>
            ["line-graph", "particles"].includes(String((s as { kind?: unknown }).kind)),
          ),
        }).toEqual({ row: `${row.lesson} slide ${row.slide}`, redrawn: true });
    }
    expect(same).toBeGreaterThan(fixture.rows.length - 10);
  });
  test("the writer's specs draw by code as the lab's did (D14), and every diagram asked is drawn", () => {
    const specs = fixture.figures.filter((f) => writerSpecOf(f.figure as J));
    let ours = 0;
    let lab = 0;
    let agree = 0;
    for (const f of specs) {
      const slot = f.template === "big-visual" ? "full" : "side";
      const spec = writerSpecOf(f.figure as J);
      const r = acceptWriterSpec(
        spec,
        ask(String((f.figure as J).kind), slot, f.stage, spec),
        getTheme(f.theme),
      );
      if (r.spec) ours += 1;
      if (f.labCode) lab += 1;
      if (!!r.spec === f.labCode) agree += 1;
    }
    console.log(`  code drew ${ours}/${specs.length} (lab ${lab}); agree ${agree}`);
    // The slot probe here is the slot box; P2a's layout probe is the lab's (see INTERFACE.txt).
    expect(ours).toBeGreaterThanOrEqual(lab);
    expect(agree / specs.length).toBeGreaterThanOrEqual(0.95);
    const drawn = fixture.figures.filter((f) => f.labDrawn).length;
    expect(drawn / fixture.figures.length).toBeGreaterThanOrEqual(0.89);
  });
  test("question slides show no filled total and no combined", () => {
    const qs = fixture.figures.filter((f) =>
      /hinge|check|question|practice|exit|quiz/.test(String(f.template)),
    );
    for (const f of qs) {
      const s = questionSafe(writerSpecOf(f.figure as J) ?? {}) as J;
      expect(s.combined).toBeUndefined();
      for (const b of (s.bars as J[] | undefined) ?? [])
        if (typeof b.total === "string") expect(b.total).toContain("?");
    }
  });
});

describe("builds on the slide's element", () => {
  test("each saved flow, cycle and bar model carries builds; other surfaces see every part", () => {
    const rows = fixture.rows.filter((r) =>
      ["flow", "cycle", "bar-model"].includes(String((r.specs[0] as J | undefined)?.kind)),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const el = writerDiagramElement(row.specs[0], getTheme(row.theme), row.stage, row.rect);
      if (!el) continue;
      expect(el.name).toBe("Diagram");
      const parts = (row.specs[0] as J).steps ?? (row.specs[0] as J).bars;
      if (Array.isArray(parts) && parts.length > 1) expect(el.builds ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("the writer's pinned diagram defs are the drawer's own schema (TEACH-110 part b data)", () => {
  test("every dg-<kind>-<slot> def in base4's diagram-defs.gen.json equals r2Def", () => {
    const defs = pinnedDefs as unknown as Record<string, Record<string, unknown>>;
    let n = 0;
    for (const st of STAGES)
      for (const [name, def] of Object.entries(defs[st] ?? {})) {
        const m = /^dg-(.+)-(side|full)$/.exec(name);
        if (!m) continue;
        expect(
          r2Def(m[1] as (typeof R2_KINDS)[number], st, m[2] as "side" | "full"),
          `${st} ${name}`,
        ).toEqual(def as J);
        n += 1;
      }
    expect(n).toBeGreaterThan(80);
  });
});

describe("a budget or abort error stops the job (never a restage)", () => {
  test("the drawer call's budget error and an abort in the slot probe are rethrown", async () => {
    const over = new BudgetExceeded("usd");
    await expect(
      drawWriterDiagram(ask("particles", "side"), {
        callDrawer: async () => {
          throw over;
        },
        drawerSystem: "",
        theme: studio,
      }),
    ).rejects.toBe(over);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const flow = samplesOf("flow")[0] as J;
    await expect(
      drawWriterDiagram(ask("flow", "side", "ks3", flow), {
        callDrawer: noCall,
        drawerSystem: "",
        theme: studio,
        probe: () => {
          throw abort;
        },
      }),
    ).rejects.toBe(abort);
  });
});

describe("S10 paid L y2 s7: a drawer fallback on an asking slide keeps the answer back", () => {
  // The recorded run: the library fill was refused (16 > 12), the drawer's first spec (groups 0)
  // failed its schema and its retry drew two groups of 8, the half the task asks for, titled with
  // the slide's heading.
  const shows =
    "Show exactly 16 ungrouped counters in a loose arrangement, with the total 16 displayed. Pupils draw their own two equal groups to find one half, then four equal groups to find one quarter. Do not draw groups, shade counters or show either answer.";
  const outs = [
    {
      kind: "equal-groups",
      alt: "16 ungrouped counters.",
      title: "Now share 16",
      total: 16,
      groups: 0,
      layout: "rows",
      show_count: "none",
      unknown: false,
    },
    {
      kind: "equal-groups",
      alt: "16 counters shown without group boundaries.",
      title: "Now share 16",
      total: 16,
      groups: 2,
      layout: "rows",
      show_count: "none",
      unknown: false,
    },
  ];
  const run = (question: boolean) => {
    let n = 0;
    const callDrawer: DrawerCall = async () => ({ out: outs[Math.min(n++, outs.length - 1)] });
    return drawWriterDiagram(
      {
        key: "diagram",
        kind: "equal-groups",
        shows,
        labels: [],
        words: "Now share 16\nFind one half and one quarter. Draw equal groups.",
        yearGroup: "Year 2",
        stage: "ks1",
        slot: { placement: "across the slide", w: 0, h: 0, name: "full" },
        question,
      },
      { callDrawer, drawerSystem: "", theme: studio },
    );
  };
  test("the retry's two groups of 8 are drawn as one pile of 16, never the half", async () => {
    const r = await run(true);
    expect(r.via).toBe("drawer");
    const s = r.spec as J;
    expect(s.groups).toBe(1);
    expect(s.total).toBe(16);
    expect(s.pile).toBe(true);
  });
  test("a teaching slide keeps the drawer's groups, whatever the words say", async () => {
    const s = (await run(false)).spec as J;
    expect(s.groups).toBe(2);
    expect(s.pile ?? false).toBe(false);
  });
  test("on an asking slide, 'one group' or 'all together' alone does not make a pile", async () => {
    const grouped = {
      kind: "equal-groups",
      alt: "12 counters in 3 groups of 4.",
      title: null,
      total: 12,
      groups: 3,
      layout: "rings",
      show_count: "none",
      unknown: false,
    };
    for (const shows of [
      "12 counters in 3 groups of 4. Circle one group.",
      "12 counters, 3 groups of 4, then all together.",
    ]) {
      const r = await drawWriterDiagram(
        {
          key: "diagram",
          kind: "equal-groups",
          shows,
          labels: [],
          words: "How many in each group?",
          yearGroup: "Year 2",
          stage: "ks1",
          slot: { placement: "across the slide", w: 0, h: 0, name: "full" },
          question: true,
        },
        { callDrawer: async () => ({ out: grouped }), drawerSystem: "", theme: studio },
      );
      expect((r.spec as J).groups).toBe(3);
      expect((r.spec as J).pile ?? false).toBe(false);
    }
  });
  test("the drawing does not repeat the slide's heading", async () => {
    const s = (await run(true)).spec as J;
    expect(s.title ?? null).toBeNull();
    const t = (await run(false)).spec as J;
    expect(t.title ?? null).toBeNull();
  });
});

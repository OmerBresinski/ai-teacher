import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { svgOfDataUrl } from "@tj/slides/diagram-builds";
import { openaiSchemaFaults } from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import {
  type DrawerCall,
  diagramAskOf,
  drawWriterDiagram,
  labelsOf,
  r2Def,
  WRITER_TEMPLATES,
  writerDiagramElement,
  writerSpecOf,
} from "./diagrams";
import real from "./fixtures/r3-template-specs.json" with { type: "json" };
import { PILOT_PACKS, type PilotPackId, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * TEACH-247 part bb: the river and hydrograph templates are writer-filled again. In the early-Oct
 * lab runs (R3, CF-*) Sol wrote the full template spec and code drew it well (DIAGRAM-AUDIT,
 * 5 Oct); since the one-call harness (#415) both went through the drawer as `{kind, shows,
 * labels}`. A pack with `writerTemplates` offers their own defs in each diagram slot.
 */

type J = Record<string, unknown>;
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
const studio = getTheme("studio");
const noCall: DrawerCall = async () => {
  throw new Error("no model call expected");
};
const rows = (real as { rows: { run: string; brief: string; slide: number; spec: J }[] }).rows;

/** The spec as Sol sends it in the strict def: `shows`, a null title, nulls for absent fields. */
function asSent(spec: J): J {
  const def = r2Def(spec.kind as "river", "KS3-5", "full") as J;
  const out: J = { shows: String(spec.alt) };
  for (const k of Object.keys(def.properties as J)) if (!(k in out)) out[k] = spec[k] ?? null;
  out.title = null;
  return out;
}
const ask = (f: J, slot: "side" | "full" = "full") =>
  diagramAskOf("4:figure", f, {
    words: "How a river responds",
    yearGroup: "Year 8",
    stage: "ks3",
    slot: {
      placement: slot === "full" ? "across the slide" : "beside text",
      w: 0,
      h: 0,
      name: slot,
    },
  });

/** v4.16's request with `writerTemplates` switched on for the call (no pack ships it yet). */
function requestWith(stage: WriterStage, id: PilotPackId = "v4.16") {
  const pack = PILOT_PACKS[id] as { writerTemplates?: boolean };
  const prod = writerSchema(stage, SLIDE_TIER_RANGES.standard);
  pack.writerTemplates = true;
  try {
    return pilotRequest(id, stage, prod, (s) => s);
  } finally {
    delete pack.writerTemplates;
  }
}

describe("the writer's schema offers the templates' own defs", () => {
  for (const stage of STAGES)
    test(stage, () => {
      const { schema, caps } = requestWith(stage);
      const defs = schema.$defs as Record<string, J>;
      for (const slot of ["side", "full"] as const) {
        const refs = ((defs[`diagram-${slot}`] as J).anyOf as J[]).map((r) => r.$ref);
        // Each template is offered before the freeform branch, which no longer names it.
        expect(refs.at(-1)).toBe("#/$defs/diagram-freeform");
        expect(refs).toContain(`#/$defs/dg-river-${slot}`);
        expect(refs).toContain("#/$defs/dg-hydrograph");
      }
      expect(defs["dg-hydrograph-side"]).toBeUndefined();
      for (const k of ["dg-river-side", "dg-river-full", "dg-hydrograph"]) {
        expect(defs[k], k).toBeDefined();
        expect(openaiSchemaFaults(defs[k], true), k).toEqual([]);
      }
      const free = ((defs["diagram-freeform"] as J).properties as J).kind as J;
      expect(free.enum).toEqual(["labelled-diagram", "particles", "cubes"]);
      // The caps request carries the same defs, so code checks what the writer was offered.
      expect(((caps as J).$defs as J)["dg-river-full"]).toBeDefined();
    });

  test("a pack without the switch is unchanged (v4.16 as shipped)", () => {
    const prod = writerSchema("KS3-5", SLIDE_TIER_RANGES.standard);
    const { schema } = pilotRequest("v4.16", "KS3-5", prod, (s) => s);
    const defs = schema.$defs as Record<string, J>;
    expect(defs["dg-river-side"]).toBeUndefined();
    expect(((defs["diagram-freeform"] as J).properties as J).kind).toMatchObject({
      enum: expect.arrayContaining(["river", "hydrograph"]),
    });
  });

  test("v4.16's whole request is byte-identical to master's (sha256 pinned from origin/master)", () => {
    const pinned: Record<WriterStage, string> = {
      KS1: "dbc2e279b56a834f",
      KS2: "d47ef80203e766ce",
      "KS3-5": "45c8aa3a590290ba",
    };
    for (const stage of STAGES) {
      const r = pilotRequest(
        "v4.16",
        stage,
        writerSchema(stage, SLIDE_TIER_RANGES.standard),
        (s) => s,
      );
      const hash = createHash("sha256").update(JSON.stringify(r)).digest("hex").slice(0, 16);
      expect(hash).toBe(pinned[stage]);
    }
  });

  test("the request grows by about 3,000 characters per key stage (logged)", () => {
    for (const stage of STAGES) {
      const prod = writerSchema(stage, SLIDE_TIER_RANGES.standard);
      const before = JSON.stringify(pilotRequest("v4.16", stage, prod, (s) => s).schema).length;
      const after = JSON.stringify(requestWith(stage).schema).length;
      console.log(`${stage}: writer schema ${before} -> ${after} (+${after - before} chars)`);
      expect(after - before).toBeGreaterThan(0);
      expect(after - before).toBeLessThan(3500);
    }
  });
});

describe("the early-Oct Sol specs (R3 CF runs, DIAGRAM-AUDIT) parse and render", () => {
  test("the fixture holds both templates and every river view", () => {
    expect(new Set(rows.map((r) => r.spec.kind))).toEqual(new Set(WRITER_TEMPLATES));
    expect(new Set(rows.filter((r) => r.spec.kind === "river").map((r) => r.spec.view))).toEqual(
      new Set(["v-valley", "meander-section", "meander-plan"]),
    );
  });
  for (const r of rows)
    test(`${r.run} ${r.brief} s${r.slide} (${r.spec.kind})`, async () => {
      const f = asSent(r.spec);
      const a = ask(f);
      expect(a.spec).toBeDefined();
      const drawn = await drawWriterDiagram(a, {
        callDrawer: noCall,
        drawerSystem: "",
        theme: studio,
      });
      expect(drawn.fault).toBe("");
      expect(drawn.via).toBe("code");
      const el = writerDiagramElement(drawn.spec, studio, "ks3", { x: 0, y: 0, w: 788, h: 235 });
      expect(el).toBeDefined();
      const svg = svgOfDataUrl(String(el?.src));
      expect(svg).toContain("<svg");
      // The labels a pupil reads are drawn; the parts' own names never reach the slide's words.
      for (const l of (r.spec.labels as { text: string }[] | undefined) ?? [])
        expect(svg).toContain(l.text);
      for (const w of labelsOf(a.spec)) expect(w).not.toMatch(/^[a-z]+(-[a-z]+)+$/);
    });
});

describe("a bad writer spec falls back to the drawer (never an empty slot)", () => {
  const bad: J = {
    kind: "river",
    shows: "How a V-shaped valley forms",
    alt: "A V-shaped valley.",
    title: null,
    view: "v-valley",
    labels: [{ part: "river-cliff", text: "River cliff" }],
  };
  const drawer: J = {
    kind: "river",
    alt: "A V-shaped valley.",
    view: "v-valley",
    labels: [{ part: "valley-side", text: "Valley side" }],
  };

  test("a part its view does not have goes to the drawer with the fault", async () => {
    let user = "";
    const r = await drawWriterDiagram(ask(bad), {
      callDrawer: async (req) => {
        user = req.user;
        return { out: drawer };
      },
      drawerSystem: "",
      theme: studio,
    });
    expect(r.via).toBe("drawer");
    expect((r.spec as J).view).toBe("v-valley");
    expect(user).toContain("River cliff");
    // The view is no label (labelsOf); the fault names the view's own parts (TEACH-247 part cg).
    expect(user).not.toMatch(/Labels: [^\n]*v-valley/);
    expect(user).toContain("no river-cliff in a v-valley; its parts are valley-side, channel");
    expect(user).toContain(
      "Parts of a v-valley: valley-side, channel, river-bed, vertical-erosion",
    );
  });

  test("a hydrograph with a negative value goes to the drawer", async () => {
    const h = asSent(rows.find((x) => x.spec.kind === "hydrograph")?.spec as J);
    h.values = { peakRainfall: -4, peakDischarge: null, baseFlow: null, lagHours: null };
    let called = 0;
    const r = await drawWriterDiagram(ask(h), {
      callDrawer: async () => {
        called += 1;
        return { out: { kind: "hydrograph", alt: "A storm hydrograph.", shape: "flashy" } };
      },
      drawerSystem: "",
      theme: studio,
    });
    expect(called).toBe(1);
    expect(r.via).toBe("drawer");
  });

  test("when the drawer fails too, the stage restages (no spec, a fault), never draws nothing", async () => {
    const r = await drawWriterDiagram(ask(bad), {
      callDrawer: async () => ({ out: "garbage" }),
      drawerSystem: "",
      theme: studio,
    });
    expect(r.via).toBe("none");
    expect(r.spec).toBeUndefined();
    expect(r.fault).not.toBe("");
  });

  test("an old freeform figure ({kind, shows, labels}) still goes to the drawer", () => {
    const f = { kind: "river", shows: "A meander", labels: ["River cliff", "Slip-off slope"] };
    expect(writerSpecOf(f)).toBeUndefined();
    expect(ask(f).labels).toEqual(["River cliff", "Slip-off slope"]);
  });
});

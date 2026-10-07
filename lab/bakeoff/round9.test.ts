// Round 9 build (regression audit): no label strings, slot-aware drawer limits, fit in characters,
// picture reroute faults, currency symbol. $0.
import { describe, expect, test } from "bun:test";
import {
  SLOT_LIMITS,
  slotBox,
  slotLimitLine,
  slotOf,
} from "../../packages/slides/src/diagrams/limits";
import { SLOT_TABLE } from "../../packages/slides/src/diagrams/slot-limits.gen";
import { armT as T } from "./arm-t";
import { charsOver, diagramContext, lostFault, repairTerms } from "./harness";
import { ENGLAND, INDIA, localise } from "./locale";
import { addedParts, capDrawerSchema, isMapRequest } from "./services";
import { measure } from "./slot-limits";

describe("round 9: no label strings", () => {
  test("a diagram that cannot be shown adds none of its labels to the slide", () => {
    const s = {
      template: "visual-text",
      heading: "Why did prices rise?",
      lead: "Germany printed money to pay workers.",
      points: ["Prices rose fast."],
      figure: {
        kind: "flow",
        shows: "the chain",
        labels: ["Ruhr occupied", "Workers resist", "Money printed"],
        ask: "Follow the arrows.",
        ask_without: "Explain the chain.",
      },
    };
    const w = T.asWords?.(s as never, { keepPointing: true }) as Record<string, unknown>;
    const text = JSON.stringify(w);
    expect(text).not.toContain("Ruhr occupied; Workers resist");
    expect((w.points as unknown[]).length).toBe(1);
  });
  test("the stand-alone fault names the lost figure and its parts", () => {
    const f = lostFault({ type: "diagram", kind: "flow", shows: "the chain", labels: ["A", "B"] });
    expect(f).toStartWith('missing: the flow diagram of "the chain"');
    expect(f).toContain("its parts: A, B");
    expect(
      lostFault({ type: "photo", shows: "a map of South America" }, "a schematic map"),
    ).toContain("(a schematic map)");
  });
});

describe("round 9: diagram slots measured from the layouts", () => {
  test("beside text is the layout's real 348 x 284 box, across is the big diagram's", () => {
    expect(slotBox("ks3", "side")).toEqual({ w: 348, h: 284 });
    expect(slotBox("ks1", "full").w).toBe(788);
    expect(slotOf("big-visual")).toBe("full");
    expect(slotOf("practice")).toBe("side");
    expect(
      diagramContext({ template: "visual-text", figure: { ask: "Look." } }, "ks3").slot,
    ).toMatchObject({ w: 348, h: 284, name: "side" });
  });
  test("a flow fits fewer boxes beside text than across, and the drawer is told its slot's numbers", () => {
    for (const g of ["KS1", "KS2", "KS3-5"] as const) {
      const side = SLOT_LIMITS.limits[g].side.flow;
      const full = SLOT_LIMITS.limits[g].full.flow;
      expect(side && full && side.items <= full.items).toBe(true);
    }
    expect(slotLimitLine("flow", "ks1", "side")).toContain(
      `up to ${SLOT_LIMITS.limits.KS1.side.flow?.items} boxes`,
    );
  });
  test("the generated table is what the renderer measures today (regenerate: bun lab/bakeoff/slot-limits.ts)", () => {
    expect(JSON.parse(JSON.stringify(measure()))).toEqual(JSON.parse(JSON.stringify(SLOT_TABLE)));
  }, 120_000);
});

describe("round 9: the drawer adds nothing beyond the request", () => {
  const schema = {
    type: "object",
    properties: {
      title: { anyOf: [{ type: "string" }, { type: "null" }] },
      nodes: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
    },
  };
  test("nodes are capped at the slot and at the request's labels; no title", () => {
    const c = capDrawerSchema(schema, "flow", 4, 3) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(c.properties.nodes?.maxItems).toBe(3);
    expect(c.properties.title).toEqual({ type: "null" });
    expect((capDrawerSchema(schema, "flow", 2, 5) as typeof c).properties.nodes?.maxItems).toBe(2);
  });
  test("an added box or title is a fault (one retry)", () => {
    expect(addedParts({ nodes: ["a", "b", "c", "d", "e"] }, "flow", ["a", "b", "c"])).toContain(
      "5 nodes where the request names 3",
    );
    expect(
      addedParts({ title: "Flat = finished", annotations: [] }, "line-graph", [
        "Time / s",
        "Volume",
      ]),
    ).toContain("title");
    expect(addedParts({ nodes: ["a", "b"] }, "flow", ["a", "b", "then"])).toBe("");
  });
});

describe("round 9: fit faults in characters", () => {
  const slide = {
    template: "practice",
    heading: "Prices",
    questions: ["x".repeat(300), "Short?"],
    instruction: "Answer in full sentences.",
    figure: { kind: "table", shows: "t", labels: [] },
  };
  test("the repair is told which field and how many characters over", () => {
    const f = repairTerms("overflow: questions 354/328pt", slide, "KS3-5");
    expect(f).toMatch(/^overflow: questions\[1\]: 300 characters, room \d+ \(\d+ over\)/);
    const full = repairTerms(
      "overflow: questions 354/328pt",
      { ...slide, questions: ["x".repeat(220), "y".repeat(220), "z".repeat(220)] },
      "KS3-5",
    );
    expect(full).toContain("all the slide's text:");
    expect(charsOver({ ...slide, questions: ["Short?"] }, "KS3-5")).toEqual([]);
  });
  test("a fault no field explains is said as a share, never 'about N lines'", () => {
    const f = repairTerms("overflow: compare picture 288/255pt", { template: "compare" }, "KS1");
    expect(f).not.toContain("line");
    expect(f).toContain("12% fewer characters");
  });
});

describe("round 9: pictures and locale", () => {
  test("a map request is searched as a real source first", () => {
    expect(isMapRequest("A world map with South America marked")).toBe(true);
    expect(isMapRequest("A mapmaker's tools")).toBe(false);
  });
  test("money is the symbol, the ISO code kept apart", () => {
    expect(localise("money uses {{locale.currency}}", ENGLAND)).toBe("money uses £");
    expect(localise("{{locale.currency}}", INDIA)).toBe("₹");
    expect(ENGLAND.currencyCode).toBe("GBP");
  });
});

describe("round 9 review: restaging, look and exact labels", () => {
  test("a sequence kind that cannot be restaged becomes its parts as steps, one per line", () => {
    const { fixedFallback } = require("./harness");
    const r = fixedFallback(
      {
        template: "visual-text",
        heading: "Why prices rose",
        lead: "Look at the chain.",
        points: [],
      },
      { type: "diagram", kind: "flow" },
      ["Ruhr occupied", "Workers strike", "Money printed"],
      5,
    );
    expect(r.how).toBe("sequence-as-steps");
    expect(r.slide.points).toEqual(["Ruhr occupied", "Workers strike", "Money printed"]);
    expect(JSON.stringify(r.slide)).not.toContain(";");
  });
  test("any other kind drops its figure and the sentences that point at it", () => {
    const { fixedFallback } = require("./harness");
    const r = fixedFallback(
      {
        template: "visual-text",
        heading: "Maps",
        lead: "Look at the map. The Amazon is the largest rainforest.",
        points: ["Trace the river to the sea.", "It holds 10% of species."],
        figure: { shows: "map" },
      },
      { type: "photo" },
      [],
      0,
    );
    expect(r.how).toBe("figure-dropped");
    expect(r.slide.template).toBe("explain");
    expect(r.slide.lead).toBe("The Amazon is the largest rainforest.");
    expect(r.slide.points).toEqual(["It holds 10% of species."]);
    expect(r.slide.figure).toBeNull();
  });
  test("a look that names a picture adds one when the slide asks for none", () => {
    const { withLook } = require("./harness");
    const r = withLook(
      { template: "explain", heading: "H", lead: "L", points: [] },
      { kind: "picture", shows: "a frog on a lily pad" },
    );
    expect(r.how).toBe("explain-to-visual-text");
    expect(r.slide.figure.shows).toBe("a frog on a lily pad");
    expect(
      withLook({ template: "explain", heading: "H" }, { kind: "none", shows: null }).how,
    ).toBeUndefined();
  });
  test("exact labels: a cycle holds exactly the requested stages; a table is not capped by its labels", () => {
    const cyc = {
      type: "object",
      properties: { steps: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 } },
    };
    const c = capDrawerSchema(cyc, "cycle", 5, 4) as {
      properties: { steps: { minItems: number; maxItems: number } };
    };
    expect([c.properties.steps.minItems, c.properties.steps.maxItems]).toEqual([4, 4]);
    expect(addedParts({ steps: ["a", "b", "c"] }, "cycle", ["a", "b", "c", "d"])).toContain(
      "3 steps where the request names 4",
    );
    const tab = { type: "object", properties: { rows: { type: "array", items: {}, maxItems: 8 } } };
    expect(
      (capDrawerSchema(tab, "table", 6, 3) as { properties: { rows: { maxItems: number } } })
        .properties.rows.maxItems,
    ).toBe(6);
    const eg = {
      type: "object",
      properties: { groups: { type: "integer", minimum: 2, maximum: 10 } },
    };
    expect(
      (capDrawerSchema(eg, "equal-groups", 8, 0) as { properties: { groups: { maximum: number } } })
        .properties.groups.maximum,
    ).toBe(8);
  });
  test("a restage may lose its figure and pointing words, never an item", () => {
    const { judgeRepair } = require("./repair");
    const before = {
      template: "practice",
      heading: "Q",
      questions: ["One?", "Two?"],
      figure: { kind: "table", shows: "t" },
    };
    const lost = judgeRepair(
      before,
      { template: "practice", heading: "Q", questions: ["One?"], figure: null },
      [],
      { restage: true },
    );
    expect(lost.ok).toBe(false);
    const ok = judgeRepair(
      before,
      { template: "practice", heading: "Q", questions: ["One?", "Two?"], figure: null },
      [],
      { restage: true },
    );
    expect(ok.ok).toBe(true);
  });
});

// A/B lab/ab: round 5's director v11 has no veto or final flag (finalDirection is round 9 code), so this is skipped here.
describe.skip("round 9 review: the writer's picture decision is final for the director", () => {
  test("a veto becomes the plain route; illustration lessons never get stock photos for generic subjects", () => {
    const { finalDirection } = require("../../packages/generation/src/stages/picture-director");
    const ask = {
      text: "a frog",
      named: null,
      writer: { shows: "a frog", mustShow: ["frog"], final: true },
      look: { style: "illustration" },
    };
    const d = finalDirection({ route: "pexels", veto: "schematic", pictures: [] }, ask);
    expect(d.route).toBe("library-or-generate");
    expect(d.pictures[0].shows).toBe("a frog");
    expect(
      finalDirection(undefined, { ...ask, named: "Amazon river", look: undefined }).route,
    ).toBe("commons");
    const free = { route: "none", pictures: [] };
    expect(finalDirection(free, { ...ask, writer: { ...ask.writer, final: false } })).toBe(free);
  });
});

import { describe, expect, test } from "bun:test";
import { captionRule, fitsMeasured, LIMITS } from "./limits";
import { meaningFaults, withAskedCounts } from "./meaning";
import { mendSpec } from "./normalise";
import { DIAGRAM_KINDS } from "./schema";
import { drawerJsonSchema, openaiSchemaFaults, strictForm } from "./wire";

describe("round 8 drawer fix", () => {
  test("every kind's drawer schema is strict-mode clean", () => {
    for (const k of DIAGRAM_KINDS) {
      const { $schema: _s, ...open } = drawerJsonSchema(k);
      expect(openaiSchemaFaults(strictForm(open), true)).toEqual([]);
    }
  });
  test("round 7 shapes are unrepresentable", () => {
    const flow = strictForm(drawerJsonSchema("flow")) as {
      properties: object;
      additionalProperties: boolean;
    };
    const parts = strictForm(drawerJsonSchema("particles")) as { properties: object };
    expect(flow.additionalProperties).toBe(false);
    expect(Object.keys(flow.properties)).not.toContain("steps");
    expect(Object.keys(flow.properties)).not.toContain("layout");
    expect(Object.keys(parts.properties)).not.toContain("states");
    expect(Object.keys(parts.properties)).not.toContain("captions");
  });
  test("subject terms pass the measured limits", () => {
    expect(fitsMeasured("Maintenance rehearsal", LIMITS.flow.link)).toBe(true);
    expect(fitsMeasured("Below activation energy", captionRule(2))).toBe(true);
    expect(
      fitsMeasured("Electrostatic attraction between oppositely charged ions", LIMITS.flow.link),
    ).toBe(false);
    const flow = {
      kind: "flow",
      alt: "Memory stores.",
      nodes: ["Sensory register", "Short-term memory", "Long-term memory"],
      links: [
        { from: 0, to: 1, label: "Attention" },
        { from: 1, to: 2, label: "Maintenance rehearsal" },
      ],
    };
    expect(meaningFaults(flow)).toBe("");
    const coll = {
      kind: "particles",
      alt: "Two collisions.",
      show: "collision",
      panels: [
        { state: "gas", caption: "Below activation energy", outcome: "bounces", impact: "low" },
        { state: "gas", caption: "Enough energy", outcome: "reacts", impact: "high" },
      ],
    };
    expect(meaningFaults(coll)).toBe("");
  });
  test("a labelled per-group count shows", () => {
    const g = {
      kind: "equal-groups",
      alt: "a",
      total: 12,
      groups: 4,
      show_count: "none",
      unknown: true,
    };
    expect(withAskedCounts(g, ["3", "3", "3", "3"])).toEqual({
      kind: "equal-groups",
      alt: "a",
      total: 12,
      groups: 4,
      show_count: "each",
    });
    expect(withAskedCounts(g, [])).toBe(g);
    expect(withAskedCounts({ kind: "flow" }, ["3"])).toEqual({ kind: "flow" });
  });
  test("a meaning spec is checked as sent, not after the mend", () => {
    const flow = {
      kind: "flow",
      alt: "Branches.",
      nodes: ["(x + 3)(x − 4) = 0", "x + 3 = 0", "x = −3", "x − 4 = 0", "x = 4"],
      links: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
        { from: 0, to: 3 },
        { from: 3, to: 4 },
      ],
    };
    expect(meaningFaults(flow)).toBe("");
    // The mended (drawn) form has layout/steps, which the meaning schema refuses.
    expect(meaningFaults(mendSpec(flow))).toContain("Unrecognized keys");
  });
});

test("a graph with two arrows out of one box draws (y12 multi-store, full zone)", async () => {
  const { fromMeaning, renderDiagram } = await import("./index");
  const { getTheme, atKeyStage } = await import("../themes");
  const spec = {
    kind: "flow",
    alt: "Memory stores.",
    title: "How information moves",
    nodes: ["Sensory register", "Short-term memory", "Long-term memory"],
    links: [
      { from: 0, to: 1, label: "Attention" },
      { from: 1, to: 2, label: "Maintenance rehearsal" },
      { from: 1, to: 1, label: "Rehearsal" },
      { from: 2, to: 1, label: "Retrieval" },
      { from: 0, to: "out", label: "Decay" },
      { from: 1, to: "out", label: "Decay" },
      { from: 1, to: "out", label: "Displacement" },
    ],
  };
  const svg = renderDiagram(fromMeaning(spec) as never, atKeyStage(getTheme("studio"), "ks5"), {
    w: 844,
    h: 380,
  });
  expect(svg?.match(/<rect/g)?.length).toBe(3);
  expect(svg).toContain("displacement");
});

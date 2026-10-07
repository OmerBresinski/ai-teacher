import { describe, expect, test } from "bun:test";
import { resolveAsks } from "../arm-t";
import { lookOf } from "../harness";
import { AB_CONFIG, abArm, abShared, isAbArm, menuKinds, schemaKinds, setAbArm } from "./arms";
import { continueForFit } from "./continue";

describe("A/B arms", () => {
  test("arm argument values and their code deltas", () => {
    expect(["base", "a1", "a2", "a3"].every(isAbArm)).toBe(true);
    expect(isAbArm("T")).toBe(false);
    expect(AB_CONFIG.base).toMatchObject({ ask: false, kinds: [], meaningKinds: [] });
    expect(AB_CONFIG.a1).toMatchObject({ ask: false, kinds: [], meaningKinds: [] });
    expect(AB_CONFIG.a2).toMatchObject({ ask: true, meaningKinds: [] });
    expect(AB_CONFIG.a3.meaningKinds.sort()).toEqual(["equal-groups", "flow", "fraction-shapes"]);
  });
  test("shared prompt folder follows the run's arm, none outside A/B", () => {
    setAbArm(undefined);
    expect(abShared()).toBeUndefined();
    setAbArm("a2");
    expect(abArm()).toBe("a2");
    expect(abShared()).toMatch(/\/ab\/prompts\/a2\/shared$/);
    setAbArm(undefined);
  });
  test("menu kinds and schema kinds are read the same way", () => {
    const sys = "x\n\nDiagram kinds:\n- flow: boxes. Fits: a.\n- table: rows.\n\nnext";
    expect(menuKinds(sys)).toEqual(["flow", "table"]);
    expect(
      schemaKinds({ $defs: { diagram: { properties: { kind: { enum: ["flow", "table"] } } } } }),
    ).toEqual(["flow", "table"]);
  });
});

describe("round 5 schema in the round 9 code", () => {
  test("look_at is read as the flow's look; neither field means no look", () => {
    expect(lookOf({ look_at: { kind: "picture", shows: null } })).toEqual({
      kind: "picture",
      shows: "",
    });
    expect(
      lookOf({ look: { kind: "diagram", shows: "a" }, look_at: { kind: "none", shows: null } }),
    ).toEqual({
      kind: "diagram",
      shows: "a",
    });
    expect(lookOf({})).toBeUndefined();
    expect(lookOf(undefined)).toBeUndefined();
  });
  test("resolveAsks leaves a slide without ask fields unchanged (base, a1, a3)", () => {
    const s = {
      template: "visual-text",
      heading: "h",
      lead: "Look at the diagram.",
      points: ["a"],
      figure: { kind: "flow", shows: "s", labels: ["a", "b"] },
    };
    const lost = resolveAsks(structuredClone(s), () => false);
    expect(lost).toEqual(resolveAsks(structuredClone(s), () => true));
    expect(lost.lead).toBe(s.lead);
  });
});

describe("continuation slides (the strip never ships overflow)", () => {
  const fitsN = (n: number) => (s: Record<string, unknown>) =>
    ((s.points ?? s.questions) as unknown[]).length <= n;
  test("items carry on, in order, the first slide keeping its lead", () => {
    const s = { template: "explain", heading: "H", lead: "L", points: ["a", "b", "c", "d", "e"] };
    const c = continueForFit(s, fitsN(2));
    expect(c?.first).toEqual({ ...s, points: ["a", "b"] });
    expect(c?.rest.map((x) => x.points)).toEqual([["c", "d"], ["e"]]);
    expect(c?.rest[0]).toMatchObject({ template: "explain", heading: "H", lead: "" });
  });
  test("questions split the same way; nothing to split or one item too big gives undefined", () => {
    const q = {
      template: "practice",
      heading: "H",
      questions: ["1", "2", "3"],
      instruction: "Do",
      picture: null,
    };
    expect(continueForFit(q, fitsN(2))?.rest[0]).toMatchObject({
      questions: ["3"],
      instruction: null,
    });
    expect(
      continueForFit({ template: "explain", heading: "H", lead: "L", points: ["a"] }, fitsN(0)),
    ).toBeUndefined();
    expect(continueForFit(q, () => false)).toBeUndefined();
    expect(continueForFit(q, () => true)).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openaiSchemaFaults } from "../../../packages/slides/src/diagrams/wire";
import { AB, STAGES } from "./arms";
import { flattenR1t, msSchema, r1tSchema } from "./structural";

type J = Record<string, unknown>;
const base = (st: string) =>
  JSON.parse(readFileSync(`${AB}/prompts/base3/T/schema.${st}.json`, "utf8")) as J;

describe("D18 structural arms", () => {
  for (const st of STAGES)
    test(`${st}: both schemas strict-clean and equal to the pinned files`, () => {
      for (const [arm, s] of [
        ["r1t", r1tSchema(base(st))],
        ["ms", msSchema(base(st))],
      ] as const) {
        expect(openaiSchemaFaults(s, true)).toEqual([]);
        const file = JSON.parse(
          readFileSync(`${AB}/prompts/b3-${arm}/T/schema.${st}.json`, "utf8"),
        );
        // Descriptions may arrive later; the shape must match the generator either way.
        expect(JSON.stringify(file).replace(/,"description":"[^"]*"/g, "")).toBe(
          JSON.stringify(s).replace(/,"description":"[^"]*"/g, ""),
        );
      }
    });
  test("r1t: question layouts carry 0-4 tiles of 1-2 must_see; every item needs needs_picture", () => {
    const s = r1tSchema(base("KS1"));
    const d = s.$defs as Record<string, J & { properties: J }>;
    for (const t of ["question-set", "practice"]) {
      expect(d[t]?.properties.picture).toBeUndefined();
      expect(d[t]?.properties.pictures).toMatchObject({ minItems: 0, maxItems: 4 });
    }
    expect((d.tile as J & { properties: J }).properties.must_see).toMatchObject({ maxItems: 2 });
    expect(d.item?.required).toEqual(["text", "needs_picture"]);
  });
  test("ms: misconception is nullable and sits before the flow", () => {
    const s = msSchema(base("KS2"));
    expect(Object.keys(s.properties as J)).toEqual([
      "design",
      "misconception",
      "flow",
      "title",
      "slides",
    ]);
  });
  test("flattenR1t gives the harness its old shape", () => {
    const tile = { shows: "a calf", must_see: ["calf"], subject: "generic" };
    const out = flattenR1t({
      template: "question-set",
      heading: "Match",
      questions: [{ text: "Which is the calf?", needs_picture: true }],
      instruction: { text: "Point and say.", needs_picture: true },
      pictures: [tile, { ...tile, shows: "a cow" }],
    });
    expect(out).toEqual({
      template: "question-set",
      heading: "Match",
      questions: ["Which is the calf?"],
      instruction: "Point and say.",
      picture: tile,
      tiles: [{ ...tile, shows: "a cow" }],
    });
    expect(flattenR1t({ template: "title", lead: { text: "Hi", needs_picture: false } }).lead).toBe(
      "Hi",
    );
  });
});

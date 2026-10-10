import { describe, expect, test } from "bun:test";
import { catalogue, libSchema, libSystem, subjectToken, yearToken } from "./catalogue";

/*
 * Library turn-on step 4 (CROSSCHECK point 1, flag `libraryMenuFilter`): a Y1 science prompt
 * carried 38 KS1 models, mostly maths. Filtered, the writer sees the models for the lesson's year
 * and subject (general representations kept); the schema enum is built from the same list, and an
 * empty list adds no Models block, kind line or schema branch.
 */
const ids = async (stage: "KS1" | "KS2" | "KS3-5", yearGroup?: string, subject?: string) =>
  (await catalogue(stage, yearGroup && subject ? { yearGroup, subject } : undefined)).map(
    (e) => e.id,
  );

describe("menu filter by year and subject", () => {
  test("year and subject tokens", () => {
    expect(yearToken("Year 1")).toBe("Y1");
    expect(yearToken("Year 8")).toBe("KS3");
    expect(yearToken("Year 12")).toBe("KS5");
    expect(yearToken("Reception")).toBe("Reception");
    expect(subjectToken("Mathematics")).toEqual(["Maths"]);
    expect(subjectToken("Biology")).toEqual(["Science"]);
    expect(subjectToken("Psychology")).toBeUndefined();
  });
  test("y1 science: no maths-only models, science and general ones kept", async () => {
    const all = await ids("KS1");
    const y1 = await ids("KS1", "Year 1", "Science");
    expect(all.length).toBe(38);
    expect(y1).not.toContain("fractions");
    expect(y1).not.toContain("heart_circulation"); // Y2 and Y6 only
    expect(y1).toContain("life_cycle");
    expect(y1).toContain("data_chart");
    expect(y1.length).toBeLessThan(all.length);
  });
  test("y6 science keeps the heart; y5 maths keeps fractions; y4 geography keeps rivers", async () => {
    expect(await ids("KS2", "Year 6", "Science")).toContain("heart_circulation");
    expect(await ids("KS2", "Year 5", "Maths")).toContain("fractions");
    expect(await ids("KS2", "Year 4", "Geography")).toContain("rivers_coasts");
  });
  test("y12 psychology: empty, so no Models block and no model schema branch", async () => {
    const e = await catalogue("KS3-5", { yearGroup: "Year 12", subject: "Psychology" });
    expect(e).toEqual([]);
    const base = "Intro\nDiagram kinds:\n- bar-chart: bars\nAfter";
    expect(libSystem(base, e)).toBe(base);
    const schema = { $defs: { "diagram-full": { anyOf: [] } } };
    expect(
      libSchema(
        schema,
        e.map((x) => x.id),
      ),
    ).toEqual(schema);
  });
  test("the schema enum is the filtered list", async () => {
    const e = await catalogue("KS2", { yearGroup: "Year 6", subject: "Science" });
    const s = libSchema(
      { $defs: { "diagram-full": { anyOf: [] } } },
      e.map((x) => x.id),
    ) as {
      $defs: Record<string, { properties?: { model?: { enum?: string[] } } }>;
    };
    expect(s.$defs["dg-model-full"]?.properties?.model?.enum).toEqual(e.map((x) => x.id));
  });
});

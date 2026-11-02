import { afterAll, describe, expect, test } from "bun:test";
import { modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { catalogue, libSchema, libSystem, subjectToken, yearToken } from "./catalogue";
import { libraryDiagram } from "./fill";
import { endDrawThread } from "./guard";
import { loadModel } from "./render";

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
  test("y8 maths keeps the balance (TEACH-247 part cl): a KS3 equations lesson had no maths model", async () => {
    expect(await ids("KS3-5", "Year 8", "Maths")).toContain("balance_equations");
    expect(await ids("KS3-5", "Year 8", "Science")).not.toContain("balance_equations");
    expect(await ids("KS3-5", "Year 12", "Maths")).not.toContain("balance_equations"); // KS3 only
  });
  test("the KS3 balance preset draws at KS3 slide size through the writer's path", async () => {
    const theme = getTheme("studio", "ks3" as never);
    const place = modelBodyRect("Solve 3x + 2 = x + 10", undefined, theme, "ks3" as never);
    const m = await loadModel("balance_equations");
    const pre = m?.presets.find((p) => p.id === "ks3-both-sides");
    expect(pre).toBeDefined();
    const r = await libraryDiagram(
      {
        key: "d",
        model: "balance_equations",
        intent: "Solve an equation with the unknown on both sides",
        words: "",
        heading: "",
        caption: "",
        yearGroup: "Year 7",
        lesson: "Maths: solving equations",
        labelOverlap: true,
        labelFloor: true,
        font: theme.fonts.body,
        place,
      },
      async () => ({ ...(pre?.params ?? {}) }),
    );
    expect(r.ok ? "ok" : r.reason).toBe("ok");
    // the working ends by dividing both sides by 2 (x = 4 is drawn as separate runs)
    if (r.ok) expect(r.drawing.svg).toContain("÷ 2 on both sides");
  }, 60_000);
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

afterAll(() => endDrawThread());

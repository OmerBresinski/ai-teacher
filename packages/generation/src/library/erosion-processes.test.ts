import { afterAll, describe, expect, test } from "bun:test";
import { modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import type { WriterStage } from "../writer/schema";
import { catalogue, EXCLUDED, libSchema, type MenuFilter } from "./catalogue";
import { capabilityRefusals, libraryDiagram } from "./fill";
import { endDrawThread } from "./guard";
import { MODEL_LOADERS } from "./models";
import { kit } from "./render";
import type { J, LibModel } from "./types";

/*
 * TEACH-247 part cl: erosion and transport processes. A Y9 rivers deck listed the four erosion
 * processes as numbered text with no pictures; the standard teaching is four small diagrams. The
 * model draws each process's own mechanism and names it one build at a time, each name first a
 * letter so a question slide can ask for it.
 *
 * TEACH-247 part cq: held off the writer's menu until it is redrawn to the bar (diagram audit,
 * 2 Nov 2026). The code stays and its science checks still run here, on the model itself; the
 * drawing tests come back with the redraw.
 */
afterAll(() => endDrawThread());

/** The held model, straight from its code (production does not load it). */
const model = async (): Promise<LibModel> => {
  await kit();
  return (await import("./vendor/models/erosion_processes.js")) as unknown as LibModel;
};
const refusals = async (p: J) => {
  const m = await model();
  const v = m.validate((await kit()).withDefaults(m.params, p));
  return v.refusals.map((r) => `${r.path}: ${r.reason}`);
};
describe("erosion_processes refuses a process described as another", () => {
  test("the presets are true", async () => {
    const m = await model();
    for (const p of m.presets) expect(await refusals(p.params)).toEqual([]);
  });

  test("a process listed twice is refused", async () => {
    expect((await refusals({ erosion: ["abrasion", "attrition", "abrasion"] })).join("\n")).toMatch(
      /erosion\.2: Abrasion is in the list twice/,
    );
  });

  test("a reworded line that describes the wrong process is refused", async () => {
    const bad: [string, string, RegExp][] = [
      [
        "attrition",
        "Rocks wear away the river banks",
        /wearing the bed, banks or cliff is abrasion/,
      ],
      ["abrasion", "Rocks hit each other and break", /rocks hitting each other is attrition/],
      ["hydraulic", "Pebbles carried by the water hit the bank", /is abrasion/],
      ["solution", "Rocks scrape the bed", /dissolving/],
      ["solution", "The river wears the bed away", /must say so/],
      ["traction", "Boulders bounce along", /bouncing is saltation/],
      ["saltation", "Pebbles roll along the bed", /rolling is traction/],
      ["suspension", "Minerals dissolved in the water", /dissolved minerals are solution/],
      ["dissolved", "Silt floating in the water", /suspension/],
    ];
    for (const [id, line, why] of bad)
      expect((await refusals({ text: { [`label:line:${id}`]: line } })).join("\n"), line).toMatch(
        why,
      );
    expect(
      await refusals({ text: { "label:line:attrition": "Stones collide and get smaller" } }),
    ).toEqual([]);
    expect(
      await refusals({ text: { "label:line:solution": "Acidic water dissolves limestone" } }),
    ).toEqual([]);
  });

  test("a reworded name keeps its process's name", async () => {
    expect(await refusals({ text: { "label:name:solution": "Solution (corrosion)" } })).toEqual([]);
    expect((await refusals({ text: { "label:name:abrasion": "Scraping" } })).join("\n")).toMatch(
      /no longer names abrasion/,
    );
  });
});

describe("erosion_processes captions and notes", () => {
  test("coast captions name waves and the cliff, in good grammar", async () => {
    const m = await model();
    const P = (await kit()).withDefaults(m.params, { setting: "coast" });
    const caps = (m.builds?.(P).steps ?? []).map((s) => s.caption ?? "");
    expect(caps[1]).toMatch(/Waves squeeze air into cracks/);
    expect(caps.join(" ")).not.toMatch(/Waves squeezes/);
    expect(caps[2]).toMatch(/at the cliff/);
    const river = (m.builds?.((await kit()).withDefaults(m.params, {})).steps ?? []).map(
      (s) => s.caption ?? "",
    );
    expect(river[1]).toMatch(/Fast water squeezes air into cracks/);
  });

  test("notes make no universal claim of 'most'", async () => {
    const m = (await model()) as unknown as { notes: (p: J) => { steps: string[] } };
    for (const view of ["erosion", "transport"]) {
      const P = (await kit()).withDefaults((await model()).params, { view });
      for (const n of m.notes(P).steps) expect(n).not.toMatch(/\b(does|carries) most\b/);
    }
  });
});

describe("erosion_processes is held off the writer's menu (TEACH-247 part cq)", () => {
  test("it is not shipped, and the reason is written down", () => {
    expect(MODEL_LOADERS.erosion_processes).toBeUndefined();
    expect(EXCLUDED.erosion_processes).toMatch(/audit/);
  });

  test("its code is kept: the model still loads from its own file", async () => {
    const m = await model();
    expect(m.meta.id).toBe("erosion_processes");
    expect(m.presets.length).toBeGreaterThan(0);
  });

  test("no menu offers it, for any stage, subject or erosion lesson", async () => {
    const asks: [WriterStage, MenuFilter | undefined][] = [
      ["KS3-5", undefined],
      ["KS3-5", { yearGroup: "Year 9", subject: "Geography" }],
      ["KS3-5", { yearGroup: "Year 10", subject: "Geography" }],
      [
        "KS3-5",
        {
          yearGroup: "Year 9",
          subject: "Geography",
          objectives: [
            "Describe the processes of erosion: hydraulic action, abrasion and attrition",
          ],
        },
      ],
      ["KS2", undefined],
      ["KS1", undefined],
    ];
    for (const [stage, filter] of asks) {
      const ids = (await catalogue(stage, filter)).map((e) => e.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).not.toContain("erosion_processes");
    }
    // The writer's schema enum is built from the stage's catalogue, so it cannot name it either.
    const base = { $defs: { "diagram-full": { anyOf: [] } } };
    const ids = (await catalogue("KS3-5")).map((e) => e.id);
    const s = libSchema(base, ids) as { $defs: Record<string, J> };
    const def = s.$defs["dg-model-full"] as { properties: { model: { enum: string[] } } };
    expect(def.properties.model.enum).not.toContain("erosion_processes");
  });

  test("a lesson that still asks for it falls back to the drawer, never an error", async () => {
    const theme = getTheme("studio", "ks3" as never);
    const place = modelBodyRect("How rivers erode", undefined, theme, "ks3" as never);
    const r = await libraryDiagram(
      {
        key: "d",
        model: "erosion_processes",
        intent: "Show the four erosion processes",
        words: "",
        heading: "",
        caption: "",
        yearGroup: "Year 9",
        lesson: "Geography: rivers",
        font: theme.fonts.body,
        place,
      },
      async () => ({}),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no shipped model erosion_processes/);
  });

  test("what it cannot draw", () => {
    expect(
      capabilityRefusals("erosion_processes", "how an ox-bow lake forms").length,
    ).toBeGreaterThan(0);
    expect(
      capabilityRefusals("erosion_processes", "caves, arches and stacks").length,
    ).toBeGreaterThan(0);
    expect(capabilityRefusals("erosion_processes", "the four processes of erosion")).toEqual([]);
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { layoutTemplate, modelBody } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { libraryDiagram, placedTypeSize } from "./fill";
import { drawLibraryModel, endDrawThread } from "./guard";

/*
 * Library turn-on step 1 (diagrams-06, flag `libraryModelBody`): the D52 Alib y6 heart drew
 * 1241 x 658 into a 515 x 273 box (scale 0.415), so its 30 px labels showed at 12.5 pt. A model
 * drawn as the slide body sits about 900 x 424 under the heading; a type-floor gate falls back
 * when its smallest words would show under 18 pt where it is placed.
 */
afterAll(() => endDrawThread());

const OLD_BOX = { w: 515, h: 273 }; // the recorded big-visual box (d52 Alib y6 s4)
const BODY = modelBody(100);
const heart = {
  key: "diagram",
  model: "heart_circulation",
  intent: "Show both routes",
  words: "",
  yearGroup: "Year 6",
  lesson: "Science: heart",
};

describe("model body and type floor (diagrams-06)", () => {
  test("the heart's labels are under 18 pt in the old box and at or over 18 pt in the body", async () => {
    const d = await drawLibraryModel("heart_circulation", { showPulse: false });
    const old = placedTypeSize(d.svg, OLD_BOX);
    expect(old.scale).toBeLessThan(0.45);
    expect(old.minPt).toBeLessThan(18);
    const body = placedTypeSize(d.svg, BODY);
    expect(BODY.w).toBe(900);
    expect(BODY.h).toBeGreaterThanOrEqual(420);
    expect(body.minPt).toBeGreaterThanOrEqual(18);
  });

  test("libraryDiagram refuses the heart in the old box and draws it in the body", async () => {
    const filler = async () => ({});
    const small = await libraryDiagram({ ...heart, place: OLD_BOX }, filler);
    expect(small.ok).toBe(false);
    if (!small.ok) expect(small.reason).toContain("floor");
    const big = await libraryDiagram({ ...heart, place: BODY }, filler);
    expect(big.ok).toBe(true);
    // No `place` (the flag off): no gate, today's behaviour.
    expect((await libraryDiagram(heart, filler)).ok).toBe(true);
  });

  test("a body drawing fills the slide under the heading with no caption", async () => {
    const d = await drawLibraryModel("heart_circulation", { showPulse: false });
    const lay = (body: boolean) =>
      layoutTemplate(
        {
          template: "big-diagram",
          heading: "Follow the blood",
          ...(body ? {} : { lead: "Trace both routes, starting at the heart." }),
          figure: {
            drawn: { src: d.src, aspect: d.aspect, bare: true, ...(body ? { body } : {}) },
          },
        } as never,
        getTheme("splash", "ks2" as never),
        "ks2" as never,
      ).slide.elements as { name?: string; x: number; y: number; w: number; h: number }[];
    const before = lay(false).find((e) => e.name === "Diagram");
    const after = lay(true);
    const img = after.find((e) => e.name === "Diagram");
    expect(after.some((e) => e.name === "Caption")).toBe(false);
    expect(img && before && img.w * img.h).toBeGreaterThan(
      1.8 * (before?.w ?? 0) * (before?.h ?? 0),
    );
    expect(img?.x).toBeGreaterThanOrEqual(30);
    expect((img?.x ?? 0) + (img?.w ?? 0)).toBeLessThanOrEqual(930);
    expect((img?.y ?? 0) + (img?.h ?? 0)).toBeLessThanOrEqual(532);
  });
});

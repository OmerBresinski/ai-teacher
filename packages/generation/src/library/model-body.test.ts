import { afterAll, describe, expect, test } from "bun:test";
import { layoutTemplate, modelBody, modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { libraryDiagram, placedTypeSize } from "./fill";
import { drawLibraryModel, endDrawThread } from "./guard";

/*
 * Library turn-on step 1 (diagrams-06, flag `libraryModelBody`): the D52 Alib y6 heart drew
 * 1241 x 658 into a 515 x 273 box (scale 0.415), so its 30 px labels showed at 12.5 pt. A model
 * drawn as the slide body sits under the heading and above the slide's own line (never dropped); a type-floor gate falls back
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

  test("a body drawing keeps the slide's own line under it and fits above it", async () => {
    const d = await drawLibraryModel("heart_circulation", { showPulse: false });
    const LEAD = "Trace both routes, starting at the heart.";
    const theme = getTheme("splash", "ks2" as never);
    const lay = (body: boolean) =>
      layoutTemplate(
        {
          template: "big-diagram",
          heading: "Follow the blood",
          lead: LEAD,
          figure: {
            drawn: { src: d.src, aspect: d.aspect, bare: true, ...(body ? { body } : {}) },
          },
        } as never,
        theme,
        "ks2" as never,
      ).slide.elements as {
        name?: string;
        x: number;
        y: number;
        w: number;
        h: number;
        doc?: unknown;
      }[];
    const before = lay(false).find((e) => e.name === "Diagram");
    const after = lay(true);
    const img = after.find((e) => e.name === "Diagram");
    const cap = after.find((e) => e.name === "Caption");
    // The point is never dropped: it is on the slide, under the drawing, inside the slide.
    expect(JSON.stringify(cap?.doc)).toContain(LEAD);
    expect((img?.y ?? 0) + (img?.h ?? 0)).toBeLessThanOrEqual(cap?.y ?? 0);
    expect((cap?.y ?? 0) + (cap?.h ?? 0)).toBeLessThanOrEqual(540);
    expect(img && before && img.w * img.h).toBeGreaterThan(
      1.4 * (before?.w ?? 0) * (before?.h ?? 0),
    );
    expect(img?.x).toBeGreaterThanOrEqual(30);
    expect((img?.x ?? 0) + (img?.w ?? 0)).toBeLessThanOrEqual(930);
    // The gate's box is the box the layout uses.
    const r = modelBodyRect("Follow the blood", LEAD, theme, "ks2" as never);
    expect(r.h).toBeLessThan(BODY.h);
    expect(img?.h).toBeLessThanOrEqual(r.h);
    expect(img?.w).toBeLessThanOrEqual(r.w);
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { LIB_META } from "./catalogue";
import { libraryDiagram, panelsOff } from "./fill";
import { endDrawThread } from "./guard";
import { loadModel } from "./render";

/*
 * Library turn-on step 2 (diagrams-07, flag `libraryPanelsOff`): the D52 Alib y6 heart fill never
 * set showPulse, so the model default drew a "Beats a minute / At rest 85" panel nobody asked
 * for. Optional panels (lib-meta `optionalPanels`) the fill leaves unset are off unless the
 * writer's intent names them.
 */
afterAll(() => endDrawThread());

// The recorded writer intent and fill (d52 Alib y6 main.json slide 2, calls.jsonl).
const INTENT =
  "Show a simplified Year 6 circulation model with the heart, lungs and body. Clearly show the routes heart → lungs → heart and heart → body → heart, using directional arrows. At the lungs, label that blood collects oxygen from breathed-in air. At the body, label that blood delivers oxygen and nutrients. Show nutrients entering the blood from the small intestine, labelled as nutrients from digested food. Do not imply that all blood passes through the intestine on every journey. Distinguish oxygen-rich and oxygen-poor blood with a key that explicitly says both are red in real life.";
const FILL = { detail: "double", showBody: true, carries: { oxygen: true, food: true } };
const ask = {
  key: "diagram",
  model: "heart_circulation",
  intent: INTENT,
  words: "",
  yearGroup: "Year 6",
  lesson: "Science: heart",
};
const words = (svg: string) =>
  svg.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

describe("optional panels off unless named (diagrams-07)", () => {
  test("flag off: the recorded fill draws the pulse panel (the register's bad outcome)", async () => {
    const r = await libraryDiagram(ask, async () => FILL);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.showPulse).toBe(true);
      expect(words(r.drawing.svg)).toContain("Beats a minute");
    }
  });
  test("flag on: no pulse panel for the recorded intent", async () => {
    const r = await libraryDiagram({ ...ask, panelsOff: true }, async () => FILL);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.showPulse).toBe(false);
      expect(words(r.drawing.svg)).not.toContain("Beats a minute");
    }
  });
  test("an intent that names the pulse keeps it; a fill that sets it keeps its value", () => {
    expect(panelsOff("heart_circulation", {}, "Show the pulse rising during exercise")).toEqual({});
    expect(panelsOff("heart_circulation", { showPulse: true }, INTENT)).toEqual({});
    expect(panelsOff("heart_circulation", {}, INTENT)).toEqual({ showPulse: false });
    expect(panelsOff("fractions", {}, INTENT)).toEqual({});
  });
  test("every optional panel names a boolean param of its model", async () => {
    for (const [id, m] of Object.entries(LIB_META))
      for (const p of m.optionalPanels ?? []) {
        const model = await loadModel(id);
        const props = (
          model?.params as { properties?: Record<string, { type?: string }> } | undefined
        )?.properties;
        const prop = props?.[p.param];
        expect(`${id}.${p.param}:${prop?.type}`).toBe(`${id}.${p.param}:boolean`);
        for (const w of p.when) expect(() => new RegExp(w, "i")).not.toThrow();
      }
  });
});

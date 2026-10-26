import { afterAll, describe, expect, test } from "bun:test";
import { drawLibraryModel, endDrawThread } from "./guard";
import { inspectDrawnSvg, kit, loadModel } from "./render";

// TEACH-251 part ad (romans verify6 s4): the period label "AD 1 to AD 500" was measured to end 18
// units inside the crop and the browser cut its last digit. Every word now has slack inside it.
afterAll(() => endDrawThread());
describe("the crop leaves room for a word's real width", () => {
  test("hist_map at the label floor's scale: each word ends well inside the crop", async () => {
    const m = await loadModel("hist_map");
    const p = (await kit()).withDefaults(m?.params ?? { properties: {} }, {
      region: "uk",
      north: true,
      scaleBar: true,
      events: [{ place: "York", date: "AD 122", label: "Legion base" }],
    });
    const d = await drawLibraryModel("hist_map", p, { typeScale: 1.191, font: "nunito" });
    const { viewBox, words } = inspectDrawnSvg(d.svg);
    const right = (viewBox[0] as number) + (viewBox[2] as number);
    for (const w of words) {
      const room = right - w.x1;
      expect(room, w.words).toBeGreaterThanOrEqual((w.x1 - w.x0) * 0.1);
    }
  }, 60_000);
});

import { afterAll, describe, expect, test } from "bun:test";
import { libraryDiagram } from "./fill";
import { endDrawThread } from "./guard";
import { loadModel } from "./render";

// TEACH-251 part ac (romans verify6 s4): asked for Hadrian's Wall, the fill gave hist_map only a
// region and a north arrow (it has no line for the wall), and the slide showed a bare outline.
afterAll(() => endDrawThread());
const ask = {
  key: "figure",
  model: "hist_map",
  intent: "Highlight the route of Hadrian's Wall from Wallsend to Bowness-on-Solway.",
  words: "",
  heading: "Where was the Roman frontier?",
  caption: "",
  yearGroup: "Year 4",
  lesson: "Why the Romans built Hadrian's Wall",
  logOnly: true,
};
describe("a history map must mark what the slide is about", () => {
  test("a map with only a region and a north arrow is not drawn, even with checks only logged", async () => {
    const r = await libraryDiagram(ask, async () => ({
      region: "uk",
      todayBorders: false,
      north: true,
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("marks nothing");
  }, 30_000);
  test("a map that marks an area or an event is drawn", async () => {
    const m = await loadModel("hist_map");
    const preset = m?.presets.find((p) => {
      const q = p.params as Record<string, unknown>;
      return ["routes", "events", "territories"].some(
        (k) => Array.isArray(q[k]) && (q[k] as unknown[]).length > 0,
      );
    });
    expect(preset).toBeDefined();
    const r = await libraryDiagram(ask, async () => ({ ...(preset?.params ?? {}) }));
    expect(r.ok).toBe(true);
  }, 30_000);
});

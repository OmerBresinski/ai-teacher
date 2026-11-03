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
  // TEACH-247 part da (Great Fire r1 v417u s5): a fill with a region and years only was given up on
  // at once, while a refused fill gets a second turn with the reason.
  test("a blank map gets the second turn a refused fill gets, and its marked answer is drawn", async () => {
    const m = await loadModel("hist_map");
    const preset = m?.presets.find((p) => {
      const q = p.params as Record<string, unknown>;
      return Array.isArray(q.events) && q.events.length > 0;
    });
    expect(preset).toBeDefined();
    const turns: string[] = [];
    const r = await libraryDiagram(ask, async (req) => {
      turns.push(req.user);
      return turns.length === 1 ? { region: "uk", dates: "plain" } : { ...preset?.params };
    });
    expect(turns.length).toBe(2);
    expect(turns[1]).toContain("marks nothing");
    expect(r.ok).toBe(true);
  }, 30_000);
  test("a map still blank after its second turn is not drawn", async () => {
    let turns = 0;
    const r = await libraryDiagram(ask, async () => {
      turns++;
      return { region: "uk", dates: "plain" };
    });
    expect(turns).toBe(2);
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

import { describe, expect, test } from "bun:test";
import { fillSchema, MARKS } from "./fill";
import { loadModel, renderLibraryModel } from "./render";
import type { LibModel, LibRefusal } from "./types";

// TEACH-247: hist_map draws a named wall or frontier along its real course, and a tall map uses
// the height of a wide slot (it filled 486 of an 832 x 326 body: a band above it and a crop from
// the slide's corner).
type Line = { line: [number, number][]; source: string };
const DATA = "./vendor/models/hist_map/data.js";
const frontiers = async (): Promise<Record<string, Line>> => (await import(DATA)).FRONTIERS;
const model = async (): Promise<LibModel> => {
  const m = await loadModel("hist_map");
  if (!m) throw new Error("no hist_map");
  return m;
};
const stepsOf = (m: LibModel, p: Record<string, unknown>) => m.builds?.(p).steps ?? [];
const refused = (m: LibModel, p: Record<string, unknown>) =>
  m.validate(p).refusals.map((r: LibRefusal) => r.path);
const romanBritain = {
  region: "uk",
  dates: "bc-ad",
  dateRange: { from: "AD 40", to: "AD 200" },
  events: [{ place: "York", date: "AD 71", label: "The Romans build a fortress at York" }],
  territories: [{ area: "roman_britain_122", colour: "2" }],
  frontiers: [{ line: "hadrians_wall" }],
};
const PLACE = { w: 832, h: 326 };
const placed = (svg: string) => {
  const [x = 0, y = 0, w = 1, h = 1] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "")
    .split(" ")
    .map(Number);
  const s = Math.min(PLACE.w / w, PLACE.h / h);
  return { x, y, w, h, placedW: w * s };
};

describe("hist_map walls and frontiers", () => {
  test("each line runs where it is: Hadrian's Wall from the Tyne to the Solway, the Antonine Wall from the Forth to the Clyde", async () => {
    const F = await frontiers();
    const within = (f: Line | undefined, lon: [number, number], lat: [number, number]) =>
      !!f && f.line.every(([x, y]) => x >= lon[0] && x <= lon[1] && y >= lat[0] && y <= lat[1]);
    expect(within(F.hadrians_wall, [-3.3, -1.5], [54.85, 55.05])).toBe(true);
    expect(within(F.antonine_wall, [-4.5, -3.5], [55.9, 56.05])).toBe(true);
    // each is drawn after a source, east end first (Wallsend before Bowness, Carriden before Old Kilpatrick)
    for (const f of Object.values(F)) {
      expect(f.line.length).toBeGreaterThanOrEqual(2);
      expect(f.source.length).toBeGreaterThan(20);
      expect(f.line[0]?.[0] ?? 0).toBeGreaterThan(f.line.at(-1)?.[0] ?? 0);
    }
  });

  test("a wall on a map of Britain, in its years, validates and is its own build in date order", async () => {
    const m = await model();
    expect(m.validate(romanBritain).refusals).toEqual([]);
    const steps = stepsOf(m, romanBritain);
    expect(steps.map((s) => s.key)).toEqual(["map", "ev:0", "line:0", "terr:0"]);
    expect(steps[2]?.caption).toBe("AD 122: Hadrian’s Wall, from Wallsend to Bowness-on-Solway.");
  });

  test("a line outside the map's years, off the map, or not in the list is refused, never part drawn", async () => {
    const m = await model();
    const bare = { ...romanBritain, events: [], territories: [] };
    expect(refused(m, { ...bare, dateRange: { from: "AD 300", to: "AD 500" } })).toContain(
      "frontiers.0.line",
    );
    // the closer map of England and Wales stops at 56° N: the Antonine Wall's east end is past it
    expect(
      refused(m, { ...romanBritain, region: "south", frontiers: [{ line: "antonine_wall" }] }),
    ).toEqual(["frontiers.0.line"]);
    expect(refused(m, { ...bare, region: "world" })).toContain("frontiers.0.line");
    expect(refused(m, { ...romanBritain, frontiers: [{ line: "the_great_wall" }] })).toContain(
      "frontiers.0.line",
    );
  });

  test("a map of one year is drawn: items in the range's first or last year are inside it", async () => {
    // romans verify7: the fill gave AD 122 to AD 122 for Hadrian's Wall and the map was refused
    const m = await model();
    const one = {
      ...romanBritain,
      dateRange: { from: "AD 122", to: "AD 122" },
      events: [{ place: "York", date: "AD 122", label: "Hadrian visits Britain" }],
    };
    expect(m.validate(one).refusals).toEqual([]);
    const ends = { ...romanBritain, dateRange: { from: "AD 71", to: "AD 122" } };
    expect(m.validate(ends).refusals).toEqual([]);
    // an end before the start is still refused
    expect(refused(m, { ...romanBritain, dateRange: { from: "AD 200", to: "AD 40" } })).toContain(
      "dateRange.to",
    );
  });

  test("a map marking only a wall is not blank", () => {
    const marks = MARKS.hist_map ?? (() => false);
    expect(marks({ region: "uk", frontiers: [{ line: "hadrians_wall" }] })).toBe(true);
    expect(marks({ region: "uk", frontiers: [] })).toBe(false);
  });

  test("the writer's fill call is asked for walls, and is told what each key is", async () => {
    const m = await model();
    const s = fillSchema(m.params, "hist_map") as {
      properties: Record<
        string,
        { description?: string; items?: { properties: Record<string, { description?: string }> } }
      >;
    };
    expect(Object.keys(s.properties)).toContain("frontiers");
    const F = await frontiers();
    const keys = s.properties.frontiers.items?.properties.line.description ?? "";
    for (const k of Object.keys(F)) expect(keys).toContain(`${k}:`);
    expect(s.properties.frontiers.description).toContain("only when the slide is about that line");
  });

  test("the wall is drawn and named on the map", async () => {
    const d = await renderLibraryModel("hist_map", romanBritain);
    // named beside the line on the map, and on its card in the key
    expect(d.svg.split("Hadrian’s Wall").length - 1).toBeGreaterThanOrEqual(2);
    expect(d.svg).toContain("text.label:line:0");
    expect(d.svg).toContain("stroke: var(--era-1-text)");
  }, 30_000);
});

describe("hist_map in a wide slot", () => {
  test("a tall map takes the slot's height: no band above it, no crop from the slide's corner", async () => {
    const d = await renderLibraryModel("hist_map", romanBritain);
    const { x, y, h, placedW } = placed(d.svg);
    // the crop starts at the drawn marks (the frame at x 64, y 40), not at 0, 0
    expect(x).toBeGreaterThan(30);
    expect(y).toBeGreaterThan(10);
    // the map's frame is nearly the drawing's whole height (it was 512 of 660)
    const frame = /<clipPath[^>]*id="[^"]*-f"[^>]*><rect[^>]*height="([\d.]+)"/.exec(d.svg);
    expect(Number(frame?.[1] ?? 0) / h).toBeGreaterThan(0.9);
    expect(placedW).toBeGreaterThan(500);
  }, 30_000);

  test("a close map's frame clips its coast and today's borders, so the crop does not run past it", async () => {
    const m = await model();
    const p = m.presets.find((q) => q.id === "y4-roman-invasion")?.params ?? {};
    const { x, y } = placed((await renderLibraryModel("hist_map", p)).svg);
    expect(x).toBeGreaterThan(30);
    expect(y).toBeGreaterThan(10);
  }, 30_000);
});

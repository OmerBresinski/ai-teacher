import { afterAll, describe, expect, test } from "bun:test";
import { modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { grownTextFault, libraryDiagram, placedTypeSize } from "./fill";
import { endDrawThread } from "./guard";
import { drawnContentBox, pathWalk } from "./render";

/*
 * HEART1 D: the R1 heart (production, checks only logged) drew at scale 0.51 with its words at
 * 13 pt. Its blood cells were all drawn at the slide's corner, so the crop reached it and the heart
 * drew small. With the floor on and checks only logged, a grown size is kept only when its words
 * draw whole and larger.
 */
afterAll(() => endDrawThread());
const theme = getTheme("splash", "ks2" as never);
const place = modelBodyRect(
  "Two journeys, one system",
  "Blood goes to the lungs for oxygen, back to the heart, then out to the body and back again.",
  theme,
  "ks2" as never,
);
const ask = {
  key: "diagram",
  model: "heart_circulation",
  intent: "Show both routes",
  words: "",
  heading: "",
  caption: "",
  yearGroup: "Year 6",
  lesson: "Science: heart",
  place,
  logOnly: true,
};
const filler = async () => ({ showPulse: false });

describe("the library heart at slide size (HEART1 D)", () => {
  test("it fills its slot, keeping its aspect: at least 0.85 of the slot's width or height", async () => {
    // The blood cells sat at (0, 0) (happy-dom's paths had no length), so the crop reached the
    // slide's corner: an empty band under the heading and the drawing at half size (HEART1 D).
    const r = await libraryDiagram(ask, filler);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { box } = drawnContentBox(r.drawing.svg);
    expect(box).toBeDefined();
    if (!box) return;
    const { scale } = placedTypeSize(r.drawing.svg, place);
    const fill = Math.max(
      ((box.x1 - box.x0) * scale) / place.w,
      ((box.y1 - box.y0) * scale) / place.h,
    );
    expect(fill).toBeGreaterThanOrEqual(0.85);
  });

  test("nothing is drawn off its shapes: every blood cell sits on a vessel", async () => {
    const r = await libraryDiagram(ask, filler);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { dots } = drawnContentBox(r.drawing.svg);
    expect(dots.length).toBeGreaterThan(4);
    const guides = [...r.drawing.svg.matchAll(/<path d="([^"]+)" fill="none" stroke="none"/g)].map(
      (m) => pathWalk(m[1] as string),
    );
    expect(guides.length).toBeGreaterThan(0);
    const onGuide = ([x, y]: [number, number]) =>
      guides.some((g) => {
        for (let l = 0; l <= g.total; l += 2) {
          const p = g.at(l);
          if (Math.hypot(p.x - x, p.y - y) < 2) return true;
        }
        return false;
      });
    for (const d of dots) expect(onGuide(d)).toBe(true);
  });

  test("without the label floor, drawn to fill its slot, its words reach 18 pt", async () => {
    const r = await libraryDiagram(ask, filler);
    expect(r.ok).toBe(true);
    if (r.ok) expect(placedTypeSize(r.drawing.svg, place).minPt).toBeGreaterThanOrEqual(17.95);
  });

  test("with the floor and checks only logged, its words never break and never shrink", async () => {
    // The heart fits its words to the room it has: bigger type splits "Oxygen-ric / h blood" or
    // cuts "Carbon dioxide…" short, or comes out smaller. The floor keeps the largest clean size.
    const plain = await libraryDiagram(ask, filler);
    const r = await libraryDiagram({ ...ask, labelFloor: true }, filler);
    expect(plain.ok && r.ok).toBe(true);
    if (!plain.ok || !r.ok) return;
    expect(grownTextFault(plain.drawing.svg, r.drawing.svg)).toBeUndefined();
    expect(placedTypeSize(r.drawing.svg, place).minPt).toBeGreaterThanOrEqual(
      placedTypeSize(plain.drawing.svg, place).minPt - 0.01,
    );
  });
});

/*
 * R1 slides 3 and 7 seemed to show key colours drawn nowhere. Render-based: every key swatch (a
 * short stroke beside a key word) has its colour on a drawn vessel, for each detail and step.
 */
const KEY_SWATCH =
  /<line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="\3" style="stroke: var\((--[\w-]+)\)/g;
const drawnColours = (svg: string): Set<string> => {
  const out = new Set<string>();
  for (const m of svg.matchAll(
    /<(path|line|rect)\b[^>]*?(?:stroke|fill): var\((--o2-[\w-]+)\)[^>]*>/g,
  )) {
    const tag = m[0];
    const sw = /<line x1="([\d.]+)" x2="([\d.]+)"/.exec(tag);
    if (sw && Math.abs(Number(sw[2]) - Number(sw[1])) <= 30 && /y1="([\d.]+)" y2="\1"/.test(tag))
      continue;
    out.add(m[2] as string);
  }
  return out;
};
const keyColours = (svg: string): string[] =>
  [...svg.matchAll(KEY_SWATCH)]
    .filter(
      (m) => Math.abs(Number(m[2]) - Number(m[1])) <= 30 && (m[4] as string).startsWith("--o2-"),
    )
    .map((m) => m[4] as string);

describe("the heart's key lists only colours drawn (HEART1 D)", () => {
  const cases: [string, Record<string, unknown>, boolean][] = [
    ["simple", { showPulse: false, detail: "simple" }, false],
    ["double", { showPulse: false, detail: "double" }, false],
  ];
  for (const [name, params, question] of cases)
    test(name, async () => {
      const r = await libraryDiagram({ ...ask, labelFloor: true, question }, async () => params);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const drawn = drawnColours(r.drawing.svg);
      const key = keyColours(r.drawing.svg);
      expect(key.length).toBeGreaterThan(0);
      for (const c of key) expect(drawn).toContain(c);
    });
});

/*
 * TEACH-247 part w (heart_circulation v2): the double loop follows one drop of blood in journey
 * order, lungs before body, and a lesson stored with v1 params (every label overridden) still draws.
 */
describe("the heart builds in journey order (heart_circulation v2)", () => {
  test("double loop: heart, lungs, oxygen, out, back; simple loop: heart, out, back", async () => {
    const { loadModel, kit } = await import("./render");
    const m = await loadModel("heart_circulation");
    const K = await kit();
    const keys = (p: Record<string, unknown>) =>
      m?.builds?.(K.withDefaults(m.params, p)).steps.map((s: { key: string }) => s.key);
    expect(keys({ detail: "double", showPulse: false })).toEqual([
      "heart",
      "lungs",
      "oxygen",
      "out",
      "back",
    ]);
    expect(keys({ detail: "simple", showPulse: false })).toEqual(["heart", "out", "back"]);
  });
  test("v1 params with every v1 label overridden still draw, with no warnings", async () => {
    const { renderLibraryModel, kit, loadModel } = await import("./render");
    const m = await loadModel("heart_circulation");
    const v1 = [
      "heart",
      "lungs",
      "artery",
      "vein",
      "artery-lungs",
      "vein-lungs",
      "rich",
      "poor",
      "o2in",
      "co2out",
    ];
    const text = Object.fromEntries(
      v1.map((id) => [`label:${id}`, id === "heart" ? "Heart" : "Blood"]),
    );
    const P = (await kit()).withDefaults(m?.params, { ...m?.presets[1]?.params, text });
    const d = await renderLibraryModel("heart_circulation", P);
    expect(d.builds).toBeGreaterThan(3);
    expect(d.warnings).toEqual([]);
  });
});

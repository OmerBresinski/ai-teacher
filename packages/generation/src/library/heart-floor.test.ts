import { afterAll, describe, expect, test } from "bun:test";
import { modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { grownTextFault, libraryDiagram, placedTypeSize } from "./fill";
import { endDrawThread } from "./guard";

/*
 * HEART1 D: the R1 heart (production, checks only logged) drew at scale 0.51 with its words at
 * 13 pt, because the label floor was switched off with the checks. With the floor back on and
 * checks only logged, a grown size is kept only when its words draw whole and larger.
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
  test("without the label floor its words show under 18 pt", async () => {
    const r = await libraryDiagram(ask, filler);
    expect(r.ok).toBe(true);
    if (r.ok) expect(placedTypeSize(r.drawing.svg, place).minPt).toBeLessThan(18);
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

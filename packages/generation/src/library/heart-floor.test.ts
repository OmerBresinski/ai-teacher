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
      // the simple loop (Year 2) draws blood in one colour and has no key (curriculum review, PR #500)
      if (name === "simple") expect(key).toEqual([]);
      else expect(key.length).toBeGreaterThan(0);
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
    // "Blood carries" and the pulse are kept as their own builds after the journey (they replace the loop)
    const all = { oxygen: true, food: true, water: true, carbonDioxide: true };
    expect(keys({ detail: "double", showPulse: false, carries: all })).toEqual([
      "heart",
      "lungs",
      "oxygen",
      "out",
      "back",
      "carries",
    ]);
    expect(keys({ detail: "double", exercise: "running", carries: {} })).toEqual([
      "heart",
      "lungs",
      "oxygen",
      "out",
      "back",
      "pulse",
      "run",
    ]);
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
    if (!m) throw new Error("no heart_circulation");
    const P = (await kit()).withDefaults(m.params, { ...m.presets[1]?.params, text });
    const d = await renderLibraryModel("heart_circulation", P);
    expect(d.builds).toBeGreaterThan(3);
    expect(d.warnings).toEqual([]);
  });
});

/*
 * TEACH-247 part w, curriculum review (PR #500): the editor's view is the whole loop, with "Blood
 * carries" and the pulse beside it; the Year 2 simple loop has one blood colour and no oxygen words;
 * the gas labels and the heart's sides are the teacher's switches for older classes, unseen by the writer.
 */
describe("the heart after the curriculum review (heart_circulation v2)", () => {
  const draw = async (p: Record<string, unknown>) => {
    const { renderLibraryModel, kit, loadModel } = await import("./render");
    const m = await loadModel("heart_circulation");
    if (!m) throw new Error("no heart_circulation");
    const P = (await kit()).withDefaults(m.params, p);
    return { m, P, d: await renderLibraryModel("heart_circulation", P) };
  };
  const preset = async (id: string) => {
    const { loadModel } = await import("./render");
    const m = await loadModel("heart_circulation");
    return (m?.presets.find((x: { id: string }) => x.id === id)?.params ?? {}) as Record<
      string,
      unknown
    >;
  };
  const LOOP = ["Heart", "Lungs", "Artery to lungs", "Vein from lungs", "Artery", "Vein"];

  test("y6-circulatory and y6-running: the editor's view keeps the whole loop beside the panel", async () => {
    for (const [id, panel] of [
      ["y6-circulatory", "Blood carries"],
      ["y6-running", "Beats a minute"],
    ] as const) {
      const { d } = await draw(await preset(id));
      expect(d.warnings).toEqual([]);
      for (const w of [...LOOP, panel]) expect(d.svg).toContain(`>${w}<`);
      // the loop's vessels are drawn in the stored drawing, not hidden by the panel
      expect((d.svg.match(/stroke: var\(--o2-rich\)/g) ?? []).length).toBeGreaterThan(1);
    }
  });

  test("y2-exercise: one blood colour, no key, no oxygen in its drawing, captions or notes", async () => {
    // even a Year 2 lesson whose fill asks for oxygen among what blood carries
    const all = { oxygen: true, food: true, water: true, carbonDioxide: false };
    const { m, P, d } = await draw({ ...(await preset("y2-exercise")), carries: all });
    expect(d.warnings).toEqual([]);
    expect(d.svg.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/--o2-[\w-]+/g, "")).not.toMatch(
      /oxygen/i,
    );
    expect(d.svg).toContain(">Food (nutrients)<");
    expect(d.svg).not.toMatch(/(stroke|fill)(: |=")var\(--o2-poor\)/);
    expect(d.svg).toMatch(/stroke: var\(--o2-rich\)/);
    for (const w of ["Oxygen-rich blood", "Oxygen-poor blood", "Oxygen used"])
      expect(d.svg).not.toContain(w);
    const b = m.builds?.(P) as
      | { steps: { caption?: string }[]; summary?: { caption?: string } }
      | undefined;
    const caps = [...(b?.steps ?? []).map((s) => s.caption), b?.summary?.caption];
    for (const c of caps) expect(c).not.toMatch(/oxygen/i);
    const notes = (
      m as unknown as { notes: (p: unknown) => { steps: string[]; summary: string } }
    ).notes(P);
    for (const n of [...notes.steps, notes.summary]) expect(n).not.toMatch(/oxygen/i);
  });

  test("gas labels and the heart's sides: off by default, drawn when the teacher turns them on", async () => {
    const base = await preset("y6-circulatory");
    const off = await draw(base);
    for (const w of ["Oxygen in", "Carbon dioxide out", "Right side", "Left side", ">(the person"])
      expect(off.d.svg).not.toContain(w);
    const on = await draw({ ...base, gasLabels: true, sides: true });
    expect(on.d.warnings).toEqual([]);
    expect(on.d.svg).toContain(">Oxygen in<");
    // "Carbon dioxide out" draws whole, on one line or wrapped into two
    expect(on.d.svg).toMatch(
      />Carbon dioxide out<|>Carbon dioxide<[\s\S]{0,400}?>out<|>Carbon<[\s\S]{0,400}?>dioxide out</,
    );
    for (const w of [">Right side<", ">Left side<", ">(the person"]) expect(on.d.svg).toContain(w);
    // both stay off on the simple loop, which has no lungs
    const simple = await draw({ ...(await preset("y2-exercise")), gasLabels: true, sides: true });
    for (const w of ["Oxygen in", "Right side"]) expect(simple.d.svg).not.toContain(w);
  });

  test("the lungs note names the right side as the person's right", async () => {
    const { m, P } = await draw(await preset("y6-circulatory"));
    const notes = (m as unknown as { notes: (p: unknown) => { steps: string[] } }).notes;
    expect(notes(P).steps[1]).toContain("the person’s right, which is on your left as you look");
  });

  test("the writer never sees the teacher's switches; a stored lesson keeps them", async () => {
    const { fillSchema, checkParams } = await import("./fill");
    const { loadModel } = await import("./render");
    const m = await loadModel("heart_circulation");
    const s = fillSchema(m?.params ?? {}, "heart_circulation") as { properties: object };
    expect(Object.keys(s.properties)).toEqual([
      "detail",
      "exercise",
      "showPulse",
      "pulse",
      "vesselNames",
      "carries",
      "showBody",
    ]);
    const r = await checkParams("heart_circulation", {
      ...(await preset("y6-circulatory")),
      gasLabels: true,
      sides: true,
    });
    expect(r.refusals).toEqual([]);
    expect(r.params?.gasLabels).toBe(true);
    expect(r.params?.sides).toBe(true);
    const unset = await checkParams("heart_circulation", await preset("y6-circulatory"));
    expect(unset.params?.gasLabels).toBe(false);
    expect(unset.params?.sides).toBe(false);
  });

  test("every vessel ends on the heart, a lung or the body (the #532 reroute)", async () => {
    for (const p of [
      await preset("y6-circulatory"),
      await preset("y6-running"),
      { ...(await preset("y6-circulatory")), gasLabels: true, sides: true },
      await preset("y2-exercise"),
    ]) {
      const { d } = await draw(p);
      const svg = d.svg.replace(/<style>[\s\S]*?<\/style>/g, "");
      // the organs: the heart's outline, each lung, the body card (or the simple loop's body box)
      const organs = [
        ...svg.matchAll(/<path d="([^"]+Z)"[^>]*?(?:fill: var\(--berry-shade\)|--ear)/g),
      ].map((m) => pathWalk(m[1] as string));
      const boxes = [
        ...svg.matchAll(
          /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*--ink-3/g,
        ),
      ].map((m) => m.slice(1, 5).map(Number) as [number, number, number, number]);
      // the simple loop's heart has its great vessels as stubs on its top: a vein ends on its stub
      const stubs = [
        ...svg.matchAll(
          /<line x1="([\d.]+)" x2="\1" y1="([\d.]+)" y2="([\d.]+)"[^>]*stroke: var\(--berry-shade\)/g,
        ),
      ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
      const tips = [...svg.matchAll(/data-end="([\d.]+),([\d.]+)"/g)]
        .filter((m) =>
          /--sw-arrow\) \* (3\.2|2)\)/.test(svg.slice(Math.max(0, (m.index ?? 0) - 400), m.index)),
        )
        .map((m) => [Number(m[1]), Number(m[2])] as const);
      expect(tips.length).toBeGreaterThanOrEqual(2);
      const bad: string[] = [];
      for (const [x, y] of tips) {
        let best = Infinity;
        for (const w of organs)
          for (let l = 0; l <= w.total; l += 2) {
            const q = w.at(l);
            best = Math.min(best, Math.hypot(q.x - x, q.y - y));
          }
        for (const [bx, by, bw, bh] of boxes) {
          const dx = Math.max(bx - x, 0, x - (bx + bw));
          const dy = Math.max(by - y, 0, y - (by + bh));
          best = Math.min(best, Math.hypot(dx, dy));
        }
        for (const [sx, y0, y1] of stubs)
          best = Math.min(
            best,
            Math.hypot(sx - x, Math.max(Math.min(y0, y1) - y, 0, y - Math.max(y0, y1))),
          );
        if (best > 14) bad.push(`${x},${y}: ${Math.round(best)} px from any organ`);
      }
      expect(bad).toEqual([]);
    }
  });

  test("a lesson saved with v1 params (old order, old labels and step overrides) still draws", async () => {
    // v1 stored params: every v1 label and per-step caption/note override (keyed by step id, never index)
    const text = {
      "label:artery": "Artery",
      "label:vein": "Vein",
      "label:o2in": "Oxygen in",
      "label:co2out": "Carbon dioxide out",
      "caption:out": "Blood leaves the heart.",
      "caption:back": "Blood comes back.",
      "note:out": "Arteries carry blood away.",
    };
    for (const id of ["y2-exercise", "y6-circulatory", "y6-running"]) {
      const { d, m, P } = await draw({ ...(await preset(id)), text });
      expect(d.warnings).toEqual([]);
      expect(d.builds).toBeGreaterThan(2);
      expect(m.builds?.(P).steps.map((s: { key: string }) => s.key)).toContain("out");
    }
  });
});

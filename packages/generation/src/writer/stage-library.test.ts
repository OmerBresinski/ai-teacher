import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { svgOfDataUrl } from "@tj/slides/diagram-builds";
import { endDrawThread } from "../library/guard";
import { inspectDrawnSvg, loadModel } from "../library/render";
import type { DrawerCall } from "./diagrams";
import type { Brief } from "./fixes";
import { recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part h through the writer stage: a saved base4 run whose first diagram is swapped for
 * a library model. Filled params draw the model in the diagram slot; params the model refuses
 * fall back to today's drawer for the model's kind, never an empty slot.
 */
const B = "y2-maths-halves-quarters";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
type El = Record<string, unknown>;

async function run(
  fill: (attempt: number) => unknown,
  shape: { side?: boolean; points?: boolean } = {},
) {
  const brief = JSON.parse(read("brief.json")) as Brief;
  const objectives = (
    JSON.parse(read("objectives.json")) as { objectives: { teacher: string }[] }
  ).objectives.map((o) => o.teacher);
  const main = JSON.parse(read("main.json")) as { text: string; finishReason?: string };
  const out = JSON.parse(main.text) as { slides: Record<string, unknown>[] };
  const first = out.slides[0] as Record<string, unknown>;
  // Library models are full slides: big-visual with its lead, no points (unless a test asks).
  if (!shape.side) first.template = "big-visual";
  if (!shape.side && !shape.points) delete first.points;
  first.figure = {
    kind: "model",
    model: "fractions",
    intent: "one half of a circle shaded",
    alt: "A circle cut into two equal parts with one part shaded.",
  };
  const fills: string[] = [];
  const drawerKinds: string[] = [];
  const callDrawer: DrawerCall = async (req) => {
    if (req.system.startsWith("Set the parameters")) {
      fills.push(req.user);
      return { out: fill(fills.length - 1) };
    }
    const kind = /Kind: ([a-z-]+)/.exec(req.user)?.[1] ?? "";
    drawerKinds.push(kind);
    return {
      out:
        kind === "fraction-shapes"
          ? {
              kind,
              alt: "A circle with one of two equal parts shaded.",
              shapes: [{ shape: "rectangle", parts: 2, cut: "vertical", shaded: 1, name: "½" }],
            }
          : undefined,
    };
  };
  const events: El[] = [];
  const res = await runWriter({
    brief,
    objectives,
    services: { ...replayServices(B), log: (e) => events.push(e as El) },
    visual: recordedVisuals(B),
    recordedWriter: { text: JSON.stringify(out), finishReason: main.finishReason ?? null },
    drawDiagrams: { callDrawer },
    library: true,
  });
  const slide = res.slides[2]; // title and objectives come first
  const diagram = ((slide?.elements ?? []) as El[]).find((e) => e.name === "Diagram");
  return { fills, drawerKinds, events, diagram, slide, first };
}

/** The kit's type floor (24 units on its 1280-wide slide) at a 1440 px wide projection, less 25%. */
const FLOOR_PX = 24 * (1440 / 1280) * 0.75;
const report: unknown[] = [];

describe("writer stage: library models", () => {
  test("filled params draw the model in the diagram slot, as a still (TEACH-247 part i)", async () => {
    const m = await loadModel("fractions");
    const { fills, diagram, events } = await run(() => m?.presets[0]?.params);
    expect(fills.length).toBe(1);
    expect(fills[0]).toContain("Intent: one half of a circle shaded");
    const svg = svgOfDataUrl(String(diagram?.src)) ?? "";
    expect(svg).toContain('class="slide tk theme-primary"');
    // Set in the lesson theme's label face (Splash: Nunito), named and not embedded (part o).
    expect(svg).toContain('data-font="nunito"');
    expect(svg).toContain("font-family:'Nunito Variable'");
    expect(svg).not.toContain("@font-face");
    expect(diagram?.alt).toBe("A circle cut into two equal parts with one part shaded.");
    // A library model opens complete in Present: no builds from an empty frame.
    expect(Number(diagram?.builds ?? 0)).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({ ev: "diagram-done", via: "library" }));
  }, 60_000);

  test("a library model takes the whole slide: no words outside the slot, none under the floor", async () => {
    const m = await loadModel("fractions");
    const { diagram, slide } = await run(() => m?.presets[0]?.params);
    const box = diagram as { w: number; h: number; fit?: string; src: string };
    const kit = inspectDrawnSvg(svgOfDataUrl(box.src) ?? "");
    const [vx, vy, vw, vh] = kit.viewBox;
    // The image is contained in its frame (960 x 540 slide units), shown 1440 px wide.
    const k = Math.min(box.w / vw, box.h / vh) * (1440 / 960);
    const smallest = Math.min(...kit.words.map((w) => w.fs * k));
    report.push({ model: "fractions", frame: [box.w, box.h, box.fit], smallestPx: smallest });
    // The big-diagram band (788 x 223 units on y2), not the 348-wide side panel.
    expect(box.w >= 600 || box.h >= 200).toBe(true);
    expect(smallest).toBeGreaterThanOrEqual(FLOOR_PX);
    for (const w of kit.words) {
      expect(w.x0, w.words).toBeGreaterThanOrEqual(vx - 1);
      expect(w.x1, w.words).toBeLessThanOrEqual(vx + vw + 1);
      expect(w.y0, w.words).toBeGreaterThanOrEqual(vy - 1);
      expect(w.y1, w.words).toBeLessThanOrEqual(vy + vh + 1);
    }
  }, 60_000);

  test("the slide keeps its lead as a caption under the model", async () => {
    const m = await loadModel("fractions");
    const { slide, first } = await run(() => m?.presets[0]?.params);
    const els = (slide?.elements ?? []) as El[];
    expect(els.some((e) => e.name === "Caption")).toBe(true);
    expect(JSON.stringify(els)).toContain(String(first.lead).slice(0, 20));
    expect(els.some((e) => e.name === "Panel")).toBe(false);
  }, 60_000);

  test("points on a full library slide go to the notes, logged", async () => {
    const m = await loadModel("fractions");
    const { slide, first, events } = await run(() => m?.presets[0]?.params, { points: true });
    const p = (first.points as unknown[]).map((x) =>
      typeof x === "string" ? x : (x as { text: string }).text,
    );
    expect(p.length).toBeGreaterThan(0);
    expect(String(slide?.notes)).toContain(String(p[0]));
    expect(events).toContainEqual(expect.objectContaining({ ev: "lib-points-to-notes" }));
  }, 60_000);

  test("a side-slot model ask (an old output) goes to the drawer, no fill", async () => {
    const m = await loadModel("fractions");
    const { fills, drawerKinds, events, diagram } = await run(() => m?.presets[0]?.params, {
      side: true,
    });
    expect(fills.length).toBe(0);
    expect(drawerKinds).toContain("fraction-shapes");
    expect(events).toContainEqual(
      expect.objectContaining({ ev: "lib-side-slot", model: "fractions" }),
    );
    expect(svgOfDataUrl(String(diagram?.src))).not.toContain("theme-primary");
  }, 60_000);

  test("refused params fall back to the drawer for the model's kind", async () => {
    const { fills, drawerKinds, diagram } = await run(() => ({ representation: 42 }));
    expect(fills.length).toBe(2);
    expect(drawerKinds).toContain("fraction-shapes");
    expect(String(diagram?.src).startsWith("data:image/svg+xml")).toBe(true);
    expect(svgOfDataUrl(String(diagram?.src))).not.toContain("theme-primary");
  }, 60_000);
});

afterAll(() => {
  endDrawThread();
  if (process.env.TLIB_REPORT) console.log(JSON.stringify(report));
});

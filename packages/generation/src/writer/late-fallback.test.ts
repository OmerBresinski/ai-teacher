import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DrawerCall } from "./diagrams";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-251 part aw. Slide 5's picture ("Watch a match") is refused by the judge, so the early
 * retry cannot ask it again (retryable false).
 * 1. Its fallback (pictureLost: here the reroute) starts in the early job, beside the repairs, not
 *    after them (verify11 Romans s3: 36 s late), and ends the same as when the tail runs it.
 * 2. A reroute that names a labelled diagram with no spec (verify11 Romans s9) is drawn by the
 *    drawer; when it still cannot be drawn the slide is laid as words, full width, never half empty.
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const LOST = "Watch a match";
const REPAIRED = "Not just a tiny hen";

type Opts = {
  early: boolean;
  /** The reroute's answer for slide 5 (undefined: none recorded, so the fixed fallback runs). */
  reroute?: unknown;
  callDrawer?: DrawerCall;
  /** How long slide 8's fit repair takes, ms. */
  slowRepair?: number;
};
async function run(o: Opts) {
  const rec = recordedVisuals(B);
  const svc = replayServices(B);
  const held = recordedHeld(B);
  const t0 = performance.now();
  const at: Record<string, number> = {};
  const events: Record<string, unknown>[] = [];
  const out = await runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (x) => x.teacher,
    ),
    services: {
      ...svc,
      log: (e: Record<string, unknown>) => events.push(e),
      chat: async (r) => {
        if (r.name === "slide" && r.user.includes(LOST)) {
          at.reroute ??= performance.now() - t0;
          if (o.reroute) return { out: o.reroute, usd: 0, ms: 0 };
        }
        if (r.name === "slide" && r.user.includes(REPAIRED) && o.slowRepair) {
          await new Promise((res) => setTimeout(res, o.slowRepair));
          const a = await svc.chat(r);
          at.repaired = performance.now() - t0;
          return a;
        }
        return svc.chat(r);
      },
      writer: async () => ({
        text: (read("main.json") as { text: string }).text,
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
    },
    visual: (i: number, key: string, a: VisualAsk): VisualState =>
      i === 4 && a.type === "photo" ? { status: "failed" } : rec(i, key, a),
    // no match6-dropped photo to keep on slide 5: its fallback decides what it shows
    held: (i, k) => (i === 4 ? undefined : held(i, k)),
    // a judge's refusal: the picture route is not asked again
    retryable: () => false,
    ...(o.early ? { slideDone: async () => {} } : {}),
    ...(o.callDrawer ? { drawDiagrams: { callDrawer: o.callDrawer } } : {}),
    beforeEditable: async () => {},
    placeMore: async () => {},
  });
  const pathOf = (s: number) =>
    events.find((e) => e.ev === "visual-path" && e.slide === s)?.path as string | undefined;
  return { out, at, events, pathOf };
}

/** The deck without its element ids (fresh per run). */
const shape = (slides: unknown) => JSON.stringify(slides, (k, v) => (k === "id" ? undefined : v));

const reroute = {
  fix: "diagram",
  slide: {
    template: "visual-text",
    heading: LOST,
    lead: "I match the hen to the chick.",
    points: ["The hen is the adult.", "The chick is the young chicken."],
    figure: {
      kind: "labelled-diagram",
      shows: "A hen beside a chick, with the parts that tell them apart",
      labels: ["hen", "chick"],
    },
  },
  to_notes: [],
};
const spec = {
  kind: "labelled-diagram",
  subject: "object_or_machine",
  alt: "A hen beside a chick.",
  canvas: "square",
  shapes: [{ type: "rect", x: 10, y: 10, w: 80, h: 80 }],
  labels: [
    { text: "hen", at: [30, 50] },
    { text: "chick", at: [70, 50] },
  ],
};

describe("a refused picture's fallback starts in the early job (part aw)", () => {
  test("it starts beside the repairs, before they end", async () => {
    const { at, events } = await run({ early: true, slowRepair: 150 });
    expect(events).toContainEqual(expect.objectContaining({ ev: "lost-fallback-early", slide: 5 }));
    expect(at.reroute).toBeDefined();
    expect(at.reroute as number).toBeLessThan(at.repaired as number);
  });

  test("without the early job it waits for the repairs, as before", async () => {
    const { at, events } = await run({ early: false, slowRepair: 150 });
    expect(events.some((e) => e.ev === "lost-fallback-early")).toBe(false);
    expect(at.reroute as number).toBeGreaterThan(at.repaired as number);
  });

  test("the same fallback is chosen and the same deck ships, early or in the tail", async () => {
    for (const ro of [undefined, reroute]) {
      const a = await run({ early: true, reroute: ro });
      const b = await run({ early: false, reroute: ro });
      expect(a.pathOf(5)).toBe(b.pathOf(5));
      expect(shape(a.out.slides)).toBe(shape(b.out.slides));
    }
  });
});

describe("a reroute's labelled diagram with no spec (part aw, verify11 Romans s9)", () => {
  const slide5 = (out: { slides: unknown[] }) =>
    out.slides[4] as { elements: { type: string; name?: string; x: number; w: number }[] };

  test("is drawn by the drawer and shown", async () => {
    let calls = 0;
    const { out, pathOf } = await run({
      early: true,
      reroute,
      callDrawer: async () => {
        calls++;
        return { out: spec };
      },
    });
    expect(calls).toBeGreaterThan(0);
    expect(pathOf(5)).toBe("picture-to-diagram");
    expect(slide5(out).elements.some((e) => e.type === "image")).toBe(true);
  });

  test("that cannot be drawn leaves a text-only slide laid full width", async () => {
    const { out, pathOf, events } = await run({
      early: true,
      reroute,
      callDrawer: async () => {
        throw new Error("drawer down");
      },
    });
    expect(pathOf(5)).toBe("picture-to-unshown");
    expect(events).toContainEqual(
      expect.objectContaining({ ev: "unshown-text-only", slide: 5, ok: true }),
    );
    const els = slide5(out).elements;
    expect(els.some((e) => e.type === "image")).toBe(false);
    // no empty half: the widest text block spans most of the 960 canvas
    const widest = Math.max(...els.filter((e) => e.type === "text").map((e) => e.w));
    expect(widest).toBeGreaterThan(800);
  });
});

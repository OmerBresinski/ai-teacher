import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * verify10 y8 photosynthesis s4 (26 Oct): the director chose to draw the lost picture, the drawer
 * sent a spec, but the layout refused it (a label across a line) and the slide went text-only with
 * no picture fallback. The order is: draw; a drawing the slide cannot show runs the picture route
 * (stock, then painting); only then text. A drawing the slide shows is kept, as before.
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));

// Six labels on crossings of a nine-line grid: no room draws it without a label across a line.
const grid = Array.from({ length: 9 }, (_, k) => [
  {
    type: "line",
    points: [
      [0, k * 12.5],
      [100, k * 12.5],
    ],
  },
  {
    type: "line",
    points: [
      [k * 12.5, 0],
      [k * 12.5, 100],
    ],
  },
]).flat();
const crowded = {
  kind: "labelled-diagram",
  subject: "object_or_machine",
  alt: "A small square on a grid with six labels",
  canvas: "square",
  shapes: [{ type: "rect", x: 45, y: 45, w: 10, h: 10, fill: "accent" }, ...grid],
  labels: [
    [37.5, 37.5],
    [62.5, 37.5],
    [37.5, 62.5],
    [62.5, 62.5],
    [50, 25],
    [50, 75],
  ].map((at, k) => ({ text: `Label number ${k + 1} words`, at })),
};
const clean = {
  kind: "labelled-diagram",
  subject: "object_or_machine",
  alt: "A green square",
  canvas: "square",
  shapes: [{ type: "rect", x: 30, y: 30, w: 40, h: 40, fill: "accent" }],
  labels: [{ text: "Square", at: [50, 15] }],
};

/**
 * TEACH-247 part ay: a drawing of an animal is never drawn from shapes, so the layout tests ask
 * slide 6 for things (garden tools) and a third test holds the animals to the picture route.
 */
const NOT_LIVING: [string, string][] = [
  [
    "Six separate animal photographs: cow, sheep and dog across the top; puppy, calf and lamb across the bottom",
    "Six separate garden tools: hammer, saw and spade across the top; trowel, rake and fork across the bottom",
  ],
  ["adult cow", "hammer"],
  ["adult sheep", "saw"],
  ["adult dog", "spade"],
  ["small puppy below cow position", "trowel below hammer position"],
];
const go = async (spec: unknown, living = false) => {
  const rec = recordedVisuals(B);
  const placed = new Set<string>();
  const placeCalls: string[] = [];
  const events: Record<string, unknown>[] = [];
  const src = (k: string) => `/files/test/${k.replace(":", "-")}.png`;
  const visual = (i: number, key: string, a: VisualAsk): VisualState => {
    const k = `${i}:${key}`;
    if (placed.has(k))
      return { status: "photo", photo: { src: src(k), alt: key, aspect: 1.5, request: key } };
    if (k === "5:picture") return { status: "failed" };
    return rec(i, key, a);
  };
  const out = await runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    services: {
      ...replayServices(B),
      log: (e: Record<string, unknown>) => events.push(e),
      writer: async () => ({
        text: NOT_LIVING.reduce(
          (t, [from, to]) => (living ? t : t.replaceAll(from, to)),
          (read("main.json") as { text: string }).text,
        ),
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
    },
    visual,
    held: recordedHeld(B),
    drawDiagrams: { callDrawer: async () => ({ out: spec }) },
    drawAs: (i, key) => (i === 5 && key === "picture" ? "labelled-diagram" : undefined),
    placeMore: async (i, more) => {
      for (const a of more) {
        placeCalls.push(`${i}:${a.key}`);
        placed.add(`${i}:${a.key}`);
      }
    },
  });
  const path = events.find((e) => e.ev === "visual-path" && e.slide === 6) as
    | { path?: string }
    | undefined;
  return { deck: JSON.stringify(out.slides), placeCalls, events, path: path?.path, src };
};

describe("lostPic: a director's drawing the slide cannot show falls back to the picture route", () => {
  test("drawn but refused by the layout: the picture is placed again and lands", async () => {
    const r = await go(crowded);
    expect(r.events.some((e) => e.ev === "diagram-call" && e.slide === 6)).toBe(true);
    expect(r.events.some((e) => e.ev === "lost-library-undrawn" && e.slide === 6)).toBe(true);
    expect(r.placeCalls).toEqual(["5:picture"]);
    expect(r.deck).toContain(r.src("5:picture"));
    expect(r.path).toBe("picture-placed");
  });
  test("drawn and shown: the drawing is kept, no picture is placed", async () => {
    const r = await go(clean);
    expect(r.events.some((e) => e.ev === "lost-library-undrawn")).toBe(false);
    expect(r.placeCalls).toEqual([]);
    expect(r.path).toBe("picture-library");
  });
  test("a drawing of the animals is withheld and the picture route places it", async () => {
    const r = await go(clean, true);
    expect(r.events.some((e) => e.ev === "body-figure" && e.slide === 6)).toBe(true);
    expect(r.placeCalls).toEqual(["5:picture"]);
    expect(r.deck).toContain(r.src("5:picture"));
  });
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import rivers from "./fixtures/rivers-v6-lost-visuals.json" with { type: "json" };
import splitFixtures from "./fixtures/split-side-diagrams.json" with { type: "json" };
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part cg (Rivers v6 s6): a split side's drawing that cannot draw at its side is never
 * logged as "diagram" with no image on the slide. Its fault is found at generation (the drawer is
 * told it), and a side still undrawn takes the tile fallback: a picture of the same thing.
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
type S = Record<string, unknown>;
// A forces drawing whose labels overlap at side size (TEACH-110 part ad's fixture).
const crowded = ((splitFixtures["20261016-1221-s3"].sides[0] as S).picture as S).diagram as S;

const go = async (side0: S) => {
  const plan = JSON.parse((read("main.json") as { text: string }).text) as { slides: S[] };
  const split = rivers.split as unknown as S;
  plan.slides[5] = {
    ...split,
    sides: (split.sides as S[]).map((d, n) => (n === 0 ? { ...d, picture: side0 } : d)),
  };
  const rec = recordedVisuals(B);
  const placed = new Set<string>();
  const placeCalls: string[] = [];
  const events: S[] = [];
  const src = (k: string) => `/files/test/${k.replace(":", "-")}.png`;
  const visual = (i: number, key: string, a: VisualAsk): VisualState => {
    const k = `${i}:${key}`;
    if (placed.has(k))
      return { status: "photo", photo: { src: src(k), alt: key, aspect: 1.5, request: key } };
    return rec(i, key, a);
  };
  const out = await runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    services: {
      ...replayServices(B),
      log: (e: S) => events.push(e),
      writer: async () => ({
        text: JSON.stringify(plan),
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
    },
    visual,
    held: recordedHeld(B),
    drawDiagrams: { callDrawer: async () => ({ out: crowded }) },
    placeMore: async (i, more) => {
      for (const a of more) {
        placeCalls.push(`${i}:${a.key}`);
        placed.add(`${i}:${a.key}`);
      }
    },
  });
  const path = events.find((e) => e.ev === "visual-path" && e.slide === 8) as
    | { path?: string }
    | undefined;
  return { deck: JSON.stringify(out.slides), placeCalls, events, path: path?.path, src };
};

test("the Rivers sides draw by code, and the slide's path is diagram", async () => {
  const r = await go((rivers.split.sides[0] as S).picture as S);
  expect(r.events.filter((e) => e.ev === "r2-spec-drawn" && e.slide === 8)).toHaveLength(2);
  expect(r.events.some((e) => e.ev === "diagram-call" && e.slide === 8)).toBe(false);
  expect(r.path).toBe("diagram");
});

test("a side that cannot draw at its side is a fault at generation and becomes a picture", async () => {
  const r = await go({ ...crowded, shows: "Forces on a box at rest" });
  const calls = r.events.filter((e) => e.ev === "diagram-call" && e.slide === 8);
  expect(calls.length).toBe(2);
  for (const c of calls) expect(String(c.fault)).toContain("does not fit its slot");
  expect(r.placeCalls).toEqual(["7:side.0"]);
  expect(r.deck).toContain(r.src("7:side.0"));
  expect(r.path).toBe("picture");
});

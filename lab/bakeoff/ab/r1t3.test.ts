import { describe, expect, test } from "bun:test";
import { findDirected } from "../../../packages/generation/src/stages/picture-director";
import { tileOrder, tileRects } from "../../../packages/slides/src/templates";
import { setAbArm } from "./arms";
import { covers, seenOf } from "./stage2";

const pic = (shows: string) => ({
  shows,
  mustShow: [shows],
  queries: [shows],
  imagePrompt: `A photo of ${shows}`,
});
const deps = {
  logger: { info() {}, warn() {}, error() {} },
  signal: new AbortController().signal,
} as never;
const run = (allPictures: boolean) => {
  const asked: string[] = [];
  return findDirected({
    bank: {
      lookup: async () => undefined,
      remember: async () => undefined,
      generate: async () => undefined,
    } as never,
    ask: { subject: "cow, calf, sheep and lamb", named: null },
    brief: { request: "four animals", mustShow: [] } as never,
    slide: { heading: "Find the pairs" },
    lesson: { title: "Animals and their young" },
    country: "GB",
    index: 3,
    stock: async (b) => {
      asked.push(b.request);
      return {
        src: `/files/${b.request}.jpg`,
        alt: b.request,
        source: { provider: "pexels" },
      } as never;
    },
    judgeMade: async () => true,
    deps,
    direct: async () =>
      ({
        route: "pexels",
        named: null,
        period: null,
        count: null,
        pictures: [pic("adult cow"), pic("young calf"), pic("adult sheep")],
      }) as never,
    allPictures,
  }).then((out) => ({ out, asked }));
};

describe("b4-r1t3 root fixes", () => {
  test("findDirected fetches every director picture as its own tile (fix A)", async () => {
    const one = await run(false);
    expect(one.asked).toEqual(["adult cow"]);
    expect(one.out?.tiles).toBeUndefined();
    const all = await run(true);
    expect(all.asked.sort()).toEqual(["adult cow", "adult sheep", "young calf"]);
    expect(all.out?.tiles?.map((t) => t.alt)).toEqual(["young calf", "adult sheep"]);
  });
  test("photo tiles: 2-10 tiles fit their area, pairs together, shuffled pairs never side by side", () => {
    const area = { x: 500, y: 200, w: 640, h: 400 };
    for (const n of [2, 4, 6, 8, 10]) {
      const r = tileRects(n, area);
      expect(r).toHaveLength(n);
      for (const t of r) {
        expect(t.x).toBeGreaterThanOrEqual(area.x);
        expect(t.x + t.w).toBeLessThanOrEqual(area.x + area.w + 1);
        expect(t.y + t.h).toBeLessThanOrEqual(area.y + area.h + 1);
      }
    }
    const tog = tileRects(4, area, "together");
    // A pair shares a row; the gap inside a pair is smaller than the gap between pairs.
    expect(tog[0]?.y).toBe(tog[1]?.y);
    expect(tileOrder(["cow", "calf", "sheep", "lamb"], "shuffled")).toEqual([
      "cow",
      "lamb",
      "sheep",
      "calf",
    ]);
    expect(tileOrder(["cow", "calf", "sheep", "lamb"], "together")).toEqual([
      "cow",
      "calf",
      "sheep",
      "lamb",
    ]);
  });
  test("metric fix: a judged generated pick counts its request; fluffy = fluff; stock keeps visible only", () => {
    const made = {
      alt: "A hen and her chick",
      request: "hen. adult wing feathers. adult tail feathers",
      source: { provider: "generated" },
    };
    expect(covers(["adult wing feathers"], seenOf(made))).toBe(true);
    const stock = {
      alt: "A chick",
      request: "remaining fluffy down",
      source: { provider: "pexels", evidence: { visible: ["patches of fluff"] } },
    };
    expect(covers(["remaining fluffy down"], seenOf(stock))).toBe(true);
    expect(covers(["adult hen"], seenOf({ ...stock, request: "adult hen" }))).toBe(false);
  });
  test("arm config: b4-r1t3 carries stage 2 and the tile fixes", async () => {
    const { AB_CONFIG, abR1t2, abR1t3 } = await import("./arms");
    expect(AB_CONFIG["b4-r1t3"]).toMatchObject({ r1t: true, r1t2: true, r1t3: true });
    setAbArm("b4-r1t3");
    expect([abR1t2(), abR1t3()]).toEqual([true, true]);
    setAbArm(undefined);
  });
});

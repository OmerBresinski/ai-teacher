import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * Greg, 10 Oct: "a visual should never be lost." On the recorded y1 deck, slide 6's picture
 * (5:picture, its one visual) is the one the director chose to draw, and slide 5's (4:picture,
 * lost in the recording) ran out of time. The drawer fails, so both are placed again through the
 * picture path, once each, and both land on the deck.
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));

describe("lostPic: a drawing the drawer cannot draw, and a second failed ask, keep their pictures", () => {
  test("a body drawing skips the drawer, then every retryable failed ask is placed again, once each", async () => {
    const rec = recordedVisuals(B);
    const placed = new Set<string>();
    const placeCalls: string[][] = [];
    const drawerCalls: string[] = [];
    const src = (k: string) => `/files/test/${k.replace(":", "-")}.png`;
    const visual = (i: number, key: string, a: VisualAsk): VisualState => {
      const k = `${i}:${key}`;
      if (placed.has(k))
        return { status: "photo", photo: { src: src(k), alt: key, aspect: 1.5, request: key } };
      // The director chose to draw slide 6's picture: no picture from the first round.
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
        writer: async () => ({
          text: (read("main.json") as { text: string }).text,
          finishReason: "stop",
          usd: 0,
          ms: 0,
        }),
      },
      visual,
      held: recordedHeld(B),
      drawDiagrams: {
        callDrawer: async (req) => {
          drawerCalls.push(JSON.stringify(req));
          throw new Error("drawer down");
        },
      },
      drawAs: (i, key) => (i === 5 && key === "picture" ? "labelled-diagram" : undefined),
      retryable: (i, key) => i === 4 && key === "picture",
      placeMore: async (i, more) => {
        placeCalls.push(more.map((a) => `${i}:${a.key}`));
        for (const a of more) placed.add(`${i}:${a.key}`);
      },
    });
    // The director chose a labelled drawing of six animals: a living body is never drawn freehand
    // (TEACH-247 part ad), so no drawer call; the ask is placed again as a picture.
    expect(drawerCalls.some((r) => r.includes("labelled-diagram"))).toBe(false);
    // Then each ask was placed again exactly once (one round per slide).
    expect(placeCalls.filter((c) => c.includes("4:picture"))).toEqual([["4:picture"]]);
    expect(placeCalls.filter((c) => c.includes("5:picture"))).toEqual([["5:picture"]]);
    const deck = JSON.stringify(out.slides);
    expect(deck).toContain(src("4:picture"));
    expect(deck).toContain(src("5:picture"));
  });
});

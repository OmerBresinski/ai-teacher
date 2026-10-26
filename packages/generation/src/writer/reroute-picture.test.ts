import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * picq (greatfire 26 Oct, slides 3 and 8): a picture lost to time was rerouted to a diagram, the
 * diagram failed (not drawn, or drawn too big for its zone), and the slide shipped as bare text.
 * Now the failed diagram falls back to a picture when the lost picture was lost to time or an
 * error, and the slide shows one kind of visual only (ruling 209). A picture the judge refused is
 * never asked again.
 */
const B = "y1-science-animals-young";
const read = (f: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures/replay", B, f), "utf8"));
const LANDED = "/files/test/fallback.png";

const run = (figure: Record<string, unknown>, lostToTime: boolean) => {
  const landed = new Set<string>();
  const asked: VisualAsk[][] = [];
  const out = runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    checks: "log",
    services: {
      ...replayServices(B),
      writer: async () => ({
        text: (read("main.json") as { text: string }).text,
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
      chat: async (r) => {
        if (r.name === "slide" && r.user.includes("Watch me describe"))
          return {
            out: {
              fix: "diagram",
              slide: {
                template: "visual-text",
                heading: "Watch me describe",
                lead: "I can describe two changes.",
                points: ["The chick gets bigger.", "It grows adult feathers."],
                figure,
              },
            },
            usd: 0,
            ms: 0,
          };
        return replayServices(B).chat(r);
      },
    },
    visual: (i, key, a): VisualState =>
      a.type === "photo" && landed.has(`${i}:${key}`)
        ? { status: "photo", photo: { src: LANDED, alt: a.shows, aspect: 1.5, request: a.shows } }
        : { status: "failed" },
    drawDiagrams: {
      callDrawer: async () => {
        throw new Error("drawer down");
      },
    },
    retryable: () => lostToTime,
    placeMore: async (i, more) => {
      asked.push(more);
      // Only the fallback's picture of the diagram's subject lands.
      for (const a of more) if (/MARKER/.test(a.shows)) landed.add(`${i}:${a.key}`);
    },
  });
  return { out, asked };
};
const slideOf = async (o: ReturnType<typeof run>) =>
  JSON.stringify((await o.out).slides.find((x) => JSON.stringify(x).includes("Watch me describe")));

describe("a rerouted diagram that fails falls back to a picture (picq)", () => {
  test("a diagram that drew but did not fit its zone: the picture lands, no diagram ships", async () => {
    const nodes = Array.from(
      { length: 7 },
      (_, n) => `Step ${n + 1}: the young chick slowly grows bigger and longer adult wing feathers`,
    );
    const r = run(
      {
        kind: "flow",
        shows: "MARKER how a chick grows into a hen",
        alt: "A chick grows into a hen.",
        nodes,
        links: nodes.slice(1).map((_, n) => ({ from: n, to: n + 1, label: null })),
        title: null,
      },
      true,
    );
    const s = await slideOf(r);
    expect(r.asked.flat().some((a) => /MARKER/.test(a.shows))).toBe(true);
    expect(s).toContain(LANDED);
    expect(s).not.toContain('"drawn"');
    expect(s).not.toContain('"diagram"');
  });
  test("a picture lost to time, its diagram not drawn: the picture fallback lands", async () => {
    const r = run(
      {
        kind: "labelled-diagram",
        shows: "MARKER a hen beside a chick",
        labels: ["hen", "chick", "feathers"],
      },
      true,
    );
    expect(await slideOf(r)).toContain(LANDED);
  });
  test("a picture the judge refused is not asked again after the diagram fails", async () => {
    const r = run(
      {
        kind: "labelled-diagram",
        shows: "MARKER a hen beside a chick",
        labels: ["hen", "chick", "feathers"],
      },
      false,
    );
    await r.out;
    expect(r.asked.flat().some((a) => /MARKER/.test(a.shows))).toBe(false);
  });
});

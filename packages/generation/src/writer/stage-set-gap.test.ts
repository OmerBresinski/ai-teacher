import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { VisualState } from "./materialise";
import { replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part cy (rivers v4.21b s8): a stages strip shows a picture on every stage or on none.
 * Stage 4's picture was still out when its slide's wait ended, the stage logged the slide as
 * "picture-placed", and the set's panels were never in the lost-picture retry, so the strip
 * shipped as numbered text with three judged pictures made. Here: the y1 animals replay with its
 * slide 6 swapped for the human writer's stages slide (chick, young hen, hen), as in part bx.
 */
type S = Record<string, unknown>;
const B = "y1-science-animals-young";
const read = (f: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures", f), "utf8")) as unknown;
const STAGES = (read("human-writer-y1-slides.json") as S[]).find((s) => s.template === "stages");
const AT = 5;
/** Its place in the run's deck: the stage adds the objectives slide and the hook before it. */
const DECK = AT + 2;
const text = (() => {
  const o = JSON.parse((read(`replay/${B}/main.json`) as { text: string }).text) as {
    slides: S[];
  };
  o.slides[AT] = STAGES as S;
  return JSON.stringify(o);
})();
const photo = (i: number, k: string): VisualState => ({
  status: "photo",
  photo: { src: `https://img.test/${i}-${k}.png`, alt: k, aspect: 1, request: k } as never,
});

type Opts = {
  /** May the gap be asked again (it ran out of time)? */
  retryable: boolean;
  /** Does the one remake land? */
  remakeLands: boolean;
  /** Stage 2 is still pending when the slide's own wait ends (the early job's look). */
  slideDone?: boolean;
};
const run = async (o: Opts) => {
  const events: S[] = [];
  const retried: string[] = [];
  let settled = false;
  let remade = false;
  const gap = `${DECK}:stage.2`;
  const out = await runWriter({
    brief: read(`replay/${B}/brief.json`) as Brief,
    objectives: (
      read(`replay/${B}/objectives.json`) as { objectives: { teacher: string }[] }
    ).objectives.map((x) => x.teacher),
    checks: "log",
    services: {
      ...replayServices(B),
      log: (e: object) => {
        events.push(e as S);
      },
      writer: async () => ({ text, finishReason: "stop", usd: 0, ms: 0 }),
    },
    visual: (i: number, k: string, a: { type: string }) => {
      if (a.type !== "photo") return { status: "failed" };
      if (`${i}:${k}` !== gap) return photo(i, k);
      if (remade) return photo(i, k);
      return settled ? { status: "failed" } : { status: "pending" };
    },
    beforeEditable: async () => {
      // The round's settle comes after the slide's own wait has ended and its early job looked.
      if (o.slideDone) await new Promise((r) => setTimeout(r, 20));
      settled = true;
    },
    ...(o.slideDone ? { slideDone: async () => {} } : {}),
    drawDiagrams: {
      callDrawer: async () => {
        throw new Error("drawer down");
      },
    },
    drawAs: () => "process",
    retryable: (i: number, k: string) => o.retryable && `${i}:${k}` === gap,
    placeMore: async (i: number, more: { key: string }[]) => {
      for (const a of more) retried.push(`${i}:${a.key}`);
      if (o.remakeLands) remade = true;
    },
  } as never);
  const slide = out.slides.find((s) => s.id === `s${DECK + 1}`);
  const pictures = JSON.stringify(slide?.elements ?? []).match(/https:\/\/img\.test\/[^"]+/g) ?? [];
  return { out, events, retried, pictures: [...new Set(pictures)] };
};
const at = (events: S[], ev: string) => events.filter((e) => e.ev === ev && e.slide === DECK + 1);

describe("a stages set with one gap (TEACH-247 part cy)", () => {
  test("the gap is made again once, alone, and the strip shows every stage's picture", async () => {
    const { retried, pictures, events } = await run({ retryable: true, remakeLands: true });
    // Only the lost panel is asked again, once, and never handed to the drawer.
    expect(retried).toEqual([`${DECK}:stage.2`]);
    expect(pictures).toHaveLength(3);
    expect(at(events, "lost-picture")).toEqual([
      expect.objectContaining({ ok: true, landed: 1, asked: 1 }),
    ]);
  });

  test("a slide with a stage still out at its early wait is not logged as placed", async () => {
    const { retried, pictures, events } = await run({
      retryable: true,
      remakeLands: true,
      slideDone: true,
    });
    expect(at(events, "lost-early-landed")).toEqual([]);
    expect(at(events, "lost-early-partial")).toEqual([
      expect.objectContaining({ placed: 2, asked: 3 }),
    ]);
    // The tail then makes the gap again, once.
    expect(retried).toEqual([`${DECK}:stage.2`]);
    expect(pictures).toHaveLength(3);
  });

  test("a gap that cannot be made again goes to the writer's reroute, never logged as placed", async () => {
    const { retried, events } = await run({ retryable: false, remakeLands: false });
    expect(retried).toEqual([]);
    const paths = events.filter((e) => e.ev === "visual-path" && e.slide === DECK + 1);
    expect(paths.map((e) => e.path)).not.toContain("picture-placed");
    expect(paths.map((e) => String(e.path))).toEqual([expect.stringMatching(/^picture-/)]);
    expect(events.some((e) => e.ev === "repair" && e.slide === DECK + 1)).toBe(true);
  });
});

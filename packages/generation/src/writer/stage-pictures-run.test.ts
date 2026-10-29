import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { placeholderSlots } from "./checks";
import type { Brief } from "./fixes";
import type { VisualState } from "./materialise";
import { replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part bx, through the writer stage: the y1 animals replay with its slide 6 swapped for
 * the human writer's stages slide (chick, young hen, hen; replay 20261029-010427 s7). The stage
 * asks for each stage picture, and a landed set leaves no placeholder. A slot that is still open
 * when the run ends is a check fault and a `placeholder-shipped` error, in log mode too, and
 * nothing repairs it.
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

const run = (state: (i: number, k: string) => VisualState) => {
  const asked: string[] = [];
  const events: S[] = [];
  const out = runWriter({
    brief: read(`replay/${B}/brief.json`) as Brief,
    objectives: (
      read(`replay/${B}/objectives.json`) as { objectives: { teacher: string }[] }
    ).objectives.map((o) => o.teacher),
    checks: "log",
    services: {
      ...replayServices(B),
      log: (e: object) => {
        events.push(e as S);
      },
      writer: async () => ({ text, finishReason: "stop", usd: 0, ms: 0 }),
    },
    visual: (i: number, k: string, a: { type: string }) => {
      if (a.type === "photo") asked.push(`${i}:${k}`);
      return a.type === "photo" ? state(i, k) : { status: "failed" };
    },
    beforeEditable: async () => {},
    drawDiagrams: {
      callDrawer: async () => {
        throw new Error("drawer down");
      },
    },
    retryable: () => false,
    placeMore: async () => undefined,
  } as never);
  return out.then((o) => ({ out: o, asked, events }));
};
const landed = (i: number, k: string): VisualState => ({
  status: "photo",
  photo: { src: `https://img.test/${i}-${k}.png`, alt: k, aspect: 1, request: k } as never,
});

describe("stages through the writer stage (TEACH-247 part bx)", () => {
  test("every stage picture is asked for and lands: no placeholder ships", async () => {
    const { out, asked, events } = await run(landed);
    for (const n of [0, 1, 2]) expect(asked).toContain(`${DECK}:stage.${n}`);
    const s6 = out.slides.find((s) => s.id === `s${DECK + 1}`);
    expect(placeholderSlots(s6?.elements ?? [])).toEqual([]);
    expect(events.filter((e) => e.ev === "placeholder-shipped")).toEqual([]);
  });
  test("a stage slot still open at the end is a check fault and a logged error, not repaired", async () => {
    const { out, events } = await run((i, k) =>
      i === DECK && k.startsWith("stage.") ? { status: "pending" } : landed(i, k),
    );
    const shipped = events.filter((e) => e.ev === "placeholder-shipped");
    expect(shipped).toEqual([
      {
        ev: "placeholder-shipped",
        level: "error",
        fault: "placeholder",
        id: `s${DECK + 1}`,
        open: 3,
      },
    ]);
    const faults = out.checks.find((c) => c.slide === DECK + 1)?.faults ?? [];
    expect(faults.filter((f) => f.startsWith("placeholder:"))).toHaveLength(3);
    expect(events.find((e) => e.ev === "summary")?.placeholders).toBe(1);
    expect(events.some((e) => e.ev === "repair-skipped" && e.slide === DECK + 1)).toBe(false);
  });
});

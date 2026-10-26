import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * The tail (genlab Y1 plants, 26 Oct): slide 5's photo was lost 7 s before the writer's stream
 * ended, but its retry started only after every picture, the checks and the repairs, 39 s after
 * it, and the job ended 31 s later. With `slideDone` the retry runs as soon as that slide's own
 * pictures are over, before editable, once; the tail does not retry it again.
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));

async function run(early: boolean) {
  const rec = recordedVisuals(B);
  const placed = new Set<string>();
  const order: string[] = [];
  const src = (k: string) => `/files/test/${k.replace(":", "-")}.png`;
  const visual = (i: number, key: string, a: VisualAsk): VisualState => {
    const k = `${i}:${key}`;
    if (placed.has(k))
      return { status: "photo", photo: { src: src(k), alt: key, aspect: 1.5, request: key } };
    if (k === "4:picture") return { status: "failed" };
    return rec(i, key, a);
  };
  const events: { ev?: string; slide?: number }[] = [];
  const out = await runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    services: {
      ...replayServices(B),
      log: (e: { ev?: string; slide?: number }) => events.push(e),
      writer: async () => ({
        text: (read("main.json") as { text: string }).text,
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
    },
    visual,
    held: recordedHeld(B),
    retryable: (i, key) => i === 4 && key === "picture",
    ...(early ? { slideDone: async () => {} } : {}),
    beforeEditable: async () => {
      order.push("pictures settled");
    },
    placeMore: async (i, more) => {
      order.push(`retry ${more.map((a) => `${i}:${a.key}`).join(",")}`);
      for (const a of more) placed.add(`${i}:${a.key}`);
    },
    onEditable: () => {
      order.push("editable");
    },
  });
  return { out, order, events, src: src("4:picture") };
}

describe("a lost picture is retried before editable, once (slideDone)", () => {
  test("with slideDone: the retry runs before editable and the tail does not run it again", async () => {
    const { out, order, events, src } = await run(true);
    expect(order.filter((o) => o.startsWith("retry"))).toEqual(["retry 4:picture"]);
    expect(order.indexOf("retry 4:picture")).toBeLessThan(order.indexOf("editable"));
    expect(events).toContainEqual(expect.objectContaining({ ev: "lost-early", slide: 5 }));
    expect(JSON.stringify(out.slides)).toContain(src);
  });

  test("without slideDone: the tail retries it after editable, as before", async () => {
    const { out, order, events, src } = await run(false);
    expect(order.filter((o) => o.startsWith("retry"))).toEqual(["retry 4:picture"]);
    expect(order.indexOf("retry 4:picture")).toBeGreaterThan(order.indexOf("editable"));
    expect(events.some((e) => e.ev === "lost-early")).toBe(false);
    expect(JSON.stringify(out.slides)).toContain(src);
  });
});

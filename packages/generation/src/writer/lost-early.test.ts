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

type Opts = {
  /** Slides whose first-round picture is lost. */
  lost?: number[];
  /** placeMore's behaviour: wait for this before placing, or throw. */
  gate?: Promise<void>;
  throws?: boolean;
  atEditable?: () => void;
  /** Slide 5's picture is still pending when its own wait ends, and fails only at the deadline. */
  pendingAtWait?: boolean;
};
async function run(early: boolean, o: Opts = {}) {
  const lostSlides = new Set(o.lost ?? [4]);
  const rec = recordedVisuals(B);
  const placed = new Set<string>();
  const order: string[] = [];
  const src = (k: string) => `/files/test/${k.replace(":", "-")}.png`;
  const visual = (i: number, key: string, a: VisualAsk): VisualState => {
    const k = `${i}:${key}`;
    if (placed.has(k))
      return { status: "photo", photo: { src: src(k), alt: key, aspect: 1.5, request: key } };
    if (lostSlides.has(i) && a.type === "photo")
      return o.pendingAtWait && !deadlinePassed ? { status: "pending" } : { status: "failed" };
    return rec(i, key, a);
  };
  let deadlinePassed = false;
  const events: { ev?: string; slide?: number }[] = [];
  const diagramSlides = new Set<number>();
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
    retryable: (i) => lostSlides.has(i),
    ...(early ? { slideDone: async () => {} } : {}),
    beforeEditable: async () => {
      // The round's settle: what was still pending is now failed (miss "deadline"), after the
      // slide's own wait has ended and its early job has looked.
      if (o.pendingAtWait) await new Promise((r) => setTimeout(r, 20));
      deadlinePassed = true;
      order.push("pictures settled");
    },
    placeMore: async (i, more) => {
      order.push(`retry ${more.map((a) => `${i}:${a.key}`).join(",")}`);
      if (o.gate) await o.gate;
      if (o.throws) throw new Error("placer bug");
      for (const a of more) placed.add(`${i}:${a.key}`);
      order.push(`placed ${i}`);
    },
    onAsks: (i, a) => {
      if (a.some((x) => x.type === "diagram")) diagramSlides.add(i);
    },
    onEditable: () => {
      order.push("editable");
      o.atEditable?.();
    },
  });
  return { out, order, events, src: src("4:picture"), diagramSlides };
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

describe("an early retry never holds editable back", () => {
  test("a slow retry: editable comes first, and the picture still lands before the job ends", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    // The placement waits until the deck is editable: if editable waited for it, this would hang.
    const p = run(true, { gate, atEditable: () => open() });
    const { out, order, src } = await p;
    expect(order.indexOf("retry 4:picture")).toBeLessThan(order.indexOf("editable"));
    expect(order.indexOf("editable")).toBeLessThan(order.indexOf("placed 4"));
    // Asked once: the tail waited for the early retry instead of asking again.
    expect(order.filter((x) => x.startsWith("retry"))).toEqual(["retry 4:picture"]);
    expect(JSON.stringify(out.slides)).toContain(src);
  });

  test("a throw in an early retry: logged, the slide kept as it was, the lesson finishes, no second ask", async () => {
    const { out, order, events, src } = await run(true, { throws: true });
    expect(events).toContainEqual(expect.objectContaining({ ev: "lost-early-failed", slide: 5 }));
    expect(order.filter((x) => x.startsWith("retry"))).toEqual(["retry 4:picture"]);
    expect(out.slides.length).toBeGreaterThan(5);
    expect(JSON.stringify(out.slides)).not.toContain(src);
  });

  test("the slide's tail waits for its early retry, then runs its own steps on the result", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const { events, order, out, src } = await run(true, { gate, atEditable: () => open() });
    const at = (ev: string) => events.findIndex((e) => e.ev === ev && e.slide === 5);
    expect(order.indexOf("editable")).toBeLessThan(order.indexOf("placed 4"));
    // The retry's outcome is logged once, and the deck the job ends with carries its picture.
    expect(events.filter((e) => e.ev === "lost-picture" && e.slide === 5)).toHaveLength(1);
    expect(at("lost-picture")).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(out.slides)).toContain(src);
    // cardRetry and fallback had nothing to do on this slide (the only slides retried early).
    expect(events.some((e) => e.ev === "card-retry" && e.slide === 5)).toBe(false);
  });
});

describe("a picture still pending when its early wait ends", () => {
  test("the early job does not retry it; the tail does, after editable, once", async () => {
    const { out, order, events, src } = await run(true, { pendingAtWait: true });
    expect(events.some((e) => e.ev === "lost-early")).toBe(false);
    expect(order.filter((x) => x.startsWith("retry"))).toEqual(["retry 4:picture"]);
    expect(order.indexOf("retry 4:picture")).toBeGreaterThan(order.indexOf("editable"));
    expect(JSON.stringify(out.slides)).toContain(src);
  });
});

describe("pictures that land after the settle, during the slide's early wait (TEACH-247 part cc)", () => {
  test("are laid into the slide, not dropped because the settle had passed", async () => {
    const rec = recordedVisuals(B);
    let landed = false;
    let settled: () => void = () => {};
    const settledP = new Promise<void>((r) => {
      settled = r;
    });
    const src = "/files/test/4-late.png";
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
      // Slide 5's picture failed at the settle; its group repaint lands after it.
      visual: (i, key, a) =>
        i === 4 && a.type === "photo"
          ? landed
            ? { status: "photo", photo: { src, alt: key, aspect: 1.5, request: key } }
            : { status: "failed" }
          : rec(i, key, a),
      held: recordedHeld(B),
      retryable: () => false,
      editableAtWords: true,
      slideDone: async (i) => {
        if (i !== 4) return;
        await settledP;
        await new Promise((r) => setTimeout(r, 10));
        landed = true;
      },
      beforeEditable: async () => {
        settled();
      },
    });
    expect(events.some((e) => e.ev === "lost-early-landed" && e.slide === 5)).toBe(true);
    expect(JSON.stringify(out.slides)).toContain(src);
  });
});

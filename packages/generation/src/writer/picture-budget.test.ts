import { describe, expect, test } from "bun:test";
import { PICTURE_RETRY_BUDGET, pictureRetryBudget } from "./stage";

/* Picture retry time (R3-DIAGNOSIS fault D): a wall-clock budget per slide and per lesson. */

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, wait: (ms: number) => (t += ms) };
};
const round = (c: ReturnType<typeof clock>, ms: number) => async () => {
  c.wait(ms);
};

describe("pictureRetryBudget", () => {
  test("Pepys (y2 s10): a 45 s retry round, then the 51 s split round is not started", async () => {
    const c = clock();
    const b = pictureRetryBudget(PICTURE_RETRY_BUDGET, c.now);
    expect(b.cut(9)).toBeUndefined();
    await b.round(9, round(c, 45_000));
    expect(b.cut(9)).toEqual({ scope: "slide", usedMs: 45_000, budgetMs: 60_000 });
  });
  test("every recorded landed round (15-51 s, one per slide) still starts", async () => {
    const c = clock();
    const b = pictureRetryBudget(PICTURE_RETRY_BUDGET, c.now);
    // Slides retried together at the tail: each first round starts.
    for (const [i, ms] of [
      [3, 15_000],
      [5, 51_000],
      [7, 30_000],
    ] as const) {
      expect(b.cut(i)).toBeUndefined();
      await b.round(i, round(c, 0));
      c.wait(ms / 10);
    }
    // A short first round leaves room for a second.
    const d = clock();
    const b2 = pictureRetryBudget(PICTURE_RETRY_BUDGET, d.now);
    await b2.round(4, round(d, 15_000));
    expect(b2.cut(4)).toBeUndefined();
  });
  test("no retry starts once the lesson is past its window", async () => {
    const c = clock();
    const b = pictureRetryBudget(PICTURE_RETRY_BUDGET, c.now);
    await b.round(2, round(c, 10_000));
    c.wait(95_000);
    expect(b.cut(6)).toEqual({ scope: "lesson", usedMs: 105_000, budgetMs: 120_000 });
  });
  test("a round that throws still counts its time", async () => {
    const c = clock();
    const b = pictureRetryBudget(PICTURE_RETRY_BUDGET, c.now);
    await expect(
      b.round(3, async () => {
        c.wait(50_000);
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(b.cut(3)?.scope).toBe("slide");
  });
});

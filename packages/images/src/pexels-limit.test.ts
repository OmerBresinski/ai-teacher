import { describe, expect, test } from "bun:test";
import { type PexelsClient, PexelsError, type PhotoSearchPage } from "./pexels";
import { limitPexels } from "./pexels-limit";

/* C6 (TEACH-110 part h): a token bucket and one short retry on a 429, on a fake clock. */

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    at: () => t,
  };
}
const page: PhotoSearchPage = { photos: [], page: 1, hasMore: false } as unknown as PhotoSearchPage;

function fake(answers: ("ok" | 429 | "quota" | 500)[]) {
  const calls: number[] = [];
  let n = 0;
  return {
    calls,
    client: (c: ReturnType<typeof clock>): PexelsClient => ({
      search: async () => {
        calls.push(c.at());
        const a = answers[Math.min(n++, answers.length - 1)];
        if (a === 429) throw new PexelsError(429, "busy");
        if (a === "quota") throw new PexelsError(429, "quota", 2_000_000);
        if (a === 500) throw new PexelsError(500, "down");
        return page;
      },
      photo: async () => null,
    }),
  };
}

describe("limitPexels", () => {
  test("a burst of 18 searches is spread: 5 at once, then 5 a second", async () => {
    const c = clock();
    const f = fake(["ok"]);
    const limited = limitPexels(f.client(c), { now: c.now, sleep: c.sleep });
    await Promise.all(Array.from({ length: 18 }, () => limited.search({ query: "hen" })));
    expect(f.calls.filter((t) => t === 0)).toHaveLength(5);
    // 13 more at 5 a second: the last about 2.6 s in
    expect(Math.max(...f.calls)).toBeGreaterThanOrEqual(2400);
    expect(Math.max(...f.calls)).toBeLessThanOrEqual(2800);
  });

  test("a 429 waits a short backoff and retries once; the retry's answer is the caller's", async () => {
    const c = clock();
    const f = fake([429, "ok"]);
    const limited = limitPexels(f.client(c), { now: c.now, sleep: c.sleep, backoffMs: 1000 });
    await expect(limited.search({ query: "hen" })).resolves.toBe(page);
    expect(f.calls).toHaveLength(2);
    expect((f.calls[1] ?? 0) - (f.calls[0] ?? 0)).toBeGreaterThanOrEqual(1000);
  });

  test("a second 429 reaches the caller (it falls to generation as before)", async () => {
    const c = clock();
    const f = fake([429, 429]);
    const limited = limitPexels(f.client(c), { now: c.now, sleep: c.sleep });
    await expect(limited.search({ query: "hen" })).rejects.toMatchObject({ status: 429 });
    expect(f.calls).toHaveLength(2);
  });

  test("the monthly quota and other errors are not retried", async () => {
    for (const a of ["quota", 500] as const) {
      const c = clock();
      const f = fake([a, "ok"]);
      const limited = limitPexels(f.client(c), { now: c.now, sleep: c.sleep });
      await expect(limited.search({ query: "hen" })).rejects.toBeInstanceOf(PexelsError);
      expect(f.calls).toHaveLength(1);
    }
  });

  test("an aborted wait rejects with the abort and frees the line", async () => {
    const limited = limitPexels(
      { search: async () => page, photo: async () => null },
      { burst: 1, perSecond: 1 },
    );
    await limited.search({ query: "a" });
    const stop = new AbortController();
    const waiting = limited.search({ query: "b", signal: stop.signal });
    stop.abort(new DOMException("stopped", "AbortError"));
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });
});

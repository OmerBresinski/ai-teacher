import { describe, expect, test } from "bun:test";
import { createProgressiveDeck, type SlidePatch } from "./progressive";

/* Progressive persist (TEACH-110 part h, C2): per-slide patches, throttled, serial writes. */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createProgressiveDeck", () => {
  test("the first patch writes at once; later ones fold into one write per interval", async () => {
    const writes: number[][] = [];
    const deck = createProgressiveDeck<string>({
      intervalMs: 60,
      onError: () => {},
      write: async (p) => {
        writes.push([...p.keys()]);
      },
    });
    deck.patch(0, "title");
    await wait(5);
    expect(writes).toEqual([[0]]);
    deck.patch(2, "a");
    deck.patch(3, "b");
    deck.patch(4, "c");
    await wait(20);
    expect(writes).toHaveLength(1);
    await wait(60);
    expect(writes).toEqual([[0], [0, 2, 3, 4]]);
    await deck.close();
  });

  test("a patch replaces its slide in place and keeps its state", async () => {
    let last: ReadonlyMap<number, SlidePatch<string>> | undefined;
    const deck = createProgressiveDeck<string>({
      intervalMs: 0,
      onError: () => {},
      write: async (p) => {
        last = p;
      },
    });
    deck.patch(2, "words");
    deck.patch(2, "words + diagram");
    await wait(5);
    expect(last?.get(2)).toEqual({ slide: "words + diagram", state: "writing" });
    await deck.close();
  });

  test("close waits for a write in flight and stops every later one", async () => {
    const log: string[] = [];
    const deck = createProgressiveDeck<string>({
      intervalMs: 0,
      onError: () => {},
      write: async () => {
        log.push("start");
        await wait(30);
        log.push("end");
      },
    });
    deck.patch(0, "x");
    await wait(2);
    deck.patch(2, "y");
    await deck.close();
    log.push("closed");
    deck.patch(3, "z");
    await wait(40);
    expect(log).toEqual(["start", "end", "closed"]);
  });

  test("a failed write is reported, not thrown", async () => {
    const errors: unknown[] = [];
    const deck = createProgressiveDeck<string>({
      intervalMs: 0,
      onError: (e) => errors.push(e),
      write: () => Promise.reject(new Error("db down")),
    });
    deck.patch(0, "x");
    await wait(5);
    await deck.close();
    expect(errors).toHaveLength(1);
  });
});

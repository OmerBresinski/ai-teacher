/**
 * C7 (TEACH-167 part b): a stock-first search that runs past the threshold races its generation.
 * Real `findPicture`, a fake library and generator, real timers and real abort signals.
 */
import { describe, expect, test } from "bun:test";
import type { PlacedPhoto } from "./illustrate";
import { type BankRequest, findPicture, type MadePicture, type PictureBank } from "./photo-bank";

const req: BankRequest = {
  text: "A light and a dark peppered moth on tree bark",
  named: null,
  route: "generic",
  stockFirst: true,
  imagePrompt: "Two peppered moths on bark.",
  draw: null,
};
const stockPhoto = (src: string) =>
  ({ src, alt: src, source: { provider: "pexels", id: src } }) as unknown as PlacedPhoto;
const madePhoto = (src: string) =>
  ({
    src,
    alt: src,
    source: { provider: "generated", id: src },
    style: "photo",
    dataUrl: "data:image/png;base64,AAAA",
  }) as unknown as MadePicture;
const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
/** Resolves after `ms`, or rejects at once when `signal` aborts (as a real fetch does). */
const after = <T>(ms: number, value: T, signal?: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => resolve(value), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(abortError());
    });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeBank(generate: (signal: AbortSignal) => Promise<MadePicture | undefined>) {
  const log = { generated: 0, remembered: [] as string[], rejected: [] as string[] };
  const signals: AbortSignal[] = [];
  const bank: PictureBank = {
    lookup: async () => undefined,
    remember: async (_r, p) => {
      log.remembered.push(p.src);
    },
    generate: async (_r, _f, signal) => {
      log.generated += 1;
      signals.push(signal);
      return generate(signal);
    },
    reject: async (p) => {
      log.rejected.push(p.src);
    },
  };
  return { bank, log, signals };
}

describe("C7: stock races generation after the threshold", () => {
  test("stock inside the threshold: no generation starts", async () => {
    const { bank, log } = fakeBank((s) => after(5, madePhoto("/g.png"), s));
    const job = new AbortController();
    const out = await findPicture(
      req,
      bank,
      (s) => after(5, stockPhoto("/p.jpg"), s),
      job.signal,
      async () => true,
      Date.now,
      undefined,
      50,
    );
    expect(out.via).toBe("fetched");
    expect(out.photo?.src).toBe("/p.jpg");
    expect(log.generated).toBe(0);
    expect(log.remembered).toEqual(["/p.jpg"]);
  });

  test("generation wins: the stock search is aborted and its answer never remembered", async () => {
    const { bank, log } = fakeBank((s) => after(10, madePhoto("/g.png"), s));
    let stockSignal: AbortSignal | undefined;
    const out = await findPicture(
      req,
      bank,
      (s) => {
        stockSignal = s;
        // A search that ignores its signal still answers late: the answer must be dropped.
        return after(120, stockPhoto("/p.jpg"));
      },
      new AbortController().signal,
      async () => true,
      Date.now,
      undefined,
      30,
    );
    expect(out.via).toBe("generated");
    expect(out.photo?.src).toBe("/g.png");
    expect(stockSignal?.aborted).toBe(true);
    await sleep(150);
    expect(log.remembered).toEqual([]);
    // Its late answer is taken back out, never left stored.
    expect(log.rejected).toEqual(["/p.jpg"]);
  });

  test("stock wins while the generation is in flight: the generation is aborted", async () => {
    const { bank, log, signals } = fakeBank((s) => after(400, madePhoto("/g.png"), s));
    const out = await findPicture(
      req,
      bank,
      (s) => after(60, stockPhoto("/p.jpg"), s),
      new AbortController().signal,
      async () => true,
      Date.now,
      undefined,
      20,
    );
    expect(out.via).toBe("fetched");
    expect(log.generated).toBe(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(log.remembered).toEqual(["/p.jpg"]);
    await sleep(20);
    expect(log.rejected).toEqual([]);
  });

  test("stock wins while the made picture is being judged: it is rejected, never placed", async () => {
    const { bank, log } = fakeBank(async () => madePhoto("/g.png"));
    const out = await findPicture(
      req,
      bank,
      (s) => after(60, stockPhoto("/p.jpg"), s),
      new AbortController().signal,
      // The judge says yes, but only after stock has answered.
      () => after(150, true),
      Date.now,
      undefined,
      20,
    );
    expect(out.via).toBe("fetched");
    expect(out.photo?.src).toBe("/p.jpg");
    await sleep(160);
    expect(log.rejected).toEqual(["/g.png"]);
    expect(log.remembered).toEqual(["/p.jpg"]);
  });

  test("a side that misses waits for the other; both missing is no picture", async () => {
    const miss = fakeBank((s) => after(10, undefined, s));
    const late = await findPicture(
      req,
      miss.bank,
      (s) => after(60, stockPhoto("/p.jpg"), s),
      new AbortController().signal,
      async () => true,
      Date.now,
      undefined,
      20,
    );
    expect(late.via).toBe("fetched");
    const none = await findPicture(
      req,
      fakeBank((s) => after(10, undefined, s)).bank,
      (s) => after(40, undefined, s),
      new AbortController().signal,
      async () => true,
      Date.now,
      undefined,
      20,
    );
    expect(none.via).toBe("none");
  });

  test("the job's own cancel still throws through the race", async () => {
    const { bank } = fakeBank((s) => after(400, madePhoto("/g.png"), s));
    const job = new AbortController();
    const p = findPicture(
      req,
      bank,
      (s) => after(400, stockPhoto("/p.jpg"), s),
      job.signal,
      async () => true,
      Date.now,
      undefined,
      20,
    );
    setTimeout(() => job.abort(abortError()), 50);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  test("generation lands a moment before stock: exactly one is placed, the other removed", async () => {
    // Neither side listens to its signal, so both answers arrive.
    const { bank, log } = fakeBank(() => after(5, madePhoto("/g.png")));
    const out = await findPicture(
      req,
      bank,
      () => after(50, stockPhoto("/p.jpg")),
      new AbortController().signal,
      async () => true,
      Date.now,
      undefined,
      20,
    );
    expect(out.photo?.src).toBe("/g.png");
    await sleep(80);
    expect(log.remembered).toEqual([]);
    expect(log.rejected).toEqual(["/p.jpg"]);
  });

  test("stock lands a moment before generation: exactly one is placed, the other removed", async () => {
    const { bank, log } = fakeBank(() => after(40, madePhoto("/g.png")));
    const out = await findPicture(
      req,
      bank,
      () => after(30, stockPhoto("/p.jpg")),
      new AbortController().signal,
      async () => true,
      Date.now,
      undefined,
      20,
    );
    expect(out.photo?.src).toBe("/p.jpg");
    await sleep(80);
    expect(log.remembered).toEqual(["/p.jpg"]);
    expect(log.rejected).toEqual(["/g.png"]);
  });
});

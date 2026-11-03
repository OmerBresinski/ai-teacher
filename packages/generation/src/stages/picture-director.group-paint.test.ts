import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import type { DirectedPlacer } from "./illustrate";
import type { BankRequest, PictureBank } from "./photo-bank";
import { createWriterPictures, type WriterPhotoAsk } from "./picture-director";

// TEACH-247 part cz (rivers pr754 s4, a panel list of 4 pictures): the settle stopped one row. The
// group's repaint started at once, beside the stage's retry of that row: 4 images ($0.021) and 38 s
// of tail, and without a spend guard the paintings replace what landed (romans v417n s8 lost three
// real photos). A repaint is for a gap nothing else is about to fill.
const direction = (shows: string): PictureDirection => ({
  route: "library-or-generate",
  pictures: [{ shows, mustShow: ["water"], queries: ["river"], imagePrompt: `${shows}.` }],
  count: null,
  diagram: null,
  named: null,
  period: null,
});
const slide = { heading: "Erosion", text: "Rivers wear rock away.", point: "" };
const row = (n: number): WriterPhotoAsk => ({
  key: `row.${n}`,
  type: "photo",
  shows: `River picture ${n}`,
  mustSee: [],
  named: false,
  aspect: 1.34,
});
const INDEX = 3;
const images = {
  search: async () => [],
  searchCommons: async () => [],
  store: async () => {
    throw new Error("nothing is stored here");
  },
} as unknown as DirectedPlacer;
const made = (req: BankRequest, tag: string) =>
  ({
    src: `/files/ws/${tag}-${req.text.replace(/\W+/g, "-")}.png`,
    width: 1340,
    height: 1000,
    alt: req.text,
    style: "illustration",
    source: { provider: "generated", id: tag, pageUrl: "" },
  }) as never;
const until = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/**
 * A group whose `stuck` rows hang until the settle stops them. `answer` says what each later
 * generate gets; `calls` counts every generate after the settle.
 */
const setup = (o: {
  keys?: string[];
  stuck: string[];
  answer?: (req: BankRequest) => unknown;
  retriesLost?: boolean;
}) => {
  const asks = (o.keys ?? ["row.0", "row.1"]).map((key, n) => ({ ...row(n), key }));
  let settled = false;
  const calls: string[] = [];
  const bank: PictureBank = {
    lookup: async () => undefined,
    remember: async () => undefined,
    generate: async (req, _faithful, signal) => {
      if (settled) {
        calls.push(req.text);
        return (o.answer ?? ((r) => made(r, "late")))(req) as never;
      }
      const stuck = asks.find((a) => req.text.includes(a.shows) && o.stuck.includes(a.key));
      if (stuck) return until(signal);
      return made(req, "first");
    },
  };
  const pictures = createWriterPictures({
    lesson: sampleBriefLesson(),
    country: "UK",
    images,
    deps: recordingDeps(createFakeAi({ script: [] })),
    direct: async (input) => direction(input.request),
    bank,
    ...(o.retriesLost === false ? {} : { retriesLost: true }),
  });
  return {
    pictures,
    asks,
    calls,
    settle: async () => {
      for (const a of asks) pictures.start(INDEX, a, slide);
      await tick();
      const done = pictures.settle(20);
      settled = true;
      await done;
      await tick();
    },
  };
};
const srcOf = (s: { status: string; photo?: { src: string } }) => s.photo?.src ?? "";

describe("a group's repaint waits for what is about to fill its gap (TEACH-247 part cz)", () => {
  test("a row stopped by the settle paints nothing: the stage asks it again", async () => {
    const { pictures, calls, settle } = setup({ stuck: ["row.1"] });
    await settle();
    expect(calls).toEqual([]);
    expect(srcOf(pictures.state(INDEX, "row.0") as never)).toContain("first");
    expect(pictures.retryable(INDEX, "row.1")).toBe(true);
  });

  test("the retry that lands is the row's picture, generated once, and the group is left alone", async () => {
    const { pictures, asks, calls, settle } = setup({ stuck: ["row.1"] });
    await settle();
    pictures.start(INDEX, asks[1] as WriterPhotoAsk, slide);
    await pictures.settleSlide(INDEX, 500);
    await pictures.whenSlideDone(INDEX, 500);
    expect(calls).toHaveLength(1);
    expect(srcOf(pictures.state(INDEX, "row.0") as never)).toContain("first");
    expect(srcOf(pictures.state(INDEX, "row.1") as never)).toContain("late");
  });

  test("while a retry is still running nothing is painted", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { pictures, asks, calls, settle } = setup({
      stuck: ["row.1"],
      answer: (req) => gate.then(() => made(req, "late")),
    });
    await settle();
    pictures.start(INDEX, asks[1] as WriterPhotoAsk, slide);
    await tick();
    // Even a stage asking for the gaps now: the row's own placement is the one to wait for.
    await pictures.paintGaps(INDEX);
    await tick();
    expect(calls).toHaveLength(1);
    release();
    await pictures.whenSlideDone(INDEX, 500);
    expect(calls).toHaveLength(1);
  });

  test("a retry that misses leaves a real gap: every row is painted, the visual is never lost", async () => {
    let tries = 0;
    const { pictures, asks, calls, settle } = setup({
      stuck: ["row.1"],
      answer: (req) => {
        tries += 1;
        return tries <= 2 ? undefined : made(req, "painted");
      },
    });
    await settle();
    pictures.start(INDEX, asks[1] as WriterPhotoAsk, slide);
    await pictures.settleSlide(INDEX, 500);
    await pictures.whenSlideDone(INDEX, 500);
    expect(calls.length).toBeGreaterThan(2);
    expect(srcOf(pictures.state(INDEX, "row.0") as never)).toContain("painted");
    expect(srcOf(pictures.state(INDEX, "row.1") as never)).toContain("painted");
  });

  test("a row the stage never asks again is painted when the stage says its retries are over", async () => {
    const { pictures, calls, settle } = setup({
      stuck: ["row.1"],
      answer: (req) => made(req, "painted"),
    });
    await settle();
    expect(calls).toEqual([]);
    await pictures.paintGaps(INDEX);
    expect(srcOf(pictures.state(INDEX, "row.0") as never)).toContain("painted");
    expect(srcOf(pictures.state(INDEX, "row.1") as never)).toContain("painted");
    // Only once: a second look finds no gap.
    const n = calls.length;
    await pictures.paintGaps(INDEX);
    expect(calls).toHaveLength(n);
  });

  test("a group the stage has no retry for paints at once, as before", async () => {
    // Cards have their own path; the resume search has no stage behind it at all.
    for (const o of [
      { keys: ["card.0", "card.1"], stuck: ["card.1"] },
      { stuck: ["row.1"], retriesLost: false },
    ]) {
      const { pictures, asks, calls, settle } = setup({
        ...o,
        answer: (req) => made(req, "painted"),
      });
      await settle();
      await pictures.whenSlideDone(INDEX, 500);
      expect(calls.length).toBeGreaterThan(0);
      expect(srcOf(pictures.state(INDEX, asks[1]?.key ?? "") as never)).toContain("painted");
    }
  });

  test("a forgotten slide has no gap left to paint", async () => {
    const { pictures, calls, settle } = setup({ stuck: ["row.1"] });
    await settle();
    pictures.forget(INDEX);
    await pictures.paintGaps(INDEX);
    expect(calls).toEqual([]);
  });
});

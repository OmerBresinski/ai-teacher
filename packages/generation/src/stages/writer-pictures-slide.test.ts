import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import type { DirectedPlacer } from "./illustrate";
import { createWriterPictures, type WriterPhotoAsk } from "./picture-director";

// The real writer picture handle and its slots; only the director, search and store are fakes.
const images = {
  search: async () => [],
  searchCommons: async () => [],
  store: async () => {
    throw new Error("nothing is stored here");
  },
} as unknown as DirectedPlacer;
const ask: WriterPhotoAsk = {
  key: "picture",
  type: "photo",
  shows: "A portrait of Henry VIII",
  mustSee: ["Henry VIII"],
  named: true,
  aspect: 0.89,
};
const slide = { heading: "Henry VIII", text: "Henry VIII ruled England.", point: "" };
// A named person with no Commons photo: the slot ends failed with its own reason, at once.
const noPhoto: PictureDirection = {
  route: "commons",
  pictures: [
    {
      shows: "A portrait of Henry VIII",
      mustShow: ["Henry VIII"],
      queries: ["Henry VIII portrait"],
      imagePrompt: "A portrait of Henry VIII.",
    },
  ],
  count: null,
  diagram: null,
  named: "person",
  period: "Tudor England, 1509-1547",
};

describe("settleSlide: one slide's later picture round", () => {
  test("waits for its own slide only, and never cancels another slide's placement", async () => {
    let release: (d: PictureDirection) => void = () => {};
    const slow = new Promise<PictureDirection>((r) => {
      release = r;
    });
    let calls = 0;
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(createFakeAi({ script: [] })),
      // Slide 3's director answers at once; slide 4's waits until the test releases it.
      direct: async () => (calls++ === 0 ? noPhoto : slow),
    });
    pictures.start(3, ask, slide);
    pictures.start(4, ask, slide);
    await pictures.settleSlide(3, 5_000);
    expect(pictures.state(3, "picture").status).toBe("failed");
    expect(pictures.vetoed(3, "picture")).toContain("No real photograph");
    // Slide 4 is still running: not waited for, not stopped, not marked failed.
    expect(pictures.state(4, "picture").status).toBe("pending");
    release(noPhoto);
    await pictures.settleSlide(4, 5_000);
    // It ended on its own outcome, not on a deadline or a cancel from slide 3's round.
    expect(pictures.vetoed(4, "picture")).toContain("No real photograph");
  });

  test("a slide's ask still running at its deadline is failed, as `settle` fails one", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: () => new Promise<PictureDirection | undefined>(() => {}),
    });
    pictures.start(5, ask, slide);
    await pictures.settleSlide(5, 5);
    expect(pictures.state(5, "picture").status).toBe("failed");
    expect(pictures.vetoed(5, "picture")).toContain("ran out of time");
  });
});

describe("whenSlideDone and the early re-ask (the lost picture retried before editable)", () => {
  const make = (direct: () => Promise<PictureDirection | undefined>) =>
    createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct,
    });

  test("waits for one slide's placements without failing another slide's or ending the round", async () => {
    let release: (d: PictureDirection) => void = () => {};
    const slow = new Promise<PictureDirection>((r) => {
      release = r;
    });
    let calls = 0;
    const pictures = make(async () => (calls++ === 0 ? noPhoto : slow));
    pictures.start(3, ask, slide);
    pictures.start(4, ask, slide);
    await pictures.whenSlideDone(3, 5_000);
    expect(pictures.state(3, "picture").status).toBe("failed");
    expect(pictures.state(4, "picture").status).toBe("pending");
    // The round has not ended: a key never started is still pending, not failed.
    expect(pictures.state(9, "never").status).toBe("pending");
    release(noPhoto);
    await pictures.whenSlideDone(4, 5_000);
    expect(pictures.vetoed(4, "picture")).toContain("No real photograph");
  });

  test("a failed single ask is asked once more as soon as its own placement is over", async () => {
    let calls = 0;
    const pictures = make(async () => {
      calls++;
      return noPhoto;
    });
    pictures.start(3, ask, slide);
    // Before its placement is over it is not asked again.
    expect(pictures.canReask(3, "picture")).toBe(false);
    await pictures.whenSlideDone(3, 5_000);
    expect(pictures.canReask(3, "picture")).toBe(true);
    pictures.start(3, ask, slide);
    await pictures.whenSlideDone(3, 5_000);
    expect(calls).toBe(2);
    // Once per round: a third ask is refused until the round settles.
    pictures.start(3, ask, slide);
    await pictures.whenSlideDone(3, 5_000);
    expect(calls).toBe(2);
  });

  test("settle neither waits for nor stops an early re-ask; the slide's own settle waits for it", async () => {
    let release: (d: PictureDirection) => void = () => {};
    const slow = new Promise<PictureDirection>((r) => {
      release = r;
    });
    let calls = 0;
    const pictures = make(async () => (calls++ === 0 ? noPhoto : slow));
    pictures.start(3, ask, slide);
    await pictures.whenSlideDone(3, 5_000);
    // The early re-ask (before the round settles) runs on the job's signal, not the round's.
    pictures.start(3, ask, slide);
    await pictures.settle(5_000);
    // Editable is not held for it, and it is still running, not failed by the round's end.
    expect(pictures.state(3, "picture").status).toBe("pending");
    release(noPhoto);
    await pictures.settleSlide(3, 5_000);
    expect(calls).toBe(2);
    expect(pictures.vetoed(3, "picture")).toContain("No real photograph");
  });
});

describe("whenSlideDone: its deadline, a cancel, and the re-ask after it", () => {
  const never = new Promise<PictureDirection>(() => {});
  const build = (direct: () => Promise<PictureDirection | undefined>, signal?: AbortSignal) =>
    createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: {
        ...recordingDeps(createFakeAi({ script: [] })),
        ...(signal ? { signal } : {}),
      },
      direct,
    });

  test("the deadline ends the wait; the slot stays pending (never marked failed) and is not re-asked", async () => {
    let calls = 0;
    const pictures = build(async () => {
      calls++;
      return never;
    });
    pictures.start(3, ask, slide);
    const t = Date.now();
    await pictures.whenSlideDone(3, 30);
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(pictures.state(3, "picture").status).toBe("pending");
    // Its placement is not over: no early re-ask.
    expect(pictures.canReask(3, "picture")).toBe(false);
    pictures.start(3, ask, slide);
    expect(calls).toBe(1);
  });

  test("a cancel ends the wait at once", async () => {
    const ac = new AbortController();
    const pictures = build(async () => never, ac.signal);
    pictures.start(3, ask, slide);
    const waiting = pictures.whenSlideDone(3, 60_000);
    ac.abort();
    const t = Date.now();
    await waiting;
    expect(Date.now() - t).toBeLessThan(1_000);
  });

  test("a cancel before the wait: it returns at once", async () => {
    const ac = new AbortController();
    ac.abort();
    const pictures = build(async () => never, ac.signal);
    const t = Date.now();
    await pictures.whenSlideDone(3, 60_000);
    expect(Date.now() - t).toBeLessThan(1_000);
  });
});

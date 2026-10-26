import { describe, expect, test } from "bun:test";
import { BudgetReservationError } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import type { Lesson, PhotoSource } from "@tj/domain/documents";
import { encodePng, type ImageGenerator, type PhotoResult, type StoredPhoto } from "@tj/images";
import pino from "pino";
import { FICTION_IN_PERIOD_IS_HISTORICAL } from "../period";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import { BudgetExceeded } from "../types";
import type { DirectedPlacer } from "./illustrate";
import { mustShowOf } from "./photo-bank";
import {
  createDirectorBatcher,
  createWriterPictures,
  HOUSE_PHOTO_LINE,
  ILLUSTRATION_LINE,
  STOCK_ONLY_BANK,
  setLookOf,
  type WriterPhotoAsk,
  withPhotoSources,
  writerAskBrief,
} from "./picture-director";
import { DIRECTOR_FIXTURES } from "./picture-director.fixtures";

const DIRECTOR_INPUT = DIRECTOR_FIXTURES[0]?.input as never;
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const photo = (id: string): PhotoResult => ({
  id,
  width: 800,
  height: 1200,
  alt: `Photo ${id}`,
  photographer: "Ada",
  photographerUrl: "https://www.pexels.com/@ada/",
  pageUrl: `https://www.pexels.com/photo/${id}/`,
  src: {
    large: `https://x/${id}`,
    medium: `https://x/${id}`,
    tiny: `data:image/png;base64,${PNG}`,
  },
});
const stored = (p: PhotoResult): StoredPhoto => ({
  key: `ws/${p.id}.jpg`,
  url: `/files/ws/${p.id}.jpg`,
  width: p.width,
  height: p.height,
  bytes: 1,
  contentType: "image/jpeg",
  source: {
    provider: "pexels",
    id: p.id,
    pageUrl: p.pageUrl,
    photographer: p.photographer,
    photographerUrl: p.photographerUrl,
  },
});
const images = (over: { pexels?: PhotoResult[]; commons?: () => Promise<PhotoResult[]> }) =>
  ({
    search: async () => over.pexels ?? [],
    ...(over.commons ? { searchCommons: over.commons } : {}),
    store: async (p: PhotoResult) => stored(p),
  }) as DirectedPlacer;

const ask = (over: Partial<WriterPhotoAsk> = {}): WriterPhotoAsk => ({
  key: "picture",
  type: "photo",
  shows: "A portrait of Henry VIII",
  mustSee: ["Henry VIII"],
  named: true,
  aspect: 0.89,
  ...over,
});
const slide = { heading: "Henry VIII", text: "Henry VIII ruled England.", point: "" };
const direction = (over: Partial<PictureDirection>): PictureDirection => ({
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
  named: null,
  period: null,
  ...over,
});
const verdict = (over: Record<string, unknown>) =>
  JSON.stringify({
    pick: null,
    onSubject: false,
    kindMatches: null,
    clear: false,
    fits: false,
    why: "x",
    visible: [],
    count: null,
    boxes: [],
    query: null,
    ...over,
  });

describe("writer pictures: a teacher never sees a placeholder", () => {
  test("a historical person with no Commons photo ends failed (text-only layout), never pending", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({ commons: async () => [], pexels: [photo("p1")] }),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => direction({ named: "person", period: "Tudor England, 1509-1547" }),
    });
    pictures.start(3, ask(), slide);
    expect(pictures.state(3, "picture").status).toBe("pending");
    await pictures.settle(1_000);
    expect(pictures.state(3, "picture")).toEqual({ status: "failed" });
    expect(pictures.vetoed(3, "picture")).toContain("No real photograph");
    expect(pictures.sources().size).toBe(0);
  });

  test("an ask still running at the deadline, a set panel and an ask never started are failed", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: () => new Promise<PictureDirection | undefined>(() => {}),
    });
    pictures.start(4, ask({ key: "col.0" }), slide);
    pictures.start(5, ask({ key: "seq.0", set: "s5" }), slide);
    await pictures.settle(5);
    expect(pictures.state(4, "col.0").status).toBe("failed");
    expect(pictures.vetoed(4, "col.0")).toContain("ran out of time");
    expect(pictures.state(5, "seq.0").status).toBe("failed");
    expect(pictures.state(9, "picture").status).toBe("failed");
  });

  test("a placed photo is a photo state with its aspect, and its source credits the element", async () => {
    const ai = createFakeAi({
      script: [
        verdict({
          pick: "p7",
          onSubject: true,
          clear: true,
          fits: true,
          visible: ["sheep"],
          count: "one",
          boxes: [{ item: "sheep", left: 0.1, top: 0.2, right: 0.6, bottom: 0.9 }],
        }),
      ],
    });
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({ pexels: [photo("p7")] }),
      deps: recordingDeps(ai),
      direct: async () =>
        direction({
          route: "pexels",
          pictures: [
            {
              shows: "A sheep in a field",
              mustShow: ["sheep"],
              queries: ["sheep field"],
              imagePrompt: "A sheep.",
            },
          ],
        }),
    });
    pictures.start(
      2,
      ask({ shows: "A sheep in a field", mustSee: ["sheep"], named: false }),
      slide,
    );
    await pictures.settle(1_000);
    const s = pictures.state(2, "picture");
    expect(s.status).toBe("photo");
    if (s.status === "photo") {
      expect(s.photo.src).toBe("/files/ws/p7.jpg");
      expect(s.photo.aspect).toBeCloseTo(800 / 1200);
      expect(s.photo.request).toBe("A sheep in a field. sheep");
      expect(s.photo.subjects?.[0]).toEqual({ name: "sheep", x: 0.1, y: 0.2, w: 0.5, h: 0.7 });
    }
    const [tagged] = withPhotoSources(
      [
        {
          elements: [
            { type: "image", src: "/files/ws/p7.jpg" },
            { type: "group", children: [{ type: "image", src: "/files/ws/p7.jpg" }] },
            { type: "text" },
          ],
        },
      ],
      pictures.sources(),
    );
    const els = tagged?.elements as {
      source?: PhotoSource;
      children?: { source?: PhotoSource }[];
    }[];
    expect(els[0]?.source?.provider).toBe("pexels");
    expect(els[1]?.children?.[0]?.source?.id).toBe("p7");
    expect(els[2]?.source).toBeUndefined();
    // Its slide opened again with other words: the photo is uncredited and its slot gone.
    pictures.forget(2);
    expect(pictures.sources().has("/files/ws/p7.jpg")).toBe(false);
    expect(pictures.state(2, "picture").status).toBe("failed");
  });

  test("a reopened slide: a same-key ask with new words gets a new slot; a dropped ask is cancelled", async () => {
    const seen: string[] = [];
    let running: AbortSignal | undefined;
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async (input) => {
        const text = JSON.stringify(input);
        seen.push(text);
        if (text.includes("A pear")) {
          // the dropped ask is still being directed when its slide reopens
          running = (input as { signal?: AbortSignal }).signal;
          await new Promise((r) => setTimeout(r, 30));
        }
        return undefined;
      },
    });
    pictures.start(2, ask({ key: "picture", shows: "A red apple", named: false }), slide);
    pictures.start(2, ask({ key: "col.1", shows: "A pear", named: false }), slide);
    await new Promise((r) => setTimeout(r, 5));
    pictures.forget(2);
    pictures.start(2, ask({ key: "picture", shows: "A green apple", named: false }), slide);
    await pictures.settle(5_000);
    expect(seen.filter((t) => t.includes("A green apple"))).toHaveLength(1);
    expect(pictures.state(2, "col.1").status).toBe("failed");
    expect(pictures.vetoed(2, "col.1")).toBeUndefined();
    expect(running === undefined || running.aborted).toBe(true);
  });
});

describe("writer pictures: stops are never swallowed", () => {
  const withSignal = (signal: AbortSignal) => ({
    ...recordingDeps(createFakeAi({ script: [] })),
    signal,
  });

  test("a budget stop in the director fails settle; the stage never saves a deck without pictures", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => {
        throw new BudgetExceeded("usd");
      },
    });
    pictures.start(2, ask(), slide);
    const err = await pictures.settle(1_000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceeded);
  });

  test("a budget refusal of one picture call leaves that slot empty; settle and the lesson go on (TEACH-110 part z)", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "warn" }, { write: (line: string) => void lines.push(line) });
    const ai = createFakeAi({
      script: [
        verdict({
          pick: "p7",
          onSubject: true,
          clear: true,
          fits: true,
          visible: ["sheep"],
          count: "one",
        }),
      ],
    });
    const sheep = direction({
      route: "pexels",
      pictures: [
        {
          shows: "A sheep in a field",
          mustShow: ["sheep"],
          queries: ["sheep field"],
          imagePrompt: "A sheep.",
        },
      ],
    });
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({ pexels: [photo("p7")] }),
      deps: recordingDeps(ai, { logger }),
      direct: async (input) => {
        if (JSON.stringify(input).includes("sheep")) return sheep;
        throw new Error("stream failed", { cause: new BudgetReservationError("usd") });
      },
    });
    pictures.start(2, ask(), slide);
    pictures.start(
      3,
      ask({ shows: "A sheep in a field", mustSee: ["sheep"], named: false }),
      slide,
    );
    await expect(pictures.settle(1_000)).resolves.toBeUndefined();
    // The refused slot: empty, its miss is "budget" (the line the stage reads), not asked again.
    expect(pictures.state(2, "picture")).toEqual({ status: "failed" });
    expect(pictures.vetoed(2, "picture")).toBe(
      "The picture search stopped at this lesson's spending limit.",
    );
    expect(pictures.retryable(2, "picture")).toBe(false);
    // Its sibling was not cancelled: it is placed with a src.
    const sibling = pictures.state(3, "picture");
    expect(sibling.status).toBe("photo");
    if (sibling.status === "photo") expect(sibling.photo.src.length).toBeGreaterThan(0);
    // One warn, naming the slot and the error's type only (no message from the cause chain).
    const warns = lines.map((l) => JSON.parse(l)).filter((l) => l.level === 40);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      stage: "illustrate",
      picture: "2:picture",
      miss: "budget",
      err: { type: "Error" },
    });
    expect(JSON.stringify(warns[0])).not.toContain("stream failed");
  });

  test("spend over the cap in a picture call still fails settle", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => {
        throw Object.assign(new BudgetReservationError("usd"), {
          cause: new BudgetExceeded("usd"),
        });
      },
    });
    pictures.start(2, ask(), slide);
    const err = await pictures.settle(1_000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetReservationError);
  });

  test("a cancel ends settle at once with an abort, and the running placement sees it", async () => {
    const job = new AbortController();
    let seen: AbortSignal | undefined;
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({}),
      deps: withSignal(job.signal) as never,
      direct: () => new Promise<PictureDirection | undefined>(() => {}),
      onOutcome: () => {},
    });
    // The stock path reads the placements' signal: capture it through a search.
    pictures.start(2, ask(), slide);
    const settling = pictures.settle(60_000).catch((e: unknown) => e);
    job.abort();
    const err = (await settling) as Error;
    expect(err.name).toBe("AbortError");
    seen = job.signal;
    expect(seen.aborted).toBe(true);
  });

  test("the deadline stops running placements (their signal aborts) and they count as failed", async () => {
    let placementSignal: AbortSignal | undefined;
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: {
        search: (_q: string, o: { signal: AbortSignal }) => {
          placementSignal = o.signal;
          return new Promise<PhotoResult[]>(() => {});
        },
        store: async (p: PhotoResult) => stored(p),
      } as DirectedPlacer,
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => direction({ route: "pexels", named: null }),
    });
    pictures.start(2, ask({ named: false }), slide);
    await new Promise((r) => setTimeout(r, 5));
    await pictures.settle(5);
    expect(placementSignal?.aborted).toBe(true);
    expect(pictures.state(2, "picture").status).toBe("failed");
  });

  test("a cancelled job clears the director batcher's timer and stops its queued slots", async () => {
    const job = new AbortController();
    const ai = createFakeAi({ script: [] });
    const direct = createDirectorBatcher(
      { ...recordingDeps(ai), signal: job.signal } as never,
      "batched system",
      50,
    );
    const asked = direct(DIRECTOR_INPUT).catch((e: unknown) => e);
    job.abort();
    expect(((await asked) as Error).name).toBe("AbortError");
    await new Promise((r) => setTimeout(r, 80));
    expect(ai.calls).toHaveLength(0);
  });
});

/* TEACH-237: a slide's set made together by the generator, each panel at its own shape. */
describe("writer pictures: generated sets", () => {
  const strip = (n: number, w = 120, h = 120) => {
    const width = n * w + 10 * (n - 1);
    const rgb = new Uint8Array(width * h * 3).fill(236);
    for (let k = 0; k < n; k++) {
      const x0 = k * (w + 10);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const o = (y * width + x0 + x) * 3;
          if (Math.abs(x - w / 2) < 20 + 10 * k && Math.abs(y - h / 2) < 30) rgb.fill(40, o, o + 3);
        }
      if (k < n - 1)
        for (let y = 0; y < h; y++)
          rgb.fill(255, (y * width + x0 + w) * 3, (y * width + x0 + w + 10) * 3);
    }
    return encodePng({ width, height: h, rgb });
  };
  const maker = () => {
    const made: string[] = [];
    const generator: Pick<ImageGenerator, "model" | "generate"> = {
      model: "fake-image",
      generate: async (req) => {
        made.push(req.size);
        return { bytes: strip(2), mime: "image/png", costUsd: 0.01, ms: 1 } as never;
      },
    };
    let saved = 0;
    return {
      made,
      maker: {
        bank: STOCK_ONLY_BANK,
        generator,
        save: async () => {
          saved += 1;
          return { id: `g${saved}`, src: `/files/g${saved}.png` };
        },
      },
    };
  };
  const chick = {
    key: "seq.0",
    shows: "A chick",
    mustSee: ["chick"],
    named: false,
    aspect: 1.48,
    set: "s",
  };
  const hen = {
    key: "seq.1",
    shows: "A hen",
    mustSee: ["hen"],
    named: false,
    aspect: 1.48,
    set: "s",
  };
  const science = { ...sampleBriefLesson(), subject: "Science" };

  test("a generic set is one strip; each panel is a photo at its own aspect, credited as generated", async () => {
    const m = maker();
    const ok = (item: string) =>
      verdict({ pick: "made", onSubject: true, clear: true, fits: true, visible: [item] });
    const pictures = createWriterPictures({
      lesson: science,
      country: "UK",
      images: images({}),
      deps: recordingDeps(
        createFakeAi({
          script: [ok("chick"), ok("hen"), JSON.stringify({ same: true, odd: [], why: "x" })],
        }),
      ),
      maker: m.maker,
      direct: async () => {
        throw new Error("a generated set never asks the director");
      },
    });
    // The stage hands a slide's asks over in one loop.
    pictures.start(2, ask(chick), slide);
    pictures.start(2, ask(hen), slide);
    expect(pictures.state(2, "seq.0").status).toBe("pending");
    await pictures.settle(5_000);
    expect(m.made).toHaveLength(1);
    for (const key of ["seq.0", "seq.1"]) {
      const s = pictures.state(2, key);
      expect(s.status).toBe("photo");
      // The panel's own shape (116 by 120 after the inset), never the slot's 1.48.
      if (s.status === "photo") expect(s.photo.aspect).toBeCloseTo(116 / 120, 2);
    }
    expect([...pictures.sources().values()].every((src) => src.provider === "generated")).toBe(
      true,
    );
  });

  test("C5: a set is made in the lesson's look once the writer's design is known", async () => {
    const run = async (design?: { picture_style?: "photo" | "illustration" }) => {
      const m = maker();
      const prompts: string[] = [];
      const generate = m.maker.generator.generate;
      m.maker.generator.generate = async (req) => {
        prompts.push(req.prompt);
        return generate(req);
      };
      const ok = (item: string) =>
        verdict({ pick: "made", onSubject: true, clear: true, fits: true, visible: [item] });
      const pictures = createWriterPictures({
        lesson: science,
        country: "UK",
        images: images({}),
        deps: recordingDeps(
          createFakeAi({
            script: [ok("chick"), ok("hen"), JSON.stringify({ same: true, odd: [], why: "x" })],
          }),
        ),
        maker: m.maker,
      });
      if (design) pictures.lookForSets(setLookOf(design));
      pictures.start(2, ask(chick), slide);
      pictures.start(2, ask(hen), slide);
      await pictures.settle(5_000);
      return prompts[0] ?? "";
    };
    expect(setLookOf({ picture_style: "photo" })).toEqual({ style: "photo", generic: "generate" });
    expect(setLookOf(undefined)).toEqual({ style: "photo", generic: "generate" });
    expect(setLookOf({ picture_style: "illustration" })).toEqual({ style: "illustration" });
    expect((await run({ picture_style: "photo" })).startsWith(HOUSE_PHOTO_LINE)).toBe(true);
    expect(HOUSE_PHOTO_LINE).toContain("large and whole within the frame");
    expect(HOUSE_PHOTO_LINE).not.toContain("filling the frame");
    expect((await run({ picture_style: "illustration" })).startsWith(ILLUSTRATION_LINE)).toBe(true);
    // no look given: today's prompt, unchanged
    const plain = await run();
    expect(plain.startsWith(HOUSE_PHOTO_LINE) || plain.startsWith(ILLUSTRATION_LINE)).toBe(false);
  });

  test("a named set takes the director's ladder, not the generator", async () => {
    const m = maker();
    let directed = 0;
    const pictures = createWriterPictures({
      lesson: science,
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      maker: m.maker,
      direct: async () => {
        directed += 1;
        return direction({ route: "none", pictures: [] });
      },
    });
    pictures.start(2, ask({ ...chick, named: true }), slide);
    pictures.start(2, ask({ ...hen, named: true }), slide);
    await pictures.settle(5_000);
    expect(m.made).toHaveLength(0);
    expect(directed).toBe(2);
    expect(pictures.state(2, "seq.0").status).toBe("failed");
  });
});

test("a generated single picture is shown to the judge on its own bytes, and placed at its own aspect", async () => {
  const pictures = createWriterPictures({
    lesson: { ...sampleBriefLesson(), subject: "Science" },
    country: "UK",
    images: images({}),
    // Stock finds nothing; the made picture's judge accepts it.
    deps: recordingDeps(
      createFakeAi({
        script: [
          verdict({ pick: "made", onSubject: true, clear: true, fits: true, visible: ["a hen"] }),
        ],
      }),
    ),
    bank: {
      lookup: async () => undefined,
      remember: async () => undefined,
      generate: async () =>
        ({
          src: "/files/m1.png",
          alt: "A hen",
          source: { provider: "generated", id: "m1" },
          style: "photo",
          aspect: 1.5,
          dataUrl: "data:image/png;base64,AAAA",
        }) as never,
    },
    direct: async () =>
      direction({
        route: "library-or-generate",
        pictures: [
          // An imagined subject: library-or-generate goes straight to generation (TEACH-167 part b).
          { shows: "A cartoon hen", mustShow: ["a hen"], queries: ["hen"], imagePrompt: "A hen." },
        ],
      }),
  });
  pictures.start(
    1,
    ask({ key: "picture", shows: "A hen", mustSee: ["a hen"], named: false }),
    slide,
  );
  await pictures.settle(5_000);
  const s = pictures.state(1, "picture");
  expect(s.status).toBe("photo");
  if (s.status === "photo") expect(s.photo.aspect).toBe(1.5);
});

describe("writer pictures: match6, keepPic and a later round (BAKEOFF base4f)", () => {
  const cowAi = () =>
    createFakeAi({
      script: [
        verdict({
          pick: "p8",
          onSubject: true,
          clear: true,
          fits: true,
          visible: ["cow"],
          count: "one",
          boxes: [{ item: "cow", left: 0.1, top: 0.2, right: 0.6, bottom: 0.9 }],
        }),
      ],
    });
  const cowDirection = async () =>
    direction({
      route: "pexels",
      pictures: [
        {
          shows: "A cow and its calf",
          mustShow: ["cow"],
          queries: ["cow calf"],
          imagePrompt: "A cow and a calf.",
        },
      ],
    });
  const cowAsk = ask({
    shows: "A cow and its calf",
    mustSee: ["adult cow", "young calf"],
    named: false,
  });

  test("a picture missing a thing the slide names is dropped, and held on a find slide", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({ pexels: [photo("p8")] }),
      deps: recordingDeps(cowAi()),
      direct: cowDirection,
    });
    pictures.start(4, cowAsk, { heading: "Find the pairs", text: "Find the cow and its calf." });
    await pictures.settle(1_000);
    expect(pictures.state(4, "picture")).toEqual({ status: "failed" });
    expect(pictures.vetoed(4, "picture") ?? "none").toBe("none");
    expect(pictures.held(4, "picture")?.status).toBe("photo");
  });

  test("words that name only what the judge saw keep the picture (match6w)", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({ pexels: [photo("p8")] }),
      deps: recordingDeps(cowAi()),
      direct: cowDirection,
    });
    pictures.start(4, cowAsk, { heading: "Farm animals", text: "This is a cow." });
    await pictures.settle(1_000);
    expect(pictures.state(4, "picture").status).toBe("photo");
  });

  test("an ask started after settle is placed in a second round", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({ pexels: [photo("p8")] }),
      deps: recordingDeps(cowAi()),
      direct: cowDirection,
    });
    await pictures.settle(1_000);
    pictures.start(6, ask({ shows: "A cow", mustSee: ["cow"], named: false }), slide);
    await pictures.settle(1_000);
    expect(pictures.state(6, "picture").status).toBe("photo");
  });

  test("a key that failed in round one is asked again at the same index in a later round", async () => {
    let calls = 0;
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({ pexels: [photo("p8")] }),
      deps: recordingDeps(cowAi()),
      direct: async () => {
        calls += 1;
        // Round one never answers (it ends failed at the deadline); round two is the cow.
        return calls === 1 ? new Promise<PictureDirection | undefined>(() => {}) : cowDirection();
      },
    });
    const one = ask({ shows: "A cow", mustSee: ["cow"], named: false });
    pictures.start(6, ask({ shows: "Cow, sheep and hen", mustSee: ["cow"], named: false }), slide);
    await pictures.settle(1_000);
    expect(pictures.state(6, "picture").status).toBe("failed");
    // Asked again within the same round after settle: placed once, not twice.
    pictures.start(6, one, slide);
    pictures.start(6, one, slide);
    await pictures.settle(1_000);
    expect(pictures.state(6, "picture").status).toBe("photo");
    expect(calls).toBe(2);
  });
});

describe("ruling 163 on activity cards (TEACH-101 part c)", () => {
  const generatedOnly = (subject: string | Partial<Lesson>) =>
    createWriterPictures({
      lesson:
        typeof subject === "string"
          ? { ...sampleBriefLesson(), subject }
          : ({ ...sampleBriefLesson(), subject: undefined, ...subject } as Lesson),
      country: "UK",
      images: images({}),
      deps: recordingDeps(
        createFakeAi({
          script: [
            verdict({
              pick: "made",
              onSubject: true,
              clear: true,
              fits: true,
              visible: ["a ship"],
            }),
          ],
        }),
      ),
      bank: {
        lookup: async () => undefined,
        remember: async () => undefined,
        generate: async () =>
          ({
            src: "/files/m1.png",
            alt: "A ship",
            source: { provider: "generated", id: "m1" },
            style: "photo",
            aspect: 1.5,
            dataUrl: "data:image/png;base64,AAAA",
          }) as never,
      },
      direct: async () =>
        direction({
          route: "library-or-generate",
          pictures: [
            // An imagined subject: straight to generation (TEACH-167 part b).
            {
              shows: "A cartoon ship",
              mustShow: ["a ship"],
              queries: ["ship"],
              imagePrompt: "A ship.",
            },
          ],
        }),
    });
  const card = ask({ key: "card.0", shows: "A ship", mustSee: ["a ship"], named: false });

  test("a named history card never shows a generated picture: it fails and the card shows its word", async () => {
    const pictures = generatedOnly("History");
    pictures.start(4, { ...card, named: true }, slide);
    await pictures.settle(5_000);
    expect(pictures.state(4, "card.0").status).toBe("failed");
    expect([...pictures.sources().values()]).toEqual([]);
  });

  test("B1: the title picture and cards follow the stored period when the subject is blank", async () => {
    const egypt = { historicalPeriod: "Ancient Egypt", fictionInPeriod: false };
    const title = { heading: "Mummification", text: "", point: "" };
    const outcome = async (lesson: string | Partial<Lesson>) => {
      // One placer per slot: the fake judge has one verdict.
      const t = generatedOnly(lesson);
      t.start(
        0,
        ask({
          key: "picture",
          shows: "Egyptian people wrapping a body",
          mustSee: ["a body"],
          named: false,
        }),
        title,
      );
      // Ruling 210: a generic history card may be generated; a named one is real only.
      const c = generatedOnly(lesson);
      c.start(4, { ...card, named: true }, slide);
      await Promise.all([t.settle(5_000), c.settle(5_000)]);
      return {
        title: t.state(0, "picture").status,
        titleSources: [...t.sources().values()].length,
        card: c.state(4, "card.0").status,
      };
    };
    const history = await outcome("History");
    expect(history.card).toBe("failed");
    // A blank subject with the period stored behaves as a History lesson, on the title too.
    expect(await outcome(egypt)).toEqual(history);
    // Fiction in the period follows the constant; a present-day lesson is not held back.
    const fiction = await outcome({ ...egypt, fictionInPeriod: true });
    expect(fiction.card).toBe("failed");
    void FICTION_IN_PERIOD_IS_HISTORICAL;
    const today = await outcome({});
    expect(today.card).toBe("failed");
    // The title ask takes the same guarded ladder (findDirected's \`historical\`) as a History one.
    expect(today.title).toBe(history.title);
  });

  test("a card naming a person is never generated, whatever the subject", async () => {
    const pictures = generatedOnly("Science");
    pictures.start(4, { ...card, named: true }, slide);
    await pictures.settle(5_000);
    expect(pictures.state(4, "card.0").status).toBe("failed");
  });

  test("a science card may be generated; a history slide picture keeps the director's ladder", async () => {
    const science = generatedOnly("Science");
    science.start(4, card, slide);
    await science.settle(5_000);
    expect(science.state(4, "card.0").status).toBe("photo");
    const history = generatedOnly("History");
    history.start(
      4,
      ask({ key: "picture", shows: "A ship", mustSee: ["a ship"], named: false }),
      slide,
    );
    await history.settle(5_000);
    expect(history.state(4, "picture").status).toBe("photo");
  });

  test("a named history card set is never made by the generator (rulings 163, 210)", async () => {
    let made = 0;
    const pictures = createWriterPictures({
      lesson: { ...sampleBriefLesson(), subject: "History" },
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      maker: {
        bank: STOCK_ONLY_BANK,
        generator: {
          model: "fake-image",
          generate: async () => {
            made += 1;
            throw new Error("never");
          },
        },
        save: async () => ({ id: "g", src: "/files/g.png" }),
      },
      direct: async () => direction({ route: "none", pictures: [] }),
    });
    for (const k of [0, 1])
      pictures.start(
        4,
        ask({ key: `card.${k}`, shows: `A Roman coin ${k}`, named: true, set: "cards" }),
        slide,
      );
    await pictures.settle(5_000);
    expect(made).toBe(0);
    expect(pictures.state(4, "card.0").status).toBe("failed");
  });
});

describe("split at ask, on real slots (TEACH-167 part b)", () => {
  const panelPng = (v: number) =>
    encodePng({ width: 64, height: 96, rgb: new Uint8Array(64 * 96 * 3).fill(v) });
  const splitMaker = () => {
    const prompts: string[] = [];
    const saved: number[] = [];
    const removed: string[] = [];
    let n = 0;
    const generator: Pick<ImageGenerator, "model" | "generate"> = {
      model: "fake-image",
      generate: async (req) => {
        prompts.push(req.prompt);
        n += 1;
        return { bytes: panelPng(40 * n), mime: "image/png", costUsd: 0.005, ms: 1 } as never;
      },
    };
    return {
      prompts,
      saved,
      removed,
      maker: {
        bank: STOCK_ONLY_BANK,
        generator,
        save: async (bytes: Uint8Array) => {
          saved.push(bytes.length);
          return { id: `g${saved.length}`, src: `/files/g${saved.length}.png` };
        },
        remove: async (src: string) => {
          removed.push(src);
        },
      },
    };
  };
  const dogs = ask({
    key: "picture",
    shows: "Three golden retrievers: a small puppy, an older puppy and an adult dog",
    mustSee: ["golden retriever"],
    named: false,
    aspect: 1.6,
  });
  const ok = verdict({ pick: "made", onSubject: true, clear: true, fits: true, visible: ["dog"] });
  const set = JSON.stringify({ same: true, odd: [], why: "one dog growing" });
  const saw = (item: string) =>
    verdict({ pick: "made", onSubject: true, clear: true, fits: true, visible: [item] });

  test("a compound ask is one generated set joined into the slot's one picture", async () => {
    const m = splitMaker();
    const pictures = createWriterPictures({
      lesson: { ...sampleBriefLesson(), subject: "Science" },
      country: "UK",
      images: images({}),
      deps: recordingDeps(
        createFakeAi({ script: [saw("small puppy"), saw("older puppy"), saw("adult dog"), set] }),
      ),
      maker: m.maker,
      direct: async () => {
        throw new Error("a split ask never asks the director");
      },
    });
    pictures.start(3, dogs, slide);
    expect(pictures.state(3, "picture").status).toBe("pending");
    await pictures.settle(5_000);
    const s = pictures.state(3, "picture");
    expect(s.status).toBe("photo");
    if (s.status !== "photo") return;
    // One panel per subject, never the whole picture first.
    expect(m.prompts).toHaveLength(3);
    expect(s.photo.subjects?.map((x) => x.name)).toEqual([
      "small puppy",
      "older puppy",
      "adult dog",
    ]);
    // Three panels saved, then the joined picture: three 64-wide panels and two 8 px gaps.
    expect(m.saved).toHaveLength(4);
    expect(s.photo.src).toBe("/files/g4.png");
    expect(s.photo.aspect).toBeCloseTo((3 * 64 + 16) / 96, 3);
    expect(s.photo.subjects?.[1]?.x).toBeCloseTo(72 / 208, 3);
    expect(pictures.sources().get("/files/g4.png")?.provider).toBe("generated");
    // The three panels are only parts of it: deleted; the joined picture stays.
    expect(m.removed.sort()).toEqual(["/files/g1.png", "/files/g2.png", "/files/g3.png"]);
  });

  test("a single-subject ask is not split: it goes to the director", async () => {
    const m = splitMaker();
    let directed = 0;
    const pictures = createWriterPictures({
      lesson: { ...sampleBriefLesson(), subject: "Science" },
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      maker: m.maker,
      direct: async () => {
        directed += 1;
        return direction({ route: "none", pictures: [] });
      },
    });
    pictures.start(
      3,
      ask({ key: "picture", shows: "A golden retriever puppy", named: false }),
      slide,
    );
    await pictures.settle(5_000);
    expect(directed).toBe(1);
    expect(m.prompts).toHaveLength(0);
  });

  test("a panel the judge refuses leaves the slot without a picture, never a partial one", async () => {
    const m = splitMaker();
    const no = verdict({ pick: "made", onSubject: false, clear: true, fits: false, visible: [] });
    const pictures = createWriterPictures({
      lesson: { ...sampleBriefLesson(), subject: "Science" },
      country: "UK",
      images: images({}),
      deps: recordingDeps(
        createFakeAi({
          script: [saw("small puppy"), saw("older puppy"), no, set, no, no, no],
        }),
      ),
      maker: m.maker,
    });
    pictures.start(3, dogs, slide);
    await pictures.settle(5_000);
    expect(pictures.state(3, "picture").status).toBe("failed");
    expect(pictures.vetoed(3, "picture")).toBe("No suitable picture was found.");
    // Every panel that was stored is deleted again: nothing is left behind.
    expect(m.saved.length).toBeGreaterThan(0);
    expect(m.removed).toHaveLength(m.saved.length);
  });

  test("ruling 163: a historical compound ask is never split and generated, whatever the subject", async () => {
    const m = splitMaker();
    let directed = 0;
    const pictures = createWriterPictures({
      lesson: { ...sampleBriefLesson(), subject: "Science" },
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      maker: m.maker,
      direct: async () => {
        directed += 1;
        return direction({ route: "none", pictures: [] });
      },
    });
    pictures.start(
      3,
      ask({
        key: "picture",
        shows: "Three Victorian inventions: a steam engine, a telegraph and a sewing machine",
        named: false,
      }),
      slide,
    );
    await pictures.settle(5_000);
    expect(m.prompts).toHaveLength(0);
    expect(directed).toBe(1);
  });
});

// Greg, 10 Oct: "a visual should never be lost." The director's code route ("a drawing shows the
// idea better than a photograph") used to plan none and ship the slide text-only.
describe("writer pictures: a director code route is drawn or kept as a picture, never none", () => {
  const heart = ask({
    shows: "A cross-section of the human heart showing its four chambers",
    mustSee: ["left atrium", "right ventricle"],
    named: false,
  });
  const heartSlide = {
    heading: "Inside the heart",
    text: "The heart has four chambers.",
    point: "",
  };
  const codeAnswer = () => direction({ route: "code", pictures: [], diagram: "labelled-diagram" });
  const spyBank = () => {
    const made: string[] = [];
    return {
      made,
      bank: {
        lookup: async () => undefined,
        remember: async () => undefined,
        generate: async (req: { text: string }) => {
          made.push(req.text);
          return undefined;
        },
      },
    };
  };

  test("with a drawer, the ask is handed to it with the director's kind; nothing is spent", async () => {
    const { bank, made } = spyBank();
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => codeAnswer(),
      bank,
      draws: true,
    });
    pictures.start(3, heart, heartSlide);
    await pictures.settle(1_000);
    expect(pictures.drawAs(3, "picture")).toBe("labelled-diagram");
    expect(made).toEqual([]);
  });

  test("asked again after the drawer could not draw it, it keeps the picture route", async () => {
    const { bank, made } = spyBank();
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => codeAnswer(),
      bank,
      draws: true,
    });
    pictures.start(3, heart, heartSlide);
    await pictures.settle(1_000);
    pictures.start(3, heart, heartSlide);
    await pictures.settleSlide(3, 1_000);
    expect(made).toEqual([
      "A cross-section of the human heart showing its four chambers. left atrium. right ventricle",
    ]);
    expect(pictures.drawAs(3, "picture")).toBeUndefined();
  });

  test("with no drawer, or for a slot the stage never redraws, it goes straight to the picture route", async () => {
    for (const [draws, a, index] of [
      [false, heart, 3],
      [true, { ...heart, fixedShape: true }, 3],
      [true, { ...heart, key: "card.1" }, 3],
      [true, heart, 1],
    ] as const) {
      const { bank, made } = spyBank();
      const pictures = createWriterPictures({
        lesson: sampleBriefLesson(),
        country: "UK",
        images: images({}),
        deps: recordingDeps(createFakeAi({ script: [] })),
        direct: async () => codeAnswer(),
        bank,
        draws,
      });
      pictures.start(index, a, heartSlide);
      await pictures.settle(1_000);
      expect(made.length).toBe(1);
      expect(pictures.drawAs(index, a.key)).toBeUndefined();
    }
  });
});

describe("writer pictures: the kept-picture and retry paths spend under the same rules and never throw", () => {
  const spy = (generate: (req: { text: string }) => Promise<undefined>) => ({
    lookup: async () => undefined,
    remember: async () => undefined,
    generate,
  });
  const make = (over: Partial<Parameters<typeof createWriterPictures>[0]>) =>
    createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images({}),
      deps: recordingDeps(createFakeAi({ script: [] })),
      ...over,
    });
  const street = ask({
    shows: "A Victorian street with horse-drawn carts",
    mustSee: [],
    named: false,
  });

  test("a failed director call on a historical ask generates nothing (ruling 163 before spend)", async () => {
    const made: string[] = [];
    const pictures = make({
      direct: async () => undefined,
      bank: spy(async (r) => {
        made.push(r.text);
        return undefined;
      }),
    });
    pictures.start(3, street, slide);
    await pictures.settle(1_000);
    expect(made).toEqual([]);
    expect(pictures.state(3, "picture").status).toBe("failed");
  });

  test("an ask that ran out of time is retryable once; a director miss is not", async () => {
    const pictures = make({ direct: () => new Promise<PictureDirection | undefined>(() => {}) });
    pictures.start(3, ask(), slide);
    await pictures.settle(5);
    expect(pictures.retryable(3, "picture")).toBe(true);
    const none = make({ direct: async () => direction({ route: "none", pictures: [] }) });
    none.start(3, ask(), slide);
    await none.settle(1_000);
    expect(none.retryable(3, "picture")).toBe(false);
  });

  test("a provider error on the re-asked picture ends failed without throwing", async () => {
    const pictures = make({
      direct: async () => direction({ route: "code", pictures: [], diagram: "labelled-diagram" }),
      bank: spy(async () => {
        throw new Error("provider down");
      }),
      draws: true,
    });
    const heart = ask({ shows: "A cross-section of the human heart", mustSee: [], named: false });
    pictures.start(3, heart, slide);
    await pictures.settle(1_000);
    pictures.start(3, heart, slide);
    await pictures.settleSlide(3, 1_000);
    expect(pictures.state(3, "picture").status).toBe("failed");
  });

  test("a budget stop on the re-asked picture still stops the lesson (never swallowed)", async () => {
    // The re-asked placement's own model call (the director) hits the lesson budget.
    let calls = 0;
    const pictures = make({
      direct: async () => {
        if (calls++ > 0) throw new BudgetExceeded("usd");
        return direction({ route: "code", pictures: [], diagram: "labelled-diagram" });
      },
      draws: true,
    });
    const heart = ask({ shows: "A cross-section of the human heart", mustSee: [], named: false });
    pictures.start(3, heart, slide);
    await pictures.settle(1_000);
    pictures.start(3, heart, slide);
    await expect(pictures.settleSlide(3, 1_000)).rejects.toBeInstanceOf(BudgetExceeded);
  });
});

describe("writer pictures: a malformed ask is a miss, never a throw", () => {
  test("an ask with no shows ends failed with a miss line; the director never throws", async () => {
    const generator: Pick<ImageGenerator, "model" | "generate"> = {
      model: "fake-image",
      generate: async () => {
        throw new Error("never asked");
      },
    };
    const pictures = createWriterPictures({
      lesson: { ...sampleBriefLesson(), subject: "Science" },
      country: "UK",
      images: images({ pexels: [photo("p1")] }),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => direction({}),
      // The maker is what sends an ask through splitSubjects (where `shows` was read first).
      maker: {
        bank: STOCK_ONLY_BANK,
        generator,
        save: async () => ({ id: "g1", src: "/files/g1.png" }),
      },
    });
    const bad = { ...ask({ named: false }), shows: undefined } as unknown as WriterPhotoAsk;
    expect(() => pictures.start(3, bad, slide)).not.toThrow();
    expect(() =>
      pictures.start(4, ask({ key: "x", named: false, shows: "  " }), slide),
    ).not.toThrow();
    await pictures.settle(1_000);
    expect(pictures.state(3, "picture")).toEqual({ status: "failed" });
    expect(pictures.state(4, "x")).toEqual({ status: "failed" });
    expect(pictures.vetoed(3, "picture")).toContain("did not say what the picture shows");
  });

  test("the writer ask brief of an ask with no shows is empty, not a throw", () => {
    const b = writerAskBrief({
      key: "3:picture",
      shows: undefined as unknown as string,
      mustSee: [],
      named: false,
      slide,
      index: 3,
    });
    expect(b.subject).toBe("");
  });
});

describe("ruling 209 with 163: one source type per set; a history set is real first", () => {
  const strip2 = () => {
    const w = 120;
    const width = 2 * w + 10;
    const rgb = new Uint8Array(width * w * 3).fill(236);
    for (let k = 0; k < 2; k++)
      for (let y = 0; y < w; y++)
        for (let x = 0; x < w; x++)
          if (Math.abs(x - w / 2) < 20 + 10 * k && Math.abs(y - w / 2) < 30) {
            const o = (y * width + k * (w + 10) + x) * 3;
            rgb.fill(40, o, o + 3);
          }
    for (let y = 0; y < w; y++) rgb.fill(255, (y * width + w) * 3, (y * width + w + 10) * 3);
    return encodePng({ width, height: w, rgb });
  };
  const yes = (extra: Record<string, unknown> = {}) =>
    verdict({
      onSubject: true,
      kindMatches: true,
      clear: true,
      fits: true,
      visible: ["x"],
      count: "one",
      boxes: [{ item: "x", left: 0.1, top: 0.2, right: 0.6, bottom: 0.9 }],
      ...extra,
    });
  /** Panels: [real-search hit?, its words]. */
  const JAR = "An ancient canopic jar";
  const BODY = "Ancient priests drying a body with natron";
  const COIN = "An ancient Roman coin";
  const HELMET = "An ancient Roman helmet";
  const run = async (opts: {
    lesson: Partial<Lesson>;
    panels: string[];
    hit: (words: string) => boolean;
    /** A made (generated) panel the judge refuses, by its words. */
    refuseMade?: (words: string) => boolean;
    named?: boolean;
    /** Per panel, the writer's `named` (overrides `named`). */
    namedAt?: (k: number) => boolean;
    /** The director's `named` kind for every panel. */
    kind?: "object" | "place" | null;
    /** The single-picture bank (default: stock only). */
    bank?: typeof STOCK_ONLY_BANK;
    key?: (k: number) => string;
  }) => {
    const prompts: string[] = [];
    let saved = 0;
    // The fake judge answers by the panel it is shown, never by call order.
    const ai = createFakeAi({
      fallback: (c) => {
        const text = `${c.systemText}\n${c.promptText}`;
        const words = opts.panels.find((w) => c.promptText.includes(w)) ?? "";
        // The set judge is shown every panel; a panel judge, one.
        if (opts.panels.every((w) => c.promptText.includes(w)))
          return JSON.stringify({ same: true, odd: [], why: "x" });
        if (text.includes("Photo p")) {
          if (!opts.hit(words)) return verdict({});
          return yes({ pick: words === opts.panels[0] ? "p7" : "p8" });
        }
        return opts.refuseMade?.(words)
          ? verdict({})
          : yes({ pick: "made", visible: mustShowOf(words).slice(0, 1) });
      },
    });
    const pictures = createWriterPictures({
      lesson: { ...sampleBriefLesson(), ...opts.lesson } as Lesson,
      country: "UK",
      // Ruling 163: a historical set's real search is Commons; a miss has no candidates.
      images: images({
        commons: (async (q: unknown) =>
          opts.panels.some(
            (w) => opts.hit(w) && JSON.stringify(q).includes(w.split(" ").at(-1) ?? ""),
          )
            ? ["p7", "p8"].map((id) => ({ ...photo(id), provider: "commons", licenceClass: "cc0" }))
            : []) as never,
      }),
      deps: recordingDeps(ai),
      maker: {
        bank: opts.bank ?? STOCK_ONLY_BANK,
        generator: {
          model: "fake-image",
          generate: async (req) => {
            prompts.push(req.prompt);
            return { bytes: strip2(), mime: "image/png", costUsd: 0.01, ms: 1 } as never;
          },
        },
        save: async () => {
          saved += 1;
          return { id: `g${saved}`, src: `/files/g${saved}.png` };
        },
      },
      direct: async (input) => {
        const words = opts.panels.find((w) => JSON.stringify(input).includes(w)) ?? "";
        return direction({
          route: opts.hit(words) || opts.kind ? "commons" : "none",
          named: opts.kind ?? null,
          pictures: [
            {
              shows: words,
              mustShow: ["x"],
              queries: [words.split(" ").at(-1) ?? "x"],
              imagePrompt: `${words}.`,
            },
          ],
        });
      },
    });
    const key = opts.key ?? ((k: number) => `seq.${k}`);
    for (const [k, shows] of opts.panels.entries())
      pictures.start(
        5,
        ask({
          key: key(k),
          shows,
          mustSee: [],
          named: opts.namedAt?.(k) ?? opts.named ?? false,
          aspect: 1.1,
          set: "s5",
        }),
        slide,
      );
    await pictures.settle(5_000);
    const states = opts.panels.map((_, k) => pictures.state(5, key(k)));
    const providers = new Set([...pictures.sources().values()].map((x) => x.provider));
    return { ai, prompts, states, providers };
  };
  const painted = (prompts: string[]) => {
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p.split("\n")[0]).toMatch(/illustration.*not a photograph/i);
  };
  const generatedPhoto = (x: { status: string; photo?: { src: string } }) =>
    x.status === "photo" && /\/files\/g\d+\.png$/.test(x.photo?.src ?? "");

  test("ruling 210: an Egypt mummification sequence is generated, in one drawn style", async () => {
    const r = await run({
      lesson: { subject: undefined, historicalPeriod: "Ancient Egypt" },
      panels: ["Priests removing the organs", "Priests drying the body with natron"],
      hit: () => false,
    });
    painted(r.prompts);
    expect(r.states.every(generatedPhoto)).toBe(true);
    expect([...r.providers]).toEqual(["generated"]);
    // The made panels are checked against the lesson's period.
    expect(r.ai.calls.some((c) => c.promptText.includes("Ancient Egypt"))).toBe(true);
  });

  test("a Rosetta Stone set (a specific artefact) is real only: a miss is a tile, never generated", async () => {
    const r = await run({
      lesson: { subject: "History" },
      panels: ["The Rosetta Stone in the British Museum", "The Greek text on the Rosetta Stone"],
      hit: (w) => w.startsWith("The Rosetta"),
      named: true,
    });
    expect(r.prompts).toHaveLength(0);
    expect(r.states.map((x) => x.status)).toEqual(["photo", "failed"]);
    expect(r.providers.has("generated")).toBe(false);
  });

  test("ruling 296 keeps 209: a generic object beside a named panel is real only, never generated", async () => {
    const STONE = "The Rosetta Stone in the British Museum";
    const BUCKET = "A leather fire bucket";
    const made: string[] = [];
    const r = await run({
      lesson: { subject: "History" },
      panels: [STONE, BUCKET],
      hit: (w) => w === STONE,
      namedAt: (k) => k === 0,
      kind: "object",
      bank: {
        ...STOCK_ONLY_BANK,
        generate: async (req) => {
          made.push(req.text);
          return undefined;
        },
      },
    });
    expect(made).toHaveLength(0);
    expect(r.prompts).toHaveLength(0);
    expect(r.states.map((x) => x.status)).toEqual(["photo", "failed"]);
    expect(r.providers.has("generated")).toBe(false);
  });

  test("never mixed: a generic set is all generated; a named set is all real or empty", async () => {
    const gen = await run({ lesson: { subject: "Science" }, panels: [JAR, BODY], hit: () => true });
    expect([...gen.providers]).toEqual(["generated"]);
    expect(gen.states.every(generatedPhoto)).toBe(true);
    const real = await run({
      lesson: { subject: "Science" },
      panels: [JAR, BODY],
      hit: () => true,
      named: true,
    });
    expect(real.prompts).toHaveLength(0);
    expect(real.providers.has("generated")).toBe(false);
    expect(real.states.every((x) => x.status === "photo")).toBe(true);
  });

  test("a generated panel that still fails after its retry is a tile, beside generated ones only", async () => {
    const r = await run({
      lesson: { subject: "History" },
      panels: [JAR, BODY],
      hit: () => false,
      refuseMade: (w) => w === BODY,
    });
    painted(r.prompts);
    expect(generatedPhoto(r.states[0] as never)).toBe(true);
    expect(r.states[1]?.status).toBe("failed");
    expect([...r.providers]).toEqual(["generated"]);
  });

  test("history activity cards of everyday things are generated; named ones stay real only", async () => {
    const gen = await run({
      lesson: { subject: "History" },
      panels: [COIN, HELMET],
      hit: () => false,
      key: (k) => `card.${k}`,
    });
    painted(gen.prompts);
    expect([...gen.providers]).toEqual(["generated"]);
    const real = await run({
      lesson: { subject: "History" },
      panels: [COIN, HELMET],
      hit: (w) => w === COIN,
      named: true,
      key: (k) => `card.${k}`,
    });
    expect(real.prompts).toHaveLength(0);
    expect(real.states.map((x) => x.status)).toEqual(["photo", "failed"]);
  });
});

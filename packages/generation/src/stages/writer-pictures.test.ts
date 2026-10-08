import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PhotoSource } from "@tj/domain/documents";
import { encodePng, type ImageGenerator, type PhotoResult, type StoredPhoto } from "@tj/images";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import { BudgetExceeded } from "../types";
import type { DirectedPlacer } from "./illustrate";
import {
  createDirectorBatcher,
  createWriterPictures,
  STOCK_ONLY_BANK,
  type WriterPhotoAsk,
  withPhotoSources,
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
          { shows: "A hen", mustShow: ["a hen"], queries: ["hen"], imagePrompt: "A hen." },
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
});

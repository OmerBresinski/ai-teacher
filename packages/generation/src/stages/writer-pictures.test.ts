import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PhotoSource } from "@tj/domain/documents";
import type { PhotoResult, StoredPhoto } from "@tj/images";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import type { DirectedPlacer } from "./illustrate";
import { createWriterPictures, type WriterPhotoAsk, withPhotoSources } from "./picture-director";

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

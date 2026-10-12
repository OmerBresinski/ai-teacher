import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PhotoResult, StoredPhoto } from "@tj/images";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import type { DirectedPlacer } from "./illustrate";
import { createWriterPictures, planPicture, type WriterPhotoAsk } from "./picture-director";

/*
 * Greg, 10 Oct: "a visual should never be lost." The paths where a writer's picture ask still
 * ended with nothing after TEACH-167 part c: the director's own `none`, a match6 drop on a slide
 * that does not ask pupils to look, and a history card whose picture was generated and dropped
 * (ruling 163) instead of being searched on the real ladder.
 */

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
const images = (pexels: PhotoResult[] = []) =>
  ({ search: async () => pexels, store: async (p: PhotoResult) => stored(p) }) as DirectedPlacer;
const ask = (over: Partial<WriterPhotoAsk> = {}): WriterPhotoAsk => ({
  key: "picture",
  type: "photo",
  shows: "A cow and its calf in a field",
  mustSee: ["adult cow", "young calf"],
  named: false,
  // A portrait slot: the stock photos here are 800 x 1200.
  aspect: 0.89,
  ...over,
});
const direction = (over: Partial<PictureDirection>): PictureDirection => ({
  route: "pexels",
  pictures: [
    {
      shows: "A cow and its calf",
      mustShow: ["cow"],
      queries: ["cow calf"],
      imagePrompt: "A cow and a calf.",
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
const spyBank = (made: string[], out?: unknown) => ({
  lookup: async () => undefined,
  remember: async () => undefined,
  generate: async (req: { text: string }) => {
    made.push(req.text);
    return out as never;
  },
});
const slide = {
  heading: "Animals and their young",
  text: "A cow looks after its calf.",
  point: "",
};

describe("the director's own none", () => {
  test("planPicture keeps the writer's ask as the picture (an empty ask has nothing to keep)", () => {
    const none = direction({ route: "none", pictures: [] });
    const p = planPicture(none, { text: "A cow and its calf in a field", named: null });
    expect(p.kind).toBe("photo");
    expect(p.kind === "photo" && p.request.text).toBe("A cow and its calf in a field");
    expect(planPicture(none, { text: " ", named: null }).kind).toBe("none");
  });

  test("a writer ask the director answered none is searched and generated, not dropped", async () => {
    const made: string[] = [];
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images(),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => direction({ route: "none", pictures: [] }),
      bank: spyBank(made),
    });
    pictures.start(4, ask(), slide);
    await pictures.settle(1_000);
    expect(made).toEqual(["A cow and its calf in a field. adult cow. young calf"]);
  });
});

describe("match6 on any slide", () => {
  test("a dropped photo is held for keepPic even when the slide does not ask pupils to look", async () => {
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images([photo("p8")]),
      deps: recordingDeps(
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
        }),
      ),
      direct: async () => direction({}),
    });
    pictures.start(4, ask(), slide);
    await pictures.settle(1_000);
    expect(pictures.state(4, "picture").status).toBe("failed");
    expect(pictures.held(4, "picture")?.status).toBe("photo");
  });
});

describe("a named history card takes the real ladder (rulings 163, 210), never generate-then-drop", () => {
  test("its picture is searched in stock and the generator is never called", async () => {
    const made: string[] = [];
    const pictures = createWriterPictures({
      lesson: { ...sampleBriefLesson(), subject: "History" },
      country: "UK",
      images: images([photo("p9")]),
      deps: recordingDeps(
        createFakeAi({
          script: [
            verdict({ pick: "p9", onSubject: true, clear: true, fits: true, visible: ["a ship"] }),
          ],
        }),
      ),
      bank: spyBank(made, {
        src: "/files/m1.png",
        alt: "A ship",
        source: { provider: "generated", id: "m1" },
        style: "photo",
        aspect: 1.5,
        dataUrl: "data:image/png;base64,AAAA",
      }),
      // An imagined subject: the director's own route is generation only.
      direct: async () =>
        direction({
          route: "library-or-generate",
          pictures: [
            {
              shows: "A cartoon ship",
              mustShow: ["a ship"],
              queries: ["ship"],
              imagePrompt: "A ship.",
            },
          ],
        }),
    });
    pictures.start(4, ask({ key: "card.0", shows: "A ship", mustSee: ["a ship"], named: true }), {
      heading: "Match the pictures",
      text: "A ship",
      point: "",
    });
    await pictures.settle(5_000);
    expect(made).toEqual([]);
    expect(pictures.state(4, "card.0").status).toBe("photo");
    expect([...pictures.sources().values()].map((s) => s.provider)).toEqual(["pexels"]);
  });
});

import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import type { DirectedPlacer } from "./illustrate";
import type { BankRequest, PictureBank } from "./photo-bank";
import {
  createWriterPictures,
  type PictureOutcome,
  placeWriterPicture,
  RECONSTRUCTION_CAPTION,
  type WriterPhotoAsk,
  type WriterPictureAsk,
} from "./picture-director";

// TEACH-247 part cc (romans v5 s9): three named Hadrian's Wall features missed in 30 ms with no
// try, were not retried, and the slide shipped as text while their paintings were still running.
const direction: PictureDirection = {
  route: "commons",
  pictures: [
    {
      shows: "The remains of Milecastle 42 on Hadrian's Wall",
      mustShow: ["small stone enclosure", "wall remains"],
      queries: ["Milecastle 42 Hadrian's Wall"],
      imagePrompt: "A realistic photograph of Milecastle 42.",
    },
  ],
  count: null,
  diagram: null,
  named: "place",
  period: "Roman Britain, northern England",
};
const slide = { heading: "Guarding the wall", text: "A small fort housed soldiers.", point: "" };
const ask = (over: Partial<WriterPictureAsk> = {}): WriterPictureAsk => ({
  key: "picture",
  shows: "Remains of Milecastle 42 on Hadrian's Wall",
  mustSee: ["small stone enclosure", "wall remains"],
  named: true,
  aspect: 1.34,
  slide,
  index: 8,
  ...over,
});
const images = (commons: (q: string) => Promise<never[]>) =>
  ({
    search: async () => [],
    searchCommons: commons,
    store: async () => {
      throw new Error("nothing is stored here");
    },
  }) as unknown as DirectedPlacer;
const made = (req: BankRequest) =>
  ({
    src: `/files/ws/${req.route}.png`,
    width: 1340,
    height: 1000,
    alt: req.text,
    style: "illustration",
    source: { provider: "generated", id: req.route, pageUrl: "" },
  }) as never;
const bank = (generate: PictureBank["generate"]): PictureBank => ({
  lookup: async () => undefined,
  remember: async () => undefined,
  generate,
});

describe("a named place's search (TEACH-247 part cc)", () => {
  test("a Commons search that throws is a failed search, retried, never a real miss", async () => {
    const outcomes: PictureOutcome[] = [];
    await placeWriterPicture({
      ask: ask(),
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images(async () => {
        throw new Error("genlab: no cassette entry");
      }),
      deps: recordingDeps(createFakeAi({ script: [] })),
      bank: bank(async () => undefined),
      direct: async () => direction,
      onOutcome: (o) => outcomes.push(o),
    });
    expect(outcomes[0]?.reason).toBe("real-search-failed");
  });

  test("a real miss is shown by its kind, painted and captioned, never named as the place", async () => {
    const asked: BankRequest[] = [];
    const got = await placeWriterPicture({
      ask: ask(),
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images(async () => []),
      deps: recordingDeps(createFakeAi({ script: [] })),
      bank: bank(async (req) => {
        asked.push(req);
        return made(req);
      }),
      direct: async () => direction,
    });
    const kind = asked[0];
    expect(kind?.text).toContain("small stone enclosure");
    expect(kind?.text).not.toMatch(/Milecastle|Hadrian/);
    expect(kind?.imagePrompt ?? "").not.toMatch(/Milecastle|Hadrian/);
    expect(kind?.realFallback).toBe("illustration");
    expect(got?.source.caption).toBe(RECONSTRUCTION_CAPTION);
  });
});

describe("a slide's group repaint (TEACH-247 part cc)", () => {
  test("whenSlideDone waits for a repaint still running past its deadline, and keeps it", async () => {
    const members: WriterPhotoAsk[] = [0, 1].map((n) => ({
      key: `items.${n}.picture`,
      type: "photo",
      shows: "Remains of Milecastle 42 on Hadrian's Wall",
      mustSee: ["small stone enclosure"],
      named: true,
      aspect: 1.34,
    }));
    const pictures = createWriterPictures({
      lesson: sampleBriefLesson(),
      country: "UK",
      images: images(async () => []),
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => direction,
      // The first placements miss at once; the group's repaint takes 150 ms.
      bank: bank(async (req) => {
        if (req.route !== "generic") return undefined;
        await new Promise((r) => setTimeout(r, 150));
        return made(req);
      }),
    });
    for (const m of members) pictures.start(8, m, slide);
    await pictures.whenSlideDone(8, 40);
    for (const m of members) expect(pictures.state(8, m.key).status).toBe("photo");
  });
});

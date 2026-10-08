import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PhotoResult, StoredPhoto } from "@tj/images";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import { type DirectedPlacer, directedGatePasses, pickDirectedPhoto } from "./illustrate";
import type { BankRequest, PictureBank } from "./photo-bank";
import {
  findDirected,
  type PictureOutcome,
  placeWriterPicture,
  planPicture,
  type WriterPictureAsk,
  writerAskBrief,
} from "./picture-director";
import REPLAY from "./picture-director.replay.json";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function photo(id: string, provider: "pexels" | "commons" = "pexels"): PhotoResult {
  return {
    id,
    width: 800,
    height: 1200,
    alt: `Photo ${id}`,
    photographer: "Ada",
    photographerUrl: "https://www.pexels.com/@ada/",
    pageUrl: `https://example.org/${provider}/${id}`,
    src: {
      large: `https://x/${id}`,
      medium: `https://x/${id}`,
      tiny: `data:image/png;base64,${PNG}`,
    },
  };
}

function stored(p: PhotoResult): StoredPhoto {
  return {
    key: `ws/${p.id}.jpg`,
    url: `/files/ws/${p.id}.jpg`,
    width: p.width,
    height: p.height,
    bytes: 100,
    contentType: "image/jpeg",
    source: {
      provider: "pexels",
      id: p.id,
      pageUrl: p.pageUrl,
      photographer: p.photographer,
      photographerUrl: p.photographerUrl,
    },
  };
}

function placer(over: {
  pexels?: (q: string) => Promise<PhotoResult[]>;
  commons?: (q: string) => Promise<PhotoResult[]>;
}) {
  const calls: string[] = [];
  const images: DirectedPlacer = {
    search: async (q) => {
      calls.push(`pexels:${q}`);
      return (over.pexels ?? (async () => []))(q);
    },
    ...(over.commons
      ? {
          searchCommons: async (q: string) => {
            calls.push(`commons:${q}`);
            return (over.commons as (q: string) => Promise<PhotoResult[]>)(q);
          },
        }
      : {}),
    store: async (p) => stored(p),
  };
  return { images, calls };
}

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

function spyBank(): { bank: PictureBank; made: BankRequest[] } {
  const made: BankRequest[] = [];
  return {
    made,
    bank: {
      lookup: async () => undefined,
      remember: async () => undefined,
      generate: async (req) => {
        made.push(req);
        return undefined;
      },
    },
  };
}

const ask = (over: Partial<WriterPictureAsk> = {}): WriterPictureAsk => ({
  key: "3:picture",
  shows: "A portrait of Henry VIII",
  mustSee: ["Henry VIII"],
  named: true,
  aspect: 0.89,
  slide: { heading: "Henry VIII", text: "Henry VIII ruled England.", point: "" },
  index: 0,
  ...over,
});

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

describe("writer picture requests (replay of base4's saved runs)", () => {
  test("every saved single or column ask builds the request the lab sent, byte for byte", () => {
    expect(REPLAY.cases.length).toBe(22);
    for (const c of REPLAY.cases) {
      const b = writerAskBrief(
        ask({ shows: c.ask.shows, mustSee: c.ask.mustSee, named: c.ask.named }),
      );
      expect(b.request).toBe(c.request.slice(0, 400));
      expect(b.mustShow).toEqual(c.ask.mustSee);
      expect(b.specific).toBe(c.ask.named);
      expect(b.subject.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("ruling 163 under strict (placement)", () => {
  test("a historical person with no Commons or Pexels hit keeps the placeholder; nothing is generated", async () => {
    const { images, calls } = placer({ commons: async () => [], pexels: async () => [] });
    const { bank, made } = spyBank();
    const outcomes: PictureOutcome[] = [];
    const ai = createFakeAi({ script: [] });
    const got = await placeWriterPicture({
      ask: ask(),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(ai),
      bank,
      direct: async () => direction({ named: "person", period: "Tudor England, 1509-1547" }),
      onOutcome: (o) => outcomes.push(o),
    });
    expect(got).toBeUndefined();
    expect(made).toHaveLength(0);
    expect(calls.some((c) => c.startsWith("commons:"))).toBe(true);
    expect(outcomes[0]?.reason).toBe("real-miss-no-fallback");
  });

  test("a historical event is real only: no stock fallback, zero generation calls", async () => {
    const { images, calls } = placer({
      commons: async () => [],
      pexels: async () => [photo("p9")],
    });
    const { bank, made } = spyBank();
    const outcomes: PictureOutcome[] = [];
    const event = direction({
      route: "library-or-generate",
      named: "event",
      period: "England, 1066",
      pictures: [
        {
          shows: "Norman soldiers landing at Pevensey in 1066",
          mustShow: ["soldiers"],
          queries: ["Norman landing 1066"],
          imagePrompt: "Norman soldiers landing on a beach.",
        },
      ],
    });
    const plan = planPicture(event, {
      text: "Norman soldiers landing at Pevensey in 1066",
      named: null,
      aspect: 0.89,
    });
    expect(plan.kind).toBe("photo");
    if (plan.kind === "photo") {
      expect(plan.request.route).toBe("real");
      expect(plan.request.depicts).toBe(true);
      expect(plan.request.realFallback).toBe("none");
      expect(plan.request.style).toBeUndefined();
      expect(plan.brief.period).toBe("England, 1066");
    }
    const got = await placeWriterPicture({
      ask: ask({ shows: "Norman soldiers landing at Pevensey in 1066", mustSee: [], named: false }),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(createFakeAi({ script: [] })),
      bank,
      direct: async () => event,
      onOutcome: (o) => outcomes.push(o),
    });
    expect(got).toBeUndefined();
    expect(made).toHaveLength(0);
    expect(outcomes[0]?.reason).toBe("real-miss-no-fallback");
    // Strict history never falls back to stock: Commons only, the artefact search included.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.startsWith("commons:"))).toBe(true);
  });

  test("a busy Commons for a historical person is no picture, never a Pexels stand-in", async () => {
    const { images, calls } = placer({
      commons: async () => {
        throw new Error("Commons is busy");
      },
      pexels: async () => [photo("p8")],
    });
    const { bank, made } = spyBank();
    const got = await placeWriterPicture({
      ask: ask(),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(createFakeAi({ script: [] })),
      bank,
      direct: async () => direction({ named: "person", period: "Tudor England, 1509-1547" }),
    });
    expect(got).toBeUndefined();
    expect(made).toHaveLength(0);
    expect(calls.some((c) => c.startsWith("pexels:"))).toBe(false);
  });
});

describe("pickDirectedPhoto (judge v17, Commons first)", () => {
  const brief = writerAskBrief(ask());

  test("Commons throwing during the requery falls back to Pexels; the slot is not failed", async () => {
    let commonsCalls = 0;
    const { images, calls } = placer({
      commons: async () => {
        commonsCalls += 1;
        if (commonsCalls === 1) return [photo("c1", "commons")];
        throw new Error("Commons search failed (500)");
      },
      pexels: async () => [photo("p1")],
    });
    const ai = createFakeAi({
      script: [
        verdict({ query: "Henry VIII Holbein portrait" }),
        verdict({
          pick: "p1",
          onSubject: true,
          clear: true,
          fits: true,
          visible: ["Henry VIII"],
          count: "one",
        }),
      ],
    });
    const r = await pickDirectedPhoto({
      lesson: sampleBriefLesson(),
      index: 0,
      brief,
      images,
      deps: recordingDeps(ai),
    });
    expect(r.outcome).toBe("placed");
    expect(calls.filter((c) => c.startsWith("pexels:"))).toEqual([
      "pexels:Henry VIII Holbein portrait",
    ]);
  });

  test("Commons failing on the first search falls back to Pexels", async () => {
    const { images, calls } = placer({
      commons: async () => {
        throw new Error("busy");
      },
      pexels: async () => [photo("p2")],
    });
    const ai = createFakeAi({
      script: [
        verdict({ pick: "p2", onSubject: true, clear: true, fits: true, visible: ["Henry VIII"] }),
      ],
    });
    const r = await pickDirectedPhoto({
      lesson: sampleBriefLesson(),
      index: 0,
      brief,
      images,
      deps: recordingDeps(ai),
    });
    expect(r.outcome).toBe("placed");
    expect(calls.some((c) => c.startsWith("pexels:"))).toBe(true);
  });

  test("the judge is v17 and a pick that does not fit is refused by the director's gate", async () => {
    const { images } = placer({ pexels: async () => [photo("p3")] });
    const ai = createFakeAi({
      script: [verdict({ pick: "p3", onSubject: true, clear: true, fits: false })],
    });
    const deps = recordingDeps(ai);
    const r = await pickDirectedPhoto({
      lesson: sampleBriefLesson(),
      index: 0,
      brief: { ...brief, specific: false },
      images,
      deps,
    });
    expect(r.outcome).toBe("empty");
    expect(JSON.stringify(ai.calls[0])).toContain("pick-or-requery-photo");
    expect(
      directedGatePasses(brief, {
        pick: "p3",
        onSubject: true,
        clear: true,
        fits: false,
        why: "",
        visible: [],
        count: null,
        query: null,
      }),
    ).toBe(false);
  });
});

describe("findDirected aborts", () => {
  test("an abort during the artefact search is rethrown, not swallowed as no picture", async () => {
    let n = 0;
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const run = findDirected({
      bank: spyBank().bank,
      ask: { subject: "Norman soldiers landing in 1066", named: null },
      brief: writerAskBrief(ask({ shows: "Norman soldiers landing in 1066", named: false })),
      slide: { heading: "1066" },
      lesson: { title: "The Norman Conquest" },
      country: "UK",
      index: 0,
      // The scene search misses; the artefact search is aborted.
      stock: async () => {
        n += 1;
        if (n === 1) return undefined;
        throw abort;
      },
      judgeMade: async () => false,
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () => direction({ named: "event", period: "England, 1066" }),
    });
    await expect(run).rejects.toThrow("aborted");
    expect(n).toBe(2);
  });
});

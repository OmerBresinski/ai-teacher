import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createFakeAi } from "@tj/ai/testing";
import type { ImageBrief } from "@tj/domain/documents";
import type { PhotoResult, StoredPhoto } from "@tj/images";
import pino from "pino";
import { MADE_PICTURE_RULES } from "../prompts/pick-or-requery-photo-directed";
import type { PictureDirection } from "../prompts/picture-director";
import { recordingDeps, sampleBriefLesson } from "../testing";
import {
  type DirectedPlacer,
  directedGatePasses,
  freeLicenceFirst,
  type PlacedPhoto,
  pickDirectedPhoto,
} from "./illustrate";
import type { BankRequest, PictureBank } from "./photo-bank";
import {
  findDirected,
  LOCATOR_MAP_GRACE_MS,
  type PictureOutcome,
  placeNameOf,
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

/**
 * TEACH-251 part ay: the requests before the last step. A slot every step missed is painted once
 * more (`lastResortRequest`: generic route, painted, the illustration fallback).
 */
const isLastResort = (m: BankRequest) =>
  m.route === "generic" && m.realFallback === "illustration" && m.style === "illustration";
const firstTries = (made: BankRequest[]) => made.filter((m) => !isLastResort(m));

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
    const lines: Record<string, unknown>[] = [];
    const logger = pino(
      { level: "info" },
      new Writable({
        write(chunk, _enc, cb) {
          lines.push(JSON.parse(String(chunk)));
          cb();
        },
      }),
    );
    const got = await placeWriterPicture({
      ask: ask(),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(ai, { logger }),
      bank,
      direct: async () => direction({ named: "person", period: "Tudor England, 1509-1547" }),
      onOutcome: (o) => outcomes.push(o),
    });
    expect(got).toBeUndefined();
    expect(firstTries(made)).toHaveLength(0);
    expect(calls.some((c) => c.startsWith("commons:"))).toBe(true);
    expect(outcomes[0]?.reason).toBe("real-miss-no-fallback");
    expect(outcomes[0]?.attempts).toBe(0);
    // One outcome line per picture, codes only (a paid eval counts empty photos and why).
    expect(lines.filter((l) => l.ev === "picture-outcome")).toEqual([
      expect.objectContaining({
        kind: "single",
        outcome: "empty",
        via: "none",
        attempts: 0,
        reason: "real-miss-no-fallback",
      }),
    ]);
    // Picture tracing (21 Oct 2026): the line's new codes, and nothing the debug record keeps.
    const line = lines.find((l) => l.ev === "picture-outcome") ?? {};
    expect(line).toMatchObject({
      director: "commons",
      route: "real",
      sourceKind: "none",
      pictureKind: expect.stringMatching(/^(portrait|scene|object)$/),
      promptVersion: "picture-director-batch.v3",
      framingClause: true,
      frameMeasured: false,
      retryReasons: [],
      pictureCostUsd: 0,
    });
    for (const key of ["tries", "why", "src", "imagePrompt", "request"])
      expect(line).not.toHaveProperty(key);
  });

  test("a historical event with no real picture is painted, never stock (rulings 163, 210)", async () => {
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
      expect(plan.request.realFallback).toBe("illustration");
      expect(plan.request.style).toBe("illustration");
      expect(plan.request.imagePrompt).toContain("England, 1066");
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
    // The scene search missed, so the painted illustration is asked for once.
    expect(firstTries(made)).toHaveLength(1);
    expect(made[0]?.style).toBe("illustration");
    expect(outcomes[0]?.reason).not.toBe("real-miss-no-fallback");
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
    expect(firstTries(made)).toHaveLength(0);
    expect(calls.some((c) => c.startsWith("pexels:"))).toBe(false);
  });
});

describe("pickDirectedPhoto (judge v17, Commons first)", () => {
  const brief = writerAskBrief(ask());

  // TEACH-251: of equally good pictures, the one that owes no credit; code only, no prompt change.
  const licensed = (id: string, licenceClass: string) => ({
    ...photo(id, "commons"),
    licenceClass,
  });

  test("freeLicenceFirst puts CC0 and public-domain files ahead of CC BY and BY-SA, keeping order", () => {
    const list = [
      licensed("by-1", "cc-by"),
      licensed("zero-1", "cc0"),
      licensed("bysa-1", "cc-by-sa"),
      licensed("pd-1", "public-domain"),
      photo("pexels-1"),
    ];
    expect(freeLicenceFirst(list).map((p) => p.id)).toEqual([
      "zero-1",
      "pd-1",
      "pexels-1",
      "by-1",
      "bysa-1",
    ]);
    expect(freeLicenceFirst(list)).toHaveLength(list.length);
  });

  test("the judge is shown the CC0 and public-domain candidates first, and its pick still stands", async () => {
    const { images } = placer({
      commons: async () => [
        licensed("by-1", "cc-by"),
        licensed("bysa-1", "cc-by-sa"),
        licensed("zero-1", "cc0"),
      ],
    });
    const ai = createFakeAi({
      script: [
        verdict({
          pick: "by-1",
          onSubject: true,
          clear: true,
          fits: true,
          visible: ["Henry VIII"],
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
    const judged = JSON.stringify(ai.calls.at(-1));
    const at = (id: string) => judged.indexOf(`Photo ${id}`);
    expect(at("zero-1")).toBeGreaterThan(-1);
    expect(at("zero-1")).toBeLessThan(at("by-1"));
    expect(at("by-1")).toBeLessThan(at("bysa-1"));
    // A tie-break, not a veto: a CC BY picture the judge prefers is placed.
    expect(r.outcome).toBe("placed");
  });

  test("a pick another slide placed during the judge call is struck off and the rest judged (TEACH-251 part ah)", async () => {
    // romans verify7 s3: the judge picked the photo the title placed 2.5 s earlier, so the slot
    // ended empty with three more Housesteads photos shown and still free.
    const first = photo("c1", "commons");
    const { images } = placer({ commons: async () => [first, photo("c2", "commons")] });
    const ai = createFakeAi({
      script: [
        verdict({ pick: "c1", onSubject: true, clear: true, fits: true, visible: ["Henry VIII"] }),
        verdict({ pick: "c2", onSubject: true, clear: true, fits: true, visible: ["Henry VIII"] }),
      ],
    });
    // The title slide takes c1 once the judge has been asked (after the search, before the verdict).
    const taken = new (class extends Set<string> {
      override has(key: string) {
        return super.has(key) || (ai.calls.length > 0 && key === first.pageUrl);
      }
    })();
    const r = await pickDirectedPhoto({
      lesson: sampleBriefLesson(),
      index: 2,
      brief,
      images,
      deps: recordingDeps(ai),
      taken,
    });
    expect(r.outcome).toBe("placed");
    if (r.outcome === "placed") expect(r.photo.src).toContain("c2");
  });

  test("a map ask searches only its map queries (TEACH-251 part ah)", async () => {
    const { images, calls } = placer({ commons: async () => [] });
    const r = await pickDirectedPhoto({
      lesson: { ...sampleBriefLesson(), title: "Why the Romans built Hadrian's Wall" },
      index: 3,
      brief: {
        ...writerAskBrief(
          ask({
            shows: "Show a north-up map of Britain with north marked",
            mustSee: [],
            named: false,
          }),
        ),
        specific: true,
        queries: ["Hadrian's Wall map", "Britain map"],
      },
      images,
      deps: recordingDeps(createFakeAi({ script: [verdict({}), verdict({})] })),
    });
    expect(r.outcome).toBe("empty");
    expect(calls.filter((c) => c.startsWith("commons:"))).toEqual([
      "commons:Hadrian's Wall map",
      "commons:Britain map",
    ]);
  });

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

describe("picture tracing never touches the picture", () => {
  test("a trace that throws records no kind or trace; the picture is still placed", async () => {
    const { images } = placer({ commons: async () => [], pexels: async () => [] });
    const lines: Record<string, unknown>[] = [];
    const logger = pino(
      { level: "info" },
      new Writable({
        write(chunk, _enc, cb) {
          lines.push(JSON.parse(String(chunk)));
          cb();
        },
      }),
    );
    // A made picture whose frame measure throws when read (no bytes, so it is not judged).
    const bank: PictureBank = {
      lookup: async () => undefined,
      remember: async () => undefined,
      generate: async () => ({
        src: "/files/w/images/g1.png",
        alt: "a hen",
        source: {
          provider: "generated",
          id: "g1",
          pageUrl: "https://openai.com/policies/",
          photographer: "AI-generated (m)",
          photographerUrl: "https://openai.com/policies/",
        },
        evidence: { visible: [], count: "one", alt: "a hen", promptVersion: "t" },
        frame: {
          plain: true,
          cut: false,
          bleed: 0,
          ms: 1,
          get edges(): never {
            throw new Error("trace bug");
          },
        },
      }),
    };
    const got = await placeWriterPicture({
      ask: ask({ shows: "A hen beside a chick", mustSee: [], named: false }),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(createFakeAi({ script: [] }), { logger }),
      bank,
      direct: async () =>
        direction({
          route: "library-or-generate",
          pictures: [
            {
              shows: "A hen beside a chick",
              mustShow: [],
              queries: [],
              imagePrompt: "A hen beside a chick on straw.",
            },
          ],
        }),
      raceMs: 60_000,
    });
    expect(got?.src).toBe("/files/w/images/g1.png");
    const line = lines.find((l) => l.ev === "picture-outcome") ?? {};
    expect(line).toMatchObject({ outcome: "placed", via: "generated", sourceKind: "generated" });
    for (const key of ["pictureKind", "frameMeasured", "retryReasons", "pictureCostUsd"])
      expect(line).not.toHaveProperty(key);
  });
});

// Ruling 296 (amends 210): a generic period object with no Commons or stock hit is generated; a real
// place with none keeps its placeholder.
describe("ruling 296 (placement)", () => {
  const fire = (
    named: PictureDirection["named"],
    shows: string,
    writerNamed: boolean,
    period: string | null = "London, 1666",
    realOnly = false,
  ) => {
    const { images, calls } = placer({ commons: async () => [], pexels: async () => [] });
    const { bank, made } = spyBank();
    const outcomes: PictureOutcome[] = [];
    const run = placeWriterPicture({
      ask: ask({ shows, mustSee: [], named: writerNamed }),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(createFakeAi({ script: [] })),
      bank,
      direct: async () =>
        direction({
          named,
          period,
          pictures: [{ shows, mustShow: [], queries: [shows], imagePrompt: `${shows}.` }],
        }),
      onOutcome: (o) => outcomes.push(o),
      ...(realOnly ? { realOnly: true } : {}),
    });
    return { run, made, outcomes, calls };
  };
  test("a leather fire bucket missed by Commons and stock is generated, as an illustration", async () => {
    const { run, made, outcomes, calls } = fire(
      "object",
      "A 17th-century leather fire bucket",
      false,
    );
    await run;
    expect(calls.some((c) => c.startsWith("commons:"))).toBe(true);
    expect(firstTries(made)).toHaveLength(1);
    expect(made[0]?.route).toBe("real");
    expect(made[0]?.style).toBe("illustration");
    expect(outcomes[0]?.reason).not.toBe("real-miss-no-fallback");
  });
  test("the Pudding Lane bakery (a real place) missed by Commons and stock stays empty", async () => {
    const { run, made, outcomes } = fire("place", "The Pudding Lane bakery", true);
    expect(await run).toBeUndefined();
    expect(firstTries(made)).toHaveLength(0);
    expect(outcomes[0]?.reason).toBe("real-miss-no-fallback");
  });
  test("a present-day real place missed by Commons and stock stays empty", async () => {
    const { run, made, outcomes } = fire("place", "Buckingham Palace", true, null);
    expect(await run).toBeUndefined();
    expect(firstTries(made)).toHaveLength(0);
    expect(outcomes[0]?.reason).toBe("real-miss-no-fallback");
  });
  test("a present-day generic object is searched (Commons first), then generated on the generic route", async () => {
    const { run, made, calls } = fire("object", "A fire extinguisher", false, null);
    await run;
    expect(calls[0]?.startsWith("commons:")).toBe(true);
    expect(firstTries(made)).toHaveLength(1);
    expect(made[0]?.route).toBe("generic");
    expect(made[0]?.realFallback).toBeUndefined();
  });
  test("fails closed: a real thing the director did not classify is never generated", async () => {
    for (const period of ["London, 1666", null]) {
      const { run, made, outcomes } = fire(null, "A thing in the lesson", false, period);
      expect(await run).toBeUndefined();
      expect(firstTries(made)).toHaveLength(0);
      expect(outcomes[0]?.reason).toBe("real-miss-no-fallback");
    }
  });
  test("a forced-real slot never generates a generic object", async () => {
    const { run, made } = fire("object", "A leather fire bucket", false, "London, 1666", true);
    expect(await run).toBeUndefined();
    expect(firstTries(made)).toHaveLength(0);
  });
  test("a painted past event is placed only after the judge checks it against the period", async () => {
    const { images } = placer({ commons: async () => [], pexels: async () => [] });
    const made: BankRequest[] = [];
    const bank: PictureBank = {
      lookup: async () => undefined,
      remember: async () => undefined,
      generate: async (req) => {
        made.push(req);
        return {
          src: "/files/g1.png",
          width: 800,
          height: 600,
          alt: "x",
          source: { provider: "generated" },
          dataUrl: `data:image/png;base64,${PNG}`,
          style: "illustration",
        } as never;
      },
    };
    const ai = createFakeAi({
      fallback: () =>
        verdict({
          pick: "made",
          onSubject: true,
          kindMatches: true,
          clear: true,
          fits: true,
          visible: ["fire"],
        }),
    });
    const shows = "The Great Fire spreading across London";
    const got = await placeWriterPicture({
      ask: ask({ shows, mustSee: [], named: true }),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(ai),
      bank,
      direct: async () =>
        direction({
          named: "event",
          period: "London, 1666",
          pictures: [{ shows, mustShow: [], queries: [shows], imagePrompt: `${shows}.` }],
        }),
    });
    expect(firstTries(made)).toHaveLength(1);
    expect(got?.src).toBe("/files/g1.png");
    // The wrong-period check: the made-picture judge is given the period.
    expect(ai.calls.some((c) => c.promptText.includes("Period and place: London, 1666"))).toBe(
      true,
    );
    // TEACH-251 part x: the made picture is judged by the painted rules, a real search never is.
    const judged = ai.calls.filter((c) => c.promptText.includes("Period and place: London, 1666"));
    expect(judged.every((c) => c.promptText.includes(MADE_PICTURE_RULES))).toBe(true);
  });
  test("a named past person with no real picture stays empty", async () => {
    const { run, made, outcomes } = fire("person", "Samuel Pepys", true);
    expect(await run).toBeUndefined();
    expect(firstTries(made)).toHaveLength(0);
    expect(outcomes[0]?.reason).toBe("real-miss-no-fallback");
  });
  test("order for a past event: the scene search, then the painting, then the artefact backup", async () => {
    const shows = "The Great Fire spreading across London";
    const go = async (paints: boolean) => {
      const log: string[] = [];
      const { images } = placer({
        commons: async (q) => {
          log.push(`commons:${q}`);
          return [];
        },
        pexels: async () => [],
      });
      const bank: PictureBank = {
        lookup: async () => undefined,
        remember: async () => undefined,
        generate: async () => {
          log.push("paint");
          return paints
            ? ({
                src: "/files/g1.png",
                width: 800,
                height: 600,
                alt: "x",
                source: { provider: "generated" },
                dataUrl: `data:image/png;base64,${PNG}`,
                style: "illustration",
              } as never)
            : undefined;
        },
      };
      const ai = createFakeAi({
        fallback: () =>
          verdict({ pick: "made", onSubject: true, kindMatches: true, clear: true, fits: true }),
      });
      const got = await placeWriterPicture({
        ask: ask({ shows, mustSee: [], named: true }),
        lesson: sampleBriefLesson(),
        country: "UK",
        images,
        deps: recordingDeps(ai),
        bank,
        direct: async () =>
          direction({
            named: "event",
            period: "London, 1666",
            pictures: [{ shows, mustShow: [], queries: [shows], imagePrompt: `${shows}.` }],
          }),
      });
      return { got, log };
    };
    const isBackup = (l: string) => / (coin|map|museum|site)/i.test(l) && l.startsWith("commons:");
    // The painting lands: the artefact backup never runs.
    const painted = await go(true);
    expect(painted.got?.src).toBe("/files/g1.png");
    expect(painted.log[0]?.startsWith("commons:")).toBe(true);
    expect(painted.log.some(isBackup)).toBe(false);
    // The painting fails: the artefact backup runs after it.
    const failed = await go(false);
    const paint = failed.log.indexOf("paint");
    const backup = failed.log.findIndex(isBackup);
    expect(paint).toBeGreaterThan(0);
    expect(backup).toBeGreaterThan(paint);
  });
  test("a past ask the director did not classify is never painted", async () => {
    const { run, made, outcomes } = fire(null, "A portrait of Charles II", false);
    expect(await run).toBeUndefined();
    expect(firstTries(made)).toHaveLength(0);
    expect(outcomes[0]?.reason).toBe("real-miss-no-fallback");
  });
});

describe("TEACH-251 part v: a 'where' slide about a real place tries a locator map", () => {
  const stockPhoto = (src: string) =>
    ({ src, alt: src, source: { provider: "commons", id: src } }) as unknown as PlacedPhoto;
  const isMap = (b: ImageBrief) => !!b.queries?.some((q) => /locator map/.test(q));
  const run = (o: {
    locate?: boolean;
    map?: "found" | "none" | "throws" | "hangs";
    named?: PictureDirection["named"];
    shows?: string;
    heading?: string;
    mapMs?: number;
  }) => {
    const briefs: ImageBrief[] = [];
    const remembered: string[] = [];
    const bank: PictureBank = {
      lookup: async () => undefined,
      remember: async (req) => {
        remembered.push(req.text);
      },
      generate: async () => undefined,
    };
    const shows = o.shows ?? "A surviving stretch of Hadrian's Wall beside Housesteads Roman Fort";
    const out = findDirected({
      bank,
      ask: { subject: shows, named: null },
      brief: writerAskBrief(ask({ shows, named: true })),
      slide: {
        heading: o.heading ?? "Hadrian's wall across northern England",
        ...(o.locate === false ? {} : { locate: true }),
      },
      lesson: { title: "Why the Romans built Hadrian's Wall" },
      country: "UK",
      index: 2,
      mapMs: o.mapMs ?? 50,
      stock: async (b, signal) => {
        briefs.push(b);
        if (!isMap(b)) return stockPhoto("/wall.jpg");
        if (o.map === "throws") throw new Error("commons busy");
        if (o.map === "hangs")
          return new Promise((_, reject) =>
            signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            ),
          );
        return o.map === "none" ? undefined : stockPhoto("/map.png");
      },
      judgeMade: async () => false,
      deps: recordingDeps(createFakeAi({ script: [] })),
      direct: async () =>
        direction({
          route: "commons",
          named: o.named === undefined ? "place" : o.named,
          pictures: [
            {
              shows,
              mustShow: ["stone wall"],
              queries: ["Hadrian's Wall Housesteads"],
              imagePrompt: "The wall.",
            },
          ],
        }),
    });
    return { out, briefs, remembered };
  };
  test("the map is searched beside the photo, placed, and stored in the library", async () => {
    const { out, briefs, remembered } = run({ map: "found" });
    expect((await out)?.src).toBe("/map.png");
    const map = briefs.find(isMap);
    expect(map?.queries).toEqual(["Hadrian's Wall locator map", "Hadrian's Wall location map"]);
    expect(map?.request).toBe("A locator map showing where Hadrian's Wall is");
    expect(briefs).toHaveLength(2);
    expect(remembered).toContain("A locator map showing where Hadrian's Wall is");
  });
  test("no map, a failed map search or one past its cap: the photograph is placed", async () => {
    for (const map of ["none", "throws", "hangs"] as const) {
      const t0 = Date.now();
      expect((await run({ map }).out)?.src).toBe("/wall.jpg");
      expect(Date.now() - t0).toBeLessThan(2000);
    }
  });
  test("a photo placed first waits only the short grace, not the map's whole cap", async () => {
    const t0 = Date.now();
    const { out } = run({ map: "hangs", mapMs: 60_000 });
    expect((await out)?.src).toBe("/wall.jpg");
    expect(Date.now() - t0).toBeLessThan(LOCATOR_MAP_GRACE_MS + 1000);
  });
  test("a slide that is not about where: no map search", async () => {
    const { out, briefs } = run({ locate: false, map: "found" });
    expect((await out)?.src).toBe("/wall.jpg");
    expect(briefs.some(isMap)).toBe(false);
  });
  test("'Where does the story happen?' about no real place: no map search", async () => {
    const { out, briefs } = run({
      map: "found",
      named: null,
      heading: "Where does the story happen?",
      shows: "A dark forest path where Little Red Riding Hood meets the wolf",
    });
    await out;
    expect(briefs.some(isMap)).toBe(false);
  });
  test("the place is the name the director searches, else the longest proper name", () => {
    expect(placeNameOf("Roman soldiers at Hadrian's Wall")).toBe("Hadrian's Wall");
    expect(placeNameOf("A surviving stretch of Hadrian’s Wall beside Housesteads")).toBe(
      "Hadrian's Wall",
    );
    expect(
      placeNameOf("Housesteads Roman Fort on Hadrian's Wall", ["Hadrian's Wall map", "wall fort"]),
    ).toBe("Hadrian's Wall");
    expect(placeNameOf("Pudding Lane in the City of London")).toBe("City of London");
    expect(placeNameOf("a stone wall on a hill")).toBeNull();
  });
});

// TEACH-251 part ay (Greg, 27 Oct: "a planned picture is never missing"; rulings 299, 300).
const refusal = (over: Record<string, unknown>) =>
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

describe("a planned picture is never missing", () => {
  const painting = (src: string) =>
    ({
      src,
      alt: src,
      style: "illustration",
      source: {
        provider: "generated",
        id: src,
        pageUrl: "https://example.com/p",
        photographer: "",
        photographerUrl: "https://example.com/p",
      },
    }) as unknown as PlacedPhoto;
  const run = (opts: { paints: boolean; realOnly?: boolean; key?: string }) => {
    const { images } = placer({ commons: async () => [], pexels: async () => [] });
    const made: BankRequest[] = [];
    const bank: PictureBank = {
      lookup: async () => undefined,
      remember: async () => undefined,
      // The first try at the real thing is never made here; only the last step paints.
      generate: async (req) => {
        made.push(req);
        return opts.paints && isLastResort(req)
          ? (painting(`p${made.length}`) as never)
          : undefined;
      },
    };
    const lines: Record<string, unknown>[] = [];
    const logger = pino(
      { level: "info" },
      new Writable({
        write(chunk, _enc, cb) {
          lines.push(JSON.parse(String(chunk)));
          cb();
        },
      }),
    );
    const got = placeWriterPicture({
      ask: ask(opts.key ? { key: opts.key } : {}),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(createFakeAi({ script: [] }), { logger }),
      bank,
      direct: async () => direction({ named: "person", period: "Tudor England, 1509-1547" }),
      ...(opts.realOnly ? { realOnly: true } : {}),
    });
    return { got, made, lines };
  };
  test("a named person with no real picture gets a painted period scene, never the person", async () => {
    const { got, made, lines } = run({ paints: true });
    const photo = await got;
    expect(photo?.source.provider).toBe("generated");
    expect(photo?.source.caption).toBe("Artist's reconstruction");
    const last = made.at(-1);
    expect(last && isLastResort(last)).toBe(true);
    expect(last?.text).toContain("Tudor England");
    expect(last?.text).not.toContain("Henry");
    expect(last?.imagePrompt).toContain("clearly a painting and not a photograph");
    expect(last?.period).toBe("Tudor England, 1509-1547");
    expect(lines.filter((l) => l.ev === "picture-last-resort")).toEqual([
      expect.objectContaining({ outcome: "painted", realOnly: true, historical: true }),
    ]);
  });
  test("a last step that also fails is logged as missed", async () => {
    const { got, lines } = run({ paints: false });
    expect(await got).toBeUndefined();
    expect(lines.filter((l) => l.ev === "picture-last-resort")).toEqual([
      expect.objectContaining({ outcome: "missed" }),
    ]);
  });
  test("a forced-real sole slot that misses gets the captioned period scene", async () => {
    const { got, made, lines } = run({ paints: true, realOnly: true });
    const photo = await got;
    expect(photo?.source.caption).toBe("Artist's reconstruction");
    expect(made.at(-1)?.text).not.toContain("Henry");
    expect(lines.filter((l) => l.ev === "picture-last-resort")).toHaveLength(1);
  });
  test("a slide's second picture is left to its group (painted together), never painted alone", async () => {
    const { got, made, lines } = run({ paints: true, key: "3:side.1" });
    expect(await got).toBeUndefined();
    expect(made.filter(isLastResort)).toHaveLength(0);
    expect(lines.filter((l) => l.ev === "picture-last-resort")).toHaveLength(0);
  });
  test("a painting the judge refused falls back to an unjudged painted scene of the topic", async () => {
    const { images } = placer({ commons: async () => [], pexels: async () => [] });
    const made: BankRequest[] = [];
    let judged = 0;
    const bank: PictureBank = {
      lookup: async () => undefined,
      remember: async () => undefined,
      generate: async (req) => {
        made.push(req);
        return { ...painting(`p${made.length}`), dataUrl: "data:image/png;base64,AA" } as never;
      },
    };
    const lines: Record<string, unknown>[] = [];
    const logger = pino(
      { level: "info" },
      new Writable({
        write(chunk, _enc, cb) {
          lines.push(JSON.parse(String(chunk)));
          cb();
        },
      }),
    );
    // The judge refuses every painting it sees (a fake model that answers "no").
    const ai = createFakeAi({
      script: Array.from({ length: 20 }, () =>
        refusal({ pick: null, onSubject: false, clear: true, fits: false, why: "Wrong period." }),
      ),
    });
    const photo = await placeWriterPicture({
      ask: ask({ shows: "A Tudor market", mustSee: ["market stalls"], named: false }),
      lesson: sampleBriefLesson(),
      country: "UK",
      images,
      deps: recordingDeps(ai, { logger }),
      bank,
      direct: async () => direction({ named: "event", period: "Tudor England, 1509-1547" }),
    });
    judged = made.length;
    expect(photo?.source.provider).toBe("generated");
    expect(photo?.source.caption).toBe("Artist's reconstruction");
    expect(made.at(-1) && isLastResort(made.at(-1) as BankRequest)).toBe(true);
    expect(judged).toBeGreaterThan(1);
    expect(lines.filter((l) => l.ev === "picture-last-resort")).toEqual([
      expect.objectContaining({ outcome: "painted", refused: true }),
    ]);
  });
});

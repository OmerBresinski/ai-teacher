import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PictureDirection, PictureDirectorInput } from "../prompts/picture-director";
import { recordingDeps } from "../testing";
import type { PlacedPhoto } from "./illustrate";
import {
  type BankRequest,
  findPicture,
  historyPolicy,
  type MadePicture,
  type PictureBank,
  REAL_FALLBACK,
} from "./photo-bank";
import {
  countImagePrompt,
  createDirectorBatcher,
  directPicture,
  planPicture,
} from "./picture-director";
import { DIRECTOR_FIXTURES } from "./picture-director.fixtures";

const pic = (over: Partial<PictureDirection["pictures"][number]> = {}) => ({
  shows: "A sheep with its lamb grazing in a field",
  mustShow: ["sheep", "lamb"],
  queries: ["sheep and lamb"],
  imagePrompt: "A realistic photograph of a sheep and its lamb grazing in a field.",
  ...over,
});
const dir = (over: Partial<PictureDirection>): PictureDirection => ({
  route: "pexels",
  pictures: [pic()],
  count: null,
  named: null,
  period: null,
  veto: null,
  ...over,
});
const ask = { text: "A full-grown sheep beside a lamb", named: null, aspect: 0.89 };
const photoPlan = (d: PictureDirection, a: typeof ask | { text: string; named: null } = ask) => {
  const p = planPicture(d, a);
  if (p.kind !== "photo") throw new Error(`photo expected, got ${p.kind}`);
  return p;
};

describe("planPicture", () => {
  // FIX1 (FULL-RUN y1 s5, refill): "an adult cow beside a calf" came back as a count of 2 "animals";
  // the counting frame replaced the director's prompt and the generator drew cats and dogs.
  test("a pair is a picture of what it shows, not a count", () => {
    const pair = {
      things: "animals",
      total: 2,
      groups: 1,
      perGroup: 2,
      arrangement: "rows" as const,
      empty: 0,
    };
    const p = photoPlan(dir({ count: pair }));
    expect(p.request.imagePrompt).toBe(pic().imagePrompt);
    expect(p.request.imagePrompt).not.toContain("directly above");
  });
  test("commons: real ladder, the request's year-plus-event anchor leads the searches, period kept", () => {
    const p = photoPlan(
      dir({
        route: "commons",
        named: "event",
        period: "Germany, 1923",
        pictures: [pic({ queries: ["Weimar inflation children"] })],
      }),
      {
        text: "German children playing with banknotes during the hyperinflation crisis of 1923",
        named: null,
      },
    );
    expect(p.request.route).toBe("real");
    expect(p.brief.queries).toEqual(["hyperinflation 1923", "Weimar inflation children"]);
    expect(p.brief.period).toBe("Germany, 1923");
    expect(p.request.realFallback).toBe("illustration");
    expect(p.request.imagePrompt).toContain("clearly a painting and not a photograph");
  });

  // SOL-SIMPLE (6 Oct), ruling 163 strict: a period on any route makes the request historical:
  // Commons first, and any generation is the painted illustration, never a photograph.
  test("a historical subject on any route is Commons or an illustration, never a photo", () => {
    const prev = process.env.HISTORY_POLICY;
    delete process.env.HISTORY_POLICY;
    try {
      for (const route of ["commons", "pexels", "library-or-generate"] as const) {
        const p = photoPlan(dir({ route, period: "Germany, 1923" }), {
          text: "A shopper with a basket of banknotes at a 1923 market",
          named: null,
        });
        expect(p.request.route).toBe("real");
        expect(p.request.period).toBe("Germany, 1923");
        expect(p.request.realFallback).toBe("illustration");
        expect(p.request.style).toBe("illustration");
        expect(p.request.imagePrompt).toContain("clearly a painting and not a photograph");
      }
      const person = photoPlan(dir({ route: "commons", named: "person", period: "1920s" }));
      expect(person.request.realFallback).toBe("none");
      expect(photoPlan(dir({ route: "pexels" })).request.style).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.HISTORY_POLICY = prev;
    }
  });

  test("pexels searches stock first; library-or-generate goes straight to generation", () => {
    expect(photoPlan(dir({ route: "pexels" })).request.stockFirst).toBe(true);
    expect(photoPlan(dir({ route: "library-or-generate" })).request.stockFirst).toBe(false);
  });

  test("a split keeps every picture; the zone takes the first", () => {
    const p = photoPlan(
      dir({
        pictures: [
          pic({ shows: "A polar bear on sea ice" }),
          pic({ shows: "A camel in the desert" }),
        ],
      }),
    );
    expect(p.pictures.map((x) => x.shows)).toEqual([
      "A polar bear on sea ice",
      "A camel in the desert",
    ]);
    expect(p.request.text).toBe("A polar bear on sea ice");
  });

  test("a countable thing generates from arm B's prompt, keeps its empty spaces and leads mustShow with the count", () => {
    const eggs = {
      things: "eggs",
      total: 10,
      groups: 2,
      perGroup: 6,
      arrangement: "rows" as const,
      empty: 2,
    };
    const p = photoPlan(dir({ route: "library-or-generate", count: eggs }));
    expect(p.request.imagePrompt).toContain("exactly ten (10) eggs");
    expect(p.request.imagePrompt).toContain("exactly two (2) spaces are empty");
    expect(p.request.imagePrompt).toContain("seen from directly above");
    expect(p.request.stockFirst).toBe(false);
    expect(p.brief.mustShow?.[0]).toBe("exactly 10 eggs");
    expect(countImagePrompt({ ...eggs, empty: 0 })).toBeUndefined();
  });

  test("code draws a plain array; a diagram kind, none, or no answer leaves the zone empty", () => {
    const arr = {
      things: "counters",
      total: 24,
      groups: 4,
      perGroup: 6,
      arrangement: "groups" as const,
      empty: 0,
    };
    const drawn = planPicture(dir({ route: "code", pictures: [], count: arr }), ask);
    expect(drawn.kind === "draw" && drawn.request.draw).toEqual({
      total: 24,
      groups: 4,
      perGroup: 6,
      arrangement: "groups",
    });
    expect(planPicture(dir({ route: "code", pictures: [] }), ask).kind).toBe("none");
    expect(planPicture(dir({ route: "none", pictures: [] }), ask).kind).toBe("none");
    // Round 8: the director's veto is enforced in code, whatever route it named.
    expect(planPicture(dir({ veto: "a schematic: a diagram's job" }), ask).kind).toBe("none");
    expect(planPicture(undefined, ask).kind).toBe("none");
    expect(planPicture(dir({ pictures: [pic({ imagePrompt: " " })] }), ask).kind).toBe("none");
  });

  test("lengths are clipped: three mustShow items of at most 40 characters, four queries", () => {
    const p = photoPlan(
      dir({
        pictures: [
          pic({
            mustShow: ["a very long label that runs well past forty characters", "b", "c", "d"],
            queries: ["q1", "q2", "q2", "q3", "q4", "q5"],
          }),
        ],
      }),
    );
    expect(p.brief.mustShow).toHaveLength(3);
    expect((p.brief.mustShow?.[0] ?? "").length).toBeLessThanOrEqual(40);
    expect(p.brief.queries).toEqual(["q1", "q2", "q3", "q4"]);
  });

  test("history policy is one table; strict by default", () => {
    expect(historyPolicy(undefined)).toBe("strict");
    expect(historyPolicy("labelled")).toBe("labelled");
    expect(REAL_FALLBACK.strict).toEqual({
      event: "illustration",
      person: "none",
      work: "none",
      place: "none",
      object: "none",
    });
    expect(REAL_FALLBACK.present.place).toBe("faithful");
    const person = photoPlan(dir({ route: "commons", named: "person", period: "England, 1540s" }));
    expect(person.request.realFallback).toBe("none");
  });
});

describe("directPicture", () => {
  test("one small call returns the direction; a failed call is undefined", async () => {
    const answer = dir({ route: "commons" });
    const ai = createFakeAi({
      script: [JSON.stringify(answer)],
      usage: { inputTokens: 900, outputTokens: 300 },
    });
    const input = DIRECTOR_FIXTURES[0]?.input as PictureDirectorInput;
    expect(await directPicture(input, recordingDeps(ai))).toEqual(answer);
    expect(ai.calls).toHaveLength(1);
    const bad = createFakeAi({ script: ["not json", "still not json", "nope"] });
    expect(await directPicture(input, recordingDeps(bad))).toBeUndefined();
  });
});

describe("createDirectorBatcher", () => {
  test("slots asked together share one call; a slot the batch missed gets its own", async () => {
    const a = dir({ route: "commons" });
    const b = dir({ route: "none" });
    const ai = createFakeAi({
      script: [JSON.stringify({ slots: [{ id: "p1", ...a }] }), JSON.stringify(b)],
      usage: { inputTokens: 900, outputTokens: 300 },
    });
    const input = DIRECTOR_FIXTURES[0]?.input as PictureDirectorInput;
    const direct = createDirectorBatcher(recordingDeps(ai), "batched system", 5);
    const [x, y] = await Promise.all([direct(input), direct(input)]);
    expect(x).toEqual(a);
    expect(y).toEqual(b);
    expect(ai.calls).toHaveLength(2);
  });
});

const placed = (src: string): PlacedPhoto => ({
  src,
  alt: src,
  source: {
    provider: "pexels",
    id: "1",
    pageUrl: "https://www.pexels.com/photo/1/",
    photographer: "A",
    photographerUrl: "https://www.pexels.com/@a",
  },
  evidence: { visible: [], count: "one", alt: src, promptVersion: "t" },
});
function bank(log: string[]): PictureBank {
  return {
    lookup: async () => undefined,
    remember: async () => void log.push("remember"),
    generate: async (req, faithful): Promise<MadePicture> => {
      log.push(`generate:${faithful}:${req.draw ? "drawn" : (req.imagePrompt ?? "-")}`);
      return { ...placed("/files/g.png"), dataUrl: "data:image/png;base64,AA" };
    },
  };
}
const req = (over: Partial<BankRequest>): BankRequest => ({
  text: "x",
  named: null,
  route: "generic",
  ...over,
});
const sig = () => AbortSignal.timeout(1000);

describe("findPicture", () => {
  test("a count is drawn without a search or a judge", async () => {
    const log: string[] = [];
    let judged = 0;
    await findPicture(
      req({ draw: { total: 24, groups: 4, perGroup: 6, arrangement: "groups" } }),
      bank(log),
      async () => placed("s"),
      sig(),
      async () => (judged++, true),
    );
    expect(log).toEqual(["generate:false:drawn"]);
    expect(judged).toBe(0);
  });

  test("stock first: a judged stock photo wins and is remembered; a miss is generated", async () => {
    const log: string[] = [];
    expect(
      (
        await findPicture(
          req({ stockFirst: true, imagePrompt: "P" }),
          bank(log),
          async () => placed("s"),
          sig(),
        )
      ).via,
    ).toBe("fetched");
    expect(log).toEqual(["remember"]);
    const log2: string[] = [];
    expect(
      (
        await findPicture(
          req({ stockFirst: true, imagePrompt: "P" }),
          bank(log2),
          async () => undefined,
          sig(),
        )
      ).via,
    ).toBe("generated");
    expect(log2).toEqual(["generate:false:P"]);
  });

  test("a generated picture the judge refuses is regenerated once, then nothing", async () => {
    const log: string[] = [];
    let n = 0;
    const ok = await findPicture(
      req({ imagePrompt: "P" }),
      bank(log),
      async () => undefined,
      sig(),
      async () => ++n === 2,
    );
    expect(ok.via).toBe("generated");
    expect(log).toEqual(["generate:false:P", "generate:false:P"]);
    const never = await findPicture(
      req({ imagePrompt: "P" }),
      bank([]),
      async () => undefined,
      sig(),
      async () => false,
    );
    expect(never.via).toBe("none");
  });

  test("a real miss follows its fallback: none is never generated; an illustration is judged", async () => {
    const log: string[] = [];
    expect(
      (await findPicture(req({ route: "real" }), bank(log), async () => undefined, sig())).via,
    ).toBe("none");
    expect(log).toEqual([]);
    const ill = await findPicture(
      req({
        route: "real",
        realFallback: "illustration",
        imagePrompt: "I",
        period: "London, 1666",
        depicts: true,
      }),
      bank(log),
      async () => undefined,
      sig(),
      async () => true,
    );
    // BAKEOFF round 6, ruling 163 tightened: nothing is generated for a past event.
    expect(ill.via).toBe("none");
    const now = await findPicture(
      req({ route: "real", realFallback: "illustration", imagePrompt: "I" }),
      bank(log),
      async () => undefined,
      sig(),
      async () => true,
    );
    expect(now.via).toBe("generated");
  });
});

describe("lesson look (dd-pics, 6 Oct)", () => {
  const look = {
    style: "illustration" as const,
    palette: ["#E4572E", "#17BEBB", "#FFFDF7", "#1D1D1F"],
  };
  test("a generic picture in an illustration lesson is generated in the locked style and palette", () => {
    const p = photoPlan(dir({ route: "pexels" }), { ...ask, look } as never);
    expect(p.request.route).toBe("generic");
    expect(p.request.style).toBe("illustration");
    expect(p.request.stockFirst).toBe(false);
    expect(p.request.palette).toBe("#e4572e #17bebb #fffdf7 #1d1d1f");
    expect(p.request.imagePrompt?.split("\n")[0]).toContain("illustration");
    expect(p.request.imagePrompt).toContain("#E4572E, #17BEBB, #FFFDF7, #1D1D1F");
  });
  test("every call of the lesson carries the same style line", () => {
    const a = photoPlan(dir({}), { ...ask, look } as never).request.imagePrompt ?? "";
    const b =
      photoPlan(dir({ pictures: [pic({ imagePrompt: "A ship in a storm." })] }), {
        ...ask,
        look,
      } as never).request.imagePrompt ?? "";
    expect(a.split("\n").slice(0, 2)).toEqual(b.split("\n").slice(0, 2));
  });
  test("the prompt agent's line fills {{palette}}", () => {
    const p = photoPlan(dir({}), {
      ...ask,
      look: { ...look, line: "Flat illustration in {{palette}} only." },
    } as never);
    expect(p.request.imagePrompt?.split("\n")[0]).toBe(
      "Flat illustration in #E4572E, #17BEBB, #FFFDF7, #1D1D1F only.",
    );
  });
  test("a named real thing still takes the real ladder (Commons), unstyled", () => {
    const p = photoPlan(dir({ route: "commons", named: "work" }), { ...ask, look } as never);
    expect(p.request.route).toBe("real");
    expect(p.request.style).toBeUndefined();
    expect(p.request.palette).toBeUndefined();
  });
  test("ruling 163 unchanged: a historical event keeps the painted period prompt", () => {
    const p = photoPlan(dir({ route: "pexels", period: "Germany, 1923", named: "event" }), {
      ...ask,
      look,
    } as never);
    expect(p.request.route).toBe("real");
    expect(p.request.style).toBe("illustration");
    expect(p.request.imagePrompt).toContain("Germany, 1923");
    expect(p.request.palette).toBeUndefined();
  });
  test("a photo lesson is unchanged", () => {
    const p = photoPlan(dir({}), { ...ask, look: { style: "photo" } } as never);
    expect(p.request.style).toBeUndefined();
    expect(p.request.imagePrompt).toBe(pic().imagePrompt);
  });
});

describe("generic: generate (house photo look)", () => {
  const house = { style: "photo" as const, generic: "generate" as const };
  test("a generic picture is generated in the house look, never stock first", () => {
    const p = photoPlan(dir({ route: "pexels" }), { ...ask, look: house } as never);
    expect(p.request.style).toBe("house");
    expect(p.request.stockFirst).toBe(false);
    expect(p.request.imagePrompt?.split("\n")[0]).toContain("natural-light photograph");
  });
  test("named real things and history are unchanged", () => {
    const real = photoPlan(dir({ route: "commons", named: "place" }), {
      ...ask,
      look: house,
    } as never);
    expect(real.request.route).toBe("real");
    expect(real.request.style).toBeUndefined();
    const hist = photoPlan(dir({ route: "pexels", period: "Germany, 1923", named: "event" }), {
      ...ask,
      look: house,
    } as never);
    expect(hist.request.style).toBe("illustration");
  });
});

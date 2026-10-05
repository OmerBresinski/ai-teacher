import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { PictureDirection, PictureDirectorInput } from "../prompts/picture-director";
import { recordingDeps } from "../testing";
import type { PlacedPhoto } from "./illustrate";
import {
  type BankRequest,
  findPicture,
  historyPolicy,
  type PictureBank,
  realFallback,
} from "./photo-bank";
import { countImagePrompt, directPicture, planPicture } from "./picture-director";
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
  diagram: null,
  named: null,
  period: null,
  ...over,
});
const ask = { text: "A full-grown sheep beside a lamb", named: null, aspect: 0.89 };

describe("planPicture", () => {
  test("commons: the real ladder, Commons-first search, the director's prompt and queries", () => {
    const p = planPicture(
      dir({
        route: "commons",
        pictures: [pic({ queries: ["hyperinflation 1923", "Weimar children banknotes"] })],
      }),
      ask,
    );
    expect(p.kind).toBe("photo");
    if (p.kind !== "photo") return;
    expect(p.request.route).toBe("real");
    expect(p.request.imagePrompt).toContain("sheep and its lamb");
    expect(p.request.draw).toBeNull();
    expect(p.brief.specific).toBe(true);
    expect(p.brief.queries[0]).toBe("hyperinflation 1923");
    expect(p.request.text).toBe("A sheep with its lamb grazing in a field");
  });

  test("pexels searches stock before generating; library-or-generate goes straight to generation", () => {
    const stock = planPicture(dir({ route: "pexels" }), ask);
    const made = planPicture(dir({ route: "library-or-generate" }), ask);
    expect(
      stock.kind === "photo" && stock.request.route === "generic" && stock.request.stockFirst,
    ).toBe(true);
    expect(made.kind === "photo" && made.request.stockFirst).toBe(false);
  });

  test("a split keeps every picture and the zone takes the first", () => {
    const p = planPicture(
      dir({
        pictures: [
          pic({ shows: "A polar bear on sea ice" }),
          pic({ shows: "A camel in the desert" }),
        ],
      }),
      ask,
    );
    expect(p.kind === "photo" && p.pictures.map((x) => x.shows)).toEqual([
      "A polar bear on sea ice",
      "A camel in the desert",
    ]);
    expect(p.kind === "photo" && p.request.text).toBe("A polar bear on sea ice");
  });

  test("code with a consistent count is drawn; an inconsistent one falls to its diagram, else the fallback", () => {
    const ok = planPicture(
      dir({
        route: "code",
        pictures: [],
        count: {
          things: "counters",
          total: 24,
          groups: 4,
          perGroup: 6,
          arrangement: "groups",
          empty: 0,
        },
      }),
      ask,
    );
    expect(ok.kind === "draw" && ok.request.draw).toEqual({
      total: 24,
      groups: 4,
      perGroup: 6,
      arrangement: "groups",
    });
    const bad = planPicture(
      dir({
        route: "code",
        pictures: [],
        count: {
          things: "counters",
          total: 30,
          groups: 4,
          perGroup: 6,
          arrangement: "groups",
          empty: 0,
        },
        diagram: "cycle",
      }),
      ask,
    );
    expect(bad).toEqual({ kind: "diagram", diagram: "cycle" });
    expect(planPicture(dir({ route: "code", pictures: [] }), ask).kind).toBe("photo");
  });

  test("a real route searches the request's year-plus-event anchor first", () => {
    const p = planPicture(
      dir({ route: "commons", pictures: [pic({ queries: ["Weimar inflation children"] })] }),
      {
        text: "German children playing with banknotes during the hyperinflation crisis of 1923",
        named: null,
      },
    );
    expect(p.kind === "photo" && p.brief.queries).toEqual([
      "hyperinflation 1923",
      "Weimar inflation children",
    ]);
  });

  test("ruling 163 (strict default): people, objects and works are Commons or none; an event is illustrated", () => {
    const fb = (named: PictureDirection["named"], period: string | null = "London, 1666") => {
      const p = planPicture(dir({ route: "commons", named, period }), ask);
      return p.kind === "photo" ? p.request.realFallback : "x";
    };
    expect([
      fb("person"),
      fb("object"),
      fb("work"),
      fb("event"),
      fb("place"),
      fb("place", null),
    ]).toEqual(["none", "none", "none", "illustration", "none", "faithful"]);
    const ev = planPicture(dir({ route: "commons", named: "event", period: "London, 1666" }), ask);
    expect(ev.kind === "photo" && ev.request.imagePrompt).toContain(
      "clearly a painting and not a photograph",
    );
    expect(realFallback("person", true, "illustrate")).toBe("illustration");
    expect(realFallback("person", true, "labelled")).toBe("faithful");
    expect(historyPolicy(undefined)).toBe("strict");
    expect(historyPolicy("labelled")).toBe("labelled");
  });

  test("a countable real thing generates from arm B's prompt, keeps its empty spaces and is judged on the count", () => {
    const eggs = {
      things: "eggs",
      total: 10,
      groups: 2,
      perGroup: 6,
      arrangement: "rows" as const,
      empty: 2,
    };
    const p = planPicture(
      dir({
        route: "library-or-generate",
        count: eggs,
        pictures: [pic({ shows: "Ten eggs in a box of twelve", mustShow: ["egg box"] })],
      }),
      ask,
    );
    if (p.kind !== "photo") throw new Error("photo expected");
    expect(p.request.imagePrompt).toContain("exactly ten (10) eggs");
    expect(p.request.imagePrompt).toContain("exactly two (2) spaces are empty");
    expect(p.request.imagePrompt).toContain("seen from directly above");
    expect(p.request.stockFirst).toBe(false);
    expect(p.brief.mustShow[0]).toBe("exactly 10 eggs");
    expect(countImagePrompt({ ...eggs, empty: 0 })).toBeUndefined();
  });

  test("none leaves the zone empty", () => {
    expect(planPicture(dir({ route: "none", pictures: [] }), ask)).toEqual({ kind: "none" });
  });

  test("lengths are clipped in code: three mustShow items of at most 40 characters, three queries", () => {
    const p = planPicture(
      dir({
        pictures: [
          pic({
            mustShow: ["a very long label that runs well past forty characters", "b", "c", "d"],
            queries: ["q1", "q2", "q2", "q3", "q4"],
          }),
        ],
      }),
      ask,
    );
    if (p.kind !== "photo") throw new Error("photo expected");
    expect(p.brief.mustShow).toHaveLength(3);
    expect(p.brief.mustShow[0]?.length ?? 0).toBeLessThanOrEqual(40);
    expect(p.brief.queries).toEqual(["q1", "q2", "q3", "q4"]);
  });

  test("no answer, or a photo route with no usable picture: the regex route and the fixed template", () => {
    const generic = planPicture(undefined, ask);
    expect(generic.kind === "photo" && generic.request.imagePrompt).toBeUndefined();
    expect(generic.kind === "photo" && generic.request.stockFirst).toBe(true);
    const real = planPicture(undefined, { text: "Children with banknotes in 1923", named: null });
    expect(real.kind === "photo" && real.request.route).toBe("real");
    const count = planPicture(undefined, {
      text: "24 counters in four equal groups of six",
      named: null,
    });
    expect(count.kind === "draw" && count.request.draw?.total).toBe(24);
    expect(planPicture(dir({ pictures: [pic({ imagePrompt: "  " })] }), ask).kind === "photo").toBe(
      true,
    );
    const empty = planPicture(dir({ pictures: [pic({ imagePrompt: "  " })] }), ask);
    expect(empty.kind === "photo" && empty.directed).toBe(false);
  });
});

describe("directPicture", () => {
  test("returns the director's answer from one small call", async () => {
    const answer = dir({ route: "commons" });
    const ai = createFakeAi({
      script: [JSON.stringify(answer)],
      usage: { inputTokens: 900, outputTokens: 300 },
    });
    const out = await directPicture(
      DIRECTOR_FIXTURES[6]?.input as PictureDirectorInput,
      recordingDeps(ai),
    );
    expect(out?.direction).toEqual(answer);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.modelClass ?? "small").toBe("small");
  });

  test("a failed call is undefined, so the slot falls back rather than waiting", async () => {
    const ai = createFakeAi({ script: ["not json", "still not json", "nope"] });
    expect(
      await directPicture(DIRECTOR_FIXTURES[0]?.input as PictureDirectorInput, recordingDeps(ai)),
    ).toBeUndefined();
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
    generate: async (req, faithful) => {
      log.push(`generate:${faithful}:${req.draw ? "drawn" : (req.imagePrompt ?? "template")}`);
      return placed("/files/g.png");
    },
  };
}
const req = (over: Partial<BankRequest>): BankRequest => ({
  text: "x",
  named: null,
  route: "generic",
  ...over,
});

describe("findPicture with a director's plan", () => {
  test("a count is drawn without a stock search", async () => {
    const log: string[] = [];
    let searched = 0;
    await findPicture(
      req({ draw: { total: 24, groups: 4, perGroup: 6, arrangement: "groups" } }),
      bank(log),
      async () => {
        searched++;
        return placed("s");
      },
      AbortSignal.timeout(1000),
    );
    expect(searched).toBe(0);
    expect(log).toEqual(["generate:false:drawn"]);
  });

  test("stock first: a judged stock photo wins and is remembered; a miss is generated with the director's prompt", async () => {
    const log: string[] = [];
    const hit = await findPicture(
      req({ stockFirst: true, imagePrompt: "P" }),
      bank(log),
      async () => placed("s"),
      AbortSignal.timeout(1000),
    );
    expect(hit.via).toBe("fetched");
    expect(log).toEqual(["remember"]);
    const log2: string[] = [];
    const miss = await findPicture(
      req({ stockFirst: true, imagePrompt: "P" }),
      bank(log2),
      async () => undefined,
      AbortSignal.timeout(1000),
    );
    expect(miss.via).toBe("generated");
    expect(log2).toEqual(["generate:false:P"]);
  });

  test("an illustrated event is period-checked: one regeneration on a fail, then none; no checker, nothing", async () => {
    const log: string[] = [];
    let checks = 0;
    const b = { ...bank(log), checkPeriod: async () => ++checks === 2 };
    const out = await findPicture(
      req({ route: "real", realFallback: "illustration", imagePrompt: "I" }),
      b,
      async () => undefined,
      AbortSignal.timeout(1000),
    );
    expect(out.via).toBe("generated");
    expect(log).toEqual(["generate:false:I", "generate:false:I"]);
    expect(
      (
        await findPicture(
          req({ route: "real", realFallback: "none" }),
          bank([]),
          async () => undefined,
          AbortSignal.timeout(1000),
        )
      ).via,
    ).toBe("none");
    expect(
      (
        await findPicture(
          req({ route: "real", realFallback: "illustration" }),
          bank([]),
          async () => undefined,
          AbortSignal.timeout(1000),
        )
      ).via,
    ).toBe("none");
  });

  test("stockFirst false skips the search", async () => {
    let searched = 0;
    const log: string[] = [];
    await findPicture(
      req({ stockFirst: false, imagePrompt: "P" }),
      bank(log),
      async () => {
        searched++;
        return placed("s");
      },
      AbortSignal.timeout(1000),
    );
    expect(searched).toBe(0);
    expect(log).toEqual(["generate:false:P"]);
  });
});

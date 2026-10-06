import { afterEach, describe, expect, test } from "bun:test";
import { pickOrRequerySchemaFor } from "../prompts/pick-or-requery-photo";
import { gatePasses, type PlacedPhoto } from "./illustrate";
import {
  type BankRequest,
  findPicture,
  type MadePicture,
  mustShowOf,
  type PictureBank,
  photoBankOn,
} from "./photo-bank";

const photo = (src: string): PlacedPhoto => ({
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

describe("mustShowOf (PICTURE-AUDIT #1)", () => {
  test.each([
    ["An adult dog and its puppy sitting side by side, both visible.", ["adult dog", "puppy"]],
    [
      "A two-panel photographic collage: an adult dog beside a puppy on the left; a cat",
      ["adult dog", "puppy"],
    ],
    [
      "An adult brown hen beside a very young yellow chick, both standing",
      ["adult brown hen", "very young yellow chick"],
    ],
    [
      "An ice cube beside a glass of liquid water, showing a solid",
      ["ice cube", "glass of liquid water"],
    ],
    ["24 identical counters arranged in four equal groups of six", ["24 identical counters"]],
  ])("%s", (text, items) => {
    expect(mustShowOf(text)).toEqual(items);
  });
  test("at most three items of at most 40 characters", () => {
    const items = mustShowOf(
      "a very long description of an extraordinarily specific laboratory apparatus beside a flask and a burner and a tripod and a gauze",
    );
    expect(items.length).toBeLessThanOrEqual(3);
    for (const i of items) expect(i.length).toBeLessThanOrEqual(40);
  });
});

describe("judge schema and gate (PICTURE-AUDIT #1, #4)", () => {
  test("visible items outside mustShow are dropped, not a failure", () => {
    const empty = pickOrRequerySchemaFor({ mustShow: [] }).safeParse({
      pick: "1",
      onSubject: true,
      clear: true,
      fits: true,
      visible: ["sheep", "grass"],
    });
    expect(empty.success).toBe(true);
    expect(empty.data?.visible).toEqual([]);
    const some = pickOrRequerySchemaFor({ mustShow: ["Ram", "lamb"] }).parse({
      pick: "1",
      onSubject: true,
      clear: true,
      fits: true,
      visible: ["ram", "fence"],
    });
    expect(some.visible).toEqual(["ram"]);
  });
  const verdict = (visible: string[]) => ({
    pick: "1",
    why: null,
    onSubject: true,
    clear: true,
    fits: true,
    visible,
    count: "one" as const,
    query: null,
  });
  test("a writer's request needs every named thing in view (ram without lamb: refused)", () => {
    const brief = {
      mustShow: ["full-grown sheep", "young lamb"],
      request: "a sheep beside a lamb",
    };
    expect(gatePasses(brief, verdict(["full-grown sheep"]))).toBe(false);
    expect(gatePasses(brief, verdict(["full-grown sheep", "young lamb"]))).toBe(true);
  });
  test("a real thing's archive photo needs one item (1923 banknotes without the children)", () => {
    const brief = {
      mustShow: ["German children", "bundles of worthless banknotes"],
      request: "German children with bundles of worthless banknotes in 1923",
      specific: true,
    };
    expect(gatePasses(brief, verdict(["bundles of worthless banknotes"]))).toBe(true);
  });
  test("Plan's parts lists still need one item; no items needs none", () => {
    expect(gatePasses({ mustShow: ["petals", "stamens"] }, verdict(["petals"]))).toBe(true);
    expect(gatePasses({ mustShow: [] }, verdict([]))).toBe(true);
  });
});

describe("findPicture ladder", () => {
  const signal = new AbortController().signal;
  const fakeBank = (hit?: PlacedPhoto) => {
    const calls: string[] = [];
    const bank: PictureBank = {
      lookup: async () => {
        calls.push("lookup");
        return hit;
      },
      remember: async () => {
        calls.push("remember");
      },
      generate: async (_r, faithful) => {
        calls.push(faithful ? "generate-faithful" : "generate");
        return photo("/files/bank/gen.png");
      },
    };
    return { bank, calls };
  };
  const req = (route: "real" | "generic"): BankRequest => ({
    text: "x",
    named: null,
    route,
    aspect: 1,
  });

  // FIX1 (FULL-RUN y1 s5): a generated "cow and calf" that the judge called a cat and a dog was
  // stored on generation and handed back by the library to the next lesson, unjudged.
  test("a generated picture the judge refuses leaves the library", async () => {
    const { bank, calls } = fakeBank();
    const rejected: string[] = [];
    bank.generate = async () => {
      calls.push("generate");
      return {
        ...photo(`/files/bank/gen${calls.length}.png`),
        dataUrl: "data:image/png;base64,AA==",
      };
    };
    bank.reject = async (p) => {
      rejected.push(p.src);
    };
    const out = await findPicture(
      req("generic"),
      bank,
      async () => undefined,
      signal,
      async () => false,
    );
    expect(out.photo).toBeUndefined();
    expect(rejected.length).toBe(calls.filter((c) => c === "generate").length);
    expect(rejected.length).toBeGreaterThan(0);
  });

  test("a library hit is reused: no search, no generation", async () => {
    const { bank, calls } = fakeBank(photo("/files/bank/old.jpg"));
    let searched = false;
    const out = await findPicture(
      req("real"),
      bank,
      async () => {
        searched = true;
        return undefined;
      },
      signal,
    );
    expect(out.via).toBe("library");
    expect(out.photo?.src).toBe("/files/bank/old.jpg");
    expect(searched).toBe(false);
    expect(calls).toEqual(["lookup"]);
  });
  test("a real thing is searched, and what is placed is stored once", async () => {
    const { bank, calls } = fakeBank();
    const out = await findPicture(req("real"), bank, async () => photo("/files/ws/a.jpg"), signal);
    expect(out.via).toBe("fetched");
    expect(calls).toEqual(["lookup", "remember"]);
  });
  test("a present-day real place no library had is generated faithfully", async () => {
    const { bank, calls } = fakeBank();
    const out = await findPicture(
      { ...req("real"), realFallback: "faithful" as const },
      bank,
      async () => undefined,
      signal,
    );
    expect(out.via).toBe("generated-faithful");
    expect(calls).toEqual(["lookup", "generate-faithful"]);
  });
  test("a generic scene is generated after a library miss, with no stock search", async () => {
    const { bank, calls } = fakeBank();
    let searched = false;
    const out = await findPicture(
      req("generic"),
      bank,
      async () => {
        searched = true;
        return undefined;
      },
      signal,
    );
    expect(out.via).toBe("generated");
    expect(searched).toBe(false);
    expect(calls).toEqual(["lookup", "generate"]);
  });
  test("a library that is down never generates: the stock ladder serves", async () => {
    let generated = false;
    const bank: PictureBank = {
      lookup: async () => {
        throw new Error("db down");
      },
      remember: async () => {},
      generate: async () => {
        generated = true;
        return photo("/files/bank/x.png");
      },
    };
    const out = await findPicture(
      req("generic"),
      bank,
      async () => photo("/files/ws/p.jpg"),
      signal,
    );
    expect(generated).toBe(false);
    expect(out.via).toBe("fetched");
  });
  test("a failing generator is a miss, never a throw", async () => {
    const bank: PictureBank = {
      lookup: async () => undefined,
      remember: async () => {},
      generate: async () => {
        throw new Error("500");
      },
    };
    const out = await findPicture(req("generic"), bank, async () => undefined, signal);
    expect(out.photo).toBeUndefined();
    expect(out.via).toBe("none");
  });
  test("an abort still aborts", async () => {
    const bank: PictureBank = {
      lookup: async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
      remember: async () => {},
      generate: async () => undefined,
    };
    await expect(findPicture(req("generic"), bank, async () => undefined, signal)).rejects.toThrow(
      "aborted",
    );
  });
});

describe("photoBankOn (A/B switch, default on)", () => {
  const before = process.env.PHOTO_BANK;
  afterEach(() => {
    if (before === undefined) delete process.env.PHOTO_BANK;
    else process.env.PHOTO_BANK = before;
  });
  test("on by default; PHOTO_BANK=0 turns it off; an explicit flag wins", () => {
    delete process.env.PHOTO_BANK;
    expect(photoBankOn()).toBe(true);
    process.env.PHOTO_BANK = "0";
    expect(photoBankOn()).toBe(false);
    expect(photoBankOn(true)).toBe(true);
    process.env.PHOTO_BANK = "1";
    expect(photoBankOn(false)).toBe(false);
  });
});

describe("judge fits (round 3: dog with an unrelated puppy, one cat, ice in the glass)", () => {
  test("a pick the judge says does not fit the request as a whole never passes the gate", () => {
    const brief = {
      mustShow: ["adult dog", "puppy"],
      request: "An adult dog and its puppy",
      specific: false,
    };
    const v = {
      why: null,
      pick: "1",
      onSubject: true,
      clear: true,
      fits: false,
      visible: ["adult dog", "puppy"],
      count: null,
      query: null,
    };
    expect(gatePasses(brief, v)).toBe(false);
    expect(gatePasses(brief, { ...v, fits: true })).toBe(true);
  });
});

// SOL-SIMPLE (6 Oct): library rows generated under the old counting prompt ("exactly two cats from
// above") were handed to "an adult cat beside a kitten", "a hen and a chick" and "sheep and cows"
// with no judge, because a library hit skipped the judge that a fresh picture gets.
describe("a library hit is judged like a fresh picture", () => {
  const signal = new AbortController().signal;
  const req: BankRequest = { text: "an adult cat beside a kitten", named: null, route: "generic" };
  const stored = (over: Partial<MadePicture> = {}): MadePicture => ({
    ...photo("/files/lib/bank/old.png"),
    source: { ...photo("x").source, provider: "generated" },
    dataUrl: "data:image/png;base64,AA==",
    style: "photo",
    ...over,
  });
  const bankWith = (hit: MadePicture | undefined) => {
    const calls: string[] = [];
    const rejected: string[] = [];
    const bank: PictureBank = {
      lookup: async () => {
        calls.push("lookup");
        return hit;
      },
      remember: async () => {
        calls.push("remember");
      },
      generate: async () => {
        calls.push("generate");
        return stored({ src: "/files/lib/bank/new.png" });
      },
      reject: async (p) => {
        rejected.push(p.src);
      },
    };
    return { bank, calls, rejected };
  };

  test("a hit the judge refuses for this request is marked and not placed; the ladder goes on", async () => {
    const { bank, calls, rejected } = bankWith(stored());
    const judged: string[] = [];
    const out = await findPicture(
      req,
      bank,
      async () => undefined,
      signal,
      async (p) => {
        judged.push(p.src);
        return p.src.endsWith("new.png");
      },
    );
    expect(judged[0]).toBe("/files/lib/bank/old.png");
    expect(rejected).toEqual(["/files/lib/bank/old.png"]);
    expect(out.via).toBe("generated");
    expect(out.photo?.src).toBe("/files/lib/bank/new.png");
    expect(calls).toEqual(["lookup", "generate"]);
  });

  test("a hit the judge accepts is placed from the library", async () => {
    const { bank, rejected } = bankWith(stored());
    const out = await findPicture(
      req,
      bank,
      async () => undefined,
      signal,
      async () => true,
    );
    expect(out.via).toBe("library");
    expect(rejected).toEqual([]);
  });

  test("a hit whose bytes cannot be shown to the judge is a miss, not a placement", async () => {
    const { bank, rejected } = bankWith(stored({ dataUrl: undefined }));
    const out = await findPicture(
      req,
      bank,
      async () => undefined,
      signal,
      async () => true,
    );
    expect(out.via).toBe("generated");
    expect(rejected).toEqual([]);
  });

  test("a drawn count from the library is code's own drawing: no judge", async () => {
    const { bank } = bankWith(stored({ style: "drawn", dataUrl: undefined }));
    const out = await findPicture(
      { ...req, draw: { total: 4, groups: 1, perGroup: 4, arrangement: "rows" } },
      bank,
      async () => undefined,
      signal,
      async () => false,
    );
    expect(out.via).toBe("library");
  });
});

// SOL-SIMPLE (6 Oct), ruling 163 strict: a historical request never places a photo-style
// generated picture, whichever rung it comes from.
describe("ruling 163: no photo-style generated picture for a historical request", () => {
  const signal = new AbortController().signal;
  const history: BankRequest = {
    text: "A shopper carries a basket of paper marks in 1923",
    named: "event",
    route: "real",
    period: "Germany, 1923",
    realFallback: "illustration",
    style: "illustration",
    imagePrompt: "x",
  };
  const made = (style: MadePicture["style"], src: string): MadePicture => ({
    ...photo(src),
    source: { ...photo(src).source, provider: "generated" },
    dataUrl: "data:image/png;base64,AA==",
    style,
  });
  const run = async (
    req: BankRequest,
    hit: MadePicture | undefined,
    fresh: MadePicture | undefined,
  ) => {
    const rejected: string[] = [];
    const bank: PictureBank = {
      lookup: async () => hit,
      remember: async () => {},
      generate: async () => fresh,
      reject: async (p) => {
        rejected.push(p.src);
      },
    };
    const out = await findPicture(
      req,
      bank,
      async () => undefined,
      signal,
      async () => true,
    );
    return { out, rejected };
  };
  const placedPhotoStyle = (p: MadePicture | undefined) =>
    p?.source.provider === "generated" && (p as MadePicture).style === "photo";

  test("library: a photo-style generated row is skipped, an illustration is fine", async () => {
    const a = await run(history, made("photo", "/files/b/photo.png"), undefined);
    expect(placedPhotoStyle(a.out.photo)).toBe(false);
    expect(a.out.photo).toBeUndefined();
    const b = await run(history, made(undefined, "/files/b/old.png"), undefined);
    expect(b.out.photo).toBeUndefined();
    const c = await run(history, made("illustration", "/files/b/ill.png"), undefined);
    expect(c.out.via).toBe("library");
  });

  test("fresh and fallback: a photo-style generation is refused and leaves the library", async () => {
    for (const req of [
      history,
      { ...history, route: "generic" as const, realFallback: undefined, stockFirst: true },
      { ...history, realFallback: "faithful" as const, style: undefined },
    ]) {
      const { out, rejected } = await run(req, undefined, made("photo", "/files/b/gen.png"));
      if (req.realFallback === "faithful") continue; // `labelled`: faithful is the policy's choice
      expect(placedPhotoStyle(out.photo)).toBe(false);
      expect(rejected).toContain("/files/b/gen.png");
    }
  });

  test("a historical illustration generated fresh is placed", async () => {
    const { out } = await run(history, undefined, made("illustration", "/files/b/gen.png"));
    expect(out.via).toBe("generated");
  });
});

describe("lookMatches (one locked look per lesson)", () => {
  const { lookMatches } = require("./photo-bank") as typeof import("./photo-bank");
  const made = (
    style?: "photo" | "illustration" | "drawn",
    palette?: string,
    provider = "generated",
  ) => ({ src: "/files/x", alt: "", source: { provider }, style, palette }) as never;
  const req = (style?: "illustration", palette?: string) =>
    ({ text: "a ship", named: null, route: "generic", style, palette }) as never;
  test("an illustration lesson never reuses a generated photo, nor another palette", () => {
    expect(lookMatches(req("illustration", "a b"), made("photo"))).toBe(false);
    expect(lookMatches(req("illustration", "a b"), made("illustration", "c d"))).toBe(false);
    expect(lookMatches(req("illustration", "a b"), made("illustration", "a b"))).toBe(true);
  });
  test("a photo request never reuses a generated illustration; stock and drawn always fit", () => {
    expect(lookMatches(req(), made("illustration", "a b"))).toBe(false);
    expect(lookMatches(req(), made())).toBe(true);
    expect(lookMatches(req("illustration", "a b"), made(undefined, undefined, "pexels"))).toBe(
      true,
    );
    expect(lookMatches(req("illustration", "a b"), made("drawn"))).toBe(true);
  });
});

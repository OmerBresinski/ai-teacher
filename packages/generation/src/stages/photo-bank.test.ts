import { afterEach, describe, expect, test } from "bun:test";
import { pickOrRequerySchemaFor } from "../prompts/pick-or-requery-photo";
import { gatePasses, type PlacedPhoto } from "./illustrate";
import {
  type BankRequest,
  findPicture,
  mustShowOf,
  type PictureBank,
  photoBankOn,
  routePicture,
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

describe("routePicture (ruling 158)", () => {
  test.each([
    ["An adult brown hen beside a very young yellow chick", null, "generic"],
    ["24 identical counters arranged in four equal groups of six", null, "generic"],
    ["An ice cube beside a glass of liquid water", null, "generic"],
    ["School chemistry experiment with marble chips in acid", null, "generic"],
    ["A full-grown unshorn sheep beside a small young lamb. Both stand side on.", null, "generic"],
    ["A theatre production of The Tempest showing Prospero", null, "real"],
    ["German children playing with banknotes during the hyperinflation of 1923", null, "real"],
    ["Roman soldiers in the 2nd century", null, "real"],
    ["The ruins of the north gate", "Housesteads Roman Fort", "real"],
    ["Hadrian's Wall at sunset", null, "real"],
  ] as const)("%s -> %s", (text, named, route) => {
    expect(routePicture({ text, named })).toBe(route);
  });
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
  test("a real thing no library had is generated faithfully and flagged for the look check", async () => {
    const { bank, calls } = fakeBank();
    const out = await findPicture(req("real"), bank, async () => undefined, signal);
    expect(out.via).toBe("generated-faithful");
    expect(out.lookCheck).toBe(true);
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
    expect(out.lookCheck).toBe(false);
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

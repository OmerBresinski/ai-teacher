import { describe, expect, test } from "bun:test";
import { stageReuseOk } from "../../../packages/generation/src/stages/photo-bank";
import { findDirected } from "../../../packages/generation/src/stages/picture-director";
import {
  DIRECTOR_FIXTURES,
  expectedRoutes,
} from "../../../packages/generation/src/stages/picture-director.fixtures";
import { AB_CONFIG, abStageBank, pictureVersions, setAbArm } from "./arms";

// The banked Pexels "young chicken" (row 01a117a2-b995, a grown black bird) the y1 hen request reused.
const bankedPexels = {
  src: "/files/0b0b0000-0000-4000-8000-00000000ba4c/bank/01a117a2-b995-73a3-8432-0f5162fcac87.bin",
  alt: "Close-up of a curious young black chicken with textured feathers on a vibrant green background.",
  source: { provider: "pexels", id: "36524558" },
  dataUrl: "data:image/jpeg;base64,AAAA",
};
const generated = {
  src: "/files/ws/bank/made.png",
  alt: "made",
  source: { provider: "generated" },
  dataUrl: "data:image/png;base64,AAAA",
  style: "photo",
};
const hen = (stageBank: boolean) => {
  const calls: string[] = [];
  return findDirected({
    bank: {
      lookup: async () => {
        calls.push("lookup");
        return bankedPexels as never;
      },
      remember: async () => undefined,
      generate: async (req: { stage?: boolean }) => {
        calls.push(`generate stage=${req.stage === true}`);
        return generated as never;
      },
      reject: async () => undefined,
    } as never,
    ask: { subject: "A partly grown female chicken with developing wing feathers", named: null },
    brief: { request: "partly grown hen", mustShow: [] } as never,
    slide: { heading: "Growing up" },
    lesson: { title: "Animals and their young", yearGroup: "Year 1" },
    country: "GB",
    index: 11,
    stock: async () => undefined,
    judgeMade: async () => true,
    deps: {
      logger: { info() {}, warn() {}, error() {} },
      signal: new AbortController().signal,
    } as never,
    direct: async () =>
      ({
        route: "library-or-generate",
        named: null,
        period: null,
        count: null,
        pictures: [
          {
            shows: "A partly grown hen with developing wing feathers and patches of down",
            mustShow: ["developing wing feathers", "patches of down"],
            queries: ["young hen"],
            imagePrompt: "A partly grown hen, half feathered, patches of down, short tail",
          },
        ],
      }) as never,
    stageBank,
  }).then((out) => ({ out, calls }));
};

describe("y1fix bank rule", () => {
  test("the y1 hen request never reuses the banked Pexels 'young chicken'; it is generated", async () => {
    const on = await hen(true);
    expect(on.out?.src).toBe(generated.src);
    expect(on.calls).toEqual(["lookup", "generate stage=true"]);
    // Without the rule (every other arm) the stock row is reused, as in b3-r2-1 s12.
    const off = await hen(false);
    expect(off.out?.src).toBe(bankedPexels.src);
  });
  test("a stage request reuses only a generated row made for a stage request", () => {
    expect(stageReuseOk({ stage: true }, { source: { provider: "pexels" } as never })).toBe(false);
    expect(stageReuseOk({ stage: true }, { source: { provider: "generated" } as never })).toBe(
      false,
    );
    expect(
      stageReuseOk({ stage: true }, { source: { provider: "generated" } as never, stage: true }),
    ).toBe(true);
    expect(stageReuseOk({}, { source: { provider: "pexels" } as never })).toBe(true);
  });
  test("arms: dir-stage and y1fix run director v12; y1fix carries b4-r1t3 and the bank rule", () => {
    expect(pictureVersions("dir-stage").director).toBe("picture-director.v12");
    expect(pictureVersions("y1fix").director).toBe("picture-director.v12");
    expect(pictureVersions("base4").director).toBe("picture-director.v11");
    expect(AB_CONFIG.y1fix).toMatchObject({ r1t: true, r1t2: true, r1t3: true, stageBank: true });
    setAbArm("y1fix");
    expect(abStageBank()).toBe(true);
    setAbArm("base4");
    expect(abStageBank()).toBe(false);
    setAbArm(undefined);
  });
  test("fixtures: dog/puppy and sheep/lamb expect generate under dir-stage and y1fix only", () => {
    for (const id of ["y1-animals-s1", "y1-animals-s7"]) {
      const f = DIRECTOR_FIXTURES.find((x) => x.id === id);
      if (!f) throw new Error(id);
      expect(expectedRoutes(f)).toEqual(["pexels"]);
      expect(expectedRoutes(f, "base4")).toEqual(["pexels"]);
      expect(expectedRoutes(f, "y1fix")).toEqual(["library-or-generate"]);
      expect(expectedRoutes(f, "dir-stage")).toEqual(["library-or-generate"]);
    }
  });
});

// faults-3-6-8 #6: the orphan6, match6 and stage6 rules on the real base4 cases.
import { afterEach, describe, expect, test } from "bun:test";
import { stageReuseOk } from "../../../packages/generation/src/stages/photo-bank";
import { isStageRequest } from "../../../packages/generation/src/stages/picture-director";
import { AB_CONFIG, abMatch6, abOrphan6, abStage6, setAbArm, setAbCodeArm } from "./arms";
import { isStageText, orphansAfterFit, stageReuse, unmatchedItems } from "./pics6";
import { seenOf } from "./stage2";

afterEach(() => {
  setAbCodeArm(undefined);
  setAbArm(undefined);
});

describe("switches", () => {
  test("each is off in base4 and every other arm, on only in its own", () => {
    setAbArm("base4");
    expect([abOrphan6(), abMatch6(), abStage6()]).toEqual([false, false, false]);
    for (const [a, f] of [
      ["orphan6", abOrphan6],
      ["match6", abMatch6],
      ["stage6", abStage6],
    ] as const) {
      setAbCodeArm(a);
      expect(f()).toBe(true);
      expect([abOrphan6(), abMatch6(), abStage6()].filter(Boolean)).toHaveLength(1);
    }
    for (const [a, c] of Object.entries(AB_CONFIG))
      if (!["orphan6", "match6", "stage6", "base7", "base7c", "base7d"].includes(a))
        expect(Boolean(c.orphan6 || c.match6 || c.stage6)).toBe(false);
  });
});

// base4-4 y1 s12 repair.jsonl (mode fit): the lamb question went to the notes, the picture stayed.
const R4_S12 = {
  template: "question-set",
  heading: "Help on the farm",
  questions: [
    "This female chick grows up. What will it become?",
    "Draw how the chick will look when fully grown.",
  ],
  instruction: null,
  picture: {
    shows:
      "A small fluffy female chick and a young lamb in separate farm pens, with no adult animals visible",
    must_see: ["small fluffy chick", "small young lamb", "separate farm pens"],
    subject: "generic",
  },
};
const R4_S12_MOVED = [
  "Say your ideas. Then draw.",
  "The lamb needs its mum. Which animal will you find?",
];

describe("orphan6 (a)", () => {
  test("R4 y1 s12: the lamb is orphaned once its question moves to the notes", () => {
    expect(orphansAfterFit(R4_S12, R4_S12_MOVED)).toEqual(["small young lamb"]);
  });
  test("a moved instruction that names nothing pictured orphans nothing", () => {
    expect(orphansAfterFit(R4_S12, ["Say your ideas. Then draw."])).toEqual([]);
  });
  test("a slide with no picture, or nothing moved, is left alone", () => {
    expect(orphansAfterFit({ ...R4_S12, picture: null }, R4_S12_MOVED)).toEqual([]);
    expect(orphansAfterFit(R4_S12, [])).toEqual([]);
  });
});

describe("match6 (b)", () => {
  // base4-3 y1 s3: the shipped element (lesson.json) and the writer's must_see.
  const R3_S3 = {
    alt: "A Texas Longhorn standing in a wide grassy pasture with hills in the background.",
    request:
      "Four separate adult animal photographs in reading order: cow, sheep, hen, dog. adult cow. adult sheep. adult hen. adult dog",
    source: {
      provider: "pexels",
      evidence: { visible: ["full-grown cow", "four-legged body"] },
    },
  };
  const MS = ["adult cow", "adult sheep", "adult hen", "adult dog"];
  test("R3 y1 s3: one Longhorn covers 1 of 4 things, so 3 are unmatched", () => {
    expect(unmatchedItems(MS, seenOf(R3_S3))).toEqual(["adult sheep", "adult hen", "adult dog"]);
  });
  test("a one-thing slot is never refused by this rule", () => {
    expect(unmatchedItems(["adult cow"], seenOf(R3_S3))).toEqual([]);
  });
  test("a picture that shows every thing passes", () => {
    const all = { ...R3_S3, source: { provider: "pexels", evidence: { visible: MS } } };
    expect(unmatchedItems(MS, seenOf(all))).toEqual([]);
  });
});

describe("stage6 (c)", () => {
  const plan = (text: string, mustShow: string[] = []) =>
    ({
      kind: "photo",
      request: { text, route: "generic", draw: null },
      brief: { request: text, mustShow, queries: [] },
    }) as never;
  const HEN =
    "A partly grown female chicken of a breed not shown earlier, with developing wing feathers, patches of remaining down and an immature tail";
  test("R1 y1 s12: the partly grown hen is a stage request by its words", () => {
    expect(isStageText(HEN)).toBe(true);
    expect(isStageRequest({} as never, plan(HEN), isStageText)).toBe(true);
  });
  test("so the stock 'young black chicken' bank row (01a117a2) is not reused", () => {
    expect(stageReuseOk({ stage: true }, { source: { provider: "pexels" } } as never)).toBe(false);
  });
  test("y1fix's rule is unchanged: without the words rule only the director's stage counts", () => {
    expect(isStageRequest({} as never, plan(HEN), true)).toBe(false);
    expect(isStageRequest({ stage: true } as never, plan(HEN), true)).toBe(true);
  });
  test("a request with no age, stage or sex is not a stage request", () => {
    expect(isStageText("A red tractor in a muddy field")).toBe(false);
    expect(isStageRequest({} as never, plan("A red tractor in a muddy field"), isStageText)).toBe(
      false,
    );
  });
});

describe("stage6 reuse rule, tightened 9 Oct (stageReuse)", () => {
  const stock = (alt: string) => ({ source: { provider: "pexels" }, alt });
  test("the y1 hen row: a partly grown request never reuses a 'young black chicken' caption", () => {
    expect(
      stageReuse(
        {
          text: "A partly grown female chicken of a breed not shown earlier, with developing wing feathers",
        },
        stock("Close-up of a curious young black chicken with textured feathers"),
      ),
    ).toBe(false);
  });
  test("a caption that names the same stages is reused (cow and calf, stock)", () => {
    expect(
      stageReuse(
        { text: "An adult cow standing beside a calf" },
        stock("A mother cow and her calf strolling in a lush green field on a sunny day."),
      ),
    ).toBe(true);
  });
  test("a young animal's sex is not asked of the caption; a ruled-out stage is not wanted", () => {
    expect(
      stageReuse(
        { text: "A newly hatched female chick standing alone" },
        {
          source: { provider: "generated" },
          alt: "A newly hatched chick stands with its whole small body visible",
        },
      ),
    ).toBe(true);
    expect(
      stageReuse(
        { text: "A farmyard scene with an adult cow, sheep, hen and dog, with no young animals" },
        {
          source: { provider: "generated" },
          alt: "A clear photo montage of an adult cow, sheep, hen and dog",
        },
      ),
    ).toBe(true);
  });
  test("a row made for a stage request is always reused", () => {
    expect(stageReuse({ text: "a lamb" }, { source: { provider: "generated" }, stage: true })).toBe(
      true,
    );
  });
});

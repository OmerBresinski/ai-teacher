// The writer's picture checks (BAKEOFF base4f), from lab/bakeoff/ab/pics6.test.ts and base4f.test.ts.
import { describe, expect, test } from "bun:test";
import {
  heldPhotoFills,
  namedUnmatched,
  orphansAfterFit,
  pastedPictureList,
  seenOf,
  unmatchedItems,
} from "./picture-checks";

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

describe("match6w (the y1 title photo regression)", () => {
  test("a title that names no animal keeps its photo; a slide listing four animals drops a longhorn", () => {
    const unmatched = ["adult sheep", "adult hen", "adult dog"];
    expect(
      namedUnmatched(unmatched, "Animals and their young Which animals can you name?"),
    ).toEqual([]);
    expect(
      namedUnmatched(
        ["adult cow", "adult sheep", "adult hen", "adult dog"],
        "Adult animals Say each animal's name. cow sheep hen dog",
      ),
    ).toHaveLength(4);
    // base4-4 y1 s4 "Cow and calf": an abstract must_see the judge could not tick
    expect(
      namedUnmatched(
        ["similar body shapes"],
        "Cow and calf A calf is a young cow. Say it Cow and calf.",
      ),
    ).toEqual([]);
  });
});

describe("rerouteLists (base4-4 y1 s7 Find the pairs)", () => {
  const shows =
    "Eight separate animal photographs in two rows: cow, sheep, hen and dog above; puppy, chick, calf and lamb below, with no connecting lines";
  const before = {
    questions: [
      "Find the cow’s young. Name both.",
      "Find the sheep’s young. Name both.",
      "Find the hen’s and dog’s young. Name each pair.",
    ],
  };
  test("the recorded garbled rewrite is refused", () => {
    const after = {
      questions: [
        "Find the cow’s young. Name both. Adults: cow, sheep.",
        "Find the sheep’s young. Name both. Adults: hen, dog; young: puppy, chick.",
        "Find the hen’s and dog’s young. Name each pair. Young: calf, lamb.",
      ],
    };
    expect(pastedPictureList(before, after, shows)).toContain("item 2");
  });
  test("a clean stand-alone rewrite passes", () => {
    const after = {
      questions: [
        "What is a young cow called?",
        "What is a young sheep called?",
        "Name the hen’s young and the dog’s young.",
      ],
    };
    expect(pastedPictureList(before, after, shows)).toBeUndefined();
  });
});

describe("keepPic fills only an empty slide (D48b, p123-2 y1 s6)", () => {
  const findPairs = { template: "visual-text", heading: "Find the pairs", picture: null };
  test("y1 r2 s6: the reroute drew a word table diagram, so the held cow photo is not used", () => {
    expect(heldPhotoFills(findPairs, ["diagram"])).toBe(false);
  });
  test("a slide that carries a table keeps it", () => {
    expect(heldPhotoFills({ ...findPairs, table: { rows: [["Cow", "Calf"]] } }, ["failed"])).toBe(
      false,
    );
  });
  test("a slide left with no visual gets the held photo", () => {
    expect(heldPhotoFills(findPairs, ["failed"])).toBe(true);
    expect(heldPhotoFills(findPairs, [])).toBe(true);
  });
});

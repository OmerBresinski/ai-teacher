import { describe, expect, test } from "bun:test";
import { applyStage2, covers, restageLayoutOnly } from "./stage2";

const it = (text: string, needs_picture = true) => ({ text, needs_picture });
const tile = (shows: string, must_see: string[]) => ({ shows, must_see, subject: "generic" });
const lesson = (
  slides: Record<string, unknown>[],
  flow: { slide: number; teaches: number[] }[] = [],
) => ({
  title: {
    template: "title",
    heading: "Animals and their young",
    lead: it("Name this animal."),
    picture: tile("an adult cow", ["adult cow"]),
  },
  slides,
  flow,
});

describe("R1 stage 2", () => {
  test("covers: every must_see thing among what the judge saw", () => {
    expect(covers(["small fluffy chick", "adult hen"], ["chick", "hens"])).toBe(true);
    expect(covers(["adult cow", "young calf"], ["cow", "grass"])).toBe(false);
  });
  test("ROUND5 y1: 'name its adult' with only young tiles is dropped, and an empty check slide is removed", () => {
    const l = lesson(
      [
        {
          template: "visual-text",
          heading: "Hens",
          lead: null,
          points: [],
          figure: tile("an adult hen", ["adult hen"]),
        },
        {
          template: "practice",
          heading: "Grow up",
          questions: [it("Name this young animal and its adult.")],
          instruction: it("Look and explain."),
          pictures: [
            tile("a lamb on straw", ["young lamb", "straw bedding"]),
            tile("a chick", ["small chick", "dark fluffy down"]),
          ],
        },
      ],
      [
        { slide: 4, teaches: [1] },
        { slide: 3, teaches: [2] },
      ],
    );
    const r = applyStage2(l, () => true, 2);
    expect(r.dropped.map((d) => d.text)).toContain("Name this young animal and its adult.");
    expect(r.removed).toEqual([4]);
    expect(r.unchecked).toEqual([1]);
  });
  test("a tile the judge did not confirm drops the slide's needs_picture items, never its other words", () => {
    const l = lesson([
      {
        template: "question-set",
        heading: "Match",
        questions: [it("Match each adult to its young."), it("What do all animals need?", false)],
        instruction: it("Point and say."),
        pictures: [tile("a cow", ["adult cow"]), tile("a calf", ["young calf"])],
      },
    ]);
    const r = applyStage2(l, (s, k) => !(s === 3 && k === 1));
    expect(r.slides[0]?.questions).toEqual([it("What do all animals need?", false)]);
    expect(r.slides[0]?.instruction).toBeNull();
    expect(r.removed).toEqual([]);
  });
  test("all tiles shown and named: everything kept; title lead dropped when its picture is not shown", () => {
    const l = lesson([
      {
        template: "practice",
        heading: "Pairs",
        questions: [it("Name the adult and its young in each picture.")],
        instruction: null,
        pictures: [tile("a calf beside a cow", ["young calf", "adult cow"])],
      },
    ]);
    expect(applyStage2(l, () => true).dropped).toEqual([]);
    const r = applyStage2(l, (s) => s !== 1);
    expect(r.dropped.map((d) => d.field)).toEqual(["lead"]);
  });
  test("a discussion whose question needed an unshown picture is removed", () => {
    const l = lesson([
      {
        template: "discussion",
        heading: "Talk",
        lead: it("How will this chick change?"),
        picture: tile("a chick", ["chick"]),
      },
    ]);
    expect(applyStage2(l, (s) => s !== 3).removed).toEqual([3]);
  });
  test("restage is layout only", () => {
    const before = {
      template: "question-set",
      heading: "H",
      questions: ["Q1"],
      instruction: "Do it.",
      picture: { shows: "x" },
    };
    const after = {
      template: "explain",
      heading: "New H",
      lead: "Rewritten",
      points: ["P"],
      picture: null,
    };
    const out = restageLayoutOnly(before, after);
    expect(out).toMatchObject({
      template: "question-set",
      heading: "H",
      questions: ["Q1"],
      instruction: "Do it.",
      picture: null,
    });
  });
});

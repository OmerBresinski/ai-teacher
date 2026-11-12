import { describe, expect, test } from "bun:test";
import { claimItems, directedGatePasses, failedChecks } from "./illustrate";

/*
 * 11 Nov blind review (CRITIQUE-1 item 2): y2 Great Fire slide 9, heading "Water buckets", lead
 * "People passed buckets of water to throw on flames.", got a crop of the title painting. The
 * recorded judge verdict (genlab 20261111-231834-record-e2e-y2-greatfire, cassette 0227) and the
 * slide's brief are below word for word: the brief is `specific` (a named event), so one item in
 * view was enough, and "burning building" is not what the slide says.
 */
const brief = {
  request:
    "People pass water-filled buckets towards a burning building during the Great Fire of London.",
  mustShow: ["people passing buckets", "water-filled buckets", "burning building"],
  specific: true,
};
const verdict0227 = {
  pick: "commons-51034772",
  onSubject: true,
  kindMatches: null,
  clear: true,
  fits: true,
  why: "The painting shows buildings burning during the Great Fire of London, though it does not show people passing buckets.",
  visible: ["burning building"],
  count: "several",
  query: null,
} as never;
const claim = {
  words: "Water buckets. People passed buckets of water to throw on flames.",
  lessonTitle: "The Great Fire of London",
};

describe("a searched picture is checked against this slide's claim", () => {
  test("the claim's items are the ones its heading and lead name, not the lesson topic", () => {
    expect(claimItems(brief.mustShow, claim)).toEqual([
      "people passing buckets",
      "water-filled buckets",
    ]);
    // Words of the lesson title ("fire", "london") never make an item the claim's.
    expect(
      claimItems(["Great Fire of London"], {
        words: "The fire spread",
        lessonTitle: "The Great Fire of London",
      }),
    ).toEqual([]);
  });

  test("the recorded y2 s9 verdict is refused; without the claim it passed as before", () => {
    expect(directedGatePasses(brief, verdict0227)).toBe(true);
    expect(directedGatePasses(brief, verdict0227, claim)).toBe(false);
    expect(failedChecks(brief, verdict0227, claim)).toEqual(["items-missing"]);
  });

  test("a picture showing the buckets passes", () => {
    const seen = {
      ...(verdict0227 as object),
      visible: ["people passing buckets", "burning building"],
    } as never;
    expect(directedGatePasses(brief, seen, claim)).toBe(true);
  });

  test("no item names the claim: the gate is as it was", () => {
    const other = {
      words: "Where it began. It started in a bakery.",
      lessonTitle: "The Great Fire of London",
    };
    expect(directedGatePasses(brief, verdict0227, other)).toBe(true);
  });
});

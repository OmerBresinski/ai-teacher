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
    // Judge v21: the recorded answer has no `showsNeeds`, so it is refused on that alone.
    expect(directedGatePasses(brief, verdict0227)).toBe(false);
    const said = { ...(verdict0227 as object), showsNeeds: true } as never;
    expect(directedGatePasses(brief, said)).toBe(true);
    expect(directedGatePasses(brief, said, claim)).toBe(false);
    expect(failedChecks(brief, said, claim)).toEqual(["items-missing"]);
    expect(failedChecks(brief, verdict0227, claim)).toEqual(["items-missing"]);
  });

  test("a picture showing the buckets passes", () => {
    const seen = {
      ...(verdict0227 as object),
      visible: ["people passing buckets", "burning building"],
      showsNeeds: true,
    } as never;
    expect(directedGatePasses(brief, seen, claim)).toBe(true);
  });

  test("no item names the claim: the gate is as it was", () => {
    const other = {
      words: "Where it began. It started in a bakery.",
      lessonTitle: "The Great Fire of London",
    };
    expect(
      directedGatePasses(brief, { ...(verdict0227 as object), showsNeeds: true } as never, other),
    ).toBe(true);
  });
});

/*
 * Judge v21 (12 Nov): the judge writes what the slide's words need and whether the picture shows
 * it. Recorded answers (genlab 20261111-23*-record-e2e-*) that passed with every item in view:
 * y2 s10 cassette 0186 (a print of ruins for "Making a firebreak"), y8 s8 cassette 0062 (a human
 * respiration painting on "How plants use glucose"). Each is refused unless `showsNeeds` is true.
 */
describe("judge v21: showsNeeds gates every pick", () => {
  const firebreak = {
    request: "A painted reconstruction of a firebreak during the Great Fire of London.",
    mustShow: ["clear gap between houses", "demolished house remains", "flames beside gap"],
    specific: true,
  };
  const v0186 = {
    pick: "commons-69561453",
    onSubject: true,
    kindMatches: null,
    clear: true,
    fits: true,
    why: "The historical reconstruction shows a gap between ruined houses, with rubble and flames beside it.",
    visible: ["clear gap between houses", "demolished house remains", "flames beside gap"],
    count: "one",
    query: null,
  };
  const respiration = {
    request:
      "Respiration: Glucose is used in respiration to release energy. Respiration (How plants use glucose)",
    mustShow: ["Respiration"],
    specific: false,
  };
  const v0062 = {
    pick: "made",
    onSubject: true,
    kindMatches: null,
    clear: true,
    fits: true,
    why: "The painting shows a glucose molecule entering a mitochondrion, with arrows indicating energy released, which depicts respiration.",
    visible: ["Respiration"],
    count: "one",
    query: null,
  };

  test("a recorded answer with every item seen is refused without showsNeeds, placed with it", () => {
    for (const [b, v] of [
      [firebreak, v0186],
      [respiration, v0062],
    ] as const) {
      expect(directedGatePasses(b, v as never)).toBe(false);
      expect(failedChecks(b, v as never)).toEqual(["items-missing"]);
      expect(directedGatePasses(b, { ...v, showsNeeds: true } as never)).toBe(true);
    }
  });

  test("showsNeeds false refuses even when fits is true", () => {
    const v = { ...v0062, showsNeeds: false, seen: "a girl eating an apple; a stomach" };
    expect(directedGatePasses(respiration, v as never)).toBe(false);
  });

  test("a requery (no pick) reports no items-missing for showsNeeds", () => {
    const v = { ...v0062, pick: null, fits: false, visible: [] };
    expect(failedChecks({ ...respiration, mustShow: [] }, v as never)).toEqual([
      "no-pick",
      "misfit",
    ]);
  });
});

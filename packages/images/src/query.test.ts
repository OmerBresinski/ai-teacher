import { describe, expect, test } from "bun:test";
import { anchorQueries, queryCandidates } from "./query";

describe("queryCandidates", () => {
  test("three content words, then the drop-a-word retry", () => {
    expect(queryCandidates({ subject: "The River Severn at dawn" })).toEqual([
      "river severn dawn",
      "river severn",
    ]);
  });

  test("a single word has no retry", () => {
    expect(queryCandidates({ subject: "Leaf" })).toEqual(["leaf"]);
  });

  test("stop words go, order stays, British spellings untouched", () => {
    expect(queryCandidates({ subject: "A hare in the snow" })).toEqual(["hare snow", "hare"]);
    expect(queryCandidates({ subject: "Colourful hot-air balloon" })).toEqual([
      "colourful hot air",
      "colourful hot",
    ]);
  });

  test("two words retry with one", () => {
    expect(queryCandidates({ subject: "Oak tree" })).toEqual(["oak tree", "oak"]);
  });

  test("a subject of only stop words falls back to the raw subject", () => {
    expect(queryCandidates({ subject: "The" })).toEqual(["The"]);
    expect(queryCandidates({ subject: "   " })).toEqual([]);
  });
});

describe("anchorQueries (PHOTO-BANK round 2)", () => {
  test("a year with the event word before it", () => {
    expect(
      anchorQueries(
        "German children playing with bundles of worthless banknotes during the hyperinflation crisis of 1923",
      ),
    ).toEqual(["hyperinflation 1923"]);
  });
  test("two proper names together", () => {
    expect(
      anchorQueries(
        "A theatre production of The Tempest showing Prospero holding a staff, with Ariel",
      ),
    ).toEqual(["Tempest Prospero"]);
  });
  test("a generic scene has no anchors", () => {
    expect(anchorQueries("An adult dog and its puppy sitting side by side")).toEqual([]);
  });
});

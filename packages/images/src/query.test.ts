import { describe, expect, test } from "bun:test";
import { queryCandidates } from "./query";

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

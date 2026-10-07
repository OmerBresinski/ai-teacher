import { describe, expect, test } from "bun:test";
import { isHistoricalSet, isSameSubjectSet, setImagePrompt, setSize } from "./picture-set";

describe("same-subject sets", () => {
  test("a sequence is always a set; compare cards only of one thing", () => {
    expect(
      isSameSubjectSet(["A newly hatched chick", "A growing young chicken", "An adult hen"], true),
    ).toBe(true);
    expect(
      isSameSubjectSet(["A young puppy standing side-on", "An older puppy of the same breed"]),
    ).toBe(true);
    expect(
      isSameSubjectSet(["A clear solution in a conical flask", "The flask with a cloudy mixture"]),
    ).toBe(true);
    expect(
      isSameSubjectSet(["An adult sheep beside a young lamb", "An adult cow beside a young calf"]),
    ).toBe(false);
    expect(isSameSubjectSet(["A frog", "A butterfly"])).toBe(false);
    expect(isSameSubjectSet(["A frog"], true)).toBe(false);
  });
  test("one strip prompt carries every panel in order and the same-subject frame", () => {
    const p = setImagePrompt(["A puppy.", "A young dog", "An adult dog"]);
    expect(p).toContain("3 equal side-by-side panels");
    expect(p).toContain("(1) A puppy; (2) A young dog; (3) An adult dog.");
    expect(p).toContain("very same individual subject");
    expect(setSize(3)).toBe("2048x1152");
    expect(setSize(2)).toBe("1536x1024");
  });
  test("an illustration lesson's locked look leads the strip", () => {
    const p = setImagePrompt(["A chick", "A hen"], { style: "illustration", palette: ["#111111"] });
    expect(p.split("\n")[0]).toContain("illustration");
    expect(p).toContain("#111111");
  });
});

describe("sets are about any subject, never real time", () => {
  test("non-animal sets group by their shared subject", () => {
    expect(
      isSameSubjectSet([
        "An ice cube on a plate",
        "A melting ice cube",
        "A small puddle where the ice cube was",
      ]),
    ).toBe(true);
    expect(
      isSameSubjectSet(["A shiny new iron nail", "The nail starting to rust", "A rusty iron nail"]),
    ).toBe(true);
    expect(
      isSameSubjectSet(["A tall candle", "The candle half burnt", "A short candle stub"]),
    ).toBe(true);
    expect(isSameSubjectSet(["A bean seed in soil", "A bean seedling", "A tall bean plant"])).toBe(
      true,
    );
  });
  test("change across real time is not a generated set (ruling 163)", () => {
    expect(isHistoricalSet(["The high street in 1900", "The same street in 2000"])).toBe(true);
    expect(isHistoricalSet(["A village a century ago", "The village today"])).toBe(true);
    expect(isHistoricalSet(["An ice cube", "A melting ice cube"])).toBe(false);
  });
  test("the frame names no animal words", () => {
    expect(setImagePrompt(["A", "B"])).not.toMatch(/breed|animal|fur|feather/i);
  });
});

describe("a solo panel is one picture, not a 1-panel strip (round 5)", () => {
  test("no gutter or panel layout wording for one panel", () => {
    const p = setImagePrompt(["A hen beside a chick"]);
    expect(p).not.toMatch(/side-by-side|gaps|Left to right/);
    expect(p).toContain("not divided into panels");
    expect(setSize(1)).toBe("1024x1024");
  });
});

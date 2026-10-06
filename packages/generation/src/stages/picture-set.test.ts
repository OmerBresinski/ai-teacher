import { describe, expect, test } from "bun:test";
import { isSameSubjectSet, setImagePrompt, setSize } from "./picture-set";

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

import { describe, expect, test } from "bun:test";
import { cascadeToast, slideList } from "./use-proposal-jobs";

describe("proposal toast copy", () => {
  test("slideList reads as a sentence", () => {
    expect(slideList([4])).toBe("slide 4");
    expect(slideList([3, 5])).toBe("slides 3 and 5");
    expect(slideList([2, 3, 5])).toBe("slides 2, 3 and 5");
    expect(slideList([])).toBe("no slides");
  });

  test("cascadeToast names slides, the worksheet and the flagged count", () => {
    expect(cascadeToast([3, 5], 0)).toBe("Auto changed on slides 3 and 5 to match");
    expect(cascadeToast([2], 1)).toBe("Auto changed on slide 2 to match · 1 needs your OK");
    expect(cascadeToast([2], 2)).toBe("Auto changed on slide 2 to match · 2 need your OK");
    expect(cascadeToast([2], 0, true)).toBe("Auto changed on slide 2 and the worksheet to match");
    expect(cascadeToast([], 0, true)).toBe("Auto changed the worksheet to match");
    expect(cascadeToast([], 1)).toBe("Nothing on the slides needed changing · 1 needs your OK");
  });
});

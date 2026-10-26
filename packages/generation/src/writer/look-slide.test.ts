import { describe, expect, test } from "bun:test";
import { lookForSlide, withLook } from "./fixes";

/*
 * genlab Y1 plants (26 Oct): the writer wrote 11 slides and its close against a 13-slide flow, so
 * flow entry 12 (a practice slide's picture) was read for slide 12, the exit ticket. The picture
 * was generated (31 s, $0.0063) and never shown: the exit ticket's layout has no room for it.
 */
const practice = {
  slide: 12,
  does: "pupils apply ideas",
  layout: "practice",
  look_at: { kind: "picture", shows: "seedling and flowering plant in rain" },
};

describe("a flow entry's look reaches only the slide it plans", () => {
  test("another template's entry gives no look, so no picture is asked", () => {
    const exit = { template: "exit-ticket", heading: "Show what you know", items: [] };
    expect(lookForSlide(practice, exit)).toBeUndefined();
    expect(withLook(exit, lookForSlide(practice, exit)).how).toBeUndefined();
  });

  test("the planned template keeps its look, with or without a fit", () => {
    const own = { template: "practice", heading: "Try it", items: [] };
    expect(lookForSlide(practice, own)).toEqual({
      kind: "picture",
      shows: "seedling and flowering plant in rain",
    });
    expect(withLook(own, lookForSlide(practice, own)).how).toBe("figure-from-look");
    const fitted = { ...practice, layout: "visual-text points-0-fig" };
    expect(lookForSlide(fitted, { template: "visual-text" })?.kind).toBe("picture");
  });

  test("an entry with no layout behaves as before", () => {
    const { layout: _, ...bare } = practice;
    expect(lookForSlide(bare, { template: "exit-ticket" })?.kind).toBe("picture");
  });
});

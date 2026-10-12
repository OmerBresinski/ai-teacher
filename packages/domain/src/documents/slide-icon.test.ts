import { describe, expect, test } from "bun:test";
import { SlideElementSchema } from "./slide";

// TEACH-310 part b: an icon element may carry a library concept id beside its lucide name.
describe("IconElement.concept", () => {
  const base = { id: "i", type: "icon", icon: "sparkles", x: 0, y: 0, w: 40, h: 40 } as const;

  test("an old icon element with no concept parses unchanged", () => {
    expect(SlideElementSchema.parse(base)).toEqual(base);
  });

  test("a concept id is kept", () => {
    const el = { ...base, concept: "canopic-jar" };
    expect(SlideElementSchema.parse(el)).toEqual(el);
  });

  test("a non-string concept is refused", () => {
    expect(SlideElementSchema.safeParse({ ...base, concept: 3 }).success).toBe(false);
  });
});

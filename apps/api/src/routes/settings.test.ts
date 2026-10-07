import { describe, expect, test } from "bun:test";
import { CountryHintSchema, countryFromHint } from "./settings";

describe("country hint (TEACH-33 part b)", () => {
  test.each([
    ["IN", "india"],
    ["nz", "new-zealand"],
    ["GB-SCT", "scotland"],
    ["GB-WLS", "wales"],
    ["GB", "england"],
    ["FR", "england"],
  ] as const)("%s → %s", (hint, expected) => {
    expect(CountryHintSchema.safeParse({ hint }).success).toBe(true);
    expect(countryFromHint(hint)).toBe(expected);
  });

  test.each([["", "India", "I", "<script>", "IN-TOOLONG", "203.0.113.9"]].flat())(
    "a malformed hint %p is refused",
    (hint) => {
      expect(CountryHintSchema.safeParse({ hint }).success).toBe(false);
    },
  );

  test("no hint, or anything beside it, is refused", () => {
    expect(CountryHintSchema.safeParse({}).success).toBe(false);
    expect(CountryHintSchema.safeParse({ hint: "IN", ip: "203.0.113.9" }).success).toBe(false);
  });
});

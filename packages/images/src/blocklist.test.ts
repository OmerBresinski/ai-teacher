import { describe, expect, test } from "bun:test";
import { isBlockedQuery, QUERY_BLOCKLIST } from "./blocklist";

describe("isBlockedQuery", () => {
  test("a blocklisted word alone, in a phrase, cased or punctuated", () => {
    expect(isBlockedQuery("gore")).toBe(true);
    expect(isBlockedQuery("pictures of GORE!")).toBe(true);
    expect(isBlockedQuery("Torture, medieval")).toBe(true);
  });

  test("substrings of harmless words do not hit", () => {
    expect(isBlockedQuery("bass")).toBe(false);
    expect(isBlockedQuery("liturgical music")).toBe(false);
    expect(isBlockedQuery("river")).toBe(false);
    expect(isBlockedQuery("")).toBe(false);
  });

  test("the list stays short and lower-case", () => {
    expect(QUERY_BLOCKLIST.length).toBeLessThanOrEqual(20);
    for (const term of QUERY_BLOCKLIST) {
      expect(term).toBe(term.toLowerCase());
    }
  });
});

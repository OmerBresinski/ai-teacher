import { describe, expect, test } from "bun:test";
import { buildGreetingPrompt, firstNameOf, sanitiseGreeting } from "./prompt";

describe("greeting prompt", () => {
  test("uses the first non-empty name token", () => {
    expect(firstNameOf(" Ada  Lovelace ")).toBe("Ada");
    expect(firstNameOf(null)).toBeUndefined();
    expect(firstNameOf("x".repeat(41))).toBeUndefined();
  });

  test("does not invent a name", () => {
    expect(buildGreetingPrompt({})).toContain("No name is available");
  });

  test("sanitises model output", () => {
    expect(sanitiseGreeting('  "Hello there!"  ')).toBe("Hello there.");
    expect(sanitiseGreeting("Hello there!!!")).toBe("Hello there.");
    expect(sanitiseGreeting("Hello\n\nthere")).toBe("Hello there");
    expect(sanitiseGreeting("   ")).toBeUndefined();
  });

  test("keeps a complete sentence when shortening output", () => {
    const firstSentence = `${"a".repeat(100)}.`;
    expect(sanitiseGreeting(`${firstSentence} ${"b".repeat(200)}`)).toBe(firstSentence);
  });
});

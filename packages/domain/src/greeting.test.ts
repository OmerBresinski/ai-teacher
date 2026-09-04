import { describe, expect, test } from "bun:test";
import { FALLBACK_GREETING, GreetingResponseSchema } from "./greeting";

describe("Greeting schemas", () => {
  test("accepts a model greeting", () => {
    expect(GreetingResponseSchema.safeParse({ text: "x", source: "model" }).success).toBe(true);
  });

  test("rejects empty greeting text", () => {
    expect(GreetingResponseSchema.safeParse({ text: "", source: "model" }).success).toBe(false);
  });

  test("rejects an unknown source", () => {
    expect(GreetingResponseSchema.safeParse({ text: "x", source: "cached" }).success).toBe(false);
  });

  test("the fallback itself is a valid greeting", () => {
    expect(
      GreetingResponseSchema.safeParse({ text: FALLBACK_GREETING, source: "fallback" }).success,
    ).toBe(true);
  });
});

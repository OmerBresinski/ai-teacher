import { describe, expect, test } from "bun:test";
import {
  safeFrames,
  safeMessage,
  sanitizeError,
  scrubSecrets,
  UNRECOGNISED_MESSAGE,
} from "./scrub";

class StageFailure extends Error {
  override readonly name = "StageFailure";
}

describe("scrubSecrets", () => {
  test("drops URL credentials, queries and fragments but keeps host and path", () => {
    expect(scrubSecrets("GET https://user:pw@api.example.com/v1/x?token=abc#frag done")).toBe(
      "GET https://api.example.com/v1/x done",
    );
    expect(scrubSecrets("postgres://postgres:hunter2@db.internal:5432/tj")).toBe(
      "postgres://db.internal:5432/tj",
    );
  });

  test("redacts keys, bearer tokens and long opaque strings", () => {
    expect(scrubSecrets("key phc_AbCdEf123456 used")).toBe("key [redacted-key] used");
    expect(scrubSecrets("Authorization: Bearer eyJhbGciOi.x.y")).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(scrubSecrets("aws AKIAABCDEFGHIJKLMNOP")).toBe("aws [redacted-key]");
    expect(scrubSecrets("api_key=xyz&b=1")).toBe("api_key=[redacted]&b=1");
    expect(scrubSecrets(`sig ${"a1".repeat(20)}`)).toBe("sig [redacted]");
  });

  test("caps the length", () => {
    expect(scrubSecrets("word ".repeat(200)).length).toBeLessThanOrEqual(301);
  });
});

describe("safeMessage", () => {
  test("keeps our own error classes' messages", () => {
    expect(safeMessage(new StageFailure("The writer stopped at its token cap."))).toBe(
      "The writer stopped at its token cap.",
    );
  });

  test("never sends a foreign message", () => {
    expect(safeMessage(new Error("model said: secret lesson text"))).toBe(UNRECOGNISED_MESSAGE);
    expect(safeMessage(new SyntaxError("Unexpected token 'V'"))).toBe(UNRECOGNISED_MESSAGE);
    expect(safeMessage("a thrown string")).toBe(UNRECOGNISED_MESSAGE);
  });

  test("keeps a code fault only in a known engine template", () => {
    let fault: unknown;
    try {
      (undefined as unknown as { x: number }).x;
    } catch (e) {
      fault = e;
    }
    expect(safeMessage(fault)).not.toBe("");
  });
});

describe("sanitizeError", () => {
  test("keeps the frames, drops a multi-line message from the stack", () => {
    const original = new Error("line one\n    at fake (packages/evil/leak.ts:1:1)\nlesson text");
    const clean = sanitizeError(original);
    expect(clean.name).toBe("Error");
    expect(clean.message).toBe(UNRECOGNISED_MESSAGE);
    expect(clean.stack).not.toContain("lesson text");
    expect(clean.stack).not.toContain("leak.ts");
    expect(safeFrames(original).length).toBeGreaterThan(0);
    expect(clean.stack?.split("\n").length).toBeGreaterThan(1);
  });

  test("sanitizes the cause chain", () => {
    const inner = new Error("provider body: lesson text");
    const outer = new StageFailure("Generate failed.", { cause: inner });
    const clean = sanitizeError(outer);
    expect(clean.message).toBe("Generate failed.");
    const cause = clean.cause as Error;
    expect(cause.message).toBe(UNRECOGNISED_MESSAGE);
    expect(cause.stack).not.toContain("lesson text");
  });
});

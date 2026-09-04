import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import pino from "pino";
import { AiError, isAiError, ProviderFailure, toProviderError } from "./errors";

/** Shaped like the AI SDK's APICallError: content-bearing enumerable fields. */
class FakeApiCallError extends Error {
  override readonly name = "AI_APICallError";
  readonly statusCode = 400;
  readonly isRetryable = false;
  readonly requestBodyValues = { messages: [{ content: "private prompt text" }] };
  readonly responseBody = '{"message":"private response body"}';
}

describe("toProviderError", () => {
  test("wraps unknown failures with a content-free cause", () => {
    const wrapped = toProviderError(new FakeApiCallError("model call rejected"));
    expect(isAiError(wrapped, "provider")).toBe(true);
    expect(wrapped.cause).toBeInstanceOf(ProviderFailure);
    expect(wrapped.cause).toMatchObject({
      name: "AI_APICallError",
      message: "model call rejected",
      statusCode: 400,
      isRetryable: false,
    });
    expect(wrapped.cause).not.toHaveProperty("requestBodyValues");
  });

  test("returns AiError instances unchanged", () => {
    const original = new AiError("invalid_model", "nope");
    expect(toProviderError(original)).toBe(original);
  });

  test("a pino err log of the wrapped error contains no request or response content", () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "info" },
      new Writable({
        write(chunk, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      }),
    );
    logger.warn({ err: toProviderError(new FakeApiCallError("model call rejected")) }, "failed");
    const serialized = lines.join("");
    expect(serialized).toContain("AI_APICallError");
    expect(serialized).not.toContain("private prompt text");
    expect(serialized).not.toContain("private response body");
    expect(serialized).not.toContain("requestBodyValues");
  });

  test("truncates long cause messages", () => {
    const wrapped = toProviderError(new Error("x".repeat(500)));
    expect((wrapped.cause as { message: string }).message).toHaveLength(200);
  });
});

import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { APICallError } from "ai";
import pino from "pino";
import {
  AiError,
  isAiError,
  PROVIDER_FAILURE_MESSAGE,
  ProviderFailure,
  providerErrorDetail,
  sanitizeProviderMessage,
  toProviderError,
} from "./errors";

/** Shaped like the AI SDK's APICallError: content-bearing enumerable fields. */
class FakeApiCallError extends Error {
  override readonly name = "AI_APICallError";
  readonly statusCode = 400;
  readonly isRetryable = false;
  readonly requestBodyValues = { messages: [{ content: "private prompt text" }] };
  readonly responseBody = '{"message":"private response body"}';
}

describe("toProviderError", () => {
  test.each(["flagged as potentially violating our usage policy", "CONTENT FILTER blocked it"])(
    "classifies a Bedrock 400 moderation refusal: %s",
    (message) => {
      const wrapped = toProviderError(
        new FakeApiCallError(`validation_error: ${message}; private prompt text`),
      );
      expect(isAiError(wrapped, "moderated")).toBe(true);
      expect(wrapped.cause).toMatchObject({ statusCode: 400, isRetryable: false });
      expect(String(wrapped)).not.toContain("private");
      expect(String(wrapped.cause)).not.toContain("private");
      expect(wrapped.cause).not.toHaveProperty("responseBody");
    },
  );

  test("a policy phrase without HTTP 400 remains an ordinary provider error", () => {
    expect(
      toProviderError(Object.assign(new Error("usage policy"), { statusCode: 500 })).code,
    ).toBe("provider");
    expect(toProviderError(new Error("content filter")).code).toBe("provider");
  });

  test("wraps unknown failures with a content-free cause", () => {
    const wrapped = toProviderError(new FakeApiCallError("model call rejected"));
    expect(isAiError(wrapped, "provider")).toBe(true);
    expect(wrapped.cause).toBeInstanceOf(ProviderFailure);
    expect(wrapped.cause).toMatchObject({
      name: "AI_APICallError",
      message: PROVIDER_FAILURE_MESSAGE,
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
    logger.warn({ err: toProviderError(new FakeApiCallError("private prompt text")) }, "failed");
    const serialized = lines.join("");
    expect(serialized).toContain("AI_APICallError");
    expect(serialized).not.toContain("private prompt text");
    expect(serialized).not.toContain("private response body");
    expect(serialized).not.toContain("requestBodyValues");
  });

  test("replaces cause messages rather than truncating private content", () => {
    const wrapped = toProviderError(new Error("x".repeat(500)));
    expect((wrapped.cause as { message: string }).message).toBe(PROVIDER_FAILURE_MESSAGE);
  });
});

/** An OpenAI chat failure as the AI SDK raises it: message from the body, body kept verbatim. */
function openAiError(statusCode: number, error: Record<string, unknown>, isRetryable: boolean) {
  return new APICallError({
    message: String(error.message),
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: { messages: [{ role: "user", content: "PROMPT-SENTINEL" }] },
    statusCode,
    responseHeaders: { "x-request-id": "req_1", authorization: "Bearer sk-header-secret" },
    responseBody: JSON.stringify({ error }),
    isRetryable,
  });
}

describe("provider error detail (an invalid key is told apart from an outage)", () => {
  test("401 invalid_api_key: status, code, not retryable, the echoed key redacted", () => {
    const wrapped = toProviderError(
      openAiError(
        401,
        {
          message:
            "Incorrect API key provided: sk-proj-AbCdEf123456*****************wxyz. You can find your API key at https://platform.openai.com/account/api-keys.",
          type: "invalid_request_error",
          param: null,
          code: "invalid_api_key",
        },
        false,
      ),
    );
    const detail = providerErrorDetail(wrapped);
    expect(detail).toMatchObject({
      statusCode: 401,
      isRetryable: false,
      providerErrorCode: "invalid_api_key",
      providerCode: "invalid_api_key",
    });
    expect(detail?.providerMessage).toStartWith("Incorrect API key provided: [redacted]");
    const everything = JSON.stringify(detail) + JSON.stringify(wrapped.cause);
    expect(everything).not.toContain("sk-proj");
    expect(everything).not.toContain("AbCdEf123456");
    expect(everything).not.toContain("wxyz");
    expect(everything).not.toContain("PROMPT-SENTINEL");
    expect(everything).not.toContain("sk-header-secret");
  });

  test("429 insufficient_quota and 429 rate limit are told apart, both enums", () => {
    const quota = providerErrorDetail(
      toProviderError(
        openAiError(
          429,
          {
            message: "You exceeded your current quota, please check your plan and billing details.",
            type: "insufficient_quota",
            code: "insufficient_quota",
          },
          true,
        ),
      ),
    );
    expect(quota).toMatchObject({
      statusCode: 429,
      isRetryable: true,
      providerErrorCode: "insufficient_quota",
    });
    const limited = providerErrorDetail(
      toProviderError(
        openAiError(
          429,
          {
            message: "Rate limit reached for gpt-6-luna on tokens per min (TPM).",
            type: "tokens",
            code: "rate_limit_exceeded",
          },
          true,
        ),
      ),
    );
    expect(limited).toMatchObject({
      statusCode: 429,
      isRetryable: true,
      providerErrorCode: "rate_limited",
      providerCode: "rate_limit_exceeded",
      providerMessage: "Rate limit reached for gpt-6-luna on tokens per min (TPM).",
    });
  });

  test("500 server error is retryable and classified as an outage", () => {
    const detail = providerErrorDetail(
      toProviderError(
        openAiError(
          500,
          {
            message: "The server had an error while processing your request.",
            type: "server_error",
          },
          true,
        ),
      ),
    );
    expect(detail).toMatchObject({
      statusCode: 500,
      isRetryable: true,
      providerErrorCode: "server_error",
      providerCode: "server_error",
      providerMessage: "The server had an error while processing your request.",
    });
  });

  test("a key, bearer token or AWS key id anywhere in a message is redacted, and it is capped", () => {
    const out = sanitizeProviderMessage(
      `bad key sk-abc123XYZ and Bearer eyJhbGciOi.abc AKIAIOSFODNN7EXAMPLE api_key=hunter2 ${"x ".repeat(400)}`,
    );
    expect(out).not.toContain("sk-abc");
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("hunter2");
    expect(out.length).toBeLessThanOrEqual(300);
  });

  test("the message is non-enumerable: a pino err log never prints it", () => {
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
    const wrapped = toProviderError(
      openAiError(
        400,
        { message: "PROVIDER-MESSAGE-SENTINEL", code: "context_length_exceeded" },
        false,
      ),
    );
    logger.warn({ err: wrapped }, "failed");
    const serialized = lines.join("");
    expect(serialized).not.toContain("PROVIDER-MESSAGE-SENTINEL");
    expect(providerErrorDetail(wrapped)?.providerMessage).toBe("PROVIDER-MESSAGE-SENTINEL");
  });

  test("a non-provider error yields no provider message", () => {
    const detail = providerErrorDetail(new TypeError("fetch failed: PROMPT-SENTINEL"));
    expect(detail?.providerErrorCode).toBe("network");
    expect(detail).not.toHaveProperty("providerMessage");
    expect(providerErrorDetail(new AiError("unconfigured", "no key"))).toBeUndefined();
  });
});

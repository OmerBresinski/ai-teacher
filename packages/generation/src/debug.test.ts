import { describe, expect, test } from "bun:test";
import { AiError, ProviderFailure } from "@tj/ai";
import { type DebugRecord, fullError, recordDebug } from "./debug";

describe("recordDebug", () => {
  test("hands the record to the sink, with the slide index only when given", () => {
    const got: DebugRecord[] = [];
    recordDebug((r) => got.push(r), "check", { faults: [] }, 2);
    recordDebug((r) => got.push(r), "plan", { stage: "objectives" });
    expect(got).toEqual([
      { kind: "check", slideIndex: 2, payload: { faults: [] } },
      { kind: "plan", payload: { stage: "objectives" } },
    ]);
  });

  test("no sink records nothing; a throwing sink never reaches the stage", () => {
    expect(() => recordDebug(undefined, "event", {})).not.toThrow();
    expect(() =>
      recordDebug(
        () => {
          throw new Error("sink down");
        },
        "event",
        {},
      ),
    ).not.toThrow();
  });
});

describe("fullError", () => {
  test("keeps message, stack, code and the cause chain", () => {
    const inner = Object.assign(new Error("inner"), { code: "E_X" });
    const out = fullError(new Error("outer", { cause: inner }));
    expect(out).toMatchObject({
      name: "Error",
      message: "outer",
      cause: { message: "inner", code: "E_X" },
    });
    expect(String(out.stack)).toContain("debug.test.ts");
    expect(fullError("plain")).toEqual({ value: "plain" });
  });

  test("a provider failure's status, codes and redacted message reach the stage-error row", () => {
    const cause = new ProviderFailure("AI_APICallError", "The model provider request failed.", {
      statusCode: 429,
      isRetryable: true,
      providerErrorCode: "rate_limited",
      providerCode: "rate_limit_exceeded",
      providerMessage: "Rate limit reached for gpt-6-luna.",
    });
    const out = fullError(new AiError("provider", "Model call failed", { cause }));
    expect(out.cause).toMatchObject({
      name: "AI_APICallError",
      statusCode: 429,
      isRetryable: true,
      providerErrorCode: "rate_limited",
      providerCode: "rate_limit_exceeded",
      providerMessage: "Rate limit reached for gpt-6-luna.",
    });
  });
});

import { describe, expect, test } from "bun:test";
import { modelIdIn, safeFrames, sanitizeError } from "./scrub";

class StageFailure extends Error {
  override readonly name = "StageFailure";
}

describe("sanitizeError (ADR 0041: type and frames, never a message)", () => {
  test("our own error keeps its type, not its message", () => {
    const clean = sanitizeError(
      new StageFailure('model id "openai/gpt-6-luna" failed at https://x.example/a?token=abc'),
    );
    expect(clean.name).toBe("StageFailure");
    expect(clean.message).toBe("StageFailure");
    expect(clean.stack).not.toContain("token");
    expect(clean.stack).not.toContain("gpt-6-luna");
  });

  test("keeps the frames, drops a multi-line message from the stack", () => {
    const original = new Error("line one\n    at fake (packages/evil/leak.ts:1:1)\nlesson text");
    const clean = sanitizeError(original);
    expect(clean.message).toBe("Error");
    expect(clean.stack).not.toContain("lesson text");
    expect(clean.stack).not.toContain("leak.ts");
    expect(safeFrames(original).length).toBeGreaterThan(0);
    expect(clean.stack?.split("\n").length).toBeGreaterThan(1);
  });

  test("sanitizes the cause chain", () => {
    const outer = new StageFailure("Generate failed.", {
      cause: new Error("provider body: lesson text"),
    });
    const clean = sanitizeError(outer);
    expect((clean.cause as Error).message).toBe("Error");
    expect((clean.cause as Error).stack).not.toContain("lesson text");
  });
});

describe("modelIdIn", () => {
  test("names only an allowed model id found in the chain", () => {
    const models = new Set(["openai/gpt-6-luna"]);
    const inner = new Error('model id "openai/gpt-6-luna" needs OPENAI_API_KEY (OpenAI)');
    expect(modelIdIn(new StageFailure("x", { cause: inner }), models)).toBe("openai/gpt-6-luna");
    expect(modelIdIn(new Error('model id "secret-topic-model" failed'), models)).toBeUndefined();
  });
});

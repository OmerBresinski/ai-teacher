import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createAi, isAiError } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { NonRetryableError } from "@tj/jobs";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { aiPingJob } from "./ai-ping";

const ids = {
  jobId: "0192f7a0-0000-7000-8000-000000000001",
  workspaceId: "0192f7a0-0000-7000-8000-000000000002",
} as unknown as { jobId: never; workspaceId: never };

function ctx(deps: WorkerDeps, ac = new AbortController()) {
  const calls: Array<[number | undefined, string | undefined]> = [];
  return {
    calls,
    ac,
    ctx: {
      ...ids,
      payload: { class: "small" as const, prompt: "private smoke prompt" },
      signal: ac.signal,
      progress: async (percent?: number, message?: string) => {
        calls.push([percent, message]);
      },
      logger: pino({ level: "silent" }),
      deps,
    },
  };
}

function memoryLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: pino({ level: "info" }, destination) };
}

describe("ai.ping job", () => {
  test("reports metadata-only progress for a successful model call", async () => {
    const h = ctx({
      ai: createFakeAi({
        text: "private fake completion",
        usage: { inputTokens: 7, outputTokens: 3 },
        modelIds: { small: "fake-small" },
      }),
    });

    await aiPingJob(h.ctx);

    expect(h.calls).toEqual([
      [10, "calling fake-small"],
      [100, "fake-small: in=7 out=3 finish=stop"],
    ]);
    expect(h.calls.at(-1)?.[1]).not.toContain(h.ctx.payload.prompt);
    expect(h.calls.at(-1)?.[1]).not.toContain("private fake completion");
  });

  test("fails non-retryably when the AI provider is unconfigured", async () => {
    const h = ctx({ ai: createAi({}) });

    await expect(aiPingJob(h.ctx)).rejects.toMatchObject({
      name: "NonRetryableError",
      message: "AI provider is not configured (AWS_BEARER_TOKEN_BEDROCK unset)",
    });
    expect(h.calls).toHaveLength(1);
  });

  test("rethrows provider errors without logging prompt text", async () => {
    const { lines, logger } = memoryLogger();
    const h = ctx({ ai: createFakeAi({ error: new Error("private provider response"), logger }) });

    try {
      await aiPingJob(h.ctx);
      throw new Error("Expected provider error");
    } catch (error) {
      expect(isAiError(error, "provider")).toBe(true);
      expect(error).not.toBeInstanceOf(NonRetryableError);
    }
    expect(JSON.stringify(lines)).not.toContain(h.ctx.payload.prompt);
    expect(JSON.stringify(lines)).not.toContain("private provider response");
  });

  test("does not call a model after the signal is already aborted", async () => {
    const ai = createFakeAi();
    ai.model = () => {
      throw new Error("model should not be called");
    };
    const ac = new AbortController();
    ac.abort("cancelled");
    const h = ctx({ ai }, ac);

    await aiPingJob(h.ctx);

    expect(h.calls).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { chatCallOptions } from "./ai-services";
import { SMALL_MODEL } from "./services";

const req = { model: SMALL_MODEL, system: "s", user: "u", schema: {}, name: "diagram" };

describe("a small call's options (TEACH-247)", () => {
  test("strict is honoured: OpenAI strict JSON schema only when the request asks for it", () => {
    const off = chatCallOptions({ ...req, strict: false }, new AbortController().signal);
    expect(off.providerOptions?.openai?.strictJsonSchema).toBe(false);
    const unset = chatCallOptions(req, new AbortController().signal);
    expect(unset.providerOptions?.openai?.strictJsonSchema).toBe(false);
    const on = chatCallOptions({ ...req, strict: true }, new AbortController().signal);
    expect(on.providerOptions?.openai?.strictJsonSchema).toBe(true);
    // The rest of the provider options are kept.
    expect(
      (on.providerOptions?.openai as Record<string, unknown> | undefined)?.reasoningEffort,
    ).toBe("low");
  });
  test("timeoutMs aborts the call on its own deadline; a cancel still aborts it", async () => {
    const timed = chatCallOptions({ ...req, timeoutMs: 20 }, new AbortController().signal);
    expect(timed.abortSignal.aborted).toBe(false);
    await Bun.sleep(60);
    expect(timed.abortSignal.aborted).toBe(true);
    expect((timed.abortSignal.reason as Error).name).toBe("TimeoutError");
    const ctl = new AbortController();
    const plain = chatCallOptions(req, ctl.signal);
    ctl.abort();
    expect(plain.abortSignal.aborted).toBe(true);
    expect(plain.maxOutputTokens).toBeGreaterThan(0);
  });
});

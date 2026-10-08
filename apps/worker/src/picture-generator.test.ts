import { describe, expect, test } from "bun:test";
import type { BankRequest } from "@tj/generation";
import { decodePng, encodePng, type ImageGenerator } from "@tj/images";
import { createDailyImageCap, createGeneratingBank } from "./picture-generator";

const logs: { obj: Record<string, unknown>; msg?: string }[] = [];
const logger = { info: (obj: Record<string, unknown>, msg?: string) => logs.push({ obj, msg }) };

/** A 3:2 light picture with a dark band across its top rows. */
function picture(): Uint8Array {
  const width = 300;
  const height = 200;
  const rgb = new Uint8Array(width * height * 3).fill(230);
  rgb.fill(30, 0, width * 20 * 3);
  return encodePng({ width, height, rgb });
}

function fakeGenerator() {
  const calls: { prompt: string; size: string }[] = [];
  const generator: Pick<ImageGenerator, "model" | "generate"> = {
    model: "gpt-image-2.5-sunburst",
    async generate({ prompt, size }) {
      calls.push({ prompt, size });
      return {
        bytes: picture(),
        mime: "image/png",
        usage: { inputTokens: 28, outputTokens: 158 },
        costUsd: 0.005,
        ms: 1,
      };
    },
  };
  return { generator, calls };
}

const req: BankRequest = {
  text: "A hen in a farmyard",
  named: null,
  aspect: 1,
  route: "generic",
  imagePrompt: "A brown hen standing in a farmyard.",
};
const signal = new AbortController().signal;

describe("the generating bank", () => {
  test("generates at the size nearest the slot, stores it whole, and the judge sees those bytes", async () => {
    const { generator, calls } = fakeGenerator();
    const saved: Uint8Array[] = [];
    const bank = createGeneratingBank({
      generator,
      cap: createDailyImageCap({ capUsd: 5 }),
      save: async (bytes) => {
        saved.push(bytes);
        return { id: "g1", src: "/files/w/images/g1.png" };
      },
      logger,
    });
    const made = await bank.generate(req, false, signal);
    expect(calls[0]?.size).toBe("1024x1024");
    expect(calls[0]?.prompt).toContain("No text anywhere in the image");
    const shown = decodePng(saved[0] as Uint8Array);
    expect([shown.width, shown.height]).toEqual([300, 200]);
    expect((made as { aspect?: number }).aspect).toBe(1.5);
    expect(made?.dataUrl).toBe(
      `data:image/png;base64,${Buffer.from(saved[0] as Uint8Array).toString("base64")}`,
    );
    expect(made?.source.provider).toBe("generated");
    expect(await bank.lookup(req, signal)).toBeUndefined();
  });
  test("the daily cap spent: placeholder, no generation call, one log line", async () => {
    const { generator, calls } = fakeGenerator();
    logs.length = 0;
    const cap = createDailyImageCap({ capUsd: 0.007, logger });
    const bank = createGeneratingBank({
      generator,
      cap,
      save: async () => ({ id: "g", src: "/files/g.png" }),
      logger,
    });
    expect(await bank.generate(req, false, signal)).toBeDefined();
    expect(await bank.generate(req, false, signal)).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(logs.filter((l) => /daily cap spent/.test(l.msg ?? ""))).toHaveLength(1);
  });
  test("the cap starts again each UTC day", () => {
    let now = new Date("2026-10-08T23:59:00Z");
    const cap = createDailyImageCap({ capUsd: 0.007, now: () => now });
    cap.spent(0.005);
    expect(cap.allow("1024x1024")).toBe(false);
    now = new Date("2026-10-09T00:01:00Z");
    expect(cap.allow("1024x1024")).toBe(true);
  });
  test("a count is drawn in code, free and never capped", async () => {
    const { generator, calls } = fakeGenerator();
    const cap = createDailyImageCap({ capUsd: 0 });
    const bank = createGeneratingBank({
      generator,
      cap,
      save: async () => ({ id: "d", src: "/files/d.svg" }),
      logger,
    });
    const drawn = await bank.generate(
      { ...req, draw: { total: 6, groups: 2, perGroup: 3, arrangement: "groups" } as never },
      false,
      signal,
    );
    expect(drawn?.style).toBe("drawn");
    expect(calls).toHaveLength(0);
  });
});

import { describe, expect, test } from "bun:test";
import type { StorageAdapter, WorkspaceId } from "@tj/domain";
import type { BankRequest } from "@tj/generation";
import { decodePng, encodePng, type ImageGenerator } from "@tj/images";
import {
  createDailyImageCap,
  createGeneratingBank,
  removePicture,
  savePicture,
} from "./picture-generator";

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
  test("FRAME-CUT (TEACH-251 part f): a subject run off the frame is made once more, the less cut kept", async () => {
    // A light backdrop; `cut` draws a dark subject over the top-left corner's edges, else centred.
    const pic = (cut: boolean) => {
      const width = 300;
      const height = 200;
      const rgb = new Uint8Array(width * height * 3).fill(232);
      const [x0, y0] = cut ? [0, 0] : [100, 60];
      for (let y = y0; y < y0 + 80; y++)
        rgb.fill(90, (y * width + x0) * 3, (y * width + x0 + 100) * 3);
      return encodePng({ width, height, rgb });
    };
    const made: boolean[] = [true, false];
    const calls: string[] = [];
    const generator: Pick<ImageGenerator, "model" | "generate"> = {
      model: "gpt-image-2.5-sunburst",
      async generate({ size }) {
        calls.push(size);
        return {
          bytes: pic(made.shift() ?? true),
          mime: "image/png",
          usage: { inputTokens: 28, outputTokens: 158 },
          costUsd: 0.005,
          ms: 1,
        };
      },
    };
    const saved: Uint8Array[] = [];
    const cap = createDailyImageCap({ capUsd: 5 });
    const bank = createGeneratingBank({
      generator,
      cap,
      save: async (bytes) => {
        saved.push(bytes);
        return { id: "g2", src: "/files/w/images/g2.png" };
      },
      logger,
    });
    await bank.generate(req, false, signal);
    expect(calls).toEqual(["1024x1024", "1024x1024"]);
    expect(saved).toHaveLength(1);
    expect(decodePng(saved[0] as Uint8Array).rgb[0]).toBe(232); // the whole one, not the cut one

    // Under a cap with room for one: no second call, the first is kept.
    calls.length = 0;
    made.splice(0, made.length, true);
    const tight = createGeneratingBank({
      generator,
      cap: createDailyImageCap({ capUsd: 0.007 }),
      save: async () => ({ id: "g3", src: "/files/w/images/g3.png" }),
      logger,
    });
    expect(await tight.generate(req, false, signal)).toBeDefined();
    expect(calls).toHaveLength(1);
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

describe("a rejected generation is deleted from storage (TEACH-167 part b)", () => {
  const ws = "01a12146-0bf6-7000-9dad-27a0a34bb22f" as WorkspaceId;
  const memoryStorage = () => {
    const objects = new Map<string, Uint8Array>();
    const storage: StorageAdapter = {
      async put(key, body) {
        objects.set(key, body as Uint8Array);
        return { key };
      },
      async getSignedUrl(key) {
        return `https://example.test/${key}`;
      },
      async delete(key) {
        objects.delete(key);
      },
      async *list() {},
    };
    return { storage, objects };
  };

  test("reject deletes the stored object; another workspace's src is left alone", async () => {
    const { storage, objects } = memoryStorage();
    const { generator } = fakeGenerator();
    const bank = createGeneratingBank({
      generator,
      cap: createDailyImageCap({ capUsd: 5 }),
      save: savePicture(storage, ws),
      remove: removePicture(storage, ws),
      logger: logger as never,
    });
    const made = await bank.generate(
      { ...req, imagePrompt: "A hen." },
      false,
      new AbortController().signal,
    );
    expect(made).toBeDefined();
    expect(objects.size).toBe(1);
    await bank.reject?.({ ...(made as object), src: "/files/other/images/x.png" } as never);
    expect(objects.size).toBe(1);
    await bank.reject?.(made as never);
    expect(objects.size).toBe(0);
  });
});

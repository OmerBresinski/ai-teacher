import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { listBankImages } from "@tj/db";
import { withTestDb } from "@tj/db/testing";
import type { BankRequest, PlacedPhoto } from "@tj/generation";
import type { Embedder, ImageGenerator } from "@tj/images";
import { createPictureBank, imageDimensions } from "./picture-bank";

/** A deterministic embedder: one axis per known word, so similarity is word overlap. */
function fakeEmbedder(): Embedder & { calls: number } {
  const vocab = new Map<string, number>();
  const e = {
    model: "fake",
    calls: 0,
    async embed(text: string) {
      e.calls += 1;
      const v = new Array(1536).fill(0);
      for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        if (!vocab.has(w)) vocab.set(w, vocab.size);
        v[(vocab.get(w) ?? 0) % 1536] += 1;
      }
      return { vector: v, tokens: 10, costUsd: 0 };
    },
  };
  return e;
}

const PNG_1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function fakeGenerator(): ImageGenerator & { prompts: string[]; sizes: string[] } {
  const g = {
    model: "gpt-image-2.5-sunburst",
    prompts: [] as string[],
    sizes: [] as string[],
    async generate(input: { prompt: string; size: string }) {
      g.prompts.push(input.prompt);
      g.sizes.push(input.size);
      return {
        bytes: PNG_1x1,
        mime: "image/png",
        usage: { inputTokens: 80, outputTokens: 196 },
        costUsd: 0.006,
        ms: 1,
      };
    },
  };
  return g as never;
}

function memoryStorage() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(
      key: string,
      body: Uint8Array | ReadableStream<Uint8Array>,
      opts: { contentType?: string },
    ) {
      const bytes =
        body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, contentType: opts.contentType ?? "application/octet-stream" });
      return { key };
    },
    async get(key: string) {
      const o = objects.get(key);
      if (!o) throw new Error("not_found");
      return {
        key,
        body: new Response(o.bytes).body as ReadableStream<Uint8Array>,
        contentType: o.contentType,
        size: o.bytes.byteLength,
        updatedAt: new Date(),
      };
    },
    getSignedUrl: async () => "",
    delete: async () => {},
    async *list() {},
  };
}

test("imageDimensions reads PNG and JPEG headers", () => {
  expect(imageDimensions(PNG_1x1)).toEqual({ width: 1, height: 1 });
  expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined();
});

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping picture bank tests: ${t.reason}`);

describeDb("picture bank (TEACH-84) on Postgres + pgvector", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, close } = t.db;
  afterAll(() => close());
  beforeEach(async () => {
    await sql`truncate table bank_images`;
  });
  const signal = new AbortController().signal;
  let n = 0;
  const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const setup = (capUsd?: number) => {
    const storage = memoryStorage();
    const generator = fakeGenerator();
    const embedder = fakeEmbedder();
    const bank = createPictureBank({
      db: unsafeDb,
      storage: storage as never,
      embedder,
      generator,
      ids,
      ...(capUsd !== undefined ? { capUsd } : {}),
    });
    return { bank, storage, generator, embedder };
  };
  const req = (text: string, aspect = 1, route: "real" | "generic" = "generic"): BankRequest => ({
    text,
    named: null,
    aspect,
    route,
    imagePrompt: text,
  });

  test("a generated picture is stored once and the same request reuses it", async () => {
    const { bank, storage, generator } = setup();
    expect(await bank.lookup(req("an adult hen beside a yellow chick"), signal)).toBeUndefined();
    const made = await bank.generate(req("an adult hen beside a yellow chick"), false, signal);
    expect(made?.src).toMatch(/^\/files\/[0-9a-f-]+\/bank\/.+\.png$/);
    expect(made?.source.provider).toBe("generated");
    expect(generator.sizes).toEqual(["1024x1024"]);
    expect(storage.objects.size).toBe(1);
    const again = await bank.lookup(req("an adult hen beside a yellow chick"), signal);
    expect(again?.src).toBe(made?.src);
    const rows = await listBankImages(unsafeDb);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.useCount).toBe(1);
    expect(rows[0]?.generator).toBe("gpt-image-2.5-sunburst");
    expect(rows[0]?.prompt).toMatch(/No text anywhere/);
  });

  test("a portrait zone is generated at 1024x1536 and never reused for a square zone", async () => {
    const { bank, generator } = setup();
    await bank.generate(req("a tall lighthouse on a cliff", 0.66), false, signal);
    expect(generator.sizes).toEqual(["1024x1536"]);
    expect(await bank.lookup(req("a tall lighthouse on a cliff", 1), signal)).toBeUndefined();
    expect(await bank.lookup(req("a tall lighthouse on a cliff", 0.66), signal)).toBeDefined();
  });

  test("a different request, or the same words with other numbers, is a miss", async () => {
    const { bank } = setup();
    await bank.generate(req("24 counters in four groups of six"), false, signal);
    expect(await bank.lookup(req("a volcano erupting at night"), signal)).toBeUndefined();
    expect(await bank.lookup(req("12 counters in three groups of four"), signal)).toBeUndefined();
  });

  test("a fetched Commons photo keeps its credit; a non-reusable licence is not stored", async () => {
    const { bank, storage } = setup();
    await storage.put("ws/images/a.png", PNG_1x1, { contentType: "image/png" });
    const fetched = (licence: string): PlacedPhoto => ({
      src: "/files/ws/images/a.png",
      alt: "Housesteads north gate",
      source: {
        provider: "commons",
        id: "File:x.jpg",
        pageUrl: "https://commons.wikimedia.org/wiki/File:x.jpg",
        photographer: "Jane Doe",
        photographerUrl: "https://commons.wikimedia.org/wiki/User:Jane",
        author: "Jane Doe",
        licence,
      },
      evidence: { visible: [], count: "one", alt: "gate", promptVersion: "t" },
    });
    await bank.remember(req("Housesteads north gate", 1, "real"), fetched("CC BY-NC 2.0"));
    expect(await listBankImages(unsafeDb)).toHaveLength(0);
    await bank.remember(req("Housesteads north gate", 1, "real"), fetched("CC BY-SA 4.0"));
    const reused = await bank.lookup(req("Housesteads north gate", 1, "real"), signal);
    expect(reused?.source.author).toBe("Jane Doe");
    expect(reused?.source.licence).toBe("CC BY-SA 4.0");
    expect(reused?.src).toMatch(/^\/files\/[0-9a-f-]+\/bank\//);
  });

  test("the spend cap stops generation", async () => {
    const { bank, generator } = setup(0.001);
    expect(await bank.generate(req("a frog on a lily pad"), false, signal)).toBeUndefined();
    expect(generator.prompts).toHaveLength(0);
  });

  test("a faithful generation is flagged for the look check", async () => {
    const { bank, generator } = setup();
    await bank.generate(req("German children with banknotes in 1923", 1, "real"), true, signal);
    expect(generator.prompts[0]).toMatch(/No added captions/);
    const [row] = await listBankImages(unsafeDb);
    expect(row?.flags).toMatchObject({ lookCheck: true });
  });
});

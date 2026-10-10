/**
 * The shared picture library behind the director's bank (TEACH-84 part b), with an in-memory
 * `bank_images`, a fake embedder (no paid calls) and in-memory storage: a hit at or above the
 * calibrated threshold, a miss below it, ruling 163 on reused pictures, credit and licence carried
 * with reused stock, store only after a judge's yes, and a failed lookup that falls through to the
 * live search and never loses a picture.
 */
import { describe, expect, test } from "bun:test";
import type { BankImageRow, NewBankImage } from "@tj/db";
import { LIBRARY_WORKSPACE_ID, type ReadableStorageAdapter } from "@tj/domain";
import type { PhotoSource } from "@tj/domain/documents";
import { type BankRequest, findPicture, type MadePicture, type PictureBank } from "@tj/generation";
import { cosine, type Embedder, type ImageGenerator, REUSE_THRESHOLD } from "@tj/images";
import { createDailyImageCap, createGeneratingBank } from "./picture-generator";
import { createPictureLibrary, type LibraryQueries } from "./picture-library";

const silent = { info: () => {} };

/** A PNG header is all `imageDimensions` reads. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return b;
}

function memoryStorage() {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage = {
    files,
    async put(
      key: string,
      body: Uint8Array | ReadableStream<Uint8Array>,
      o: { contentType: string },
    ) {
      const bytes =
        body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      files.set(key, { bytes, contentType: o.contentType });
      return { key };
    },
    async get(key: string) {
      const f = files.get(key);
      if (!f) throw new Error("not_found");
      return {
        key,
        body: new Response(f.bytes).body as ReadableStream<Uint8Array>,
        contentType: f.contentType,
        size: f.bytes.byteLength,
        updatedAt: new Date(0),
      };
    },
    async delete(key: string) {
      files.delete(key);
    },
    async getSignedUrl() {
      return "";
    },
    async *list() {},
  };
  return storage as typeof storage & ReadableStorageAdapter;
}

/** Vectors at a chosen cosine to the unit x axis, so a test sets the similarity exactly. */
const at = (similarity: number) => [similarity, Math.sqrt(1 - similarity * similarity)];

function fakeEmbedder(vectors: Record<string, number[]>, fail = false) {
  const calls: string[] = [];
  const embedder: Embedder = {
    model: "text-embedding-3-small",
    async embed(text) {
      calls.push(text);
      if (fail) throw new Error("embedding failed (500)");
      return { vector: vectors[text] ?? [1, 0], tokens: 5, costUsd: 0.0000001 };
    },
  };
  return { embedder, calls };
}

function memoryTable() {
  const rows: BankImageRow[] = [];
  const touched: string[] = [];
  const queries: LibraryQueries = {
    nearest: async (_db, embedding, limit = 5) =>
      rows
        .filter((r) => r.status === "ready")
        .map((r) => ({ ...r, similarity: cosine(r.embedding, embedding) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit),
    insert: async (_db, row: NewBankImage) => {
      const created = {
        tags: [],
        licence: null,
        credit: null,
        generator: null,
        generatorTerms: null,
        prompt: null,
        costUsd: null,
        flags: {},
        status: "ready",
        useCount: 0,
        lastUsedAt: null,
        createdAt: new Date(0),
        ...row,
      } as BankImageRow;
      rows.push(created);
      return created;
    },
    touch: async (_db, id) => void touched.push(id),
    reject: async (_db, key) => {
      for (const r of rows) if (r.storageKey === key) r.status = "rejected";
    },
  };
  return { rows, touched, queries };
}

const COMMONS: PhotoSource = {
  provider: "commons",
  id: "File:Hen.jpg",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Hen.jpg",
  photographer: "Jane Smith",
  photographerUrl: "https://commons.wikimedia.org/wiki/User:Jane",
  author: "Jane Smith",
  licence: "CC BY-SA 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
};

/** One stored row whose request embedding sits at `similarity` to the [1, 0] request. */
async function seed(
  table: ReturnType<typeof memoryTable>,
  storage: ReturnType<typeof memoryStorage>,
  row: Partial<BankImageRow> & { similarity: number },
) {
  const id = row.id ?? `row-${table.rows.length + 1}`;
  const storageKey = `${LIBRARY_WORKSPACE_ID}/bank/${id}.png`;
  await storage.put(storageKey, png(1536, 1024), { contentType: "image/png" });
  const { similarity, ...rest } = row;
  await table.queries.insert({} as never, {
    id,
    storageKey,
    mime: "image/png",
    byteSize: 32,
    width: 1536,
    height: 1024,
    family: "landscape",
    provider: "commons",
    source: COMMONS,
    licence: COMMONS.licence ?? null,
    credit: "Jane Smith",
    alt: "A hen in a farmyard",
    request: "a hen in a farmyard",
    route: "real",
    embedModel: "text-embedding-3-small",
    embedDims: 1536,
    embedding: at(similarity),
    ...rest,
  });
}

const REQ: BankRequest = { text: "a hen in a farmyard", named: null, aspect: 1.5, route: "real" };

function setup(opts: { failEmbed?: boolean; vectors?: Record<string, number[]> } = {}) {
  const table = memoryTable();
  const storage = memoryStorage();
  const { embedder, calls } = fakeEmbedder(opts.vectors ?? {}, opts.failEmbed);
  let n = 0;
  const library = createPictureLibrary({
    db: {} as never,
    storage,
    embedder,
    logger: silent,
    ids: () => `new-${++n}`,
    queries: table.queries,
  });
  return { table, storage, library, embedCalls: calls };
}

const signal = new AbortController().signal;

describe("picture library lookup", () => {
  test("a stored picture at the threshold is offered with its bytes, credit and licence", async () => {
    const { table, storage, library, embedCalls } = setup();
    await seed(table, storage, { similarity: REUSE_THRESHOLD + 0.001 });
    const hit = await library.lookup(REQ, signal);
    expect(hit?.src).toBe(`/files/${LIBRARY_WORKSPACE_ID}/bank/row-1.png`);
    expect(hit?.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    // Ruling 139: the reused Commons picture keeps its author, licence and links.
    expect(hit?.source).toEqual(COMMONS);
    expect(hit?.style).toBeUndefined();
    expect(table.touched).toEqual(["row-1"]);
    expect(embedCalls).toEqual(["a hen in a farmyard"]);
  });

  test("below the threshold is a miss, and nothing is touched", async () => {
    const { table, storage, library } = setup();
    await seed(table, storage, { similarity: REUSE_THRESHOLD - 0.01 });
    expect(await library.lookup(REQ, signal)).toBeUndefined();
    expect(table.touched).toEqual([]);
  });

  test("another aspect family, other numbers, or a rejected row is never offered", async () => {
    const { table, storage, library } = setup();
    await seed(table, storage, { similarity: 0.99, family: "portrait" });
    await seed(table, storage, { similarity: 0.99, request: "two hens in a farmyard" });
    await seed(table, storage, { similarity: 0.99, status: "rejected" });
    expect(await library.lookup(REQ, signal)).toBeUndefined();
  });

  test("an embedding failure is a miss, not an error", async () => {
    const { table, storage, library } = setup({ failEmbed: true });
    await seed(table, storage, { similarity: 0.99 });
    expect(await library.lookup(REQ, signal)).toBeUndefined();
  });

  test("a job abort still throws", async () => {
    const { library } = setup({ failEmbed: true });
    const stop = new AbortController();
    stop.abort();
    await expect(library.lookup(REQ, stop.signal)).rejects.toThrow();
  });
});

/** The director's bank for one job, with the library, a fake generator and in-memory storage. */
function directorBank(opts: { failEmbed?: boolean } = {}) {
  const ctx = setup(opts);
  const removed: string[] = [];
  let g = 0;
  const generator: Pick<ImageGenerator, "model" | "generate"> = {
    model: "gpt-image-2.5-sunburst",
    async generate() {
      return {
        bytes: png(1536, 1024),
        mime: "image/png",
        usage: { inputTokens: 1, outputTokens: 1 },
        costUsd: 0.005,
        ms: 1,
      };
    },
  };
  const bank: PictureBank = createGeneratingBank({
    generator,
    cap: createDailyImageCap({ capUsd: 5 }),
    save: async (bytes, contentType = "image/png") => {
      const id = `gen-${++g}`;
      const key = `ws-1/images/${id}.png`;
      await ctx.storage.put(key, bytes, { contentType });
      return { id, src: `/files/${key}` };
    },
    remove: async (src) => void removed.push(src),
    library: ctx.library,
    logger: silent,
  });
  return { ...ctx, bank, removed };
}

const STOCK: MadePicture = {
  src: "/files/ws-1/images/stock.jpg",
  alt: "A hen",
  source: COMMONS,
  evidence: { visible: ["hen"], count: "one", alt: "A hen", promptVersion: "test" },
};

describe("the director with the library (findPicture)", () => {
  test("a judged library hit is placed with no search and no generation", async () => {
    const { table, storage, bank } = directorBank();
    await seed(table, storage, { similarity: 0.9 });
    let searched = 0;
    const judged: boolean[] = [];
    const out = await findPicture(
      REQ,
      bank,
      async () => {
        searched++;
        return STOCK;
      },
      signal,
      async (_p, reuse) => {
        judged.push(reuse === true);
        return true;
      },
    );
    expect(out.via).toBe("library");
    expect(out.photo?.source).toEqual(COMMONS);
    expect(searched).toBe(0);
    expect(judged).toEqual([true]);
  });

  test("ruling 163: a generated library picture is never placed for a past event or person", async () => {
    const { table, storage, bank } = directorBank();
    await seed(table, storage, {
      similarity: 0.95,
      provider: "generated",
      source: { ...COMMONS, provider: "generated", licence: "generated (openai-2026-10)" },
      generator: "gpt-image-2.5-sunburst",
      flags: { style: "photo" },
    });
    const req: BankRequest = { ...REQ, period: "1066, England", depicts: true };
    let judgeCalls = 0;
    const out = await findPicture(
      req,
      bank,
      async () => STOCK,
      signal,
      async () => {
        judgeCalls++;
        return true;
      },
    );
    expect(out.via).toBe("fetched");
    expect(out.photo?.src).toBe(STOCK.src);
    expect(judgeCalls).toBe(0);
  });

  test("ruling 163 still admits a reused real artefact (stock) for the same request", async () => {
    const { table, storage, bank } = directorBank();
    await seed(table, storage, { similarity: 0.95 });
    const req: BankRequest = { ...REQ, period: "1066, England", depicts: true };
    const out = await findPicture(
      req,
      bank,
      async () => undefined,
      signal,
      async () => true,
    );
    expect(out.via).toBe("library");
  });

  test("a library picture the judge refuses is marked rejected and the live search goes on", async () => {
    const { table, storage, bank } = directorBank();
    await seed(table, storage, { similarity: 0.95 });
    const out = await findPicture(
      REQ,
      bank,
      async () => STOCK,
      signal,
      async () => false,
    );
    expect(out.via).toBe("fetched");
    expect(table.rows[0]?.status).toBe("rejected");
    // Its file stays: other lessons may already show it.
    expect(storage.files.has(`${LIBRARY_WORKSPACE_ID}/bank/row-1.png`)).toBe(true);
  });

  test("embedding down: a generic picture is still generated, a real one still searched", async () => {
    const generic = directorBank({ failEmbed: true });
    const made = await findPicture(
      { ...REQ, route: "generic", imagePrompt: "a hen" },
      generic.bank,
      async () => undefined,
      signal,
      async () => true,
    );
    expect(made.via).toBe("generated");
    expect(made.photo).toBeDefined();
    const real = directorBank({ failEmbed: true });
    const fetched = await findPicture(
      REQ,
      real.bank,
      async () => STOCK,
      signal,
      async () => true,
    );
    expect(fetched.via).toBe("fetched");
    expect(fetched.photo?.src).toBe(STOCK.src);
  });

  test("a generated picture the judge passed is stored once with its provenance", async () => {
    const { table, storage, bank } = directorBank();
    const out = await findPicture(
      {
        ...REQ,
        route: "generic",
        imagePrompt: "a hen in a farmyard",
        style: "illustration",
        palette: "warm",
      },
      bank,
      async () => undefined,
      signal,
      async () => true,
    );
    expect(out.via).toBe("generated");
    expect(table.rows).toHaveLength(1);
    const row = table.rows[0] as BankImageRow;
    expect(row.provider).toBe("generated");
    expect(row.generator).toBe("gpt-image-2.5-sunburst");
    expect(row.generatorTerms).toBe("openai-2026-10");
    expect(row.costUsd).toBe("0.005000");
    expect(row.prompt).toContain("a hen in a farmyard");
    expect(row.flags).toMatchObject({ style: "illustration", palette: "warm", faithful: false });
    expect(row.family).toBe("landscape");
    expect(storage.files.has(row.storageKey)).toBe(true);
    expect(row.storageKey.startsWith(`${LIBRARY_WORKSPACE_ID}/bank/`)).toBe(true);
  });

  test("a generated picture the judge refused is neither stored nor kept", async () => {
    const { table, bank, removed } = directorBank();
    const out = await findPicture(
      { ...REQ, route: "generic", imagePrompt: "a hen" },
      bank,
      async () => undefined,
      signal,
      async () => false,
    );
    expect(out.via).toBe("none");
    expect(table.rows).toHaveLength(0);
    expect(removed).toEqual(["/files/ws-1/images/gen-1.png", "/files/ws-1/images/gen-2.png"]);
  });

  test("a fetched Commons picture is stored with its credit; an unadmitted licence is not", async () => {
    const ok = directorBank();
    await ok.storage.put("ws-1/images/stock.jpg", png(1536, 1024), { contentType: "image/jpeg" });
    await findPicture(
      REQ,
      ok.bank,
      async () => STOCK,
      signal,
      async () => true,
    );
    expect(ok.table.rows).toHaveLength(1);
    expect(ok.table.rows[0]).toMatchObject({
      provider: "commons",
      credit: "Jane Smith",
      licence: "CC BY-SA 4.0",
      source: COMMONS,
      generator: null,
    });
    const no = directorBank();
    await no.storage.put("ws-1/images/stock.jpg", png(1536, 1024), { contentType: "image/jpeg" });
    const nc = { ...STOCK, source: { ...COMMONS, licence: "CC BY-NC 4.0" } };
    await findPicture(
      REQ,
      no.bank,
      async () => nc,
      signal,
      async () => true,
    );
    expect(no.table.rows).toHaveLength(0);
  });

  test("without a library the bank keeps today's behaviour: no lookup, nothing stored", async () => {
    const bank = createGeneratingBank({
      cap: createDailyImageCap({ capUsd: 5 }),
      save: async () => ({ id: "x", src: "/files/ws-1/images/x.png" }),
      logger: silent,
    });
    expect(await bank.lookup(REQ, signal)).toBeUndefined();
    await bank.remember(REQ, STOCK);
  });
});

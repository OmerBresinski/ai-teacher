import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { Embedder } from "@tj/ai";
import { findBankImagesByTags } from "@tj/db";
import { withTestDb } from "@tj/db/testing";
import type { WorkspaceId } from "@tj/domain";
import type { PhotoSource } from "@tj/domain/documents";
import type { BankBrief } from "@tj/generation";
import { memoryLogger } from "@tj/generation/testing";
import { bankCard } from "@tj/images";
import { createLibrary } from "./library";
import { memoryStorage } from "./testing/memory-storage";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping library tests: ${t.reason}`);

const WS_A = "11111111-1111-4111-8111-111111111111" as WorkspaceId;
const WS_B = "22222222-2222-4222-8222-222222222222" as WorkspaceId;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** Cards are embedded onto fixed axes: equal cards are identical vectors, listed ones lean. */
function fakeEmbedder(
  vectors: Record<string, number[]>,
  opts: { delayMs?: number } = {},
): Embedder & { calls: string[] } {
  const calls: string[] = [];
  return {
    model: "text-embedding-3-small",
    dimensions: 1536,
    calls,
    async embed(text) {
      calls.push(text);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const v = vectors[text];
      if (!v) throw new Error("no vector for card");
      return { vector: v, tokens: 5, costUsd: 0 };
    },
  };
}
function axis(i: number, lean = 0): number[] {
  const v = new Array<number>(1536).fill(0);
  v[i] = 1;
  v[i + 1] = lean;
  return v;
}

const brief = (over: Partial<BankBrief> = {}): BankBrief => ({
  subject: "Ice cubes melting",
  mustShow: ["ice cubes", "meltwater"],
  ageBand: "ks3",
  orientation: "portrait",
  ...over,
});
const evidence = {
  visible: ["ice cubes"],
  count: "one" as const,
  alt: "Ice melting",
  promptVersion: "pick-or-requery-photo.v7",
};
const source: PhotoSource = {
  provider: "pexels",
  id: "77",
  pageUrl: "https://www.pexels.com/photo/77/",
  photographer: "Ada",
  photographerUrl: "https://www.pexels.com/@ada/",
  evidence,
};
const placed = {
  src: `/files/${WS_A}/images/p.jpg`,
  alt: "Ice melting",
  source,
  evidence,
  width: 4000,
  height: 6000,
};

describeDb("worker picture library", () => {
  if (!t.ok) return;
  const { unsafeDb: db, sql, close } = t.db;
  beforeEach(async () => {
    await sql`truncate bank_images`;
  });
  afterAll(() => close());

  function setup(embedder?: Embedder, ws: WorkspaceId = WS_A) {
    const storage = memoryStorage();
    storage.objects.set(`${WS_A}/images/p.jpg`, { bytes: JPEG, contentType: "image/jpeg" });
    const log = memoryLogger();
    let n = 0;
    const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const library = createLibrary({
      db,
      storage,
      embedder,
      workspaceId: ws,
      logger: log.logger,
      ids,
    });
    return { storage, log, library };
  }
  const signal = new AbortController().signal;

  test("write-through stores a judged photo once, ready, under the library prefix", async () => {
    const card = bankCard(brief());
    const embedder = fakeEmbedder({ [card]: axis(0) });
    const { library, storage, log } = setup(embedder);
    library.rememberBank(brief(), placed);
    library.rememberBank(brief(), placed);
    await library.drain();
    const rows = await findBankImagesByTags(db, {
      subject: "ice cubes melting",
      orientation: "portrait",
      band: "ks3",
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.status).toBe("ready");
    expect(row?.storageKey).toMatch(/^00000000-0000-4000-8000-00000000ba4c\/bank\/.+\.jpg$/);
    expect(storage.objects.get(row?.storageKey ?? "")?.bytes).toEqual(JPEG);
    expect(row?.depicts).toEqual(["ice cubes"]);
    expect(row?.bands).toEqual(["ks3"]);
    expect(row).not.toHaveProperty("topic");
    expect(row?.caption).toBe(card);
    expect(row?.embedModel).toBe("text-embedding-3-small");
    expect(row?.checks.checkedBy).toBe("pick-or-requery-photo.v7");
    expect((row?.source as PhotoSource | undefined)?.photographer).toBe("Ada");
    // Only one library object: the second write found the row (or lost the race and cleaned up).
    expect([...storage.objects.keys()].filter((k) => k.includes("/bank/"))).toHaveLength(1);
    // No brief text in any log line (ADR 0015).
    expect(log.lines.join("")).not.toContain("ice cubes");
    expect(log.lines.join("")).not.toContain("melting");
  });

  test("a tag hit makes no embedding call and is copied into the asking Workspace", async () => {
    const embedder = fakeEmbedder({ [bankCard(brief())]: axis(0) });
    const first = setup(embedder);
    first.library.rememberBank(brief(), placed);
    await first.library.drain();
    const calls = embedder.calls.length;
    const second = setup(embedder, WS_B);
    for (const [k, v] of first.storage.objects) second.storage.objects.set(k, v);
    const hit = await second.library.lookupBank(brief({ subject: "ice  cubes MELTING" }), {
      signal,
    });
    expect(embedder.calls.length).toBe(calls);
    expect(hit?.via).toBe("tags");
    expect(hit?.src.startsWith(`/files/${WS_B}/images/`)).toBe(true);
    expect(second.storage.objects.get(hit?.src.slice("/files/".length) ?? "")?.bytes).toEqual(JPEG);
    expect(hit?.source.photographer).toBe("Ada");
    expect(hit?.evidence.visible).toEqual(["ice cubes"]);
    const [row] = await findBankImagesByTags(db, {
      subject: "ice cubes melting",
      orientation: "portrait",
      band: "ks3",
    });
    expect(row?.useCount).toBe(1);
  });

  test("another band or orientation is a miss", async () => {
    const { library } = setup();
    library.rememberBank(brief(), placed);
    await library.drain();
    expect(await library.lookupBank(brief({ ageBand: "ks1" }), { signal })).toBeUndefined();
    expect(
      await library.lookupBank(brief({ orientation: "landscape" }), { signal }),
    ).toBeUndefined();
  });

  test("an embedding hit above the threshold is served; the grey zone and below are misses", async () => {
    const stored = brief();
    const near = brief({ subject: "melting ice", mustShow: ["ice cubes", "puddle"] });
    const grey = brief({ subject: "glacier", mustShow: [] });
    const far = brief({ subject: "volcano", mustShow: [] });
    const embedder = fakeEmbedder({
      [bankCard(stored)]: axis(0),
      [bankCard(near)]: axis(0, 0.3), // cosine 0.958
      [bankCard(grey)]: axis(0, 1.2), // cosine 0.640… below 0.65: a miss
      [bankCard(far)]: axis(5),
    });
    const { library } = setup(embedder);
    library.rememberBank(stored, placed);
    await library.drain();
    const hit = await library.lookupBank(near, { signal });
    expect(hit?.via).toBe("embedding");
    expect(hit?.similarity).toBeCloseTo(1 / Math.sqrt(1.09), 3);
    expect(await library.lookupBank(grey, { signal })).toBeUndefined();
    expect(await library.lookupBank(far, { signal })).toBeUndefined();
  });

  test("a grey-zone match is a miss in phase 1", async () => {
    const stored = brief();
    const grey = brief({ subject: "slush", mustShow: [] });
    const embedder = fakeEmbedder({ [bankCard(stored)]: axis(0), [bankCard(grey)]: axis(0, 1) }); // cosine 0.707
    const { library, log } = setup(embedder);
    library.rememberBank(stored, placed);
    await library.drain();
    expect(await library.lookupBank(grey, { signal })).toBeUndefined();
    expect(log.lines.some((l) => l.includes('"zone":"grey"'))).toBe(true);
  });

  test("cards whose numbers differ never share a picture", async () => {
    const stored = brief({ subject: "three apples", mustShow: [] });
    const other = brief({ subject: "five apples", mustShow: [] });
    const embedder = fakeEmbedder({ [bankCard(stored)]: axis(0), [bankCard(other)]: axis(0, 0.1) });
    const { library } = setup(embedder);
    library.rememberBank(stored, placed);
    await library.drain();
    expect(await library.lookupBank(other, { signal })).toBeUndefined();
  });

  test("an embedding slower than the deadline is a miss, not a wait", async () => {
    const stored = brief();
    const slow = brief({ subject: "melting ice", mustShow: [] });
    const fast = fakeEmbedder({ [bankCard(stored)]: axis(0) });
    const first = setup(fast);
    first.library.rememberBank(stored, placed);
    await first.library.drain();
    const embedder = fakeEmbedder({ [bankCard(slow)]: axis(0) }, { delayMs: 200 });
    const library = createLibrary({
      db,
      storage: first.storage,
      embedder,
      workspaceId: WS_A,
      logger: memoryLogger().logger,
      embedTimeoutMs: 20,
    });
    const t0 = Date.now();
    expect(await library.lookupBank(slow, { signal })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(150);
  });

  test("rejected and pending rows are never served", async () => {
    const { library } = setup();
    library.rememberBank(brief(), placed);
    await library.drain();
    await sql`update bank_images set status = 'rejected'`;
    expect(await library.lookupBank(brief(), { signal })).toBeUndefined();
    await sql`update bank_images set status = 'pending'`;
    expect(await library.lookupBank(brief(), { signal })).toBeUndefined();
  });

  test("without an embedder the row is stored without a card vector and found by tags", async () => {
    const { library } = setup();
    library.rememberBank(brief(), placed);
    await library.drain();
    const [row] = await findBankImagesByTags(db, {
      subject: "ice cubes melting",
      orientation: "portrait",
      band: "ks3",
    });
    expect(row?.embedding).toBeNull();
    expect((await library.lookupBank(brief(), { signal }))?.via).toBe("tags");
  });

  test("a write-through that fails is logged and swallowed", async () => {
    const { library, log } = setup();
    library.rememberBank(brief(), { ...placed, src: `/files/${WS_A}/images/missing.jpg` });
    await library.drain();
    expect(log.lines.some((l) => l.includes("write-failed"))).toBe(true);
    expect(log.lines.join("")).not.toContain("ice cubes");
  });

  test("a tag hit whose card states other numbers is not served", async () => {
    const stored = brief({ subject: "coins on a table", mustShow: ["3 coins"] });
    const other = brief({ subject: "coins on a table", mustShow: ["5 coins"] });
    const embedder = fakeEmbedder({ [bankCard(stored)]: axis(0), [bankCard(other)]: axis(0) });
    const { library } = setup(embedder);
    library.rememberBank(stored, { ...placed, evidence: { ...evidence, visible: ["3 coins"] } });
    await library.drain();
    expect(await library.lookupBank(other, { signal })).toBeUndefined();
    expect((await library.lookupBank(stored, { signal }))?.via).toBe("tags");
  });

  test("an embedding hit must depict one of this brief's mustShow items", async () => {
    const stored = brief();
    const plain = brief({ subject: "melting ice", mustShow: [] });
    const other = brief({ subject: "melting ice", mustShow: ["glass"] });
    const embedder = fakeEmbedder({
      [bankCard(stored)]: axis(0),
      [bankCard(plain)]: axis(0, 0.3),
      [bankCard(other)]: axis(0, 0.3),
    });
    const { library } = setup(embedder);
    library.rememberBank(stored, placed);
    await library.drain();
    expect(await library.lookupBank(other, { signal })).toBeUndefined();
    expect((await library.lookupBank(plain, { signal }))?.via).toBe("embedding");
  });

  test("a slow store under the lookup is a miss at the deadline, and copies nothing late", async () => {
    const { library: writer, storage } = setup();
    writer.rememberBank(brief(), placed);
    await writer.drain();
    const slow = {
      ...storage,
      get: async (key: string) => {
        await new Promise((r) => setTimeout(r, 200));
        return storage.get(key);
      },
    };
    const library = createLibrary({
      db,
      storage: slow,
      workspaceId: WS_B,
      logger: memoryLogger().logger,
      lookupDeadlineMs: 50,
    });
    const t0 = Date.now();
    expect(await library.lookupBank(brief(), { signal })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(150);
    await new Promise((r) => setTimeout(r, 250));
    expect([...storage.objects.keys()].some((k) => k.startsWith(WS_B))).toBe(false);
    const [row] = await findBankImagesByTags(db, {
      subject: "ice cubes melting",
      orientation: "portrait",
      band: "ks3",
    });
    expect(row?.useCount).toBe(0);
  });
});

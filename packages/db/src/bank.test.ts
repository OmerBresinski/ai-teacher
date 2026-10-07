import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  findBankImagesByTags,
  insertBankImage,
  type NewBankImage,
  nearestBankImages,
  touchBankImage,
} from "./bank";
import { withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping bank_images tests: ${t.reason}`);

/** A 1536-dim vector pointing mostly along `axis`, with `lean` towards axis + 1. */
function vec(axis: number, lean = 0): number[] {
  const v = new Array<number>(1536).fill(0);
  v[axis] = 1;
  v[axis + 1] = lean;
  return v;
}

let n = 0;
function row(over: Partial<NewBankImage> = {}): NewBankImage {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    storageKey: `00000000-0000-4000-8000-00000000ba4c/bank/${id}.jpg`,
    mime: "image/jpeg",
    byteSize: 100,
    width: 4000,
    height: 6000,
    orientation: "portrait",
    subject: "ice cubes melting",
    topic: "States of matter",
    bands: ["ks3"],
    depicts: ["ice cubes"],
    style: "photo",
    alt: "Ice melting",
    source: { provider: "pexels", id: "1" },
    checks: {
      onSubject: true,
      suitable: null,
      noText: null,
      checkedBy: "pick-or-requery-photo.v7",
      checkedAt: "2026-10-07T00:00:00.000Z",
    },
    status: "ready",
    caption: "ice cubes melting: ice cubes",
    embedding: vec(0),
    embedModel: "text-embedding-3-small",
    embedDims: 1536,
    ...over,
  };
}

describeDb("bank_images", () => {
  if (!t.ok) return;
  const { unsafeDb: db, sql, close } = t.db;
  beforeEach(async () => {
    await sql`truncate bank_images`;
  });
  afterAll(() => close());

  test("the tag filter serves ready rows of the subject, orientation and band only", async () => {
    await insertBankImage(db, row());
    const tags = { subject: "ice cubes melting", orientation: "portrait", band: "ks3" } as const;
    expect(await findBankImagesByTags(db, tags)).toHaveLength(1);
    expect(await findBankImagesByTags(db, { ...tags, band: "ks1" })).toHaveLength(0);
    expect(await findBankImagesByTags(db, { ...tags, orientation: "landscape" })).toHaveLength(0);
    expect(await findBankImagesByTags(db, { ...tags, subject: "ice" })).toHaveLength(0);
  });

  test("pending, rejected and retired rows are never served", async () => {
    await insertBankImage(db, row({ status: "rejected", subject: "a" }));
    await insertBankImage(db, row({ status: "retired", subject: "b" }));
    await insertBankImage(db, row({ status: "pending", subject: "c" }));
    for (const subject of ["a", "b", "c"]) {
      const tags = { subject, orientation: "portrait", band: "ks3" } as const;
      expect(await findBankImagesByTags(db, tags)).toHaveLength(0);
    }
    expect(await nearestBankImages(db, { orientation: "portrait", band: "ks3" }, vec(0))).toEqual(
      [],
    );
  });

  test("one live row per (subject, orientation, bands): a second insert is skipped", async () => {
    expect(await insertBankImage(db, row())).toBeDefined();
    expect(await insertBankImage(db, row())).toBeUndefined();
    // A rejected row does not hold the slot, and a different band is another slot.
    expect(await insertBankImage(db, row({ status: "rejected" }))).toBeDefined();
    expect(await insertBankImage(db, row({ bands: ["ks2"] }))).toBeDefined();
    const [{ count }] = (await sql`select count(*)::int as count from bank_images`) as unknown as [
      { count: number },
    ];
    expect(count).toBe(3);
  });

  test("nearest rows come by exact cosine, best first, filtered by orientation and band", async () => {
    await insertBankImage(db, row({ subject: "far", embedding: vec(10) }));
    await insertBankImage(db, row({ subject: "close", embedding: vec(0, 0.2) }));
    await insertBankImage(db, row({ subject: "exact", embedding: vec(0) }));
    await insertBankImage(db, row({ subject: "other band", embedding: vec(0), bands: ["ks1"] }));
    await insertBankImage(db, row({ subject: "no card", embedding: null }));
    const found = await nearestBankImages(db, { orientation: "portrait", band: "ks3" }, vec(0));
    expect(found.map((r) => r.subject)).toEqual(["exact", "close", "far"]);
    expect(found[0]?.similarity).toBeCloseTo(1, 5);
    expect(found[1]?.similarity).toBeCloseTo(1 / Math.sqrt(1.04), 5);
    expect(found[2]?.similarity).toBeCloseTo(0, 5);
  });

  test("a reuse moves use_count and last_used_at", async () => {
    const created = await insertBankImage(db, row());
    if (!created) throw new Error("not inserted");
    const at = new Date("2026-10-07T12:00:00.000Z");
    await touchBankImage(db, created.id, at);
    await touchBankImage(db, created.id, at);
    const [found] = await findBankImagesByTags(db, {
      subject: "ice cubes melting",
      orientation: "portrait",
      band: "ks3",
    });
    expect(found?.useCount).toBe(2);
    expect(found?.lastUsedAt?.toISOString()).toBe(at.toISOString());
  });
});

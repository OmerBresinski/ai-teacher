/**
 * `bank_images` queries against real Postgres + pgvector (TEACH-84 part b): nearest ready rows by
 * exact cosine, rejection by storage key, and the reuse counter. Skipped without
 * `TEST_DATABASE_URL` (run `bun run test:db`).
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { newId } from "@tj/domain";
import { sql } from "drizzle-orm";
import { insertBankImage, nearestBankImages, rejectBankImage, touchBankImage } from "./bank";
import { withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping bank tests: ${t.reason}`);

/** A 1536-dimension vector pointing mostly along axis `i`. */
function vec(i: number, lean = 0): number[] {
  const v = new Array<number>(1536).fill(0);
  v[i] = 1;
  v[(i + 1) % 1536] = lean;
  return v;
}

function row(request: string, embedding: number[]) {
  const id = newId();
  return {
    id,
    storageKey: `0b0b0000-0000-4000-8000-00000000ba4c/bank/${id}.png`,
    mime: "image/png",
    byteSize: 10,
    width: 1536,
    height: 1024,
    family: "landscape",
    provider: "pexels",
    source: {
      provider: "pexels",
      id: "1",
      pageUrl: "https://p",
      photographer: "A",
      photographerUrl: "https://p",
    },
    alt: request,
    request,
    route: "generic",
    embedModel: "text-embedding-3-small",
    embedDims: 1536,
    embedding,
  };
}

describeDb("bank_images", () => {
  if (!t.ok) return;
  const db = t.db.unsafeDb;
  // Awaited: a returned Drizzle query is a lazy thenable, and on a reused database its rows stayed.
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE bank_images`);
  });
  afterAll(() => t.db.close());

  test("nearest ready rows come back by cosine, rejected rows never", async () => {
    const near = await insertBankImage(db, row("a hen", vec(0, 0.1)));
    const far = await insertBankImage(db, row("a volcano", vec(5)));
    const gone = await insertBankImage(db, row("a hen again", vec(0)));
    await rejectBankImage(db, gone.storageKey);
    const out = await nearestBankImages(db, vec(0), 5);
    expect(out.map((r) => r.id)).toEqual([near.id, far.id]);
    expect(out[0]?.similarity).toBeGreaterThan(0.99);
    expect(out[1]?.similarity).toBeCloseTo(0, 5);
  });

  test("a reuse counts and stamps the row", async () => {
    const r = await insertBankImage(db, row("a hen", vec(0)));
    await touchBankImage(db, r.id);
    const [after] = await nearestBankImages(db, vec(0), 1);
    expect(after?.useCount).toBe(1);
    expect(after?.lastUsedAt).toBeInstanceOf(Date);
    expect(after?.status).toBe("ready");
  });
});

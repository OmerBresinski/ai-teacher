import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { bankImages } from "./schema/bank-images";

/**
 * Queries on the shared picture library (TEACH-84). `bank_images` is a `NON_TENANT_TABLES` table,
 * so these take the raw client (`unsafeDb`), as the README asks for non-tenant reads.
 */
export type BankImageRow = typeof bankImages.$inferSelect;
export type NewBankImage = typeof bankImages.$inferInsert;

export async function insertBankImage(db: Db, row: NewBankImage): Promise<BankImageRow> {
  const [created] = await db.insert(bankImages).values(row).returning();
  if (!created) throw new Error("bank_images insert returned no row");
  return created;
}

/**
 * The `limit` ready rows nearest to `embedding` by exact cosine (pgvector `<=>`), in one aspect
 * `family` when given (filtered in SQL, so other families never crowd out a match). The caller
 * applies the numbers rule and the threshold (`pickReuse` in `@tj/images`).
 */
export async function nearestBankImages(
  db: Db,
  embedding: number[],
  limit = 20,
  family?: string,
): Promise<(BankImageRow & { similarity: number })[]> {
  const literal = `[${embedding.join(",")}]`;
  const distance = sql<number>`${bankImages.embedding} <=> ${literal}::vector`;
  const rows = await db
    .select({ row: bankImages, distance })
    .from(bankImages)
    .where(
      family
        ? and(eq(bankImages.status, "ready"), eq(bankImages.family, family))
        : eq(bankImages.status, "ready"),
    )
    .orderBy(distance)
    .limit(limit);
  return rows.map((r) => ({ ...r.row, similarity: 1 - Number(r.distance) }));
}

/** Delete a row by id (an insert whose object could not be kept). */
export async function deleteBankImage(db: Db, id: string): Promise<void> {
  await db.delete(bankImages).where(eq(bankImages.id, id));
}

/** A reuse: `use_count` + 1 and `last_used_at` now. */
export async function touchBankImage(db: Db, id: string): Promise<void> {
  await db
    .update(bankImages)
    .set({ useCount: sql`${bankImages.useCount} + 1`, lastUsedAt: new Date() })
    .where(eq(bankImages.id, id));
}

/** The library's rows, newest first (reports and review). */
export async function listBankImages(db: Db, limit = 200): Promise<BankImageRow[]> {
  return db
    .select()
    .from(bankImages)
    .where(and(eq(bankImages.status, "ready")))
    .orderBy(desc(bankImages.createdAt))
    .limit(limit);
}

/**
 * A picture the judge refused: no longer `ready`, so `nearestBankImages` never offers it
 * again. Found by its storage key, which is all a placed picture carries (`/files/<key>`).
 */
export async function rejectBankImage(db: Db, storageKey: string): Promise<void> {
  await db
    .update(bankImages)
    .set({ status: "rejected" })
    .where(eq(bankImages.storageKey, storageKey));
}

/** Every ready row (the seed script's source read; the lab bank is a few thousand rows). */
export async function readyBankImages(db: Db): Promise<BankImageRow[]> {
  return db.select().from(bankImages).where(eq(bankImages.status, "ready"));
}

/** Which of `ids` are already rows (the seed script skips them). */
export async function bankImageIdsIn(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: bankImages.id })
    .from(bankImages)
    .where(inArray(bankImages.id, ids));
  return new Set(rows.map((r) => r.id));
}

/** Insert a row copied from another library as it is; an id already present is left alone. */
export async function copyBankImage(db: Db, row: NewBankImage): Promise<void> {
  await db.insert(bankImages).values(row).onConflictDoNothing();
}

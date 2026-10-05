import { and, desc, eq, sql } from "drizzle-orm";
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
 * The `limit` ready rows nearest to `embedding` by exact cosine (pgvector `<=>`), any family:
 * the caller applies the family rule and the threshold (`pickReuse` in `@tj/images`).
 */
export async function nearestBankImages(
  db: Db,
  embedding: number[],
  limit = 5,
): Promise<(BankImageRow & { similarity: number })[]> {
  const literal = `[${embedding.join(",")}]`;
  const distance = sql<number>`${bankImages.embedding} <=> ${literal}::vector`;
  const rows = await db
    .select({ row: bankImages, distance })
    .from(bankImages)
    .where(eq(bankImages.status, "ready"))
    .orderBy(distance)
    .limit(limit);
  return rows.map((r) => ({ ...r.row, similarity: 1 - Number(r.distance) }));
}

/** A reuse: `use_count` + 1 and `last_used_at` now. */
export async function touchBankImage(db: Db, id: string): Promise<void> {
  await db
    .update(bankImages)
    .set({ useCount: sql`${bankImages.useCount} + 1`, lastUsedAt: new Date() })
    .where(eq(bankImages.id, id));
}

/** The library's rows, newest first (lab reports and the review page). */
export async function listBankImages(db: Db, limit = 200): Promise<BankImageRow[]> {
  return db
    .select()
    .from(bankImages)
    .where(and(eq(bankImages.status, "ready")))
    .orderBy(desc(bankImages.createdAt))
    .limit(limit);
}

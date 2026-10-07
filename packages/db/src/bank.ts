import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { bankImages } from "./schema/bank-images";

/**
 * Queries on the shared picture library (TEACH-84). `bank_images` is a `NON_TENANT_TABLES` table,
 * so these take the raw client (`unsafeDb`), as the README asks for non-tenant reads. Every read
 * serves `ready` rows only: `pending`, `rejected` and `retired` rows are never offered.
 */
export type BankImageRow = typeof bankImages.$inferSelect;
export type NewBankImage = typeof bankImages.$inferInsert;
export type BankOrientation = "landscape" | "portrait" | "square";

/** How many rows one lookup step reads (the §5.5 top 3, and a few spares for the exact gate). */
export const BANK_LOOKUP_LIMIT = 3;

/**
 * Store a row once. A second live row for the same `(subject, orientation, bands)` hits the
 * partial unique index and is skipped (`undefined`), so two lessons that place the same subject
 * at once keep one picture.
 */
export async function insertBankImage(
  db: Db,
  row: NewBankImage,
): Promise<BankImageRow | undefined> {
  const [created] = await db.insert(bankImages).values(row).onConflictDoNothing().returning();
  return created;
}

/** §5.5 step 1, the tag filter: ready rows of this subject, orientation and band, oldest first. */
export async function findBankImagesByTags(
  db: Db,
  tags: { subject: string; orientation: BankOrientation; band: string },
  limit = BANK_LOOKUP_LIMIT,
): Promise<BankImageRow[]> {
  return db
    .select()
    .from(bankImages)
    .where(
      and(
        eq(bankImages.status, "ready"),
        eq(bankImages.orientation, tags.orientation),
        eq(bankImages.subject, tags.subject),
        sql`${tags.band} = any(${bankImages.bands})`,
      ),
    )
    .orderBy(asc(bankImages.createdAt))
    .limit(limit);
}

/**
 * §5.5 step 2: the ready rows of this orientation and band nearest to `embedding` by exact cosine
 * (pgvector `<=>`, no ANN index), best first, with `similarity` = 1 − cosine distance. The caller
 * applies the calibrated threshold.
 */
export async function nearestBankImages(
  db: Db,
  filter: { orientation: BankOrientation; band: string },
  embedding: readonly number[],
  limit = BANK_LOOKUP_LIMIT,
): Promise<(BankImageRow & { similarity: number })[]> {
  const literal = `[${embedding.join(",")}]`;
  const distance = sql<number>`${bankImages.embedding} <=> ${literal}::vector`;
  const rows = await db
    .select({ row: bankImages, distance })
    .from(bankImages)
    .where(
      and(
        eq(bankImages.status, "ready"),
        eq(bankImages.orientation, filter.orientation),
        sql`${filter.band} = any(${bankImages.bands})`,
        isNotNull(bankImages.embedding),
      ),
    )
    .orderBy(distance)
    .limit(limit);
  return rows.map((r) => ({ ...r.row, similarity: 1 - Number(r.distance) }));
}

/** A reuse: `use_count` + 1 and `last_used_at` now. */
export async function touchBankImage(db: Db, id: string, now = new Date()): Promise<void> {
  await db
    .update(bankImages)
    .set({ useCount: sql`${bankImages.useCount} + 1`, lastUsedAt: now })
    .where(eq(bankImages.id, id));
}

/**
 * Take a row out of service for good (TEACH-84 FR 5: a reported picture, or a generator whose
 * terms changed): `status = 'retired'`, never served again, kept for audit. Internal only, no UI
 * yet: run `bun apps/worker/scripts/retire-bank-image.ts <id>`. Returns whether a row changed.
 */
export async function retireBankImage(db: Db, id: string): Promise<boolean> {
  const changed = await db
    .update(bankImages)
    .set({ status: "retired" })
    .where(eq(bankImages.id, id))
    .returning({ id: bankImages.id });
  return changed.length > 0;
}

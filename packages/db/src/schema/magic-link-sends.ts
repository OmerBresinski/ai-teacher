import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * `magic_link_sends` — one row per magic-link email the api sent (TEACH-300). `sendMagicLink`
 * counts the rows for one recipient in the last hour and all rows since UTC midnight, and skips
 * the send over either bound, so the counts survive restarts and hold across api replicas.
 *
 * `recipient` is an HMAC of the lower-cased address under `BETTER_AUTH_SECRET`, never the address.
 * No `workspace_id` (ADR 0007 justification): the send happens before sign-in, often before any
 * user exists; it is an abuse counter, not tenant data. Rows older than two days are deleted by
 * the worker's `auth.anonymous-cleanup` job.
 */
export const magicLinkSends = pgTable(
  "magic_link_sends",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    recipient: text("recipient").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("magic_link_sends_recipient_sent_at_idx").on(t.recipient, t.sentAt),
    index("magic_link_sends_sent_at_idx").on(t.sentAt),
  ],
);

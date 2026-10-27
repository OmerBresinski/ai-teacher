-- better-auth 1.7.3+ no longer writes accounts.issuer (added NOT NULL by 0008 for 1.7.2, TEACH-311),
-- and its schema check rejects auth requests while the column is required. The 1.7 upgrade
-- guide's Postgres route: drop the (issuer, account_id) index and relax the column; the column
-- stays, so a still-running 1.7.2 server keeps working during the deploy (TEACH-274 part b).
DROP INDEX "accounts_issuer_account_id_idx";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "issuer" DROP NOT NULL;
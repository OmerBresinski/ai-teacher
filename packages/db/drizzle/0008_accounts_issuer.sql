-- better-auth 1.7.2 keys OAuth accounts on (issuer, account_id) (TEACH-311). Added nullable,
-- backfilled, then made required, so the migration is safe on a non-empty table. Google is the
-- only provider that can have written rows; any other row makes SET NOT NULL fail on purpose.
ALTER TABLE "accounts" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "accounts" SET "issuer" = 'https://accounts.google.com' WHERE "provider_id" = 'google';--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_issuer_account_id_idx" ON "accounts" USING btree ("issuer","account_id");

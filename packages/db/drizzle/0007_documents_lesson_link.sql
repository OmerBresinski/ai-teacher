ALTER TABLE "documents" ADD COLUMN "lesson_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "continue_when_planned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "request_id" uuid;--> statement-breakpoint
CREATE INDEX "documents_workspace_id_lesson_id_idx" ON "documents" USING btree ("workspace_id","lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_workspace_id_request_id_idx" ON "documents" USING btree ("workspace_id","request_id") WHERE request_id is not null;--> statement-breakpoint
-- Backfill (TEACH-312): promote a worksheet's body.lessonId. Only uuid-shaped values name a row;
-- anything else (an imported file's key) stays null, as promotedColumns() writes it.
UPDATE "documents" SET "lesson_id" = ("body"->>'lessonId')::uuid
WHERE "kind" = 'worksheet' AND "body" ? 'lessonId'
  AND "body"->>'lessonId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

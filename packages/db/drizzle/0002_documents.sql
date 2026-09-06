CREATE TYPE "public"."document_kind" AS ENUM('lesson', 'worksheet', 'series');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "document_kind" NOT NULL,
	"body" jsonb NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"year_group" text,
	"theme_id" text,
	"item_count" integer NOT NULL,
	"cover" jsonb,
	"deleted_at" timestamp with time zone,
	"generating_job_id" uuid
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_workspace_id_idx" ON "documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "documents_workspace_id_kind_updated_at_idx" ON "documents" USING btree ("workspace_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "documents_workspace_id_kind_title_idx" ON "documents" USING btree ("workspace_id","kind","title");--> statement-breakpoint
CREATE INDEX "documents_workspace_id_deleted_at_idx" ON "documents" USING btree ("workspace_id","deleted_at");
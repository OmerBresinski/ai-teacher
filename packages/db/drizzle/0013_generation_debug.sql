CREATE TABLE "generation_debug" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"slide_index" integer,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_debug" ADD CONSTRAINT "generation_debug_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_debug" ADD CONSTRAINT "generation_debug_lesson_id_documents_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_debug_workspace_id_idx" ON "generation_debug" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "generation_debug_lesson_id_created_at_idx" ON "generation_debug" USING btree ("lesson_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_debug_created_at_idx" ON "generation_debug" USING btree ("created_at");
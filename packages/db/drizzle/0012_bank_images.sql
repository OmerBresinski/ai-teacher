CREATE TABLE "bank_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"orientation" text NOT NULL,
	"subject" text NOT NULL,
	"topic" text NOT NULL,
	"bands" text[] NOT NULL,
	"depicts" text[] DEFAULT '{}'::text[] NOT NULL,
	"style" text NOT NULL,
	"alt" text NOT NULL,
	"source" jsonb NOT NULL,
	"generator" text,
	"generator_terms" text,
	"prompt" text,
	"checks" jsonb NOT NULL,
	"status" text NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"reports" integer DEFAULT 0 NOT NULL,
	"caption" text,
	"embed_model" text,
	"embed_dims" integer,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bank_images_status_orientation_subject_idx" ON "bank_images" USING btree ("status","orientation","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_images_live_subject_uniq" ON "bank_images" USING btree ("subject","orientation","bands") WHERE "bank_images"."status" in ('pending', 'ready');
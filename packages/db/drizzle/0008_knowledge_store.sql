CREATE TYPE "public"."kb_alias_kind" AS ENUM('canonical', 'judge', 'teacher', 'human');--> statement-breakpoint
CREATE TYPE "public"."kb_alias_label" AS ENUM('positive', 'negative');--> statement-breakpoint
CREATE TYPE "public"."kb_edge_origin" AS ENUM('oak', 'spec', 'authored', 'model-proposed', 'nightly');--> statement-breakpoint
CREATE TYPE "public"."kb_edge_status" AS ENUM('verified', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."kb_edge_type" AS ENUM('aligned-to', 'deeper-version-of', 'supersedes', 'merge-candidate');--> statement-breakpoint
CREATE TYPE "public"."kb_fact_rank" AS ENUM('preferred', 'normal', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."kb_fact_signal_kind" AS ENUM('edit', 'delete', 'regenerate', 'panel-edit', 'report');--> statement-breakpoint
CREATE TYPE "public"."kb_fact_type" AS ENUM('keyIdea', 'misconception', 'vocabulary', 'workedExample', 'quotation', 'position');--> statement-breakpoint
CREATE TYPE "public"."kb_licence_class" AS ENUM('open', 'quotable', 'readonly');--> statement-breakpoint
CREATE TYPE "public"."kb_match_decision" AS ENUM('alias', 'hit', 'grey', 'miss');--> statement-breakpoint
CREATE TYPE "public"."kb_pack_status" AS ENUM('draft', 'verified', 'flagged', 'retired');--> statement-breakpoint
CREATE TYPE "public"."kb_provenance" AS ENUM('human-reviewed', 'verified', 'model-proposed');--> statement-breakpoint
CREATE TYPE "public"."kb_section_status" AS ENUM('draft', 'verified', 'flagged', 'retired');--> statement-breakpoint
CREATE TYPE "public"."kb_volatility" AS ENUM('timeless', 'slow', 'fast');--> statement-breakpoint
CREATE TABLE "kb_edge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid,
	"to_uri" text,
	"type" "kb_edge_type" NOT NULL,
	"origin" "kb_edge_origin" NOT NULL,
	"status" "kb_edge_status" DEFAULT 'unverified' NOT NULL,
	"weight" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_edge_one_target_check" CHECK (("kb_edge"."to_id" is null) <> ("kb_edge"."to_uri" is null))
);
--> statement-breakpoint
CREATE TABLE "kb_exclusion_phrase" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"text" text NOT NULL,
	"embedding_model" text,
	"dims" integer,
	"vector" vector,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_fact_signal" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" "kb_fact_signal_kind" NOT NULL,
	"pack_fact_ids" uuid[] NOT NULL,
	"subject" text NOT NULL,
	"band" integer NOT NULL,
	"teacher_pseudonym" text NOT NULL,
	"school_id" text,
	"lesson_id" uuid,
	"before_text" text,
	"after_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_fact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"type" "kb_fact_type" NOT NULL,
	"text" text NOT NULL,
	"term_id" text,
	"sense" text,
	"band" integer,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"single_source" boolean DEFAULT false NOT NULL,
	"rank" "kb_fact_rank" DEFAULT 'normal' NOT NULL,
	"deprecated_reason" text,
	"supersedes_id" uuid,
	"superseded_at" timestamp with time zone,
	"superseded_by" uuid,
	"provenance" "kb_provenance" NOT NULL,
	"checker_models" text[] DEFAULT '{}'::text[] NOT NULL,
	"check_confidence" real,
	"pipeline_version" text NOT NULL,
	"volatility" "kb_volatility" DEFAULT 'timeless' NOT NULL,
	"as_of" timestamp with time zone,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"refresh_after" timestamp with time zone,
	"source_fetched_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_fact_not_self_supersede_check" CHECK ("kb_fact"."supersedes_id" is distinct from "kb_fact"."id")
);
--> statement-breakpoint
CREATE TABLE "kb_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text,
	"licence" text NOT NULL,
	"licence_class" "kb_licence_class" NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"revision_id" text,
	"etag" text,
	"raw_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_match_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lesson_id" uuid,
	"objective_hash" text NOT NULL,
	"subject" text NOT NULL,
	"band" integer NOT NULL,
	"embedding_model" text,
	"dims" integer,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" "kb_match_decision" NOT NULL,
	"verdict" jsonb,
	"matched_section_id" uuid,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_pack" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"subject" text NOT NULL,
	"band_lo" integer NOT NULL,
	"band_hi" integer NOT NULL,
	"status" "kb_pack_status" DEFAULT 'draft' NOT NULL,
	"scope_title" text NOT NULL,
	"scope_statement" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_section_alias" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"kind" "kb_alias_kind" NOT NULL,
	"label" "kb_alias_label" NOT NULL,
	"embedding_model" text,
	"dims" integer,
	"vector" vector,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_section_embedding" (
	"section_id" uuid NOT NULL,
	"embedding_model" text NOT NULL,
	"dims" integer NOT NULL,
	"card_template_version" text NOT NULL,
	"vector" vector NOT NULL,
	"tsv" "tsvector",
	"built_from_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_section_embedding_section_id_embedding_model_dims_pk" PRIMARY KEY("section_id","embedding_model","dims")
);
--> statement-breakpoint
CREATE TABLE "kb_section" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pack_id" uuid NOT NULL,
	"band" integer NOT NULL,
	"outcome" text NOT NULL,
	"outcome_norm" text NOT NULL,
	"scope_line" text NOT NULL,
	"key_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"aligned_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"prior_knowledge" text,
	"status" "kb_section_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"card_text" text,
	"built_from_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "kb_source_sentence" (
	"source_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "kb_source_sentence_source_id_seq_pk" PRIMARY KEY("source_id","seq")
);
--> statement-breakpoint
CREATE TABLE "kb_threshold" (
	"subject" text NOT NULL,
	"embedding_model" text NOT NULL,
	"dims" integer NOT NULL,
	"card_template_version" text NOT NULL,
	"tau_hit" real NOT NULL,
	"tau_grey" real NOT NULL,
	"kw_floor" real NOT NULL,
	"margin_min" real NOT NULL,
	"tau_excl" real NOT NULL,
	"calibrated_at" timestamp with time zone NOT NULL,
	"n_labels" integer NOT NULL,
	CONSTRAINT "kb_threshold_subject_embedding_model_dims_card_template_version_pk" PRIMARY KEY("subject","embedding_model","dims","card_template_version")
);
--> statement-breakpoint
ALTER TABLE "kb_edge" ADD CONSTRAINT "kb_edge_from_id_kb_section_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."kb_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_edge" ADD CONSTRAINT "kb_edge_to_id_kb_section_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."kb_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_exclusion_phrase" ADD CONSTRAINT "kb_exclusion_phrase_section_id_kb_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."kb_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_fact" ADD CONSTRAINT "kb_fact_section_id_kb_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."kb_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_section_alias" ADD CONSTRAINT "kb_section_alias_section_id_kb_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."kb_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_section_embedding" ADD CONSTRAINT "kb_section_embedding_section_id_kb_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."kb_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_section" ADD CONSTRAINT "kb_section_pack_id_kb_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."kb_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_source_sentence" ADD CONSTRAINT "kb_source_sentence_source_id_kb_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."kb_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_edge_from_id_idx" ON "kb_edge" USING btree ("from_id","type");--> statement-breakpoint
CREATE INDEX "kb_edge_to_id_idx" ON "kb_edge" USING btree ("to_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_edge_from_type_to_id_uidx" ON "kb_edge" USING btree ("from_id","type","to_id") WHERE "kb_edge"."to_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_edge_from_type_to_uri_uidx" ON "kb_edge" USING btree ("from_id","type","to_uri") WHERE "kb_edge"."to_uri" is not null;--> statement-breakpoint
CREATE INDEX "kb_exclusion_phrase_section_id_idx" ON "kb_exclusion_phrase" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "kb_fact_signal_created_at_idx" ON "kb_fact_signal" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "kb_fact_section_id_idx" ON "kb_fact" USING btree ("section_id","superseded_at");--> statement-breakpoint
CREATE INDEX "kb_fact_supersedes_id_idx" ON "kb_fact" USING btree ("supersedes_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_fact_one_current_definition_uidx" ON "kb_fact" USING btree ("section_id","term_id",coalesce("sense", ''),coalesce("band", -1)) WHERE "kb_fact"."type" = 'vocabulary' and "kb_fact"."term_id" is not null and "kb_fact"."superseded_at" is null and "kb_fact"."rank" <> 'deprecated';--> statement-breakpoint
CREATE UNIQUE INDEX "kb_source_url_content_hash_uidx" ON "kb_source" USING btree ("url","content_hash");--> statement-breakpoint
CREATE INDEX "kb_match_log_objective_hash_idx" ON "kb_match_log" USING btree ("objective_hash");--> statement-breakpoint
CREATE INDEX "kb_match_log_lesson_id_idx" ON "kb_match_log" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_pack_slug_uidx" ON "kb_pack" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "kb_pack_subject_idx" ON "kb_pack" USING btree ("subject","status");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_section_alias_section_hash_uidx" ON "kb_section_alias" USING btree ("section_id","text_hash");--> statement-breakpoint
CREATE INDEX "kb_section_alias_text_hash_idx" ON "kb_section_alias" USING btree ("text_hash");--> statement-breakpoint
CREATE INDEX "kb_section_pack_id_idx" ON "kb_section" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "kb_section_band_idx" ON "kb_section" USING btree ("band");--> statement-breakpoint
CREATE INDEX "kb_section_outcome_norm_idx" ON "kb_section" USING btree ("outcome_norm");--> statement-breakpoint
CREATE VIEW "public"."kb_fact_current" AS (
  select
    f.id, f.section_id, f.type, f.text, f.term_id, f.sense, f.band, f.evidence, f.single_source,
    f.rank,
    (case f.rank when 'preferred' then 0 else 1 end)::integer as rank_order,
    f.provenance, f.checker_models, f.check_confidence, f.pipeline_version, f.volatility,
    f.as_of, f.valid_from, f.valid_to, f.refresh_after, f.source_fetched_at, f.verified_at,
    f.verified_by, f.created_at
  from kb_fact f
  where f.superseded_at is null
    and f.rank <> 'deprecated'
    and f.provenance in ('verified', 'human-reviewed')
    and (f.valid_from is null or f.valid_from <= now())
    and (f.valid_to is null or f.valid_to > now())
    and not (
      (f.volatility = 'fast' or f.as_of is not null)
      and f.refresh_after is not null
      and f.refresh_after < now()
    )
);--> statement-breakpoint
CREATE VIEW "public"."kb_section_fact_counts" AS (
  select
    s.id as section_id,
    count(c.id) filter (where c.type = 'keyIdea')::integer as key_ideas,
    count(c.id) filter (where c.type = 'misconception')::integer as misconceptions,
    count(c.id) filter (where c.type = 'vocabulary')::integer as vocabulary,
    count(c.id) filter (where c.type = 'workedExample')::integer as worked_examples,
    count(c.id) filter (where c.type = 'quotation')::integer as quotations,
    count(c.id) filter (where c.type = 'position')::integer as positions,
    count(c.id)::integer as total
  from kb_section s
  left join kb_fact_current c on c.section_id = s.id
  group by s.id
);
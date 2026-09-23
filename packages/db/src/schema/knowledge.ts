import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Knowledge store (topic graph) tables — TG-2 of the topic-graph PRD (ADR 0029 pending).
 *
 * A **pack** is one topic; a **section** is one objective's worth of material with an index card
 * for matching and append-only **fact** rows with evidence into stored **sources**. Everything
 * here is global, shared knowledge, **not** tenant data: no `workspace_id`, no `forWorkspace()`.
 * Justification (ADR 0007 allow-list): packs are built from open-licence curriculum and web
 * sources and reused by every Workspace; `kb_match_log` and `kb_fact_signal` hold only hashes,
 * ids, a pseudonymous teacher id and text that has already been through the pupil-name strip
 * (PRD §5.6). SQL names carry the `kb_` prefix so `kb_source` (a cited web page) is never
 * confused with `sources` (a teacher upload, ADR 0027).
 *
 * Rules the schema enforces structurally (PRD §2):
 * - TG-R07 facts are append-only: `supersedes_id` / `superseded_at` / `superseded_by` are the
 *   only columns a later write touches; `kb_fact_current` hides superseded and deprecated rows.
 * - TG-R05 `kb_fact_current` serves only `verified` and `human-reviewed` provenance and drops
 *   fast / `as_of` facts past `refresh_after` (settled facts are served stale, PRD §4.4).
 * - One current vocabulary definition per (section, term, sense, band): partial unique index
 *   `kb_fact_one_current_definition_uidx`.
 * - Four edge types only (`kb_edge_type` enum).
 * - Vectors are untyped `vector` columns so the dimension is per row; every embedding row records
 *   `embedding_model` + `dims` (+ `card_template_version` and `built_from_hash` on the card), so a
 *   new model can be backfilled and compared before cut-over. No HNSW / IVF index on purpose:
 *   lookups filter by subject and band first and scan exactly (PRD §5.5 step 3).
 */

// ---------------------------------------------------------------------------------------------
// Column types pgvector / full-text need that drizzle does not ship in a dimension-free form.
// ---------------------------------------------------------------------------------------------

/**
 * pgvector `vector` without a fixed dimension. Rows of different `dims` may share a column; the
 * `<=>` operator errors if the two sides differ, which is why every query filters on `dims`.
 * Wire format is pgvector's `[0.1,0.2,…]` text form.
 */
export const vectorAny = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value) as number[];
  },
});

/** Postgres `tsvector`; written through `to_tsvector('english', …)` in SQL, read as text. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const kbPackStatus = pgEnum("kb_pack_status", ["draft", "verified", "flagged", "retired"]);
export const kbSectionStatus = pgEnum("kb_section_status", [
  "draft",
  "verified",
  "flagged",
  "retired",
]);
export const kbAliasKind = pgEnum("kb_alias_kind", ["canonical", "judge", "teacher", "human"]);
export const kbAliasLabel = pgEnum("kb_alias_label", ["positive", "negative"]);
export const kbFactType = pgEnum("kb_fact_type", [
  "keyIdea",
  "misconception",
  "vocabulary",
  "workedExample",
  "quotation",
  "position",
]);
export const kbFactRank = pgEnum("kb_fact_rank", ["preferred", "normal", "deprecated"]);
export const kbProvenance = pgEnum("kb_provenance", [
  "human-reviewed",
  "verified",
  "model-proposed",
]);
export const kbVolatility = pgEnum("kb_volatility", ["timeless", "slow", "fast"]);
export const kbLicenceClass = pgEnum("kb_licence_class", ["open", "quotable", "readonly"]);
export const kbEdgeType = pgEnum("kb_edge_type", [
  "aligned-to",
  "deeper-version-of",
  "supersedes",
  "merge-candidate",
]);
export const kbEdgeOrigin = pgEnum("kb_edge_origin", [
  "oak",
  "spec",
  "authored",
  "model-proposed",
  "nightly",
]);
export const kbEdgeStatus = pgEnum("kb_edge_status", ["verified", "unverified"]);
export const kbMatchDecision = pgEnum("kb_match_decision", ["alias", "hit", "grey", "miss"]);
export const kbFactSignalKind = pgEnum("kb_fact_signal_kind", [
  "edit",
  "delete",
  "regenerate",
  "panel-edit",
  "report",
]);

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** One topic. `scope_*` and `version` are derived from the sections and rebuilt on every write. */
export const packs = pgTable(
  "kb_pack",
  {
    /** App-minted (`newId()`), no database default. */
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    subject: text("subject").notNull(),
    bandLo: integer("band_lo").notNull(),
    bandHi: integer("band_hi").notNull(),
    status: kbPackStatus("status").notNull().default("draft"),
    scopeTitle: text("scope_title").notNull(),
    scopeStatement: text("scope_statement").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("kb_pack_slug_uidx").on(t.slug),
    index("kb_pack_subject_idx").on(t.subject, t.status),
  ],
);

/**
 * One objective ≈ one Oak lesson at seed time. `outcome_norm` is `normaliseText(outcome)` and is
 * the only automatic merge key (PRD §5.5 add-or-new). `card_text` and `built_from_hash` are
 * derived by `rebuildDerived()`; the embedding of `card_text` lives in `kb_section_embedding`.
 */
export const sections = pgTable(
  "kb_section",
  {
    id: uuid("id").primaryKey(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => packs.id, { onDelete: "cascade" }),
    band: integer("band").notNull(),
    outcome: text("outcome").notNull(),
    outcomeNorm: text("outcome_norm").notNull(),
    /** Positive scope only; exclusions are rows in `kb_exclusion_phrase` (TG-R04). */
    scopeLine: text("scope_line").notNull(),
    /** 3–6 model-written key words; stemmed into `kb_section_embedding.tsv` on rebuild. */
    keyWords: text("key_words").array().notNull().default(sql`'{}'::text[]`),
    /** External URIs: Oak lesson, NC descriptor, spec code + bullet. */
    alignedTo: text("aligned_to").array().notNull().default(sql`'{}'::text[]`),
    priorKnowledge: text("prior_knowledge"),
    status: kbSectionStatus("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    cardText: text("card_text"),
    builtFromHash: text("built_from_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
  },
  (t) => [
    index("kb_section_pack_id_idx").on(t.packId),
    index("kb_section_band_idx").on(t.band),
    index("kb_section_outcome_norm_idx").on(t.outcomeNorm),
  ],
);

/** The card embedding, one row per (section, model, dims) so models can be compared. */
export const sectionEmbeddings = pgTable(
  "kb_section_embedding",
  {
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    embeddingModel: text("embedding_model").notNull(),
    dims: integer("dims").notNull(),
    cardTemplateVersion: text("card_template_version").notNull(),
    vector: vectorAny("vector").notNull(),
    /** `to_tsvector('english', key words)`; overlap is computed by the lookup, no BM25. */
    tsv: tsvector("tsv"),
    builtFromHash: text("built_from_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sectionId, t.embeddingModel, t.dims] })],
);

/**
 * Alternative phrasings of a section's objective. `text_hash` is `hashText(text)`; exact lookup
 * by hash is step 1 of the lookup. A section's cosine score is the max over its positive aliases
 * and its card. The same text may be a positive alias of one section and a negative of another,
 * so uniqueness is per (section, hash). The vector is optional: a judge verdict stored before the
 * embedding vendor answered still gives an exact hit.
 */
export const sectionAliases = pgTable(
  "kb_section_alias",
  {
    id: uuid("id").primaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    kind: kbAliasKind("kind").notNull(),
    label: kbAliasLabel("label").notNull(),
    embeddingModel: text("embedding_model"),
    dims: integer("dims"),
    vector: vectorAny("vector"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("kb_section_alias_section_hash_uidx").on(t.sectionId, t.textHash),
    index("kb_section_alias_text_hash_idx").on(t.textHash),
  ],
);

/** "Freud's critics": proximity to one of these forces the grey zone (TG-R04). */
export const exclusionPhrases = pgTable(
  "kb_exclusion_phrase",
  {
    id: uuid("id").primaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    embeddingModel: text("embedding_model"),
    dims: integer("dims"),
    vector: vectorAny("vector"),
    createdAt: createdAt(),
  },
  (t) => [index("kb_exclusion_phrase_section_id_idx").on(t.sectionId)],
);

/** One cited span: sentence ids into `kb_source_sentence` for one source (TG-R02). */
export interface FactEvidence {
  sourceId: string;
  sentenceIds: number[];
}

/** Append-only (TG-R07). See the module comment for what a later write may touch. */
export const facts = pgTable(
  "kb_fact",
  {
    id: uuid("id").primaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    type: kbFactType("type").notNull(),
    /** Molecular: names its own subject and frame. */
    text: text("text").notNull(),
    // Vocabulary only.
    termId: text("term_id"),
    sense: text("sense"),
    band: integer("band"),
    evidence: jsonb("evidence").$type<FactEvidence[]>().notNull().default([]),
    /** Numbers, dates and attributions with one source (PRD §4.2 step 5). */
    singleSource: boolean("single_source").notNull().default(false),
    rank: kbFactRank("rank").notNull().default("normal"),
    deprecatedReason: text("deprecated_reason"),
    supersedesId: uuid("supersedes_id"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
    provenance: kbProvenance("provenance").notNull(),
    checkerModels: text("checker_models").array().notNull().default(sql`'{}'::text[]`),
    checkConfidence: real("check_confidence"),
    pipelineVersion: text("pipeline_version").notNull(),
    volatility: kbVolatility("volatility").notNull().default("timeless"),
    asOf: timestamp("as_of", { withTimezone: true }),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    refreshAfter: timestamp("refresh_after", { withTimezone: true }),
    sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    createdAt: createdAt(),
  },
  (t) => [
    check("kb_fact_not_self_supersede_check", sql`${t.supersedesId} is distinct from ${t.id}`),
    index("kb_fact_section_id_idx").on(t.sectionId, t.supersededAt),
    index("kb_fact_supersedes_id_idx").on(t.supersedesId),
    // One current definition per (section, term, sense, band). NULL sense/band are folded so
    // Postgres' NULL-is-distinct rule cannot let two current rows through.
    uniqueIndex("kb_fact_one_current_definition_uidx")
      .on(t.sectionId, t.termId, sql`coalesce(${t.sense}, '')`, sql`coalesce(${t.band}, -1)`)
      .where(
        sql`${t.type} = 'vocabulary' and ${t.termId} is not null and ${t.supersededAt} is null and ${t.rank} <> 'deprecated'`,
      ),
  ],
);

/** A fetched page. Licence class decides what is stored and served (PRD §4.1). */
export const knowledgeSources = pgTable(
  "kb_source",
  {
    id: uuid("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    publisher: text("publisher"),
    licence: text("licence").notNull(),
    licenceClass: kbLicenceClass("licence_class").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    contentHash: text("content_hash").notNull(),
    revisionId: text("revision_id"),
    etag: text("etag"),
    /** Bucket key of the raw page; open class only. */
    rawStorageKey: text("raw_storage_key"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("kb_source_url_content_hash_uidx").on(t.url, t.contentHash)],
);

/** Every sentence for open sources; only the cited ones for quotable (PRD §4.1). */
export const sourceSentences = pgTable(
  "kb_source_sentence",
  {
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    text: text("text").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.seq] })],
);

/** Four edge types only. `to_id` is a section; `to_uri` an external URI (exactly one is set). */
export const edges = pgTable(
  "kb_edge",
  {
    id: uuid("id").primaryKey(),
    fromId: uuid("from_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    toId: uuid("to_id").references(() => sections.id, { onDelete: "cascade" }),
    toUri: text("to_uri"),
    type: kbEdgeType("type").notNull(),
    origin: kbEdgeOrigin("origin").notNull(),
    status: kbEdgeStatus("status").notNull().default("unverified"),
    weight: real("weight"),
    createdAt: createdAt(),
  },
  (t) => [
    check("kb_edge_one_target_check", sql`(${t.toId} is null) <> (${t.toUri} is null)`),
    index("kb_edge_from_id_idx").on(t.fromId, t.type),
    index("kb_edge_to_id_idx").on(t.toId),
    uniqueIndex("kb_edge_from_type_to_id_uidx")
      .on(t.fromId, t.type, t.toId)
      .where(sql`${t.toId} is not null`),
    uniqueIndex("kb_edge_from_type_to_uri_uidx")
      .on(t.fromId, t.type, t.toUri)
      .where(sql`${t.toUri} is not null`),
  ],
);

/** Calibrated gates (TG-6). Until a row exists, nothing is a clear hit (PRD §5.5). */
export const thresholds = pgTable(
  "kb_threshold",
  {
    subject: text("subject").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    dims: integer("dims").notNull(),
    cardTemplateVersion: text("card_template_version").notNull(),
    tauHit: real("tau_hit").notNull(),
    tauGrey: real("tau_grey").notNull(),
    kwFloor: real("kw_floor").notNull(),
    marginMin: real("margin_min").notNull(),
    tauExcl: real("tau_excl").notNull(),
    calibratedAt: timestamp("calibrated_at", { withTimezone: true }).notNull(),
    nLabels: integer("n_labels").notNull(),
  },
  (t) => [primaryKey({ columns: [t.subject, t.embeddingModel, t.dims, t.cardTemplateVersion] })],
);

/** One candidate as logged: what the scan returned and what the gates saw. */
export interface MatchCandidateLog {
  sectionId: string;
  packId: string;
  cosine: number;
  keyWordOverlap: number | null;
  exclusionSimilarity: number | null;
}

/** Every lookup decision (PRD §5.5 step 8). Append-only. */
export const matchLog = pgTable(
  "kb_match_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    lessonId: uuid("lesson_id"),
    objectiveHash: text("objective_hash").notNull(),
    subject: text("subject").notNull(),
    band: integer("band").notNull(),
    embeddingModel: text("embedding_model"),
    dims: integer("dims"),
    candidates: jsonb("candidates").$type<MatchCandidateLog[]>().notNull().default([]),
    decision: kbMatchDecision("decision").notNull(),
    /** The select call's answer, when one ran; shape owned by TG-5. */
    verdict: jsonb("verdict").$type<Record<string, unknown>>(),
    matchedSectionId: uuid("matched_section_id"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("kb_match_log_objective_hash_idx").on(t.objectiveHash),
    index("kb_match_log_lesson_id_idx").on(t.lessonId),
  ],
);

/**
 * TG-13: teacher usage signals, write-only from the product (PRD §5.6). Text has been through the
 * pupil-name strip before it reaches here; `teacher_pseudonym` is never a user id.
 */
export const factSignals = pgTable(
  "kb_fact_signal",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: kbFactSignalKind("kind").notNull(),
    packFactIds: uuid("pack_fact_ids").array().notNull(),
    subject: text("subject").notNull(),
    band: integer("band").notNull(),
    teacherPseudonym: text("teacher_pseudonym").notNull(),
    schoolId: text("school_id"),
    lessonId: uuid("lesson_id"),
    beforeText: text("before_text"),
    afterText: text("after_text"),
    createdAt: createdAt(),
  },
  (t) => [index("kb_fact_signal_created_at_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------------------------
// Views (derived, never stored numbers)
// ---------------------------------------------------------------------------------------------

/**
 * Servable facts: not superseded, not deprecated, provenance `verified` or `human-reviewed`
 * (TG-R05), inside `valid_from`/`valid_to`, and — for fast or `as_of` facts only — not past
 * `refresh_after` (PRD §4.4: settled facts are served stale and refreshed; volatile ones block).
 * `rank_order` (0 preferred, 1 normal) lets callers pick the best-ranked row per key.
 */
export const factCurrent = pgView("kb_fact_current", {
  id: uuid("id").notNull(),
  sectionId: uuid("section_id").notNull(),
  type: kbFactType("type").notNull(),
  text: text("text").notNull(),
  termId: text("term_id"),
  sense: text("sense"),
  band: integer("band"),
  evidence: jsonb("evidence").$type<FactEvidence[]>().notNull(),
  singleSource: boolean("single_source").notNull(),
  rank: kbFactRank("rank").notNull(),
  rankOrder: integer("rank_order").notNull(),
  provenance: kbProvenance("provenance").notNull(),
  checkerModels: text("checker_models").array().notNull(),
  checkConfidence: real("check_confidence"),
  pipelineVersion: text("pipeline_version").notNull(),
  volatility: kbVolatility("volatility").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  refreshAfter: timestamp("refresh_after", { withTimezone: true }),
  sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}).as(sql`
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
`);

/** Servable fact counts per section and type, from `kb_fact_current`. Coverage reads these. */
export const sectionFactCounts = pgView("kb_section_fact_counts", {
  sectionId: uuid("section_id").notNull(),
  keyIdeas: integer("key_ideas").notNull(),
  misconceptions: integer("misconceptions").notNull(),
  vocabulary: integer("vocabulary").notNull(),
  workedExamples: integer("worked_examples").notNull(),
  quotations: integer("quotations").notNull(),
  positions: integer("positions").notNull(),
  total: integer("total").notNull(),
}).as(sql`
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
`);

/** Every knowledge-store table, for classification, truncation and tests. */
export const KNOWLEDGE_TABLES_LIST = [
  packs,
  sections,
  sectionEmbeddings,
  sectionAliases,
  exclusionPhrases,
  facts,
  knowledgeSources,
  sourceSentences,
  edges,
  thresholds,
  matchLog,
  factSignals,
] as const;

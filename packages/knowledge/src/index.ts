/**
 * `@tj/knowledge` — typed repository over the knowledge store (topic graph) tables in `@tj/db`
 * (`kb_*`, migration 0008; PRD TG-2). Consumed from source. Every function takes a
 * `KnowledgeDb` first: `createDb(url).unsafeDb`, or the transaction handle that
 * `withSubjectLock()` / `db.transaction()` passes to its callback. The tables are global, so
 * there is no `forWorkspace()`.
 *
 * ## API surface
 *
 * Text keys (shared by every writer and reader, `text.ts`)
 * - `normaliseText(text): string` — NFKC, lower-case, straight quotes, collapsed spaces, no trailing punctuation
 * - `hashText(text): string` — sha256 hex of `normaliseText(text)`; the `kb_section_alias.text_hash` key
 * - `hashValue(value): string` — stable sha256 over JSON; used for `built_from_hash`
 *
 * Packs
 * - `createPack(db, input: NewPack): Promise<PackRow>`
 * - `getPack(db, id): Promise<PackRow | null>` · `findPackBySlug(db, slug): Promise<PackRow | null>`
 * - `setPackStatus(db, id, status: PackStatus): Promise<PackRow>` — `flagged` drops out of lookup at once (TG-R05)
 * - `setPackScope(db, id, { scopeTitle, scopeStatement }): Promise<PackRow>` — model-written scope; bumps version
 *
 * Sections, aliases, exclusion phrases, embeddings
 * - `addSection(db, input: NewSection): Promise<SectionRow>` — inserts the canonical positive alias and exclusion rows too
 * - `getSection(db, id): Promise<SectionRow | null>`
 * - `findSectionsByOutcome(db, outcome, { subject? }): Promise<(SectionRow & { subject })[]>` — exact normalised match, the only automatic merge key
 * - `addAlias(db, input: NewAlias): Promise<AliasRow>` — upsert per (section, text hash); a later verdict overwrites label/kind/vector
 * - `setAliasEmbedding(db, aliasId, embedding: Embedding): Promise<AliasRow>` · `listAliases(db, sectionId)`
 * - `addExclusionPhrase(db, { sectionId, text, embedding? }): Promise<ExclusionPhraseRow>`
 * - `setExclusionPhraseEmbedding(db, phraseId, embedding): Promise<ExclusionPhraseRow>` · `listExclusionPhrases(db, sectionId)`
 * - `putSectionEmbedding(db, { sectionId, embeddingModel, dims, vector, cardTemplateVersion, builtFromHash }): Promise<SectionEmbeddingRow>` — upsert per (section, model, dims); derives `tsv` from key words
 * - `listSectionsNeedingEmbedding(db, { embeddingModel, dims, limit? }): Promise<SectionRow[]>` — missing or stale (hash differs) embeddings
 *
 * Facts (append-only, TG-R07)
 * - `appendFacts(db, sectionId, facts: NewFact[], { requireEvidence? }): Promise<FactRow[]>` — `supersedesId` marks the old row in the same tx; by default every cited sentence must exist (TG-R02) and quotations must be verbatim (TG-R03)
 * - `deprecateFact(db, factId, reason, { verifiedBy, pipelineVersion? }): Promise<FactRow>` — new `deprecated` row superseding the old
 * - `listCurrentFacts(db, sectionIds): Promise<FactCurrentRow[]>` — from `kb_fact_current`, best rank first
 * - `listFactHistory(db, sectionId): Promise<FactRow[]>` — every row, oldest first
 * - `getSectionFactCounts(db, sectionIds): Promise<SectionFactCountsRow[]>` — from `kb_section_fact_counts`
 *
 * Derived artefacts
 * - `buildCardText({ subject, band, packTitle, outcome, scopeLine, keyWords }): string` — template `CARD_TEMPLATE_VERSION`
 * - `rebuildDerived(db, sectionId): Promise<DerivedSection>` — card text + `builtFromHash` from current rows, version bump when changed, counts, `needsEmbedding`
 *
 * Locks
 * - `withSubjectLock(db, subject, fn: (tx: KnowledgeDb) => Promise<T>): Promise<T>` — `pg_advisory_xact_lock(SUBJECT_LOCK_NAMESPACE, hashtext(subject))`
 *
 * Lookup primitives (rank, never decide)
 * - `findAlias(db, textHash, { packStatuses? }): Promise<AliasHit[]>` — step 1; all aliases with that hash on current sections of servable packs
 * - `findCandidates(db, filter: CandidateFilter, vector: number[], k = 3): Promise<Candidate[]>` — step 3; subject + band ± slack filter, exact cosine over card + positive aliases (max per section), key-word overlap, nearest exclusion phrase
 * - `getThreshold(db, key: ThresholdKey): Promise<ThresholdRow | null>` · `upsertThreshold(db, row: ThresholdRow)`
 * - `logMatch(db, entry: NewMatchLog): Promise<MatchLogRow>` — step 8
 * - `recordFactSignal(db, signal: NewFactSignal): Promise<void>` — TG-13, write-only
 *
 * Sources, sentences, edges
 * - `createSource(db, input: NewKnowledgeSource): Promise<KnowledgeSourceRow>` — with numbered sentences; licence class enforced structurally; idempotent on (url, contentHash)
 * - `getSource(db, id)` · `findSentences(db, sourceId, seqs): Promise<SourceSentenceRow[]>`
 * - `findMissingEvidence(db, evidence: FactEvidence[]): Promise<FactEvidence[]>` — empty means grounded
 * - `addEdge(db, edge: NewEdge): Promise<EdgeRow>` — four types only; idempotent · `listEdges(db, fromId)`
 *
 * Errors: `KnowledgeStoreError` with `code: KnowledgeStoreErrorCode`.
 */
export * from "./store";
export { hashText, hashValue, normaliseText } from "./text";

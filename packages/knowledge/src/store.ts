import type { Db } from "@tj/db";
import {
  edges,
  exclusionPhrases,
  type FactEvidence,
  factCurrent,
  factSignals,
  facts,
  knowledgeSources,
  type MatchCandidateLog,
  matchLog,
  packs,
  sectionAliases,
  sectionEmbeddings,
  sectionFactCounts,
  sections,
  sourceSentences,
  thresholds,
} from "@tj/db/schema";
import { newId } from "@tj/domain";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { hashText, hashValue, normaliseText } from "./text";

/**
 * Knowledge store repository (TG-2). Every function takes a `KnowledgeDb`: the `unsafeDb` from
 * `createDb()` or the transaction handle `withSubjectLock()` / `db.transaction()` passes to its
 * callback. The tables are global (no Workspace), so there is no `forWorkspace()` here.
 *
 * What the store decides on its own is structural only: hashes, dimension checks, "does the cited
 * sentence exist", "is this quotation verbatim in that sentence", append-only bookkeeping. Which
 * section an objective belongs to, whether a fact is true, whether two sections are duplicates —
 * those are answered by thresholds on scores or by a model call in the lookup and write-through
 * jobs (TG-5, TG-8), never here.
 */

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** The pooled Drizzle client or the transaction handle inside `db.transaction()`. */
export type KnowledgeDb = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type PackRow = typeof packs.$inferSelect;
export type SectionRow = typeof sections.$inferSelect;
export type SectionEmbeddingRow = typeof sectionEmbeddings.$inferSelect;
export type AliasRow = typeof sectionAliases.$inferSelect;
export type ExclusionPhraseRow = typeof exclusionPhrases.$inferSelect;
export type FactRow = typeof facts.$inferSelect;
export type FactCurrentRow = typeof factCurrent.$inferSelect;
export type SectionFactCountsRow = typeof sectionFactCounts.$inferSelect;
export type KnowledgeSourceRow = typeof knowledgeSources.$inferSelect;
export type SourceSentenceRow = typeof sourceSentences.$inferSelect;
export type EdgeRow = typeof edges.$inferSelect;
export type ThresholdRow = typeof thresholds.$inferSelect;
export type MatchLogRow = typeof matchLog.$inferSelect;
export type FactSignalRow = typeof factSignals.$inferSelect;

export type PackStatus = PackRow["status"];
export type SectionStatus = SectionRow["status"];
export type FactType = FactRow["type"];
export type FactRank = FactRow["rank"];
export type Provenance = FactRow["provenance"];
export type Volatility = FactRow["volatility"];
export type AliasKind = AliasRow["kind"];
export type AliasLabel = AliasRow["label"];
export type LicenceClass = KnowledgeSourceRow["licenceClass"];
export type EdgeType = EdgeRow["type"];
export type EdgeOrigin = EdgeRow["origin"];
export type MatchDecision = MatchLogRow["decision"];
export type FactSignalKind = FactSignalRow["kind"];
export type { FactEvidence, MatchCandidateLog };

/** An embedding as the store records it: the vector plus the model and dimension that made it. */
export interface Embedding {
  embeddingModel: string;
  dims: number;
  vector: number[];
}

export interface NewPack {
  id?: string;
  slug: string;
  subject: string;
  bandLo: number;
  bandHi: number;
  status?: PackStatus;
  scopeTitle: string;
  scopeStatement?: string;
}

export interface NewSection {
  id?: string;
  packId: string;
  band: number;
  /** "I can …" — also becomes the section's canonical positive alias. */
  outcome: string;
  /** Positive scope only (TG-R04). */
  scopeLine: string;
  keyWords?: string[];
  alignedTo?: string[];
  priorKnowledge?: string;
  status?: SectionStatus;
  /** Stored as `kb_exclusion_phrase` rows without vectors; embed them with `setExclusionPhraseEmbedding`. */
  exclusionPhrases?: string[];
}

export interface NewAlias {
  sectionId: string;
  text: string;
  kind: AliasKind;
  label: AliasLabel;
  embedding?: Embedding;
}

export interface NewFact {
  id?: string;
  type: FactType;
  /**
   * Molecular statement. For `quotation` this is the verbatim quote itself and must appear inside
   * one of the cited sentences (TG-R03), checked structurally on append.
   */
  text: string;
  termId?: string;
  sense?: string;
  band?: number;
  evidence: FactEvidence[];
  singleSource?: boolean;
  rank?: FactRank;
  deprecatedReason?: string;
  /** The row this one replaces; it gets `superseded_at` / `superseded_by` in the same transaction. */
  supersedesId?: string;
  provenance: Provenance;
  checkerModels?: string[];
  checkConfidence?: number;
  pipelineVersion: string;
  volatility?: Volatility;
  asOf?: Date;
  validFrom?: Date;
  validTo?: Date;
  refreshAfter?: Date;
  sourceFetchedAt?: Date;
  verifiedAt?: Date;
  verifiedBy?: string;
}

export interface AppendFactsOptions {
  /**
   * Default `true`: every cited sentence must exist in `kb_source_sentence` and every quotation
   * must be verbatim in a cited sentence, else the whole append fails (TG-R02, TG-R03). `false`
   * is for tests and for `model-proposed` rows that the pipeline has already screened.
   */
  requireEvidence?: boolean;
}

export interface NewKnowledgeSource {
  id?: string;
  url: string;
  title: string;
  publisher?: string;
  licence: string;
  licenceClass: LicenceClass;
  fetchedAt: Date;
  contentHash: string;
  revisionId?: string;
  etag?: string;
  /** Open class only (PRD §4.1). */
  rawStorageKey?: string;
  /**
   * Numbered sentences. Plain strings are numbered from 1 in order (open class: the whole page);
   * `{ seq, text }` keeps the page's own numbering (quotable class: only the cited sentences).
   * Read-only sources store none.
   */
  sentences: Array<string | { seq: number; text: string }>;
}

export interface NewEdge {
  id?: string;
  fromId: string;
  toId?: string;
  toUri?: string;
  type: EdgeType;
  origin: EdgeOrigin;
  status?: EdgeRow["status"];
  weight?: number;
}

export interface ThresholdKey {
  subject: string;
  embeddingModel: string;
  dims: number;
  cardTemplateVersion: string;
}

export interface NewMatchLog {
  lessonId?: string;
  objectiveHash: string;
  subject: string;
  band: number;
  embeddingModel?: string;
  dims?: number;
  candidates: MatchCandidateLog[];
  decision: MatchDecision;
  verdict?: Record<string, unknown>;
  matchedSectionId?: string;
  latencyMs: number;
}

export interface NewFactSignal {
  kind: FactSignalKind;
  packFactIds: string[];
  subject: string;
  band: number;
  teacherPseudonym: string;
  schoolId?: string;
  lessonId?: string;
  beforeText?: string;
  afterText?: string;
}

export interface CandidateFilter {
  subject: string;
  band: number;
  /** Sections within `band ± bandSlack` are scanned. Default 1 (PRD §5.5 step 3). */
  bandSlack?: number;
  embeddingModel: string;
  dims: number;
  /** The objective text, for stemmed key-word overlap against the card's `tsv`. */
  objectiveText?: string;
  /** Pack statuses that may match. Default `["draft", "verified"]` (TG-R05 excludes flagged/retired). */
  packStatuses?: PackStatus[];
}

/** One scan result. `cosine` is the max over the card embedding and the positive aliases. */
export interface Candidate {
  sectionId: string;
  packId: string;
  packSlug: string;
  packStatus: PackStatus;
  band: number;
  outcome: string;
  scopeLine: string;
  cardText: string | null;
  cosine: number;
  /** Which row produced `cosine`. */
  matchedBy: "card" | "alias";
  /** Fraction of the card's key-word lexemes present in `objectiveText`; `null` without either. */
  keyWordOverlap: number | null;
  /** Cosine to the nearest exclusion phrase; `null` when the section has none embedded. */
  exclusionSimilarity: number | null;
}

/** `findAlias()` result: the alias row plus what the lookup needs to act on it. */
export interface AliasHit {
  alias: AliasRow;
  sectionId: string;
  packId: string;
  packStatus: PackStatus;
  sectionStatus: SectionStatus;
  subject: string;
  band: number;
}

export interface DerivedSection {
  sectionId: string;
  cardText: string;
  cardTemplateVersion: string;
  builtFromHash: string;
  /** `true` when the card inputs changed and the section (and pack) version was bumped. */
  changed: boolean;
  /** `true` when no `kb_section_embedding` row for this hash exists yet; embed `cardText` and call `putSectionEmbedding`. */
  needsEmbedding: boolean;
  counts: SectionFactCountsRow;
}

export type KnowledgeStoreErrorCode =
  | "unknown_pack"
  | "unknown_section"
  | "unknown_fact"
  | "section_mismatch"
  | "already_superseded"
  | "missing_evidence"
  | "quotation_not_verbatim"
  | "dims_mismatch"
  | "licence_class_violation"
  | "invalid_input";

export class KnowledgeStoreError extends Error {
  readonly code: KnowledgeStoreErrorCode;
  readonly details?: unknown;
  constructor(code: KnowledgeStoreErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "KnowledgeStoreError";
    this.code = code;
    this.details = details;
  }
}

/** Bumped whenever `buildCardText()` changes shape; recorded on every embedding row. */
export const CARD_TEMPLATE_VERSION = "v1";

/** Namespace of the per-subject advisory lock (`pg_advisory_xact_lock(ns, hashtext(subject))`). */
export const SUBJECT_LOCK_NAMESPACE = 7_324_100;

// ---------------------------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------------------------

export async function createPack(db: KnowledgeDb, input: NewPack): Promise<PackRow> {
  if (input.bandLo > input.bandHi) {
    throw new KnowledgeStoreError("invalid_input", "createPack: bandLo must be <= bandHi");
  }
  const rows = await db
    .insert(packs)
    .values({
      id: input.id ?? newId(),
      slug: input.slug,
      subject: input.subject,
      bandLo: input.bandLo,
      bandHi: input.bandHi,
      status: input.status ?? "draft",
      scopeTitle: input.scopeTitle,
      scopeStatement: input.scopeStatement ?? "",
    })
    .returning();
  return one(rows, "createPack");
}

export async function getPack(db: KnowledgeDb, id: string): Promise<PackRow | null> {
  const rows = await db.select().from(packs).where(eq(packs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findPackBySlug(db: KnowledgeDb, slug: string): Promise<PackRow | null> {
  const rows = await db.select().from(packs).where(eq(packs.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/** Flag / verify / retire a pack. A `flagged` pack drops out of `findCandidates` and `findAlias` at once (TG-R05). */
export async function setPackStatus(
  db: KnowledgeDb,
  id: string,
  status: PackStatus,
): Promise<PackRow> {
  const rows = await db
    .update(packs)
    .set({ status, updatedAt: new Date() })
    .where(eq(packs.id, id))
    .returning();
  return one(rows, "setPackStatus", "unknown_pack");
}

/** Store the model-written pack scope (title + statement). Bumps the pack version. */
export async function setPackScope(
  db: KnowledgeDb,
  id: string,
  scope: { scopeTitle: string; scopeStatement: string },
): Promise<PackRow> {
  const rows = await db
    .update(packs)
    .set({ ...scope, version: sql`${packs.version} + 1`, updatedAt: new Date() })
    .where(eq(packs.id, id))
    .returning();
  return one(rows, "setPackScope", "unknown_pack");
}

// ---------------------------------------------------------------------------------------------
// Sections, aliases, exclusion phrases, embeddings
// ---------------------------------------------------------------------------------------------

/**
 * Insert a section with its canonical positive alias (the outcome) and its exclusion phrases,
 * widening the pack's band range if the section sits outside it. Call `rebuildDerived()` next
 * to get the card text to embed.
 */
export async function addSection(db: KnowledgeDb, input: NewSection): Promise<SectionRow> {
  return db.transaction(async (tx) => {
    const pack = await getPack(tx, input.packId);
    if (!pack) throw new KnowledgeStoreError("unknown_pack", `addSection: no pack ${input.packId}`);
    const id = input.id ?? newId();
    const rows = await tx
      .insert(sections)
      .values({
        id,
        packId: input.packId,
        band: input.band,
        outcome: input.outcome,
        outcomeNorm: normaliseText(input.outcome),
        scopeLine: input.scopeLine,
        keyWords: input.keyWords ?? [],
        alignedTo: input.alignedTo ?? [],
        priorKnowledge: input.priorKnowledge ?? null,
        status: input.status ?? "draft",
      })
      .returning();
    const section = one(rows, "addSection");
    await addAlias(tx, {
      sectionId: id,
      text: input.outcome,
      kind: "canonical",
      label: "positive",
    });
    for (const text of input.exclusionPhrases ?? []) {
      await addExclusionPhrase(tx, { sectionId: id, text });
    }
    if (input.band < pack.bandLo || input.band > pack.bandHi) {
      await tx
        .update(packs)
        .set({
          bandLo: Math.min(pack.bandLo, input.band),
          bandHi: Math.max(pack.bandHi, input.band),
          updatedAt: new Date(),
        })
        .where(eq(packs.id, pack.id));
    }
    return section;
  });
}

export async function getSection(db: KnowledgeDb, id: string): Promise<SectionRow | null> {
  const rows = await db.select().from(sections).where(eq(sections.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Current (not superseded) sections whose normalised outcome equals `outcome`, across all packs
 * — the one automatic merge key of add-or-new (PRD §5.5). Optionally narrowed to a subject.
 */
export async function findSectionsByOutcome(
  db: KnowledgeDb,
  outcome: string,
  opts: { subject?: string } = {},
): Promise<Array<SectionRow & { subject: string }>> {
  const where = [eq(sections.outcomeNorm, normaliseText(outcome)), isNull(sections.supersededAt)];
  if (opts.subject !== undefined) where.push(eq(packs.subject, opts.subject));
  const rows = await db
    .select({ section: sections, subject: packs.subject })
    .from(sections)
    .innerJoin(packs, eq(packs.id, sections.packId))
    .where(and(...where));
  return rows.map((r) => ({ ...r.section, subject: r.subject }));
}

/** Insert or refresh an alias (unique per section + text hash). A later verdict overwrites label, kind and vector. */
export async function addAlias(db: KnowledgeDb, input: NewAlias): Promise<AliasRow> {
  assertEmbedding(input.embedding);
  const values = {
    id: newId(),
    sectionId: input.sectionId,
    text: input.text,
    textHash: hashText(input.text),
    kind: input.kind,
    label: input.label,
    embeddingModel: input.embedding?.embeddingModel ?? null,
    dims: input.embedding?.dims ?? null,
    vector: input.embedding?.vector ?? null,
  };
  const rows = await db
    .insert(sectionAliases)
    .values(values)
    .onConflictDoUpdate({
      target: [sectionAliases.sectionId, sectionAliases.textHash],
      set: {
        kind: values.kind,
        label: values.label,
        ...(input.embedding
          ? { embeddingModel: values.embeddingModel, dims: values.dims, vector: values.vector }
          : {}),
      },
    })
    .returning();
  return one(rows, "addAlias");
}

export async function setAliasEmbedding(
  db: KnowledgeDb,
  aliasId: string,
  embedding: Embedding,
): Promise<AliasRow> {
  assertEmbedding(embedding);
  const rows = await db
    .update(sectionAliases)
    .set({
      embeddingModel: embedding.embeddingModel,
      dims: embedding.dims,
      vector: embedding.vector,
    })
    .where(eq(sectionAliases.id, aliasId))
    .returning();
  return one(rows, "setAliasEmbedding", "invalid_input");
}

export async function listAliases(db: KnowledgeDb, sectionId: string): Promise<AliasRow[]> {
  return db.select().from(sectionAliases).where(eq(sectionAliases.sectionId, sectionId));
}

export async function addExclusionPhrase(
  db: KnowledgeDb,
  input: { sectionId: string; text: string; embedding?: Embedding },
): Promise<ExclusionPhraseRow> {
  assertEmbedding(input.embedding);
  const rows = await db
    .insert(exclusionPhrases)
    .values({
      id: newId(),
      sectionId: input.sectionId,
      text: input.text,
      embeddingModel: input.embedding?.embeddingModel ?? null,
      dims: input.embedding?.dims ?? null,
      vector: input.embedding?.vector ?? null,
    })
    .returning();
  return one(rows, "addExclusionPhrase");
}

export async function setExclusionPhraseEmbedding(
  db: KnowledgeDb,
  phraseId: string,
  embedding: Embedding,
): Promise<ExclusionPhraseRow> {
  assertEmbedding(embedding);
  const rows = await db
    .update(exclusionPhrases)
    .set({
      embeddingModel: embedding.embeddingModel,
      dims: embedding.dims,
      vector: embedding.vector,
    })
    .where(eq(exclusionPhrases.id, phraseId))
    .returning();
  return one(rows, "setExclusionPhraseEmbedding", "invalid_input");
}

export async function listExclusionPhrases(
  db: KnowledgeDb,
  sectionId: string,
): Promise<ExclusionPhraseRow[]> {
  return db.select().from(exclusionPhrases).where(eq(exclusionPhrases.sectionId, sectionId));
}

/**
 * Upsert the card embedding for (section, model, dims). `builtFromHash` must be the hash
 * `rebuildDerived()` returned for the card text that was embedded; the scan only uses embeddings
 * whose hash equals the section's current one, so a drifted index never matches. `tsv` is
 * derived from the section's key words here.
 */
export async function putSectionEmbedding(
  db: KnowledgeDb,
  input: Embedding & { sectionId: string; cardTemplateVersion: string; builtFromHash: string },
): Promise<SectionEmbeddingRow> {
  assertEmbedding(input);
  const section = await getSection(db, input.sectionId);
  if (!section) {
    throw new KnowledgeStoreError(
      "unknown_section",
      `putSectionEmbedding: no section ${input.sectionId}`,
    );
  }
  const keyWords = section.keyWords.join(" ");
  const rows = await db
    .insert(sectionEmbeddings)
    .values({
      sectionId: input.sectionId,
      embeddingModel: input.embeddingModel,
      dims: input.dims,
      cardTemplateVersion: input.cardTemplateVersion,
      vector: input.vector,
      tsv: sql`to_tsvector('english', ${keyWords})`,
      builtFromHash: input.builtFromHash,
    })
    .onConflictDoUpdate({
      target: [
        sectionEmbeddings.sectionId,
        sectionEmbeddings.embeddingModel,
        sectionEmbeddings.dims,
      ],
      set: {
        cardTemplateVersion: input.cardTemplateVersion,
        vector: input.vector,
        tsv: sql`to_tsvector('english', ${keyWords})`,
        builtFromHash: input.builtFromHash,
        createdAt: new Date(),
      },
    })
    .returning();
  return one(rows, "putSectionEmbedding");
}

/**
 * Current sections with a card whose embedding under (model, dims) is missing or stale (its
 * `built_from_hash` differs from the section's). The write-through backfills from this list.
 */
export async function listSectionsNeedingEmbedding(
  db: KnowledgeDb,
  opts: { embeddingModel: string; dims: number; limit?: number },
): Promise<SectionRow[]> {
  const limit = opts.limit ?? 100;
  return db
    .select({ s: sections })
    .from(sections)
    .leftJoin(
      sectionEmbeddings,
      and(
        eq(sectionEmbeddings.sectionId, sections.id),
        eq(sectionEmbeddings.embeddingModel, opts.embeddingModel),
        eq(sectionEmbeddings.dims, opts.dims),
      ),
    )
    .where(
      and(
        isNull(sections.supersededAt),
        sql`${sections.cardText} is not null`,
        sql`(${sectionEmbeddings.sectionId} is null or ${sectionEmbeddings.builtFromHash} is distinct from ${sections.builtFromHash})`,
      ),
    )
    .limit(limit)
    .then((rows) => rows.map((r) => r.s));
}

// ---------------------------------------------------------------------------------------------
// Facts (append-only)
// ---------------------------------------------------------------------------------------------

/**
 * Append fact rows to a section. A row with `supersedesId` marks the old row superseded in the
 * same transaction (TG-R07); the old row must belong to the same section and not be superseded
 * already. With `requireEvidence` (default) every cited sentence must exist (TG-R02) and every
 * `quotation` text must be verbatim inside a cited sentence (TG-R03). The partial unique index
 * rejects a second current vocabulary definition for the same (term, sense, band).
 */
export async function appendFacts(
  db: KnowledgeDb,
  sectionId: string,
  newFacts: NewFact[],
  opts: AppendFactsOptions = {},
): Promise<FactRow[]> {
  if (newFacts.length === 0) return [];
  const requireEvidence = opts.requireEvidence ?? true;
  return db.transaction(async (tx) => {
    const section = await getSection(tx, sectionId);
    if (!section)
      throw new KnowledgeStoreError("unknown_section", `appendFacts: no section ${sectionId}`);

    if (requireEvidence) {
      const missing = await findMissingEvidence(
        tx,
        newFacts.flatMap((f) => f.evidence),
      );
      if (missing.length > 0) {
        throw new KnowledgeStoreError(
          "missing_evidence",
          "appendFacts: cited sentences do not exist",
          missing,
        );
      }
      for (const f of newFacts) {
        if (f.type !== "quotation") continue;
        if (!(await isVerbatim(tx, f.text, f.evidence))) {
          throw new KnowledgeStoreError(
            "quotation_not_verbatim",
            "appendFacts: quotation is not verbatim in a cited sentence",
            { text: f.text },
          );
        }
      }
    }

    const now = new Date();
    const minted = newFacts.map((f) => ({ ...f, id: f.id ?? newId() }));

    // Mark superseded rows first so the one-current-definition index sees them as gone.
    const supersedeIds = minted.filter((f) => f.supersedesId).map((f) => f.supersedesId as string);
    if (supersedeIds.length > 0) {
      const olds = await tx.select().from(facts).where(inArray(facts.id, supersedeIds));
      const byId = new Map(olds.map((o) => [o.id, o]));
      for (const f of minted) {
        if (!f.supersedesId) continue;
        const old = byId.get(f.supersedesId);
        if (!old)
          throw new KnowledgeStoreError(
            "unknown_fact",
            `appendFacts: no fact ${f.supersedesId} to supersede`,
          );
        if (old.sectionId !== sectionId)
          throw new KnowledgeStoreError(
            "section_mismatch",
            `appendFacts: fact ${old.id} belongs to another section`,
          );
        if (old.supersededAt)
          throw new KnowledgeStoreError(
            "already_superseded",
            `appendFacts: fact ${old.id} is already superseded by ${old.supersededBy}`,
          );
        await tx
          .update(facts)
          .set({ supersededAt: now, supersededBy: f.id })
          .where(and(eq(facts.id, old.id), isNull(facts.supersededAt)));
      }
    }

    return tx
      .insert(facts)
      .values(
        minted.map((f) => ({
          id: f.id,
          sectionId,
          type: f.type,
          text: f.text,
          termId: f.termId ?? null,
          sense: f.sense ?? null,
          band: f.band ?? null,
          evidence: f.evidence,
          singleSource: f.singleSource ?? false,
          rank: f.rank ?? "normal",
          deprecatedReason: f.deprecatedReason ?? null,
          supersedesId: f.supersedesId ?? null,
          provenance: f.provenance,
          checkerModels: f.checkerModels ?? [],
          checkConfidence: f.checkConfidence ?? null,
          pipelineVersion: f.pipelineVersion,
          volatility: f.volatility ?? "timeless",
          asOf: f.asOf ?? null,
          validFrom: f.validFrom ?? null,
          validTo: f.validTo ?? null,
          refreshAfter: f.refreshAfter ?? null,
          sourceFetchedAt: f.sourceFetchedAt ?? null,
          verifiedAt: f.verifiedAt ?? null,
          verifiedBy: f.verifiedBy ?? null,
          createdAt: now,
        })),
      )
      .returning();
  });
}

/**
 * Retire a fact: a new row that copies it with `rank = deprecated` and the reason, superseding
 * the old one (TG-R07: nothing is edited in place). The retired fact leaves `kb_fact_current`.
 */
export async function deprecateFact(
  db: KnowledgeDb,
  factId: string,
  reason: string,
  by: { verifiedBy: string; pipelineVersion?: string },
): Promise<FactRow> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(facts).where(eq(facts.id, factId)).limit(1);
    const old = rows[0];
    if (!old) throw new KnowledgeStoreError("unknown_fact", `deprecateFact: no fact ${factId}`);
    const [row] = await appendFacts(
      tx,
      old.sectionId,
      [
        {
          type: old.type,
          text: old.text,
          termId: old.termId ?? undefined,
          sense: old.sense ?? undefined,
          band: old.band ?? undefined,
          evidence: old.evidence,
          singleSource: old.singleSource,
          rank: "deprecated",
          deprecatedReason: reason,
          supersedesId: old.id,
          provenance: old.provenance,
          checkerModels: old.checkerModels,
          checkConfidence: old.checkConfidence ?? undefined,
          pipelineVersion: by.pipelineVersion ?? old.pipelineVersion,
          volatility: old.volatility,
          asOf: old.asOf ?? undefined,
          validFrom: old.validFrom ?? undefined,
          validTo: old.validTo ?? undefined,
          refreshAfter: old.refreshAfter ?? undefined,
          sourceFetchedAt: old.sourceFetchedAt ?? undefined,
          verifiedAt: new Date(),
          verifiedBy: by.verifiedBy,
        },
      ],
      { requireEvidence: false },
    );
    return row as FactRow;
  });
}

/** Servable facts of `sectionIds` from `kb_fact_current`, best rank first within a section. */
export async function listCurrentFacts(
  db: KnowledgeDb,
  sectionIds: string[],
): Promise<FactCurrentRow[]> {
  if (sectionIds.length === 0) return [];
  return db
    .select()
    .from(factCurrent)
    .where(inArray(factCurrent.sectionId, sectionIds))
    .orderBy(factCurrent.sectionId, factCurrent.rankOrder, factCurrent.createdAt);
}

/** Every row of a section, current or not, oldest first — for review pages and tests. */
export async function listFactHistory(db: KnowledgeDb, sectionId: string): Promise<FactRow[]> {
  return db
    .select()
    .from(facts)
    .where(eq(facts.sectionId, sectionId))
    .orderBy(facts.createdAt, facts.id);
}

/** Counts per type from `kb_section_fact_counts` (coverage reads these; PRD §5.5). */
export async function getSectionFactCounts(
  db: KnowledgeDb,
  sectionIds: string[],
): Promise<SectionFactCountsRow[]> {
  if (sectionIds.length === 0) return [];
  return db
    .select()
    .from(sectionFactCounts)
    .where(inArray(sectionFactCounts.sectionId, sectionIds));
}

// ---------------------------------------------------------------------------------------------
// Derived artefacts
// ---------------------------------------------------------------------------------------------

/** The embedded card text (PRD §2): subject, band and pack title prefix, then outcome, scope and key words. Never exclusions (TG-R04). */
export function buildCardText(input: {
  subject: string;
  band: number;
  packTitle: string;
  outcome: string;
  scopeLine: string;
  keyWords: string[];
}): string {
  const lines = [
    `${input.subject} · band ${input.band} · ${input.packTitle}`,
    input.outcome,
    input.scopeLine,
  ];
  if (input.keyWords.length > 0) lines.push(`Key words: ${input.keyWords.join(", ")}`);
  return lines.join("\n");
}

/**
 * Recompute a section's derived artefacts from current rows: the card text and its
 * `builtFromHash` (over subject, band, pack title, outcome, scope line, key words and the card
 * template version), bumping the section and pack versions when the hash changed, and the fact
 * counts from the view. Returns what to embed; the caller embeds `cardText` and stores it with
 * `putSectionEmbedding({ builtFromHash })`. Idempotent: an unchanged section returns `changed: false`.
 */
export async function rebuildDerived(db: KnowledgeDb, sectionId: string): Promise<DerivedSection> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ section: sections, pack: packs })
      .from(sections)
      .innerJoin(packs, eq(packs.id, sections.packId))
      .where(eq(sections.id, sectionId))
      .limit(1);
    const found = rows[0];
    if (!found)
      throw new KnowledgeStoreError("unknown_section", `rebuildDerived: no section ${sectionId}`);
    const { section, pack } = found;
    const cardInputs = {
      subject: pack.subject,
      band: section.band,
      packTitle: pack.scopeTitle,
      outcome: section.outcome,
      scopeLine: section.scopeLine,
      keyWords: section.keyWords,
    };
    const cardText = buildCardText(cardInputs);
    const builtFromHash = hashValue({ ...cardInputs, cardTemplateVersion: CARD_TEMPLATE_VERSION });
    const changed = section.builtFromHash !== builtFromHash || section.cardText !== cardText;
    if (changed) {
      const now = new Date();
      await tx
        .update(sections)
        .set({ cardText, builtFromHash, version: sql`${sections.version} + 1`, updatedAt: now })
        .where(eq(sections.id, sectionId));
      await tx
        .update(packs)
        .set({ version: sql`${packs.version} + 1`, updatedAt: now })
        .where(eq(packs.id, pack.id));
    }
    const [counts] = await getSectionFactCounts(tx, [sectionId]);
    const embedded = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sectionEmbeddings)
      .where(
        and(
          eq(sectionEmbeddings.sectionId, sectionId),
          eq(sectionEmbeddings.builtFromHash, builtFromHash),
        ),
      );
    return {
      sectionId,
      cardText,
      cardTemplateVersion: CARD_TEMPLATE_VERSION,
      builtFromHash,
      changed,
      needsEmbedding: (embedded[0]?.n ?? 0) === 0,
      counts: counts ?? emptyCounts(sectionId),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------------------------

/**
 * Run `fn` in a transaction that holds the per-subject advisory lock (PRD §5.5: one writer per
 * subject, so two concurrent lessons cannot both start a new pack for the same topic). The lock is
 * transaction-scoped and released on commit or rollback; a second caller blocks until then.
 */
export async function withSubjectLock<T>(
  db: KnowledgeDb,
  subject: string,
  fn: (tx: KnowledgeDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${SUBJECT_LOCK_NAMESPACE}, hashtext(${subject}))`,
    );
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------------------------
// Lookup primitives
// ---------------------------------------------------------------------------------------------

/**
 * Step 1 of the lookup: exact alias lookup by `hashText(objective)`. Returns every alias with
 * that hash (positive and negative, any section) on current sections of servable packs. The
 * caller decides: one positive on one section is a hit; a negative rules that section out.
 */
export async function findAlias(
  db: KnowledgeDb,
  textHash: string,
  opts: { packStatuses?: PackStatus[] } = {},
): Promise<AliasHit[]> {
  const statuses = opts.packStatuses ?? ["draft", "verified"];
  const rows = await db
    .select({
      alias: sectionAliases,
      sectionId: sections.id,
      packId: packs.id,
      packStatus: packs.status,
      sectionStatus: sections.status,
      subject: packs.subject,
      band: sections.band,
    })
    .from(sectionAliases)
    .innerJoin(sections, eq(sections.id, sectionAliases.sectionId))
    .innerJoin(packs, eq(packs.id, sections.packId))
    .where(
      and(
        eq(sectionAliases.textHash, textHash),
        isNull(sections.supersededAt),
        inArray(packs.status, statuses),
        inArray(sections.status, ["draft", "verified"]),
      ),
    )
    .orderBy(sectionAliases.createdAt);
  return rows;
}

/**
 * Step 3 of the lookup: filter by subject and band ± slack, then an exact cosine scan (no ANN
 * index) of every current section's card embedding and positive aliases under (model, dims),
 * taking the max per section; plus the key-word overlap with `objectiveText` and the nearest
 * exclusion phrase. Returns the top `k` by cosine. Gates (τ_hit, margin, …) are applied by the
 * caller from the `threshold` row — this function ranks, it never decides.
 */
export async function findCandidates(
  db: KnowledgeDb,
  filter: CandidateFilter,
  vector: number[],
  k = 3,
): Promise<Candidate[]> {
  if (vector.length !== filter.dims) {
    throw new KnowledgeStoreError(
      "dims_mismatch",
      `findCandidates: vector has ${vector.length} dims, filter says ${filter.dims}`,
    );
  }
  const slack = filter.bandSlack ?? 1;
  const lo = filter.band - slack;
  const hi = filter.band + slack;
  const statuses = filter.packStatuses ?? ["draft", "verified"];
  const vec = `[${vector.join(",")}]`;
  const objective = filter.objectiveText ?? "";
  const rows = await db.execute(sql`
    with q as (
      select ${vec}::vector as v, to_tsvector('english', ${objective}) as qtsv
    ),
    eligible as (
      select s.id as section_id, s.pack_id, s.band, s.outcome, s.scope_line, s.card_text,
             s.built_from_hash, p.slug as pack_slug, p.status as pack_status
      from kb_section s
      join kb_pack p on p.id = s.pack_id
      where p.subject = ${filter.subject}
        and p.status in (${sql.join(
          statuses.map((s) => sql`${s}::kb_pack_status`),
          sql`, `,
        )})
        and s.status in ('draft', 'verified')
        and s.superseded_at is null
        and s.band between ${lo} and ${hi}
    ),
    scores as (
      select e.section_id, 1 - (se.vector <=> q.v) as cosine, 'card' as matched_by
      from eligible e
      join kb_section_embedding se
        on se.section_id = e.section_id
       and se.embedding_model = ${filter.embeddingModel}
       and se.dims = ${filter.dims}
       and se.built_from_hash = e.built_from_hash
      cross join q
      union all
      select e.section_id, 1 - (a.vector <=> q.v) as cosine, 'alias' as matched_by
      from eligible e
      join kb_section_alias a
        on a.section_id = e.section_id
       and a.label = 'positive'
       and a.vector is not null
       and a.embedding_model = ${filter.embeddingModel}
       and a.dims = ${filter.dims}
      cross join q
    ),
    best as (
      select distinct on (section_id) section_id, cosine, matched_by
      from scores
      order by section_id, cosine desc
    )
    select
      b.section_id, e.pack_id, e.pack_slug, e.pack_status, e.band, e.outcome, e.scope_line,
      e.card_text, b.cosine::float8 as cosine, b.matched_by,
      case
        when se.tsv is null or length(se.tsv) = 0 or ${objective} = '' then null
        else (
          select count(*) from unnest(tsvector_to_array(se.tsv)) w
          where w = any(tsvector_to_array(q.qtsv))
        )::float8 / length(se.tsv)
      end as key_word_overlap,
      (
        select max(1 - (x.vector <=> q.v))::float8
        from kb_exclusion_phrase x
        where x.section_id = b.section_id
          and x.vector is not null
          and x.embedding_model = ${filter.embeddingModel}
          and x.dims = ${filter.dims}
      ) as exclusion_similarity
    from best b
    join eligible e on e.section_id = b.section_id
    left join kb_section_embedding se
      on se.section_id = b.section_id
     and se.embedding_model = ${filter.embeddingModel}
     and se.dims = ${filter.dims}
    cross join q
    order by b.cosine desc, b.section_id
    limit ${k}
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    sectionId: r.section_id as string,
    packId: r.pack_id as string,
    packSlug: r.pack_slug as string,
    packStatus: r.pack_status as PackStatus,
    band: r.band as number,
    outcome: r.outcome as string,
    scopeLine: r.scope_line as string,
    cardText: (r.card_text as string | null) ?? null,
    cosine: Number(r.cosine),
    matchedBy: r.matched_by as "card" | "alias",
    keyWordOverlap: r.key_word_overlap === null ? null : Number(r.key_word_overlap),
    exclusionSimilarity: r.exclusion_similarity === null ? null : Number(r.exclusion_similarity),
  }));
}

export async function getThreshold(
  db: KnowledgeDb,
  key: ThresholdKey,
): Promise<ThresholdRow | null> {
  const rows = await db
    .select()
    .from(thresholds)
    .where(
      and(
        eq(thresholds.subject, key.subject),
        eq(thresholds.embeddingModel, key.embeddingModel),
        eq(thresholds.dims, key.dims),
        eq(thresholds.cardTemplateVersion, key.cardTemplateVersion),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Store a calibrated gate row (TG-6). Replaces the row for the same key. */
export async function upsertThreshold(db: KnowledgeDb, row: ThresholdRow): Promise<ThresholdRow> {
  const rows = await db
    .insert(thresholds)
    .values(row)
    .onConflictDoUpdate({
      target: [
        thresholds.subject,
        thresholds.embeddingModel,
        thresholds.dims,
        thresholds.cardTemplateVersion,
      ],
      set: {
        tauHit: row.tauHit,
        tauGrey: row.tauGrey,
        kwFloor: row.kwFloor,
        marginMin: row.marginMin,
        tauExcl: row.tauExcl,
        calibratedAt: row.calibratedAt,
        nLabels: row.nLabels,
      },
    })
    .returning();
  return one(rows, "upsertThreshold");
}

/** Step 8: append one lookup decision. */
export async function logMatch(db: KnowledgeDb, entry: NewMatchLog): Promise<MatchLogRow> {
  const rows = await db
    .insert(matchLog)
    .values({
      lessonId: entry.lessonId ?? null,
      objectiveHash: entry.objectiveHash,
      subject: entry.subject,
      band: entry.band,
      embeddingModel: entry.embeddingModel ?? null,
      dims: entry.dims ?? null,
      candidates: entry.candidates,
      decision: entry.decision,
      verdict: entry.verdict ?? null,
      matchedSectionId: entry.matchedSectionId ?? null,
      latencyMs: entry.latencyMs,
    })
    .returning();
  return one(rows, "logMatch");
}

/** TG-13: append a teacher usage signal. Write-only from the product; nothing reads it here. */
export async function recordFactSignal(db: KnowledgeDb, signal: NewFactSignal): Promise<void> {
  await db.insert(factSignals).values({
    kind: signal.kind,
    packFactIds: signal.packFactIds,
    subject: signal.subject,
    band: signal.band,
    teacherPseudonym: signal.teacherPseudonym,
    schoolId: signal.schoolId ?? null,
    lessonId: signal.lessonId ?? null,
    beforeText: signal.beforeText ?? null,
    afterText: signal.afterText ?? null,
  });
}

// ---------------------------------------------------------------------------------------------
// Sources, sentences, edges
// ---------------------------------------------------------------------------------------------

/**
 * Store a fetched source and its numbered sentences in one transaction. Licence class is enforced
 * structurally (PRD §4.1): `readonly` stores no sentences; only `open` may carry `rawStorageKey`.
 * The same (url, contentHash) is returned as-is if already stored.
 */
export async function createSource(
  db: KnowledgeDb,
  input: NewKnowledgeSource,
): Promise<KnowledgeSourceRow> {
  if (input.licenceClass === "readonly" && input.sentences.length > 0) {
    throw new KnowledgeStoreError(
      "licence_class_violation",
      "createSource: a read-only source stores no text",
    );
  }
  if (input.licenceClass !== "open" && input.rawStorageKey) {
    throw new KnowledgeStoreError(
      "licence_class_violation",
      "createSource: only open sources keep a raw copy",
    );
  }
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.url, input.url),
          eq(knowledgeSources.contentHash, input.contentHash),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];
    const rows = await tx
      .insert(knowledgeSources)
      .values({
        id: input.id ?? newId(),
        url: input.url,
        title: input.title,
        publisher: input.publisher ?? null,
        licence: input.licence,
        licenceClass: input.licenceClass,
        fetchedAt: input.fetchedAt,
        contentHash: input.contentHash,
        revisionId: input.revisionId ?? null,
        etag: input.etag ?? null,
        rawStorageKey: input.rawStorageKey ?? null,
      })
      .returning();
    const source = one(rows, "createSource");
    const sentences = input.sentences.map((s, i) =>
      typeof s === "string" ? { seq: i + 1, text: s } : s,
    );
    if (sentences.length > 0) {
      await tx
        .insert(sourceSentences)
        .values(sentences.map((s) => ({ sourceId: source.id, ...s })));
    }
    return source;
  });
}

export async function getSource(db: KnowledgeDb, id: string): Promise<KnowledgeSourceRow | null> {
  const rows = await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, id)).limit(1);
  return rows[0] ?? null;
}

/** The cited sentences of one source, in `seq` order (only those that exist). */
export async function findSentences(
  db: KnowledgeDb,
  sourceId: string,
  seqs: number[],
): Promise<SourceSentenceRow[]> {
  if (seqs.length === 0) return [];
  return db
    .select()
    .from(sourceSentences)
    .where(and(eq(sourceSentences.sourceId, sourceId), inArray(sourceSentences.seq, seqs)))
    .orderBy(sourceSentences.seq);
}

/** TG-R02 as an exact lookup: the evidence entries (source, seqs) that do **not** exist. Empty means grounded. */
export async function findMissingEvidence(
  db: KnowledgeDb,
  evidence: FactEvidence[],
): Promise<FactEvidence[]> {
  const missing: FactEvidence[] = [];
  const bySource = new Map<string, Set<number>>();
  for (const e of evidence) {
    const set = bySource.get(e.sourceId) ?? new Set<number>();
    for (const id of e.sentenceIds) set.add(id);
    bySource.set(e.sourceId, set);
  }
  for (const [sourceId, seqs] of bySource) {
    const found = await findSentences(db, sourceId, [...seqs]);
    const have = new Set(found.map((s) => s.seq));
    const gone = [...seqs].filter((s) => !have.has(s));
    if (gone.length > 0 || seqs.size === 0) missing.push({ sourceId, sentenceIds: gone });
  }
  return missing;
}

/** Insert an edge; an identical (from, type, to) edge already present is returned unchanged. */
export async function addEdge(db: KnowledgeDb, edge: NewEdge): Promise<EdgeRow> {
  if ((edge.toId === undefined) === (edge.toUri === undefined)) {
    throw new KnowledgeStoreError(
      "invalid_input",
      "addEdge: exactly one of toId / toUri is required",
    );
  }
  const rows = await db
    .insert(edges)
    .values({
      id: edge.id ?? newId(),
      fromId: edge.fromId,
      toId: edge.toId ?? null,
      toUri: edge.toUri ?? null,
      type: edge.type,
      origin: edge.origin,
      status: edge.status ?? "unverified",
      weight: edge.weight ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (rows[0]) return rows[0];
  const existing = await db
    .select()
    .from(edges)
    .where(
      and(
        eq(edges.fromId, edge.fromId),
        eq(edges.type, edge.type),
        edge.toId !== undefined ? eq(edges.toId, edge.toId) : eq(edges.toUri, edge.toUri as string),
      ),
    )
    .limit(1);
  return one(existing, "addEdge");
}

export async function listEdges(db: KnowledgeDb, fromId: string): Promise<EdgeRow[]> {
  return db.select().from(edges).where(eq(edges.fromId, fromId)).orderBy(desc(edges.createdAt));
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

function one<T>(rows: T[], fn: string, code: KnowledgeStoreErrorCode = "invalid_input"): T {
  const row = rows[0];
  if (!row) throw new KnowledgeStoreError(code, `${fn}: no row`);
  return row;
}

function assertEmbedding(e: Embedding | undefined): void {
  if (!e) return;
  if (e.vector.length !== e.dims) {
    throw new KnowledgeStoreError(
      "dims_mismatch",
      `embedding has ${e.vector.length} values but dims = ${e.dims}`,
    );
  }
}

async function isVerbatim(
  db: KnowledgeDb,
  text: string,
  evidence: FactEvidence[],
): Promise<boolean> {
  const needle = normaliseText(text);
  if (needle.length === 0) return false;
  for (const e of evidence) {
    const rows = await findSentences(db, e.sourceId, e.sentenceIds);
    if (rows.some((s) => normaliseText(s.text).includes(needle))) return true;
  }
  return false;
}

function emptyCounts(sectionId: string): SectionFactCountsRow {
  return {
    sectionId,
    keyIdeas: 0,
    misconceptions: 0,
    vocabulary: 0,
    workedExamples: 0,
    quotations: 0,
    positions: 0,
    total: 0,
  };
}

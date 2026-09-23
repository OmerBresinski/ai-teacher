import { accounts, sessions, users, verifications } from "./auth";
import { documents } from "./documents";
import { jobEvents } from "./job-events";
import {
  edges,
  exclusionPhrases,
  factSignals,
  facts,
  knowledgeSources,
  matchLog,
  packs,
  sectionAliases,
  sectionEmbeddings,
  sections,
  sourceSentences,
  thresholds,
} from "./knowledge";
import { sources } from "./sources";
import { workspaces } from "./workspaces";

export * from "./_columns";
export { accounts, authSchema, sessions, users, verifications } from "./auth";
export { DOCUMENTS_REQUEST_ID_INDEX, documentKind, documents } from "./documents";
export { JOB_EVENTS_ONE_TERMINAL_PER_JOB_INDEX, jobEvents } from "./job-events";
export {
  edges,
  exclusionPhrases,
  type FactEvidence,
  factCurrent,
  factSignals,
  facts,
  KNOWLEDGE_TABLES_LIST,
  kbAliasKind,
  kbAliasLabel,
  kbEdgeOrigin,
  kbEdgeStatus,
  kbEdgeType,
  kbFactRank,
  kbFactSignalKind,
  kbFactType,
  kbLicenceClass,
  kbMatchDecision,
  kbPackStatus,
  kbProvenance,
  kbSectionStatus,
  kbVolatility,
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
  tsvector,
  vectorAny,
} from "./knowledge";
export { sourceKind, sources } from "./sources";
export { workspaces } from "./workspaces";

/**
 * Every table with a `workspace_id` column. `forWorkspace()` accepts these and only these; the
 * invariant test checks each one has `workspace_id NOT NULL` with a FK and an index (ADR 0007).
 * **Add every new tenant table here.**
 */
export const TENANT_TABLES = [jobEvents, documents, sources] as const;

/**
 * The documented allow-list of tables without `workspace_id` (ADR 0007): the tenant root and the
 * better-auth identity tables (ADR 0008 — identity sits above the Workspace; see `auth.ts`).
 * Anything else needs a written justification in its schema file.
 */
export const NON_TENANT_TABLES = [workspaces, users, sessions, accounts, verifications] as const;

/**
 * The knowledge store (topic graph, TG-2): global shared knowledge with no Workspace owner, so
 * no `workspace_id` and never reached through `forWorkspace()`. Justification in `knowledge.ts`.
 * All SQL names carry the `kb_` prefix.
 */
export const KNOWLEDGE_TABLES = [
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

/** Every application table, for the exhaustiveness check below and for tests. */
export const ALL_TABLES = {
  workspaces,
  users,
  sessions,
  accounts,
  verifications,
  jobEvents,
  documents,
  sources,
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
} as const;

// ---------------------------------------------------------------------------------------------
// Type-level exhaustiveness: every table in `ALL_TABLES` must appear in exactly one of the three
// lists. Adding a table to `ALL_TABLES` without classifying it is a compile error; so is putting
// it in two lists.
// ---------------------------------------------------------------------------------------------

type TenantTable = (typeof TENANT_TABLES)[number];
type NonTenantTable = (typeof NON_TENANT_TABLES)[number];
type KnowledgeTable = (typeof KNOWLEDGE_TABLES)[number];
type AnyTable = (typeof ALL_TABLES)[keyof typeof ALL_TABLES];

type Extends<A, B> = [A] extends [B] ? true : false;
type AssertTrue<T extends true> = T;

// Every table is classified …
type _EveryTableClassified = AssertTrue<
  Extends<AnyTable, TenantTable | NonTenantTable | KnowledgeTable>
>;
// … no classified table is missing from ALL_TABLES …
type _NoStrayClassification = AssertTrue<
  Extends<TenantTable | NonTenantTable | KnowledgeTable, AnyTable>
>;
// … and the lists are pairwise disjoint.
type _Disjoint1 = AssertTrue<Extends<Extract<TenantTable, NonTenantTable>, never>>;
type _Disjoint2 = AssertTrue<Extends<Extract<TenantTable, KnowledgeTable>, never>>;
type _Disjoint3 = AssertTrue<Extends<Extract<NonTenantTable, KnowledgeTable>, never>>;

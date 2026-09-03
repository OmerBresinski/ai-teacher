import { z } from "zod";

/**
 * Branded ID schemas (type + const share a name, so `WorkspaceId` is both the Zod schema and the
 * inferred TypeScript type).
 *
 * Every ID is a UUID string. New IDs are UUIDv7 when minted server-side (time-ordered), UUIDv4
 * in browsers; validation accepts any RFC 9562 UUID so both are interchangeable at the type
 * level. Never build an ID from user input without parsing it through the schema.
 */
function brandedId<Brand extends string>(brand: Brand) {
  return z.uuid({ error: `Invalid ${brand}: expected a UUID` }).brand<Brand>();
}

export const WorkspaceId = brandedId("WorkspaceId");
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const UserId = brandedId("UserId");
export type UserId = z.infer<typeof UserId>;

export const JobId = brandedId("JobId");
export type JobId = z.infer<typeof JobId>;

// Stubs for the core objects (Master PRD §8). Owning feature PRDs keep the brand and add nothing
// here; object fields live in `src/objects/*`.

export const JourneyId = brandedId("JourneyId");
export type JourneyId = z.infer<typeof JourneyId>;

export const LessonId = brandedId("LessonId");
export type LessonId = z.infer<typeof LessonId>;

export const ArtefactId = brandedId("ArtefactId");
export type ArtefactId = z.infer<typeof ArtefactId>;

export const SourceId = brandedId("SourceId");
export type SourceId = z.infer<typeof SourceId>;

export const ObservationId = brandedId("ObservationId");
export type ObservationId = z.infer<typeof ObservationId>;

export const AdaptationId = brandedId("AdaptationId");
export type AdaptationId = z.infer<typeof AdaptationId>;

export const ConceptId = brandedId("ConceptId");
export type ConceptId = z.infer<typeof ConceptId>;

export const CohortProfileId = brandedId("CohortProfileId");
export type CohortProfileId = z.infer<typeof CohortProfileId>;

export const SkillId = brandedId("SkillId");
export type SkillId = z.infer<typeof SkillId>;

export const KnowledgeNodeId = brandedId("KnowledgeNodeId");
export type KnowledgeNodeId = z.infer<typeof KnowledgeNodeId>;

/** Every branded ID schema, keyed by brand. Used by tests and by tooling that maps ids. */
export const ID_SCHEMAS = {
  WorkspaceId,
  UserId,
  JobId,
  JourneyId,
  LessonId,
  ArtefactId,
  SourceId,
  ObservationId,
  AdaptationId,
  ConceptId,
  CohortProfileId,
  SkillId,
  KnowledgeNodeId,
} as const;

export type IdBrand = keyof typeof ID_SCHEMAS;

/** Union of all branded ID types. */
export type AnyId = z.infer<(typeof ID_SCHEMAS)[IdBrand]>;

/**
 * Structural view of the Bun global we rely on. Typed locally (instead of importing
 * `@types/bun`) so this file compiles unchanged under the React/Vite tsconfig.
 */
type BunUuidGlobal = { Bun?: { randomUUIDv7?: () => string } };

/**
 * Mint a new ID and cast it to the requested brand:
 *
 * ```ts
 * const workspaceId = newId<WorkspaceId>();
 * const jobId: JobId = newId(); // brand inferred from the annotation
 * ```
 *
 * - Under **Bun** (api, worker, tests) this returns a **UUIDv7**: time-ordered, so database
 *   inserts stay append-friendly and ids sort by creation time.
 * - Anywhere else (browsers, Node) it falls back to `crypto.randomUUID()`, which is a **UUIDv4**
 *   — random, not ordered.
 *
 * **Ordering is therefore only guaranteed for ids minted server-side.** Treat client-minted ids
 * as opaque and never sort by id in the UI. Both variants validate against every `*Id` schema.
 */
export function newId<T extends string = string>(): T {
  const bun = (globalThis as BunUuidGlobal).Bun;
  const id = typeof bun?.randomUUIDv7 === "function" ? bun.randomUUIDv7() : crypto.randomUUID();
  return id as T;
}

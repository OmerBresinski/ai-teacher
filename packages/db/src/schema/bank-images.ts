import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/** The embedding the library's cards are compared by (`text-embedding-3-small`, 1536 dims). */
export const BANK_EMBED_DIMENSIONS = 1536;

/** Row lifecycle: only `ready` rows are ever served (TEACH-84 FR 5). */
export const bankImageStatus = ["pending", "ready", "rejected", "retired"] as const;
export type BankImageStatus = (typeof bankImageStatus)[number];

/** The checks a row passed before it became `ready` (TEACH-84 FR 1, FR 5). */
export type BankImageChecks = {
  onSubject: boolean;
  suitable: boolean | null;
  noText: boolean | null;
  checkedBy: string;
  checkedAt: string;
};

/**
 * `bank_images` — the shared picture library (TEACH-84, UX rulings 88 and 158). Every picture the
 * pipeline places and its judge passed is stored once here with its tags, provenance and credit,
 * and looked up by brief before any search, so the next lesson on the subject reuses it.
 *
 * **Non-tenant, by design (ADR 0007 justification):** the library is shared across Workspaces
 * (that is its whole point). No teacher content enters it: the tags and card are the pipeline's
 * own image brief (our Plan prompt's output, normalised: subject, mustShow items, age band and
 * orientation). The teacher's typed topic and the lesson title are never stored (the spec's `topic`
 * tag is dropped for that reason). The bytes are a stock photograph (Pexels; later Commons or a generated picture), and
 * no column names a Workspace, lesson or user. Reads and writes go through `unsafeDb` (README).
 *
 * - `storage_key` is under the reserved library prefix (`BANK_STORAGE_SPACE/bank/<id>.<ext>`, see
 *   `@tj/images` `bankStorageKey`): never served directly; a hit is copied into the lesson's
 *   Workspace (`<workspaceId>/images/…`) so `/files` keeps its tenancy check.
 * - `subject` is `normaliseQuery(brief.subject)`; `depicts` the brief's `mustShow` items the
 *   judge confirmed visible; `bands` the age bands it was checked for.
 * - `source` is the `PhotoSource` the slide element carries (provider, credit, the judge's
 *   evidence), so a reused photo keeps its photographer credit.
 * - `caption` is the card text embedded into `embedding` (`embed_model`, `embed_dims` recorded);
 *   null when no embedder was configured at write time (the exact tag path still finds it).
 * - `prompt` (generated rows only, phase 2) is stored, never logged (ADR 0015).
 */
export const bankImages = pgTable(
  "bank_images",
  {
    id: uuid("id").primaryKey(),
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    orientation: text("orientation").notNull(),
    subject: text("subject").notNull(),
    bands: text("bands").array().notNull(),
    depicts: text("depicts").array().notNull().default(sql`'{}'::text[]`),
    style: text("style").notNull(),
    alt: text("alt").notNull(),
    source: jsonb("source").notNull(),
    generator: text("generator"),
    generatorTerms: text("generator_terms"),
    prompt: text("prompt"),
    checks: jsonb("checks").$type<BankImageChecks>().notNull(),
    status: text("status").$type<BankImageStatus>().notNull(),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    reports: integer("reports").notNull().default(0),
    caption: text("caption"),
    embedModel: text("embed_model"),
    embedDims: integer("embed_dims"),
    embedding: vector("embedding", { dimensions: BANK_EMBED_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bank_images_status_orientation_subject_idx").on(t.status, t.orientation, t.subject),
    uniqueIndex("bank_images_live_subject_uniq")
      .on(t.subject, t.orientation, t.bands)
      .where(sql`${t.status} in ('pending', 'ready')`),
  ],
);

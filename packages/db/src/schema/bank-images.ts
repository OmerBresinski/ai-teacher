import { index, integer, jsonb, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

/**
 * `bank_images` — the shared picture library (TEACH-84, UX ruling 158). Every picture the
 * pipeline places, fetched (Pexels, Wikimedia Commons) or generated, is stored once here and
 * looked up by request before any search or generation.
 *
 * **Non-tenant, by design (ADR 0007 justification):** the library is shared across Workspaces so
 * the second lesson on a subject reuses the first one's picture. No teacher content enters it: the
 * request text is the pipeline writer's picture request (our prompt's output about a curriculum
 * topic, never a teacher's Source or wording), the bytes are a stock photo, a Commons file or a
 * generated image, and no column names a Workspace, lesson or user.
 *
 * - `storage_key` is `bank/<id>.<ext>` in the same object storage `storePhoto` uses, served at
 *   `/files/<key>`.
 * - `source` is the `PhotoSource` the slide element carries (provider, credit, licence), so a
 *   reused Commons picture keeps its credit; `provider` is lifted out for filtering.
 * - `request` is the text the row was asked for; `embedding` is that text's embedding
 *   (`embed_model`, `embed_dims` recorded), compared by exact cosine (`<=>`) at lookup.
 * - `family` is the aspect family (landscape, square, portrait): reuse needs the same family.
 * - `prompt` (generated rows only) is stored, never logged (ADR 0015).
 * - `flags` holds `lookCheck` for a generated stand-in for a real thing (ruling 158 item 1).
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
    family: text("family").notNull(),
    provider: text("provider").notNull(),
    source: jsonb("source").notNull(),
    licence: text("licence"),
    credit: text("credit"),
    alt: text("alt").notNull(),
    tags: text("tags").array().notNull().default([]),
    request: text("request").notNull(),
    route: text("route").notNull(),
    generator: text("generator"),
    generatorTerms: text("generator_terms"),
    prompt: text("prompt"),
    costUsd: text("cost_usd"),
    embedModel: text("embed_model").notNull(),
    embedDims: integer("embed_dims").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    flags: jsonb("flags").notNull().default({}),
    status: text("status").notNull().default("ready"),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bank_images_status_family_idx").on(t.status, t.family)],
);

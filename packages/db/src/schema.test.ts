import { describe, expect, test } from "bun:test";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  ALL_TABLES,
  edges,
  facts,
  jobEvents,
  KNOWLEDGE_TABLES,
  NON_TENANT_TABLES,
  sectionEmbeddings,
  TENANT_TABLES,
  workspaces,
} from "./schema";

// Pure schema invariants (ADR 0007). No database needed.

const name = (t: PgTable) => getTableConfig(t).name;

describe("schema classification", () => {
  test("every table is in exactly one of TENANT_TABLES / NON_TENANT_TABLES / KNOWLEDGE_TABLES", () => {
    const tenant = new Set(TENANT_TABLES.map(name));
    const nonTenant = new Set(NON_TENANT_TABLES.map(name));
    const knowledge = new Set(KNOWLEDGE_TABLES.map(name));
    for (const table of Object.values(ALL_TABLES)) {
      const n = name(table);
      const hits = [tenant.has(n), nonTenant.has(n), knowledge.has(n)].filter(Boolean).length;
      expect(hits, `${n} must be classified exactly once`).toBe(1);
    }
    expect(tenant.size + nonTenant.size + knowledge.size).toBe(Object.keys(ALL_TABLES).length);
  });

  test("knowledge tables are all kb_-prefixed and have no workspace_id (TG-2)", () => {
    for (const table of KNOWLEDGE_TABLES) {
      const config = getTableConfig(table);
      expect(config.name.startsWith("kb_"), `${config.name} must be kb_-prefixed`).toBe(true);
      expect(config.columns.some((c) => c.name === "workspace_id")).toBe(false);
    }
    expect(KNOWLEDGE_TABLES.map(name).sort()).toEqual([
      "kb_edge",
      "kb_exclusion_phrase",
      "kb_fact",
      "kb_fact_signal",
      "kb_match_log",
      "kb_pack",
      "kb_section",
      "kb_section_alias",
      "kb_section_embedding",
      "kb_source",
      "kb_source_sentence",
      "kb_threshold",
    ]);
  });

  test("kb_fact has the partial unique index for one current definition per (section, term, sense, band)", () => {
    const idx = getTableConfig(facts).indexes.find(
      (i) => i.config.name === "kb_fact_one_current_definition_uidx",
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeDefined();
    const leading = idx?.config.columns.slice(0, 2).map((c) => ("name" in c ? c.name : "expr"));
    expect(leading).toEqual(["section_id", "term_id"]);
  });

  test("kb_section_embedding is keyed by (section_id, embedding_model, dims)", () => {
    const pk = getTableConfig(sectionEmbeddings).primaryKeys[0];
    expect(pk?.columns.map((c) => c.name)).toEqual(["section_id", "embedding_model", "dims"]);
  });

  test("kb_edge.type is the four-value enum", () => {
    const col = getTableConfig(edges).columns.find((c) => c.name === "type");
    expect(col?.enumValues).toEqual([
      "aligned-to",
      "deeper-version-of",
      "supersedes",
      "merge-candidate",
    ]);
  });

  test("non-tenant tables are the tenant root and the better-auth identity tables (ADR 0008)", () => {
    expect(NON_TENANT_TABLES.map(name).sort()).toEqual([
      "accounts",
      "sessions",
      "users",
      "verifications",
      "workspaces",
    ]);
  });

  test("workspaces.owner_user_id references users and is unique (one personal Workspace)", () => {
    const config = getTableConfig(workspaces);
    const fk = config.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === "owner_user_id"),
    );
    expect(fk).toBeDefined();
    expect(getTableConfig(fk?.reference().foreignTable as PgTable).name).toBe("users");
    const unique = config.indexes.find((i) => i.config.name === "workspaces_owner_user_id_uidx");
    expect(unique?.config.unique).toBe(true);
  });

  test("tenant tables have workspace_id NOT NULL with a FK to workspaces and an index", () => {
    for (const table of TENANT_TABLES) {
      const config = getTableConfig(table);
      const column = config.columns.find((c) => c.name === "workspace_id");
      expect(column, `${config.name} has no workspace_id column`).toBeDefined();
      expect(column?.notNull, `${config.name}.workspace_id must be NOT NULL`).toBe(true);

      const fk = config.foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === "workspace_id"),
      );
      expect(fk, `${config.name}.workspace_id has no FK`).toBeDefined();
      expect(getTableConfig(fk?.reference().foreignTable as PgTable).name).toBe("workspaces");

      const indexed = config.indexes.some((idx) => {
        const first = idx.config.columns[0];
        return first !== undefined && "name" in first && first.name === "workspace_id";
      });
      expect(indexed, `${config.name} has no index led by workspace_id`).toBe(true);
    }
  });

  test("job_events has the two indexes ADR 0012 needs and the one-terminal-per-job index (TEACH-82)", () => {
    const indexes = getTableConfig(jobEvents).indexes;
    expect(indexes.map((i) => i.config.name).sort()).toEqual([
      "job_events_job_id_at_idx",
      "job_events_one_terminal_per_job_uidx",
      "job_events_workspace_id_at_idx",
    ]);
    const terminal = indexes.find((i) => i.config.name === "job_events_one_terminal_per_job_uidx");
    expect(terminal?.config.unique).toBe(true);
    expect(terminal?.config.where).toBeDefined();
    const cols = terminal?.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(cols).toEqual(["job_id"]);
  });

  test("workspaces.id has no database default (minted app-side)", () => {
    const id = getTableConfig(workspaces).columns.find((c) => c.name === "id");
    expect(id?.primary).toBe(true);
    expect(id?.hasDefault).toBe(false);
  });
});

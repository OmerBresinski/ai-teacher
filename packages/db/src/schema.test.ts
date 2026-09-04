import { describe, expect, test } from "bun:test";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { ALL_TABLES, jobEvents, NON_TENANT_TABLES, TENANT_TABLES, workspaces } from "./schema";

// Pure schema invariants (ADR 0007). No database needed.

const name = (t: PgTable) => getTableConfig(t).name;

describe("schema classification", () => {
  test("every table is in exactly one of TENANT_TABLES / NON_TENANT_TABLES", () => {
    const tenant = new Set(TENANT_TABLES.map(name));
    const nonTenant = new Set(NON_TENANT_TABLES.map(name));
    for (const table of Object.values(ALL_TABLES)) {
      const n = name(table);
      const inTenant = tenant.has(n);
      const inNonTenant = nonTenant.has(n);
      expect(inTenant !== inNonTenant).toBe(true);
    }
    expect(tenant.size + nonTenant.size).toBe(Object.keys(ALL_TABLES).length);
  });

  test("workspaces is the only non-tenant table", () => {
    expect(NON_TENANT_TABLES.map(name)).toEqual(["workspaces"]);
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

  test("job_events has the two indexes ADR 0012 needs", () => {
    const names = getTableConfig(jobEvents)
      .indexes.map((i) => i.config.name)
      .sort();
    expect(names).toEqual(["job_events_job_id_at_idx", "job_events_workspace_id_at_idx"]);
  });

  test("workspaces.id has no database default (minted app-side)", () => {
    const id = getTableConfig(workspaces).columns.find((c) => c.name === "id");
    expect(id?.primary).toBe(true);
    expect(id?.hasDefault).toBe(false);
  });
});

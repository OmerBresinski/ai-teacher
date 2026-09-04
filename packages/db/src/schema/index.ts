import { accounts, sessions, users, verifications } from "./auth";
import { jobEvents } from "./job-events";
import { workspaces } from "./workspaces";

export * from "./_columns";
export { accounts, authSchema, sessions, users, verifications } from "./auth";
export { jobEvents } from "./job-events";
export { workspaces } from "./workspaces";

/**
 * Every table with a `workspace_id` column. `forWorkspace()` accepts these and only these; the
 * invariant test checks each one has `workspace_id NOT NULL` with a FK and an index (ADR 0007).
 * **Add every new tenant table here.**
 */
export const TENANT_TABLES = [jobEvents] as const;

/**
 * The documented allow-list of tables without `workspace_id` (ADR 0007): the tenant root and the
 * better-auth identity tables (ADR 0008 — identity sits above the Workspace; see `auth.ts`).
 * Anything else needs a written justification in its schema file.
 */
export const NON_TENANT_TABLES = [workspaces, users, sessions, accounts, verifications] as const;

/** Every application table, for the exhaustiveness check below and for tests. */
export const ALL_TABLES = {
  workspaces,
  users,
  sessions,
  accounts,
  verifications,
  jobEvents,
} as const;

// ---------------------------------------------------------------------------------------------
// Type-level exhaustiveness: every table in `ALL_TABLES` must appear in exactly one of the two
// lists. Adding a table to `ALL_TABLES` without classifying it is a compile error; so is putting
// it in both lists.
// ---------------------------------------------------------------------------------------------

type TenantTable = (typeof TENANT_TABLES)[number];
type NonTenantTable = (typeof NON_TENANT_TABLES)[number];
type AnyTable = (typeof ALL_TABLES)[keyof typeof ALL_TABLES];

type Extends<A, B> = [A] extends [B] ? true : false;
type AssertTrue<T extends true> = T;

// Every table is classified …
type _EveryTableClassified = AssertTrue<Extends<AnyTable, TenantTable | NonTenantTable>>;
// … no classified table is missing from ALL_TABLES …
type _NoStrayClassification = AssertTrue<Extends<TenantTable | NonTenantTable, AnyTable>>;
// … and the two lists are disjoint.
type _Disjoint = AssertTrue<Extends<Extract<TenantTable, NonTenantTable>, never>>;

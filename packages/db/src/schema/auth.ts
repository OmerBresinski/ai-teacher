import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * better-auth tables (ADR 0008). Generated with
 * `bunx @better-auth/cli generate` against better-auth **1.7.2** (Drizzle adapter,
 * `provider: "pg"`, `usePlural: true`) and then hand-adjusted:
 *
 * - table names are snake_case plural (`users`, `sessions`, `accounts`, `verifications`); the
 *   adapter is configured with `usePlural: true` so the model `user` maps to the export `users`;
 * - timestamps are `timestamptz` like the rest of the schema (the CLI emits `timestamp`);
 * - index names are snake_case.
 *
 * Ids are `text` because better-auth mints its own (non-UUID) ids; `workspaces.owner_user_id`
 * keeps the same type so it can reference `users.id`.
 *
 * These are **non-tenant tables** (`NON_TENANT_TABLES`): identity sits above the Workspace, and
 * the teacher's email/name is the only personal data the product holds (F15-D3). When
 * re-generating after a better-auth upgrade, diff the CLI output against this file instead of
 * overwriting it.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .$onUpdate(() => new Date())
    .notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** The tables better-auth's Drizzle adapter needs, keyed by plural model name. */
export const authSchema = { users, sessions, accounts, verifications } as const;

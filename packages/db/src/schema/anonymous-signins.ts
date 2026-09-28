import { date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

/**
 * `anonymous_signins` — how many anonymous sessions one client IP minted on one UTC day
 * (TEACH-222). The per-IP daily ceiling on `POST /auth/sign-in/anonymous` reads and bumps it in
 * one upsert, so the count survives restarts and holds across api replicas.
 *
 * No `workspace_id` (ADR 0007 justification): the row exists before any user or Workspace does;
 * it is an abuse counter keyed by network address, not tenant data. Old days are deleted by the
 * worker's `auth.anonymous-cleanup` job.
 */
export const anonymousSignins = pgTable(
  "anonymous_signins",
  {
    ip: text("ip").notNull(),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ip, t.day] })],
);

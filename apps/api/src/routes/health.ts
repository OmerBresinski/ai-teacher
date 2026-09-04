/**
 * `GET /health` — liveness + database reachability. 200 `{ ok: true, db: "up" }` when `select 1`
 * succeeds, otherwise a 503 envelope with `retryable: true` (Railway healthcheck target).
 */
import type { DbHandle } from "@tj/db";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { errorResponse } from "../errors";

export function healthRoutes(db: Pick<DbHandle, "sql">) {
  return new Hono<AppEnv>().get("/health", async (c) => {
    try {
      await db.sql`select 1`;
    } catch (err) {
      c.get("logger").warn({ err }, "health: database unreachable");
      return errorResponse(c, 503, "service_unavailable", "The database is unreachable.", true);
    }
    return c.json({ ok: true as const, db: "up" as const }, 200);
  });
}

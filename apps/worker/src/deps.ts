import { type CreatedAi, createAi } from "@tj/ai";
import type { Db } from "@tj/db";
import type { Logger } from "pino";
import type { Env } from "./env";

/**
 * Boot-owned dependencies every handler receives as `ctx.deps`. `db` is the same pooled Drizzle
 * client the `JobsContext` holds (one pool per process); handlers reach tenant tables through
 * `forWorkspace(deps.db, workspaceId)` only (ADR 0007).
 */
export type WorkerDeps = { ai: CreatedAi; db: Db };

export function createWorkerDeps(env: Env, logger: Logger, db: Db): WorkerDeps {
  return { ai: createAi(env, { logger }), db };
}

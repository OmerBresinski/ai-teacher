import { type CreatedAi, createAi } from "@tj/ai";
import type { Db } from "@tj/db";
import { noSources, type SourceLoader } from "@tj/generation";
import type { Logger } from "pino";
import type { Env } from "./env";

/**
 * Boot-owned dependencies every handler receives as `ctx.deps`. `db` is the same pooled Drizzle
 * client the `JobsContext` holds (one pool per process); handlers reach tenant tables through
 * `forWorkspace(deps.db, workspaceId)` only (ADR 0007). `caps` are the per-job budget limits
 * (ADR 0025 §15); `sources` is the Source loader, `noSources` until F03.
 */
export type WorkerDeps = {
  ai: CreatedAi;
  db: Db;
  caps: { capUsd: number; capTokens: number };
  sources: SourceLoader;
};

export function createWorkerDeps(env: Env, logger: Logger, db: Db): WorkerDeps {
  return {
    ai: createAi(env, { logger }),
    db,
    caps: { capUsd: env.AI_LESSON_COST_CAP_USD, capTokens: env.AI_LESSON_TOKEN_CAP },
    sources: noSources,
  };
}

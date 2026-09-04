import { type CreatedAi, createAi } from "@tj/ai";
import type { Logger } from "pino";
import type { Env } from "./env";

/** Boot-owned dependencies that job wiring receives in a follow-up. */
export type WorkerDeps = { ai: CreatedAi };

export function createWorkerDeps(env: Env, logger: Logger): WorkerDeps {
  return { ai: createAi(env, { logger }) };
}

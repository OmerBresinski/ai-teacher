/**
 * Structured logging for `@tj/api` (ADR 0015): pino JSON in test/production, `pino-pretty` in
 * development. Never pass request/response bodies, prompts or Artefact content to the logger.
 */
import pino, { type Logger } from "pino";
import type { Env } from "./env";

export type { Logger };

export function createLogger(env: Pick<Env, "NODE_ENV" | "LOG_LEVEL">): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: "api" },
    redact: { paths: ["req.headers.authorization", "req.headers.cookie"], remove: true },
    ...(env.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
          },
        }
      : {}),
  });
}

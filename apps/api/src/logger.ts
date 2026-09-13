/**
 * Structured logging for `@tj/api` (ADR 0015): pino JSON in test/production, `pino-pretty` in
 * development. Never pass request/response bodies, prompts or Artefact content to the logger.
 */
import { safeError, safeErrorLogRecord } from "@tj/domain";
import pino, { type DestinationStream, type Logger } from "pino";
import type { Env } from "./env";

export type { Logger };

export function createLogger(
  env: Pick<Env, "NODE_ENV" | "LOG_LEVEL">,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level: env.LOG_LEVEL,
      base: { service: "api" },
      serializers: { err: safeError, error: safeError },
      hooks: {
        logMethod(args, method) {
          args[0] = safeErrorLogRecord(args[0]);
          method.apply(this, args);
        },
      },
      redact: { paths: ["req.headers.authorization", "req.headers.cookie"], remove: true },
      ...(env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
            },
          }
        : {}),
    },
    destination,
  );
}

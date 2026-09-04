import pino, { type Logger } from "pino";
import type { Env } from "./env";

/** pino JSON logs; `pino-pretty` only in development (ADR 0015). */
export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: "worker" },
    ...(env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty", options: { colorize: true } } }
      : {}),
  });
}

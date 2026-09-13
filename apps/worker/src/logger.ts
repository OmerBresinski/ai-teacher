import { safeError, safeErrorLogRecord } from "@tj/domain";
import pino, { type DestinationStream, type Logger } from "pino";
import type { Env } from "./env";

/** pino JSON logs; `pino-pretty` only in development (ADR 0015). */
export function createLogger(
  env: Pick<Env, "NODE_ENV" | "LOG_LEVEL">,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level: env.LOG_LEVEL,
      base: { service: "worker" },
      serializers: { err: safeError, error: safeError },
      hooks: {
        logMethod(args, method) {
          args[0] = safeErrorLogRecord(args[0]);
          method.apply(this, args);
        },
      },
      ...(env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { colorize: true } } }
        : {}),
    },
    destination,
  );
}

import { safeError, safeErrorLogRecord } from "@tj/domain";
import pino, { type DestinationStream, type Logger } from "pino";
import type { Env } from "./env";

/** Sees every enabled log call with its logger's bindings (ADR 0041: PostHog `gen_*` events). */
export type LogTap = (bindings: Record<string, unknown>, record: unknown, msg: unknown) => void;

/** pino JSON logs; `pino-pretty` only in development (ADR 0015). */
export function createLogger(
  env: Pick<Env, "NODE_ENV" | "LOG_LEVEL">,
  destination?: DestinationStream,
  tap?: LogTap,
): Logger {
  return pino(
    {
      level: env.LOG_LEVEL,
      base: { service: "worker" },
      serializers: { err: safeError, error: safeError },
      hooks: {
        logMethod(args, method) {
          args[0] = safeErrorLogRecord(args[0]);
          if (tap) {
            try {
              const first: unknown = args[0];
              const record = typeof first === "string" ? {} : first;
              const msg = typeof first === "string" ? first : args[1];
              tap(this.bindings(), record, msg);
            } catch {
              // Reporting never breaks logging.
            }
          }
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

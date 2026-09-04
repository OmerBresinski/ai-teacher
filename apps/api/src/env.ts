/**
 * Environment contract for `@tj/api` (ADR 0015). `process.env` is parsed once at boot with Zod;
 * missing or invalid values print one `ENV_VAR: message` line each and exit 1 — no stack trace.
 *
 * `parseEnv()` is the pure core (returns a Result, never exits) so it can be unit-tested;
 * `loadEnv()` is the boot-time wrapper used by `src/index.ts`.
 */
import { z } from "zod";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const originList = z
  .string()
  .default("http://localhost:5173")
  .transform((raw) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
  .pipe(z.array(z.url()).min(1));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.url(),
  /** Comma-separated in the environment; an array of origins after parsing. */
  WEB_ORIGIN: originList,
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export type Env = z.output<typeof EnvSchema>;

export type ParseEnvResult =
  | { ok: true; env: Env }
  | { ok: false; errors: { variable: string; message: string }[] };

/** Zod 4 reports a missing key as an `invalid_type` with `received: undefined`; say "Required". */
function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type" && issue.input === undefined) return "Required";
  return issue.message;
}

/** Pure: parse `source` (defaults to `process.env`) into a typed `Env` or a list of errors. */
export function parseEnv(source: Record<string, string | undefined> = process.env): ParseEnvResult {
  const result = EnvSchema.safeParse(source);
  if (result.success) return { ok: true, env: result.data };
  const errors = result.error.issues.map((issue) => ({
    variable: String(issue.path[0] ?? "(root)"),
    message: describeIssue(issue),
  }));
  return { ok: false, errors };
}

/** Boot-time: parse `process.env` or print `VAR: message` lines to stderr and exit 1. */
export function loadEnv(): Env {
  const parsed = parseEnv();
  if (parsed.ok) return parsed.env;
  process.stderr.write("Invalid environment for @tj/api:\n");
  for (const { variable, message } of parsed.errors) {
    process.stderr.write(`${variable}: ${message}\n`);
  }
  process.exit(1);
}

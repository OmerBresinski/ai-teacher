/**
 * Environment contract for `@tj/api` (ADR 0015). `process.env` is parsed once at boot with Zod;
 * missing or invalid values print one `ENV_VAR: message` line each and exit 1 — no stack trace.
 *
 * `parseEnv()` is the pure core (returns a Result, never exits) so it can be unit-tested;
 * `loadEnv()` is the boot-time wrapper used by `src/index.ts`.
 */

import { DEFAULT_MODEL_IDS, DEFAULT_REGION } from "@tj/ai";
import { z } from "zod";
import { isValidOriginPattern } from "./origins";

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

/**
 * Comma-separated glob origins (`https://*.vercel.app`); empty by default. Each entry must be an
 * origin (scheme + host, optional port, no path) containing at least one `*`. See `origins.ts`.
 */
const originPatternList = z
  .string()
  .default("")
  .transform((raw) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
  .pipe(
    z.array(
      z.string().refine(isValidOriginPattern, {
        message: "Each entry must be an origin glob like https://*.vercel.app (no path)",
      }),
    ),
  );

/** Empty strings (e.g. `GOOGLE_CLIENT_ID=` left in `.env`) count as "unset". */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v));

export const COOKIE_SAMESITE_VALUES = ["lax", "none", "strict"] as const;

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.url(),
    /** Comma-separated in the environment; an array of origins after parsing. */
    WEB_ORIGIN: originList,
    /** Glob origins for per-deployment preview URLs (Vercel), matched alongside `WEB_ORIGIN`. */
    WEB_ORIGIN_PATTERNS: originPatternList,
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

    // --- AI provider (ADR 0018) ------------------------------------------------------------
    AWS_BEARER_TOKEN_BEDROCK: optionalString,
    AWS_REGION: z.string().default(DEFAULT_REGION),
    AI_MODEL_FRONTIER: z.string().min(1).default(DEFAULT_MODEL_IDS.frontier),
    AI_MODEL_STANDARD: z.string().min(1).default(DEFAULT_MODEL_IDS.standard),
    AI_MODEL_SMALL: z.string().min(1).default(DEFAULT_MODEL_IDS.small),

    // --- Auth (ADR 0008, TEACH-20) ---------------------------------------------------------
    /** Signs session cookies and tokens. `bun run setup` generates it (infra/env.contract.ts). */
    BETTER_AUTH_SECRET: z
      .string({ error: "Required — generate one with `openssl rand -base64 32`" })
      .min(32, "Must be at least 32 characters (`openssl rand -base64 32`)"),
    /** Public origin of this API; magic links point here (`<BETTER_AUTH_URL>/auth/...`). */
    BETTER_AUTH_URL: z.url().default("http://localhost:3001"),
    /** Parent domain for the session cookie (`.example.com`) so app.<d> and api.<d> share it. */
    COOKIE_DOMAIN: optionalString,
    /** `none` is needed when web and api are on unrelated origins (Vercel ↔ Railway previews). */
    COOKIE_SAMESITE: z.enum(COOKIE_SAMESITE_VALUES).default("lax"),
    /** Only `console` exists until F17 wires a real provider. */
    MAIL_PROVIDER: z.string().default("console"),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    MICROSOFT_CLIENT_ID: optionalString,
    MICROSOFT_CLIENT_SECRET: optionalString,
    /** `"1"` mounts the test-only routes (TEACH-22). Never in production. */
    ENABLE_TEST_ROUTES: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.AWS_BEARER_TOKEN_BEDROCK) {
      ctx.addIssue({
        code: "custom",
        path: ["AWS_BEARER_TOKEN_BEDROCK"],
        message: "required in production (ADR 0018)",
      });
    }
    if (env.ENABLE_TEST_ROUTES !== undefined && env.ENABLE_TEST_ROUTES !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["ENABLE_TEST_ROUTES"],
        message: 'Must be "1" or unset',
      });
    }
    if (env.ENABLE_TEST_ROUTES === "1" && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["ENABLE_TEST_ROUTES"],
        message: "Cannot be set when NODE_ENV=production",
      });
    }
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
  // Zod skips `superRefine` when the object itself is invalid; the production gate for the
  // test routes must be reported regardless of what else is missing (TEACH-22).
  if (
    source.NODE_ENV === "production" &&
    (source.ENABLE_TEST_ROUTES ?? "").trim() !== "" &&
    !errors.some((e) => e.variable === "ENABLE_TEST_ROUTES")
  ) {
    errors.unshift({
      variable: "ENABLE_TEST_ROUTES",
      message: "Cannot be set when NODE_ENV=production",
    });
  }
  if (
    source.NODE_ENV === "production" &&
    (source.AWS_BEARER_TOKEN_BEDROCK ?? "").trim() === "" &&
    !errors.some((e) => e.variable === "AWS_BEARER_TOKEN_BEDROCK")
  ) {
    errors.unshift({
      variable: "AWS_BEARER_TOKEN_BEDROCK",
      message: "required in production (ADR 0018)",
    });
  }
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

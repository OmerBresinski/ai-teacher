import { DEFAULT_MODEL_IDS, DEFAULT_REGION } from "@tj/ai";
import { z } from "zod";

/** Empty strings (e.g. a documented secret left blank in `.env`) count as "unset". */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === "" ? undefined : value));

/**
 * Boot-time environment validation (ADR 0015). Bun loads `apps/worker/.env` from the cwd; on
 * Railway the variables come from the service. A bad value prints one line per problem and
 * exits 1 — nothing else runs.
 */
export const EnvSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    AWS_BEARER_TOKEN_BEDROCK: optionalString,
    AWS_REGION: z.string().default(DEFAULT_REGION),
    AI_MODEL_FRONTIER: z.string().min(1).default(DEFAULT_MODEL_IDS.frontier),
    AI_MODEL_STANDARD: z.string().min(1).default(DEFAULT_MODEL_IDS.standard),
    AI_MODEL_SMALL: z.string().min(1).default(DEFAULT_MODEL_IDS.small),
    // --- AI budget + Mastra (ADR 0025 §15, §21) ------------------------------------------
    AI_LESSON_COST_CAP_USD: z.coerce.number().nonnegative().default(0.5),
    AI_LESSON_TOKEN_CAP: z.coerce.number().int().positive().default(300_000),
    MASTRA_TELEMETRY_DISABLED: optionalString,
    // --- Images (Pexels, Images project) -------------------------------------------------
    /**
     * Pexels API key. Not required in production: an unset key skips illustrate's placements
     * (the step logs "images disabled"), never a boot failure.
     */
    PEXELS_API_KEY: optionalString,
    /**
     * Public origin of the api (no trailing slash), so pipeline-placed photo URLs resolve in
     * the browser. Unset degrades to relative `/files` URLs (broken cross-origin, as before).
     */
    API_PUBLIC_BASE_URL: optionalString,
    // --- test-only: the scripted fake in place of Bedrock (ADR 0025 §22) --------------------
    AI_FAKE_SCRIPT: z.enum(["pipeline"]).optional(),
    AI_FAKE_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.AWS_BEARER_TOKEN_BEDROCK) {
      ctx.addIssue({
        code: "custom",
        path: ["AWS_BEARER_TOKEN_BEDROCK"],
        message: "required in production (ADR 0018)",
      });
    }
    if (env.NODE_ENV === "production" && env.AI_FAKE_SCRIPT !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["AI_FAKE_SCRIPT"],
        message: "refused in production: the fake never answers a real teacher",
      });
    }
  });
export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  console.error(
    `apps/worker: invalid environment\n${lines.join("\n")}\n` +
      "Copy apps/worker/.env.example to apps/worker/.env and fill in the values.",
  );
  process.exit(1);
}

import { DEFAULT_MODEL_IDS, DEFAULT_REGION } from "@tj/ai";
import { REASONING_EFFORTS } from "@tj/generation";
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
    /** OpenAI key: serves `openai/<model>` ids directly (`@tj/ai`, ADR 0031). */
    OPENAI_API_KEY: optionalString,
    AWS_BEARER_TOKEN_BEDROCK: optionalString,
    AWS_REGION: z.string().default(DEFAULT_REGION),
    /** Vercel AI Gateway key: the fallback for other `provider/model` ids (`@tj/ai`). Optional. */
    AI_GATEWAY_API_KEY: optionalString,
    AI_MODEL_FRONTIER: z.string().min(1).default(DEFAULT_MODEL_IDS.frontier),
    AI_MODEL_STANDARD: z.string().min(1).default(DEFAULT_MODEL_IDS.standard),
    AI_MODEL_SMALL: z.string().min(1).default(DEFAULT_MODEL_IDS.small),
    // --- AI budget + Mastra (ADR 0025 §15, §21) ------------------------------------------
    AI_LESSON_COST_CAP_USD: z.coerce.number().nonnegative().default(0.5),
    AI_LESSON_TOKEN_CAP: z.coerce.number().int().positive().default(300_000),
    /** Per-worksheet spend cap (ADR 0030 item 1): the `lesson.worksheet` job's own budget, never the lesson's. */
    AI_WORKSHEET_COST_CAP_USD: z.coerce.number().nonnegative().default(0.1),
    /** Plan on the frontier class from this year group up (TEACH-259); unset keeps every Plan call `standard`. */
    AI_PLAN_FRONTIER_FROM_YEAR: z.coerce.number().int().min(1).max(13).optional(),
    /** Every model call runs at this reasoning effort (TEACH-72); unset keeps each stage's own. */
    AI_REASONING_EFFORT: optionalString.pipe(z.enum(REASONING_EFFORTS).optional()),
    MASTRA_TELEMETRY_DISABLED: optionalString,
    // --- Images (Pexels, Images project) -------------------------------------------------
    /**
     * Pexels API key. Not required in production: an unset key skips illustrate's placements
     * (the step logs "images disabled"), never a boot failure.
     */
    PEXELS_API_KEY: optionalString,
    // --- test-only: the scripted fake in place of Bedrock (ADR 0025 §22) --------------------
    AI_FAKE_SCRIPT: z.enum(["pipeline"]).optional(),
    AI_FAKE_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.OPENAI_API_KEY && !env.AWS_BEARER_TOKEN_BEDROCK) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "required in production unless AWS_BEARER_TOKEN_BEDROCK is set (ADR 0031)",
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

import { z } from "zod";

/**
 * Boot-time environment validation (ADR 0015). Bun loads `apps/worker/.env` from the cwd; on
 * Railway the variables come from the service. A bad value prints one line per problem and
 * exits 1 — nothing else runs.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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

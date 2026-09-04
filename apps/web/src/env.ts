/**
 * Browser environment, validated once at module load (ADR 0015). Vite inlines `import.meta.env.*`
 * at build time; an invalid value throws a readable error before the app renders.
 */
import { z } from "zod";

const absoluteUrl = z.url({ protocol: /^https?$/ });

export const EnvSchema = z.object({
  /** API base URL: `/api` (dev proxy) or an absolute origin in production builds. */
  VITE_API_URL: z.string().min(1).default("/api"),
  VITE_APP_ENV: z.enum(["development", "preview", "production"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, unknown>, isProdBuild: boolean): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "?"}: ${i.message}`);
    throw new Error(`Invalid web environment:\n${lines.join("\n")}`);
  }
  if (isProdBuild && !absoluteUrl.safeParse(result.data.VITE_API_URL).success) {
    throw new Error(
      "Invalid web environment:\n  VITE_API_URL: must be an absolute http(s) URL in a production build " +
        `(got "${result.data.VITE_API_URL}"). The /api dev proxy only exists under \`vite dev\`.`,
    );
  }
  return result.data;
}

export const env: Env = parseEnv(import.meta.env, import.meta.env.PROD);

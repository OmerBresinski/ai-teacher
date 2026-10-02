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
  /**
   * Cloudflare Turnstile site key (TEACH-243). Set: sign-in runs the widget and sends its token.
   * Required in a production build; blank is the same as unset.
   */
  VITE_TURNSTILE_SITE_KEY: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim())),
  /**
   * The `@tj/editor` slot-placeholder switch (look/image-slot). Since TEACH-14 no renderer reads
   * it: the editor always draws photo and diagram slots as placeholders, and present, the viewer
   * and thumbnails never draw a brief.
   */
  VITE_SHOW_SLOT_PLACEHOLDERS: z.enum(["0", "1"]).default("1"),
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
  if (
    isProdBuild &&
    result.data.VITE_APP_ENV === "production" &&
    !result.data.VITE_TURNSTILE_SITE_KEY
  ) {
    throw new Error(
      "Invalid web environment:\n  VITE_TURNSTILE_SITE_KEY: required in a production build " +
        "(the api refuses magic-link sign-in without a Turnstile token, TEACH-243).",
    );
  }
  return result.data;
}

/** The slot placeholders are on (`@tj/editor` switch). */
export const slotPlaceholdersEnabled = (e: Env): boolean => e.VITE_SHOW_SLOT_PLACEHOLDERS === "1";

export const env: Env = parseEnv(import.meta.env, import.meta.env.PROD);

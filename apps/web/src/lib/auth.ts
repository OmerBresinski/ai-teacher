import { createAuthClient } from "@tj/api-client";
import { env } from "@/env";
import { resolveApiBaseUrl } from "@/lib/base-url";

/** better-auth client (ADR 0008): `/auth/*` on the same base URL as the API. */
export const authClient = createAuthClient(
  resolveApiBaseUrl(env.VITE_API_URL, window.location.origin),
);

import { createApiClient } from "@tj/api-client";
import { env } from "@/env";

/** Typed Hono RPC client (ADR 0005). Cookies are included by default. */
export const api = createApiClient(env.VITE_API_URL);

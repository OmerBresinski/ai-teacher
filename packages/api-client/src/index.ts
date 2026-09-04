/**
 * `@tj/api-client` — the typed Hono RPC client for `@tj/api` (ADR 0005).
 *
 * `AppType` is imported **type-only** from `@tj/api/app`; nothing from the server is bundled into
 * browser consumers (`import type` is erased by TypeScript/Vite). Runs in browsers and in Bun.
 */

import type { AppType } from "@tj/api/app";
import { hc } from "hono/client";

export type { AppType };

/**
 * Create a client for the API at `baseUrl` (no trailing slash needed). Cookies are sent by
 * default (`credentials: "include"`) so the session cookie shared across
 * `app.<domain>` / `api.<domain>` works (ADR 0010); pass `init` to override or add headers.
 */
export function createApiClient(baseUrl: string, init?: RequestInit) {
  return hc<AppType>(baseUrl, { init: { credentials: "include", ...init } });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** `GET /jobs/:id/events` — SSE per job (TEACH-19, ADR 0012). Use with `EventSource`. */
export function jobEventsUrl(baseUrl: string, jobId: string): string {
  return `${trimSlash(baseUrl)}/jobs/${encodeURIComponent(jobId)}/events`;
}

/** `GET /events` — SSE for the current Workspace (TEACH-19, ADR 0012). */
export function workspaceEventsUrl(baseUrl: string): string {
  return `${trimSlash(baseUrl)}/events`;
}

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

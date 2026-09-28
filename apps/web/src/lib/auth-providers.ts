import { api } from "@/lib/api";

/** Which "Continue with …" providers the api has credentials for (`GET /auth-providers`). */
export interface AuthProviders {
  google: boolean;
  microsoft: boolean;
}

/**
 * Asks the api which providers are on (ADR 0008 amendment of 2026-09-28, item 5). Any failure
 * reads as "none": a button that cannot work is worse than no button.
 */
export async function fetchAuthProviders(): Promise<AuthProviders> {
  try {
    const res = await api["auth-providers"].$get();
    if (!res.ok) return { google: false, microsoft: false };
    return await res.json();
  } catch {
    return { google: false, microsoft: false };
  }
}

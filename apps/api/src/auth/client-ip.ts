/**
 * Where the api reads the caller's IP (TEACH-222). The browser calls the Railway api directly, so
 * the address comes from a proxy header, never the socket.
 *
 * - `AUTH_IP_HEADER` set (e.g. `cf-connecting-ip` once a CDN fronts the api): that header, and
 *   better-auth's own limiter reads the same one (`authIpAddress`).
 * - Unset: `x-forwarded-for`. The per-IP anonymous ceiling takes its **rightmost** entry, the one
 *   the nearest proxy (Railway's edge) appended, so a client cannot pick its own bucket by
 *   sending a forged header. better-auth keeps its default (it uses the header only when it holds
 *   exactly one address).
 *
 * Nothing here logs an address: only which header is in use and whether it was present.
 */
import type { Env } from "../env";

export const DEFAULT_IP_HEADER = "x-forwarded-for";

type IpEnv = Partial<Pick<Env, "AUTH_IP_HEADER">>;

/** The header the api reads the client IP from. */
export function ipHeaderName(env: IpEnv): string {
  return env.AUTH_IP_HEADER?.trim().toLowerCase() || DEFAULT_IP_HEADER;
}

/**
 * better-auth `advanced.ipAddress` (one line in `auth.ts`): the configured header, or `undefined`
 * to keep better-auth's default.
 */
export function authIpAddress(
  env: Pick<Env, "NODE_ENV"> & IpEnv,
): { ipAddressHeaders: string[] } | undefined {
  return env.AUTH_IP_HEADER ? { ipAddressHeaders: [ipHeaderName(env)] } : undefined;
}

/** The client IP for the per-IP ceiling, or `null` when the header is absent or empty. */
export function clientIp(headers: Headers, env: IpEnv): string | null {
  const name = ipHeaderName(env);
  const raw = headers.get(name);
  if (raw === null) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const ip = name === DEFAULT_IP_HEADER ? parts.at(-1) : parts[0];
  return ip && ip.length <= 64 ? ip.toLowerCase() : null;
}

/** The boot line that says which header the ceiling trusts (verify it on Railway before cutover). */
export function ipSourceDescription(env: IpEnv): { ipHeader: string; configured: boolean } {
  return { ipHeader: ipHeaderName(env), configured: Boolean(env.AUTH_IP_HEADER) };
}

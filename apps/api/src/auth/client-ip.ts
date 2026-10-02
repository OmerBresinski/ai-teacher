/**
 * Where the api reads the caller's IP (TEACH-222, TEACH-300). The browser calls the Railway api
 * directly, so the address comes from a proxy header, never the socket.
 *
 * One rule for both limiters: the per-IP anonymous ceiling resolves the address with better-auth's
 * own `getIPFromHeader`, from the same header better-auth reads, so the two always agree.
 *
 * - `AUTH_IP_HEADER` set: that header. On Railway it is `x-real-ip`, which the edge overwrites
 *   with the client address (`docs/security/auth-edge.md`); behind a CDN, its client-IP header
 *   (e.g. `cf-connecting-ip`).
 * - Unset: `x-forwarded-for`, trusted only when it holds exactly one address. Railway's edge sends
 *   two (the client, then a hop), so production needs `AUTH_IP_HEADER`.
 *
 * IPv6 addresses are grouped by /64 (better-auth's `normalizeIP`), so one client cannot rotate
 * through its own /64 past the ceiling. No resolvable address → `null`; both limiters then count
 * the request in one shared bucket.
 *
 * Nothing here logs an address: only which header is in use and whether it was present.
 */
import { BlockList, isIP } from "node:net";
import { getIPFromHeader } from "@better-auth/core/utils/ip";
import type { Env } from "../env";

export const DEFAULT_IP_HEADER = "x-forwarded-for";

/** better-auth's key for a request with no trusted address; the ceiling shares it. */
export const NO_TRUSTED_IP_KEY = "no-trusted-ip";

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

/**
 * The client IP for the per-IP ceiling, resolved exactly as better-auth's limiter resolves it, or
 * `null` when the header is absent, holds an invalid address, or holds more than one address.
 */
export function clientIp(headers: Headers, env: IpEnv): string | null {
  const raw = headers.get(ipHeaderName(env));
  return raw === null ? null : getIPFromHeader(raw);
}

/** The boot line that says which header the ceiling trusts (verify it on Railway before cutover). */
export function ipSourceDescription(env: IpEnv): { ipHeader: string; configured: boolean } {
  return { ipHeader: ipHeaderName(env), configured: Boolean(env.AUTH_IP_HEADER) };
}

/** Request header that turns on the probe report (TEACH-300); its value is the caller's own IP. */
export const IP_PROBE_HEADER = "x-tj-ip-probe";

function blockList(ranges: [string, number, "ipv4" | "ipv6"][]): BlockList {
  const list = new BlockList();
  for (const [network, prefix, type] of ranges) list.addSubnet(network, prefix, type);
  return list;
}

const CGNAT = blockList([["100.64.0.0", 10, "ipv4"]]);
const HUNDRED_SLASH_8 = blockList([["100.0.0.0", 8, "ipv4"]]);
const PRIVATE = blockList([
  ["10.0.0.0", 8, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["::1", 128, "ipv6"],
]);
const TEST_NET_3 = blockList([["203.0.113.0", 24, "ipv4"]]);

function inList(list: BlockList, ip: string): boolean {
  const family = isIP(ip);
  return family !== 0 && list.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Booleans for one forwarded entry; never the entry itself. */
export interface IpProbeEntry {
  probe: boolean;
  cgnat: boolean;
  in100Slash8: boolean;
  private: boolean;
  testNet3: boolean;
}

/**
 * What each proxy header holds relative to the caller's own address, sent in `x-tj-ip-probe`
 * (TEACH-300). Booleans and counts only, so a forged probe header learns nothing and the log line
 * never carries an address. `null` when the request has no probe header.
 */
export function ipProbeReport(headers: Headers): {
  xffEntries: number;
  xff: IpProbeEntry[];
  xRealIp: boolean;
  xRealIpProbe: boolean;
  cfConnectingIp: boolean;
} | null {
  const probe = headers.get(IP_PROBE_HEADER)?.trim().toLowerCase();
  if (!probe) return null;
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const realIp = headers.get("x-real-ip")?.trim().toLowerCase();
  return {
    xffEntries: entries.length,
    xff: entries.map((entry) => ({
      probe: entry === probe,
      cgnat: inList(CGNAT, entry),
      in100Slash8: inList(HUNDRED_SLASH_8, entry),
      private: inList(PRIVATE, entry),
      testNet3: inList(TEST_NET_3, entry),
    })),
    xRealIp: realIp !== undefined,
    xRealIpProbe: realIp === probe,
    cfConnectingIp: headers.get("cf-connecting-ip") !== null,
  };
}

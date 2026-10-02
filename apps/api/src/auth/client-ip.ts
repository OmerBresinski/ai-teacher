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
import { BlockList, isIP } from "node:net";
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

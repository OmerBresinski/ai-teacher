/**
 * TEACH-300: the client identity both limiters key on. The per-IP anonymous ceiling (`clientIp`)
 * and better-auth's limiter must resolve the same address from the same headers, a forged
 * forwarding chain must not choose it, IPv6 groups by /64, and a request with no address lands in
 * one bounded bucket. better-auth's limiter only runs with NODE_ENV=production, so the last block
 * builds a bare better-auth with `rateLimit.enabled` and an in-memory database.
 */
import { describe, expect, test } from "bun:test";
import { getIP } from "@better-auth/core/utils/ip";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { anonymous } from "better-auth/plugins";
import { authIpAddress, clientIp } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);
const RAILWAY = { AUTH_IP_HEADER: "x-real-ip" };
const UNSET = {};

/** better-auth's resolution under the options `auth.ts` passes (under test, `null` is localhost). */
function betterAuthIp(headers: Headers, env: { AUTH_IP_HEADER?: string }): string | null {
  return getIP(headers, { advanced: { ipAddress: authIpAddress({ NODE_ENV: "test", ...env }) } });
}

const CASES: [string, Record<string, string>, { AUTH_IP_HEADER?: string }, string | null][] = [
  [
    "Railway: x-real-ip is the client",
    { "x-real-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.4, 192.0.2.80" },
    RAILWAY,
    "198.51.100.4",
  ],
  [
    "Railway: another client, another key",
    { "x-real-ip": "198.51.100.5", "x-forwarded-for": "198.51.100.5, 192.0.2.80" },
    RAILWAY,
    "198.51.100.5",
  ],
  [
    "a forged x-forwarded-for does not move the x-real-ip identity",
    { "x-real-ip": "198.51.100.4", "x-forwarded-for": "203.0.113.7, 198.51.100.4, 192.0.2.80" },
    RAILWAY,
    "198.51.100.4",
  ],
  [
    "two x-real-ip values are not trusted",
    { "x-real-ip": "203.0.113.8, 198.51.100.4" },
    RAILWAY,
    null,
  ],
  ["an invalid address is not trusted", { "x-real-ip": "not-an-ip" }, RAILWAY, null],
  [
    "IPv6 groups by /64",
    { "x-real-ip": "2001:DB8:0:1:aaaa::1" },
    RAILWAY,
    "2001:0db8:0000:0001:0000:0000:0000:0000",
  ],
  [
    "IPv4-mapped IPv6 is the IPv4 address",
    { "x-real-ip": "::ffff:198.51.100.4" },
    RAILWAY,
    "198.51.100.4",
  ],
  ["header missing", { "x-forwarded-for": "198.51.100.4" }, RAILWAY, null],
  [
    "unset: a single x-forwarded-for address",
    { "x-forwarded-for": "198.51.100.4" },
    UNSET,
    "198.51.100.4",
  ],
  [
    "unset: a chain is not trusted (neither end chosen)",
    { "x-forwarded-for": "203.0.113.7, 198.51.100.4" },
    UNSET,
    null,
  ],
  ["unset: no header", {}, UNSET, null],
];

describe("one client identity for both limiters (TEACH-300)", () => {
  for (const [name, headers, env, expected] of CASES) {
    test(name, () => {
      expect(clientIp(h(headers), env)).toBe(expected);
      expect(betterAuthIp(h(headers), env)).toBe(expected ?? "127.0.0.1");
    });
  }

  test("IPv6 addresses in one /64 share a key; the next /64 does not", () => {
    const a = clientIp(h({ "x-real-ip": "2001:db8:0:1::1" }), RAILWAY);
    expect(clientIp(h({ "x-real-ip": "2001:db8:0:1:ffff:ffff:ffff:ffff" }), RAILWAY)).toBe(a);
    expect(clientIp(h({ "x-real-ip": "2001:db8:0:2::1" }), RAILWAY)).not.toBe(a);
  });
});

describe("better-auth's limiter keys on the same identity (TEACH-300)", () => {
  const signIn = (auth: ReturnType<typeof bare>, headers: Record<string, string>) =>
    auth.handler(
      new Request("http://localhost:3001/auth/sign-in/anonymous", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: "{}",
      }),
    );
  function bare() {
    return betterAuth({
      baseURL: "http://localhost:3001",
      basePath: "/auth",
      secret: "test-secret-test-secret-test-secret-0123456789",
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      plugins: [anonymous()],
      rateLimit: { enabled: true, storage: "memory" },
      advanced: { ipAddress: authIpAddress({ NODE_ENV: "test", ...RAILWAY }) },
      logger: { disabled: true },
      telemetry: { enabled: false },
    });
  }

  test("two clients have independent buckets; a forged chain cannot pick a fresh one", async () => {
    const auth = bare();
    const client = { "x-real-ip": "198.51.100.4" };
    for (let i = 0; i < 3; i += 1) expect((await signIn(auth, client)).status).toBe(200);
    expect((await signIn(auth, client)).status).toBe(429);
    // Same client, forged x-forwarded-for: still the client's (spent) bucket.
    expect((await signIn(auth, { ...client, "x-forwarded-for": "203.0.113.7" })).status).toBe(429);
    // A second client is untouched.
    expect((await signIn(auth, { "x-real-ip": "198.51.100.5" })).status).toBe(200);
  });

  test("no resolvable address: one bounded shared bucket, not an unlimited path", async () => {
    // The shared key is `no-trusted-ip` in production and better-auth's localhost under test.
    const auth = bare();
    for (let i = 0; i < 3; i += 1) expect((await signIn(auth, {})).status).toBe(200);
    expect((await signIn(auth, { "x-real-ip": "garbage" })).status).toBe(429);
  });
});

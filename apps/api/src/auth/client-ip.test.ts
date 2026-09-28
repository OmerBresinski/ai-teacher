import { describe, expect, test } from "bun:test";
import { authIpAddress, clientIp, ipHeaderName } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("client IP (TEACH-222)", () => {
  test("default: the rightmost x-forwarded-for entry (the one the edge appended)", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }), {})).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }), {})).toBe("203.0.113.9");
  });

  test("absent or empty header → null", () => {
    expect(clientIp(h({}), {})).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": " , " }), {})).toBeNull();
  });

  test("AUTH_IP_HEADER: that header's first value; better-auth reads the same header", () => {
    const env = { AUTH_IP_HEADER: "CF-Connecting-IP" };
    expect(ipHeaderName(env)).toBe("cf-connecting-ip");
    expect(
      clientIp(h({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "9.9.9.9" }), env),
    ).toBe("198.51.100.4");
    expect(authIpAddress({ NODE_ENV: "test", ...env })).toEqual({
      ipAddressHeaders: ["cf-connecting-ip"],
    });
  });

  test("unset: better-auth keeps its default", () => {
    expect(authIpAddress({ NODE_ENV: "production" })).toBeUndefined();
  });
});

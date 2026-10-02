import { describe, expect, test } from "bun:test";
import { authIpAddress, clientIp, ipHeaderName, ipProbeReport } from "./client-ip";

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

describe("IP probe report (TEACH-300)", () => {
  test("no probe header: no report", () => {
    expect(ipProbeReport(h({ "x-forwarded-for": "203.0.113.7" }))).toBeNull();
  });

  test("booleans per x-forwarded-for entry, in order, and for x-real-ip", () => {
    const report = ipProbeReport(
      h({
        "x-tj-ip-probe": "198.51.100.20",
        "x-forwarded-for": "203.0.113.7, 198.51.100.20, 100.64.3.4, 10.0.0.1",
        "x-real-ip": "198.51.100.20",
      }),
    );
    expect(report).toEqual({
      xffEntries: 4,
      xff: [
        { probe: false, cgnat: false, in100Slash8: false, private: false, testNet3: true },
        { probe: true, cgnat: false, in100Slash8: false, private: false, testNet3: false },
        { probe: false, cgnat: true, in100Slash8: true, private: false, testNet3: false },
        { probe: false, cgnat: false, in100Slash8: false, private: true, testNet3: false },
      ],
      xRealIp: true,
      xRealIpProbe: true,
      cfConnectingIp: false,
    });
  });

  test("the report never carries an address", () => {
    const report = ipProbeReport(
      h({ "x-tj-ip-probe": "2001:db8::1", "x-forwarded-for": "2001:db8::1, garbage" }),
    );
    expect(JSON.stringify(report)).not.toContain("2001");
    expect(report?.xff.map((e) => e.probe)).toEqual([true, false]);
  });
});

import { describe, expect, test } from "bun:test";
import { compareVersions, parseBunVersion, parseSemver, satisfiesMinimum } from "./versions";

describe("parseBunVersion", () => {
  test("extracts the version from package.json#packageManager", () => {
    expect(parseBunVersion("bun@1.3.6")).toBe("1.3.6");
    expect(parseBunVersion(" bun@v1.3.6 ")).toBe("1.3.6");
    expect(parseBunVersion("bun@1.4.0-canary.12")).toBe("1.4.0-canary.12");
  });

  test("rejects other package managers, ranges and garbage", () => {
    expect(parseBunVersion("pnpm@9.1.0")).toBeNull();
    expect(parseBunVersion("bun@^1.3.6")).toBeNull();
    expect(parseBunVersion("bun")).toBeNull();
    expect(parseBunVersion("bun@1.3")).toBeNull();
    expect(parseBunVersion(undefined)).toBeNull();
    expect(parseBunVersion(null)).toBeNull();
  });
});

describe("compareVersions / satisfiesMinimum", () => {
  test("orders by major, minor, patch", () => {
    expect(compareVersions("1.3.6", "1.3.6")).toBe(0);
    expect(compareVersions("1.3.7", "1.3.6")).toBe(1);
    expect(compareVersions("1.2.99", "1.3.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  });

  test("a prerelease sorts below its release", () => {
    expect(compareVersions("1.3.6-canary.1", "1.3.6")).toBe(-1);
    expect(compareVersions("1.3.6", "1.3.6-canary.1")).toBe(1);
    expect(compareVersions("1.3.6+build.5", "1.3.6")).toBe(0);
  });

  test("satisfiesMinimum is >=", () => {
    expect(satisfiesMinimum("1.3.6", "1.3.6")).toBe(true);
    expect(satisfiesMinimum("1.4.0", "1.3.6")).toBe(true);
    expect(satisfiesMinimum("1.3.5", "1.3.6")).toBe(false);
    expect(satisfiesMinimum("1.3.6-canary.1", "1.3.6")).toBe(false);
  });

  test("throws on non-versions", () => {
    expect(() => compareVersions("abc", "1.0.0")).toThrow("Not a version");
    expect(parseSemver("1.2")).toBeNull();
  });
});

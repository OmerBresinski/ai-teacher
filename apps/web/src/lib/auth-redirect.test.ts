import { describe, expect, it } from "bun:test";
import { isSameOriginPath, sanitiseRedirectPath } from "./auth-redirect";

describe("isSameOriginPath", () => {
  it("accepts relative paths and rejects everything else", () => {
    expect(isSameOriginPath("/")).toBe(true);
    expect(isSameOriginPath("/dev/jobs?jobId=1")).toBe(true);
    expect(isSameOriginPath("//evil.example/x")).toBe(false);
    expect(isSameOriginPath("/\\evil.example")).toBe(false);
    expect(isSameOriginPath("https://evil.example")).toBe(false);
    expect(isSameOriginPath("javascript:alert(1)")).toBe(false);
    expect(isSameOriginPath("dev/jobs")).toBe(false);
    expect(isSameOriginPath(undefined)).toBe(false);
  });
});

describe("sanitiseRedirectPath", () => {
  const hostile = [
    "https://evil.example",
    "//evil.example/x",
    "/\\evil.example",
    "/\\\\evil.example",
    "/..//evil.example",
    "/\\evil example", // invalid host: `new URL` would throw
    "/\\[",
    "/\\a%zz",
    "javascript:alert(1)",
    "dev/jobs",
    undefined,
  ];

  it("collapses non-same-origin, unparseable and re-hosted targets to /", () => {
    for (const target of hostile) {
      expect(sanitiseRedirectPath(target)).toBe("/");
    }
  });

  it("always returns a same-origin path", () => {
    for (const target of [...hostile, "/", "/dev/jobs?jobId=1#top", "/?error=INVALID_TOKEN"]) {
      expect(isSameOriginPath(sanitiseRedirectPath(target))).toBe(true);
    }
  });

  it("strips better-auth error params and keeps everything else", () => {
    expect(sanitiseRedirectPath("/?error=INVALID_TOKEN")).toBe("/");
    expect(sanitiseRedirectPath("/dev/jobs?error=INVALID_TOKEN&error_description=x&jobId=1")).toBe(
      "/dev/jobs?jobId=1",
    );
    expect(sanitiseRedirectPath("/dev/jobs?jobId=1#top")).toBe("/dev/jobs?jobId=1#top");
  });
});

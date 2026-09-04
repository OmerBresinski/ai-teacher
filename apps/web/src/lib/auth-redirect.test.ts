import { describe, expect, it } from "bun:test";
import { isSameOriginPath, sanitiseRedirectPath } from "./auth-redirect";

describe("isSameOriginPath", () => {
  it("accepts relative paths and rejects everything else", () => {
    expect(isSameOriginPath("/")).toBe(true);
    expect(isSameOriginPath("/dev/jobs?jobId=1")).toBe(true);
    expect(isSameOriginPath("//evil.example/x")).toBe(false);
    expect(isSameOriginPath("https://evil.example")).toBe(false);
    expect(isSameOriginPath("dev/jobs")).toBe(false);
    expect(isSameOriginPath(undefined)).toBe(false);
  });
});

describe("sanitiseRedirectPath", () => {
  it("strips better-auth error params and keeps everything else", () => {
    expect(sanitiseRedirectPath("/?error=INVALID_TOKEN")).toBe("/");
    expect(sanitiseRedirectPath("/dev/jobs?error=INVALID_TOKEN&error_description=x&jobId=1")).toBe(
      "/dev/jobs?jobId=1",
    );
    expect(sanitiseRedirectPath("/dev/jobs?jobId=1#top")).toBe("/dev/jobs?jobId=1#top");
  });

  it("collapses non-same-origin targets to /", () => {
    expect(sanitiseRedirectPath(undefined)).toBe("/");
    expect(sanitiseRedirectPath("https://evil.example")).toBe("/");
    expect(sanitiseRedirectPath("//evil.example/x")).toBe("/");
  });
});

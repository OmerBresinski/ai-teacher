import { describe, expect, test } from "bun:test";
import { compileOriginPattern, createOriginMatcher, isValidOriginPattern } from "./origins";

describe("isValidOriginPattern", () => {
  test("accepts scheme://host globs, rejects paths, non-globs and junk", () => {
    expect(isValidOriginPattern("https://*.vercel.app")).toBe(true);
    expect(isValidOriginPattern("https://teaching-journey-web-*-team.vercel.app")).toBe(true);
    expect(isValidOriginPattern("http://*.localhost:5173")).toBe(true);
    expect(isValidOriginPattern("https://app.example.com")).toBe(false); // no `*`: use WEB_ORIGIN
    expect(isValidOriginPattern("https://*.vercel.app/")).toBe(false);
    expect(isValidOriginPattern("https://*.vercel.app/path")).toBe(false);
    expect(isValidOriginPattern("*.vercel.app")).toBe(false);
    expect(isValidOriginPattern("ftp://*.vercel.app")).toBe(false);
  });
});

describe("compileOriginPattern", () => {
  const re = compileOriginPattern("https://*.vercel.app");

  test("`*` matches one label only", () => {
    expect(re.test("https://teaching-journey-web-git-feat-x-team.vercel.app")).toBe(true);
    expect(re.test("https://a.b.vercel.app")).toBe(false);
    expect(re.test("https://.vercel.app")).toBe(false);
  });

  test("scheme, port and suffix tricks do not match", () => {
    expect(re.test("http://foo.vercel.app")).toBe(false);
    expect(re.test("https://foo.vercel.app:8443")).toBe(false);
    expect(re.test("https://foo.vercel.app.evil.com")).toBe(false);
    expect(re.test("https://evil.com/https://foo.vercel.app")).toBe(false);
    expect(re.test("https://foo.vercelXapp")).toBe(false); // the `.` is literal
  });

  test("a narrow project pattern", () => {
    const narrow = compileOriginPattern(
      "https://teaching-journey-web-*-omerbresinskis-projects.vercel.app",
    );
    expect(
      narrow.test("https://teaching-journey-web-git-master-omerbresinskis-projects.vercel.app"),
    ).toBe(true);
    expect(narrow.test("https://other-app-git-master-omerbresinskis-projects.vercel.app")).toBe(
      false,
    );
  });
});

describe("createOriginMatcher", () => {
  const allowed = createOriginMatcher(
    ["https://app.example.com", "http://localhost:5173"],
    ["https://*.vercel.app"],
  );

  test("exact entries and pattern matches are allowed, anything else is not", () => {
    expect(allowed("https://app.example.com")).toBe(true);
    expect(allowed("http://localhost:5173")).toBe(true);
    expect(allowed("https://pr-12-team.vercel.app")).toBe(true);
    expect(allowed("https://app.example.com.evil.net")).toBe(false);
    expect(allowed("https://evil.com")).toBe(false);
    expect(allowed("null")).toBe(false);
  });

  test("works without patterns and exposes the configuration", () => {
    const exactOnly = createOriginMatcher(["https://app.example.com"]);
    expect(exactOnly("https://app.example.com")).toBe(true);
    expect(exactOnly("https://x.vercel.app")).toBe(false);
    expect(allowed.exact).toEqual(["https://app.example.com", "http://localhost:5173"]);
    expect(allowed.patterns).toEqual(["https://*.vercel.app"]);
  });
});

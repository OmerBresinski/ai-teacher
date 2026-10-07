import { describe, expect, test } from "bun:test";
import { countryFromRequestHeaders } from "./workspace-hook";

describe("countryFromRequestHeaders (TEACH-33 part b)", () => {
  test.each([
    [{ "x-vercel-ip-country": "IN" }, "india"],
    [{ "cf-ipcountry": "NZ" }, "new-zealand"],
    [{ "cloudfront-viewer-country": "US" }, "usa"],
    [{ "x-vercel-ip-country": "GB", "x-vercel-ip-country-region": "SCT" }, "scotland"],
    [{ "x-vercel-ip-country": "GB" }, "england"],
    [{ "x-vercel-ip-country": "DE" }, "england"],
    [{ "x-vercel-ip-country": " " }, "england"],
    [{ "x-real-ip": "203.0.113.9" }, "england"],
    [{}, "england"],
  ] as const)("%j → %s", (headers, expected) => {
    expect(countryFromRequestHeaders(new Headers(headers))).toBe(expected);
  });

  test("no headers at all (a hook with no request) is England", () => {
    expect(countryFromRequestHeaders(undefined)).toBe("england");
    expect(countryFromRequestHeaders(null)).toBe("england");
  });
});

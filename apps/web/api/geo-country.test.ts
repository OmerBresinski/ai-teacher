import { describe, expect, test } from "bun:test";
import handler, { geoHint } from "./geo-country";

describe("geo-country edge function (TEACH-33 part b)", () => {
  test.each([
    [{ "x-vercel-ip-country": "IN" }, "IN"],
    [{ "x-vercel-ip-country": "gb", "x-vercel-ip-country-region": "sct" }, "GB-SCT"],
    [{ "x-vercel-ip-country": "GB" }, "GB"],
    [{ "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "CA" }, "US"],
    [{ "x-real-ip": "203.0.113.9" }, null],
    [{}, null],
  ] as const)("%j → %p", (headers, expected) => {
    expect(geoHint(new Headers(headers))).toBe(expected);
  });

  test("answers the hint only, never cached, never the address", async () => {
    const res = handler(
      new Request("https://app.example/api/geo-country", {
        headers: { "x-vercel-ip-country": "NZ", "x-real-ip": "203.0.113.9" },
      }),
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ hint: "NZ" });
    expect(text).not.toContain("203.0.113.9");
  });
});

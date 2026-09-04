import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./base-url";

describe("resolveApiBaseUrl", () => {
  it("resolves a relative dev path against the page origin", () => {
    expect(resolveApiBaseUrl("/api", "http://localhost:5173")).toBe("http://localhost:5173/api");
    expect(resolveApiBaseUrl("/api/", "http://localhost:5173")).toBe("http://localhost:5173/api");
  });

  it("keeps absolute urls", () => {
    expect(resolveApiBaseUrl("https://api.example.test/", "http://x")).toBe(
      "https://api.example.test",
    );
  });
});

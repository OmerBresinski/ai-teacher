import { describe, expect, it } from "bun:test";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("applies defaults in development", () => {
    expect(parseEnv({}, false)).toEqual({ VITE_API_URL: "/api", VITE_APP_ENV: "development" });
  });

  it("rejects an unknown VITE_APP_ENV with a readable message", () => {
    expect(() => parseEnv({ VITE_APP_ENV: "staging" }, false)).toThrow(/VITE_APP_ENV/);
  });

  it("requires an absolute API url in a production build", () => {
    expect(() => parseEnv({ VITE_API_URL: "/api" }, true)).toThrow(/absolute http\(s\) URL/);
    expect(
      parseEnv({ VITE_API_URL: "https://api.example.test", VITE_APP_ENV: "production" }, true),
    ).toMatchObject({ VITE_API_URL: "https://api.example.test" });
  });
});

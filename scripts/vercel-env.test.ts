import { describe, expect, test } from "bun:test";
import { railwayPrApiUrl, resolveWebEnv, shellQuote, toExportLines } from "./vercel-env";

const TEMPLATE = "https://api-ai-teacher-pr-{pr}.up.railway.app";

describe("railwayPrApiUrl", () => {
  test("substitutes the PR number", () => {
    expect(railwayPrApiUrl(TEMPLATE, "42")).toBe("https://api-ai-teacher-pr-42.up.railway.app");
  });

  test("rejects a template without {pr}, a non-numeric PR and a non-URL result", () => {
    expect(() => railwayPrApiUrl("https://api.example.com", "42")).toThrow("{pr}");
    expect(() => railwayPrApiUrl(TEMPLATE, "abc")).toThrow("must be a number");
    expect(() => railwayPrApiUrl("api-pr-{pr}", "42")).toThrow("does not produce a URL");
  });
});

describe("resolveWebEnv", () => {
  test("production requires an explicit absolute VITE_API_URL", () => {
    expect(
      resolveWebEnv({ VERCEL_ENV: "production", VITE_API_URL: "https://api.example.com" }),
    ).toEqual({
      VITE_APP_ENV: "production",
      VITE_API_URL: "https://api.example.com",
      source: "explicit",
    });
    expect(() => resolveWebEnv({ VERCEL_ENV: "production" })).toThrow("Production build");
    expect(() => resolveWebEnv({ VERCEL_ENV: "production", VITE_API_URL: "/api" })).toThrow(
      "Production build",
    );
  });

  test("preview derives the Railway PR URL from the template", () => {
    expect(
      resolveWebEnv({
        VERCEL_ENV: "preview",
        VERCEL_GIT_PULL_REQUEST_ID: "17",
        RAILWAY_PR_API_URL_TEMPLATE: TEMPLATE,
        VITE_API_URL_FALLBACK: "https://api-staging.example.com",
      }),
    ).toEqual({
      VITE_APP_ENV: "preview",
      VITE_API_URL: "https://api-pr-17.up.railway.app",
      source: "railway-pr-template",
    });
  });

  test("preview falls back when there is no PR number or no template", () => {
    const fallback = { VITE_APP_ENV: "preview", source: "fallback" } as const;
    expect(
      resolveWebEnv({
        VERCEL_ENV: "preview",
        RAILWAY_PR_API_URL_TEMPLATE: TEMPLATE,
        VITE_API_URL_FALLBACK: "https://api-staging.example.com",
      }),
    ).toEqual({ ...fallback, VITE_API_URL: "https://api-staging.example.com" });
    expect(
      resolveWebEnv({
        VERCEL_ENV: "preview",
        VERCEL_GIT_PULL_REQUEST_ID: "17",
        VITE_API_URL_FALLBACK: "https://api-staging.example.com",
      }),
    ).toEqual({ ...fallback, VITE_API_URL: "https://api-staging.example.com" });
  });

  test("an explicit Preview VITE_API_URL wins over the template", () => {
    expect(
      resolveWebEnv({
        VERCEL_ENV: "preview",
        VERCEL_GIT_PULL_REQUEST_ID: "17",
        RAILWAY_PR_API_URL_TEMPLATE: TEMPLATE,
        VITE_API_URL: "https://api-override.example.com",
      }),
    ).toMatchObject({ VITE_API_URL: "https://api-override.example.com", source: "explicit" });
    expect(() => resolveWebEnv({ VERCEL_ENV: "preview", VITE_API_URL: "/api" })).toThrow(
      "absolute http(s) URL",
    );
  });

  test("preview with nothing configured is an error, blank values count as unset", () => {
    expect(() => resolveWebEnv({ VERCEL_ENV: "preview" })).toThrow("no API origin");
    expect(() =>
      resolveWebEnv({ VERCEL_ENV: "preview", VITE_API_URL: "  ", VITE_API_URL_FALLBACK: "" }),
    ).toThrow("no API origin");
    // Missing VERCEL_ENV (local run) behaves like preview.
    expect(resolveWebEnv({ VITE_API_URL_FALLBACK: "https://api.example.com" })).toMatchObject({
      VITE_APP_ENV: "preview",
    });
  });
});

describe("shell output", () => {
  test("export lines are single-quoted and escaped", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(
      toExportLines({
        VITE_APP_ENV: "preview",
        VITE_API_URL: "https://api-pr-1.up.railway.app",
        source: "railway-pr-template",
      }),
    ).toBe("export VITE_APP_ENV='preview'\nexport VITE_API_URL='https://api-pr-1.up.railway.app'");
  });
});

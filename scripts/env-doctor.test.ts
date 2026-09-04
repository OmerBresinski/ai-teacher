import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "./lib/env";
import { checkFormat, validateEnvFile } from "./lib/env-doctor";
import { ensureGeneratedSecret, generateSecret, hasSecret } from "./lib/secrets";

describe("doctor: validateEnvFile", () => {
  const goodApi = [
    "DATABASE_URL=postgres://postgres:postgres@localhost:5432/teaching_journey",
    "TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/teaching_journey_test",
    "NODE_ENV=development",
    "PORT=3001",
    "LOG_LEVEL=info",
    "WEB_ORIGIN=http://localhost:5173",
    "BETTER_AUTH_URL=http://localhost:3001",
    "MAIL_PROVIDER=console",
    "AWS_REGION=us-east-1",
    "AI_MODEL_FRONTIER=us.anthropic.claude-opus-5",
    "AI_MODEL_STANDARD=us.anthropic.claude-sonnet-5",
    "AI_MODEL_SMALL=us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "BETTER_AUTH_SECRET=not-a-real-secret-just-long-enough-0123456789",
  ].join("\n");

  test("a complete api .env passes", () => {
    const report = validateEnvFile("api", goodApi);
    expect(report).toEqual({ exists: true, missing: [], invalid: [], extra: [] });
  });

  test("a missing file lists every required key, including the generated secret", () => {
    const report = validateEnvFile("api", null);
    expect(report.exists).toBe(false);
    expect(report.missing).toContain("DATABASE_URL");
    expect(report.missing).toContain("BETTER_AUTH_SECRET");
    expect(report.missing).not.toContain("GOOGLE_CLIENT_ID");
  });

  test("BETTER_AUTH_SECRET missing or blank is reported by name; commented does not count", () => {
    const withoutSecret = goodApi.replace(/BETTER_AUTH_SECRET=.*/, "# BETTER_AUTH_SECRET=");
    expect(validateEnvFile("api", withoutSecret).missing).toEqual(["BETTER_AUTH_SECRET"]);
    const blank = goodApi.replace(/BETTER_AUTH_SECRET=.*/, "BETTER_AUTH_SECRET=");
    expect(validateEnvFile("api", blank).missing).toEqual(["BETTER_AUTH_SECRET"]);
  });

  test("invalid formats name the key and the expected shape, never the value", () => {
    const bad = goodApi
      .replace("PORT=3001", "PORT=http")
      .replace("NODE_ENV=development", "NODE_ENV=staging")
      .replace("DATABASE_URL=postgres://", "DATABASE_URL=mysql://")
      .replace("WEB_ORIGIN=http://localhost:5173", "WEB_ORIGIN=localhost:5173/path");
    const report = validateEnvFile("api", bad);
    expect(report.invalid).toEqual([
      { name: "DATABASE_URL", expected: "a postgres:// URL" },
      { name: "NODE_ENV", expected: "one of development | test | production" },
      { name: "PORT", expected: "a port (1-65535)" },
      { name: "WEB_ORIGIN", expected: "comma-separated origins (scheme://host[:port], no path)" },
    ]);
    expect(JSON.stringify(report)).not.toContain("staging");
    expect(JSON.stringify(report)).not.toContain("mysql");
  });

  test("optional keys are validated when present and unknown keys are listed as extra", () => {
    const text = `${goodApi}\nCOOKIE_SAMESITE=maybe\nEVENTS_POLL_MS=fast\nWEB_ORIGIN_PATTERNS=https://*.vercel.app\nSOMETHING_ELSE=1`;
    const report = validateEnvFile("api", text);
    expect(report.invalid.map((i) => i.name)).toEqual(["COOKIE_SAMESITE", "EVENTS_POLL_MS"]);
    expect(report.extra).toEqual(["SOMETHING_ELSE"]);
  });

  test("worker requires its own PORT and nothing auth-related", () => {
    const report = validateEnvFile(
      "worker",
      "DATABASE_URL=postgres://postgres:postgres@localhost:5432/teaching_journey",
    );
    expect(report.missing).toEqual([
      "NODE_ENV",
      "PORT",
      "LOG_LEVEL",
      "WORKER_CONCURRENCY",
      "AWS_REGION",
      "AI_MODEL_FRONTIER",
      "AI_MODEL_STANDARD",
      "AI_MODEL_SMALL",
    ]);
  });

  test("checkFormat edge cases", () => {
    expect(checkFormat("url", "/api")).toBe("an absolute http(s) URL");
    expect(checkFormat("url", "https://api.example.test")).toBeNull();
    expect(checkFormat("port", "70000")).toBe("a port (1-65535)");
    expect(checkFormat("int", "12")).toBeNull();
    expect(checkFormat("int", "-1")).toBe("an integer");
    expect(
      checkFormat("origin-pattern-list", "https://a-*-b.vercel.app, https://*.x.dev"),
    ).toBeNull();
    expect(checkFormat("origin-pattern-list", "https://a.vercel.app")).toContain("globs");
    expect(checkFormat(undefined, "anything")).toBeNull();
  });
});

describe("setup: ensureGeneratedSecret", () => {
  async function withEnvFile<T>(
    initial: string | null,
    fn: (envPath: string) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), "tj-secret-"));
    const envPath = path.join(dir, ".env");
    try {
      if (initial !== null) await writeFile(envPath, initial);
      return await fn(envPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("generateSecret is >= 32 chars of base64url and unique", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  test("appends BETTER_AUTH_SECRET when the example's commented line is all there is", async () => {
    const example = "PORT=3001\n# BETTER_AUTH_SECRET=\n";
    await withEnvFile(example, async (envPath) => {
      const outcome = await ensureGeneratedSecret(
        envPath,
        "BETTER_AUTH_SECRET",
        () => "GENERATED_VALUE_FIXTURE_1234567890ab",
      );
      expect(outcome).toBe("generated");
      const text = await readFile(envPath, "utf8");
      expect(text).toStartWith(example);
      expect(parseEnv(text).get("BETTER_AUTH_SECRET")).toBe("GENERATED_VALUE_FIXTURE_1234567890ab");
      expect(parseEnv(text).get("PORT")).toBe("3001");
      expect(hasSecret(text, "BETTER_AUTH_SECRET")).toBe(true);
    });
  });

  test("leaves an existing non-empty secret untouched", async () => {
    const initial = "BETTER_AUTH_SECRET=keep-me-keep-me-keep-me-keep-me-keep\n";
    await withEnvFile(initial, async (envPath) => {
      expect(await ensureGeneratedSecret(envPath, "BETTER_AUTH_SECRET", () => "NEW")).toBe(
        "present",
      );
      expect(await readFile(envPath, "utf8")).toBe(initial);
    });
  });

  test("treats a blank value as missing and handles a file without a trailing newline", async () => {
    await withEnvFile("PORT=3001\nBETTER_AUTH_SECRET=", async (envPath) => {
      expect(
        await ensureGeneratedSecret(envPath, "BETTER_AUTH_SECRET", () => "FILLED_IN_FIXTURE"),
      ).toBe("generated");
      const text = await readFile(envPath, "utf8");
      // The blank line is completed in place rather than duplicated.
      expect(text).toBe("PORT=3001\nBETTER_AUTH_SECRET=FILLED_IN_FIXTURE");
      expect(parseEnv(text).get("BETTER_AUTH_SECRET")).toBe("FILLED_IN_FIXTURE");
    });
  });

  test("creates the file when it does not exist", async () => {
    await withEnvFile(null, async (envPath) => {
      expect(
        await ensureGeneratedSecret(envPath, "BETTER_AUTH_SECRET", () => "CREATED_FIXTURE"),
      ).toBe("generated");
      expect(hasSecret(await readFile(envPath, "utf8"), "BETTER_AUTH_SECRET")).toBe(true);
    });
  });
});

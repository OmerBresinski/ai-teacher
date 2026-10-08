import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageTestDatabaseUrl, REQUIRE_TEST_DB_MESSAGE, withTestDb } from "./testing";

/** Swap env vars for the duration of `fn` and restore them afterwards (other files read them). */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("withTestDb availability contract", () => {
  test("without TEST_DATABASE_URL it returns a visible reason instead of throwing", async () => {
    await withEnv({ TEST_DATABASE_URL: undefined, REQUIRE_TEST_DB: undefined }, async () => {
      const result = await withTestDb();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("TEST_DATABASE_URL is not set");
    });
  });

  test("REQUIRE_TEST_DB=1 turns the skip into a failure with the reason attached", async () => {
    await withEnv({ TEST_DATABASE_URL: undefined, REQUIRE_TEST_DB: "1" }, async () => {
      await expect(withTestDb()).rejects.toThrow(REQUIRE_TEST_DB_MESSAGE);
      await expect(withTestDb()).rejects.toThrow("TEST_DATABASE_URL is not set");
    });
  });

  test("an unreachable server is reported (and fails fast) rather than hanging", async () => {
    // Port 9 (discard) is closed on every developer machine and CI runner.
    await withEnv(
      {
        TEST_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:9/teaching_journey_test",
        REQUIRE_TEST_DB: undefined,
      },
      async () => {
        const result = await withTestDb();
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("cannot reach");
      },
    );
  }, 15_000);
});

describe("packageTestDatabaseUrl", () => {
  const base = "postgres://postgres:postgres@localhost:5432/teaching_journey_test";
  const databaseOf = (url: string) => new URL(url).pathname.slice(1);

  test("appends the package name without its scope, from the package or any folder inside it", () => {
    const fromPackage = packageTestDatabaseUrl(base, join(import.meta.dir, ".."));
    expect(fromPackage).toBe(`${base}_db`);
    expect(packageTestDatabaseUrl(base, import.meta.dir)).toBe(fromPackage);
  });

  test("keeps credentials, host and query parameters", () => {
    const url = new URL(packageTestDatabaseUrl(`${base}?sslmode=disable`, import.meta.dir));
    expect(url.username).toBe("postgres");
    expect(url.host).toBe("localhost:5432");
    expect(url.search).toBe("?sslmode=disable");
    expect(databaseOf(url.toString())).toBe("teaching_journey_test_db");
  });

  test("turns any package name into a lower-case identifier suffix", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-test-db-name-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@acme/Web-App.v2" }));
      expect(databaseOf(packageTestDatabaseUrl(base, dir))).toBe(
        "teaching_journey_test_web_app_v2",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("shortens a long base name so the suffix survives the 63-byte identifier limit", () => {
    const long = `postgres://localhost/${"x".repeat(70)}`;
    const name = databaseOf(packageTestDatabaseUrl(long, import.meta.dir));
    expect(name).toHaveLength(63);
    expect(name.endsWith("x_db")).toBe(true);
  });
});

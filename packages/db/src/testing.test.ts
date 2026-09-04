import { describe, expect, test } from "bun:test";
import { REQUIRE_TEST_DB_MESSAGE, withTestDb } from "./testing";

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

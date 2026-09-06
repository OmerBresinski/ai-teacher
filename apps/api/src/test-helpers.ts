import type { DbHandle } from "@tj/db";
import pino from "pino";
import { createApp } from "./app";

export const TEST_ENV_NO_SHIM = {
  NODE_ENV: "test" as const,
  LOG_LEVEL: "silent" as const,
  MAIL_PROVIDER: "console",
  WEB_ORIGIN: ["http://localhost:5173", "https://app.example.test"],
  WEB_ORIGIN_PATTERNS: ["https://*-preview.example.test"],
};

export const TEST_ENV = {
  ...TEST_ENV_NO_SHIM,
  ALLOW_WORKSPACE_HEADER_SHIM: "1",
};

export const silentLogger = pino({ level: "silent" });

export type TestDb = Pick<DbHandle, "sql" | "unsafeDb">;

/**
 * An `unsafeDb` stand-in for unit tests whose routes never reach the database: any access throws,
 * so a test that does reach it fails loudly instead of hanging on a fake pool.
 */
export const unreachableDb = new Proxy({} as DbHandle["unsafeDb"], {
  get(_target, prop) {
    throw new Error(`unreachableDb: a route touched unsafeDb.${String(prop)} in a unit test`);
  },
});

/** A `db.sql` stand-in: resolves (database "up") or throws (database "down"). */
export function fakeSql(up: boolean): TestDb {
  const sql = (() => {
    if (up) return Promise.resolve([{ "?column?": 1 }]);
    return Promise.reject(new Error("connection refused"));
  }) as unknown as DbHandle["sql"];
  return { sql, unsafeDb: unreachableDb };
}

export function testApp(db: TestDb = fakeSql(true)) {
  return createApp({ env: TEST_ENV, db, logger: silentLogger });
}

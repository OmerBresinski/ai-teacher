import type { DbHandle } from "@tj/db";
import pino from "pino";
import { createApp } from "./app";

export const TEST_ENV = {
  NODE_ENV: "test" as const,
  LOG_LEVEL: "silent" as const,
  WEB_ORIGIN: ["http://localhost:5173", "https://app.example.test"],
};

export const silentLogger = pino({ level: "silent" });

/** A `db.sql` stand-in: resolves (database "up") or throws (database "down"). */
export function fakeSql(up: boolean): Pick<DbHandle, "sql"> {
  const sql = (() => {
    if (up) return Promise.resolve([{ "?column?": 1 }]);
    return Promise.reject(new Error("connection refused"));
  }) as unknown as DbHandle["sql"];
  return { sql };
}

export function testApp(db: Pick<DbHandle, "sql"> = fakeSql(true)) {
  return createApp({ env: TEST_ENV, db, logger: silentLogger });
}

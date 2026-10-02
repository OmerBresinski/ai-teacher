import type { DbHandle } from "@tj/db";
import pino from "pino";
import { createApp } from "./app";

export const TEST_ENV_NO_SHIM = {
  NODE_ENV: "test" as const,
  LOG_LEVEL: "silent" as const,
  MAIL_PROVIDER: "console" as const,
  WEB_ORIGIN: ["http://localhost:5173", "https://app.example.test"],
  WEB_ORIGIN_PATTERNS: ["https://*-preview.example.test"],
};

export const TEST_ENV = {
  ...TEST_ENV_NO_SHIM,
  ALLOW_WORKSPACE_HEADER_SHIM: "1",
};

export const silentLogger = pino({ level: "silent" });

/** A pino logger writing JSON lines into memory, for asserting log output in tests. */
export function captureLogger() {
  const lines: string[] = [];
  const logger = pino(
    { level: "trace" },
    {
      write(line: string) {
        lines.push(line);
      },
    },
  );
  return { logger, lines };
}

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

/**
 * The emailed magic link opens the web confirm page (`/sign-in/confirm?token=…&callbackURL=…`,
 * TEACH-246); its "Sign in" button navigates to the api verify URL with the same query. Tests that
 * sign in through the api follow that button by hand.
 */
export function verifyUrlFromEmailLink(link: string | undefined, apiBase: string): string {
  if (!link) throw new Error("no magic link captured");
  const confirm = new URL(link);
  if (confirm.pathname !== "/sign-in/confirm") throw new Error(`not a confirm link: ${link}`);
  const verify = new URL("/auth/magic-link/verify", apiBase);
  verify.search = confirm.search;
  return verify.toString();
}

/**
 * Make the claim's handover (`update workspaces set owner_user_id …`, TEACH-224) fail inside its
 * transaction while `run` executes, after the target's empty Workspace was already deleted in it.
 * A trigger on the shared test database, so it is always dropped again.
 */
export async function withFailingWorkspaceHandover(
  db: Pick<DbHandle, "sql">,
  run: () => Promise<void>,
): Promise<void> {
  await db.sql.unsafe(`
    create or replace function tj_test_fail_claim() returns trigger language plpgsql as $$
    begin raise exception 'injected claim fault'; end $$`);
  await db.sql.unsafe(`
    create trigger tj_test_fail_claim before update of owner_user_id on workspaces
    for each row execute function tj_test_fail_claim()`);
  try {
    await run();
  } finally {
    await db.sql`drop trigger if exists tj_test_fail_claim on workspaces`;
    await db.sql`drop function if exists tj_test_fail_claim()`;
  }
}

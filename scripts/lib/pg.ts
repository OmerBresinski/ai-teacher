import { SQL } from "bun";

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Runs `fn` with a one-connection Bun `SQL` client for `url`, closing it afterwards. Uses the
 * Postgres driver built into Bun, so no host `psql` is needed.
 */
export async function withPg<T>(
  url: string,
  fn: (sql: SQL) => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const sql = new SQL({
    url,
    max: 1,
    connectionTimeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
    idleTimeout: 1,
  });
  try {
    return await fn(sql);
  } finally {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}

/** `true` when a `select 1` succeeds against `url` within the timeout (like `pg_isready`). */
export async function pgIsReady(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await withPg(url, async (sql) => sql`select 1`, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** Same as `pgIsReady` but returns the error message on failure. */
export async function pgProbe(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await withPg(url, async (sql) => sql`select 1`, timeoutMs);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Names of the databases on the server behind `url` (excluding templates). */
export async function listDatabases(url: string): Promise<string[]> {
  return withPg(url, async (sql) => {
    const rows = (await sql`
      select datname from pg_database where datistemplate = false order by datname
    `) as { datname: string }[];
    return rows.map((r) => r.datname);
  });
}

/** Whether pgvector is installable on the server and installed in the URL's database. */
export async function vectorExtension(
  url: string,
): Promise<{ available: string | null; installed: string | null }> {
  return withPg(url, async (sql) => {
    const available = (await sql`
      select default_version from pg_available_extensions where name = 'vector'
    `) as { default_version: string }[];
    const installed = (await sql`
      select extversion from pg_extension where extname = 'vector'
    `) as { extversion: string }[];
    return {
      available: available[0]?.default_version ?? null,
      installed: installed[0]?.extversion ?? null,
    };
  });
}

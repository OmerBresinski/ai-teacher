import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_ENV } from "./paths";

/** Directories never descended into when looking for `.env.example` files. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".turbo",
  "coverage",
  "playwright-report",
  "test-results",
  ".data",
]);

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parses dotenv text into an ordered map of `KEY -> value`.
 *
 * Rules (a deliberately small subset shared by Bun, docker compose and dotenv):
 * blank lines and `# comments` are ignored; an optional `export ` prefix is dropped; the key is
 * everything before the first `=`; values may be single- or double-quoted, otherwise a trailing
 * ` # comment` is stripped. A commented-out `# KEY=value` is a comment, not a key.
 */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const eq = body.indexOf("=");
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    if (!KEY_RE.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    const quote = value[0];
    const closing = quote === '"' || quote === "'" ? value.indexOf(quote, 1) : -1;
    if (closing !== -1) {
      // Quoted: take what is inside the quotes; anything after the closing quote is a comment.
      value = value.slice(1, closing);
    } else {
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trimEnd();
    }
    out.set(key, value);
  }
  return out;
}

/** The keys of a dotenv document, in file order. */
export function parseEnvKeys(text: string): string[] {
  return [...parseEnv(text).keys()];
}

export interface EnvDiff {
  /** Keys present in the example but absent from the `.env` (in example order). */
  missing: string[];
  /** Keys present in the `.env` but not in the example (informational). */
  extra: string[];
}

/** Pure comparison of two dotenv documents. */
export function diffEnvText(exampleText: string, envText: string): EnvDiff {
  const exampleKeys = parseEnvKeys(exampleText);
  const envKeys = new Set(parseEnvKeys(envText));
  const exampleSet = new Set(exampleKeys);
  return {
    missing: exampleKeys.filter((k) => !envKeys.has(k)),
    extra: [...envKeys].filter((k) => !exampleSet.has(k)),
  };
}

export interface EnvFileDiff extends EnvDiff {
  /** `false` when the `.env` file does not exist (then every example key is `missing`). */
  envExists: boolean;
}

/** Compares an `.env.example` on disk with its `.env`. */
export async function diffEnv(examplePath: string, envPath: string): Promise<EnvFileDiff> {
  const exampleText = await readFile(examplePath, "utf8");
  const envFile = Bun.file(envPath);
  if (!(await envFile.exists())) {
    return { envExists: false, missing: parseEnvKeys(exampleText), extra: [] };
  }
  const envText = await envFile.text();
  return { envExists: true, ...diffEnvText(exampleText, envText) };
}

/**
 * Every `.env.example` under `root` (glob `** /.env.example`), skipping `node_modules`, `.git`,
 * build output and the like. Returns absolute paths, sorted. New apps/packages are picked up
 * automatically -- nothing to register.
 */
export async function findEnvExamples(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const jobs: Promise<void>[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) jobs.push(walk(path.join(dir, entry.name)));
      } else if (entry.isFile() && entry.name === ".env.example") {
        found.push(path.join(dir, entry.name));
      }
    }
    await Promise.all(jobs);
  }
  await walk(path.resolve(root));
  return found.sort();
}

/** The `.env` that sits next to an `.env.example`. */
export function envPathFor(examplePath: string): string {
  return path.join(path.dirname(examplePath), ".env");
}

let rootEnvCache: Map<string, string> | null = null;

/** Root `.env` contents (empty map when absent). Cached for the process lifetime. */
export async function readRootEnv(): Promise<Map<string, string>> {
  if (rootEnvCache) return rootEnvCache;
  const file = Bun.file(ROOT_ENV);
  rootEnvCache = (await file.exists()) ? parseEnv(await file.text()) : new Map();
  return rootEnvCache;
}

/**
 * Effective value of a root setting: shell environment first (Bun also auto-loads the root
 * `.env` into `process.env` when the cwd is the root), then the root `.env` file, then `fallback`.
 */
export async function rootSetting(key: string, fallback?: string): Promise<string | undefined> {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;
  const fromFile = (await readRootEnv()).get(key);
  if (fromFile !== undefined && fromFile !== "") return fromFile;
  return fallback;
}

export const DEFAULT_PG_PORT = 5432;
export const PG_USER = "postgres";
export const PG_PASSWORD = "postgres";
export const DEV_DB = "teaching_journey";
export const TEST_DB = "teaching_journey_test";

/** `TJ_PG_PORT`: shell > root `.env` > 5432. Same precedence docker compose applies. */
export async function pgPort(): Promise<number> {
  const raw = await rootSetting("TJ_PG_PORT", String(DEFAULT_PG_PORT));
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`TJ_PG_PORT must be a port number (1-65535), got "${raw}".`);
  }
  return port;
}

export function composeDatabaseUrl(port: number, database: string): string {
  return `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${port}/${database}`;
}

/** `DATABASE_URL` if set (shell or root `.env`), else derived from `TJ_PG_PORT`. */
export async function databaseUrl(): Promise<string> {
  return (await rootSetting("DATABASE_URL")) ?? composeDatabaseUrl(await pgPort(), DEV_DB);
}

/** `TEST_DATABASE_URL` if set (shell or root `.env`), else derived from `TJ_PG_PORT`. */
export async function testDatabaseUrl(): Promise<string> {
  return (await rootSetting("TEST_DATABASE_URL")) ?? composeDatabaseUrl(await pgPort(), TEST_DB);
}

/** Host, port and database name of a Postgres URL (`null` when it cannot be parsed). */
export function parseDatabaseUrl(
  url: string,
): { host: string; port: number; database: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return null;
    return {
      host: u.hostname || "localhost",
      port: u.port ? Number(u.port) : DEFAULT_PG_PORT,
      database: u.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

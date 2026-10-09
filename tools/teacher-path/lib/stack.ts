/**
 * The local stack the teacher's path drives: api, worker and a production build of the web app,
 * on this tool's own ports and database, from the checked-out code. It never starts or stops
 * Docker; the database must already be served by a running Postgres.
 */
import { createRequire } from "node:module";
import { connect } from "node:net";
import { join } from "node:path";
import type { Subprocess } from "bun";

export const ROOT = join(import.meta.dir, "..", "..", "..");
/** Packages are resolved from the workspace that declares them (Bun's isolated linker). */
export const fromWeb = createRequire(join(ROOT, "apps/web/package.json"));
const fromDb = createRequire(join(ROOT, "packages/db/package.json"));

export type Ports = { api: number; worker: number; web: number };
export type Stack = {
  api: string;
  web: string;
  workerLog: string;
  storageRoot: string;
  stop: () => void;
};

/** Cloudflare's documented always-pass Turnstile test pair, as the e2e stack uses. */
const TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";
const TURNSTILE_SITE = "1x00000000000000000000AA";

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Refuses a forbidden or busy port, or a database on a forbidden port, before anything starts. */
export async function preflight(ports: Ports, forbidden: number[], databaseUrl: string) {
  for (const [name, port] of Object.entries(ports)) {
    if (forbidden.includes(port)) throw new Error(`${name} port ${port} is forbidden`);
    if (port < 5780) throw new Error(`${name} port ${port} is below 5780`);
    if (await portInUse(port)) throw new Error(`${name} port ${port} is already in use`);
  }
  const db = new URL(databaseUrl);
  if (forbidden.includes(Number(db.port || 5432))) {
    throw new Error(`database port ${db.port} is forbidden`);
  }
  if (!(await portInUse(Number(db.port || 5432)))) {
    throw new Error(
      `no Postgres is listening on ${db.host}. Start your local Postgres (not Docker), or set databaseUrl in config.json`,
    );
  }
}

/** Creates the tool's own database when it is missing, then applies the committed migrations. */
export async function prepareDatabase(databaseUrl: string, logDir: string) {
  const mod = fromDb("postgres");
  const postgres = mod.default ?? mod;
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`database name ${name} is not [a-z0-9_]+`);
  const admin = new URL(databaseUrl);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  const rows = await sql`select 1 from pg_database where datname = ${name}`;
  if (rows.length === 0) await sql.unsafe(`create database ${name}`);
  await sql.end();
  const migrate = Bun.spawn(["bun", "packages/db/src/migrate.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: "" },
    stdout: Bun.file(join(logDir, "migrate.log")),
    stderr: Bun.file(join(logDir, "migrate.err.log")),
  });
  if ((await migrate.exited) !== 0)
    throw new Error(`migrations failed: see ${logDir}/migrate*.log`);
}

async function waitFor(url: string, seconds: number, what: string) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error(`${what} did not answer at ${url} within ${seconds}s`);
}

export async function startStack(opts: {
  ports: Ports;
  databaseUrl: string;
  logDir: string;
  storageRoot: string;
  paid: boolean;
  /** The worker's scripted fake (no model, no spend): checks this tool, not the pipeline. */
  fake?: boolean;
  /** Extra worker settings from config.json, to match production (e.g. the writer planner). */
  workerEnv?: Record<string, string>;
  openaiKey?: string;
  pexelsKey?: string;
  imageCapUsd: number;
  lessonCapUsd: number;
}): Promise<Stack> {
  const { ports, logDir } = opts;
  const api = `http://localhost:${ports.api}`;
  const web = `http://localhost:${ports.web}`;
  const procs: Subprocess[] = [];
  const stop = () => {
    for (const p of procs) p.kill();
  };
  const spawn = (name: string, cmd: string[], cwd: string, env: Record<string, string>) => {
    const p = Bun.spawn(cmd, {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      stdout: Bun.file(join(logDir, `${name}.log`)),
      stderr: Bun.file(join(logDir, `${name}.err.log`)),
    });
    procs.push(p);
    return p;
  };
  const ai: Record<string, string> = opts.paid
    ? { OPENAI_API_KEY: opts.openaiKey ?? "", PEXELS_API_KEY: opts.pexelsKey ?? "" }
    : { OPENAI_API_KEY: "", PEXELS_API_KEY: "" };
  try {
    spawn("api", ["bun", "src/index.ts"], join(ROOT, "apps/api"), {
      // `test` mounts GET /__test/last-magic-link, so a signed-in teacher signs in by magic link.
      NODE_ENV: "test",
      ENABLE_TEST_ROUTES: "1",
      PORT: String(ports.api),
      DATABASE_URL: opts.databaseUrl,
      WEB_ORIGIN: web,
      BETTER_AUTH_URL: api,
      // A fresh throwaway secret per run: this api only ever serves the tool's own database.
      BETTER_AUTH_SECRET: `${crypto.randomUUID()}${crypto.randomUUID()}`,
      MAIL_PROVIDER: "console",
      MAGIC_LINK_SENDS_DAILY_CAP: "100000",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
      STORAGE_ROOT: opts.storageRoot,
      LOG_LEVEL: "info",
      ...ai,
    });
    spawn("worker", ["bun", "src/index.ts"], join(ROOT, "apps/worker"), {
      // `test`, not `development`: pino writes JSON lines (no pino-pretty), which this tool reads.
      NODE_ENV: "test",
      PORT: String(ports.worker),
      DATABASE_URL: opts.databaseUrl,
      STORAGE_ROOT: opts.storageRoot,
      LOG_LEVEL: "info",
      AI_LESSON_COST_CAP_USD: String(opts.lessonCapUsd),
      IMAGE_GENERATION_DAILY_CAP_USD: String(opts.imageCapUsd),
      ...ai,
      ...opts.workerEnv,
      ...(opts.fake
        ? { AI_FAKE_SCRIPT: "pipeline", AI_FAKE_DELAY_MS: "250", AI_LESSON_PLANNER: "legacy" }
        : {}),
    });
    const webEnv = {
      VITE_API_URL: api,
      VITE_APP_ENV: "preview",
      VITE_TURNSTILE_SITE_KEY: TURNSTILE_SITE,
    };
    const build = spawn(
      "web-build",
      ["bunx", "vite", "build", "--outDir", "dist/teacher-path"],
      join(ROOT, "apps/web"),
      webEnv,
    );
    if ((await build.exited) !== 0)
      throw new Error(`web build failed: see ${logDir}/web-build*.log`);
    spawn(
      "web",
      [
        "bunx",
        "vite",
        "preview",
        "--outDir",
        "dist/teacher-path",
        "--port",
        String(ports.web),
        "--strictPort",
      ],
      join(ROOT, "apps/web"),
      webEnv,
    );
    await waitFor(`${api}/health`, 60, "api");
    await waitFor(`http://localhost:${ports.worker}/health`, 60, "worker");
    await waitFor(web, 60, "web");
  } catch (e) {
    stop();
    throw e;
  }
  return { api, web, workerLog: join(logDir, "worker.log"), storageRoot: opts.storageRoot, stop };
}

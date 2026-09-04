#!/usr/bin/env bun
// bun run doctor -- diagnose the local development environment.
//
// Every check prints PASS / WARN / FAIL / SKIP with a plain-language fix. Exit code is 1 when any
// check FAILs, 0 otherwise. Nothing here changes your machine.

import path from "node:path";
import { $ } from "bun";
import { ENV_FILES, type EnvFile, envVar } from "../infra/env.contract";
import { composeServiceInfo, dockerStatus } from "./lib/docker";
import {
  DEV_DB,
  databaseUrl,
  parseDatabaseUrl,
  pgPort,
  rootSetting,
  TEST_DB,
  testDatabaseUrl,
} from "./lib/env";
import { validateEnvFile } from "./lib/env-doctor";
import { ExitCode, runMain } from "./lib/exit";
import { missingLefthookHooks } from "./lib/git";
import { type CheckStatus, colour, printCheck } from "./lib/log";
import { ROOT, rel } from "./lib/paths";
import { listDatabases, pgProbe, vectorExtension } from "./lib/pg";
import { parseBunVersion, satisfiesMinimum } from "./lib/versions";
import { readPackageJson } from "./lib/workspaces";

interface CheckResult {
  status: CheckStatus;
  detail?: string;
  fix?: string | string[];
}

const counts: Record<CheckStatus, number> = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };

async function check(name: string, run: () => Promise<CheckResult>): Promise<CheckResult> {
  let result: CheckResult;
  try {
    result = await run();
  } catch (err) {
    result = {
      status: "FAIL",
      detail: err instanceof Error ? err.message : String(err),
      fix: "This check crashed; re-run with the fix below or report it.",
    };
  }
  counts[result.status] += 1;
  printCheck(result.status, name, result.detail, result.fix);
  return result;
}

const pass = (detail?: string): CheckResult => ({ status: "PASS", detail });
const skip = (detail: string): CheckResult => ({ status: "SKIP", detail });
const warn = (detail: string, fix?: string | string[]): CheckResult => ({
  status: "WARN",
  detail,
  fix,
});
const fail = (detail: string, fix: string | string[]): CheckResult => ({
  status: "FAIL",
  detail,
  fix,
});

const DEV_PORTS: { port: number; owner: string }[] = [
  { port: 3001, owner: "apps/api" },
  { port: 3002, owner: "apps/worker" },
  { port: 5173, owner: "apps/web (Vite)" },
];
const OUR_PROCESS_RE = /^(bun|node|vite|turbo)/i;
/** Vite 8 / Vitest 4 need `node:util` `styleText`; Node 18 lacks it. */
const NODE_MIN_FOR_VITEST = "20.0.0";

async function portListeners(port: number): Promise<{ command: string; pid: string }[] | null> {
  if (Bun.which("lsof") === null) return null;
  const result = await $`lsof -nP -iTCP:${port} -sTCP:LISTEN`.quiet().nothrow();
  // lsof exits 1 when nothing matches -- that is "port free", not an error.
  const lines = result.stdout.toString().trim().split("\n").slice(1);
  return lines
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [command = "?", pid = "?"] = l.trim().split(/\s+/);
      return { command, pid };
    });
}

await runMain(async () => {
  console.log(colour.bold("Teaching Journey doctor"));
  console.log(colour.dim(`root ${ROOT}\n`));

  // -- toolchain --------------------------------------------------------------------------------
  await check("Bun version", async () => {
    const pkg = await readPackageJson(ROOT);
    const required = parseBunVersion(pkg?.packageManager);
    if (required === null) return warn("package.json#packageManager is not bun@X.Y.Z");
    if (!satisfiesMinimum(Bun.version, required)) {
      return fail(
        `Bun ${Bun.version} < pinned ${required}`,
        `bun upgrade   (or: curl -fsSL https://bun.sh/install | bash -s "bun-v${required}")`,
      );
    }
    return pass(`${Bun.version} (pinned ${required})`);
  });

  // Vitest (apps/web, packages/ui; ADR 0014) still runs on Node -- `bun --bun vitest` cannot host
  // jsdom workers yet. Everything else (vite dev/build/preview, api, worker, scripts) runs on Bun.
  await check("Node for Vitest", async () => {
    const nodeBin = Bun.which("node");
    const fix = "nvm install 20 && nvm use   (or: brew install node@22) -- only Vitest needs it";
    if (nodeBin === null)
      return warn("node not on PATH -- `bun run test` in apps/web and packages/ui will fail", fix);
    const out = await $`${nodeBin} --version`.quiet().nothrow();
    const version = out.stdout.toString().trim().replace(/^v/, "");
    if (!satisfiesMinimum(version, NODE_MIN_FOR_VITEST)) {
      return warn(`node ${version} < ${NODE_MIN_FOR_VITEST} required by Vitest 4 / Vite 8`, fix);
    }
    return pass(`node ${version} (>= ${NODE_MIN_FOR_VITEST}; Vitest only)`);
  });

  // -- docker -----------------------------------------------------------------------------------
  const docker = await dockerStatus();
  const dockerResult = await check("Docker daemon", async () =>
    docker.ok ? pass(`server ${docker.serverVersion}`) : fail("not reachable", docker.message),
  );
  const dockerOk = dockerResult.status === "PASS";

  const port = await pgPort();
  await check("Compose service postgres", async () => {
    if (!dockerOk) return skip("Docker is not running");
    const info = await composeServiceInfo();
    if (!info) return fail("no container", "bun run db:up");
    if (info.health !== "healthy") {
      return fail(`state=${info.state} health=${info.health || "none"}`, [
        "bun run db:up   (waits for the healthcheck)",
        "bun run db:logs   if it keeps failing",
      ]);
    }
    if (!info.publishedPorts.includes(port)) {
      return fail(
        `healthy, but publishes port ${info.publishedPorts.join(", ") || "?"} while TJ_PG_PORT=${port}`,
        "bun run db:up   (recreates the container on the new port)",
      );
    }
    return pass(`healthy on localhost:${port} (${info.name})`);
  });

  // -- database ---------------------------------------------------------------------------------
  const dbUrl = await databaseUrl();
  const explicitDbUrl = await rootSetting("DATABASE_URL");
  const dbUrlResult = await check("DATABASE_URL reachable", async () => {
    if (!dockerOk) return skip("Docker is not running");
    const source = explicitDbUrl ? "from .env/shell" : `derived from TJ_PG_PORT=${port}`;
    const probe = await pgProbe(dbUrl);
    if (!probe.ok) {
      return fail(`${dbUrl} (${source}): ${probe.error}`, [
        "bun run db:up",
        "if you changed TJ_PG_PORT, keep DATABASE_URL in sync (or unset it to derive it)",
      ]);
    }
    return pass(`${dbUrl} (${source})`);
  });
  const dbReachable = dbUrlResult.status === "PASS";

  if (explicitDbUrl) {
    await check("DATABASE_URL port matches TJ_PG_PORT", async () => {
      const parsed = parseDatabaseUrl(explicitDbUrl);
      if (!parsed) return fail("DATABASE_URL is not a postgres:// URL", "fix it in .env");
      if (parsed.host === "localhost" || parsed.host === "127.0.0.1") {
        if (parsed.port !== port) {
          return warn(
            `DATABASE_URL uses port ${parsed.port}, compose publishes ${port}`,
            "set the same port in DATABASE_URL and TJ_PG_PORT (or remove DATABASE_URL from .env)",
          );
        }
      }
      return pass(`${parsed.host}:${parsed.port}/${parsed.database}`);
    });
  }

  const testUrl = await testDatabaseUrl();
  await check("TEST_DATABASE_URL reachable", async () => {
    if (!dockerOk) return skip("Docker is not running");
    const sameServer =
      parseDatabaseUrl(dbUrl)?.host === parseDatabaseUrl(testUrl)?.host &&
      parseDatabaseUrl(dbUrl)?.port === parseDatabaseUrl(testUrl)?.port;
    if (!dbReachable && sameServer)
      return skip("same server as DATABASE_URL, which is unreachable");
    const probe = await pgProbe(testUrl);
    if (!probe.ok) {
      return fail(`${testUrl}: ${probe.error}`, [
        "bun run db:reset   (the test database is created by the init script on an empty volume)",
      ]);
    }
    return pass(testUrl);
  });

  await check("Databases present", async () => {
    if (!dbReachable) return skip("DATABASE_URL not reachable");
    const names = await listDatabases(dbUrl);
    const missing = [DEV_DB, TEST_DB].filter((db) => !names.includes(db));
    if (missing.length > 0) {
      return fail(
        `missing ${missing.join(", ")} (have: ${names.join(", ")})`,
        "bun run db:reset   (init scripts only run on an empty volume)",
      );
    }
    return pass(`${DEV_DB}, ${TEST_DB}`);
  });

  await check("pgvector extension", async () => {
    if (!dbReachable) return skip("DATABASE_URL not reachable");
    const dev = await vectorExtension(dbUrl);
    if (dev.available === null) {
      return fail(
        "the server has no `vector` extension",
        "the compose image must be pgvector/pgvector:pg16 -- run `bun run db:reset`",
      );
    }
    const test = await vectorExtension(testUrl).catch(() => ({ installed: null }));
    const notInstalled = [
      dev.installed === null ? DEV_DB : null,
      test.installed === null ? TEST_DB : null,
    ].filter((x): x is string => x !== null);
    if (notInstalled.length > 0) {
      return warn(
        `available (${dev.available}) but not enabled in ${notInstalled.join(", ")}`,
        "bun run db:reset   (or let the @tj/db migration run CREATE EXTENSION IF NOT EXISTS vector)",
      );
    }
    return pass(`v${dev.installed} enabled in ${DEV_DB} and ${TEST_DB}`);
  });

  // -- env files (infra/env.contract.ts, TEACH-26) -----------------------------------------
  // Every generated `.env.example` must have a sibling `.env` with all required keys (uncommented
  // in the example, or generated by `setup`) and well-formed values. Values are never printed.
  for (const file of Object.keys(ENV_FILES) as EnvFile[]) {
    const envPath = path.join(ROOT, path.dirname(ENV_FILES[file].path), ".env");
    const examplePath = path.join(ROOT, ENV_FILES[file].path);
    await check(`Env ${rel(envPath)}`, async () => {
      const envFile = Bun.file(envPath);
      const report = validateEnvFile(file, (await envFile.exists()) ? await envFile.text() : null);
      if (!report.exists) {
        return fail(
          "file missing",
          `bun run setup   (copies ${rel(examplePath)} -> ${rel(envPath)})`,
        );
      }
      const problems: string[] = [];
      const fixes: string[] = [];
      if (report.missing.length > 0) {
        problems.push(`missing ${report.missing.length} key(s): ${report.missing.join(", ")}`);
        const generated = report.missing.filter((k) => envVar(k)?.setBy === "generated");
        if (generated.length > 0) fixes.push(`bun run setup   (generates ${generated.join(", ")})`);
        if (generated.length < report.missing.length) {
          fixes.push(
            `add the other keys to ${rel(envPath)} -- see docs/env.md and ${rel(examplePath)}`,
          );
        }
      }
      if (report.invalid.length > 0) {
        problems.push(
          `invalid: ${report.invalid.map((i) => `${i.name} (expected ${i.expected})`).join(", ")}`,
        );
        fixes.push(`fix the value(s) in ${rel(envPath)} (docs/env.md lists the accepted shapes)`);
      }
      if (problems.length > 0) return fail(problems.join("; "), fixes);
      const extra = report.extra.length > 0 ? `; extra keys: ${report.extra.join(", ")}` : "";
      return pass(`all required keys present and well-formed${extra}`);
    });
  }

  // -- ports ------------------------------------------------------------------------------------
  for (const { port: devPort, owner } of DEV_PORTS) {
    await check(`Port ${devPort} (${owner})`, async () => {
      const listeners = await portListeners(devPort);
      if (listeners === null) return warn("lsof not found; cannot inspect the port");
      if (listeners.length === 0) return pass("free");
      const foreign = listeners.filter((l) => !OUR_PROCESS_RE.test(l.command));
      const describe = listeners.map((l) => `${l.command}[${l.pid}]`).join(", ");
      if (foreign.length === 0) return pass(`in use by our own process: ${describe}`);
      return fail(
        `in use by ${describe}`,
        `stop that process (kill ${foreign.map((l) => l.pid).join(" ")}) or change the app port`,
      );
    });
  }

  // -- git hooks & tooling ----------------------------------------------------------------------
  await check("Git hooks (lefthook)", async () => {
    const missing = await missingLefthookHooks();
    if (missing.length > 0) {
      return fail(
        `missing: ${missing.join(", ")}`,
        "bunx lefthook install   (bun install also does it)",
      );
    }
    return pass("pre-commit and commit-msg installed");
  });

  await check("gitleaks on PATH", async () => {
    const found = Bun.which("gitleaks");
    if (found === null) {
      return warn(
        "not found -- the pre-commit secret scan is skipped locally (CI still runs it)",
        "brew install gitleaks   (macOS) / https://github.com/gitleaks/gitleaks#installing",
      );
    }
    return pass(found);
  });

  await check("agent skills (skills:check)", async () => {
    const proc = await $`bun ${ROOT}/scripts/skills-check.ts`.cwd(ROOT).quiet().nothrow();
    if (proc.exitCode !== 0) {
      const lines = proc.stdout
        .toString()
        .split("\n")
        .filter((l) => l.includes("MISSING") || l.includes("FAIL"));
      return fail(
        lines.length > 0 ? lines.join("; ") : `exit ${proc.exitCode}`,
        "Re-install per docs/agent-skills.md, or run: bun run skills:check",
      );
    }
    return pass("all skills present (docs/agent-skills.md)");
  });

  // -- summary ----------------------------------------------------------------------------------
  console.log("");
  const summary = `${counts.PASS} passed, ${counts.WARN} warnings, ${counts.FAIL} failed, ${counts.SKIP} skipped`;
  if (counts.FAIL > 0) {
    console.error(colour.red(colour.bold(`Doctor: ${summary}.`)));
    console.error("Apply the fixes above, then re-run `bun run doctor`.");
    return ExitCode.Failure;
  }
  console.log(colour.green(colour.bold(`Doctor: ${summary}.`)));
  return ExitCode.Ok;
});

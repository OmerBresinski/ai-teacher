import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ENV,
  ENV_CONTRACT,
  ENV_FILES,
  type EnvFile,
  placementsOf,
  railwayNames,
  requiredKeysForFile,
  TURBO_ENV_GLOBS,
  vercelNames,
} from "../infra/env.contract";
import { ROOT } from "./lib/paths";

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

describe("infra/env.contract.ts", () => {
  test("names are unique, upper-snake and mirrored by ENV", () => {
    const names = ENV_CONTRACT.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(NAME_RE);
    expect(ENV.DATABASE_URL).toBe("DATABASE_URL");
    expect(Object.keys(ENV).sort()).toEqual([...names].sort());
  });

  test("every entry is internally consistent", () => {
    for (const v of ENV_CONTRACT) {
      expect(v.services.length, v.name).toBeGreaterThan(0);
      expect(v.description.trim().length, v.name).toBeGreaterThan(10);
      if (v.format === "enum") expect(v.values?.length, v.name).toBeGreaterThan(0);
      if (v.setBy === "generated") expect(v.scope, v.name).toBe("secret");
      // A secret never has an example value other than the synthetic compose credentials.
      if (v.scope === "secret" && v.local !== null) {
        expect(v.local, v.name).toStartWith("postgres://postgres:postgres@localhost");
      }
      // Provider targets only make sense for services that run there.
      if (v.railway !== "n/a") {
        expect(
          v.services.some((s) => s === "api" || s === "worker"),
          v.name,
        ).toBe(true);
      }
      if (v.vercel !== "n/a") expect(v.services).toContain("web");
      for (const p of placementsOf(v)) {
        expect(Object.keys(ENV_FILES)).toContain(p.file);
        if (!p.commented) expect(p.value, `${v.name} in ${p.file}`).not.toBeNull();
      }
    }
  });

  test("the local path needs no provider value: every required local key has a synthetic value or is generated", () => {
    for (const file of Object.keys(ENV_FILES) as EnvFile[]) {
      for (const name of requiredKeysForFile(file)) {
        const v = ENV_CONTRACT.find((x) => x.name === name);
        expect(v, name).toBeDefined();
        const placement = placementsOf(v as (typeof ENV_CONTRACT)[number]).find(
          (p) => p.file === file,
        );
        expect(placement?.value !== null || v?.setBy === "generated", `${name} in ${file}`).toBe(
          true,
        );
      }
    }
  });

  test("provider name lists match the documented targets", () => {
    expect(railwayNames("worker", "production")).toEqual([
      "DATABASE_URL",
      "NODE_ENV",
      "PORT",
      "LOG_LEVEL",
      "WORKER_CONCURRENCY",
      "BLOB_READ_WRITE_TOKEN",
    ]);
    // Set on production so PR environments (copies of production) inherit it (TEACH-38).
    expect(railwayNames("api", "pr")).toContain("WEB_ORIGIN_PATTERNS");
    expect(railwayNames("api", "production")).toContain("WEB_ORIGIN_PATTERNS");
    expect(railwayNames("api", "production")).not.toContain("ENABLE_TEST_ROUTES");
    expect(vercelNames("production")).toEqual(["VITE_API_URL", "VITE_APP_ENV"]);
    expect(vercelNames("preview")).toEqual([
      "VITE_APP_ENV",
      "RAILWAY_PR_API_URL_TEMPLATE",
      "VITE_API_URL_FALLBACK",
    ]);
  });
});

describe("turbo.json env lists derive from the contract", () => {
  test("every `env` entry is a contract name or an allowed glob", async () => {
    const turbo = JSON.parse(await readFile(path.join(ROOT, "turbo.json"), "utf8")) as {
      tasks: Record<string, { env?: string[] }>;
    };
    const names = new Set<string>(ENV_CONTRACT.map((v) => v.name));
    const globs = new Set<string>(TURBO_ENV_GLOBS);
    const offenders: string[] = [];
    for (const [task, config] of Object.entries(turbo.tasks)) {
      for (const entry of config.env ?? []) {
        const ok = entry.includes("*") ? globs.has(entry) : names.has(entry);
        if (!ok) offenders.push(`${task}: ${entry}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("generated .env.example files exist for every contract file", () => {
  test("paths resolve", async () => {
    for (const { path: relPath } of Object.values(ENV_FILES)) {
      expect(await Bun.file(path.join(ROOT, relPath)).exists(), relPath).toBe(true);
    }
  });
});

import { describe, expect, test } from "bun:test";
import { parseArgs } from "./env-check";
import {
  buildTargets,
  compareNames,
  fixCommands,
  formatReport,
  parseRailwayVariablesJson,
  parseVercelEnvJson,
  parseVercelEnvTable,
  railwayUnavailableReason,
} from "./lib/env-check";

/** Shape of `railway variable list --json --service worker` (values are fixtures, not real). */
const RAILWAY_WORKER_JSON = JSON.stringify({
  DATABASE_URL: "postgres://u:SECRETVALUE123@postgres.railway.internal:5432/db",
  NODE_ENV: "production",
  PORT: "3002",
  LOG_LEVEL: "info",
  RAILWAY_ENVIRONMENT: "production",
  RAILWAY_PROJECT_ID: "00000000-0000-0000-0000-000000000000",
  ROGUE_VAR: "SECRETVALUE123",
});

/** Shape of `vercel env ls preview --json` (CLI 59.11) with fixture values. */
const VERCEL_PREVIEW_JSON = JSON.stringify({
  envs: [
    {
      key: "VITE_API_URL_FALLBACK",
      value: "SECRETVALUE123",
      type: "encrypted",
      target: ["preview"],
    },
    {
      key: "RAILWAY_PR_API_URL_TEMPLATE",
      value: "SECRETVALUE123",
      type: "encrypted",
      target: ["preview"],
    },
    { key: "VITE_APP_ENV", value: "preview", type: "encrypted", target: ["preview"] },
    { key: "VITE_API_URL", value: "SECRETVALUE123", type: "encrypted", target: ["production"] },
  ],
});

/** The human table `vercel env ls preview` prints (CLI 59.11); the value column is a ciphertext prefix. */
const VERCEL_PREVIEW_TABLE = `Vercel CLI 59.11.2 (Node.js 25.3.0)
Retrieving project…
> Environment Variables found for omerbresinskis-projects/teaching-journey-web [236ms]

 name                               value                       type      environments    created    
 VITE_API_URL_FALLBACK              SECRETVALUE123…             Config    Preview         43m ago    
 RAILWAY_PR_API_URL_TEMPLATE        eyJ2IjoidjIiLCJjIj…         Config    Preview         43m ago    
 VITE_APP_ENV                       eyJ2IjoidjIiLCJjIj…         Config    Preview         43m ago    
 VITE_API_URL                       eyJ2IjoidjIiLCJjIj…         Config    Production      1h ago     

`;

describe("parseRailwayVariablesJson", () => {
  test("keeps user variable names, drops RAILWAY_* built-ins and every value", () => {
    expect(parseRailwayVariablesJson(RAILWAY_WORKER_JSON)).toEqual([
      "DATABASE_URL",
      "LOG_LEVEL",
      "NODE_ENV",
      "PORT",
      "ROGUE_VAR",
    ]);
    expect(parseRailwayVariablesJson("No linked project found")).toBeNull();
    expect(parseRailwayVariablesJson("[]")).toBeNull();
  });
});

describe("railwayUnavailableReason", () => {
  test("one plain sentence per failure mode, null for a real listing", () => {
    expect(railwayUnavailableReason(false, "", "", 0)).toBe(
      "Railway: `railway` CLI not installed — skipping (see infra/README.md)",
    );
    expect(
      railwayUnavailableReason(
        true,
        "No linked project found. Run railway link to connect to a project\n  → Run `railway link` to connect to a project.",
        "",
        0,
      ),
    ).toBe("Railway: not linked — skipping (see infra/README.md)");
    expect(
      railwayUnavailableReason(true, "", "Unauthorized. Please login with `railway login`", 1),
    ).toMatch(/^Railway: not (logged in|linked)/);
    expect(railwayUnavailableReason(true, "garbage", "", 2)).toBe(
      "Railway: unreadable CLI output (exit 2) — skipping (see infra/README.md)",
    );
    expect(railwayUnavailableReason(true, RAILWAY_WORKER_JSON, "", 0)).toBeNull();
  });
});

describe("parseVercelEnv*", () => {
  test("JSON: names targeting the requested environment", () => {
    expect(parseVercelEnvJson(VERCEL_PREVIEW_JSON, "preview")).toEqual([
      "RAILWAY_PR_API_URL_TEMPLATE",
      "VITE_API_URL_FALLBACK",
      "VITE_APP_ENV",
    ]);
    expect(parseVercelEnvJson(VERCEL_PREVIEW_JSON, "production")).toEqual(["VITE_API_URL"]);
    expect(parseVercelEnvJson("Retrieving project…", "preview")).toBeNull();
    expect(parseVercelEnvJson("{}", "preview")).toBeNull();
  });

  test("table fallback: first column only, filtered by environment", () => {
    expect(parseVercelEnvTable(VERCEL_PREVIEW_TABLE, "preview")).toEqual([
      "RAILWAY_PR_API_URL_TEMPLATE",
      "VITE_API_URL_FALLBACK",
      "VITE_APP_ENV",
    ]);
    expect(parseVercelEnvTable(VERCEL_PREVIEW_TABLE)).toEqual([
      "RAILWAY_PR_API_URL_TEMPLATE",
      "VITE_API_URL",
      "VITE_API_URL_FALLBACK",
      "VITE_APP_ENV",
    ]);
    expect(parseVercelEnvTable("no table here")).toEqual([]);
  });
});

describe("targets and reports", () => {
  test("buildTargets covers api/worker production (+ pr) and both Vercel environments", () => {
    const base = buildTargets({});
    expect(base.map((t) => `${t.provider}:${t.service}:${t.environment}`)).toEqual([
      "railway:api:production",
      "railway:worker:production",
      "vercel:teaching-journey-web:production",
      "vercel:teaching-journey-web:preview",
    ]);
    const withPr = buildTargets({ pr: 42 });
    expect(withPr.map((t) => t.environment)).toContain("ai-teacher-pr-42");
    const apiPr = withPr.find((t) => t.service === "api" && t.environment === "ai-teacher-pr-42");
    expect(apiPr?.expected).toContain("WEB_ORIGIN_PATTERNS");
  });

  test("compareNames + fixCommands: missing and extra names, placeholders never values", () => {
    const target = buildTargets({}).find((t) => t.service === "worker") as ReturnType<
      typeof buildTargets
    >[number];
    const report = compareNames(target, parseRailwayVariablesJson(RAILWAY_WORKER_JSON) ?? []);
    expect(report.missing).toEqual(["WORKER_CONCURRENCY", "BLOB_READ_WRITE_TOKEN"]);
    expect(report.extra).toEqual(["ROGUE_VAR"]);
    const commands = fixCommands(report);
    expect(commands).toEqual([
      "railway variable set --service worker --skip-deploys 'WORKER_CONCURRENCY=4'",
      "railway variable set BLOB_READ_WRITE_TOKEN --stdin --service worker --skip-deploys  < /path/to/secret",
      "# not in the contract: railway variable delete ROGUE_VAR --service worker --environment production   (or add it to infra/env.contract.ts)",
    ]);
  });

  test("vercel fix commands", () => {
    const target = buildTargets({}).find(
      (t) => t.provider === "vercel" && t.environment === "preview",
    ) as ReturnType<typeof buildTargets>[number];
    const report = compareNames(target, ["VITE_APP_ENV"]);
    expect(fixCommands(report)).toEqual([
      "vercel env add RAILWAY_PR_API_URL_TEMPLATE preview   # then paste <value>",
      "vercel env add VITE_API_URL_FALLBACK preview   # then paste <value>",
    ]);
  });

  test("the whole report of a run over fixtures containing SECRETVALUE123 never contains it", () => {
    const lines: string[] = [];
    for (const target of buildTargets({ pr: 7 })) {
      const actual =
        target.provider === "railway"
          ? (parseRailwayVariablesJson(RAILWAY_WORKER_JSON) ?? [])
          : (parseVercelEnvJson(
              VERCEL_PREVIEW_JSON,
              target.environment as "production" | "preview",
            ) ?? parseVercelEnvTable(VERCEL_PREVIEW_TABLE));
      lines.push(...formatReport(compareNames(target, actual), true));
    }
    const output = lines.join("\n");
    expect(output).not.toContain("SECRETVALUE123");
    expect(output).not.toContain("eyJ2Ijoi");
    expect(output).toContain("DRIFT Railway api / ai-teacher-pr-7");
    expect(output).toContain("ok    Vercel teaching-journey-web / preview");
  });

  test("a clean target renders one ok line", () => {
    const target = buildTargets({}).find(
      (t) => t.provider === "vercel" && t.environment === "production",
    ) as ReturnType<typeof buildTargets>[number];
    expect(formatReport(compareNames(target, ["VITE_API_URL", "VITE_APP_ENV"]), false)).toEqual([
      "ok    Vercel teaching-journey-web / production: 2 expected name(s) present, none extra",
    ]);
  });
});

describe("parseArgs", () => {
  test("flags", () => {
    expect(parseArgs([])).toEqual({ fix: false, strict: false });
    expect(parseArgs(["--pr", "12", "--fix", "--strict"])).toEqual({
      pr: 12,
      fix: true,
      strict: true,
    });
    expect(() => parseArgs(["--pr"])).toThrow("--pr needs");
    expect(() => parseArgs(["--nope"])).toThrow("Unknown option");
  });
});

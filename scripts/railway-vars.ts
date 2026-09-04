#!/usr/bin/env bun
// bun scripts/railway-vars.ts api|worker [--environment production|pr]
//
// Prints the non-secret `NAME=value` pairs `infra/railway/provision.sh` seeds on a Railway service
// (`railwayValue` in infra/env.contract.ts: plain config and `${{...}}` references), one per line,
// plus `# secret: NAME` comment lines for the secrets the script must set through `--stdin`.
// Nothing here is a secret; `PORT` follows the contract's per-service local value.

import {
  ENV_CONTRACT,
  type EnvVar,
  placementsOf,
  type RailwayEnvironment,
  railwayNames,
} from "../infra/env.contract";
import { ExitCode, runMain, UserFacingError } from "./lib/exit";

export type RailwayService = "api" | "worker";

export interface RailwayVarLine {
  name: string;
  /** `null` for secrets without a reference (set via `--stdin`) and manual values without a template. */
  value: string | null;
  secret: boolean;
}

function seedValue(v: EnvVar, service: RailwayService): string | null {
  // A `${{...}}` reference is not a secret even when the resolved value is (DATABASE_URL).
  if (v.railwayValue) return v.railwayValue;
  if (v.scope === "secret") return null;
  if (v.name === "PORT") {
    return placementsOf(v).find((p) => p.file === service)?.value ?? v.local;
  }
  return null;
}

/** Pure: what provision.sh should seed for `service` in `environment`. */
export function railwayVarLines(
  service: RailwayService,
  environment: RailwayEnvironment = "production",
): RailwayVarLine[] {
  const names = new Set(railwayNames(service, environment));
  return ENV_CONTRACT.filter((v) => names.has(v.name)).map((v) => ({
    name: v.name,
    value: seedValue(v, service),
    secret: v.scope === "secret" && !v.railwayValue,
  }));
}

/** Text output: `NAME=value` lines, `# secret: NAME` and `# manual: NAME` comments. */
export function renderRailwayVars(lines: RailwayVarLine[]): string {
  return lines
    .map((l) => {
      if (l.secret) return `# secret: ${l.name}   (railway variable set ${l.name} --stdin ...)`;
      if (l.value === null) return `# manual: ${l.name}   (no template; set when the value exists)`;
      return `${l.name}=${l.value}`;
    })
    .join("\n");
}

async function main(): Promise<number> {
  const [service, ...rest] = process.argv.slice(2);
  if (service !== "api" && service !== "worker") {
    throw new UserFacingError(
      "usage: bun scripts/railway-vars.ts api|worker [--environment production|pr]",
      ExitCode.Usage,
    );
  }
  let environment: RailwayEnvironment = "production";
  if (rest[0] === "--environment") {
    if (rest[1] !== "production" && rest[1] !== "pr") {
      throw new UserFacingError("--environment must be production or pr", ExitCode.Usage);
    }
    environment = rest[1];
  } else if (rest.length > 0) {
    throw new UserFacingError(`Unknown option(s): ${rest.join(" ")}`, ExitCode.Usage);
  }
  console.log(renderRailwayVars(railwayVarLines(service, environment)));
  return ExitCode.Ok;
}

if (import.meta.main) await runMain(main);

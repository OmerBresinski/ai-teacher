#!/usr/bin/env bun
// bun run dev [-- <turbo args>]
//
// Makes sure the compose Postgres is reachable (starting it when `select 1` fails), then runs
// `turbo run dev` with inherited stdio. SIGINT/SIGTERM/SIGHUP are forwarded to turbo and this
// process waits for it to exit, so Ctrl-C leaves no orphan tasks behind.
//
// UI: no `--ui` flag is passed, so turbo.json (`"ui": "stream"`, prefixed logs) applies;
// override per run with `TURBO_UI=tui bun run dev` (env beats turbo.json; a CLI flag beats both).

import path from "node:path";
import { startPostgres } from "./lib/docker";
import { databaseUrl } from "./lib/env";
import { ExitCode, runMain } from "./lib/exit";
import { log } from "./lib/log";
import { ROOT } from "./lib/paths";
import { pgIsReady } from "./lib/pg";

/**
 * The native turbo binary for this platform, resolved the same way turbo's own `bin/turbo`
 * wrapper does it (so no `node` is required). Falls back to the wrapper via `bun x`.
 */
function turboCommand(): string[] {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "64" : process.arch;
  try {
    const turboPkgDir = path.dirname(Bun.resolveSync("turbo/package.json", ROOT));
    const ext = platform === "windows" ? ".exe" : "";
    return [Bun.resolveSync(`@turbo/${platform}-${arch}/bin/turbo${ext}`, turboPkgDir)];
  } catch {
    return ["bun", "x", "turbo"];
  }
}

await runMain(async () => {
  const url = await databaseUrl();
  if (await pgIsReady(url)) {
    log.info(`Postgres reachable at ${url}`);
  } else {
    log.step("Postgres is not reachable -- starting docker compose");
    await startPostgres();
  }

  const command = [...turboCommand(), "run", "dev", ...process.argv.slice(2)];
  const child = Bun.spawn(command, {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });

  const forward = (signal: NodeJS.Signals) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => forward(signal));
  }

  const code = await child.exited;
  if (child.signalCode === "SIGINT") return ExitCode.Interrupted;
  return code;
});

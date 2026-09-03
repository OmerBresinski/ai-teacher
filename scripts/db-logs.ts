#!/usr/bin/env bun
// bun run db:logs -- follow the Postgres container logs (Ctrl-C to stop).

import { COMPOSE_SERVICE, ensureDocker } from "./lib/docker";
import { runMain } from "./lib/exit";
import { ROOT } from "./lib/paths";

await runMain(async () => {
  await ensureDocker();
  const child = Bun.spawn(["docker", "compose", "logs", "-f", "--tail=100", COMPOSE_SERVICE], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const stop = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const code = await child.exited;
  // Ctrl-C ends `logs -f` with 130 (or a signal); that is a normal way to leave.
  return code === 130 || child.signalCode !== null ? 0 : code;
});

#!/usr/bin/env bun
// bun run clean -- remove build/install output across the root and every workspace:
// node_modules, dist, .turbo, coverage. The Postgres volume is NOT touched (use db:reset).

import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { runMain } from "./lib/exit";
import { log } from "./lib/log";
import { ROOT, rel } from "./lib/paths";
import { workspaceDirs } from "./lib/workspaces";

const TARGETS = ["node_modules", "dist", ".turbo", "coverage"];

await runMain(async () => {
  log.step("Cleaning build and install output");
  const dirs = [ROOT, ...(await workspaceDirs())];
  let removed = 0;
  for (const dir of dirs) {
    for (const target of TARGETS) {
      const full = path.join(dir, target);
      const exists = await stat(full).then(
        () => true,
        () => false,
      );
      if (!exists) continue;
      await rm(full, { recursive: true, force: true });
      removed += 1;
      log.ok(`removed ${rel(full)}`);
    }
  }
  if (removed === 0) log.info("nothing to remove");
  log.info("next: bun install   (then bun run setup if Postgres is down)");
});

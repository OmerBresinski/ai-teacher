#!/usr/bin/env bun
// git diff --name-only HEAD^1 HEAD | bun scripts/e2e-scope.ts
//
// Decides whether a pull request needs the Playwright e2e shards (ci.yml `detect`, TEACH-190
// part b). Reads the changed paths on stdin, one per line, and prints `e2e=false` when every one of
// them is documentation, `e2e=true` otherwise, ready to append to `$GITHUB_OUTPUT`. An empty list
// prints `e2e=true`: when the diff cannot be read, the suite runs.
//
// Documentation is what turbo.json already leaves out of every task's inputs (the vendored agent
// skills and their lock file) plus `docs/` and every Markdown file; no app imports a `.md` file.
// Imports only Bun built-ins, so `detect` runs it without `bun install`.

/** Directories that hold vendored agent skills, wherever they sit (turbo.json input exclusions). */
const SKILL_DIRS = new Set([".agents", ".claude", ".opencode"]);

/** True when a change to `path` cannot affect what the e2e suite runs. */
export function isDocPath(path: string): boolean {
  if (path.startsWith("docs/") || path.endsWith(".md") || path === "skills-lock.json") return true;
  // Every segment but the last is a directory.
  return path
    .split("/")
    .slice(0, -1)
    .some((dir) => SKILL_DIRS.has(dir));
}

/** True when there is at least one changed path and every one is documentation. */
export function docsOnly(paths: readonly string[]): boolean {
  const changed = paths.map((path) => path.trim()).filter((path) => path !== "");
  return changed.length > 0 && changed.every(isDocPath);
}

if (import.meta.main) {
  const changed = (await Bun.stdin.text()).split("\n");
  console.log(`e2e=${docsOnly(changed) ? "false" : "true"}`);
}

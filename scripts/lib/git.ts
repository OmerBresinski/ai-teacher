import path from "node:path";
import { $ } from "bun";
import { ROOT } from "./paths";

/**
 * The git hooks directory for this checkout. `git rev-parse --git-path hooks` resolves both
 * worktrees (where `.git` is a file pointing at the common dir) and `core.hooksPath`. Falls back
 * to `<git-common-dir>/hooks`, then `.git/hooks`.
 */
export async function gitHooksDir(): Promise<string> {
  const viaPath = await $`git rev-parse --git-path hooks`.cwd(ROOT).quiet().nothrow();
  if (viaPath.exitCode === 0) {
    const p = viaPath.stdout.toString().trim();
    if (p !== "") return path.resolve(ROOT, p);
  }
  const common = await $`git rev-parse --git-common-dir`.cwd(ROOT).quiet().nothrow();
  if (common.exitCode === 0) {
    const p = common.stdout.toString().trim();
    if (p !== "") return path.join(path.resolve(ROOT, p), "hooks");
  }
  return path.join(ROOT, ".git", "hooks");
}

export const LEFTHOOK_HOOKS = ["pre-commit", "commit-msg"] as const;

/** Which lefthook-managed hooks are missing (a hook counts when its file mentions "lefthook"). */
export async function missingLefthookHooks(): Promise<string[]> {
  const dir = await gitHooksDir();
  const missing: string[] = [];
  for (const hook of LEFTHOOK_HOOKS) {
    const file = Bun.file(path.join(dir, hook));
    if (!(await file.exists()) || !(await file.text()).includes("lefthook")) missing.push(hook);
  }
  return missing;
}

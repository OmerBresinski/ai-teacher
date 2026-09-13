/**
 * Deployment watch coverage (TEACH-276, audit F11).
 *
 * Two deploy filters decide whether a merge to master rebuilds anything:
 *   - apps/web/scripts/vercel-ignore-build.sh  (Vercel "Ignored Build Step", exit 0 = skip)
 *   - .railway/watch.ts IMAGE_WATCH             (Railway watchPatterns for api and worker)
 *
 * Both must cover every workspace package the deployed app bundles from source, or a package-only
 * security fix merges green and never ships. The shell script is exercised for real in a throwaway
 * git repository; the lists are pinned against the transitive `@tj/*` closure read from the
 * workspace manifests, never against a copy of the lists.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { IMAGE_INPUTS, IMAGE_WATCH, workspacePackages } from "../.railway/watch";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = "apps/web/scripts/vercel-ignore-build.sh";

/** The PATHS array of the shell script, parsed from its source (one path per line). */
async function scriptPaths(): Promise<string[]> {
  const src = await readFile(join(ROOT, SCRIPT), "utf8");
  const block = src.match(/^PATHS=\(\n([\s\S]*?)^\)/m);
  if (!block?.[1]) throw new Error("PATHS=( ... ) not found in vercel-ignore-build.sh");
  return block[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${err}`);
  return out.trim();
}

/** A repo with the real script at its real location and one base commit. */
async function makeRepo(): Promise<{ dir: string; base: string }> {
  const dir = await mkdtemp(join(tmpdir(), "deploy-watch-"));
  await mkdir(join(dir, dirname(SCRIPT)), { recursive: true });
  await writeFile(join(dir, SCRIPT), await readFile(join(ROOT, SCRIPT)));
  await git(dir, "init", "-q", "-b", "master");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "base");
  return { dir, base: await git(dir, "rev-parse", "HEAD") };
}

async function commitFile(dir: string, path: string): Promise<void> {
  await mkdir(join(dir, dirname(path)), { recursive: true });
  await writeFile(join(dir, path), `changed ${Date.now()}\n`);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", `touch ${path}`);
}

async function runScript(
  dir: string,
  previousSha: string | undefined,
): Promise<{ code: number; out: string }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.VERCEL_GIT_PREVIOUS_SHA;
  if (previousSha !== undefined) env.VERCEL_GIT_PREVIOUS_SHA = previousSha;
  const proc = Bun.spawn(["bash", join(dir, SCRIPT)], {
    cwd: join(dir, "apps/web"),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, out };
}

describe("vercel-ignore-build.sh (real script, throwaway repo)", () => {
  const repos: string[] = [];
  afterAll(async () => {
    await Promise.all(repos.map((d) => rm(d, { recursive: true, force: true })));
  });

  async function scenario(changed: string): Promise<{ code: number; out: string }> {
    const { dir, base } = await makeRepo();
    repos.push(dir);
    await commitFile(dir, changed);
    return runScript(dir, base);
  }

  test.each([
    "packages/editor/src/text/serialize.ts",
    "packages/slides/src/theme.ts",
    "packages/ui/src/button.tsx",
    "packages/domain/src/documents/rich-text.ts",
    "apps/web/src/main.tsx",
    "bun.lock",
  ])("a change confined to %s builds (exit 1)", async (path) => {
    const { code, out } = await scenario(path);
    expect(out).toContain("-> build");
    expect(code).toBe(1);
  });

  test.each(["docs/adr/0001.md", "apps/api/src/app.ts", "packages/extract/src/mime.ts"])(
    "a change confined to %s skips (exit 0)",
    async (path) => {
      const { code, out } = await scenario(path);
      expect(out).toContain("-> skip");
      expect(code).toBe(0);
    },
  );

  test("no VERCEL_GIT_PREVIOUS_SHA builds even with no changes", async () => {
    const { dir } = await makeRepo();
    repos.push(dir);
    const { code, out } = await runScript(dir, undefined);
    expect(out).toContain("no VERCEL_GIT_PREVIOUS_SHA");
    expect(code).toBe(1);
  });

  test("a previous SHA that is not in the clone builds", async () => {
    const { dir } = await makeRepo();
    repos.push(dir);
    const { code, out } = await runScript(dir, "0123456789abcdef0123456789abcdef01234567");
    expect(out).toContain("not in this clone -> build");
    expect(code).toBe(1);
  });

  test("no changes at all skips", async () => {
    const { dir, base } = await makeRepo();
    repos.push(dir);
    const { code } = await runScript(dir, base);
    expect(code).toBe(0);
  });
});

describe("watch lists cover the transitive @tj/* closure (from the manifests)", () => {
  let paths: string[];
  beforeAll(async () => {
    paths = await scriptPaths();
  });

  test("web: every package @tj/web consumes from source is in PATHS", () => {
    // `@tj/api` is a type-only dependency of `@tj/api-client` (AppType): its route signatures
    // reach the web typecheck, not the bundle -- excluded on purpose (see the script comment).
    const closure = workspacePackages("apps/web", ["@tj/api"]);
    expect(closure).toContain("packages/editor");
    expect(closure).toContain("packages/slides");
    for (const pkg of closure) expect(paths).toContain(pkg);
  });

  test("web: the root manifests, lockfile and the app itself are in PATHS", () => {
    for (const p of ["apps/web", "bun.lock", "turbo.json", "package.json", "bunfig.toml"]) {
      expect(paths).toContain(p);
    }
  });

  test("image: every package @tj/api or @tj/worker bundles is in IMAGE_WATCH", () => {
    const closure = new Set([
      ...workspacePackages("apps/api"),
      ...workspacePackages("apps/worker"),
    ]);
    expect([...closure]).toContain("packages/extract");
    expect([...closure]).toContain("packages/images");
    for (const pkg of closure) expect(IMAGE_WATCH).toContain(`${pkg}/**`);
  });

  test("image: the non-package image inputs are watched", () => {
    for (const input of IMAGE_INPUTS) expect(IMAGE_WATCH).toContain(input);
    expect(IMAGE_INPUTS).toContain("Dockerfile");
    expect(IMAGE_INPUTS).toContain("infra/docker/**");
  });

  test("image: nothing outside the image is watched (docs-only merges stay skipped)", () => {
    for (const p of IMAGE_WATCH) {
      expect(p).not.toMatch(/^(docs|apps\/web|packages\/ui|packages\/api-client|packages\/editor)/);
    }
  });

  /**
   * Railway reads `watchPatterns` from its stored service config, not from this repository: the
   * computed list only reaches production through `railway config apply`. This pin is the list
   * that was applied last; when the closure grows (a new `@tj/*` runtime dependency) this test
   * fails in CI until someone runs `railway config plan && railway config apply` and updates the
   * pin, so the live filter can never silently lag the manifests.
   */
  test("image: the computed watch list is the one applied to Railway (2026-09-13)", () => {
    const APPLIED_IMAGE_WATCH = [
      "Dockerfile",
      ".dockerignore",
      "infra/docker/**",
      ".railway/**",
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "turbo.json",
      "packages/ai/**",
      "packages/config/**",
      "packages/db/**",
      "packages/domain/**",
      "packages/extract/**",
      "packages/images/**",
      "packages/jobs/**",
      "packages/storage/**",
      "packages/generation/**",
      "packages/slides/**",
    ];
    expect(IMAGE_WATCH).toEqual(APPLIED_IMAGE_WATCH);
  });
});

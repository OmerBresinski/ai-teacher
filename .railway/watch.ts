/**
 * Watch patterns for the api / worker image (TEACH-276, audit F11).
 *
 * The Dockerfile bundles `@tj/api` and `@tj/worker` with every workspace package they consume from
 * source (ADR 0013), so a change in any of those packages must rebuild the image. The list is
 * the union of both apps' transitive `@tj/*` dependency closures, read from the workspace
 * manifests at plan/apply time -- a new `@tj/*` dependency is watched the moment it is declared,
 * and `scripts/deploy-watch.test.ts` pins the closure against the manifests.
 *
 * `.railway/**` is watched as well: only `railway config apply` can change the live config, but
 * this file changing is a signal that the effective config may be stale.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Not `import.meta.dir`: the Railway CLI evaluates this file with Node's TypeScript runner.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Image inputs that are not workspace packages. `.dockerignore` is the allow-list. */
export const IMAGE_INPUTS = [
  "Dockerfile",
  ".dockerignore",
  "infra/docker/**",
  ".railway/**",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "turbo.json",
];

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as Manifest;
}

/** `@tj/<name>` -> `packages/<name>`: every internal package lives under packages/ by name. */
export function packageDir(name: string): string {
  return `packages/${name.slice("@tj/".length)}`;
}

/**
 * Transitive `@tj/*` dependency closure of a workspace (dependencies + devDependencies, because
 * `@tj/config` ships tsconfig bases and the Tailwind preset that shape the build), as
 * `packages/<name>` paths, sorted. `exclude` drops type-only edges (e.g. `@tj/api` for the web).
 */
export function workspacePackages(appDir: string, exclude: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const queue = [appDir];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) break;
    const manifest = readManifest(dir);
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (!dep.startsWith("@tj/") || exclude.includes(dep) || seen.has(dep)) continue;
      seen.add(dep);
      queue.push(packageDir(dep));
    }
  }
  return [...seen].map(packageDir).sort();
}

/** Watch patterns shared by api and worker: image inputs + every bundled workspace package. */
export const IMAGE_WATCH = [
  ...IMAGE_INPUTS,
  ...new Set([...workspacePackages("apps/api"), ...workspacePackages("apps/worker")]),
].map((p) => (p.startsWith("packages/") ? `${p}/**` : p));

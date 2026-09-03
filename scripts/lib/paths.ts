import path from "node:path";

/** Absolute path of the repository root (this file lives in `scripts/lib/`). */
export const ROOT = path.resolve(import.meta.dir, "..", "..");

export const COMPOSE_FILE = path.join(ROOT, "docker-compose.yml");
export const ROOT_ENV_EXAMPLE = path.join(ROOT, ".env.example");
export const ROOT_ENV = path.join(ROOT, ".env");

/** Path relative to the repo root, for messages. */
export function rel(p: string): string {
  const r = path.relative(ROOT, p);
  return r === "" ? "." : r;
}

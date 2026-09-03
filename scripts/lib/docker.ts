import { $ } from "bun";
import { UserFacingError } from "./exit";
import { log } from "./log";
import { ROOT } from "./paths";

export const COMPOSE_SERVICE = "postgres";

/** The exact sentence printed when the daemon is unreachable (acceptance criterion). */
export const DOCKER_NOT_RUNNING_MESSAGE =
  "Docker does not appear to be running. Start Docker Desktop and re-run.";

export const DOCKER_NOT_INSTALLED_MESSAGE =
  "Docker CLI not found on PATH. Install Docker Desktop (https://docs.docker.com/get-docker/) and re-run.";

export type DockerStatus =
  | { ok: true; serverVersion: string }
  | { ok: false; reason: "not-installed" | "not-running"; message: string };

/** Probes the Docker CLI and daemon (`docker info`). Never throws. */
export async function dockerStatus(): Promise<DockerStatus> {
  if (Bun.which("docker") === null) {
    return { ok: false, reason: "not-installed", message: DOCKER_NOT_INSTALLED_MESSAGE };
  }
  const result = await $`docker info --format {{.ServerVersion}}`.cwd(ROOT).quiet().nothrow();
  if (result.exitCode !== 0) {
    return { ok: false, reason: "not-running", message: DOCKER_NOT_RUNNING_MESSAGE };
  }
  return { ok: true, serverVersion: result.stdout.toString().trim() };
}

/** Throws a `UserFacingError` (plain sentence, exit 1) when Docker is not usable. */
export async function ensureDocker(): Promise<void> {
  const status = await dockerStatus();
  if (!status.ok) throw new UserFacingError(status.message);
}

/** `docker compose up -d --wait postgres` -- idempotent; waits for the healthcheck. */
export async function composeUp(): Promise<void> {
  await $`docker compose up -d --wait --wait-timeout 90 ${COMPOSE_SERVICE}`.cwd(ROOT);
}

/** `docker compose down` (data kept) or `down -v` (volume removed -> init scripts re-run). */
export async function composeDown(options: { volumes?: boolean } = {}): Promise<void> {
  if (options.volumes) {
    await $`docker compose down -v --remove-orphans`.cwd(ROOT);
  } else {
    await $`docker compose down --remove-orphans`.cwd(ROOT);
  }
}

export interface ComposeServiceInfo {
  name: string;
  state: string;
  health: string;
  /** Host ports published for the container's 5432. */
  publishedPorts: number[];
}

interface ComposePsRow {
  Name?: string;
  Service?: string;
  State?: string;
  Health?: string;
  Publishers?: { PublishedPort?: number; TargetPort?: number }[] | null;
}

/**
 * State of the `postgres` service from `docker compose ps --format json`, or `null` when no
 * container exists. Handles both output shapes compose has used (JSON lines and a JSON array).
 */
export async function composeServiceInfo(): Promise<ComposeServiceInfo | null> {
  const result = await $`docker compose ps --all --format json ${COMPOSE_SERVICE}`
    .cwd(ROOT)
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) return null;
  const text = result.stdout.toString().trim();
  if (text === "") return null;
  let rows: ComposePsRow[];
  try {
    const parsed: unknown = text.startsWith("[")
      ? JSON.parse(text)
      : text.split("\n").map((line) => JSON.parse(line));
    rows = Array.isArray(parsed) ? (parsed as ComposePsRow[]) : [parsed as ComposePsRow];
  } catch {
    return null;
  }
  const row = rows.find((r) => r.Service === COMPOSE_SERVICE) ?? rows[0];
  if (!row) return null;
  const publishedPorts = (row.Publishers ?? [])
    .filter((p) => p.TargetPort === 5432 && typeof p.PublishedPort === "number")
    .map((p) => p.PublishedPort as number);
  return {
    name: row.Name ?? COMPOSE_SERVICE,
    state: row.State ?? "unknown",
    health: row.Health ?? "",
    publishedPorts: [...new Set(publishedPorts)].sort(),
  };
}

/** Polls the compose healthcheck until `healthy`; throws a readable error on timeout. */
export async function waitForHealthy(
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ComposeServiceInfo> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let last: ComposeServiceInfo | null = null;
  while (Date.now() < deadline) {
    last = await composeServiceInfo();
    if (last?.health === "healthy") return last;
    if (last && last.state !== "running" && last.state !== "created") break;
    await Bun.sleep(intervalMs);
  }
  const seen = last ? `state=${last.state} health=${last.health || "none"}` : "no container";
  throw new UserFacingError(
    `Postgres did not become healthy (${seen}). Look at the logs with \`bun run db:logs\`; a stale volume can be wiped with \`bun run db:reset\`.`,
  );
}

/** Runs `psql` inside the container (`-tA`: tuples only, unaligned). Returns trimmed stdout. */
export async function composePsql(database: string, sql: string): Promise<string> {
  const result =
    await $`docker compose exec -T ${COMPOSE_SERVICE} psql -U postgres -d ${database} -v ON_ERROR_STOP=1 -tAc ${sql}`
      .cwd(ROOT)
      .quiet()
      .nothrow();
  if (result.exitCode !== 0) {
    throw new UserFacingError(
      `psql failed inside the postgres container: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString().trim();
}

/** Starts compose (if Docker is up) and waits for health, logging each step. */
export async function startPostgres(): Promise<ComposeServiceInfo> {
  await ensureDocker();
  log.info("docker compose up -d --wait postgres");
  await composeUp();
  const info = await waitForHealthy();
  log.ok(
    `postgres is healthy (container ${info.name}, host port ${info.publishedPorts.join(", ") || "?"})`,
  );
  return info;
}

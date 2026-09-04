/**
 * Railway infrastructure-as-code for the `teaching-journey` project (TEACH-38, ADR 0010).
 *
 * This file is the source of truth for the Railway project: the `postgres` image service and its
 * volume, and the `api` / `worker` services built from the root `Dockerfile` (builder, watch
 * patterns, start / pre-deploy commands, health check, restart policy, draining / overlap,
 * region). Runbook and the settings table: infra/README.md "Config-as-code".
 *
 *   railway config plan    # read-only diff against the linked environment (production)
 *   railway config apply   # push the diff (infra/railway/provision.sh step 3 runs this)
 *
 * Railway evaluates this file only through the CLI (`plan` / `apply`); it is NOT read from the
 * repository at build or deploy time. "Omit means delete": every service, volume and VARIABLE of
 * the environment must be listed here or `apply` removes it. Variable NAMES come from
 * infra/env.contract.ts and are rendered as `preserve()` (keep whatever value Railway has, no-op
 * when the variable is not set), so values keep living in Railway and are seeded / rotated by
 * `provision.sh` and `railway variable set` — never here. A variable on Railway that is not in
 * the contract shows up in `plan` as a destructive delete, which is the intended drift check.
 *
 * Needs `railway` (npm, root devDependency) and Node >= 22.6 for the CLI's TypeScript runner.
 */
import {
  type DeployConfig,
  defineRailway,
  github,
  image,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";
import { railwayNames } from "../infra/env.contract.ts";

const REGION = "europe-west4-drams3a"; // EU-West (Amsterdam), ADR 0010 / 0016

/** Watch patterns shared by api and worker: the image inputs (`.dockerignore` is the allow-list). */
const IMAGE_WATCH = [
  "Dockerfile",
  ".dockerignore",
  "infra/docker/**",
  ".railway/**",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "turbo.json",
  "packages/db/**",
  "packages/domain/**",
  "packages/jobs/**",
  "packages/config/**",
];

/**
 * Pre-deploy (migration) timeout. The CLI engine and `railway config pull` know the field, but the
 * `railway` SDK types (3.11.0) do not list it yet -- drop the cast once `DeployConfig` has it.
 */
const PRE_DEPLOY_TIMEOUT = { preDeployTimeoutSeconds: 600 } as DeployConfig & {
  preDeployTimeoutSeconds: number;
};

/**
 * Every contract variable the service carries on Railway production (PR environments are copies
 * of it), value left to Railway (see the header).
 */
function contractEnv(svc: "api" | "worker") {
  return Object.fromEntries(railwayNames(svc, "production").map((name) => [name, preserve()]));
}

export default defineRailway(() => {
  const repo = github("OmerBresinski/ai-teacher", { branch: "master", checkSuites: false });

  // Postgres 16 + pgvector as a plain image (Railway's managed Postgres lacks pgvector, see
  // infra/README.md "Why not Railway's managed Postgres"). Variables were set once at creation.
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: REGION,
    sizeMB: 5000,
  });
  const postgres = service("postgres", {
    source: image("pgvector/pgvector:pg16"),
    replicas: { [REGION]: 1 },
    deploy: { restartPolicyType: "ALWAYS" },
    volumeMounts: { "/var/lib/postgresql/data": postgresVolume },
    env: {
      PGDATA: preserve(),
      POSTGRES_DB: preserve(),
      POSTGRES_PASSWORD: preserve(),
      POSTGRES_USER: preserve(),
    },
  });

  // Railway's start command replaces the image ENTRYPOINT, hence the full /app/entrypoint.sh path.
  const worker = service("worker", {
    source: repo,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: [...IMAGE_WATCH, "apps/worker/**"],
    },
    start: "/app/entrypoint.sh worker",
    healthcheck: "/health", // on PORT (3002); no public domain
    healthcheckTimeout: 300,
    replicas: { [REGION]: 1 },
    deploy: {
      restartPolicyMaxRetries: 5, // restart policy ON_FAILURE = Railway's default (stored as null)
      drainingSeconds: 30, // SIGTERM, then SIGKILL; the worker drains jobs for <= 25 s
    },
    env: contractEnv("worker"),
  });

  const api = service("api", {
    source: repo,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: [...IMAGE_WATCH, "apps/api/**"],
    },
    start: "/app/entrypoint.sh api",
    preDeploy: "/app/entrypoint.sh migrate", // migrations never run on boot (ADR 0006)
    healthcheck: "/health",
    healthcheckTimeout: 300,
    replicas: { [REGION]: 1 },
    deploy: {
      ...PRE_DEPLOY_TIMEOUT,
      restartPolicyMaxRetries: 5, // restart policy ON_FAILURE = Railway's default (stored as null)
      drainingSeconds: 30,
      overlapSeconds: 10, // the old api keeps serving while the new one warms up
    },
    env: contractEnv("api"),
  });

  // The api's generated `*.up.railway.app` domain is Railway-managed and intentionally not here;
  // custom domains (`api.<domain>`, TODO(domain)) would go in `domains: [...]`.
  return project("teaching-journey", {
    resources: [postgres, postgresVolume, api, worker],
  });
});

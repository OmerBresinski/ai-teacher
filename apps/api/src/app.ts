/**
 * `createApp({ env, db })` — builds the Hono application with no `serve` side effects, so tests
 * call `app.request()` and `src/index.ts` hands `app.fetch` to `Bun.serve`.
 *
 * Middleware order: request-id → logger → CORS → secureHeaders → CSRF guard → session guard →
 * routes → onError / notFound.
 * The router type is exported as `AppType` and consumed by `@tj/api-client` (`hc<AppType>()`).
 */

import type { CreatedAi } from "@tj/ai";
import type { DbHandle } from "@tj/db";
import type { ReadableStorageAdapter } from "@tj/domain";
import type { JobsContext } from "@tj/jobs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { Auth } from "./auth/auth";
import { requireSession } from "./auth/require-session";
import type { AppEnv } from "./context";
import { rejectCrossSiteRequests } from "./csrf";
import type { Env } from "./env";
import { classifyError, envelope } from "./errors";
import { createEventsRuntime, type EventsRuntime } from "./events/runtime";
import { createLogger, type Logger } from "./logger";
import type { CaptureMailSender } from "./mail";
import { createOriginMatcher } from "./origins";
import {
  createRateLimiter,
  loadRateLimitConfig,
  type RateLimitConfig,
  rateLimitByWorkspace,
} from "./rate-limit";
import { eventRoutes } from "./routes/events";
import { fileRoutes } from "./routes/files";
import { healthRoutes } from "./routes/health";
import { helloRoutes } from "./routes/hello";
import { jobRoutes } from "./routes/jobs";
import { meRoutes } from "./routes/me";
import { testRoutes, testRoutesEnabled } from "./routes/test-routes";

export interface CreateAppOptions {
  env: Pick<Env, "NODE_ENV" | "LOG_LEVEL" | "MAIL_PROVIDER" | "WEB_ORIGIN"> &
    Partial<
      Pick<Env, "ALLOW_WORKSPACE_HEADER_SHIM" | "ENABLE_TEST_ROUTES" | "WEB_ORIGIN_PATTERNS">
    >;
  /** Only `sql` is used today (`/health`); routes will take `unsafeDb` through `forWorkspace()`. */
  db: Pick<DbHandle, "sql">;
  /** Inject a logger (tests pass a silent one). Defaults to `createLogger(env)`. */
  logger?: Logger;
  /**
   * better-auth instance (`createAuth()`, TEACH-20). When omitted, `/auth/*` is not mounted and
   * every protected path answers 401 — fine for unit tests that only touch public routes.
   */
  auth?: Auth;
  /** pg-boss context for `/jobs/*` (TEACH-19). Absent → those routes answer 503. */
  jobs?: JobsContext;
  /** SSE runtime (hub, listener, limits). Defaults to one built from `jobs` without a listener. */
  events?: EventsRuntime;
  /**
   * The capturing mail sender behind `GET /__test/last-magic-link` (TEACH-22). Mounted only when
   * `testRoutesEnabled(env)` — `NODE_ENV=test` and `ENABLE_TEST_ROUTES=1` — regardless of whether
   * a sender is passed, so a stray option can never expose the route.
   */
  testMail?: CaptureMailSender;
  /**
   * Object storage behind `GET /files/:key` (ADR 0011 amendment). `src/index.ts` passes
   * `createStorage(process.env).adapter` (local disk unless `BLOB_READ_WRITE_TOKEN` is set).
   * Absent → the route answers 503.
   */
  storage?: ReadableStorageAdapter;
  /** AI client selected at boot (ADR 0018); future routes consume it through this seam. */
  ai?: CreatedAi;
  /** Per-Workspace model-call request limit; tests override the default config. */
  rateLimit?: Partial<RateLimitConfig>;
}

function buildApp({
  env,
  db,
  logger: injected,
  auth,
  jobs,
  events,
  testMail,
  storage,
  rateLimit,
}: CreateAppOptions) {
  const logger = injected ?? createLogger(env);
  const allowHeaderShim = env.ALLOW_WORKSPACE_HEADER_SHIM === "1";
  const eventsRuntime = events ?? (jobs ? createEventsRuntime({ jobs, logger }) : undefined);
  const aiLimiter = createRateLimiter(loadRateLimitConfig(process.env, rateLimit));
  const app = new Hono<AppEnv>();

  // 1. request-id: honour an incoming `x-request-id`, otherwise crypto.randomUUID(); echoed back.
  app.use(requestId({ headerName: "x-request-id" }));

  // 2. logger: one line per request (method, path, status, duration_ms, request_id) — no bodies.
  app.use(async (c, next) => {
    const start = performance.now();
    const child = logger.child({ request_id: c.get("requestId") });
    c.set("logger", child);
    await next();
    child.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
      },
      "request",
    );
  });

  // 3. CORS: only the configured web origins (Vercel production + previews in deploys, ADR 0010):
  // exact `WEB_ORIGIN` entries plus `WEB_ORIGIN_PATTERNS` globs for per-deployment preview URLs.
  // Requests from other origins get no CORS headers at all (Hono's `cors()` would still emit
  // `Allow-Credentials`), so the middleware only runs for allowed origins.
  const allowed = createOriginMatcher(env.WEB_ORIGIN, env.WEB_ORIGIN_PATTERNS ?? []);
  const corsMiddleware = cors({
    origin: (origin) => (allowed(origin) ? origin : null),
    credentials: true,
    maxAge: 600,
    allowHeaders: ["Content-Type", "x-request-id", "Last-Event-ID"],
    exposeHeaders: ["x-request-id"],
  });
  app.use(async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin !== undefined && !allowed(origin)) {
      if (c.req.method === "OPTIONS") return c.body(null, 204);
      return next();
    }
    return corsMiddleware(c, next);
  });

  // 4. Security headers.
  app.use(secureHeaders());

  // TEACH-20: better-auth at /auth/* and guards on every protected path prefix.
  if (auth) app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  const csrf = rejectCrossSiteRequests(allowed);
  const guard = requireSession(auth, db, { allowHeaderShim });
  const PROTECTED_PATHS = ["/me", "/me/*", "/jobs/*", "/events", "/files/*"] as const;
  for (const path of PROTECTED_PATHS) {
    app.use(path, csrf);
    app.use(path, guard);
  }
  app.use("/jobs/ai-ping", rateLimitByWorkspace(aiLimiter));

  // 5. Routes — chained so the RPC types survive (ADR 0005).
  const routes = app
    .route("/", healthRoutes(db))
    .route("/", helloRoutes)
    .route("/", meRoutes())
    .route("/", jobRoutes(eventsRuntime))
    .route("/", eventRoutes(eventsRuntime))
    .route("/", fileRoutes(storage));

  // TEACH-22: test-only capture route, outside the RPC contract (`AppType` stays clean).
  if (testMail && testRoutesEnabled(env)) {
    app.route("/", testRoutes(testMail));
    logger.warn("test routes enabled (NODE_ENV=test, ENABLE_TEST_ROUTES=1): GET /__test/*");
  }
  if (allowHeaderShim) {
    logger.warn(
      "workspace header shim enabled (ALLOW_WORKSPACE_HEADER_SHIM=1): x-tj-workspace-id selects any Workspace without a session",
    );
  }
  if (env.NODE_ENV === "production" && env.MAIL_PROVIDER === "console") {
    logger.warn(
      "ALLOW_CONSOLE_MAIL_IN_PRODUCTION=1: magic-link sign-in URLs are printed to this log. Remove the variable once a real MailSender (TEACH-29) is configured.",
    );
  }

  // 6. Errors → envelope. Unknown errors are logged with their stack but never sent to clients.
  app.notFound((c) =>
    c.json(envelope(c, "not_found", "That resource does not exist.", false), 404),
  );
  app.onError((err, c) => {
    const e = classifyError(err);
    const log = c.get("logger") ?? logger;
    if (e.unexpected) log.error({ err, status: e.status }, "unhandled error");
    else log.info({ status: e.status, code: e.code }, "request error");
    return c.json(envelope(c, e.code, e.message, e.retryable, e.fields), e.status);
  });

  return routes;
}

export type AppType = ReturnType<typeof buildApp>;

export function createApp(options: CreateAppOptions): AppType {
  return buildApp(options);
}

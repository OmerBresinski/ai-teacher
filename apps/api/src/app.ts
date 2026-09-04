/**
 * `createApp({ env, db })` — builds the Hono application with no `serve` side effects, so tests
 * call `app.request()` and `src/index.ts` hands `app.fetch` to `Bun.serve`.
 *
 * Middleware order: request-id → logger → CORS → secureHeaders → routes → onError / notFound.
 * The router type is exported as `AppType` and consumed by `@tj/api-client` (`hc<AppType>()`).
 */
import type { DbHandle } from "@tj/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { Auth } from "./auth/auth";
import { requireSession } from "./auth/require-session";
import type { AppEnv } from "./context";
import type { Env } from "./env";
import { classifyError, envelope } from "./errors";
import { createLogger, type Logger } from "./logger";
import { healthRoutes } from "./routes/health";
import { helloRoutes } from "./routes/hello";
import { meRoutes } from "./routes/me";

export interface CreateAppOptions {
  env: Pick<Env, "NODE_ENV" | "LOG_LEVEL" | "WEB_ORIGIN">;
  /** Only `sql` is used today (`/health`); routes will take `unsafeDb` through `forWorkspace()`. */
  db: Pick<DbHandle, "sql">;
  /** Inject a logger (tests pass a silent one). Defaults to `createLogger(env)`. */
  logger?: Logger;
  /**
   * better-auth instance (`createAuth()`, TEACH-20). When omitted, `/auth/*` is not mounted and
   * every protected path answers 401 — fine for unit tests that only touch public routes.
   */
  auth?: Auth;
}

function buildApp({ env, db, logger: injected, auth }: CreateAppOptions) {
  const logger = injected ?? createLogger(env);
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

  // 3. CORS: only the configured web origins (Vercel production + previews in deploys, ADR 0010).
  // Requests from other origins get no CORS headers at all (Hono's `cors()` would still emit
  // `Allow-Credentials`), so the middleware only runs for allowed origins.
  const allowed = new Set(env.WEB_ORIGIN);
  const corsMiddleware = cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    credentials: true,
    maxAge: 600,
    allowHeaders: ["Content-Type", "x-request-id", "Last-Event-ID"],
    exposeHeaders: ["x-request-id"],
  });
  app.use(async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin !== undefined && !allowed.has(origin)) {
      if (c.req.method === "OPTIONS") return c.body(null, 204);
      return next();
    }
    return corsMiddleware(c, next);
  });

  // 4. Security headers.
  app.use(secureHeaders());

  // TEACH-20: better-auth at /auth/* and `requireSession` on every protected path prefix.
  if (auth) app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  const guard = requireSession(auth, db);
  app.use("/me", guard);
  app.use("/jobs/*", guard);
  app.use("/events", guard);

  // 5. Routes — chained so the RPC types survive (ADR 0005).
  const routes = app.route("/", healthRoutes(db)).route("/", helloRoutes).route("/", meRoutes);

  // TEACH-19: mount /jobs and /events here (streamSSE, Last-Event-ID replay — ADR 0012).
  // TEACH-15 follow-up: GET /files/:key proxy over the StorageAdapter (packages/storage).

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

# `@tj/web` — Teaching Journey web app

Vite + React SPA, client-rendered only ([ADR 0004](../../docs/adr/0004-vite-react-tanstack-router.md)).
Routing is **code-based** TanStack Router, server state is TanStack Query, the API is reached
through the typed Hono RPC client from `@tj/api-client` (ADR 0005) and job progress arrives over
SSE (ADR 0012). Deploys to Vercel as a static build (ADR 0010).

```sh
bun run dev          # vite --port 5173 --strictPort   (reads apps/web/.env)
bun run build        # vite build → dist/ (+ dist/.vite/manifest.json for the bundle budget)
bun run preview      # serve dist/ locally
bun run test         # vitest run (jsdom + Testing Library)
bun run typecheck    # tsc --noEmit — includes src/types.test-d.tsx (compile-time contract)
bun run lint         # biome check .
```

## Environment (`src/env.ts`)

Vite exposes only `VITE_*` variables to the bundle. They are parsed with Zod when `src/env.ts`
loads; an invalid value throws a readable `Invalid web environment:` error before anything
renders (ADR 0015). `.env.example` is committed; `bun run setup` copies it to `.env`.

| Variable              | Default       | Notes                                                                              |
| --------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `VITE_API_URL`        | `/api`        | Base URL for the API. Relative in dev (proxied, below). A **production build must use an absolute `http(s)` URL** (checked via `import.meta.env.PROD`). |
| `VITE_APP_ENV`        | `development` | `development` \| `preview` \| `production`                                          |
| `VITE_DEV_API_TARGET` | `http://localhost:3001` | Read by `vite.config.ts` only (never bundled): where the dev proxy forwards `/api/*`. |

## Dev proxy decision

In development the browser calls `/api/*` on the Vite origin; `vite.config.ts` proxies that to
the API and **strips the `/api` prefix**, so API routes stay unprefixed (`/api/me` → `GET /me`).
Web and API therefore look same-origin and the better-auth session cookie needs no
`COOKIE_DOMAIN` / `SameSite=None` (ADR 0008). In production there is no proxy: `VITE_API_URL` is
the absolute API origin and the cookie is shared across `app.` / `api.` subdomains (ADR 0010).

SSE goes through the same proxy. The `configure` hook removes `accept-encoding` on proxied
requests so nothing compresses or buffers `text/event-stream`; this was verified live
(`curl -N http://localhost:5173/api/jobs/<id>/events` receives events as the worker emits them).

Two consumers need an **absolute** base URL even in dev and resolve `/api` against
`window.location.origin` via `src/lib/base-url.ts`: better-auth's client (`src/lib/auth.ts`, it
rejects relative `baseURL`s) — `hc()` and `EventSource` accept relative URLs as-is.

## Routing (code-based, ADR 0004)

No `@tanstack/router-plugin`, no `createFileRoute`, no generated `routeTree.gen.ts`. Layout:

```
src/router.ts                 assembles routeTree + createRouter + Register augmentation (only here)
src/routes/root.route.ts      createRootRouteWithContext<{ queryClient }>() — error/notFound components
src/routes/root.layout.tsx    QueryClientProvider + ThemeProvider + <Outlet/> + DEV-only lazy devtools
src/routes/<name>.route.ts    createRoute(...) — path, validateSearch (Zod), beforeLoad/loader
src/routes/<name>.page.tsx    the component, loaded with lazyRouteComponent (own chunk)
```

Route tree today:

```
__root__
├── /sign-in                 search { redirect?: string }         sign-in.route.ts
└── (auth)  id: "auth"       beforeLoad: ensureQueryData(me) or redirect → /sign-in?redirect=…
    ├── /                    hello: email, workspace, sign out      index.route.ts
    └── /dev/jobs            search { jobId?: string } — dev aid   dev-jobs.route.ts
```

### Adding a route

1. `src/routes/thing.route.ts`:
   ```ts
   export const thingRoute = createRoute({
     getParentRoute: () => authLayoutRoute,           // or rootRoute for public pages
     path: "/things/$id",
     validateSearch: z.object({ tab: z.string().optional() }),
     loader: ({ context, params }) => context.queryClient.ensureQueryData(thingQueryOptions(params.id)),
     component: lazyRouteComponent(() => import("./thing.page"), "ThingPage"),
   });
   ```
2. `src/routes/thing.page.tsx` exporting `ThingPage`. Read params/search with
   `getRouteApi("<route id>")` — the id of a child of the pathless `auth` layout is prefixed
   (`"/auth/things/$id"`), not the URL path.
3. Register it in `src/router.ts` (`authLayoutRoute.addChildren([...])`). `<Link to>` and
   `navigate()` are type-checked against the tree; `src/types.test-d.tsx` guards that.

## Server state (`src/lib/query.ts`)

- `queryClient`: `staleTime` 30 s, `retry` 1, `throwOnError` false.
- `queryKeys = { me: ["me"], job: (id) => ["job", id] }` — the only place keys are spelled out.
- `meQueryOptions` (`queryOptions()`): calls `api.me.$get()`; **401 resolves to `null`** so the
  `auth` layout's `beforeLoad` can redirect instead of erroring; any other non-2xx throws
  `ApiError` carrying the envelope's `message` / `code` / `retryable` / `requestId`.
- `apiErrorFromResponse(res)` turns any non-ok RPC response into an `ApiError`; mutations use it.
- `SuccessBody<typeof api.x.$get>` extracts the success JSON type (the api types its error
  envelope with the whole status union, so Hono's `InferResponseType<…, 200>` alone cannot).

Errors: `RouteErrorPage` renders `ApiError.message` (a plain sentence, F18-R12) or a generic one,
plus **Retry** (`router.invalidate()`). Never codes or stacks. `NotFoundPage` links home.

## SSE hook (`src/hooks/use-job-events.ts`)

`useJobEvents(jobId)` opens `new EventSource(jobEventsUrl(env.VITE_API_URL, jobId),
{ withCredentials: true })`, listens to every event type in `JobEventSchema` (the api sets
`event: <type>`), validates each payload with `JobEventSchema.safeParse` (unknown → `console.warn`
and ignore), derives `percent` (latest `progress.percent`, `100` on `completed`) and **closes the
stream on the first terminal event** (`completed` | `failed` | `cancelled`) and on unmount. Because
the api replays from `Last-Event-ID` (or everything without it), reloading `/dev/jobs?jobId=…`
reconnects and re-renders the full history. Tests use `src/test/fake-event-source.ts`.

## Dev routes

`/dev/jobs` is a development aid for the ADR 0012 demo (`POST /jobs/ping` → worker → SSE →
`<progress>` + event list + Cancel). It is behind the auth layout and clearly labelled; it is not a
product screen and will move/disappear when the activity tray lands (F18-R04).

## Theme before first paint

`index.html` carries a `<!--theme-init-->` marker; the `tj:theme-init` Vite plugin in
`vite.config.ts` replaces it with `<script>${THEME_INIT_SCRIPT}</script>` from `@tj/ui` in both
`vite dev` and `vite build`, so a stored theme applies before the stylesheet loads and the string
cannot drift from `ThemeProvider`. The import is a *relative* path into `packages/ui/src` because
Vite externalises bare specifiers in config files and Node cannot run `@tj/ui`'s extension-less
TS imports (follow-up: give `@tj/ui` an importable `theme-init` entry).

## Bundle budget (F18-R05)

`vite build` writes `dist/.vite/manifest.json`; from the root, `bun run check:bundle-budget`
sums the entry chunk + static imports + CSS (gzip) and fails above 250 KB (warns at 200 KB). CI runs
it on every PR. Current initial load ≈ 134 KB gz. Keep it down by:

- route pages via `lazyRouteComponent` (own chunks — see `sign-in.page`, `index.page`,
  `dev-jobs.page`); shared page-only deps (better-auth client) land in a lazy shared chunk;
- devtools only through `import.meta.env.DEV` dynamic imports (`root.layout.tsx`);
- Vite 8 bundles with **Rolldown**: `output.manualChunks` is deprecated, so React is pinned to its
  own chunk with `build.rollupOptions.output.codeSplitting.groups`.

## Testing

Full guide: [`docs/testing.md`](../../docs/testing.md).

**Unit (Vitest):** `bun run test` → `vitest run` with the shared preset
`@tj/config/vitest/react` (jsdom, jest-dom, `cleanup()`, `css: true`, v8 coverage;
`vitest.config.ts` only adds `VITE_API_URL=/api`). Files: `src/**/*.test.{ts,tsx}` — nothing
else. Covered: env parsing, `meQueryOptions` (200 / 401 → `null` / envelope → `ApiError`), the
sign-in form (trim + lowercase, callback URL, error state), `useJobEvents` with a fake
`EventSource` (`src/test/fake-event-source.ts`), and `src/types.test-d.tsx` for compile-time
contracts (checked by `tsc`, not run).

**End-to-end (Playwright + axe):** `bun run test:e2e` (root, via turbo after `build`) or
`bunx playwright test` here. `playwright.config.ts` starts the api (`NODE_ENV=test`,
`ENABLE_TEST_ROUTES=1`), the worker and a `vite preview` of an e2e build (`dist/e2e`, with
`VITE_API_URL=http://localhost:3811` baked in) against `TEST_DATABASE_URL`, on 3811/3822/4193.
`e2e/fixtures.ts` provides `signedInPage` (magic link read back from the api's test-only
`GET /__test/last-magic-link`). Specs: `e2e/auth.spec.ts`, `e2e/jobs.spec.ts` (including the
reload-mid-run replay proof), `e2e/a11y.spec.ts` (zero serious/critical axe violations on
`/sign-in`, `/`, `/dev/jobs`). Files: `e2e/**/*.spec.ts` — never `*.test.*`.

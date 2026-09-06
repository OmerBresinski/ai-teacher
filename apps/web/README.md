# `@tj/web` — Teaching Journey web app

Vite + React SPA, client-rendered only ([ADR 0004](../../docs/adr/0004-vite-react-tanstack-router.md)).
Routing is **code-based** TanStack Router, server state is TanStack Query, the API is reached
through the typed Hono RPC client from `@tj/api-client` (ADR 0005) and job progress arrives over
SSE (ADR 0012). Deploys to Vercel as a static build (ADR 0010).

```sh
bun run dev          # vite --port 5173 --strictPort   (reads apps/web/.env)
bun run build        # vite build → dist/ (+ dist/.vite/manifest.json for the bundle budget)
bun run preview      # serve dist/ locally
bun run test         # bun test (happy-dom + Testing Library, src/**/*.test.{ts,tsx})
bun run typecheck    # tsc --noEmit — includes src/types.test-d.tsx (compile-time contract)
bun run lint         # biome check .
```

## Environment (`src/env.ts`)

Vite exposes only `VITE_*` variables to the bundle. They are parsed with Zod when `src/env.ts`
loads; an invalid value throws a readable `Invalid web environment:` error before anything
renders (ADR 0015). `bun run setup` copies the generated `.env.example` to `.env`.

`VITE_API_URL` (`/api` in dev, an absolute `http(s)` URL in a production build — checked via
`import.meta.env.PROD`), `VITE_APP_ENV`, `VITE_DEV_API_TARGET` (read by `vite.config.ts` only) and
the Vercel-only `RAILWAY_PR_API_URL_TEMPLATE` / `VITE_API_URL_FALLBACK` are declared in the env
contract — [`docs/env.md`](../../docs/env.md). `src/env.contract.test.ts` keeps `EnvSchema` and the
contract in step.

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
src/router.tsx                assembles routeTree + createRouter + Wrap (providers) + Register augmentation
src/routes/root.route.ts      createRootRouteWithContext<{ queryClient }>() — error/notFound components
src/routes/root.layout.tsx    <Outlet/> + DEV-only lazy devtools
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
3. Register it in `src/router.tsx` (`authLayoutRoute.addChildren([...])`). `<Link to>` and
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
it on every PR. Keep it down by:

- route pages via `lazyRouteComponent` (own chunks — see `sign-in.page`, `index.page`,
  `dev-jobs.page`); shared page-only deps (better-auth client) land in a lazy shared chunk;
- devtools only through `import.meta.env.DEV` dynamic imports (`root.layout.tsx`);
- Vite 8 bundles with **Rolldown**: `output.manualChunks` is deprecated, so React is pinned to its
  own chunk with `build.rollupOptions.output.codeSplitting.groups`.

Recorded initial load, so drift is visible in review (update the row when a PR moves it by more
than 2 KB):

| Date | Initial load (gz) | After |
| --- | --- | --- |
| 2026-09-06 | 176.6 KB | library shell, cards, dialogs, series detail (TEACH-89 → 94) |

## Deploy (Vercel, ADR 0010)

Static build on Vercel, project **`teaching-journey-web`**, Root Directory `apps/web`; pushes to
`master` deploy production, every PR gets a preview. The full runbook (project settings, env
scopes, Railway pairing, dashboard-only checklist, verified preview) is in
[`infra/README.md` → "Vercel (web)"](../../infra/README.md#vercel-web--teach-25). In this app:

| File | Role |
| ---- | ---- |
| `vercel.json` | `framework: vite`; install/build run from the repo root (`bun install --frozen-lockfile --ignore-scripts`, `bun scripts/vercel-env.ts exec bunx turbo run build --filter=@tj/web`); SPA rewrite `/((?!assets/\|_vercel/).*)` → `/index.html`; `Cache-Control` immutable for `/assets/*`, `no-cache` for the shell; `nosniff`, `DENY`, referrer/permissions policies; `Content-Security-Policy-Report-Only` allowing the inline theme script **by hash** and `connect-src 'self' https:` (static file → API origin cannot be templated). `src/vercel-config.test.ts` guards all of it and prints the new hash if `THEME_INIT_SCRIPT` changes. |
| `scripts/vercel-ignore-build.sh` | Ignored Build Step: exit 0 (skip) unless `apps/web`, `packages/{ui,api-client,domain,config}`, `bun.lock`, `turbo.json`, root `package.json`/`bunfig.toml` changed since `VERCEL_GIT_PREVIOUS_SHA`. |
| `../../scripts/vercel-env.ts` | Resolves `VITE_APP_ENV` / `VITE_API_URL` at build time: production → the Production `VITE_API_URL`; preview → `RAILWAY_PR_API_URL_TEMPLATE` (`{pr}` = PR number) or `VITE_API_URL_FALLBACK`. Pure function, `bun test scripts/`. |
| `src/lib/speed-insights.ts` | `@vercel/speed-insights` via dynamic import behind `import.meta.env.VITE_APP_ENV === "production"` (a literal Vite inlines, so preview/dev `dist/` contain none of it — checked on the live preview). Reports the matched route pattern, never the pathname. |

Env values per scope live in Vercel, not in git (`bun run env:check` verifies the names;
`docs/env.md`). Production `VITE_API_URL` is the live Railway api
`https://api-production-903f.up.railway.app` (`TODO(domain)`: `https://api.<domain>` later);
previews use `RAILWAY_PR_API_URL_TEMPLATE=https://api-ai-teacher-pr-{pr}.up.railway.app`. The API
side (`COOKIE_SAMESITE=none` — currently also in production, since web and api share no parent
domain — and `WEB_ORIGIN_PATTERNS`) is described in `apps/api/README.md` "Cookie strategy".

Manual deploys go from the **repository root** (`vercel link --yes --project teaching-journey-web`,
then `vercel deploy --yes --target=preview`); `.vercel/` and `.env.local` are gitignored.

## Testing

Full guide: [`docs/testing.md`](../../docs/testing.md).

**Unit (`bun test`):** `bun run test` → `bun test` with the preloads listed in `bunfig.toml`:
`@tj/config/bun-test/dom` (happy-dom globals), `@tj/config/bun-test/setup` (jest-dom matchers,
`cleanup()`) and `./bun-test.setup.ts` (pins `VITE_API_URL=/api`, `VITE_APP_ENV=development` for
`src/env.ts` — under Bun `import.meta.env` is `process.env`). `root = "src"` keeps Bun away from
`e2e/`. Coverage (`coverage/lcov.info`) is written when `CI=true`. Files: `src/**/*.test.{ts,tsx}`
— nothing else. Covered: env parsing, `meQueryOptions` (200 / 401 → `null` / envelope → `ApiError`), the
sign-in form (trim + lowercase, callback URL, error state), `useJobEvents` with a fake
`EventSource` (`src/test/fake-event-source.ts`), and `src/types.test-d.tsx` for compile-time
contracts (checked by `tsc`, not run).

**End-to-end (Playwright + axe):** `bun run test:e2e` (root, via turbo after `build`) or
`bun --bun playwright test` here (Playwright's CLI runs on Bun; no Node). `playwright.config.ts` starts the api (`NODE_ENV=test`,
`ENABLE_TEST_ROUTES=1`), the worker and a `vite preview` of an e2e build (`dist/e2e`, with
`VITE_API_URL=http://localhost:3811` baked in) against `TEST_DATABASE_URL`, on 3811/3822/4193.
`e2e/fixtures.ts` provides `signedInPage` (magic link read back from the api's test-only
`GET /__test/last-magic-link`). Specs: `e2e/auth.spec.ts`, `e2e/jobs.spec.ts` (including the
reload-mid-run replay proof), `e2e/a11y.spec.ts` (zero serious/critical axe violations on
`/sign-in`, `/`, `/dev/jobs`). Files: `e2e/**/*.spec.ts` — never `*.test.*`.

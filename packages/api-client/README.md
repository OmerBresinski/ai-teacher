# `@tj/api-client` — typed Hono RPC client for `@tj/api`

Consumed by `apps/web` (and any Bun script) to call the API with end-to-end types and no code
generation (ADR 0005).

```ts
import { createApiClient, jobEventsUrl } from "@tj/api-client";

const api = createApiClient(import.meta.env.VITE_API_URL); // e.g. http://localhost:3001

const res = await api.hello.$get({ query: { name: "Ada" } });
if (res.ok) {
  const { message } = await res.json(); // { message: string }
}

const health = await api.health.$get(); // 200 { ok: true, db: "up" } | 503 envelope

new EventSource(jobEventsUrl(baseUrl, jobId), { withCredentials: true }); // TEACH-19
```

## Exports

| Export                              | Purpose                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `createApiClient(baseUrl, init?)`   | `hc<AppType>(baseUrl, { init: { credentials: "include", ...init } })` — cookies are sent by default (session shared across `app.` / `api.` subdomains, ADR 0010) |
| `type ApiClient`                    | `ReturnType<typeof createApiClient>`                                          |
| `type AppType`                      | the router type of `@tj/api` (re-export)                                     |
| `jobEventsUrl(baseUrl, jobId)`      | `${baseUrl}/jobs/${jobId}/events` — SSE per job (TEACH-19, ADR 0012)         |
| `workspaceEventsUrl(baseUrl)`       | `${baseUrl}/events` — SSE per Workspace (TEACH-19)                           |

Response types: `InferResponseType<typeof api.hello.$get, 200>` from `hono/client`.

## How the types get here (type-only import)

`apps/api/package.json` exposes `"./app": "./src/app.ts"` and this package depends on
`"@tj/api": "workspace:*"`. `src/index.ts` does

```ts
import type { AppType } from "@tj/api/app";
```

`import type` is erased at compile time, so **no server code, `pino`, `postgres` or Bun API is ever
bundled** into a browser consumer; the dependency exists only so `tsc`, Vite and Bun can resolve the
type from source (see the root README, "Internal packages are consumed from source"). Never add a
runtime import from `@tj/api` here.

The tsconfig extends `@tj/config/tsconfig/base.json` with `lib: ["ESNext", "DOM"]` and `types: []`
so the public types are checked against a browser-compatible environment. Runtime tests
(`*.test.ts`, `bun test`) are excluded from `tsc` because they use `bun:test`.

## Compile-time contract test

`src/types.test-d.ts` is type-checked by `tsc --noEmit` (it never runs). It asserts that known
routes infer and that `client.nope` and `client.hello.$get({ query: { name: 1 } })` are type
errors. If a router stops being chained in `apps/api`, this file fails `typecheck`.

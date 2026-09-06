# AGENTS.md — `apps/web` (`@tj/web`)

Vite + React SPA. Client-rendered only; the API is a separate service (`apps/api`, ADR 0005).
Read the root [`AGENTS.md`](../../AGENTS.md) first. Scaffolded by TEACH-21.

## Skills to load (in `./.agents/skills/`)

| Skill | Load when… |
| ----- | ---------- |
| `tanstack-router` | routes, loaders, search params, navigation, code splitting |
| `tanstack-query` | queries, mutations, cache keys, invalidation, prefetch in loaders |
| `shadcn` | composing UI from `@tj/ui`; understanding shadcn component APIs |
| `vercel-react-best-practices` | writing or reviewing React for performance/bundle size |
| `deploy-to-vercel` | Vercel project, preview deployments, environment variables |

## Constraints that override the skills

- **ADR 0004 — code-based TanStack Router routes.** Routes are TypeScript objects built with
  `createRootRouteWithContext` / `createRoute`, colocated under `src/routes/` (one file per route
  group) and assembled into `routeTree` in `src/router.tsx`. **Do NOT install
  `@tanstack/router-plugin` / `@tanstack/router-cli`, do NOT use file-based routing, and ignore the
  skill's "use file-based routing" recommendation.** Use `lazyRouteComponent` for route-level
  splitting. Route loaders prefetch through the TanStack Query client passed in router context.
- **ADR 0009 — consume `@tj/ui`.** Import components from `@tj/ui`; **never run `shadcn add` in
  this app** or copy component source here. Missing component → add it in `packages/ui` (see
  `packages/ui/AGENTS.md`). Theming is `data-theme` on `<html>`.
- **Bundle budget: 250 KB gzipped initial bundle (F18-R05)**, enforced in CI (TEACH-23). Check
  `vite build` output before adding dependencies; prefer route-level lazy loading.
- ADR 0012: generation progress arrives over SSE (`EventSource`); on events, update the activity
  tray store and invalidate the relevant TanStack Query keys. Client → server actions are normal
  HTTP requests through the typed `@tj/api-client` (`hc<AppType>`), never `fetch` by hand.
- ADR 0010: deploys to Vercel as a static build with an SPA rewrite (`/* -> /index.html`); the API
  origin comes from an env var validated in `src/env.ts` (Zod, ADR 0015). No server code here.
- Library data comes from `src/mocks` via `src/lib/library.ts` (ADR 0020); screens never import the
  store directly.
- `vercel-react-best-practices` includes Next.js-specific advice (RSC, `next/*`); it does not
  apply — this is a Vite SPA.
- Tests: `bun test` + React Testing Library + happy-dom; Playwright + axe in `e2e/` (ADR 0014). Biome
  `a11y` rules are errors.
- Client storage keys: `tj:sidebar-collapsed`, `tj:library:sort`, `tj:library:view`, and
  `tj:last-shell` are the stable browser preference/session contracts for the library shell.

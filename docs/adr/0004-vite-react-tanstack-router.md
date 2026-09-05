# 0004 — Vite + React SPA with TanStack Router (code-based routes)

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F18-D6 (front-end stack), F18-R05 (performance budgets), F18-D1 (web app)

## Context

F18-D6 asks for a mainstream React stack with a server-driven data layer and accessible primitives. The shell must load routes in under 1 s (p75), keep the initial bundle under 250 KB gzipped, and be keyboard-first. Next.js and TanStack Start were considered; both couple the frontend to a server runtime and complicate the bundle budget. The founder explicitly does not want Next.js.

## Decision

`apps/web` is a client-rendered React SPA built with Vite. Routing uses TanStack Router with **code-based route definitions** (a `routeTree` built in TypeScript), not file-based routing. Server state uses TanStack Query; route loaders prefetch through the Query client. The API is a separate service (ADR 0005); the web app never contains server code.

## Consequences

- Simple static deploy (ADR 0010); bundle budget is fully under our control; route-level code splitting via `lazyRouteComponent`.
- No SSR: first paint depends on the bundle; the 250 KB budget is enforced in CI to protect the <1 s target.
- Code-based routing means the route tree is explicit and type-safe but must be maintained by hand; keep route definitions colocated under `apps/web/src/routes/` with one file per route group and assemble them in `router.tsx`.
- PWA/offline (F18-R06) is not part of the scaffold; see ADR 0016.

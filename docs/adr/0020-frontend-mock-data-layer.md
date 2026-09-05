# 0020 — Library screens run on an in-memory mock data layer behind TanStack Query

- Status: Accepted
- Date: 2026-09-05
- Related PRD decisions: ADR 0004, ADR 0005, TD project item 1 (tie-in contract)

## Context

The shell and library are being ported before an API exists for Lessons, Worksheets, or Series. The
document shape is fixed only by the TeachDeck tie-in contract. TeachDeck's prototype persists data
with IndexedDB through `idb-keyval`, zustand, and zundo, but that persistence would be temporary
in the web app.

## Decision

`apps/web/src/mocks/` contains Zod-validated fixture data and an in-memory store with small fake
latency. Screens access the store only through TanStack Query `queryOptions` and mutations in
`apps/web/src/lib/`, following the query-key conventions already established in `lib/query.ts`.

The data shapes are library summaries local to the web app: id, title, kind, updatedAt, counts,
themeId, and Series membership. `@tj/domain` is not extended until the tie-in contract lands.

There is no IndexedDB, Zustand, or persistence across reloads. The mock layer runs in every
environment until an API exists; a reload restores the fixtures. Create, rename, duplicate,
trash/restore, and Series-membership mutations change the in-memory store and invalidate the
relevant query keys. Replacing the mock layer with the real API therefore replaces only the
`queryFn` and `mutationFn` implementations.

## Consequences

- Loading, empty, and error states have real behaviour from the first library screens.
- There is no throwaway persistence to delete.
- Library-summary shapes may drift from the tie-in contract. This risk is accepted because the
  shapes are internal to `apps/web`.

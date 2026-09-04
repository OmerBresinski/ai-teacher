# 0011 — Vercel Blob for object storage

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F03 (Sources), F12 (export files), F15-R02 (deletion destroys originals)

## Context

Uploaded Sources (PDF/DOCX/PPTX) and generated export files need durable object storage. Cloudflare R2 was the initial choice; with Vercel hosting the SPA the founder prefers a single vendor for web and files.

## Decision

Object storage is **Vercel Blob**, accessed from `apps/api` and `apps/worker` through a small `StorageAdapter` interface in `packages/domain` (`put`, `getSignedUrl`, `delete`, `list(prefix)`). A local-disk implementation is used in development and tests. Blob keys are prefixed by `workspace_id` so export/delete-all (F15-R02) can enumerate and destroy a workspace's files.

## Consequences

- Minimal setup; uploads can go browser-to-Blob with server-issued tokens if needed later.
- Vercel Blob's regions are Vercel-controlled; combined with ADR 0010 this widens the residency deviation noted in ADR 0016.
- The adapter boundary keeps a later move to S3/R2 to one package.

## Amendment (2026-09-04)

**Context.** Vercel Blob (`@vercel/blob` 2.8.0) has no true time-limited signed URLs for private
blobs: a private blob is only readable with the read-write token, and a public blob's CDN URL is
permanent. `StorageAdapter.getSignedUrl(key, { expiresInSeconds })` therefore cannot be honoured as
originally written for private objects.

**Decision.** Artefact and Source downloads go through an API proxy, `GET /files/:key` in
`apps/api` (TEACH-15/16 follow-up). The route requires a session (`requireSession`), rejects any
key that is not prefixed by the caller's `workspaceId/` with **404** (never 403, so the existence of
other tenants' objects is not leaked), reads the object through `ReadableStorageAdapter.get(key)`
from `@tj/storage` and streams the body with its stored `content-type`, `content-length` and
`cache-control: private, no-store`. For private objects `getSignedUrl` returns that proxy path
(`/files/<key>`) and `expiresInSeconds` is advisory; the Blob CDN URL is returned **only** for
explicitly public prefixes (`STORAGE_PUBLIC_PREFIXES`) — public assets such as logos, never
teacher content. The local-disk adapter behaves the same way through the same route.

**Consequences.** Every private download is authorised per request and costs one API round-trip
(Railway egress rather than CDN egress). Browser-to-Blob direct downloads remain possible later
for public assets only. `get(key)` is part of `@tj/storage`'s `ReadableStorageAdapter`; lifting it
into `@tj/domain`'s `StorageAdapter` is a follow-up.

## Amendment (2026-09-04, TEACH-37) — store provisioned

**Status.** Implemented in production. The store **`teaching-journey`** (`store_Ii6wcxuuLOvPP4ou`,
team `omerbresinskis-projects`) was created with the Vercel CLI on 2026-09-04 and its read-write
token set on the Railway `api` and `worker` services (`production`; PR environments inherit it).
The api boots with `storage="vercel-blob"`; the local-disk adapter remains the development/test
default. Runbook: `infra/README.md` "Vercel Blob (files)".

**Region.** Vercel Blob offers no Amsterdam region, so the store lives in **`fra1` (Frankfurt)** —
the closest EU region to Railway's `europe-west4` (ADR 0010). Data stays in the EU (ADR 0016); the
"Vercel-controlled regions" concern above is therefore resolved: the region is chosen at creation and
immutable.

**Access.** The store is **private** at the store level (immutable). Vercel rejects `access:
"public"` uploads to a private store (verified), so `STORAGE_PUBLIC_PREFIXES` must stay unset and
every download goes through `GET /files/:key` as decided in the 2026-09-04 amendment above. Public
assets (logos etc.) would need a second, public store or a different host — not a separate access
mode on this store.

**Token placement.** `BLOB_READ_WRITE_TOKEN` lives only on Railway. The CLI connected the store to
the `teaching-journey-web` Vercel project and injected the token into its env; the SPA never reads it,
so it was removed from the Vercel project (the store stays connected, the token stays valid).

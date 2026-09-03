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

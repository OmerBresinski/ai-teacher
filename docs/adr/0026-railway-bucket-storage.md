# 0026 — Railway Bucket (S3-compatible) for object storage

- Status: Accepted (supersedes ADR 0011)
- Date: 2026-09-07
- Related PRD decisions: F03 (Sources), F12 (export files), F15-D5 / F15 §4 #8 (data residency),
  F15-R02 (deletion destroys originals)

## Context

ADR 0011 chose Vercel Blob for object storage because the SPA was on Vercel and the founder
preferred one vendor for web and files. Since then:

1. **Everything else moved to one region on Railway.** Compute (api, worker) and Postgres run in
   Railway `europe-west4` (Amsterdam, ADR 0010). The Blob store had to live in `fra1` because Vercel
   offers no Amsterdam region. Every file read is an api → Vercel round-trip across providers.
2. **Railway now offers Buckets**: S3-compatible object storage created per project
   (`railway bucket create <name> --region ams`), with credentials from
   `railway bucket credentials` (`endpoint`, `accessKeyId`, `secretAccessKey`, `bucketName`).
   The `ams` region is the same metro as the rest of the stack.
3. **Bun ships an S3 client** (`Bun.S3Client`, stable since Bun 1.2; we run 1.3.6): `write`,
   `file().stream()`, `stat`, `delete`, `list`, `presign`, multipart upload through
   `file().writer()`. No SDK is needed, so the move removes `@vercel/blob` and adds nothing.
4. **Vercel Blob has no signed URLs for private objects**, which is why ADR 0011 was amended to
   route every download through `GET /files/:key`. S3 presigning exists, so the interface stops
   promising something the backend cannot do — even though the proxy stays (below).
5. **Nothing has been written yet.** No production code path calls `storage.put`; only
   `apps/api/src/routes/files.test.ts` does. There is no data to migrate.
6. ADR 0016 §1 already named this move as the escape hatch: "move Blob to an S3-compatible store
   with a fixed region behind the existing `StorageAdapter`."

## Decision

1. **Object storage is a Railway Bucket**, `files` (region `ams`), in the `teaching-journey`
   project, declared in `.railway/railway.ts` with the `bucket()` helper next to the services.
   It is consumed only by the Railway `api` and `worker` services. Vercel Blob is retired; the
   `teaching-journey` Blob store is deleted and `BLOB_READ_WRITE_TOKEN` removed everywhere.
2. **`@tj/storage` gains `S3Storage`** (`packages/storage/src/s3.ts`) on `Bun.S3Client`,
   replacing `VercelBlobStorage`. It implements the same `ReadableStorageAdapter` (`put`, `get`,
   `getSignedUrl`, `delete`, `list`) and passes the same `runStorageContract` suite. `@vercel/blob`
   is removed from `packages/storage/package.json`.
3. **Selection by env.** `createStorage(env)` returns `S3Storage` (`kind: "s3"`) when `S3_BUCKET`
   is set (non-blank), otherwise `LocalDiskStorage` (`kind: "local-disk"`). When `S3_BUCKET` is
   set, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are required and a missing
   one throws at boot (ADR 0015 fail-fast). `S3_REGION` is optional and defaults to `auto`, which
   is what Railway reports. The variables are named `S3_*`, **not** `AWS_*`: the api and worker
   already carry `AWS_BEARER_TOKEN_BEDROCK` / `AWS_REGION` for Bedrock (ADR 0018), and the AWS SDK
   credential chain would pick up `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` and try SigV4 with
   the bucket keys against Bedrock.
4. **Every object is private and the download proxy stays.** `getSignedUrl` returns the proxy
   path `/files/<key>` exactly as the 2026-09-04 amendment to ADR 0011 decided, because the
   proxy is where per-request authorisation and the TEACH-78 response hardening (executable
   content types neutralised, `Content-Disposition`, CSP sandbox) live. A presigned bucket URL
   would bypass both. `S3Storage` therefore has **no public mode**: the `publicPrefixes` option
   and the `STORAGE_PUBLIC_PREFIXES` variable are removed rather than carried over unused. Public
   assets (logos, marketing) are static files in `apps/web`, not bucket objects. Presigned URLs
   remain available on the client for a later browser-direct upload path (TEACH-123) and would be
   a new decision.
5. **Path-style addressing.** Railway reports `urlStyle: "virtual-host"`, but virtual-hosted
   requests from `Bun.S3Client` to the bucket endpoint fail with `NoSuchBucket`; path-style
   (`<endpoint>/<bucket>/<key>`) works and is what `S3Storage` uses (`virtualHostedStyle: false`).
6. **Error mapping.** `code === "NoSuchKey"` (and `"NotFound"`) from the client becomes
   `StorageError("not_found")`; anything else is `StorageError("backend")` with `cause`. `delete`
   on a missing key is a no-op on S3 and stays idempotent. `list` follows
   `nextContinuationToken` and applies the package's path-style prefix match on top of the raw S3
   prefix, as the Blob adapter did.

## Consequences

- Files, Postgres and compute share one provider and one metro. ADR 0016 §1's residency statement
  simplifies to "Railway EU-West (Amsterdam)"; the UK deviation remains and its revisit dates do
  not change.
- One dependency (`@vercel/blob`) and one third-party secret (`BLOB_READ_WRITE_TOKEN`) go away;
  four `S3_*` variables (one secret) arrive. Vercel is now static-SPA-only.
- The bucket credentials are one key pair with full read/write on the bucket; rotation is
  `railway bucket credentials --bucket files --reset --yes` followed by re-setting the two secrets
  on api and worker (runbook in `infra/README.md` "Railway Bucket (files)").
- The storage contract test runs against the real bucket when the `S3_*` variables are present
  (locally or in CI) and skips with a reason otherwise, as the Blob run did.
- Bun's client, not an SDK, is now part of the storage surface. `packages/storage` already used
  Bun globals (`Bun.write`, `Bun.file`) and is already kept out of `AppType` for that reason
  (`apps/api/src/routes/files.ts` imports only from `@tj/domain`); nothing new leaks.
- Objects are keyed exactly as before (`<workspaceId>/<segment>/…`), so F15-R02 delete-all
  (`deleteByPrefix`) is unchanged.

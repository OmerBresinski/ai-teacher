# @tj/storage

`StorageAdapter` implementations for Teaching Journey (ADR 0026, superseding ADR 0011). Consumed
from source (`exports["."] → src/index.ts`); depends only on `@tj/domain` and Bun's built-in
`Bun.S3Client`. No framework imports, no `@tj/db`.

```ts
import { createStorage, deleteByPrefix } from "@tj/storage";
import { storageKey } from "@tj/domain";

const { adapter, kind } = createStorage(process.env); // "s3" | "local-disk"
const key = storageKey(workspaceId, "sources", `${sourceId}.pdf`);
await adapter.put(key, request.body, { contentType: "application/pdf" });
const url = await adapter.getSignedUrl(key, { expiresInSeconds: 300 });
for await (const object of adapter.list(workspaceId)) console.log(object.key, object.size);
await deleteByPrefix(adapter, workspaceId); // F15-R02
```

## Adapters

| Class | Used in | Backend |
| ----- | ------- | ------- |
| `LocalDiskStorage(rootDir, { publicBaseUrl? })` | development, tests | directory on disk |
| `S3Storage({ endpoint, bucket, accessKeyId, secretAccessKey, region?, proxyBasePath?, listPageSize? })` | production | S3-compatible bucket via `Bun.S3Client` (the Railway Bucket `files`) |

Both implement `StorageAdapter` from `@tj/domain` (`put`, `getSignedUrl`, `delete`, `list`) plus
`get(key)` (`ReadableStorageAdapter`, also from `@tj/domain`), which the API's `GET /files/:key`
proxy uses to stream bytes server-side (`apps/api/src/routes/files.ts`).

### LocalDiskStorage

- Object at `<rootDir>/<key>`; directories are created on demand.
- `contentType` is stored in a sidecar `<key>.meta.json`. Sidecars are never returned by `list`.
- `put` accepts `Uint8Array` or `ReadableStream<Uint8Array>`; streams are written chunk by chunk
  through a `FileSink`, never buffered whole in memory.
- `getSignedUrl` is **not signed**: it returns `file:///abs/path` or, when `publicBaseUrl` is set,
  `${publicBaseUrl}/${key}` (percent-encoded segments). `expiresInSeconds` is ignored. Throws
  `StorageError("not_found")` when the object is missing.
- `delete` is idempotent and removes object + sidecar.
- `list(prefix)` is recursive and returns `{ key, size, updatedAt }` in sorted order.

### S3Storage

- `Bun.S3Client` with **path-style** requests (`virtualHostedStyle: false`): Railway reports
  `urlStyle: "virtual-host"` but virtual-hosted requests fail with `NoSuchBucket` against its
  endpoint. The object key *is* the storage key; `contentType` is stored as the object's
  `Content-Type` (`type`) and read back from `stat()`.
- `put` writes a `Uint8Array` in one request and a `ReadableStream` through `file(key).writer()`
  (multipart upload; parts go out as chunks arrive).
- **Every object is private; there is no public mode.** `getSignedUrl` never presigns: it returns
  the relative proxy path `${proxyBasePath}/${key}` (default `/files/<key>`, segments
  percent-encoded) after a `stat()` so a missing object throws `not_found`. The API route
  `GET /files/:key` authenticates the caller, checks the key's workspace against the session,
  calls `adapter.get(key)` and streams `body` with `contentType`. That proxy is the only
  sanctioned read path (ADR 0026 §4); `expiresInSeconds` is ignored.
- `get` = `stat()` then `file(key).stream()`, so a missing key fails before the stream is handed out.
- `list` follows every `nextContinuationToken` page and applies path-style prefix matching
  (`<ws>/sources` does not match `<ws>/sources-old/x`).
- `delete` is idempotent (S3 `DeleteObject` on an unknown key succeeds).
- `S3Error` with `code` `NoSuchKey` / `NotFound` → `StorageError("not_found")`; anything else →
  `StorageError("backend")` with the original error on `cause`.

## Environment variables (`createStorage(env)`)

| Variable | Effect |
| -------- | ------ |
| `S3_BUCKET` | When set (non-blank) → `S3Storage`; otherwise local disk. |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Required when `S3_BUCKET` is set; a blank one makes `createStorage` throw (boot fails rather than falling back to ephemeral disk). |
| `S3_REGION` | Optional SigV4 region; default `auto` (what Railway reports). |
| `STORAGE_ROOT` | Local-disk root. Default `.data/storage` (git-ignored). |
| `STORAGE_PUBLIC_BASE_URL` | Local-disk `getSignedUrl` base instead of `file://`. |

The variables are `S3_*`, not `AWS_*`, because the api and worker already carry
`AWS_BEARER_TOKEN_BEDROCK` / `AWS_REGION` for Bedrock (ADR 0018) and the AWS SDK credential chain
would pick up `AWS_ACCESS_KEY_ID`.

## Key rules

Keys are validated with `parseStorageKey` from `@tj/domain` on every call and must be built with
`storageKey(workspaceId, ...parts)`: `<uuid>/<segment>/…`, segments non-empty, no `/`, `\`, `..`,
NUL or `.`. Invalid keys throw the domain `StorageKeyError` before any backend call. `list` and
`deleteByPrefix` accept a bare workspace id or a full key as prefix (trailing `/` tolerated).
`LocalDiskStorage` additionally asserts the resolved path stays under `rootDir`
(`StorageError("invalid_key")` — unreachable for keys that pass domain validation).

## Errors

- `StorageKeyError` (`@tj/domain`) — bad key or prefix.
- `StorageError` (this package) with `code`:
  `"not_found"` (`getSignedUrl`/`get` on a missing object), `"backend"` (fs / S3 API failure,
  original error on `cause`), `"invalid_key"`. Use `isStorageError(err, code?)`.

## deleteByPrefix (F15-R02)

`deleteByPrefix(adapter, prefix, { concurrency? })` lists lazily and deletes with at most
`concurrency` (default 5, clamped to 1..5) calls in flight via a small counting semaphore. Returns
`{ deleted }`; rethrows the first failure after in-flight deletes settle. Callers must remove
sidecar-independent records (DB rows) themselves.

## Testing

`bun run --filter=@tj/storage test`. `runStorageContract(name, factory, { skip? })`
(`src/storage-contract.ts`) is the shared behavioural suite: it runs against `LocalDiskStorage`
in a `mkdtemp` directory and against `S3Storage` when `S3_BUCKET`, `S3_ENDPOINT`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are set (locally:
`eval "$(railway bucket credentials --bucket files --json | jq -r '"export S3_BUCKET=\(.bucketName) S3_ENDPOINT=\(.endpoint) S3_ACCESS_KEY_ID=\(.accessKeyId) S3_SECRET_ACCESS_KEY=\(.secretAccessKey)"')"`);
without them the S3 suite is skipped with that reason. The S3 run writes under a fresh workspace
id and cleans up after itself.

## Residency (ADR 0016)

The bucket is in Railway's `ams` region, the same metro as the api, worker and Postgres. Files are
EU-resident, not UK-resident; revisit before M3 / M4 (ADR 0016 §1).

## History

ADR 0011 (2026-09-03) chose Vercel Blob; its 2026-09-04 amendment introduced the `GET /files/:key`
proxy because Blob had no signed URLs for private objects. ADR 0026 (2026-09-07) replaced Blob with
the Railway Bucket and kept the proxy as the deliberate read path. See
[`docs/adr/0026-railway-bucket-storage.md`](../../docs/adr/0026-railway-bucket-storage.md).

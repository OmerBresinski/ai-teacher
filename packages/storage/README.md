# @tj/storage

`StorageAdapter` implementations for Teaching Journey (ADR 0011). Consumed from source
(`exports["."] → src/index.ts`); depends only on `@tj/domain` and `@vercel/blob`. No framework
imports, no `@tj/db`.

```ts
import { createStorage, deleteByPrefix } from "@tj/storage";
import { storageKey } from "@tj/domain";

const { adapter, kind } = createStorage(process.env); // "vercel-blob" | "local-disk"
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
| `VercelBlobStorage({ token, publicPrefixes?, proxyBasePath?, listPageSize? })` | production | Vercel Blob via `@vercel/blob` 2.8.0 |

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

### VercelBlobStorage

- `@vercel/blob` **2.8.0** supports `access: "private"`; everything is stored private with
  `addRandomSuffix: false` so the Blob pathname *is* the storage key. `allowOverwrite: true`
  keeps `put` idempotent for the same key.
- Keys under `publicPrefixes` (`<ws>` or `<ws>/sub`, path-style match) are stored with
  `access: "public"`; `getSignedUrl` returns their CDN URL.
- **Private objects have no browser-reachable URL.** `getSignedUrl` returns the relative proxy
  path `${proxyBasePath}/${key}` (default `/files/<key>`, segments percent-encoded). The API
  route `GET /files/:key` (TEACH-16/19) must authenticate the caller, check the key's workspace
  against the session, call `adapter.get(key)` and stream `body` with `contentType`. That proxy is
  the only sanctioned read path; `expiresInSeconds` is ignored because the proxy authorises every
  request.
- `list` follows every `cursor` page and applies path-style prefix matching (`<ws>/sources` does
  not match `<ws>/sources-old/x`).
- `delete` is idempotent (`del` on an unknown pathname is a no-op).

## Environment variables (`createStorage(env)`)

| Variable | Effect |
| -------- | ------ |
| `BLOB_READ_WRITE_TOKEN` | When set (non-blank) → `VercelBlobStorage`; otherwise local disk. |
| `STORAGE_ROOT` | Local-disk root. Default `.data/storage` (git-ignored). |
| `STORAGE_PUBLIC_BASE_URL` | Local-disk `getSignedUrl` base instead of `file://`. |
| `STORAGE_PUBLIC_PREFIXES` | Comma-separated Blob public prefixes. |

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
  `"not_found"` (`getSignedUrl`/`get` on a missing object), `"backend"` (fs / Blob API failure,
  original error on `cause`), `"invalid_key"`. Use `isStorageError(err, code?)`.

## deleteByPrefix (F15-R02)

`deleteByPrefix(adapter, prefix, { concurrency? })` lists lazily and deletes with at most
`concurrency` (default 5, clamped to 1..5) calls in flight via a small counting semaphore. Returns
`{ deleted }`; rethrows the first failure after in-flight deletes settle. Callers must remove
sidecar-independent records (DB rows) themselves.

## Testing

`bun run --filter=@tj/storage test`. `runStorageContract(name, factory, { skip? })`
(`src/storage-contract.ts`) is the shared behavioural suite: it runs against `LocalDiskStorage`
in a `mkdtemp` directory and against `VercelBlobStorage` when `BLOB_READ_WRITE_TOKEN` is set;
without a token the Blob suite is skipped with that reason. The Blob run writes under a fresh
workspace id and cleans up after itself.

## Residency (ADR 0016)

Vercel Blob regions are Vercel-controlled, so files are EU-resident at best, not UK-resident.
Revisit before M3 / M4; an S3-compatible adapter behind the same interface is the escape hatch.

## ADR 0011 amendment (2026-09-04)

ADR 0011 originally said clients read through `getSignedUrl`. With private Blobs and no SDK
presigned-URL support in 2.8.0, private objects are read through the API proxy `GET /files/:key`
(session + workspace-scoped key, streams `get(key)`); `getSignedUrl` returns that proxy path, or
the CDN URL for explicitly public prefixes only. See the amendment in
[`docs/adr/0011-vercel-blob.md`](../../docs/adr/0011-vercel-blob.md).

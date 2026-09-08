/**
 * Copying a chosen Pexels photo into the Workspace's object storage (Images project, "Picking
 * an image copies it"): a removed Pexels photo must not blank a lesson, so the element stores
 * our URL, not Pexels'.
 *
 * Shared by `apps/api` (`POST /images/pick`) and, later, `apps/worker` (pipeline placement) —
 * neither goes through the other. The key convention (`<workspaceId>/images/<uuid>.<ext>`) is
 * shared with the `POST /files` upload (TEACH-123): both kinds of stored image live under the
 * one `images/` prefix, served back through `GET /files/:key`.
 */
import { newId, type StorageAdapter, storageKey, type WorkspaceId } from "@tj/domain";
import type { PhotoSource } from "@tj/domain/documents";
import type { PhotoResult } from "./pexels";

export type PickTarget = "slide" | "worksheet";

/** Which Pexels rendition is fetched per target — never `original`. */
export const RENDITION_FOR_TARGET = {
  slide: "large",
  worksheet: "medium",
} as const;

/** A stalled CDN must not hang the request; mirrors the editor's `fetchRemoteImage`. */
export const FETCH_TIMEOUT_MS = 15_000;
/** Refuse before or after the read when the body exceeds this. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const EXTENSION_FOR_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The three ways a photo is refused. Storage errors propagate untouched. */
export class StorePhotoError extends Error {
  readonly reason: "fetch_failed" | "too_large" | "not_an_image";
  constructor(reason: StorePhotoError["reason"], message: string) {
    super(message);
    this.name = "StorePhotoError";
    this.reason = reason;
  }
}

export interface StoredPhoto {
  key: string;
  /** Our URL for the bytes: `/files/<key>`, served by the api's file proxy. */
  url: string;
  /** Native dimensions as Pexels reports them; the rendition keeps the aspect. */
  width: number;
  height: number;
  /** Stored size in bytes (also logged by the route as `bytes`). */
  bytes: number;
  contentType: string;
  source: PhotoSource;
}

export interface StorePhotoOptions {
  photo: PhotoResult;
  target: PickTarget;
  /** Only `put` is used; the narrower type lets tests pass a minimal fake. */
  storage: Pick<StorageAdapter, "put">;
  workspaceId: WorkspaceId;
  /** Tests pass a stub; production uses the global. Never mutated. */
  fetch?: typeof globalThis.fetch;
  /** Tests pass a fixed id; production mints one. */
  ids?: () => string;
}

export async function storePhoto(options: StorePhotoOptions): Promise<StoredPhoto> {
  const { photo, target, storage, workspaceId } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const rendition = photo.src[RENDITION_FOR_TARGET[target]];
  // The URL always comes from our own Pexels client, but refuse anything unexpected anyway:
  // this fetch must never be steerable at an arbitrary host.
  if (!rendition.startsWith("https://")) {
    throw new StorePhotoError("fetch_failed", "The photo URL is not usable.");
  }
  let res: Response;
  try {
    res = await fetchFn(rendition, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new StorePhotoError("fetch_failed", "The photo could not be downloaded.");
  }
  if (!res.ok) {
    throw new StorePhotoError("fetch_failed", "The photo could not be downloaded.");
  }
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = EXTENSION_FOR_CONTENT_TYPE[contentType];
  if (ext === undefined) {
    throw new StorePhotoError("not_an_image", "The photo is not a supported image.");
  }
  // Content-Length first: refusing before the body is read saves the download.
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) {
    throw new StorePhotoError("too_large", "The photo is too large to store.");
  }
  // The connection can still drop mid-body: a failed read is a failed fetch.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new StorePhotoError("fetch_failed", "The photo could not be downloaded.");
  }
  // And again after: the header is a claim, the body read is the fact.
  if (bytes.length === 0) {
    throw new StorePhotoError("fetch_failed", "The photo download was empty.");
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new StorePhotoError("too_large", "The photo is too large to store.");
  }
  const key = storageKey(workspaceId, "images", `${(options.ids ?? newId)()}.${ext}`);
  await storage.put(key, bytes, { contentType });
  return {
    key,
    url: `/files/${key}`,
    width: photo.width,
    height: photo.height,
    bytes: bytes.length,
    contentType,
    source: {
      provider: "pexels",
      id: photo.id,
      pageUrl: photo.pageUrl,
      photographer: photo.photographer,
      photographerUrl: photo.photographerUrl,
    },
  };
}

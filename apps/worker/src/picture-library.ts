/**
 * The shared picture library behind the writer planner's picture director (TEACH-84 part b, UX
 * ruling 158): `bank_images` rows in Postgres (pgvector), the bytes in the same object storage as
 * every placed picture under `<LIBRARY_WORKSPACE_ID>/bank/<id>.<ext>`, and one request embedding
 * per request text (cached by the embedder). A lookup offers the nearest stored picture at or above
 * `REUSE_THRESHOLD` in the same aspect family with the same numbers; the director's judge then sees
 * its bytes before it is placed (`findPicture`). Only pictures a judge passed are stored.
 *
 * A failed lookup (embedding, database or storage) is a miss, never an error: the director goes on
 * to its live search or generation exactly as with no library. Logs ids, counts, similarity and ms
 * only: never the request, prompt or alt (ADR 0015).
 */
import {
  type BankImageRow,
  type Db,
  insertBankImage,
  nearestBankImages,
  rejectBankImage,
  touchBankImage,
} from "@tj/db";
import { LIBRARY_WORKSPACE_ID, type ReadableStorageAdapter } from "@tj/domain";
import type { PhotoSource } from "@tj/domain/documents";
import type { BankRequest, MadePicture } from "@tj/generation";
import {
  type AspectFamily,
  bankLicenceOk,
  EMBED_DIMENSIONS,
  type Embedder,
  familyOf,
  numbersAgree,
  pickReuse,
  REUSE_THRESHOLD,
  requestText,
  sizeForAspect,
} from "@tj/images";
import type { Logger } from "./picture-generator";

/** How long a lookup's embedding may take before the lookup is a miss (the live search goes on). */
export const LIBRARY_EMBED_TIMEOUT_MS = 2_000;
/** Same-family candidates a lookup weighs (the numbers rule may drop the nearest few). */
export const LOOKUP_CANDIDATES = 20;
/** The most characters of request or alt text a shared row keeps. */
export const STORED_TEXT_MAX = 300;

/** What the worker knows about a picture it generated, so the stored row keeps true provenance. */
export interface MadeProvenance {
  generator: string;
  generatorTerms: string;
  prompt: string;
  costUsd: number;
  faithful: boolean;
}

export interface PictureLibrary {
  /** The stored picture to offer for this request, with its bytes for the judge; else undefined. */
  lookup(req: BankRequest, signal: AbortSignal): Promise<MadePicture | undefined>;
  /** Store a picture a judge passed (fetched, or generated with its provenance). */
  store(req: BankRequest, photo: MadePicture, made?: MadeProvenance): Promise<void>;
  /** Whether `src` is a library picture. */
  owns(src: string): boolean;
  /** A library picture the judge refused: never offered again. */
  reject(src: string): Promise<void>;
}

/** The `bank_images` queries the library runs (`@tj/db`); tests pass an in-memory set. */
export interface LibraryQueries {
  nearest: typeof nearestBankImages;
  insert: typeof insertBankImage;
  touch: typeof touchBankImage;
  reject: typeof rejectBankImage;
}

const DB_QUERIES: LibraryQueries = {
  nearest: nearestBankImages,
  insert: insertBankImage,
  touch: touchBankImage,
  reject: rejectBankImage,
};

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const PREFIX = `/files/${LIBRARY_WORKSPACE_ID}/bank/`;

/** Width and height from a PNG or JPEG header; undefined for anything else. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50)
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return undefined;
      const marker = bytes[i + 1] ?? 0;
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      i += 2 + len;
    }
  }
  return undefined;
}

/** How a stored generated picture looks; undefined for stock. A row with no style is a photo. */
export function styleOf(row: Pick<BankImageRow, "flags" | "provider">): MadePicture["style"] {
  const flags = (row.flags ?? {}) as { drawn?: boolean; style?: string };
  if (flags.drawn) return "drawn";
  if (row.provider !== "generated") return undefined;
  if (flags.style === "illustration") return "illustration";
  if (flags.style === "house") return "house";
  return "photo";
}

function photoOf(row: BankImageRow): MadePicture {
  const source = row.source as PhotoSource;
  return {
    src: `/files/${row.storageKey}`,
    alt: row.alt,
    source,
    evidence: source.evidence ?? {
      visible: [],
      count: "one",
      alt: row.alt,
      promptVersion: "picture-library",
    },
  };
}

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | undefined {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m?.[1] || m[2] === undefined) return undefined;
  return { mime: m[1], bytes: new Uint8Array(Buffer.from(m[2], "base64")) };
}

export function createPictureLibrary(opts: {
  db: Db;
  storage: ReadableStorageAdapter;
  embedder: Embedder;
  logger: Logger;
  ids: () => string;
  threshold?: number;
  embedTimeoutMs?: number;
  queries?: LibraryQueries;
}): PictureLibrary {
  const { db, storage, embedder, logger } = opts;
  const q = opts.queries ?? DB_QUERIES;
  const threshold = opts.threshold ?? REUSE_THRESHOLD;
  const timeoutMs = opts.embedTimeoutMs ?? LIBRARY_EMBED_TIMEOUT_MS;

  const read = async (key: string) => {
    const obj = await storage.get(key);
    return {
      bytes: new Uint8Array(await new Response(obj.body).arrayBuffer()),
      mime: obj.contentType,
    };
  };

  return {
    owns: (src) => src.startsWith(PREFIX),
    async lookup(req, signal) {
      const t0 = Date.now();
      try {
        const text = requestText(req);
        const { vector } = await embedder.embed(
          text,
          AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        );
        const family: AspectFamily = sizeForAspect(req.aspect).family;
        // Family is filtered in SQL; the numbers rule runs here over a wide enough candidate set.
        const near = await q.nearest(db, vector, LOOKUP_CANDIDATES, family);
        const best = pickReuse(
          near
            .filter((r) => numbersAgree(r.request, text))
            .map((r) => ({ similarity: r.similarity, family: r.family as AspectFamily, row: r })),
          family,
          threshold,
        );
        const top = near[0] ? Math.round(near[0].similarity * 1000) / 1000 : undefined;
        if (!best) {
          logger.info(
            {
              stage: "illustrate",
              library: "miss",
              candidates: near.length,
              top,
              ms: Date.now() - t0,
            },
            "picture library miss",
          );
          return undefined;
        }
        const style = styleOf(best.row);
        const palette = ((best.row.flags ?? {}) as { palette?: string }).palette;
        // The bytes go with the hit so the judge checks this picture against this request.
        let dataUrl: string | undefined;
        if (style !== "drawn") {
          const { bytes, mime } = await read(best.row.storageKey);
          dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
        }
        await q.touch(db, best.row.id);
        logger.info(
          {
            stage: "illustrate",
            library: "hit",
            id: best.row.id,
            similarity: Math.round(best.similarity * 1000) / 1000,
            ms: Date.now() - t0,
          },
          "picture library hit",
        );
        return {
          ...photoOf(best.row),
          ...(style ? { style } : {}),
          ...(palette ? { palette } : {}),
          ...(dataUrl ? { dataUrl } : {}),
        };
      } catch (error) {
        if (signal.aborted) throw error;
        logger.info(
          {
            stage: "illustrate",
            library: "down",
            reason: error instanceof Error ? error.name : "unknown",
            ms: Date.now() - t0,
          },
          "picture library lookup failed: live search instead",
        );
        return undefined;
      }
    },
    async store(req, photo, made) {
      const t0 = Date.now();
      const s = photo.source;
      // Ruling 139: only licences the library may keep; a generated picture only with provenance.
      if (!bankLicenceOk(s)) return;
      if (s.provider === "generated" && !made) return;
      if (photo.src.startsWith(PREFIX)) return;
      const file = photo.dataUrl
        ? dataUrlBytes(photo.dataUrl)
        : photo.src.startsWith("/files/")
          ? await read(photo.src.slice("/files/".length))
          : undefined;
      if (!file) return;
      const id = opts.ids();
      const storageKey = `${LIBRARY_WORKSPACE_ID}/bank/${id}.${EXT[file.mime] ?? "bin"}`;
      const text = requestText(req);
      const { vector } = await embedder.embed(text);
      const dims = imageDimensions(file.bytes) ?? { width: 1024, height: 1024 };
      const family = familyOf(dims.width, dims.height);
      // Idempotent enough: a row this request would already reuse is not stored twice.
      const [same] = await q.nearest(db, vector, 1, family);
      if (same && same.similarity >= threshold && numbersAgree(same.request, text)) {
        logger.info(
          { stage: "illustrate", library: "duplicate", id: same.id, ms: Date.now() - t0 },
          "picture already in library",
        );
        return;
      }
      const style = photo.style ?? "photo";
      await storage.put(storageKey, file.bytes, { contentType: file.mime });
      try {
        await q.insert(db, {
          id,
          storageKey,
          mime: file.mime,
          byteSize: file.bytes.byteLength,
          width: dims.width,
          height: dims.height,
          family,
          provider: s.provider,
          source: s,
          licence: s.licence ?? (s.provider === "pexels" ? "Pexels licence" : null),
          credit: s.author ?? s.photographer,
          // Shared across workspaces: capped so a long ask cannot carry a passage of lesson text.
          alt: photo.alt.slice(0, STORED_TEXT_MAX),
          tags: [],
          request: text.slice(0, STORED_TEXT_MAX),
          route: req.route,
          embedModel: embedder.model,
          embedDims: EMBED_DIMENSIONS,
          embedding: vector,
          ...(made
            ? {
                generator: made.generator,
                generatorTerms: made.generatorTerms,
                prompt: made.prompt,
                costUsd: made.costUsd.toFixed(6),
                flags: {
                  lookCheck: made.faithful,
                  faithful: made.faithful,
                  style,
                  ...(photo.palette ? { palette: photo.palette } : {}),
                },
              }
            : {}),
        });
      } catch (error) {
        // No row, so no orphan object either.
        await storage.delete(storageKey).catch(() => undefined);
        throw error;
      }
      logger.info(
        { stage: "illustrate", library: "stored", id, provider: s.provider, ms: Date.now() - t0 },
        "picture stored in library",
      );
    },
    async reject(src) {
      if (!src.startsWith(PREFIX)) return;
      await q.reject(db, src.slice("/files/".length));
    },
  };
}

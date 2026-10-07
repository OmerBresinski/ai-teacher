import type { Embedder } from "@tj/ai";
import {
  type BankImageRow,
  type Db,
  findBankImagesByTags,
  insertBankImage,
  nearestBankImages,
  touchBankImage,
} from "@tj/db";
import { newId, type ReadableStorageAdapter, storageKey, type WorkspaceId } from "@tj/domain";
import type { PhotoSource } from "@tj/domain/documents";
import type { BankBrief, BankHit, BankPhoto, PhotoPlacer } from "@tj/generation";
import {
  BANK_EMBED_TIMEOUT_MS,
  bankCard,
  bankStorageKey,
  bankSubject,
  bankZone,
  numbersAgree,
} from "@tj/images";
import type { Logger } from "pino";

/**
 * The picture library's worker side (TEACH-84 phase 1, rulings 88 and 158): `lookupBank` and
 * `rememberBank` for the pipeline's `PhotoPlacer`, closed over the shared `bank_images` table,
 * object storage, the embedder and the job's Workspace.
 *
 * - Lookup (TOPIC-GRAPH §5.5): the tag filter first (ready, orientation, band, normalised
 *   subject: no model call); otherwise one cached embedding of the brief's card under a 300 ms
 *   deadline (a timeout is a miss) and exact cosine over the filtered rows; only a clear hit
 *   above the calibrated threshold is served. The grey zone is a miss in phase 1.
 * - A served row is copied into this Workspace's `images/` prefix, so `/files` serves it with its
 *   tenancy check unchanged, and its `use_count` / `last_used_at` move.
 * - Write-through (§5.3): a photograph the judge passed is stored once (`ready`, its checks
 *   recorded) with its card and embedding. Off the writing clock: queued, drained by the job.
 *
 * Log lines carry ids, counts, timings and similarities only: never the subject, card or caption
 * (ADR 0015).
 */
export interface Library {
  lookupBank: NonNullable<PhotoPlacer["lookupBank"]>;
  rememberBank: (brief: BankBrief, photo: BankPhoto & { width: number; height: number }) => void;
  /** Wait for every queued write-through; never throws. */
  drain(): Promise<void>;
}

export interface CreateLibraryOptions {
  db: Db;
  storage: ReadableStorageAdapter;
  /** Absent: the tag filter only, and rows are stored without an embedding. */
  embedder?: Embedder | undefined;
  workspaceId: WorkspaceId;
  logger: Logger;
  ids?: () => string;
  now?: () => Date;
  embedTimeoutMs?: number;
}

const EXTENSION_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const FILES_PREFIX = "/files/";

/**
 * Only an error's name is logged: a query error carries its parameters and an embedding error its
 * request body, both of which hold the brief (ADR 0015).
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

export function createLibrary(options: CreateLibraryOptions): Library {
  const { db, storage, embedder, workspaceId } = options;
  const logger = options.logger.child({ component: "library" });
  const ids = options.ids ?? (() => newId());
  const now = options.now ?? (() => new Date());
  const embedTimeoutMs = options.embedTimeoutMs ?? BANK_EMBED_TIMEOUT_MS;
  const pending = new Set<Promise<void>>();

  async function readBytes(key: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const object = await storage.get(key);
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    return { bytes, mime: object.contentType };
  }

  /** Copy a library row's bytes into this Workspace and return the hit. */
  async function serve(row: BankImageRow, via: BankHit["via"], similarity: number) {
    const source = row.source as PhotoSource;
    const evidence = source.evidence;
    if (!evidence) return undefined;
    const { bytes } = await readBytes(row.storageKey);
    const ext = EXTENSION_FOR_MIME[row.mime] ?? "jpg";
    const key = storageKey(workspaceId, "images", `${ids()}.${ext}`);
    await storage.put(key, bytes, { contentType: row.mime });
    await touchBankImage(db, row.id, now());
    const hit: BankHit = {
      src: `${FILES_PREFIX}${key}`,
      alt: row.alt,
      source,
      evidence,
      via,
      similarity,
    };
    return hit;
  }

  /** The embedding of `card`, or `undefined` when it misses the deadline or fails. */
  async function embedWithin(card: string, ms: number): Promise<number[] | undefined> {
    if (!embedder) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), ms);
    });
    try {
      const result = await Promise.race([embedder.embed(card), deadline]);
      if (result === "timeout") {
        logger.info({ library: "embed-timeout", ms }, "library lookup");
        return undefined;
      }
      return result.vector;
    } catch (error) {
      logger.info({ library: "embed-failed", error: errorName(error) }, "library lookup");
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  const lookupBank: Library["lookupBank"] = async (brief, { signal }) => {
    if (!brief.ageBand) return undefined;
    const t0 = Date.now();
    const subject = bankSubject(brief.subject);
    const tags = { orientation: brief.orientation, band: brief.ageBand };
    const exact = await findBankImagesByTags(db, { ...tags, subject }, 1);
    signal.throwIfAborted();
    const first = exact[0];
    if (first) {
      const hit = await serve(first, "tags", 1);
      logger.info(
        { library: "hit", via: "tags", rowId: first.id, ms: Date.now() - t0 },
        "library lookup",
      );
      return hit;
    }
    const card = bankCard(brief);
    const vector = await embedWithin(card, embedTimeoutMs);
    signal.throwIfAborted();
    if (!vector) return undefined;
    const nearest = await nearestBankImages(db, tags, vector);
    const [top, second] = nearest;
    const zone = top ? bankZone(top.similarity) : "miss";
    const agree = top ? numbersAgree(card, top.caption ?? "") : false;
    logger.info(
      {
        library: zone === "hit" && agree ? "hit" : "miss",
        via: "embedding",
        zone,
        candidates: nearest.length,
        top: top ? Number(top.similarity.toFixed(3)) : null,
        margin: top && second ? Number((top.similarity - second.similarity).toFixed(3)) : null,
        numbersAgree: top ? agree : null,
        ms: Date.now() - t0,
      },
      "library lookup",
    );
    if (!top || zone !== "hit" || !agree) return undefined;
    return serve(top, "embedding", top.similarity);
  };

  async function remember(
    brief: BankBrief,
    photo: BankPhoto & { width: number; height: number },
  ): Promise<void> {
    const band = brief.ageBand;
    if (!band || !photo.src.startsWith(FILES_PREFIX)) return;
    const t0 = Date.now();
    const subject = bankSubject(brief.subject);
    const existing = await findBankImagesByTags(
      db,
      { subject, orientation: brief.orientation, band },
      1,
    );
    if (existing.length > 0) {
      logger.info({ library: "duplicate", ms: Date.now() - t0 }, "library write");
      return;
    }
    const { bytes, mime } = await readBytes(photo.src.slice(FILES_PREFIX.length));
    const ext = EXTENSION_FOR_MIME[mime];
    if (!ext) return;
    const id = ids();
    const key = bankStorageKey(id, ext);
    const card = bankCard(brief);
    const embedding = await embedWithin(card, 10_000);
    await storage.put(key, bytes, { contentType: mime });
    const seen = new Set(photo.evidence.visible.map((v) => v.trim().toLowerCase()));
    const row = await insertBankImage(db, {
      id,
      storageKey: key,
      mime,
      byteSize: bytes.length,
      width: photo.width,
      height: photo.height,
      orientation: brief.orientation,
      subject,
      topic: brief.topic,
      bands: [band],
      depicts: brief.mustShow.filter((m) => seen.has(m.trim().toLowerCase())),
      style: "photo",
      alt: photo.alt,
      source: photo.source,
      checks: {
        onSubject: true,
        suitable: null,
        noText: null,
        checkedBy: photo.evidence.promptVersion,
        checkedAt: now().toISOString(),
      },
      status: "ready",
      caption: card,
      ...(embedding && embedder
        ? { embedding, embedModel: embedder.model, embedDims: embedder.dimensions }
        : {}),
    });
    if (!row) {
      // A concurrent write took the slot (the partial unique index): drop the orphan bytes.
      await storage.delete(key).catch(() => undefined);
      logger.info({ library: "duplicate", ms: Date.now() - t0 }, "library write");
      return;
    }
    logger.info(
      { library: "stored", rowId: id, embedded: embedding !== undefined, ms: Date.now() - t0 },
      "library write",
    );
  }

  return {
    lookupBank,
    rememberBank(brief, photo) {
      const p = remember(brief, photo).catch((error: unknown) => {
        logger.warn({ library: "write-failed", error: errorName(error) }, "library write");
      });
      pending.add(p);
      void p.finally(() => pending.delete(p));
    },
    async drain() {
      await Promise.allSettled([...pending]);
    },
  };
}

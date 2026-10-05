/**
 * The picture library behind `PhotoPlacer.bank` (TEACH-84, UX ruling 158): `bank_images` rows in
 * Postgres (pgvector), the bytes in the same object storage `storePhoto` uses under
 * `bank/<id>.<ext>`, one request embedding per request (cached), and the image generator on a
 * miss, within a spend cap. Logs ids, counts, cost and ms only: never the request, prompt or alt
 * (ADR 0015).
 */
import {
  type BankImageRow,
  type Db,
  insertBankImage,
  nearestBankImages,
  touchBankImage,
} from "@tj/db";
import type { PhotoSource, StorageAdapter } from "@tj/domain";
import type { BankRequest, PictureBank, PlacedPhoto } from "@tj/generation";
import {
  type AspectFamily,
  bankLicenceOk,
  EMBED_DIMENSIONS,
  type Embedder,
  expectedImageCostUsd,
  familyOf,
  IMAGE_TERMS,
  type ImageGenerator,
  imagePrompt,
  pickReuse,
  REUSE_THRESHOLD,
  requestText,
  sizeForAspect,
} from "@tj/images";

export interface PictureBankEvent {
  kind: "lookup" | "remember" | "generate" | "refused";
  id?: string;
  hit?: boolean;
  similarity?: number;
  costUsd?: number;
  ms: number;
}

export interface PictureBankOptions {
  db: Db;
  storage: StorageAdapter;
  embedder: Embedder;
  /** Absent: a miss on a generic scene stays a miss (stock ladder only). */
  generator?: ImageGenerator;
  /** Spend cap for generation and embeddings in this bank's life (USD); generation stops at it. */
  capUsd?: number;
  threshold?: number;
  ids: () => string;
  onEvent?: (e: PictureBankEvent) => void;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

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

function photoOf(row: BankImageRow): PlacedPhoto {
  const source = row.source as PhotoSource;
  return {
    src: `/files/${row.storageKey}`,
    alt: row.alt,
    source,
    evidence: source.evidence ?? {
      visible: [],
      count: "one",
      alt: row.alt,
      promptVersion: "picture-bank",
    },
  };
}

export function createPictureBank(opts: PictureBankOptions): PictureBank & {
  spentUsd(): number;
} {
  const { db, storage, embedder, generator } = opts;
  const threshold = opts.threshold ?? REUSE_THRESHOLD;
  let spent = 0;
  const emit = (e: PictureBankEvent) => opts.onEvent?.(e);
  const embed = async (req: BankRequest, signal?: AbortSignal) => {
    const r = await embedder.embed(requestText(req), signal);
    spent += r.costUsd;
    return r.vector;
  };
  const family = (req: BankRequest): AspectFamily => sizeForAspect(req.aspect).family;

  const store = async (
    req: BankRequest,
    bytes: Uint8Array,
    mime: string,
    row: Omit<
      Parameters<typeof insertBankImage>[1],
      | "id"
      | "storageKey"
      | "mime"
      | "byteSize"
      | "width"
      | "height"
      | "family"
      | "request"
      | "route"
      | "embedModel"
      | "embedDims"
      | "embedding"
    >,
    size?: { width: number; height: number },
  ) => {
    const id = opts.ids();
    const ext = EXT[mime] ?? "bin";
    const storageKey = `bank/${id}.${ext}`;
    await storage.put(storageKey, bytes, { contentType: mime });
    const dims = size ?? imageDimensions(bytes) ?? { width: 1024, height: 1024 };
    return insertBankImage(db, {
      id,
      storageKey,
      mime,
      byteSize: bytes.byteLength,
      width: dims.width,
      height: dims.height,
      family: familyOf(dims.width, dims.height),
      request: requestText(req),
      route: req.route,
      embedModel: embedder.model,
      embedDims: EMBED_DIMENSIONS,
      embedding: await embed(req),
      ...row,
    });
  };

  return {
    spentUsd: () => spent,
    async lookup(req, signal) {
      const t0 = Date.now();
      const vector = await embed(req, signal);
      const near = await nearestBankImages(db, vector, 5);
      const best = pickReuse(
        near.map((r) => ({ similarity: r.similarity, family: r.family as AspectFamily, row: r })),
        family(req),
        threshold,
      );
      emit({
        kind: "lookup",
        hit: !!best,
        ms: Date.now() - t0,
        ...(near[0] ? { similarity: Math.round(near[0].similarity * 1000) / 1000 } : {}),
        ...(best ? { id: best.row.id } : {}),
      });
      if (!best) return undefined;
      await touchBankImage(db, best.row.id);
      return photoOf(best.row);
    },
    async remember(req, photo) {
      const t0 = Date.now();
      if (!bankLicenceOk(photo.source)) return;
      const key = photo.src.replace(/^\/files\//, "");
      const readable = storage as Partial<{
        get: (k: string) => Promise<{ body: ReadableStream<Uint8Array>; contentType: string }>;
      }>;
      if (!readable.get) return;
      const obj = await readable.get(key);
      const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
      const s = photo.source;
      const row = await store(req, bytes, obj.contentType, {
        provider: s.provider,
        source: s,
        licence: s.licence ?? (s.provider === "pexels" ? "Pexels licence" : null),
        credit: s.author ?? s.photographer,
        alt: photo.alt,
        tags: [],
      });
      emit({ kind: "remember", id: row.id, ms: Date.now() - t0 });
    },
    async generate(req, faithful, signal) {
      if (!generator) return undefined;
      const { size } = sizeForAspect(req.aspect);
      if (opts.capUsd !== undefined && spent + expectedImageCostUsd(size) > opts.capUsd) {
        emit({ kind: "refused", ms: 0 });
        return undefined;
      }
      const prompt = imagePrompt(req, faithful);
      const out = await generator.generate({ prompt, size, signal });
      spent += out.costUsd;
      const [w, h] = size.split("x").map(Number) as [number, number];
      const id = opts.ids();
      const source: PhotoSource = {
        provider: "generated",
        id,
        pageUrl: "https://openai.com/policies/",
        photographer: `AI-generated (${generator.model})`,
        photographerUrl: "https://openai.com/policies/",
        licence: `generated (${IMAGE_TERMS})`,
      };
      const alt = req.text.trim().slice(0, 300);
      const row = await store(
        req,
        out.bytes,
        out.mime,
        {
          provider: "generated",
          source,
          licence: source.licence ?? null,
          credit: source.photographer,
          alt,
          tags: [],
          generator: generator.model,
          generatorTerms: IMAGE_TERMS,
          prompt,
          costUsd: out.costUsd.toFixed(6),
          flags: { lookCheck: faithful, faithful },
        },
        { width: w, height: h },
      );
      emit({ kind: "generate", id: row.id, costUsd: out.costUsd, ms: out.ms });
      return photoOf(row);
    },
  };
}

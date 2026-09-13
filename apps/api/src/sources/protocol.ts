import type { SourceLocator } from "@tj/domain/documents";
import type {
  ExtractErrorCode,
  Extraction,
  ExtractionKind,
  ImageMime,
  SourceMime,
} from "@tj/extract";

/** `Extraction` as it crosses the child's stdout: image bytes base64, everything else as is. */
export interface WireExtraction extends Omit<Extraction, "images"> {
  images: { ref: SourceLocator; mime: ImageMime; base64: string }[];
}

export type ChildAnswer =
  | { ok: true; mime: SourceMime; extraction: WireExtraction }
  | { ok: false; code: ExtractErrorCode | "crashed"; format: ExtractionKind | "unknown" };

export function encodeExtraction(extraction: Extraction): WireExtraction {
  return {
    ...extraction,
    images: extraction.images.map((image) => ({
      ref: image.ref,
      mime: image.mime,
      base64: Buffer.from(image.bytes).toString("base64"),
    })),
  };
}

export function decodeExtraction(wire: WireExtraction): Extraction {
  return {
    ...wire,
    images: wire.images.map((image) => ({
      ref: image.ref,
      mime: image.mime,
      bytes: Uint8Array.from(Buffer.from(image.base64, "base64")),
    })),
  };
}

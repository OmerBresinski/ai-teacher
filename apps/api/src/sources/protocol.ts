import { type SourceLocator, SourceLocatorSchema } from "@tj/domain/documents";
import type {
  ExtractErrorCode,
  Extraction,
  ExtractionKind,
  ImageMime,
  SourceMime,
} from "@tj/extract";
import { MIME } from "@tj/extract";
import { z } from "zod";

/** `Extraction` as it crosses the child's stdout: image bytes base64, everything else as is. */
export interface WireExtraction extends Omit<Extraction, "images"> {
  images: { ref: SourceLocator; mime: ImageMime; base64: string }[];
}

export type ChildAnswer =
  | { ok: true; mime: SourceMime; extraction: WireExtraction }
  | { ok: false; code: ExtractErrorCode | "crashed"; format: ExtractionKind | "unknown" };

const kind = z.enum(["pdf", "pptx", "docx", "paste"]);
const answerSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    mime: z.enum([MIME.pdf, MIME.pptx, MIME.docx, MIME.paste]),
    extraction: z.object({
      kind,
      pages: z.number().int().nonnegative(),
      chunks: z.array(z.object({ ref: SourceLocatorSchema, text: z.string() })),
      tables: z.array(z.object({ ref: SourceLocatorSchema, rows: z.array(z.array(z.string())) })),
      images: z.array(
        z.object({
          ref: SourceLocatorSchema,
          mime: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
          base64: z.string().base64(),
        }),
      ),
    }),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["malformed", "unsupported", "too-large", "crashed"]),
    format: z.enum(["pdf", "pptx", "docx", "paste", "unknown"]),
  }),
]);

/** The child handles untrusted bytes; malformed JSON/shape must never hang or reach storage. */
export function parseChildAnswer(text: string): ChildAnswer {
  const answer = answerSchema.parse(JSON.parse(text));
  if (answer.ok && MIME[answer.extraction.kind] !== answer.mime) {
    throw new Error("Inconsistent extraction format");
  }
  return answer;
}

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

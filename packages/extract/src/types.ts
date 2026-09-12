import type { SourceLocator } from "@tj/domain/documents";

/** The formats `POST /sources` accepts, as sniffed MIME types (ADR 0027 §2). */
export type SourceMime =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain";

export const MIME = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  paste: "text/plain",
} as const satisfies Record<ExtractionKind, SourceMime>;

export type ExtractionKind = "pdf" | "pptx" | "docx" | "paste";

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface ExtractInput {
  bytes: Uint8Array;
  mime: SourceMime;
  /** The file name or paste label; used for nothing but error context today. */
  name: string;
}

export interface ExtractedChunk {
  ref: SourceLocator;
  text: string;
}

export interface ExtractedTable {
  ref: SourceLocator;
  /** Rows of cell text, header row first when the format has one. */
  rows: string[][];
}

export interface ExtractedImage {
  ref: SourceLocator;
  mime: ImageMime;
  bytes: Uint8Array;
}

/**
 * What `extract` produces: the document as located text chunks (one per page, slide or heading
 * section), the tables it found (for the roster screen), and its embedded images (stored by the
 * API, captioned in phase 2). `pages` is pages for a PDF, slides for a PPTX, 1 otherwise.
 */
export interface Extraction {
  kind: ExtractionKind;
  pages: number;
  chunks: ExtractedChunk[];
  tables: ExtractedTable[];
  images: ExtractedImage[];
}

export type Refusal =
  | { reason: "roster"; ref: SourceLocator }
  | { reason: "identifiers"; count: number; ref: SourceLocator }
  | { reason: "unreadable" }
  | { reason: "too-long"; pages: number };

export const LIMITS = {
  maxPages: 300,
  /** Sum of uncompressed zip entries a PPTX/DOCX may make us read. */
  maxUncompressedBytes: 200 * 1024 * 1024,
  minTextChars: 200,
  minCharsPerPage: 20,
} as const;

export type ExtractErrorCode = "too-large" | "malformed" | "unsupported";

/**
 * A document that could not be extracted. The message names the format and the code only, and
 * the library's error is **not** kept as `cause`: parser messages quote the offending input, which
 * is document text (ADR 0015). The API maps every code to the `unreadable` refusal.
 */
export class ExtractError extends Error {
  override readonly name = "ExtractError";
  constructor(
    readonly code: ExtractErrorCode,
    readonly format: ExtractionKind | "unknown",
  ) {
    super(`extract(${format}): ${code}`);
  }
}

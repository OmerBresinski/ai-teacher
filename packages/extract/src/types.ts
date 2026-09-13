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
  /** Resource ceilings; tests scale them down. Production uses `LIMITS`. */
  limits?: Partial<ExtractLimits>;
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

/**
 * Resource ceilings for untrusted documents (ADR 0027 §5, amended by TEACH-278). Every one is
 * enforced **before** the allocation it bounds: zip entries are counted while they inflate, a PDF's
 * page count is read before any page is parsed, an image's pixel count before its buffer exists.
 * Values are engineering config sized from the generated fixtures and real teacher files, not
 * product limits; `ExtractInput.limits` overrides them in tests.
 */
export interface ExtractLimits {
  /** Pages a PDF may have; more is the `too-long` refusal without parsing a page. */
  maxPages: number;
  /** Sum of uncompressed zip entries a PPTX/DOCX may make us read. */
  maxUncompressedBytes: number;
  /** One zip entry's inflated size (a slide XML, a media file). */
  maxEntryBytes: number;
  /** Entries in a zip's central directory (a real deck has a few hundred). */
  maxZipEntries: number;
  /** Characters of extracted text across the whole document. */
  maxTextChars: number;
  /** Pixels (w × h) of one embedded image we will re-encode; larger ones are skipped. */
  maxImagePixels: number;
  /** Encoded bytes of all images kept from one document. */
  maxImageBytesTotal: number;
  minTextChars: number;
  minCharsPerPage: number;
}

export const LIMITS: Readonly<ExtractLimits> = {
  maxPages: 300,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxZipEntries: 5_000,
  maxTextChars: 5_000_000,
  maxImagePixels: 20_000_000, // 5000 × 4000; RGBA raw = 80 MiB before deflate
  maxImageBytesTotal: 64 * 1024 * 1024,
  minTextChars: 200,
  minCharsPerPage: 20,
};

export const resolveLimits = (overrides?: Partial<ExtractLimits>): ExtractLimits => ({
  ...LIMITS,
  ...overrides,
});

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

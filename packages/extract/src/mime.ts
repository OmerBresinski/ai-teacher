import JSZip from "jszip";
import { ExtractError, LIMITS, type SourceMime } from "./types";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/**
 * The document's real type from its bytes (ADR 0027 §2, §5): the type the browser declared is
 * never consulted. A zip is a PPTX when it carries `ppt/presentation.xml`, a DOCX when
 * `word/document.xml`; anything else is `null` and the route answers `unsupported`. Pasted text is
 * never sniffed — the route passes `text/plain` itself.
 */
export async function sniffMime(bytes: Uint8Array): Promise<SourceMime | null> {
  if (startsWith(bytes, PDF_MAGIC)) return "application/pdf";
  if (!startsWith(bytes, ZIP_MAGIC)) return null;
  const zip = await openZip(bytes, "unknown");
  if (zip.file("ppt/presentation.xml") !== null) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (zip.file("word/document.xml") !== null) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

/** Open a zip container; a corrupt one is `malformed`, never the library's message. */
export async function openZip(bytes: Uint8Array, format: "pptx" | "docx" | "unknown") {
  try {
    return await JSZip.loadAsync(bytes);
  } catch (cause) {
    throw new ExtractError("malformed", format, { cause });
  }
}

/**
 * Read zip entries one at a time while summing their uncompressed sizes, so a zip bomb stops at
 * `LIMITS.maxUncompressedBytes` instead of exhausting memory (ADR 0027 §5). Only the paths the
 * caller asks for are ever read.
 */
export class ZipReader {
  private read = 0;

  constructor(
    private readonly zip: JSZip,
    private readonly format: "pptx" | "docx",
  ) {}

  has(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  /** Entry paths matching `pattern`, in the archive's order. */
  paths(pattern: RegExp): string[] {
    return Object.keys(this.zip.files).filter((p) => pattern.test(p) && !this.zip.files[p]?.dir);
  }

  async text(path: string): Promise<string | null> {
    const bytes = await this.bytes(path);
    return bytes === null ? null : new TextDecoder().decode(bytes);
  }

  async bytes(path: string): Promise<Uint8Array | null> {
    const entry = this.zip.file(path);
    if (entry === null) return null;
    let data: Uint8Array;
    try {
      data = await entry.async("uint8array");
    } catch (cause) {
      throw new ExtractError("malformed", this.format, { cause });
    }
    this.read += data.byteLength;
    if (this.read > LIMITS.maxUncompressedBytes) throw new ExtractError("too-large", this.format);
    return data;
  }
}

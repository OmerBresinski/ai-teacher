import { extractDocx } from "./formats/docx";
import { extractPaste } from "./formats/paste";
import { extractPdf } from "./formats/pdf";
import { extractPptx } from "./formats/pptx";
import { ExtractError, type ExtractInput, type Extraction, MIME, resolveLimits } from "./types";

export { PASTE_SECTION } from "./formats/paste";
export { sniffContainer, sniffMime } from "./mime";
export { isLowText, isRoster, lineTables, screen } from "./screen";
export {
  ExtractError,
  type ExtractErrorCode,
  type ExtractedChunk,
  type ExtractedImage,
  type ExtractedTable,
  type ExtractInput,
  type Extraction,
  type ExtractionKind,
  type ExtractLimits,
  type ImageMime,
  LIMITS,
  MIME,
  type Refusal,
  resolveLimits,
  type SourceMime,
} from "./types";

/**
 * Parse one document into located text, tables and images (ADR 0027 §2). `mime` is the sniffed
 * type from `sniffMime`, or `text/plain` for a paste. Throws `ExtractError` — never a library
 * error and never document text — when the bytes cannot be read.
 */
export async function extract(input: ExtractInput): Promise<Extraction> {
  const limits = resolveLimits(input.limits);
  switch (input.mime) {
    case MIME.pdf:
      return extractPdf(input.bytes, limits);
    case MIME.pptx:
      return extractPptx(input.bytes, limits);
    case MIME.docx:
      return extractDocx(input.bytes, limits);
    case MIME.paste:
      return extractPaste(new TextDecoder().decode(input.bytes));
    default:
      throw new ExtractError("unsupported", "unknown");
  }
}

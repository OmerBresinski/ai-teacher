import { extractImages, extractText, getDocumentProxy } from "unpdf";
import {
  ExtractError,
  type ExtractedImage,
  type Extraction,
  type ExtractLimits,
  LIMITS,
} from "../types";
import { encodePng } from "./png";

/**
 * PDF → one chunk per page `{ page }` (empty pages are skipped, numbering kept). Images: `unpdf`'s
 * `extractImages(doc, page)` returns **decoded pixels** — `{ data: Uint8Array, width, height,
 * channels, key }` (verified on unpdf 1.8.1, 2026-09-12), not an encoded file — so each is
 * re-encoded as PNG here. Tiny images (icons, rules) under `MIN_IMAGE_SIDE` are dropped. PDFs have
 * no table model; a roster PDF is caught by the identifiers screen and the line-table heuristic.
 *
 * Resource order (TEACH-278, audit F03): the page count is read from the proxy before any page is
 * parsed — over `maxPages` returns an empty extraction carrying the count so `screen` answers
 * `too-long` without a byte of text or image work; text is capped at `maxTextChars`; an image is
 * re-encoded only under `maxImagePixels` and while the running total stays under
 * `maxImageBytesTotal`; the proxy is destroyed in `finally` on every path (unpdf 1.8.1 leaves
 * caller-supplied proxies alive).
 */
const MIN_IMAGE_SIDE = 64;
/** Enough for phase 2 captions; the rest of a picture-heavy PDF is not worth the bucket space. */
const MAX_IMAGES = 40;

export async function extractPdf(
  bytes: Uint8Array,
  limits: ExtractLimits = LIMITS,
): Promise<Extraction> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdfjs transfers the buffer to its worker and leaves the caller's detached (byteLength 0);
    // the API still has to store the original, so it gets a copy.
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new ExtractError("malformed", "pdf");
  }
  try {
    return await readPdf(doc, limits);
  } finally {
    await destroyProxy(doc);
  }
}

/**
 * pdfjs frees a document through its loading task (`withDocument` in unpdf 1.8.1 does the same for
 * proxies it created itself). Never throws: teardown must not mask the extraction's own outcome.
 */
async function destroyProxy(doc: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<void> {
  const task = (doc as { loadingTask?: { destroy?: () => Promise<void> } }).loadingTask;
  try {
    await task?.destroy?.();
  } catch {
    // nothing left to release
  }
}

async function readPdf(
  doc: Awaited<ReturnType<typeof getDocumentProxy>>,
  limits: ExtractLimits,
): Promise<Extraction> {
  const totalPages = doc.numPages;
  if (!Number.isFinite(totalPages) || totalPages < 0) throw new ExtractError("malformed", "pdf");
  if (totalPages > limits.maxPages) {
    // `screen` turns the count into the `too-long` refusal; no page is parsed.
    return { kind: "pdf", pages: totalPages, chunks: [], tables: [], images: [] };
  }

  let pages: string[];
  try {
    pages = (await extractText(doc, { mergePages: false })).text;
  } catch {
    throw new ExtractError("malformed", "pdf");
  }
  let textChars = 0;
  const chunks: Extraction["chunks"] = [];
  for (const [i, raw] of pages.entries()) {
    const text = normalise(raw);
    textChars += text.length;
    if (textChars > limits.maxTextChars) throw new ExtractError("too-large", "pdf");
    if (text.length > 0) chunks.push({ ref: { page: i + 1 }, text });
  }

  const images: ExtractedImage[] = [];
  let imageBytes = 0;
  for (let page = 1; page <= totalPages && images.length < MAX_IMAGES; page++) {
    let raw: Awaited<ReturnType<typeof extractImages>>;
    try {
      raw = await extractImages(doc, page);
    } catch {
      continue; // a page whose images cannot be decoded still contributes its text
    }
    for (const img of raw) {
      if (img.width < MIN_IMAGE_SIDE || img.height < MIN_IMAGE_SIDE) continue;
      // Bounded before the PNG buffer exists: pixels here, encoded total below.
      if (img.width * img.height > limits.maxImagePixels) continue;
      const png = encodePng(img, limits.maxImagePixels);
      if (png === null) continue;
      imageBytes += png.byteLength;
      if (imageBytes > limits.maxImageBytesTotal) break;
      images.push({ ref: { page }, mime: "image/png", bytes: png });
      if (images.length >= MAX_IMAGES) break;
    }
    if (imageBytes > limits.maxImageBytesTotal) break;
  }

  return { kind: "pdf", pages: totalPages, chunks, tables: [], images };
}

function normalise(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

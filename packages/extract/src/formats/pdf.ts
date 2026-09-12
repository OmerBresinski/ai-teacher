import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { ExtractError, type ExtractedImage, type Extraction } from "../types";
import { encodePng } from "./png";

/**
 * PDF → one chunk per page `{ page }` (empty pages are skipped, numbering kept). Images: `unpdf`'s
 * `extractImages(doc, page)` returns **decoded pixels** — `{ data: Uint8Array, width, height,
 * channels, key }` (verified on unpdf 1.8.1, 2026-09-12), not an encoded file — so each is
 * re-encoded as PNG here. Tiny images (icons, rules) under `MIN_IMAGE_SIDE` are dropped. PDFs have
 * no table model; a roster PDF is caught by the identifiers screen and the line-table heuristic.
 */
const MIN_IMAGE_SIDE = 64;
/** Enough for phase 2 captions; the rest of a picture-heavy PDF is not worth the bucket space. */
const MAX_IMAGES = 40;

export async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(bytes);
  } catch {
    throw new ExtractError("malformed", "pdf");
  }
  let pages: string[];
  let totalPages: number;
  try {
    const result = await extractText(doc, { mergePages: false });
    pages = result.text;
    totalPages = result.totalPages;
  } catch {
    throw new ExtractError("malformed", "pdf");
  }

  const chunks = pages
    .map((text, i) => ({ ref: { page: i + 1 }, text: normalise(text) }))
    .filter((c) => c.text.length > 0);

  const images: ExtractedImage[] = [];
  for (let page = 1; page <= totalPages && images.length < MAX_IMAGES; page++) {
    let raw: Awaited<ReturnType<typeof extractImages>>;
    try {
      raw = await extractImages(doc, page);
    } catch {
      continue; // a page whose images cannot be decoded still contributes its text
    }
    for (const img of raw) {
      if (img.width < MIN_IMAGE_SIDE || img.height < MIN_IMAGE_SIDE) continue;
      const png = encodePng(img);
      if (png === null) continue;
      images.push({ ref: { page }, mime: "image/png", bytes: png });
      if (images.length >= MAX_IMAGES) break;
    }
  }

  return { kind: "pdf", pages: totalPages, chunks, tables: [], images };
}

function normalise(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

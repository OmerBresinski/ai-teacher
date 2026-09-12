import { openZip, ZipReader } from "../mime";
import type { ExtractedImage, ExtractedTable, Extraction, ImageMime } from "../types";
import { attrsOf, childrenOf, collectText, findAll, parseXml, type XmlNode } from "./xml";

/**
 * PPTX → one chunk per slide `{ slide }` in numeric order of `ppt/slides/slide<N>.xml`, the
 * slide's speaker notes appended as `Notes: …`; every `a:tbl` becomes a table; pictures are the
 * `ppt/media/*` files the slide's `_rels` points at. Only these entry paths are ever read, through
 * `ZipReader`, which caps the uncompressed bytes (ADR 0027 §5).
 */
const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;
const IMAGE_MIME: Record<string, ImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function extractPptx(bytes: Uint8Array): Promise<Extraction> {
  const reader = new ZipReader(await openZip(bytes, "pptx"), "pptx");
  const slides = reader
    .paths(SLIDE_PATH)
    .map((path) => ({ path, n: Number(SLIDE_PATH.exec(path)?.[1]) }))
    .sort((a, b) => a.n - b.n);

  const chunks: Extraction["chunks"] = [];
  const tables: ExtractedTable[] = [];
  const images: ExtractedImage[] = [];

  for (const { path, n } of slides) {
    const ref = { slide: n };
    const xml = await reader.text(path);
    if (xml === null) continue;
    const tree = parseXml(xml, "pptx");

    const paragraphs = findAll(tree, "a:p")
      .map((p) => collectText(childrenOf(p, "a:p"), "a:t").join("").trim())
      .filter((t) => t.length > 0);
    let text = paragraphs.join("\n");

    const notesXml = await reader.text(`ppt/notesSlides/notesSlide${n}.xml`);
    if (notesXml !== null) {
      const notes = findAll(parseXml(notesXml, "pptx"), "a:p")
        .map((p) => collectText(childrenOf(p, "a:p"), "a:t").join("").trim())
        .filter((t) => t.length > 0)
        .join("\n");
      if (notes.length > 0) text = text.length > 0 ? `${text}\nNotes: ${notes}` : `Notes: ${notes}`;
    }
    if (text.length > 0) chunks.push({ ref, text });

    for (const tbl of findAll(tree, "a:tbl")) {
      const rows = findAll(childrenOf(tbl, "a:tbl"), "a:tr").map((tr) =>
        findAll(childrenOf(tr, "a:tr"), "a:tc").map((tc) => cellText(tc)),
      );
      if (rows.length > 0) tables.push({ ref, rows });
    }

    const rels = await reader.text(`ppt/slides/_rels/slide${n}.xml.rels`);
    if (rels !== null) {
      for (const target of imageTargets(parseXml(rels, "pptx"))) {
        const mime = IMAGE_MIME[target.split(".").pop()?.toLowerCase() ?? ""];
        if (mime === undefined) continue;
        const data = await reader.bytes(`ppt/${target.replace(/^\.\.\//, "")}`);
        if (data !== null) images.push({ ref, mime, bytes: data });
      }
    }
  }

  return { kind: "pptx", pages: slides.length, chunks, tables, images };
}

function cellText(tc: XmlNode): string {
  return findAll(childrenOf(tc, "a:tc"), "a:p")
    .map((p) => collectText(childrenOf(p, "a:p"), "a:t").join("").trim())
    .filter((t) => t.length > 0)
    .join(" ");
}

/** `Target` of every image relationship, e.g. `../media/image1.png`. */
function imageTargets(rels: XmlNode[]): string[] {
  const out: string[] = [];
  for (const rel of findAll(rels, "Relationship")) {
    const attrs = attrsOf(rel);
    if (attrs.Type?.endsWith("/image") && attrs.Target) out.push(attrs.Target);
  }
  return out;
}

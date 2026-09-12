import mammoth from "mammoth";
import { openZip, ZipReader } from "../mime";
import {
  ExtractError,
  type ExtractedChunk,
  type ExtractedImage,
  type ExtractedTable,
  type Extraction,
  type ImageMime,
} from "../types";

/**
 * DOCX → chunks by heading: every `<h1>`–`<h6>` mammoth emits starts a new chunk
 * `{ section: heading }` (text before the first heading is `{ section: "Start" }`); paragraphs and
 * list items become lines; `<table>` rows become `tables[]` under the current section; `<img>`
 * data URLs (mammoth's default) become `images[]`. `pages` is 1: Word has no fixed pagination.
 *
 * Mammoth reads the whole zip itself, so the zip-bomb cap is applied first by opening the
 * container with `ZipReader` and reading `word/document.xml` once (the entry that can be huge).
 */
const SECTION_MAX = 120;
const START_SECTION = "Start";
const IMAGE_MIMES = new Set<string>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function extractDocx(bytes: Uint8Array): Promise<Extraction> {
  const reader = new ZipReader(await openZip(bytes, "docx"), "docx");
  if (!reader.has("word/document.xml")) throw new ExtractError("malformed", "docx");
  await reader.bytes("word/document.xml"); // counts against the uncompressed cap
  for (const media of reader.paths(/^word\/media\//)) await reader.bytes(media);

  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;
  } catch (cause) {
    throw new ExtractError("malformed", "docx", { cause });
  }
  const { chunks, tables, images } = walkHtml(html);
  return { kind: "docx", pages: 1, chunks, tables, images };
}

const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;

/** A tiny tokenizer over mammoth's tidy HTML subset; not a DOM, and not for arbitrary HTML. */
export function walkHtml(html: string): Pick<Extraction, "chunks" | "tables" | "images"> {
  const chunks: ExtractedChunk[] = [];
  const tables: ExtractedTable[] = [];
  const images: ExtractedImage[] = [];

  let section = START_SECTION;
  let lines: string[] = [];
  let line = "";
  let heading: string | null = null;
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let cell = "";

  const flushLine = () => {
    const t = line.trim();
    if (t.length > 0) lines.push(t);
    line = "";
  };
  const flushChunk = () => {
    flushLine();
    if (lines.length > 0) chunks.push({ ref: { section }, text: lines.join("\n") });
    lines = [];
  };

  for (const m of html.matchAll(TOKEN)) {
    const [, close, rawTag, attrs, text] = m;
    if (text !== undefined) {
      const decoded = decodeEntities(text);
      if (heading !== null) heading += decoded;
      else if (row !== null) cell += decoded;
      else line += decoded;
      continue;
    }
    const tag = (rawTag ?? "").toLowerCase();
    const opening = close === "";
    if (/^h[1-6]$/.test(tag)) {
      if (opening) {
        flushChunk();
        heading = "";
      } else {
        section = (heading ?? "").trim().slice(0, SECTION_MAX) || START_SECTION;
        heading = null;
      }
    } else if (tag === "table") {
      if (opening) table = [];
      else {
        if (table !== null && table.length > 0) tables.push({ ref: { section }, rows: table });
        table = null;
      }
    } else if (tag === "tr") {
      if (opening) row = [];
      else {
        if (row !== null && table !== null) table.push(row);
        row = null;
      }
    } else if (tag === "td" || tag === "th") {
      if (opening) cell = "";
      else {
        row?.push(cell.trim());
        // Table text also reaches the chunk, so a spec's objective table still grounds the plan.
        line += ` ${cell.trim()}`;
        cell = "";
      }
    } else if (tag === "img") {
      const src = /src="([^"]*)"/.exec(attrs ?? "")?.[1];
      const image = src ? dataUrlImage(src) : null;
      if (image) images.push({ ref: { section }, ...image });
    } else if (tag === "p" || tag === "li" || tag === "br") {
      if (!opening || tag === "br") flushLine();
    }
  }
  flushChunk();
  return { chunks, tables, images };
}

function dataUrlImage(src: string): Omit<ExtractedImage, "ref"> | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/i.exec(src);
  if (m === null) return null;
  const mime = (m[1] ?? "").toLowerCase();
  if (!IMAGE_MIMES.has(mime)) return null;
  try {
    return { mime: mime as ImageMime, bytes: Uint8Array.from(Buffer.from(m[2] ?? "", "base64")) };
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);|&#(\d+);/g, (m, code) =>
    code !== undefined ? String.fromCodePoint(Number(code)) : (ENTITIES[m] ?? m),
  );
}

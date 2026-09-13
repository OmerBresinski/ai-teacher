import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { encodePng } from "./formats/png";
import { extract, MIME, sniffContainer, sniffMime } from "./index";
import { openZip, ZipReader } from "./mime";
import { docxBomb, docxWith, pdfWithPages, pptxBomb } from "./testing/fixtures";
import { LIMITS, resolveLimits } from "./types";

/**
 * TEACH-278 (audit F02/F03): every ceiling holds **before** the allocation it bounds. These run
 * with scaled-down limits so a 243-byte fixture stands in for a 200 MiB bomb.
 */

/** Bytes an inflater hands out per chunk (pako's default in JSZip). */
const INFLATE_CHUNK = 16 * 1024;

/** Rewrite the central-directory size JSZip read for `path` (what an attacker controls). */
function forgeDeclaredSize(zip: JSZip, path: string, size: number): void {
  const entry = zip.file(path) as unknown as { _data: { uncompressedSize: number } } | null;
  if (!entry) throw new Error(`no entry ${path}`);
  entry._data.uncompressedSize = size;
}

describe("ZipReader streams inflation and stops at the first chunk over the cap", () => {
  test("a high-ratio entry is refused mid-stream, not after full inflation (the F02 repro)", async () => {
    const cap = 4 * INFLATE_CHUNK;
    const entrySize = 64 * INFLATE_CHUNK; // 1 MiB of zeros, ~1 KiB compressed
    const bytes = await pptxBomb(entrySize);
    expect(bytes.byteLength).toBeLessThan(4096);
    const loaded = await openZip(bytes, "pptx");
    // Forge the central directory so the cheap declared-size refusal cannot fire: what is being
    // proven here is the streamed count.
    forgeDeclaredSize(loaded, "ppt/slides/slide1.xml", 1);
    const reader = new ZipReader(
      loaded,
      "pptx",
      resolveLimits({ maxUncompressedBytes: cap, maxEntryBytes: Number.POSITIVE_INFINITY }),
    );
    await expect(reader.bytes("ppt/slides/slide1.xml")).rejects.toMatchObject({
      code: "too-large",
    });
    // The whole entry never sat in memory: counting stopped within one chunk of the cap.
    expect(reader.bytesRead).toBeGreaterThan(cap);
    expect(reader.bytesRead).toBeLessThanOrEqual(cap + INFLATE_CHUNK);
    expect(reader.bytesRead).toBeLessThan(entrySize / 4);
  });

  test("the per-entry cap holds even when the aggregate cap is far away", async () => {
    const bytes = await pptxBomb(64 * INFLATE_CHUNK);
    const loaded = await openZip(bytes, "pptx");
    forgeDeclaredSize(loaded, "ppt/slides/slide1.xml", 1);
    const reader = new ZipReader(
      loaded,
      "pptx",
      resolveLimits({ maxEntryBytes: 2 * INFLATE_CHUNK }),
    );
    await expect(reader.bytes("ppt/slides/slide1.xml")).rejects.toMatchObject({
      code: "too-large",
    });
    expect(reader.bytesRead).toBeLessThanOrEqual(3 * INFLATE_CHUNK);
  });

  test("many small entries cannot evade the aggregate cap", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p/>");
    for (let i = 0; i < 40; i++) zip.file(`ppt/media/${i}.bin`, new Uint8Array(1024));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const reader = new ZipReader(
      await openZip(bytes, "pptx"),
      "pptx",
      resolveLimits({ maxUncompressedBytes: 10 * 1024 }),
    );
    await expect(reader.readAll()).rejects.toMatchObject({ code: "too-large" });
    expect(reader.bytesRead).toBeLessThanOrEqual(11 * 1024);
  });

  test("a forged (small) declared size does not bypass the streamed count", async () => {
    // Build a zip whose central directory claims 1 byte for a 1 MiB entry.
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p/>");
    zip.file("ppt/slides/slide1.xml", new Uint8Array(64 * INFLATE_CHUNK), {
      compression: "DEFLATE",
    });
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const loaded = await openZip(bytes, "pptx");
    forgeDeclaredSize(loaded, "ppt/slides/slide1.xml", 1);
    const reader = new ZipReader(
      loaded,
      "pptx",
      resolveLimits({ maxUncompressedBytes: 4 * INFLATE_CHUNK }),
    );
    await expect(reader.bytes("ppt/slides/slide1.xml")).rejects.toMatchObject({
      code: "too-large",
    });
  });

  test("a declared size over the cap is refused before any inflation", async () => {
    const bytes = await pptxBomb(64 * INFLATE_CHUNK);
    const reader = new ZipReader(
      await openZip(bytes, "pptx"),
      "pptx",
      resolveLimits({ maxUncompressedBytes: 1024 }),
    );
    await expect(reader.bytes("ppt/slides/slide1.xml")).rejects.toMatchObject({
      code: "too-large",
    });
    expect(reader.bytesRead).toBe(0);
  });

  test("too many entries are refused at open, before any entry is read", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p/>");
    for (let i = 0; i < 50; i++) zip.file(`ppt/media/${i}.bin`, "x");
    const loaded = await openZip(await zip.generateAsync({ type: "uint8array" }), "pptx");
    expect(() => new ZipReader(loaded, "pptx", resolveLimits({ maxZipEntries: 20 }))).toThrow(
      expect.objectContaining({ code: "too-large" }),
    );
  });

  test("a legitimate archive under every cap reads unchanged", async () => {
    const bytes = await docxWith([{ paragraphs: ["Photosynthesis makes sugar."] }]);
    const out = await extract({ bytes, mime: MIME.docx, name: "ok.docx" });
    expect(out.chunks[0]?.text).toContain("Photosynthesis");
  });

  test("extract() threads scaled limits through pptx and docx", async () => {
    const limits = { maxUncompressedBytes: 4 * INFLATE_CHUNK };
    await expect(
      extract({ bytes: await pptxBomb(64 * INFLATE_CHUNK), mime: MIME.pptx, name: "b", limits }),
    ).rejects.toMatchObject({ code: "too-large" });
    await expect(
      extract({ bytes: await docxBomb(64 * INFLATE_CHUNK), mime: MIME.docx, name: "b", limits }),
    ).rejects.toMatchObject({ code: "too-large" });
  });
});

describe("PDF ceilings apply before page work", () => {
  test("over maxPages: an empty extraction with the count, no text or image extraction", async () => {
    const bytes = await pdfWithPages(["one", "two", "three"], { imageOnPage: 2 });
    const out = await extract({ bytes, mime: MIME.pdf, name: "long.pdf", limits: { maxPages: 2 } });
    expect(out.pages).toBe(3);
    expect(out.chunks).toEqual([]);
    expect(out.images).toEqual([]);
  });

  test("text over maxTextChars is too-large", async () => {
    const bytes = await pdfWithPages(["a fairly long line of text", "and another"]);
    await expect(
      extract({ bytes, mime: MIME.pdf, name: "t.pdf", limits: { maxTextChars: 10 } }),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  test("an embedded image over maxImagePixels is skipped, the text kept", async () => {
    const bytes = await pdfWithPages(["with a picture"], { imageOnPage: 1 });
    const out = await extract({
      bytes,
      mime: MIME.pdf,
      name: "p.pdf",
      limits: { maxImagePixels: 63 * 63 },
    });
    expect(out.images).toEqual([]);
    expect(out.chunks).toHaveLength(1);
    const kept = await extract({ bytes, mime: MIME.pdf, name: "p.pdf" });
    expect(kept.images).toHaveLength(1);
  });

  test("the encoded-image total is bounded", async () => {
    const bytes = await pdfWithPages(["with a picture"], { imageOnPage: 1 });
    const out = await extract({
      bytes,
      mime: MIME.pdf,
      name: "p.pdf",
      limits: { maxImageBytesTotal: 16 },
    });
    expect(out.images).toEqual([]);
  });

  test("a corrupt PDF is malformed and does not leak the parser's message", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 garbage");
    await expect(extract({ bytes, mime: MIME.pdf, name: "x.pdf" })).rejects.toMatchObject({
      code: "malformed",
      message: "extract(pdf): malformed",
    });
  });
});

describe("encodePng refuses giant dimensions before allocating", () => {
  test("pixel cap and non-integer dimensions", () => {
    const tiny = { data: new Uint8Array(4 * 4 * 3), width: 4, height: 4, channels: 3 };
    expect(encodePng(tiny)).not.toBeNull();
    expect(encodePng(tiny, 15)).toBeNull();
    // A forged header claiming 100k × 100k with a tiny buffer never reaches `new Uint8Array`.
    const forged = { data: new Uint8Array(16), width: 100_000, height: 100_000, channels: 4 };
    expect(encodePng(forged, LIMITS.maxImagePixels)).toBeNull();
    expect(encodePng({ ...tiny, width: 2.5 })).toBeNull();
  });
});

describe("sniffMime bounds the central directory", () => {
  test("a zip with more entries than maxZipEntries is too-large at sniff time", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p/>");
    for (let i = 0; i < 30; i++) zip.file(`ppt/media/${i}.bin`, "x");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(sniffMime(bytes, resolveLimits({ maxZipEntries: 10 }))).rejects.toMatchObject({
      code: "too-large",
    });
    expect(await sniffMime(bytes)).toBe(MIME.pptx);
  });

  test("sniffContainer reads magic bytes only", async () => {
    expect(sniffContainer(new TextEncoder().encode("%PDF-1.4"))).toBe("pdf");
    expect(sniffContainer(await docxWith([{ paragraphs: ["a"] }]))).toBe("zip");
    expect(sniffContainer(new TextEncoder().encode("hello"))).toBeNull();
    expect(sniffContainer(new Uint8Array())).toBeNull();
  });
});

import JSZip from "jszip";
import { ExtractError, type ExtractLimits, LIMITS, type SourceMime } from "./types";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/**
 * The container from the magic bytes alone: `pdf`, `zip` (a PPTX or DOCX candidate) or `null`.
 * Constant work, so the API can answer `unsupported` for anything else without touching a
 * parser; the zip's central directory is read by `sniffMime`, in the extraction child.
 */
export function sniffContainer(bytes: Uint8Array): "pdf" | "zip" | null {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, ZIP_MAGIC)) return "zip";
  return null;
}

/**
 * The document's real type from its bytes (ADR 0027 §2, §5): the type the browser declared is
 * never consulted. A zip is a PPTX when it carries `ppt/presentation.xml`, a DOCX when
 * `word/document.xml`; anything else is `null` and the route answers `unsupported`. Pasted text is
 * never sniffed — the route passes `text/plain` itself. Sniffing reads the central directory only
 * (no entry is inflated) and refuses one with more than `maxZipEntries` entries.
 */
export async function sniffMime(
  bytes: Uint8Array,
  limits: ExtractLimits = LIMITS,
): Promise<SourceMime | null> {
  const container = sniffContainer(bytes);
  if (container === "pdf") return "application/pdf";
  if (container !== "zip") return null;
  const zip = await openZip(bytes, "unknown");
  if (Object.keys(zip.files).length > limits.maxZipEntries) {
    throw new ExtractError("too-large", "unknown");
  }
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
  } catch {
    throw new ExtractError("malformed", format);
  }
}

/** A JSZip streaming helper (`lib/stream/StreamHelper.js`); its typings only cover `nodeStream`. */
interface StreamHelper {
  on(event: "data", cb: (chunk: Uint8Array, meta: unknown) => void): StreamHelper;
  on(event: "error", cb: (error: Error) => void): StreamHelper;
  on(event: "end", cb: () => void): StreamHelper;
  pause(): StreamHelper;
  resume(): StreamHelper;
}

/** JSZip's per-entry internals: central-directory sizes and the chunked inflater. Not typed publicly. */
type EntryInternals = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number; compressedSize?: number };
  internalStream(type: "uint8array"): StreamHelper;
};

/**
 * Read zip entries while **streaming** their inflation, so a zip bomb stops at the first chunk
 * that crosses `maxEntryBytes` / `maxUncompressedBytes` instead of after the whole entry sits in
 * memory (ADR 0027 §5; audit F02 showed the previous `entry.async()` order inflated 8192 bytes
 * before refusing at a 4096 cap). The declared sizes in the central directory give a cheap early
 * refusal but are forged easily, so the streamed count is the limit that holds. Only the paths
 * the caller asks for are ever read; the entry count is bounded at construction.
 */
export class ZipReader {
  private read = 0;

  constructor(
    private readonly zip: JSZip,
    private readonly format: "pptx" | "docx",
    private readonly limits: ExtractLimits = LIMITS,
  ) {
    if (Object.keys(zip.files).length > limits.maxZipEntries) {
      throw new ExtractError("too-large", format);
    }
  }

  /** Inflated bytes counted so far across every entry read. */
  get bytesRead(): number {
    return this.read;
  }

  has(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  /** Entry paths matching `pattern`, in the archive's order. */
  paths(pattern: RegExp): string[] {
    return Object.keys(this.zip.files).filter((p) => pattern.test(p) && !this.zip.files[p]?.dir);
  }

  /**
   * Inflate every entry once, counting towards the caps, keeping nothing. For a container a
   * library will re-read on its own (mammoth opens the DOCX itself), this is the only way to know
   * the whole archive stays under the caps before handing it over: inflation is deterministic, so
   * the library's pass over the same entries cannot produce more bytes than this one counted.
   */
  async readAll(): Promise<void> {
    for (const path of this.paths(/./)) await this.stream(path, false);
  }

  async text(path: string): Promise<string | null> {
    const bytes = await this.bytes(path);
    return bytes === null ? null : new TextDecoder().decode(bytes);
  }

  async bytes(path: string): Promise<Uint8Array | null> {
    return this.stream(path, true);
  }

  private tooLarge(): ExtractError {
    return new ExtractError("too-large", this.format);
  }

  private stream(path: string, keep: boolean): Promise<Uint8Array | null> {
    const entry = this.zip.file(path) as EntryInternals | null;
    if (entry === null) return Promise.resolve(null);
    const { maxEntryBytes, maxUncompressedBytes } = this.limits;

    // Cheap refusal on the declared size — never the only check (the field is attacker-written).
    const declared = entry._data?.uncompressedSize;
    if (typeof declared === "number" && declared >= 0) {
      if (declared > maxEntryBytes || this.read + declared > maxUncompressedBytes) {
        return Promise.reject(this.tooLarge());
      }
    }

    return new Promise<Uint8Array | null>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      let settled = false;
      const fail = (error: ExtractError) => {
        if (settled) return;
        settled = true;
        try {
          helper.pause();
        } catch {
          // already finished
        }
        reject(error);
      };
      const helper = entry.internalStream("uint8array");
      helper.on("data", (chunk: Uint8Array) => {
        if (settled) return;
        entryBytes += chunk.byteLength;
        this.read += chunk.byteLength;
        if (entryBytes > maxEntryBytes || this.read > maxUncompressedBytes) {
          fail(this.tooLarge());
          return;
        }
        if (keep) chunks.push(chunk);
      });
      helper.on("error", () => fail(new ExtractError("malformed", this.format)));
      helper.on("end", () => {
        if (settled) return;
        settled = true;
        if (!keep) {
          resolve(null);
          return;
        }
        const out = new Uint8Array(entryBytes);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.byteLength;
        }
        resolve(out);
      });
      helper.resume();
    });
  }
}

import { parseStorageKey } from "@tj/domain";

export const INLINE_SAFE_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const EXECUTABLE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
]);

function mediaType(raw: string): string | undefined {
  const type = raw.split(";")[0]?.trim().toLowerCase();
  if (!type || !/^[^/\s]+\/[^/\s]+$/.test(type)) return undefined;
  return type;
}

export function safeContentType(raw: string): string {
  const type = mediaType(raw);
  if (
    !type ||
    EXECUTABLE_TYPES.has(type) ||
    type.includes("javascript") ||
    type.includes("ecmascript")
  ) {
    return "application/octet-stream";
  }
  return raw;
}

export function downloadHeaders(input: {
  key: string;
  contentType: string;
}): Record<string, string> {
  const parsed = parseStorageKey(input.key);
  if (!parsed.ok) throw new Error("downloadHeaders requires a valid storage key");

  const filename = parsed.value.parts.at(-1);
  if (!filename) throw new Error("downloadHeaders requires a storage key filename");
  const contentType = safeContentType(input.contentType);
  const disposition = INLINE_SAFE_TYPES.has(mediaType(contentType) ?? "") ? "inline" : "attachment";
  const quotedFilename = Array.from(filename, (character) =>
    character === '"' || character < " " || character > "~" ? "_" : character,
  ).join("");

  return {
    "content-type": contentType,
    "content-disposition": `${disposition}; filename="${quotedFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "content-security-policy": "default-src 'none'; sandbox",
  };
}

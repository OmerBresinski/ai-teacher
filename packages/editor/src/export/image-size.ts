/**
 * A raster data URL's pixel size, read from its header (PNG IHDR, JPEG SOFn, GIF, WebP), so the
 * PowerPoint export can turn an image's crop and focal point into the same window the editor shows
 * (TEACH-25 part b). Undefined for anything it cannot read.
 */
export function dataUrlImageSize(dataUrl: string): { w: number; h: number } | undefined {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return undefined;
  const meta = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  let bytes: Uint8Array;
  try {
    // the header is in the first few kB; a JPEG's SOF may sit after large EXIF, so read up to 64 kB
    const head = meta.endsWith(";base64") ? body.slice(0, 87_384) : body;
    bytes = meta.endsWith(";base64")
      ? Uint8Array.from(atob(head.slice(0, head.length - (head.length % 4))), (c) =>
          c.charCodeAt(0),
        )
      : new TextEncoder().encode(decodeURIComponent(head));
  } catch {
    return undefined;
  }
  return imageSize(bytes);
}

export function imageSize(b: Uint8Array): { w: number; h: number } | undefined {
  const u16 = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const u32 = (i: number) => ((u16(i) << 16) >>> 0) + u16(i + 2);
  const le16 = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { w, h } : undefined);
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ok(u32(16), u32(20));
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(le16(6), le16(8));
  // WebP
  if (u32(0) === 0x52494646 && u32(8) === 0x57454250) {
    const kind = String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0);
    if (kind === "VP8 ") return ok(le16(26) & 0x3fff, le16(28) & 0x3fff);
    if (kind === "VP8L") {
      const v = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return ok((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1);
    }
    if (kind === "VP8X")
      return ok(
        1 + ((b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16)),
        1 + ((b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16)),
      );
    return undefined;
  }
  // JPEG: walk the markers to a start-of-frame
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) return undefined;
      const m = b[p + 1] ?? 0;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return ok(u16(p + 7), u16(p + 5));
      p += 2 + u16(p + 2);
    }
  }
  return undefined;
}

import { ExtractError } from "./types";

/**
 * Bound classic ZIP metadata before JSZip creates its entry objects. Uses constant auxiliary
 * memory and counts actual records, not the attacker-written EOCD count. ZIP64/multi-disk and
 * ambiguous offset layouts are refused; a Source's 25 MiB upload / 200 MiB expansion ceilings
 * do not require those formats. No names or entry contents are decoded here.
 */
export function checkZipDirectory(
  bytes: Uint8Array,
  maxEntries: number,
  format: "pptx" | "docx" | "unknown",
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const malformed = () => new ExtractError("malformed", format);
  const tooLarge = () => new ExtractError("too-large", format);
  let end = -1;
  // Match JSZip's last-signature choice, and reject a misleading signature inside a comment
  // rather than validate one EOCD while letting JSZip interpret a different one.
  for (let offset = bytes.length - 4; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0 || end + 22 > bytes.length) throw malformed();
  if (end + 22 + view.getUint16(end + 20, true) !== bytes.length) throw malformed();
  const declared = view.getUint16(end + 10, true);
  if (declared > maxEntries) throw tooLarge();
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== declared
  )
    throw malformed();
  const size = view.getUint32(end + 12, true);
  let position = view.getUint32(end + 16, true);
  if (position + size !== end) throw malformed();
  let count = 0;
  while (position < end) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw malformed();
    if (++count > maxEntries) throw tooLarge();
    const next =
      position +
      46 +
      view.getUint16(position + 28, true) +
      view.getUint16(position + 30, true) +
      view.getUint16(position + 32, true);
    if (next > end) throw malformed();
    const local = view.getUint32(position + 42, true);
    if (local + 30 > position || view.getUint32(local, true) !== 0x04034b50) throw malformed();
    if (view.getUint16(position + 34, true) !== 0) throw malformed();
    if (
      view.getUint32(position + 20, true) === 0xffffffff ||
      view.getUint32(position + 24, true) === 0xffffffff
    )
      throw tooLarge();
    position = next;
  }
  if (count !== declared) throw malformed();
}

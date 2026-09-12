import type { ExtractedTable, Extraction } from "../types";

/**
 * Pasted text → one chunk `{ section: "Pasted text" }`. When three or more lines split on tabs
 * into the same number (≥ 2) of columns, they are also read as one table so the roster screen can
 * see a class list pasted from a spreadsheet. `pages` is 1.
 */
export const PASTE_SECTION = "Pasted text";

export function extractPaste(text: string): Extraction {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  const chunks =
    normalised.length > 0 ? [{ ref: { section: PASTE_SECTION }, text: normalised }] : [];
  const tables: ExtractedTable[] = [];
  const rows = normalised
    .split("\n")
    .filter((l) => l.includes("\t"))
    .map((l) => l.split("\t").map((c) => c.trim()));
  const width = rows[0]?.length ?? 0;
  if (rows.length >= 3 && width >= 2 && rows.every((r) => r.length === width)) {
    tables.push({ ref: { section: PASTE_SECTION }, rows });
  }
  return { kind: "paste", pages: 1, chunks, tables, images: [] };
}

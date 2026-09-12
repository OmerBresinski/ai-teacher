import type { SourceLocator } from "@tj/domain/documents";
import { findNamePatterns } from "@tj/domain/documents";
import { type ExtractedTable, type Extraction, LIMITS, type Refusal } from "./types";

/*
 * The upload screens (ADR 0027 §2), in order, first hit wins. Deterministic and overridable by no
 * one (F03-D5: err toward refusal). Nothing here logs; the caller logs the reason only.
 */

/** Two or more capitalised words: "Amelia Jones", "Jean-Luc Picard", "Siobhán O'Neill". */
const NAME = /^[A-Z][a-zà-ÿ'’-]+(\s[A-Z][a-zà-ÿ'’-]+)+$/;
const ATTRIBUTE = [
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/, // date d/m/y
  /^\d{4}-\d{2}-\d{2}$/, // ISO date
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/, // email
  /^\d{4,}$/, // id / UPN / admission number
  /^[A-U*]\+?$|^\d{1,3}%?$/, // grade or percentage
  /^(m|f|male|female|boy|girl)$/i, // gender token
];
/** A bare year is a fact about history, not a person; it never counts as an attribute. */
const YEAR = /^(1[0-9]{3}|20[0-9]{2})$/;

const NAME_SHARE = 0.6;
const ATTRIBUTE_SHARE = 0.6;
const SINGLE_COLUMN_SHARE = 0.8;
const MIN_ROWS = 5;
/** Consecutive lines that split into the same column count are read as a table. */
const LINE_SPLIT = /\t|\s{2,}/;

export function screen(extraction: Extraction): Refusal | null {
  if (extraction.pages > LIMITS.maxPages) return { reason: "too-long", pages: extraction.pages };

  for (const table of [...extraction.tables, ...lineTables(extraction)]) {
    if (isRoster(table.rows)) return { reason: "roster", ref: table.ref };
  }

  let count = 0;
  let first: SourceLocator | null = null;
  for (const chunk of extraction.chunks) {
    const hits = findNamePatterns(chunk.text).length;
    if (hits > 0) {
      count += hits;
      first ??= chunk.ref;
    }
  }
  if (first !== null) return { reason: "identifiers", count, ref: first };

  if (isLowText(extraction) && extraction.images.length === 0) return { reason: "unreadable" };
  return null;
}

/** Thin text: under `minTextChars` in total or under `minCharsPerPage` on average. */
export function isLowText(extraction: Extraction): boolean {
  const total = extraction.chunks.reduce((n, c) => n + c.text.length, 0);
  const pages = Math.max(1, extraction.pages);
  return total < LIMITS.minTextChars || total / pages < LIMITS.minCharsPerPage;
}

function share(cells: string[], test: (cell: string) => boolean): number {
  if (cells.length === 0) return 0;
  return cells.filter(test).length / cells.length;
}

const isAttribute = (cell: string) => !YEAR.test(cell) && ATTRIBUTE.some((re) => re.test(cell));
const isName = (cell: string) => NAME.test(cell);

/**
 * (a) a name column beside a personal-attribute column, or (b) a single column that is mostly
 * names, five rows or more. The first row is treated as a header and ignored when the table has
 * more than one row.
 */
export function isRoster(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  const body = rows.length > 1 ? rows.slice(1) : rows;
  if (body.length === 0) return false;
  const width = Math.max(...rows.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) =>
    body.map((r) => (r[i] ?? "").trim()).filter((c) => c.length > 0),
  );

  if (width === 1) {
    const col = columns[0] ?? [];
    return col.length >= MIN_ROWS && share(col, isName) >= SINGLE_COLUMN_SHARE;
  }
  const nameColumns = columns
    .map((col, i) => ({ col, i }))
    .filter(({ col }) => col.length > 0 && share(col, isName) >= NAME_SHARE);
  if (nameColumns.length === 0) return false;
  return columns.some(
    (col, i) =>
      !nameColumns.some((n) => n.i === i) &&
      col.length > 0 &&
      share(col, isAttribute) >= ATTRIBUTE_SHARE,
  );
}

/** Runs of ≥ MIN_ROWS consecutive lines that split into the same ≥ 2 columns (PDF and paste). */
export function lineTables(extraction: Extraction): ExtractedTable[] {
  if (extraction.kind !== "pdf" && extraction.kind !== "paste") return [];
  const out: ExtractedTable[] = [];
  for (const chunk of extraction.chunks) {
    let run: string[][] = [];
    const flush = () => {
      if (run.length >= MIN_ROWS) out.push({ ref: chunk.ref, rows: run });
      run = [];
    };
    for (const line of chunk.text.split("\n")) {
      const cells = line
        .trim()
        .split(LINE_SPLIT)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      const width = run[0]?.length;
      if (cells.length >= 2 && (width === undefined || cells.length === width)) {
        run.push(cells);
      } else {
        flush();
        if (cells.length >= 2) run.push(cells);
      }
    }
    flush();
  }
  return out;
}

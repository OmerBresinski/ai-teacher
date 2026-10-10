// Long tables (UX ruling 197, register content-01 / diagrams-10): a table the writer wrote longer
// than its slot holds is packed into up to 4 columns, and what still does not fit continues as a
// table on the next slide. Words are never cut or rewritten; rows keep their order.

type S = Record<string, unknown>;
type Table = S & { kind: "table"; header?: string[] | null; rows: string[][] };

const isTable = (f: unknown): f is Table =>
  !!f &&
  typeof f === "object" &&
  (f as S).kind === "table" &&
  Array.isArray((f as S).rows) &&
  ((f as S).rows as unknown[]).every((r) => Array.isArray(r));

/** A writer table as the drawer reads it: `shows` and null fields dropped. */
export const drawable = (t: S): S =>
  Object.fromEntries(Object.entries(t).filter(([k, v]) => v !== null && k !== "shows"));

/** The most columns a packed table takes (ruling 197). */
export const PACK_COLUMNS = 4;

/**
 * A table of two-cell rows (a number and its word, a term and its meaning) set as two halves side
 * by side: rows 1..k on the left, k+1..n on the right, the header repeated. Undefined when the
 * table is not two columns wide or has fewer than 2 rows.
 */
export function packRows(t: Table): Table | undefined {
  const cols = Math.max(t.header?.length ?? 0, ...t.rows.map((r) => r.length));
  if (cols !== 2 || t.rows.length < 2) return undefined;
  const half = Math.ceil(t.rows.length / 2);
  const rows = t.rows
    .slice(0, half)
    .map((r, k) => [...pad(r), ...pad(t.rows[half + k] ?? ["", ""])]);
  return { ...t, ...(t.header ? { header: [...t.header, ...t.header] } : {}), rows };
}
const pad = (r: string[]) => [r[0] ?? "", r[1] ?? ""];

/**
 * A slide's table spread over as many slides as it needs. `fits(table, first)` says whether a
 * table draws in the slide's own slot (`first`) or on a continuation slide. A table that fits as
 * written is left alone (undefined). Otherwise each slide takes the longest run of rows, in order,
 * that fits, packed into 4 columns when it is a two-column table; continuation slides are big
 * visuals headed "<heading> (continued)". Undefined when even one row cannot fit.
 */
export function continueTable(
  slide: S,
  fits: (t: Table, first: boolean) => boolean,
): { first: S; rest: S[] } | undefined {
  const f = slide.figure;
  if (!isTable(f) || f.rows.length < 2 || fits(f, true)) return undefined;
  const chunk = (rows: string[][]): Table => {
    const t = { ...f, rows };
    return packRows(t) ?? t;
  };
  const parts: Table[] = [];
  let at = 0;
  while (at < f.rows.length) {
    let take = 0;
    for (let k = f.rows.length - at; k >= 1; k--)
      if (fits(chunk(f.rows.slice(at, at + k)), parts.length === 0)) {
        take = k;
        break;
      }
    if (!take) return undefined;
    parts.push(chunk(f.rows.slice(at, at + take)));
    at += take;
  }
  const [head, ...tail] = parts;
  if (!head) return undefined;
  const heading = String(slide.heading ?? "");
  return {
    first: { ...slide, figure: head },
    rest: tail.map((t) => ({
      template: "big-visual",
      heading: `${heading} (continued)`,
      lead: null,
      figure: t,
    })),
  };
}

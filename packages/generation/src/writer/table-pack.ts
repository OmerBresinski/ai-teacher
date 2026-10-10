import { LIMITS } from "@tj/slides/diagrams";

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

/** How many entries a chunk holds (a packed row holds two). */
const entries = (t: Table, pairs: boolean) =>
  pairs
    ? t.rows.reduce((a, r) => a + (r.slice(2).some((x) => x.trim()) ? 2 : 1), 0)
    : t.rows.length;

/** The most rows one slide's table draws: the drawer's table limit (`LIMITS.table.rows`). */
export const MAX_ROWS = LIMITS.table.rows;
/** A table spreads over at most this many slides: its own and three continuations. */
export const MAX_SLIDES = 4;

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
 * The table's entries in reading order. A 4-column table whose header repeats a 2-column header
 * (Nombre, Français, Nombre, Français) is two lists side by side: the left column read down, then
 * the right, as one 2-column list. Any other table is its rows.
 */
export function readingRows(t: Table): { rows: string[][]; pairs: boolean } {
  const h = t.header;
  const twoCol = Math.max(h?.length ?? 0, ...t.rows.map((r) => r.length)) === 2;
  if (twoCol) return { rows: t.rows.map(pad), pairs: true };
  const sideBySide =
    !!h && h.length === 4 && h[0] === h[2] && h[1] === h[3] && t.rows.every((r) => r.length === 4);
  if (!sideBySide) return { rows: t.rows, pairs: false };
  const left = t.rows.map((r) => [r[0] ?? "", r[1] ?? ""]);
  const right = t.rows.map((r) => [r[2] ?? "", r[3] ?? ""]).filter((r) => r.some((x) => x.trim()));
  return { rows: [...left, ...right], pairs: true };
}

/**
 * A slide's table spread over as many slides as it needs. `fits(slide, first)` says whether a
 * candidate slide lays out with its table whole (`first`: the slide itself, else a continuation).
 * A slide that fits as written (`asWritten`: its own slot's check) is left alone (undefined). Otherwise each slide takes the longest
 * run of consecutive entries that fits; a 2-column list is packed into 4 columns, its first half
 * down the left and the rest down the right (1-6 | 7-12), so reading order holds across slides. A
 * picture-and-words slide goes across the slide (its points as key cards, ruling 194) so its first
 * part holds as many rows as a continuation. Continuation slides are big visuals headed
 * "<heading> (continued)". Undefined when even one entry cannot fit.
 */
export function continueTable(
  slide: S,
  fits: (s: S, first: boolean, asWritten?: boolean) => boolean,
): { first: S; rest: S[] } | undefined {
  const f = slide.figure;
  if (!isTable(f) || f.rows.length < 2 || fits(slide, true, true)) return undefined;
  const { rows: list, pairs } = readingRows(f);
  const header = pairs && f.header ? f.header.slice(0, 2) : f.header;
  const chunk = (rows: string[][]): Table => {
    const t = { ...f, header: header ?? null, rows };
    return (pairs ? packRows(t) : undefined) ?? t;
  };
  const top: S =
    slide.template === "visual-text"
      ? { ...slide, template: "big-visual", cardsUnder: true }
      : slide;
  const cont = (t: Table): S => ({
    template: "big-visual",
    heading: `${String(slide.heading ?? "")} (continued)`,
    lead: null,
    figure: t,
  });
  // Bounded search: a slide holds at most MAX_ROWS drawn rows (the drawer's own table limit), so
  // at most twice that many entries when packed; the longest run that fits is found by bisection
  // (fit is monotone in the run's length), a handful of layouts per slide, and a table needing more
  // than MAX_SLIDES slides is not split (it takes the old path).
  const most = pairs ? 2 * MAX_ROWS : MAX_ROWS;
  const parts: Table[] = [];
  let at = 0;
  while (at < list.length) {
    if (parts.length === MAX_SLIDES) return undefined;
    const ok = (k: number) => {
      const t = chunk(list.slice(at, at + k));
      return fits(parts.length ? cont(t) : { ...top, figure: t }, parts.length === 0);
    };
    let lo = 0;
    let hi = Math.min(most, list.length - at);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ok(mid)) lo = mid;
      else hi = mid - 1;
    }
    if (!lo) return undefined;
    parts.push(chunk(list.slice(at, at + lo)));
    at += lo;
  }
  const [head, ...tail] = parts;
  if (!head) return undefined;
  // The continuation slides share what is left evenly (not 12 rows then 2): the same number of
  // slides, each taking its share of the consecutive entries, never more than fitted greedily.
  const after = list.slice(list.length - tail.reduce((a, t) => a + entries(t, pairs), 0));
  const even: Table[] = [];
  for (let k = 0, at2 = 0; k < tail.length; k++) {
    const share = Math.ceil((after.length - at2) / (tail.length - k));
    even.push(chunk(after.slice(at2, at2 + share)));
    at2 += share;
  }
  const balanced = even.every((t) => fits(cont(t), false)) ? even : tail;
  return { first: { ...top, figure: head }, rest: balanced.map(cont) };
}

const SLIDE_REF = /\b([Ss]lides?)(\s+)(\d+)\b/g;
const REF_TEST = /\b[Ss]lides?\s+\d+\b/;

/**
 * Slide numbers said in words ("see slide 7", "Slides 4") rewritten to where those slides sit in
 * the deck after continuation slides were inserted (`at`: plan number to deck number). Notes and
 * every text element are rewritten; a slide whose numbers all stay is returned as it was. A number
 * the map does not know is left alone.
 */
export function renumberSlideRefs<T extends { notes?: string; elements: unknown[] }>(
  slides: T[],
  at: Map<number, number>,
): T[] {
  if ([...at].every(([plan, deck]) => plan === deck)) return slides;
  const fix = (t: string) =>
    t.replace(SLIDE_REF, (m, word: string, sp: string, n: string) => {
      const to = at.get(Number(n));
      return to === undefined ? m : `${word}${sp}${to}`;
    });
  // Every `text` string inside an element (plain text or a rich-text doc's text nodes).
  const deep = (v: unknown, key = ""): unknown => {
    if (typeof v === "string") return key === "text" && REF_TEST.test(v) ? fix(v) : v;
    if (Array.isArray(v)) {
      const out = v.map((x) => deep(x, key));
      return out.every((x, k) => x === v[k]) ? v : out;
    }
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      out[k] = deep(x, k);
      if (out[k] !== x) changed = true;
    }
    return changed ? out : v;
  };
  return slides.map((s) => {
    const elements = s.elements.map((e) => deep(e));
    const notes = typeof s.notes === "string" ? fix(s.notes) : s.notes;
    return notes === s.notes && elements.every((e, k) => e === s.elements[k])
      ? s
      : { ...s, notes, elements };
  });
}

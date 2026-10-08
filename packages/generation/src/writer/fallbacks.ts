import { resolveAsks, type VisualState } from "./materialise";

/*
 * The writer stage's fallbacks for a figure that cannot be shown, ported from the pinned writer:
 * a diagram of a real thing becomes a picture of it, a table becomes words that keep its data,
 * anything else stands in words; a last-resort strip that still overflows carries its list onto
 * continuation slides.
 */

type S = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const isDia = (f: unknown): f is S => !!f && typeof f === "object" && "kind" in (f as object);
const isPic = (f: unknown): f is S =>
  !!f && typeof f === "object" && "shows" in (f as object) && !("kind" in (f as object));

/** Diagram kinds that are data: a picture cannot stand in for them. */
export const DATA_KINDS = new Set([
  "table",
  "line-graph",
  "bar-chart",
  "bar-model",
  "number-line",
  "pie",
  "venn",
  "carroll",
  "hydrograph",
]);
/** Code-drawn kinds whose meaning a picture cannot carry (counts, shares, states, links). */
export const MEANING_KINDS = new Set(["equal-groups", "fraction-shapes", "particles", "flow"]);
export const pictureFallbackOk = (kind: string | undefined) =>
  !!kind && !DATA_KINDS.has(kind) && !MEANING_KINDS.has(kind);

/** A table's data as header and rows. */
export type TableData = { header?: string[]; rows: string[][] };
/** A table's header and rows from its spec, else from the ask's labels when they divide into rows. */
export function tableRows(v: VisualState | undefined, ask: { labels?: string[] }): TableData {
  const spec = (v as { spec?: { header?: string[]; rows?: string[][] } } | undefined)?.spec;
  let header = spec?.header;
  let rows = spec?.rows;
  if (!rows?.length) {
    const l = ask.labels ?? [];
    const cols = l.findIndex((x) => /^[\d.,−-]+$/.test(x.trim()));
    if (cols > 0 && (l.length - cols) % cols === 0) {
      header = l.slice(0, cols);
      rows = [];
      for (let k = cols; k < l.length; k += cols) rows.push(l.slice(k, k + cols));
    }
  }
  return { ...(header?.length ? { header } : {}), rows: rows ?? [] };
}

/** The slide as words only: every ask line is its stand-alone form, the figure dropped. */
export function asWords(raw: S): S {
  const s = resolveAsks(raw, () => false);
  const { figure: _f, picture: _p, ...rest } = s;
  const tpl = String(s.template);
  return {
    ...rest,
    template: ["diagram-text", "picture-text", "big-diagram", "big-picture"].includes(tpl)
      ? "explain"
      : tpl,
    lead: str(s.lead),
    ...(Array.isArray(s.points) ? { points: s.points } : {}),
    ...(Array.isArray(s.questions) ? { questions: s.questions } : {}),
    ...(typeof s.prompt === "string" ? { prompt: s.prompt } : {}),
    ...(typeof s.stem === "string" ? { stem: s.stem } : {}),
  };
}

/** A table that cannot draw, as cards or labelled points (a row's first cell names it). */
export function asTableText(raw: S, table: TableData): S {
  const s = resolveAsks(raw, () => false);
  const { header, rows } = table;
  const cell = (r: string[], k: number) => (header?.[k] ? `${header[k]}: ${r[k]}` : (r[k] ?? ""));
  // A column whose cells are all the same says nothing per row: it goes in the lead.
  const cols = (rows[0] ?? []).map((_, k) => k);
  const same = cols.filter(
    (k) => k > 0 && rows.length > 1 && rows.every((r) => r[k] === rows[0]?.[k]),
  );
  const keep = cols.filter((k) => k > 0 && !same.includes(k));
  const rest = (r: string[]) =>
    keep
      .map((k) => cell(r, k))
      .filter((x) => x.trim())
      .join("; ");
  const constant = same.map((k) => cell(rows[0] ?? [], k)).join("; ");
  const lead = [str(s.lead), constant ? `${constant}.` : ""].filter(Boolean).join(" ");
  const name = (r: string[]) =>
    header?.[0] && /^\d/.test(r[0] ?? "") ? `${header[0]} ${r[0]}` : (r[0] ?? "");
  if (rows.length >= 2 && rows.length <= 4 && keep.length)
    return {
      template: "compare",
      heading: str(s.heading),
      ...(lead ? { lead } : {}),
      columns: rows.map((r) => ({ label: name(r), text: rest(r), picture: null })),
    };
  return {
    template: "explain",
    heading: str(s.heading),
    lead,
    points: rows.map((r) => (keep.length ? { label: name(r), text: rest(r) } : name(r))),
  };
}

/** A diagram of a real thing that could not draw, as a picture of the same thing. */
export function asPicture(raw: S): S | undefined {
  const s = { ...raw };
  const swap: Record<string, [string, string]> = {
    "diagram-text": ["picture-text", "picture"],
    "big-diagram": ["big-picture", "picture"],
  };
  for (const k of ["figure", "diagram", "picture"]) {
    const f = s[k];
    if (!isDia(f)) continue;
    // An ask written for the drawing may not fit a photo: the picture carries the stand-alone line.
    const alone = f.ask_without ?? null;
    // The drawing's labels name what pupils must see in the picture.
    const labels = Array.isArray(f.labels) ? (f.labels as unknown[]).map(str) : [];
    const pic = {
      shows: f.shows,
      must_see: labels.filter((l) => l.trim().length > 1).slice(0, 4),
      subject: "generic",
      ask: alone,
      ask_without: alone,
    };
    const to = swap[str(s.template)];
    delete s[k];
    if (to) {
      s.template = to[0];
      s[to[1]] = pic;
    } else s[k === "diagram" ? "picture" : k] = pic;
    return s;
  }
  return undefined;
}
void isPic;

const LIST_KEYS = ["points", "questions"] as const;
/**
 * The last-resort strip never ships overflow: its list items are carried onto continuation slides
 * of the same layout, each keeping the longest run of items, in order, that fits. Words are never
 * cut or rewritten; a slide with no such list, or whose first item cannot fit alone, is left.
 */
export function continueForFit(
  slide: S,
  fits: (s: S) => boolean,
): { first: S; rest: S[] } | undefined {
  const key = LIST_KEYS.find((k) => Array.isArray(slide[k]) && (slide[k] as unknown[]).length >= 2);
  if (!key) return undefined;
  const items = slide[key] as unknown[];
  const cont = (c: unknown[]): S => {
    const s: S = { template: slide.template, heading: slide.heading, [key]: c };
    for (const [k, v] of Object.entries(slide))
      if (!(k in s))
        s[k] = typeof v === "string" ? (k === "lead" ? "" : null) : Array.isArray(v) ? [] : null;
    return s;
  };
  const chunks: unknown[][] = [];
  let at = 0;
  while (at < items.length) {
    let take = 0;
    for (let k = items.length - at; k >= 1; k--) {
      const part = items.slice(at, at + k);
      if (fits(chunks.length ? cont(part) : { ...slide, [key]: part })) {
        take = k;
        break;
      }
    }
    if (!take) return undefined;
    chunks.push(items.slice(at, at + take));
    at += take;
  }
  if (chunks.length < 2) return undefined;
  const [head, ...tail] = chunks;
  return { first: { ...slide, [key]: head }, rest: tail.map(cont) };
}

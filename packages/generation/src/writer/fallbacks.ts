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

/** A picture field as the writer writes one: `shows` is what is searched for, never missing. */
export type PictureField = {
  shows: string;
  must_see: string[];
  subject: "named" | "generic";
  ask: unknown;
  ask_without: unknown;
};

/**
 * What a diagram shows, as a picture's `shows`: a freeform figure's own `shows`, else a library
 * model's `intent` (it has no `shows`), its `alt`, its caption or the slide's heading. Empty when
 * none of them has words.
 */
export function diagramShows(f: S, slide: S): string {
  for (const v of [f.shows, f.intent, f.alt, f.caption, slide.heading]) {
    const t = str(v).trim();
    if (t) return t;
  }
  return "";
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
    // A picture with nothing to search for is no fallback: the slide keeps its other routes.
    const shows = diagramShows(f, raw);
    if (!shows) return undefined;
    const pic: PictureField = {
      shows,
      must_see: labels.filter((l) => l.trim()),
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

/**
 * Tile diagrams that could not be shown (TEACH-75 part d), each as a picture of the same thing:
 * `col.n` a compare card's visual, `seq.n` a sequence stage. Undefined when a lost tile is not a
 * diagram or its kind is not a thing or process (`pictureFallbackOk`): the slide then takes its
 * words-only form (text cards, numbered steps), never an empty tile.
 */
export function tilesAsPictures(raw: S, keys: string[]): S | undefined {
  const s: S = { ...raw };
  const cols = Array.isArray(s.columns) ? (s.columns as S[]).map((c) => ({ ...c })) : undefined;
  const seq = Array.isArray(s.sequence) ? (s.sequence as S[]).map((x) => ({ ...x })) : undefined;
  for (const key of keys) {
    const m = /^(col|seq)\.(\d+)$/.exec(key);
    const n = Number(m?.[2]);
    const host = m?.[1] === "col" ? cols?.[n] : m?.[1] === "seq" ? seq?.[n] : undefined;
    const f = host ? (m?.[1] === "col" ? host.picture : host.diagram) : undefined;
    if (!host || !isDia(f) || !pictureFallbackOk(str(f.kind))) return undefined;
    const labels = Array.isArray(f.labels) ? (f.labels as unknown[]).map(str) : [];
    const alone = f.ask_without ?? null;
    const pic: S = {
      shows: str(f.shows) || str(host.label) || str(host.caption),
      must_see: labels.filter((l) => l.trim()),
      subject: "generic",
      ...(m?.[1] === "col" ? { ask: alone, ask_without: alone } : {}),
    };
    if (!pic.shows) return undefined;
    if (m?.[1] === "col") host.picture = pic;
    else {
      delete host.diagram;
      Object.assign(host, pic);
    }
  }
  if (cols) s.columns = cols;
  if (seq) s.sequence = seq;
  return s;
}

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

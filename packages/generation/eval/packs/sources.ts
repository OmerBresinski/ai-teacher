import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackSource, Sentence } from "./schema";

/*
 * Source fetching and sentence numbering for topic packs (lab only). Polite by construction:
 * one named user agent, robots.txt read and honoured for the path, at most one request per
 * `MIN_INTERVAL_MS` per host, the raw page cached on local disk OUTSIDE the repo
 * (`scratchpad/data/sources/`, see `DEFAULT_CACHE_DIR`) so a page is fetched once. Wikipedia is
 * read through its REST HTML endpoint and the revision id is recorded from the response header;
 * any other page records the ETag or, failing that, a sha256 of the body.
 *
 * Text handling is mechanical: HTML → section headings and paragraphs → sentences split on
 * terminal punctuation with a short abbreviation guard. Nothing here judges what a sentence
 * means; the numbering is what a fact's `evidence.sentenceIds` cites.
 */

export const USER_AGENT = "ai-teacher-lab/0.1 (topic-pack experiment; +https://dayback.app)";
export const MIN_INTERVAL_MS = 1000;
export const DEFAULT_CACHE_DIR = join(import.meta.dir, "../../../../..", "data", "sources");

export type SourceKind = "wikipedia" | "html";

export interface SourceRequest {
  kind: SourceKind;
  /** Wikipedia: the page title (`Causes_of_World_War_I`); html: the full URL. */
  ref: string;
  licence: PackSource["licence"];
}

export interface FetchedPage {
  url: string;
  title: string;
  html: string;
  headers: Record<string, string>;
  revision: string;
  fetchedAt: string;
  fromCache: boolean;
}

/** Wikipedia REST: `/page/html/{title}`; the page URL is recorded as the canonical article URL. */
export function wikipediaUrls(title: string): { api: string; page: string } {
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  return {
    api: `https://en.wikipedia.org/api/rest_v1/page/html/${t}`,
    page: `https://en.wikipedia.org/wiki/${t}`,
  };
}

export const slugOf = (ref: string): string =>
  ref
    .replace(/^https?:\/\//, "")
    .replace(/[^A-Za-z0-9.,_-]+/g, "_")
    .slice(0, 120);

/* ----------------------------------------------------------------------------------------- */
/* robots.txt and rate limiting                                                              */
/* ----------------------------------------------------------------------------------------- */

const robotsCache = new Map<string, string[]>();
const lastRequestAt = new Map<string, number>();

/** The `Disallow` prefixes for `User-agent: *` (and for our own agent name, if listed). */
export function disallowedPrefixes(robots: string, agent = USER_AGENT): string[] {
  const out: string[] = [];
  let applies = false;
  const ours = agent.split("/")[0]?.toLowerCase() ?? "";
  for (const raw of robots.split("\n")) {
    const lineText = raw.replace(/#.*$/, "").trim();
    if (!lineText) continue;
    const [key, ...rest] = lineText.split(":");
    const value = rest.join(":").trim();
    const k = key?.trim().toLowerCase();
    if (k === "user-agent") {
      applies = value === "*" || value.toLowerCase() === ours;
    } else if (k === "disallow" && applies && value) {
      out.push(value);
    }
  }
  return out;
}

export function isAllowed(pathname: string, prefixes: string[]): boolean {
  return !prefixes.some((p) => pathname.startsWith(p));
}

async function robotsFor(host: string, fetchImpl: typeof fetch): Promise<string[]> {
  const cached = robotsCache.get(host);
  if (cached) return cached;
  let prefixes: string[] = [];
  try {
    const res = await fetchImpl(`https://${host}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
    });
    if (res.ok) prefixes = disallowedPrefixes(await res.text());
  } catch {
    prefixes = [];
  }
  robotsCache.set(host, prefixes);
  return prefixes;
}

async function politeDelay(host: string): Promise<void> {
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(host, Date.now());
}

/* ----------------------------------------------------------------------------------------- */
/* Fetch with cache                                                                          */
/* ----------------------------------------------------------------------------------------- */

export interface FetchOptions {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
  refresh?: boolean;
}

function parseHeaderFile(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const l of text.split("\n")) {
    const i = l.indexOf(":");
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return headers;
}

export function revisionOf(headers: Record<string, string>, body: string): string {
  const rev = headers["content-revision-id"];
  if (rev) return rev;
  const etag = headers.etag;
  if (etag) {
    const m = etag.match(/^W?\/?"?(\d+)\//);
    if (m?.[1]) return m[1];
    return etag;
  }
  return `sha256:${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
}

/** Fetch one page, from the cache when it is there. Refuses a path robots.txt disallows. */
export async function fetchPage(
  req: SourceRequest,
  options: FetchOptions = {},
): Promise<FetchedPage> {
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const fetchImpl = options.fetchImpl ?? fetch;
  const { api, page } =
    req.kind === "wikipedia" ? wikipediaUrls(req.ref) : { api: req.ref, page: req.ref };
  const slug = slugOf(req.kind === "wikipedia" ? req.ref.replace(/ /g, "_") : req.ref);
  await mkdir(cacheDir, { recursive: true });
  const htmlPath = join(cacheDir, `${slug}.html`);
  const headersPath = join(cacheDir, `${slug}.headers`);
  const cached = !options.refresh && (await stat(htmlPath).catch(() => null));
  if (cached) {
    const html = await readFile(htmlPath, "utf8");
    const headers = parseHeaderFile(await readFile(headersPath, "utf8").catch(() => ""));
    return {
      url: page,
      title: titleOf(html) ?? req.ref,
      html,
      headers,
      revision: revisionOf(headers, html),
      fetchedAt: cached.mtime.toISOString(),
      fromCache: true,
    };
  }
  const u = new URL(api);
  // robots.txt governs the article being read (its `/wiki/` path). Wikipedia's file disallows
  // `/api/` to crawlers while its own comment points programmatic clients at the REST endpoint,
  // whose etiquette (a named agent, ≤ 1 request/s, no parallel fetches) this fetcher follows.
  const governed = new URL(page);
  const prefixes = await robotsFor(u.host, fetchImpl);
  if (!isAllowed(governed.pathname, prefixes))
    throw new Error(`robots.txt disallows ${governed.pathname} on ${u.host}`);
  await politeDelay(u.host);
  const res = await fetchImpl(api, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });
  if (!res.ok) throw new Error(`${api}: HTTP ${res.status}`);
  const html = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const fetchedAt = new Date().toISOString();
  await writeFile(htmlPath, html);
  await writeFile(
    headersPath,
    `HTTP ${res.status}\n${Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")}\n`,
  );
  return {
    url: page,
    title: titleOf(html) ?? req.ref,
    html,
    headers,
    revision: revisionOf(headers, html),
    fetchedAt,
    fromCache: false,
  };
}

/* ----------------------------------------------------------------------------------------- */
/* HTML → headed paragraphs → numbered sentences                                             */
/* ----------------------------------------------------------------------------------------- */

const STOP_HEADINGS = new Set([
  "references",
  "see also",
  "notes",
  "external links",
  "further reading",
  "bibliography",
  "sources",
  "citations",
  "footnotes",
  "explanatory notes",
]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Tags gone, reference markers and edit links dropped, entities decoded, whitespace collapsed. */
export function stripHtml(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<sup[^>]*class="[^"]*\breference\b[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, "")
      .replace(/<span[^>]*class="[^"]*\bmw-editsection\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<(style|script|math|table|figure|figcaption)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      // Inline tags vanish (no space, so "photo<a>pigment</a>-bearing" stays one word); block tags space.
      .replace(
        /<\/?(a|span|b|i|em|strong|abbr|sup|sub|small|cite|q|link|meta|bdi|wbr)(\s[^>]*)?\/?>/gi,
        "",
      )
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\[\d+\]|\[[a-z]\]|\[citation needed\]/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .trim();
}

export function titleOf(html: string): string | undefined {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1]).trim() : undefined;
}

export interface Paragraph {
  heading: string;
  text: string;
}

/**
 * Headings (`h1`–`h4`) and paragraphs (`p`) in document order; everything from the first stop
 * heading (References, See also, …) onward is dropped. Tables, figures and boxes are not read.
 */
export function paragraphsOf(html: string, rootTitle: string): Paragraph[] {
  const body = html.replace(/<(style|script|table|figure)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const re = /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>|<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi;
  const out: Paragraph[] = [];
  const path: string[] = [rootTitle];
  let stopped = false;
  for (let m = re.exec(body); m && !stopped; m = re.exec(body)) {
    if (m[1]) {
      const level = Number(m[1][1]);
      const heading = stripHtml(m[2] ?? "");
      if (!heading) continue;
      if (STOP_HEADINGS.has(heading.toLowerCase())) {
        stopped = true;
        break;
      }
      path.length = Math.max(1, level - 1);
      path[level - 1] = heading;
      continue;
    }
    const text = stripHtml(m[3] ?? "");
    if (text.length < 40) continue;
    out.push({ heading: path.filter(Boolean).join(" > "), text });
  }
  return out;
}

const ABBREVIATIONS =
  /\b(e\.g|i\.e|etc|cf|vs|c|ca|St|Dr|Mr|Mrs|Ms|Prof|Jr|Sr|No|fig|pp|p|vol|ch|AD|BC)\.$/i;

/** Sentences of one paragraph: split after `.`, `!` or `?` followed by a capital, digit or quote. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let current = "";
  const tokens = text.split(/(?<=[.!?]["'”’)]?)\s+(?=["'“‘(]?[A-Z0-9])/);
  for (const t of tokens) {
    current = current ? `${current} ${t}` : t;
    if (ABBREVIATIONS.test(current)) continue;
    out.push(current.trim());
    current = "";
  }
  if (current.trim()) out.push(current.trim());
  return out.filter((s) => s.length >= 12);
}

/** Every sentence of a page, numbered `s<ordinal>.<n>` in reading order. */
export function numberSentences(paragraphs: Paragraph[], sourceOrdinal: number): Sentence[] {
  const out: Sentence[] = [];
  let n = 0;
  for (const p of paragraphs)
    for (const text of splitSentences(p.text))
      out.push({ id: `s${sourceOrdinal}.${++n}`, heading: p.heading, text });
  return out;
}

/** A fetched page as a pack source with its numbered sentences. */
export function toPackSource(
  page: FetchedPage,
  ordinal: number,
  licence: PackSource["licence"],
): PackSource {
  const title = page.title.replace(/ - Wikipedia$/, "");
  return {
    id: `s${ordinal}`,
    url: page.url,
    title,
    revision: page.revision,
    fetchedAt: page.fetchedAt,
    licence,
    sentences: numberSentences(paragraphsOf(page.html, title), ordinal),
  };
}

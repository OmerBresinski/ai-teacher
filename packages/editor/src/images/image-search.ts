/**
 * Web image search behind the Add image panel (TeachDeck `lib/image-search.ts`, Openverse half).
 *
 * Openverse (`api.openverse.org`) is called straight from the browser: no key, and it answers with
 * `access-control-allow-origin: *`, so no proxy route is needed while the project is frontend-only
 * (TEACH-107). The query is filtered to `commercial,modification` licences, which is what a
 * teacher can safely reuse in a deck. Tenor GIF search is not ported — it needs a client-side key.
 *
 * Everything here is pure mapping plus one `fetch`, so the mapping and the credit line are
 * testable without a DOM.
 */

export type StockImage = {
  id: string;
  title: string;
  creator?: string;
  /** Full-size file, fetched and inlined at insert time when CORS allows it. */
  url: string;
  /** Grid thumbnail. */
  thumbnail: string;
  width?: number;
  height?: number;
  /** "Water Cycle by Ada Lovelace, CC BY 2.0" — stored on the element. */
  credit: string;
  /** The page the image came from, for the credit link. */
  landingUrl?: string;
  licenseUrl?: string;
};

/** One page of results plus the cursor that fetches the next one. */
export type SearchPage = {
  results: StockImage[];
  /** Opaque: a page number for Openverse. */
  next?: string;
};

export const OPENVERSE_ENDPOINT = "https://api.openverse.org/v1/images/";
/** Openverse answers 401 with "page_size may not exceed 20" without a key. */
export const OPENVERSE_PAGE_SIZE = 20;

/* ------------------------------------------------------------------ */
/* Credit                                                              */
/* ------------------------------------------------------------------ */

const LICENCE_NAMES: Record<string, string> = {
  cc0: "CC0",
  pdm: "Public domain",
  by: "CC BY",
  "by-sa": "CC BY-SA",
  "by-nc": "CC BY-NC",
  "by-nd": "CC BY-ND",
  "by-nc-sa": "CC BY-NC-SA",
  "by-nc-nd": "CC BY-NC-ND",
  "sampling+": "CC Sampling+",
  "nc-sampling+": "CC NC-Sampling+",
};

/** "by" + "2.0" → "CC BY 2.0". Unknown codes are upper-cased rather than dropped. */
export function licenceLabel(license?: string, version?: string): string {
  const code = license?.trim().toLowerCase();
  if (!code) return "";
  const name = LICENCE_NAMES[code] ?? code.toUpperCase();
  const v = version?.trim();
  // "Public domain 1.0" reads as a version number of the idea, not the mark.
  if (!v || v === "0" || code === "pdm") return name;
  return `${name} ${v}`;
}

/** The one line we store on the element and show in the image drawer. */
export function formatCredit(parts: {
  title?: string;
  creator?: string;
  license?: string;
}): string {
  const title = parts.title?.trim() || "Untitled";
  const creator = parts.creator?.trim();
  const license = parts.license?.trim();
  let credit = title;
  if (creator) credit += ` by ${creator}`;
  if (license) credit += `, ${license}`;
  return credit;
}

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * Hosts we know answer on https, so an `http:` row from the API can be upgraded rather than
 * dropped. Openverse indexes old records that still carry a plain-http file URL for a host that
 * has served https for years.
 */
const HTTPS_HOSTS = [
  "staticflickr.com",
  "flickr.com",
  "wikimedia.org",
  "wikipedia.org",
  "openverse.org",
  "creativecommons.org",
  "si.edu",
  "nasa.gov",
  "smithsonianmag.com",
];

const knownHost = (host: string) =>
  HTTPS_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));

/**
 * A remote file URL we are willing to load: https as given, http upgraded for a host we know,
 * anything else (an unknown http host, `javascript:`, `data:`) dropped. A slide is served over
 * https, so an http image would be blocked as mixed content anyway — better to lose the row than
 * show a hole.
 *
 * The text is returned verbatim rather than through `URL.toString()`, which re-encodes and would
 * change a signed CDN path.
 */
export function httpsUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol === "https:") return raw;
  if (protocol !== "http:") return undefined;
  if (!knownHost(url.hostname.toLowerCase())) return undefined;
  return raw.replace(/^http:/i, "https:");
}

/**
 * A credit or licence link. Wider than `httpsUrl` — this one is only ever followed by a click, so
 * plain http on any host is fine — but still refused for `javascript:` and friends.
 */
export function safeLinkUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const protocol = new URL(raw).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:" ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** A search that failed, carrying the HTTP status so the panel can say why. */
export class SearchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Openverse                                                           */
/* ------------------------------------------------------------------ */

export function openverseUrl(query: string, page = 1): string {
  const params = new URLSearchParams({
    q: query,
    license_type: "commercial,modification",
    page_size: String(OPENVERSE_PAGE_SIZE),
    page: String(page),
  });
  return `${OPENVERSE_ENDPOINT}?${params}`;
}

/** One Openverse row → a `StockImage`, or null when it has no usable file. */
export function mapOpenverseResult(raw: unknown): StockImage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Json;
  const id = str(row.id);
  const url = httpsUrl(str(row.url));
  if (!id || !url) return null;
  const title = str(row.title) ?? "Untitled";
  const creator = str(row.creator);
  const license = licenceLabel(str(row.license), str(row.license_version));
  return {
    id,
    title,
    creator,
    url,
    thumbnail: httpsUrl(str(row.thumbnail)) ?? url,
    width: num(row.width),
    height: num(row.height),
    credit: formatCredit({ title, creator, license }),
    landingUrl: safeLinkUrl(str(row.foreign_landing_url)),
    licenseUrl: safeLinkUrl(str(row.license_url)),
  };
}

export function parseOpenversePage(raw: unknown, page = 1): SearchPage {
  const body = (raw ?? {}) as Json;
  const rows = Array.isArray(body.results) ? body.results : [];
  const results = rows.map(mapOpenverseResult).filter((r): r is StockImage => r !== null);
  const pageCount = num(body.page_count) ?? 0;
  // Keyed off the raw rows, not the mapped ones: a page where every row was an http host we do
  // not know still has a next page worth asking for.
  return { results, next: page < pageCount && rows.length > 0 ? String(page + 1) : undefined };
}

export async function searchOpenverse(
  query: string,
  { cursor, signal }: { cursor?: string; signal?: AbortSignal } = {},
): Promise<SearchPage> {
  const page = Number(cursor) || 1;
  const response = await fetch(openverseUrl(query, page), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new SearchError(`Openverse answered ${response.status}`, response.status);
  return parseOpenversePage(await response.json(), page);
}

/* ------------------------------------------------------------------ */
/* Fetching the bytes                                                  */
/* ------------------------------------------------------------------ */

/** A GIF is inlined frame-for-frame, so it earns a tighter cap than a still. */
export const MAX_GIF_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** A host that accepts the connection and then stalls must not hang the tile. */
export const FETCH_TIMEOUT_MS = 15_000;

const EXTENSION_TYPES: Record<string, string> = {
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
};

/**
 * The MIME type implied by the file extension. Some CDNs answer a GIF with no `Content-Type` at
 * all; without this the File would be typed `image/jpeg` and `fileToDataUrl` would redraw it
 * through a canvas, flattening the animation to its first frame.
 */
export function typeFromUrl(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const extension = pathname.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension];
}

export const maxBytesFor = (type: string): number =>
  type === "image/gif" ? MAX_GIF_BYTES : MAX_IMAGE_BYTES;

const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol.toLowerCase() === "https:";
  } catch {
    return false;
  }
};

/**
 * The remote file as a `File`, so the upload path (downscale, re-encode, GIF and SVG passthrough)
 * can handle it.
 *
 * Null means "insert the URL instead": the host refused CORS, answered an error, or handed back
 * more bytes than a lesson should carry. An abort from the caller's own signal is rethrown rather
 * than flattened to null — the panel has moved on, and inserting a link into a closed panel is
 * worse than nothing. The 15s timeout is deliberately not an abort in that sense: it falls back
 * to the link like any other failure.
 */
export async function fetchRemoteImage(url: string, signal?: AbortSignal): Promise<File | null> {
  if (!isHttps(url)) return null;
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { mode: "cors", signal: combined });
    if (!response.ok) return null;

    const header = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const type = header?.startsWith("image/") ? header : (typeFromUrl(url) ?? "image/jpeg");
    const limit = maxBytesFor(type);

    // Content-Length first: refusing before the body is read saves the download.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) return null;

    const blob = await response.blob();
    // And again after: the header is a claim, the blob is the fact.
    if (!blob.size || blob.size > limit) return null;
    return new File([blob], `image.${type.split("/")[1] ?? "jpg"}`, { type });
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

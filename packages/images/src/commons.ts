/**
 * Wikimedia Commons photo search (UX ruling 139: Pexels for everyday scenes, Commons for named,
 * specific things). Server-only, like the Pexels client.
 *
 * One MediaWiki API call per search (`generator=search` over the File: namespace with
 * `imageinfo` + `extmetadata`), then a licence filter in code: public domain, CC0, CC BY and
 * CC BY-SA only, public domain and CC0 preferred when the candidates are otherwise equal. Files
 * with restrictions (trademark, personality rights) and non-photographs (SVG, PNG logos, maps,
 * flags) are refused unless the caller asks for drawings. Every accepted file carries its author,
 * licence, licence URL and file page, which the stored image keeps (never shown on a slide).
 *
 * API etiquette: a descriptive User-Agent, `maxlag`, and one request at a time per client with a
 * short gap between requests.
 */
import { z } from "zod";
import type { PhotoResult } from "./pexels";

const API_URL = "https://commons.wikimedia.org/w/api.php";
/** Wikimedia asks for a descriptive agent with a way to reach the operator. */
export const COMMONS_USER_AGENT = "DaybackLessonPhotos/0.1 (https://dayback.app) @tj/images";
/** The rendition width asked for; smaller renditions are derived from its thumb URL. */
const LARGE_WIDTH = 1280;
// Wikimedia's thumbnail host serves only its standard widths (20, 40, 60, 120, 250, 330, 500, 960,
// 1280, ...); any other width is a 400, and a candidate whose tiny rendition 400s was dropped
// (smoke pw7: slide 6's named fort found 2+ files on Commons and all were dropped).
const MEDIUM_WIDTH = 500;
const TINY_WIDTH = 250;
/** The least gap between two requests from one client. */
const MIN_GAP_MS = 250;

export type CommonsLicence = "public-domain" | "cc0" | "cc-by" | "cc-by-sa";

/** A Commons file's reuse terms, as stored on the image element. */
export interface CommonsCredit {
  author: string;
  /** The licence as Commons names it ("CC BY-SA 4.0", "Public domain"). */
  licence: string;
  licenceUrl?: string;
  /** The file's page on Commons. */
  sourceUrl: string;
}

const Meta = z.object({ value: z.unknown() }).partial();
const ImageInfoSchema = z.object({
  url: z.string(),
  descriptionurl: z.string(),
  thumburl: z.string().optional(),
  thumbwidth: z.number().optional(),
  thumbheight: z.number().optional(),
  width: z.number(),
  height: z.number(),
  mime: z.string(),
  extmetadata: z.record(z.string(), Meta).optional(),
});
const PageSchema = z.object({
  pageid: z.number(),
  title: z.string(),
  index: z.number().optional(),
  imageinfo: z.array(ImageInfoSchema).optional(),
  categories: z.array(z.object({ title: z.string() })).optional(),
});
const ResponseSchema = z.object({
  query: z.object({ pages: z.array(PageSchema) }).optional(),
});
export type CommonsPage = z.infer<typeof PageSchema>;

const metaText = (meta: Record<string, { value?: unknown }> | undefined, key: string): string => {
  const v = meta?.[key]?.value;
  return typeof v === "string" ? stripHtml(v) : "";
};

/** Commons metadata values are HTML fragments; the stored credit is plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The licence class of a Commons `LicenseShortName`, or undefined when it is not one we reuse
 * (NC, ND, GFDL-only, fair use, "copyrighted", anything unrecognised).
 */
export function licenceClass(shortName: string): CommonsLicence | undefined {
  const s = shortName.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  if (/\b(nc|nd|non ?commercial|no ?deriv)/.test(s)) return undefined;
  if (s === "public domain" || s === "pd" || /^pd\b/.test(s) || s.startsWith("public domain"))
    return "public-domain";
  if (/^cc0\b|^cc zero\b|^cc 0\b/.test(s)) return "cc0";
  const cc = /^cc by( sa)?(?: \d(?:\.\d)?)?(?: [a-z]{2,3}(?: [a-z]{2})?)?$/.exec(s);
  if (cc) return cc[1] ? "cc-by-sa" : "cc-by";
  return undefined;
}

/** Words in a file's title or description that mark it as a drawing, not a photograph. */
const DRAWING = /\b(map|maps|logo|logos|flag|coat of arms|diagram|chart|icon|emblem|seal)\b/i;
const PHOTO_MIME = new Set(["image/jpeg", "image/webp"]);

export type CommonsVerdict =
  | { ok: true; licence: CommonsLicence; credit: CommonsCredit }
  | { ok: false; reason: string };

/**
 * Whether a Commons file may be placed: a photograph (JPEG/WebP, not a map or logo unless
 * `allowDrawings`), under a licence we reuse, with no restrictions, and with an author when the
 * licence needs attribution.
 */
export function judgeCommonsFile(
  page: CommonsPage,
  opts: { allowDrawings?: boolean; diagrams?: boolean } = {},
): CommonsVerdict {
  const info = page.imageinfo?.[0];
  if (!info) return { ok: false, reason: "no image info" };
  // Round H: a diagram search keeps only drawings and plain images (SVG, PNG), never photographs,
  // scans or documents.
  if (opts.diagrams && !DIAGRAM_MIME.has(info.mime))
    return { ok: false, reason: `not a diagram (${info.mime})` };
  const meta = info.extmetadata;
  const title = page.title.replace(/^File:/i, "");
  if (!opts.allowDrawings) {
    if (!PHOTO_MIME.has(info.mime)) return { ok: false, reason: `not a photograph (${info.mime})` };
    const described = `${title} ${metaText(meta, "ObjectName")}`;
    if (DRAWING.test(described)) return { ok: false, reason: "a map, logo or drawing" };
  }
  const restrictions = metaText(meta, "Restrictions");
  if (restrictions) return { ok: false, reason: `restricted (${restrictions})` };
  const shortName = metaText(meta, "LicenseShortName");
  const licence = licenceClass(shortName);
  if (!licence) return { ok: false, reason: `licence not reused (${shortName || "none"})` };
  const author = metaText(meta, "Artist") || metaText(meta, "Credit");
  const needsAuthor = licence === "cc-by" || licence === "cc-by-sa";
  if (needsAuthor && !author) return { ok: false, reason: "no author for an attribution licence" };
  if (!info.descriptionurl.startsWith("https://"))
    return { ok: false, reason: "file page is not https" };
  const licenceUrl = metaText(meta, "LicenseUrl");
  const credit: CommonsCredit = {
    author: author || "Unknown author",
    licence: shortName,
    ...(licenceUrl.startsWith("http")
      ? { licenceUrl: licenceUrl.replace(/^http:/, "https:") }
      : {}),
    sourceUrl: info.descriptionurl,
  };
  return { ok: true, licence, credit };
}

const DIAGRAM_MIME = new Set(["image/svg+xml", "image/png"]);

const TIER: Record<CommonsLicence, number> = {
  "public-domain": 0,
  cc0: 0,
  "cc-by": 1,
  "cc-by-sa": 1,
};
/** Search results this many places apart are "otherwise equal" for the licence preference. */
const RANK_BAND = 4;

/**
 * The accepted files in search order, public domain and CC0 ahead of CC BY / BY-SA within each
 * band of `RANK_BAND` results (a free licence never outranks a much better match).
 */
export function rankCommons<T extends { rank: number; licence: CommonsLicence }>(files: T[]): T[] {
  return [...files].sort(
    (a, b) =>
      Math.floor(a.rank / RANK_BAND) - Math.floor(b.rank / RANK_BAND) ||
      TIER[a.licence] - TIER[b.licence] ||
      a.rank - b.rank,
  );
}

/** A Wikimedia thumb URL at another width (`/1280px-Name.jpg` -> `/200px-Name.jpg`). */
function atWidth(thumb: string, width: number): string {
  return thumb.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
}

/** A Commons photo in the shape the pipeline already judges and stores. */
export type CommonsPhoto = PhotoResult & {
  provider: "commons";
  credit: CommonsCredit;
  licenceClass: CommonsLicence;
};

function toPhoto(
  page: CommonsPage,
  credit: CommonsCredit,
  licence: CommonsLicence,
): CommonsPhoto | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const large = info.thumburl ?? info.url;
  if (!large.startsWith("https://")) return null;
  const scaled = info.thumburl !== undefined && info.thumbwidth !== undefined;
  const width = scaled ? (info.thumbwidth as number) : info.width;
  const height = scaled ? (info.thumbheight ?? info.height) : info.height;
  const alt =
    metaText(info.extmetadata, "ImageDescription").slice(0, 200) ||
    page.title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
  const about = [
    page.title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, ""),
    metaText(info.extmetadata, "ImageDescription").slice(0, 400),
    metaText(info.extmetadata, "ObjectName"),
    ...(page.categories ?? []).map((c) => c.title.replace(/^Category:/i, "")),
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: `commons-${page.pageid}`,
    about,
    width,
    height,
    alt,
    photographer: credit.author,
    photographerUrl: credit.sourceUrl,
    pageUrl: credit.sourceUrl,
    src: {
      large,
      medium: info.thumburl ? atWidth(info.thumburl, MEDIUM_WIDTH) : large,
      tiny: info.thumburl ? atWidth(info.thumburl, TINY_WIDTH) : large,
    },
    provider: "commons",
    credit,
    licenceClass: licence,
  };
}

/** The accepted, ranked photos of one API response (pure; the tests' fixtures go through here). */
export function commonsPhotosOf(
  body: unknown,
  opts: { allowDrawings?: boolean; diagrams?: boolean } = {},
): CommonsPhoto[] {
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) return [];
  const pages = [...(parsed.data.query?.pages ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  const accepted: { rank: number; licence: CommonsLicence; photo: CommonsPhoto }[] = [];
  pages.forEach((page, rank) => {
    const v = judgeCommonsFile(page, opts);
    if (!v.ok) return;
    const photo = toPhoto(page, v.credit, v.licence);
    if (photo) accepted.push({ rank, licence: v.licence, photo });
  });
  return rankCommons(accepted).map((a) => a.photo);
}

export class CommonsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CommonsError";
    this.status = status;
  }
}

export interface CommonsSearchParams {
  query: string;
  perPage?: number;
  allowDrawings?: boolean;
  /** Round H: drawings only (the File: namespace's SVG and PNG diagrams), same licence rules. */
  diagrams?: boolean;
  signal?: AbortSignal;
  /**
   * How many photos come back with their `src.tiny` inlined as a data URL (default 8); the rest
   * are dropped. The picture judge's model provider cannot fetch upload.wikimedia.org itself
   * (smoke par2: every Commons judge call failed "provider request failed"), so the thumbnail it
   * looks at is fetched here, with our User-Agent.
   */
  inline?: number;
}

/** A thumbnail this large (bytes) is not inlined; 200 px JPEGs are ~10-30 KB. */
const MAX_THUMB_BYTES = 120_000;

/** The first `limit` photos whose tiny rendition downloads, each with `src.tiny` as a data URL. */
export async function inlineThumbnails(
  photos: CommonsPhoto[],
  limit: number,
  fetchFn: typeof globalThis.fetch,
  agent: string,
  signal?: AbortSignal,
): Promise<CommonsPhoto[]> {
  const out: CommonsPhoto[] = [];
  for (const photo of photos) {
    if (out.length >= limit) break;
    try {
      const res = await fetchFn(photo.src.tiny, {
        headers: { "User-Agent": agent },
        ...(signal ? { signal } : {}),
      });
      const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!res.ok || !/^image\/(jpeg|webp|png)$/.test(type)) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_THUMB_BYTES) continue;
      const tiny = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
      out.push({ ...photo, src: { ...photo.src, tiny } });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
    }
  }
  return out;
}

export interface CommonsClient {
  search(params: CommonsSearchParams): Promise<CommonsPhoto[]>;
}

export function createCommonsClient(
  opts: { fetch?: typeof globalThis.fetch; userAgent?: string; apiUrl?: string } = {},
): CommonsClient {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const agent = opts.userAgent ?? COMMONS_USER_AGENT;
  // One request at a time per client, at least MIN_GAP_MS apart.
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  const politely = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await task();
      } finally {
        last = Date.now();
      }
    });
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    search: ({ query, perPage = 20, allowDrawings, diagrams, signal, inline = 8 }) =>
      politely(async () => {
        const url = new URL(opts.apiUrl ?? API_URL);
        const p = url.searchParams;
        p.set("action", "query");
        p.set("format", "json");
        p.set("formatversion", "2");
        p.set("maxlag", "5");
        p.set("generator", "search");
        p.set("gsrnamespace", "6");
        p.set(
          "gsrsearch",
          diagrams
            ? `${query} filetype:drawing`
            : allowDrawings
              ? query
              : `${query} filetype:bitmap`,
        );
        p.set("gsrlimit", String(Math.min(Math.max(perPage, 1), 50)));
        p.set("prop", "imageinfo|categories");
        p.set("clshow", "!hidden");
        p.set("cllimit", "max");
        p.set("iiprop", "url|size|mime|extmetadata");
        p.set("iiurlwidth", String(LARGE_WIDTH));
        p.set(
          "iiextmetadatafilter",
          "LicenseShortName|LicenseUrl|Artist|Credit|Restrictions|ImageDescription|ObjectName",
        );
        const res = await fetchFn(url.toString(), {
          headers: { "User-Agent": agent, "Api-User-Agent": agent },
          ...(signal ? { signal } : {}),
        });
        if (!res.ok) throw new CommonsError(res.status, `Commons search failed (${res.status})`);
        const photos = commonsPhotosOf(await res.json(), {
          allowDrawings: allowDrawings || diagrams,
          ...(diagrams ? { diagrams } : {}),
        });
        return inlineThumbnails(photos, inline, fetchFn, agent, signal);
      }),
  };
}

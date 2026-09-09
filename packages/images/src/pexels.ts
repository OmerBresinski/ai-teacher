/**
 * Pexels photo search client (Images project, server-only).
 *
 * The browser never sees the key: `apps/api` (`GET /images/search`) and, later, `apps/worker`
 * (pipeline placement) share this client. Upstream bodies are parsed with Zod; photos whose page
 * or rendition URLs are not `https:` are dropped so a stored value is always safe to render.
 * `fetch`, `Response` and `AbortSignal` are web-standard types (not Bun-only), so they may appear
 * in these signatures without breaking the browser type-check of `@tj/api-client` / `apps/web`.
 */
import { z } from "zod";

const BASE_URL = "https://api.pexels.com/v1";
const DEFAULT_LOCALE = "en-GB";
const DEFAULT_PER_PAGE = 24;

export type PhotoOrientation = "landscape" | "portrait" | "square";

/** One Pexels photo, mapped to the shape the api returns and the editor consumes. */
export interface PhotoResult {
  /** `String(photo.id)`: Pexels sends a number, `PhotoSourceSchema.id` is a string. */
  id: string;
  width: number;
  height: number;
  alt: string;
  photographer: string;
  photographerUrl: string;
  /** The photo's page on Pexels (`url` upstream). */
  pageUrl: string;
  src: {
    large: string;
    medium: string;
    tiny: string;
  };
}

export interface PhotoSearchPage {
  photos: PhotoResult[];
  /** `page + 1` when Pexels sent `next_page`, else `null`. */
  nextPage: number | null;
  /**
   * Set only by the api's blocklist gate (never by Pexels): the query was refused without an
   * upstream call. Optional so `AppType` stays one shape across the search responses.
   */
  blocked?: boolean;
}

export interface PexelsSearchParams {
  query: string;
  orientation?: PhotoOrientation;
  page?: number;
  perPage?: number;
  /** Defaults to `en-GB` (project requirement); see the retry below. */
  locale?: string;
  signal?: AbortSignal;
}

/** Any non-2xx upstream answer. `429` carries `retryAfterS` when Pexels sent `X-Ratelimit-Reset`. */
export class PexelsError extends Error {
  readonly status: number;
  readonly retryAfterS?: number;
  constructor(status: number, message: string, retryAfterS?: number) {
    super(message);
    this.name = "PexelsError";
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

export interface PexelsClient {
  search(params: PexelsSearchParams): Promise<PhotoSearchPage>;
  /**
   * One photo by Pexels id. `null` on 404 (or when the returned photo has no usable
   * `https:` URLs); other non-2xx answers throw `PexelsError` like `search`.
   */
  photo(id: string, signal?: AbortSignal): Promise<PhotoResult | null>;
}

export interface CreatePexelsClientOptions {
  apiKey: string;
  /** Tests pass a stub; production uses the global. Never mutated. */
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

const PexelsPhotoSchema = z.object({
  id: z.number(),
  width: z.number(),
  height: z.number(),
  url: z.string(),
  photographer: z.string(),
  photographer_url: z.string(),
  alt: z.string().nullish(),
  src: z.object({
    large: z.string(),
    medium: z.string(),
    tiny: z.string(),
  }),
});

const PexelsSearchResponseSchema = z.object({
  page: z.number(),
  photos: z.array(PexelsPhotoSchema),
  next_page: z.string().optional(),
});

function isHttps(url: string): boolean {
  return url.startsWith("https://");
}

function toPhotoResult(photo: z.infer<typeof PexelsPhotoSchema>): PhotoResult | null {
  if (
    !isHttps(photo.url) ||
    !isHttps(photo.src.large) ||
    !isHttps(photo.src.medium) ||
    !isHttps(photo.src.tiny)
  ) {
    return null;
  }
  return {
    id: String(photo.id),
    width: photo.width,
    height: photo.height,
    alt: photo.alt ?? "",
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    pageUrl: photo.url,
    src: { large: photo.src.large, medium: photo.src.medium, tiny: photo.src.tiny },
  };
}

function searchUrl(
  baseUrl: string,
  args: {
    query: string;
    orientation?: PhotoOrientation;
    page: number;
    perPage: number;
    locale?: string;
  },
): string {
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("query", args.query);
  if (args.orientation !== undefined) url.searchParams.set("orientation", args.orientation);
  url.searchParams.set("page", String(args.page));
  url.searchParams.set("per_page", String(args.perPage));
  if (args.locale !== undefined) url.searchParams.set("locale", args.locale);
  return url.toString();
}

/**
 * Seconds until Pexels' rate-limit window resets. `X-Ratelimit-Reset` carries a Unix epoch
 * (observed live as `1790741717`, weeks in the future — not a duration), so it is converted
 * against `Date.now()` and clamped at zero: emitting the raw epoch as `Retry-After` would tell
 * a client to wait years.
 */
function retryAfterSeconds(res: Response): number | undefined {
  if (res.status !== 429) return undefined;
  const raw = res.headers.get("X-Ratelimit-Reset");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return undefined;
  // Round up: advertising a shorter wait than the reset invites an early retry.
  return Math.max(0, Math.ceil(parsed - Date.now() / 1000));
}

export function createPexelsClient(options: CreatePexelsClientOptions): PexelsClient {
  const apiKey = options.apiKey;
  const baseUrl = options.baseUrl ?? BASE_URL;
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    async search(params: PexelsSearchParams): Promise<PhotoSearchPage> {
      const args = {
        query: params.query,
        orientation: params.orientation,
        page: params.page ?? 1,
        perPage: params.perPage ?? DEFAULT_PER_PAGE,
        locale: params.locale ?? DEFAULT_LOCALE,
      };
      const init = { headers: { Authorization: apiKey }, signal: params.signal };
      let res = await fetchFn(searchUrl(baseUrl, args), init);
      if (res.status === 400) {
        // `en-GB` is not in Pexels' documented locale list: retry once without `locale`
        // rather than failing hard. The api route logs the upstream status.
        res = await fetchFn(searchUrl(baseUrl, { ...args, locale: undefined }), init);
      }
      if (!res.ok) {
        throw new PexelsError(
          res.status,
          `Pexels search failed with status ${res.status}.`,
          retryAfterSeconds(res),
        );
      }
      const body = PexelsSearchResponseSchema.parse(await res.json());
      const photos: PhotoResult[] = [];
      for (const photo of body.photos) {
        const mapped = toPhotoResult(photo);
        if (mapped !== null) photos.push(mapped);
      }
      return { photos, nextPage: body.next_page === undefined ? null : body.page + 1 };
    },
    async photo(id: string, signal?: AbortSignal): Promise<PhotoResult | null> {
      const res = await fetchFn(`${baseUrl}/photos/${encodeURIComponent(id)}`, {
        headers: { Authorization: apiKey },
        signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new PexelsError(
          res.status,
          `Pexels photo failed with status ${res.status}.`,
          retryAfterSeconds(res),
        );
      }
      return toPhotoResult(PexelsPhotoSchema.parse(await res.json()));
    },
  };
}

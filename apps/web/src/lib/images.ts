import type {
  ImageSearchClient,
  PhotoResult,
  PhotoSearchPage,
  PickedPhoto,
} from "@tj/editor/images";
import { SearchError } from "@tj/editor/images";
import { env } from "@/env";
import { api } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/query";

/**
 * The editor's `ImageSearchClient` over the api's Pexels routes (Images project). Non-2xx
 * answers become `SearchError` carrying the status, so the panel can say why. The pick
 * response's relative `url` is prefixed with `VITE_API_URL` (locally `/api` through the Vite
 * proxy, the Railway origin in production), so the stored `src` is absolute in production.
 */
export const imageSearchClient: ImageSearchClient = {
  async search(query, opts): Promise<PhotoSearchPage> {
    const res = await api.images.search.$get(
      {
        query: {
          q: query,
          ...(opts.orientation === undefined ? {} : { orientation: opts.orientation }),
          ...(opts.page === undefined ? {} : { page: String(opts.page) }),
        },
      },
      { init: { signal: opts.signal } },
    );
    if (!res.ok) {
      const error = await apiErrorFromResponse(res);
      throw new SearchError(error.message, error.status);
    }
    const body = await res.json();
    return {
      photos: body.photos.map(
        (photo): PhotoResult => ({
          id: photo.id,
          width: photo.width,
          height: photo.height,
          alt: photo.alt,
          photographer: photo.photographer,
          photographerUrl: photo.photographerUrl,
          pageUrl: photo.pageUrl,
          src: { large: photo.src.large, medium: photo.src.medium, tiny: photo.src.tiny },
        }),
      ),
      nextPage: body.nextPage,
    };
  },

  async pick(photo, target, signal): Promise<PickedPhoto> {
    const res = await api.images.pick.$post(
      { json: { provider: "pexels", id: photo.id, target } },
      { init: { signal } },
    );
    if (!res.ok) {
      const error = await apiErrorFromResponse(res);
      throw new SearchError(error.message, error.status);
    }
    const body = await res.json();
    return {
      url: `${env.VITE_API_URL}${body.url}`,
      width: body.width,
      height: body.height,
      source: body.source,
    };
  },
};

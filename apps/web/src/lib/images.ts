import type { QueryClient } from "@tanstack/react-query";
import type {
  ImageSearchClient,
  PhotoResult,
  PhotoSearchPage,
  PickedPhoto,
} from "@tj/editor/images";
import { SearchError } from "@tj/editor/images";
import { api } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/query";
import { assertCurrentSession, sessionBoundary, sessionRequest } from "./session-boundary";

/**
 * The editor's `ImageSearchClient` over the api's Pexels routes (Images project). Non-2xx
 * answers become `SearchError` carrying the status, so the panel can say why. The pick response's
 * relative `url` (`/files/<key>`) is stored as it is (TEACH-275): the api origin is a deployment
 * fact, resolved at render by `ImageOriginProvider` in `router.tsx`, never written into a document.
 */
export function imageSearchFor(client: QueryClient): ImageSearchClient {
  return {
    async search(query, opts): Promise<PhotoSearchPage> {
      const res = await api.images.search.$get(
        {
          query: {
            q: query,
            ...(opts.orientation === undefined ? {} : { orientation: opts.orientation }),
            ...(opts.page === undefined ? {} : { page: String(opts.page) }),
          },
        },
        sessionRequest(client, opts.signal),
      );
      if (!res.ok) {
        const error = await apiErrorFromResponse(res);
        throw new SearchError(error.message, error.status);
      }
      const body = await res.json();
      assertCurrentSession(client);
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
        blocked: body.blocked,
      };
    },

    async pick(photo, target, telemetry = {}): Promise<PickedPhoto> {
      const res = await api.images.pick.$post(
        {
          json: {
            provider: "pexels",
            id: photo.id,
            target,
            ...(telemetry.replaces === undefined ? {} : { replaces: telemetry.replaces }),
            ...(telemetry.msSinceOpen === undefined ? {} : { msSinceOpen: telemetry.msSinceOpen }),
          },
        },
        sessionRequest(client, telemetry.signal),
      );
      if (!res.ok) {
        const error = await apiErrorFromResponse(res);
        throw new SearchError(error.message, error.status);
      }
      const body = await res.json();
      assertCurrentSession(client);
      return {
        url: body.url,
        width: body.width,
        height: body.height,
        source: body.source,
      };
    },

    async report(input): Promise<void> {
      const res = await api.images.report.$post(
        {
          json: {
            provider: input.photo.provider,
            id: input.photo.id,
            reason: input.reason,
            context: input.context,
            ...(input.lessonId === undefined ? {} : { lessonId: input.lessonId }),
          },
        },
        sessionRequest(client),
      );
      if (!res.ok) {
        const error = await apiErrorFromResponse(res);
        throw new SearchError(error.message, error.status);
      }
    },
  };
}

/** The default instance is retained for isolated transport tests; editors bind their own epoch. */
export const imageSearchClient = imageSearchFor(sessionBoundary.getSnapshot().client);

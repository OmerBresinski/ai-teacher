/**
 * Photo search behind the Add image panel (Images project).
 *
 * The transport is injected: `apps/web` implements `ImageSearchClient` over the api's Pexels
 * routes and passes it into `LessonEditor` as a prop. `@tj/editor` never imports the api client
 * or `@tj/images` (ADR 0022 boundary, ADR 0013), so the result shapes are declared here — kept
 * identical to the api's by the tests in `apps/web/src/lib/images.test.ts`.
 */

import type { PhotoSource } from "@tj/domain/documents";

export type PhotoOrientation = "landscape" | "portrait" | "square";

/** One search hit, as the api's `GET /images/search` returns it. */
export interface PhotoResult {
  id: string;
  width: number;
  height: number;
  alt: string;
  photographer: string;
  photographerUrl: string;
  pageUrl: string;
  src: {
    large: string;
    medium: string;
    tiny: string;
  };
}

export interface PhotoSearchPage {
  photos: PhotoResult[];
  nextPage: number | null;
  /** Set when the api refused the query itself (blocklist): render the blocked copy. */
  blocked?: boolean;
}

export type ReportReason = "unsuitable" | "wrong-subject" | "other";
export type ReportContext = "search" | "placed";

export interface ImageReport {
  photo: { provider: "pexels"; id: string };
  reason: ReportReason;
  context: ReportContext;
  lessonId?: string;
}

/** A resolved pick, as the api's `POST /images/pick` returns it. */
export interface PickedPhoto {
  url: string;
  width: number;
  height: number;
  source: PhotoSource;
}

/**
 * The search transport. `search` lists hits; `pick` copies one into the Workspace bucket and
 * returns our URL. Both reject with `SearchError` carrying the HTTP status.
 */
export type ImageSearchClient = {
  search(
    query: string,
    opts: { orientation?: PhotoOrientation; page?: number; signal?: AbortSignal },
  ): Promise<PhotoSearchPage>;
  pick(
    photo: PhotoResult,
    target: "slide" | "worksheet",
    signal?: AbortSignal,
  ): Promise<PickedPhoto>;
  /** Flag a wrong result in the api log (log only). Rejects with `SearchError` on failure. */
  report(input: ImageReport): Promise<void>;
};

/** A search or pick that failed, carrying the HTTP status so the panel can say why. */
export class SearchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}

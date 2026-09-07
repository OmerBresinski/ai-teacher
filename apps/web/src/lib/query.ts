import { notifyManager, QueryClient, queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api } from "@/lib/api";

/** Error envelope returned by every non-2xx API response (apps/api/README.md). */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId?: string;
    retryable?: boolean;
    /** Only for `validation_failed`: the top-level field names that failed. */
    fields?: string[];
    /** Only for a `409` from the document routes: `stale` or `generating` (ADR 0024 §4, §18). */
    reason?: string;
  };
}

/**
 * Thrown by query/mutation functions for non-2xx responses. `message` is the API's plain
 * sentence and is safe to show to a teacher (F18-R12); never render `code` or a stack.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly fields?: string[];
  readonly reason?: string;

  constructor(status: number, envelope: ApiErrorEnvelope["error"] | undefined) {
    super(envelope?.message ?? "Something went wrong talking to the server.");
    this.name = "ApiError";
    this.status = status;
    this.code = envelope?.code ?? "unknown";
    this.retryable = envelope?.retryable ?? status >= 500;
    this.requestId = envelope?.requestId;
    this.fields = envelope?.fields;
    this.reason = envelope?.reason;
  }
}

/**
 * The subset of `Response` this helper needs. Hono RPC's `ClientResponse<...>` return type is
 * structurally compatible with `Response` except for a few DOM-only members (e.g.
 * `textStream`), so we accept that narrower shape instead of `Response` itself — every call
 * site passes either one.
 */
interface ApiResponseLike {
  readonly status: number;
  json(): Promise<unknown>;
}

/** Build an `ApiError` from a non-ok API response, tolerating non-JSON bodies. */
export async function apiErrorFromResponse(res: ApiResponseLike): Promise<ApiError> {
  let envelope: ApiErrorEnvelope["error"] | undefined;
  try {
    const body = (await res.json()) as Partial<ApiErrorEnvelope>;
    envelope = body?.error;
  } catch {
    envelope = undefined;
  }
  return new ApiError(res.status, envelope);
}

// Deliver cache notifications synchronously rather than on TanStack's default `setTimeout(0)`.
// The editor writes the document into the cache from pointer handlers (`useDocumentHistory`) and
// clears its drag preview in the same handler; with a deferred notification the canvas painted one
// frame from the stale document — the dragged element snapped back, then forward. Synchronous
// delivery lets React batch both into the one render. (The editor's test harness does the same.)
notifyManager.setScheduler((callback) => callback());

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      throwOnError: false,
    },
  },
});

export const queryKeys = {
  me: ["me"] as const,
  job: (id: string) => ["job", id] as const,
  library: ["library"] as const,
  /** The infinite lists; `libraryQueries.documents` appends `kind`, `sort` and `q`. */
  libraryDocuments: ["library", "documents"] as const,
  /** The editor's working copy of one document body (ADR 0022 §4). */
  libraryDocument: (id: string) => ["library", "document", id] as const,
  /** The row state beside the body: `updatedAt` for optimistic concurrency, the generating lock. */
  libraryDocumentMeta: (id: string) => ["library", "document-meta", id] as const,
  librarySeries: ["library", "series"] as const,
  librarySeriesDetails: ["library", "series-detail"] as const,
  librarySeriesDetail: (id: string) => ["library", "series-detail", id] as const,
};

/** `200` body of `GET /me` — `{ user: { id, email, name }, workspaceId }`. */
export type Me = InferResponseType<typeof api.me.$get, 200>;

/**
 * Who am I. Resolves to `null` on 401 (not signed in) so route guards can redirect instead of
 * rendering an error; every other non-2xx throws `ApiError`.
 */
export const meQueryOptions = queryOptions<Me | null, ApiError>({
  queryKey: queryKeys.me,
  queryFn: async (): Promise<Me | null> => {
    const res = await api.me.$get();
    if (res.status === 401) return null;
    if (res.status !== 200) throw await apiErrorFromResponse(res);
    return (await res.json()) as Me;
  },
});

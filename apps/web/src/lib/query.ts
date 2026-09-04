import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api } from "@/lib/api";

/** Error envelope returned by every non-2xx API response (apps/api/README.md). */
export interface ApiErrorEnvelope {
  error: { code: string; message: string; requestId?: string; retryable?: boolean };
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

  constructor(status: number, envelope: ApiErrorEnvelope["error"] | undefined) {
    super(envelope?.message ?? "Something went wrong talking to the server.");
    this.name = "ApiError";
    this.status = status;
    this.code = envelope?.code ?? "unknown";
    this.retryable = envelope?.retryable ?? status >= 500;
    this.requestId = envelope?.requestId;
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
  greeting: ["me", "greeting"] as const,
  job: (id: string) => ["job", id] as const,
};

/** `200` body of `GET /me` — `{ user: { id, email, name }, workspaceId }`. */
export type Me = InferResponseType<typeof api.me.$get, 200>;
export type Greeting = InferResponseType<typeof api.me.greeting.$get, 200>;

/**
 * One model-written joke per sign-in; `refetch()` (the refresh button) asks for a new one. Never
 * refetched automatically — the API already degrades to a fallback, so no retry either.
 */
export const greetingQueryOptions = queryOptions<Greeting, ApiError>({
  queryKey: queryKeys.greeting,
  queryFn: async () => {
    const res = await api.me.greeting.$get();
    if (res.status !== 200) throw await apiErrorFromResponse(res);
    return (await res.json()) as Greeting;
  },
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

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

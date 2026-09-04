import { QueryClient, queryOptions } from "@tanstack/react-query";
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

/** Build an `ApiError` from a non-ok `Response`, tolerating non-JSON bodies. */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
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
  job: (id: string) => ["job", id] as const,
};

/**
 * Every JSON body a client method can resolve to, minus the error envelope. The api types
 * `errorResponse()` with the whole `ContentfulStatusCode` union (which includes 200), so Hono's
 * `InferResponseType<…, 200>` cannot separate the envelope from the success body; excluding the
 * envelope shape does. Follow-up: narrow `errorResponse`'s status type in `apps/api/src/errors.ts`.
 */
export type SuccessBody<M extends (...args: never[]) => Promise<unknown>> = Exclude<
  Awaited<ReturnType<M>> extends infer R
    ? R extends { json(): Promise<infer O> }
      ? O
      : never
    : never,
  ApiErrorEnvelope
>;

/** `200` body of `GET /me` — `{ user: { id, email, name }, workspaceId }`. */
export type Me = SuccessBody<typeof api.me.$get>;

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

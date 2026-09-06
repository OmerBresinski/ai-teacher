/**
 * Error envelope for `@tj/api`. Every non-2xx response is
 * `{ error: { code, message, requestId, retryable, fields? } }` with a plain-sentence `message`
 * (no codes, no stack) so `apps/web` can show it directly (F18-R12).
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

export const ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "payload_too_large",
  "unprocessable",
  "rate_limited",
  "validation_failed",
  "service_unavailable",
  "internal_error",
  "http_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Why a `409 conflict` happened on a document write (ADR 0024 §4, §18): `stale` — the
 * `expectedUpdatedAt` the client sent is behind the row; `generating` — a job holds the row's
 * generating lock. The client refetches on either; `reason` only decides the wording.
 */
export const CONFLICT_REASONS = ["stale", "generating"] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    retryable: boolean;
    /** Only for `validation_failed`: the top-level field names that failed. */
    fields?: string[];
    /** Only for `conflict` from the document routes. */
    reason?: ConflictReason;
  };
}

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  422: "unprocessable",
  429: "rate_limited",
  503: "service_unavailable",
};

const RETRYABLE_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

/** Thrown by the shared `validationHook`; carries the failing top-level field names. */
export class ValidationError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super("The request contains invalid fields.");
    this.name = "ValidationError";
    this.fields = fields;
  }
}

/** A `409` whose envelope carries a `reason`; thrown by the document routes. */
export class ConflictError extends HTTPException {
  readonly reason: ConflictReason;
  constructor(reason: ConflictReason, message: string) {
    super(409, { message });
    this.reason = reason;
  }
}

export function zodFields(error: ZodError): string[] {
  const fields = new Set<string>();
  for (const issue of error.issues) fields.add(String(issue.path[0] ?? "(root)"));
  return [...fields];
}

/** Body for the envelope. `c` is only used for the request id. */
export function envelope(
  c: Context,
  code: ErrorCode,
  message: string,
  retryable: boolean,
  fields?: string[],
  reason?: ConflictReason,
): ErrorEnvelope {
  const requestId = c.get("requestId") ?? c.res.headers.get("x-request-id") ?? "";
  return {
    error: {
      code,
      message,
      requestId,
      retryable,
      ...(fields ? { fields } : {}),
      ...(reason ? { reason } : {}),
    },
  };
}

/**
 * Send an error envelope with the given status. Use it in route handlers (e.g. 503 from health).
 * Generic over the status literal so Hono RPC records e.g. `401` (not the whole
 * `ContentfulStatusCode` union) and `InferResponseType<…, 200>` in `apps/web` yields the success
 * body alone.
 */
export function errorResponse<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  code: ErrorCode,
  message: string,
  retryable = false,
  fields?: string[],
) {
  return c.json(envelope(c, code, message, retryable, fields), status);
}

export interface ClassifiedError {
  status: ContentfulStatusCode;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  fields?: string[];
  reason?: ConflictReason;
  /** True when the original error must be logged with its stack (unexpected failure). */
  unexpected: boolean;
}

/** Map any thrown value to an envelope; never leaks internal details for unknown errors. */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof ValidationError) {
    return {
      status: 400,
      code: "validation_failed",
      message: err.message,
      retryable: false,
      fields: err.fields,
      unexpected: false,
    };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: "validation_failed",
      message: "The request contains invalid fields.",
      retryable: false,
      fields: zodFields(err),
      unexpected: false,
    };
  }
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    const code = STATUS_TO_CODE[status] ?? (status >= 500 ? "internal_error" : "http_error");
    const message =
      err.message && err.message.trim() !== "" ? err.message : defaultMessageFor(status);
    return {
      status,
      code,
      message,
      retryable: RETRYABLE_STATUSES.has(status),
      ...(err instanceof ConflictError ? { reason: err.reason } : {}),
      unexpected: status >= 500,
    };
  }
  return {
    status: 500,
    code: "internal_error",
    message: "Something went wrong on our side. Please try again.",
    retryable: false,
    unexpected: true,
  };
}

function defaultMessageFor(status: number): string {
  switch (status) {
    case 400:
      return "The request could not be understood.";
    case 401:
      return "You need to sign in to do that.";
    case 403:
      return "You do not have access to that.";
    case 404:
      return "That resource does not exist.";
    case 409:
      return "The request conflicts with the current state.";
    case 413:
      return "The request is too large.";
    case 422:
      return "The request could not be processed.";
    case 429:
      return "Too many requests. Please slow down.";
    case 503:
      return "The service is temporarily unavailable.";
    default:
      return status >= 500
        ? "Something went wrong on our side. Please try again."
        : "The request failed.";
  }
}

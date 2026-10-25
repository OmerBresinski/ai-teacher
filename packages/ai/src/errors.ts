import { redactSecrets, safeError } from "@tj/domain";

export { redactSecrets };

export type AiErrorCode = "unconfigured" | "provider" | "invalid_model" | "moderated";

/** Error raised by `@tj/ai` for configuration and provider failures. */
export class AiError extends Error {
  override readonly name = "AiError";
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
  }
}

export function isAiError(error: unknown, code?: AiErrorCode): error is AiError {
  return error instanceof AiError && (code === undefined || error.code === code);
}

/**
 * What a failed provider call was, normalised across providers: the one provider detail allowed
 * into PostHog (an enum, ADR 0041) beside the HTTP status.
 */
export const PROVIDER_ERROR_CODES = [
  "invalid_api_key",
  "unauthorized",
  "permission_denied",
  "insufficient_quota",
  "rate_limited",
  "context_length_exceeded",
  "content_filter",
  "invalid_request",
  "not_found",
  "timeout",
  "unavailable",
  "server_error",
  "network",
  "unknown",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/** The diagnosable detail of a failed provider call. Secret-free; the message is debug-only. */
export interface ProviderErrorDetail {
  statusCode?: number;
  isRetryable?: boolean;
  /** Normalised: safe for PostHog and logs. */
  providerErrorCode: ProviderErrorCode;
  /** The provider's own error code or type (`invalid_api_key`, `ThrottlingException`), sanitised. */
  providerCode?: string;
  /**
   * The provider's short message, keys and tokens redacted, at most `PROVIDER_MESSAGE_MAX` chars.
   * For the generation debug record only: never a log line or PostHog (ADR 0015, ADR 0041).
   */
  providerMessage?: string;
}

/**
 * The content-free summary of a provider failure that `AiError.cause` carries. The raw AI SDK
 * error is deliberately dropped: `APICallError` exposes `requestBodyValues` (the prompt) and
 * `responseBody` as enumerable fields, so a plain `logger.warn({ err })` would leak content
 * (ADR 0015). Keep only what is needed to diagnose the call. `providerMessage` is non-enumerable
 * so a pino `err` serialisation never prints it; `fullError` reads it for the debug record.
 */
export class ProviderFailure extends Error {
  readonly statusCode?: number;
  readonly isRetryable?: boolean;
  readonly providerErrorCode?: ProviderErrorCode;
  readonly providerCode?: string;
  declare readonly providerMessage?: string;

  constructor(name: string, message: string, fields: Partial<ProviderErrorDetail>) {
    super(message);
    this.name = name;
    if (fields.statusCode !== undefined) this.statusCode = fields.statusCode;
    if (fields.isRetryable !== undefined) this.isRetryable = fields.isRetryable;
    if (fields.providerErrorCode !== undefined) this.providerErrorCode = fields.providerErrorCode;
    if (fields.providerCode !== undefined) this.providerCode = fields.providerCode;
    if (fields.providerMessage !== undefined)
      Object.defineProperty(this, "providerMessage", {
        value: fields.providerMessage,
        enumerable: false,
      });
  }
}

export const PROVIDER_FAILURE_MESSAGE = "The model provider request failed.";

function pick<T>(source: object, key: string, guard: (v: unknown) => v is T): T | undefined {
  const value = (source as Record<string, unknown>)[key];
  return guard(value) ? value : undefined;
}

const isNumber = (v: unknown): v is number => typeof v === "number";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

const MODERATED_MESSAGE = "The provider refused the model call under its content policy";
function isModeration(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    pick(cause, "statusCode", isNumber) === 400 &&
    /usage policy|content filter/i.test(cause.message)
  );
}

export const PROVIDER_MESSAGE_MAX = 300;

/** A provider message safe for the debug record: one line, secrets redacted, capped. */
export function sanitizeProviderMessage(message: string): string {
  const out = redactSecrets(message.replace(/\s+/g, " ").trim());
  return out.length > PROVIDER_MESSAGE_MAX ? `${out.slice(0, PROVIDER_MESSAGE_MAX - 1)}…` : out;
}

/** An identifier-shaped provider code only (`invalid_api_key`, `ThrottlingException`). */
function sanitizeProviderCode(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(value) && !/^(?:sk|pk|rk)-/.test(value) ? value : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The provider's error code or type, from the response body: OpenAI and the gateway nest it as
 * `{ error: { code, type } }`, Bedrock sends `{ __type }` or `{ code }`. Only the code is read,
 * never a field that could echo the request.
 */
function providerCodeOf(responseBody: unknown): string | undefined {
  if (typeof responseBody !== "string" || responseBody.length > 64 * 1024) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(responseBody);
  } catch {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  const inner = isRecord(body.error) ? body.error : body;
  const raw = inner.code ?? inner.type ?? body.__type ?? body.code ?? body.type;
  const code = sanitizeProviderCode(raw);
  // Bedrock's `__type` can be `com.amazon...#ThrottlingException`.
  return code ?? sanitizeProviderCode(typeof raw === "string" ? raw.split("#").pop() : undefined);
}

function classify(
  statusCode: number | undefined,
  providerCode: string | undefined,
  message: string,
  name: string,
): ProviderErrorCode {
  const code = (providerCode ?? "").toLowerCase();
  if (code.includes("invalid_api_key") || code === "unrecognizedclientexception")
    return "invalid_api_key";
  if (code.includes("insufficient_quota") || code.includes("billing")) return "insufficient_quota";
  if (code.includes("context_length") || /maximum context length|too many tokens/i.test(message))
    return "context_length_exceeded";
  if (code.includes("content_filter") || code.includes("content_policy")) return "content_filter";
  if (code.includes("rate_limit") || code.includes("throttl")) return "rate_limited";
  if (statusCode === 401) return /api key/i.test(message) ? "invalid_api_key" : "unauthorized";
  if (statusCode === 403) return "permission_denied";
  if (statusCode === 429) return "rate_limited";
  if (statusCode === 404) return "not_found";
  if (statusCode === 408 || statusCode === 504) return "timeout";
  if (statusCode === 503 || statusCode === 529) return "unavailable";
  if (statusCode !== undefined && statusCode >= 500) return "server_error";
  if (statusCode !== undefined && statusCode >= 400) return "invalid_request";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (
    statusCode === undefined &&
    (name === "TypeError" || /fetch failed|ECONN|socket/i.test(message))
  )
    return "network";
  return "unknown";
}

/** An error the provider HTTP layer raised (AI SDK `APICallError`), not one of ours. */
function isProviderCallError(error: Error): boolean {
  return (
    error.name === "AI_APICallError" ||
    pick(error, "statusCode", isNumber) !== undefined ||
    "responseBody" in error
  );
}

/**
 * The diagnosable detail of `error`: a `ProviderFailure` anywhere in its cause chain (depth 5),
 * else a raw provider error read directly. `undefined` when there is none.
 */
export function providerErrorDetail(error: unknown): ProviderErrorDetail | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth++) {
    if (current instanceof ProviderFailure) {
      if (current.providerErrorCode === undefined) return undefined;
      return {
        providerErrorCode: current.providerErrorCode,
        ...(current.statusCode !== undefined ? { statusCode: current.statusCode } : {}),
        ...(current.isRetryable !== undefined ? { isRetryable: current.isRetryable } : {}),
        ...(current.providerCode !== undefined ? { providerCode: current.providerCode } : {}),
        ...(current.providerMessage !== undefined
          ? { providerMessage: current.providerMessage }
          : {}),
      };
    }
    if (!isAiError(current)) return rawDetail(current);
    current = current.cause;
  }
  return undefined;
}

function rawDetail(cause: Error): ProviderErrorDetail {
  const statusCode = pick(cause, "statusCode", isNumber);
  const isRetryable = pick(cause, "isRetryable", isBoolean);
  const providerCode = providerCodeOf((cause as { responseBody?: unknown }).responseBody);
  const message = typeof cause.message === "string" ? cause.message : "";
  const fromProvider = isProviderCallError(cause);
  return {
    providerErrorCode: classify(statusCode, providerCode, message, cause.name),
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(isRetryable !== undefined ? { isRetryable } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    // Only a provider's own message: any other error's message may quote what we sent.
    ...(fromProvider && message ? { providerMessage: sanitizeProviderMessage(message) } : {}),
  };
}

export function toProviderFailure(cause: unknown): ProviderFailure {
  if (cause instanceof Error) {
    return new ProviderFailure(
      safeError(cause).type,
      isModeration(cause) ? MODERATED_MESSAGE : PROVIDER_FAILURE_MESSAGE,
      isModeration(cause)
        ? { ...rawDetail(cause), providerErrorCode: "content_filter" }
        : rawDetail(cause),
    );
  }
  return new ProviderFailure("UnknownError", PROVIDER_FAILURE_MESSAGE, {
    providerErrorCode: "unknown",
  });
}

export function toProviderError(cause: unknown): AiError {
  if (isAiError(cause)) return cause;
  if (isModeration(cause)) {
    return new AiError("moderated", MODERATED_MESSAGE, { cause: toProviderFailure(cause) });
  }
  return new AiError("provider", "Model call failed", { cause: toProviderFailure(cause) });
}

export type AiErrorCode = "unconfigured" | "provider" | "invalid_model";

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
 * The content-free summary of a provider failure that `AiError.cause` carries. The raw AI SDK
 * error is deliberately dropped: `APICallError` exposes `requestBodyValues` (the prompt) and
 * `responseBody` as enumerable fields, so a plain `logger.warn({ err })` would leak content
 * (ADR 0015). Keep only what is needed to diagnose the call.
 */
export class ProviderFailure extends Error {
  readonly statusCode?: number;
  readonly isRetryable?: boolean;

  constructor(
    name: string,
    message: string,
    fields: { statusCode?: number; isRetryable?: boolean },
  ) {
    super(message);
    this.name = name;
    if (fields.statusCode !== undefined) this.statusCode = fields.statusCode;
    if (fields.isRetryable !== undefined) this.isRetryable = fields.isRetryable;
  }
}

const MESSAGE_MAX = 200;

function pick<T>(source: object, key: string, guard: (v: unknown) => v is T): T | undefined {
  const value = (source as Record<string, unknown>)[key];
  return guard(value) ? value : undefined;
}

const isNumber = (v: unknown): v is number => typeof v === "number";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

export function toProviderFailure(cause: unknown): ProviderFailure {
  if (cause instanceof Error) {
    return new ProviderFailure(cause.name, cause.message.slice(0, MESSAGE_MAX), {
      statusCode: pick(cause, "statusCode", isNumber),
      isRetryable: pick(cause, "isRetryable", isBoolean),
    });
  }
  return new ProviderFailure("UnknownError", String(cause).slice(0, MESSAGE_MAX), {});
}

export function toProviderError(cause: unknown): AiError {
  if (isAiError(cause)) return cause;
  return new AiError("provider", "Bedrock model call failed", { cause: toProviderFailure(cause) });
}

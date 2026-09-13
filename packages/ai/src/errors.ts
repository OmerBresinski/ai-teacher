import { safeError } from "@tj/domain";

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

export const PROVIDER_FAILURE_MESSAGE = "The model provider request failed.";

function pick<T>(source: object, key: string, guard: (v: unknown) => v is T): T | undefined {
  const value = (source as Record<string, unknown>)[key];
  return guard(value) ? value : undefined;
}

const isNumber = (v: unknown): v is number => typeof v === "number";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

const MODERATED_MESSAGE = "Bedrock refused the model call under its content policy";
function isModeration(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    pick(cause, "statusCode", isNumber) === 400 &&
    /usage policy|content filter/i.test(cause.message)
  );
}

export function toProviderFailure(cause: unknown): ProviderFailure {
  if (cause instanceof Error) {
    return new ProviderFailure(
      safeError(cause).type,
      isModeration(cause) ? MODERATED_MESSAGE : PROVIDER_FAILURE_MESSAGE,
      {
        statusCode: pick(cause, "statusCode", isNumber),
        isRetryable: pick(cause, "isRetryable", isBoolean),
      },
    );
  }
  return new ProviderFailure("UnknownError", PROVIDER_FAILURE_MESSAGE, {});
}

export function toProviderError(cause: unknown): AiError {
  if (isAiError(cause)) return cause;
  if (isModeration(cause)) {
    return new AiError("moderated", MODERATED_MESSAGE, { cause: toProviderFailure(cause) });
  }
  return new AiError("provider", "Bedrock model call failed", { cause: toProviderFailure(cause) });
}

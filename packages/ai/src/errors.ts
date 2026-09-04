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

export function toProviderError(cause: unknown): AiError {
  if (isAiError(cause)) return cause;
  return new AiError("provider", "Bedrock model call failed", { cause });
}

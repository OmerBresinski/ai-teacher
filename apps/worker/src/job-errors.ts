import { isAiError } from "@tj/ai";
import { BudgetExceeded, InputRejected, inputRejectionMessage } from "@tj/generation";
import { NonRetryableError } from "@tj/jobs";
import { SOURCE_UNAVAILABLE_MESSAGE, SourceUnavailable } from "./sources";

/** Explicit mappings, independent of retry policy. Never trust even a typed error's message. */
export function publicJobFailure(error: unknown): string | undefined {
  const original = error instanceof NonRetryableError ? error.cause : error;
  if (original instanceof InputRejected) return inputRejectionMessage(original.findings);
  if (original instanceof SourceUnavailable) return SOURCE_UNAVAILABLE_MESSAGE;
  if (original instanceof BudgetExceeded) {
    return original.by === "usd"
      ? "lesson budget exceeded (usd cap)"
      : "lesson budget exceeded (tokens cap)";
  }
  if (isAiError(original, "unconfigured") || isAiError(original, "invalid_model")) {
    return "AI generation is not available. Please try again later.";
  }
  return undefined;
}

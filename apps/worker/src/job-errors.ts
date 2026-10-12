import { BudgetReservationError, isAiError } from "@tj/ai";
import {
  BudgetExceeded,
  InputRejected,
  inputRejectionMessage,
  isBudgetRefusal,
} from "@tj/generation";
import { NonRetryableError } from "@tj/jobs";
import { SOURCE_UNAVAILABLE_MESSAGE, SourceUnavailable } from "./sources";

/** Explicit mappings, independent of retry policy. Never trust even a typed error's message. */
export function publicJobFailure(error: unknown): string | undefined {
  const original = error instanceof NonRetryableError ? error.cause : error;
  if (original instanceof InputRejected) return inputRejectionMessage(original.findings);
  if (original instanceof SourceUnavailable) return SOURCE_UNAVAILABLE_MESSAGE;
  // A refusal can arrive wrapped (a streamed call's error, TEACH-202 part g) or as the
  // middleware's own class: find it anywhere in the cause chain.
  if (isBudgetRefusal(original)) {
    const by = budgetCap(original);
    return by === "tokens"
      ? "lesson budget exceeded (tokens cap)"
      : "lesson budget exceeded (usd cap)";
  }
  if (isAiError(original, "unconfigured") || isAiError(original, "invalid_model")) {
    return "AI generation is not available. Please try again later.";
  }
  return undefined;
}

/** The cap a budget refusal names, from the first `BudgetExceeded` / `BudgetReservationError` in the chain. */
function budgetCap(error: unknown): "usd" | "tokens" | undefined {
  for (let e: unknown = error, i = 0; e !== undefined && e !== null && i < 10; i++) {
    if (e instanceof BudgetExceeded || e instanceof BudgetReservationError) return e.by;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The one way a job turns a budget refusal into a terminal failure (no retry can afford it). */
export function budgetFailure(error: unknown): NonRetryableError {
  return new NonRetryableError(error instanceof Error ? error.message : "budget refused", {
    cause: error,
  });
}

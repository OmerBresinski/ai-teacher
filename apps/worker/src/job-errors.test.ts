import { expect, test } from "bun:test";
import { AiError } from "@tj/ai";
import { BudgetExceeded, INPUT_CHECK_MESSAGES, InputRejected } from "@tj/generation";
import { NonRetryableError } from "@tj/jobs";
import { publicJobFailure } from "./job-errors";
import { SOURCE_UNAVAILABLE_MESSAGE, SourceUnavailable } from "./sources";

test("typed refusals use fixed mappings even when the error message was overwritten", () => {
  const input = new InputRejected([
    {
      check: "learner-name",
      severity: "error",
      message: "PRIVATE_282",
      target: {},
    },
  ]);
  input.message = "PRIVATE_282";
  const source = new SourceUnavailable("PRIVATE_282");
  source.message = "PRIVATE_282";
  expect(publicJobFailure(new NonRetryableError("PRIVATE_282", { cause: input }))).toBe(
    INPUT_CHECK_MESSAGES["learner-name"],
  );
  expect(publicJobFailure(new NonRetryableError("PRIVATE_282", { cause: source }))).toBe(
    SOURCE_UNAVAILABLE_MESSAGE,
  );
  expect(publicJobFailure(new BudgetExceeded("usd"))).toBe("lesson budget exceeded (usd cap)");
  expect(publicJobFailure(new BudgetExceeded("tokens"))).toBe(
    "lesson budget exceeded (tokens cap)",
  );
  expect(publicJobFailure(new AiError("invalid_model", "PRIVATE_282"))).toBe(
    "AI generation is not available. Please try again later.",
  );
  expect(publicJobFailure(new NonRetryableError("PRIVATE_282"))).toBeUndefined();
  expect(publicJobFailure(new Error("PRIVATE_282"))).toBeUndefined();
  expect(publicJobFailure({ name: "InputRejected", message: "PRIVATE_282" })).toBeUndefined();
});

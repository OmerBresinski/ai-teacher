import { describe, expect, test } from "bun:test";
import { safeError, safeValidationIssues } from "./safe-error";

describe("safe diagnostics", () => {
  test("drops nested content, even from message, stack, type and code", () => {
    const secret = "PRIVATE_CANARY_282";
    const error = Object.assign(new Error(secret, { cause: { params: [secret] } }), {
      name: secret,
      code: secret,
      token: secret,
      stack: secret,
    });
    expect(safeError(error)).toEqual({ type: "UnknownError" });
    expect(safeError({ name: "PostgresError", code: "23505", detail: secret })).toEqual({
      type: "PostgresError",
      code: "23505",
    });
    expect(safeError(safeError(error))).toEqual({ type: "UnknownError" });
    expect(safeError(secret)).toEqual({ type: "UnknownError" });
    expect(
      safeError(
        Object.defineProperty({}, "name", {
          get() {
            throw error;
          },
        }),
      ),
    ).toEqual({ type: "UnknownError" });
  });

  test("validation summaries never forward dynamic paths or custom messages", () => {
    const issue = {
      code: "custom",
      message: "PRIVATE",
      path: ["PRIVATE"],
      params: { token: "PRIVATE" },
    };
    expect(safeValidationIssues([issue, issue, { code: "PRIVATE" }])).toEqual([
      "custom: 2",
      "unknown: 1",
    ]);
  });
});

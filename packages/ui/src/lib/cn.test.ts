import { describe, expect, test } from "bun:test";

import { cn } from "./cn";

describe("cn", () => {
  test("keeps a kit text size when a colour follows it", () => {
    expect(cn("text-eyebrow font-medium", "text-ink-2")).toBe(
      "text-eyebrow font-medium text-ink-2",
    );
    expect(cn("text-meta", "text-destructive")).toBe("text-meta text-destructive");
  });

  test("a later kit size still overrides an earlier one", () => {
    expect(cn("text-body", "text-lead")).toBe("text-lead");
    expect(cn("text-xs", "text-meta")).toBe("text-meta");
  });

  test("a later colour still overrides an earlier colour", () => {
    expect(cn("text-ink-2 text-body", "text-destructive")).toBe("text-body text-destructive");
  });
});

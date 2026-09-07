import { describe, expect, test } from "bun:test";
import { GUARD_MESSAGE } from "@tj/domain/documents";
import { StudioInputSchema } from "./mastra.dev";

// Importing `mastra.dev.ts` constructs the dev `Mastra` instance; it does not start a server.

describe("StudioInputSchema", () => {
  test("keeps the domain topic rules: identifier guard and length cap", () => {
    expect(StudioInputSchema.safeParse({ brief: { topic: "a lesson about legos" } }).success).toBe(
      true,
    );
    const guarded = StudioInputSchema.safeParse({
      brief: { topic: "Help a pupil called Amir with Lego" },
    });
    expect(guarded.success).toBe(false);
    expect(guarded.error?.issues[0]?.message).toBe(GUARD_MESSAGE);
    expect(StudioInputSchema.safeParse({ brief: { topic: "x".repeat(501) } }).success).toBe(false);
    expect(StudioInputSchema.safeParse({ brief: { topic: "" } }).success).toBe(false);
  });

  test("is strict like POST /lessons and describes the form fields", () => {
    expect(StudioInputSchema.safeParse({ brief: { topic: "legos" }, sourceIds: [] }).success).toBe(
      false,
    );
    expect(StudioInputSchema.shape.brief.shape.topic.description).toContain("Topic");
    expect(StudioInputSchema.shape.yearGroup.description).toContain("Year 5");
  });
});

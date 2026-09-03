import { describe, expect, test } from "bun:test";
import { ArtefactState, AttentionFlag, LessonTaughtState } from "./states";

describe("state vocabulary (F18-R07)", () => {
  test("ArtefactState", () => {
    expect(ArtefactState.options).toEqual(["draft", "reviewed", "stale"]);
    expect(ArtefactState.safeParse("Draft").success).toBe(false);
  });

  test("LessonTaughtState", () => {
    expect(LessonTaughtState.options).toEqual(["planned", "taught"]);
  });

  test("AttentionFlag", () => {
    expect(AttentionFlag.options).toEqual(["none", "needs_attention"]);
    expect(AttentionFlag.safeParse(true).success).toBe(false);
  });
});

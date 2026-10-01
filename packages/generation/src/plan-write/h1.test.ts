import { describe, expect, test } from "bun:test";
import type { PlanSlide } from "../prompts/plan-lesson";
import { warmUpToInsert } from "./check";

const row = (role: string, form: string): PlanSlide => ({
  role,
  objectives: role === "teach" ? [1] : [],
  tests: [],
  teaches: [],
  purpose: role,
  parts: 1,
  form,
  layout: "default",
  imageBrief: null,
  figureBrief: null,
});
const fixed = [row("title", "title"), row("objectives", "objectives")];

describe("H1 retrieval warm-up", () => {
  test("a plan that opens with teaching gets a retrieval starter first", () => {
    const w = warmUpToInsert([...fixed, row("teach", "explain"), row("check", "check-set")]);
    expect(w?.form).toBe("starter-set");
    expect(w?.role).toBe("retrieve");
    expect(w?.teaches).toEqual([]);
  });
  test("a plan that opens with retrieval keeps its own", () => {
    expect(
      warmUpToInsert([...fixed, row("retrieve", "starter-set"), row("teach", "explain")]),
    ).toBeUndefined();
    expect(warmUpToInsert([...fixed, row("retrieve", "list")])).toBeUndefined();
  });
});

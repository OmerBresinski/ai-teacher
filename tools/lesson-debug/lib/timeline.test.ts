import { describe, expect, test } from "bun:test";
import fixture from "../fixtures/lesson.json";
import { jobIdsOf, type LessonDebug, railwayCommand, timeline } from "./timeline";

const input = fixture as unknown as LessonDebug;

describe("lesson-debug timeline", () => {
  test("the fixture's report, line for line", () => {
    expect(timeline(input)).toMatchSnapshot();
  });

  test("job events and debug rows interleave in time order", () => {
    const lines = timeline(input).split("\n");
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at("EVENT started")).toBeLessThan(at("objectives on openai/gpt-6.1-sol"));
    expect(at("writer-output")).toBeLessThan(at("check         s3"));
    expect(at("budget-stop")).toBeLessThan(at("EVENT failed"));
    expect(lines.find((l) => l.includes("a0 job-error"))).toContain(
      "BudgetExceeded: lesson budget exceeded by $0.01 (at call (packages/generation/src/call.ts:10:5))",
    );
    expect(lines.find((l) => l.includes("a0 repair"))).toContain("fit: accepted then reverted");
  });

  test("job ids come from the lock, the generation block, the plan and the debug rows", () => {
    expect(jobIdsOf(input.lesson, input.debug)).toEqual([
      "0192f7a0-0000-7000-8000-0000000000a1",
      "0192f7a0-0000-7000-8000-0000000000b2",
    ]);
  });

  test("an empty record says why it may be empty", () => {
    expect(timeline({ ...input, events: [], debug: [] })).toContain("older than the TTL");
  });

  test("the Railway command filters on the lesson id", () => {
    expect(railwayCommand("abc")).toBe(
      `railway logs --service worker --json | grep '"lessonId":"abc"'`,
    );
  });
});

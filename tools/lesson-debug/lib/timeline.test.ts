import { describe, expect, test } from "bun:test";
import fixture from "../fixtures/lesson.json";
import {
  callDetail,
  factCheckSection,
  findCall,
  jobIdsOf,
  type LessonDebug,
  railwayCommand,
  timeline,
} from "./timeline";

const input = fixture as unknown as LessonDebug;

describe("lesson-debug timeline", () => {
  test("the fixture's report, line for line", () => {
    expect(timeline(input)).toMatchSnapshot();
  });

  test("job events and debug rows interleave in time order", () => {
    const lines = timeline(input).split("\n");
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at("EVENT started")).toBeLessThan(at("lesson-writer.v1/objectives on"));
    expect(at("writer-output")).toBeLessThan(at("check         s3"));
    expect(at("budget-stop")).toBeLessThan(at("EVENT failed"));
    expect(lines.find((l) => l.includes("a0 job-error"))).toContain(
      "BudgetExceeded: lesson budget exceeded by $0.01 (at call (packages/generation/src/call.ts:10:5))",
    );
    expect(lines.find((l) => l.includes("a0 repair"))).toContain("fit: accepted then reverted");
    expect(lines.find((l) => l.includes("lesson-writer.v1/lesson on"))).toContain(
      "[--call 000000b2:0:0]",
    );
  });

  test("the fact check section: summary, change rate and a diff per changed slide", () => {
    const section = factCheckSection(input.debug, input.lesson.slides).split("\n");
    expect(section[0]).toBe("FACT CHECK");
    // Slide 4 (gas8) and slide 2 (Verify's v2, cited there) changed, out of 5.
    expect(section[1]).toBe(
      "  slides checked 5, changed 2 (40%); 1 per-slide checks, 1 verify runs",
    );
    expect(section).toContain("  changed v2.term (wrong-term) on slides 2");
    expect(section).toContain('    - "Clan"');
    expect(section).toContain('    + "Legion"');
    expect(section.some((l) => l.startsWith("  DROPPED v9.term"))).toBe(true);
    expect(section).toContain("    - Magnesium makes 500 cm3 of hydrogen.");
    expect(section).toContain("    + Magnesium makes 90 cm3 of hydrogen.");
    expect(section).toContain("      Collect it in a syringe.");
  });

  test("--call prints one call's prompt and response in full", () => {
    const row = findCall(input.debug, "000000b2:0:0");
    expect(row?.seq).toBe(0);
    const detail = callDetail(row as NonNullable<typeof row>);
    expect(detail).toContain("--- system ---\nYou are the lesson writer.");
    expect(detail).toContain("--- user ---\nWrite the lesson.");
    expect(detail).toContain('--- response (length) ---\n{"slides":[]}');
    expect(findCall(input.debug, "nope:0:99")).toBeUndefined();
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

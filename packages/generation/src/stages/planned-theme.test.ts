import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { plannedThemeId } from "./objectives";

const lesson = (over: Partial<Lesson>): Lesson =>
  ({ themeId: "splash", ageBand: "ks2", ...over }) as unknown as Lesson;

describe("plannedThemeId (UX ruling 202)", () => {
  test("the planner's theme for the topic is used when the teacher chose none", () => {
    expect(plannedThemeId(lesson({ ageBand: "ks2" }), "treehouse")).toBe("treehouse");
    expect(plannedThemeId(lesson({ ageBand: "ks4" }), "reading-room")).toBe("reading-room");
  });

  test("a missing, unknown or retired planner theme falls back by key stage: Splash to Y6, Studio from Y7", () => {
    expect(plannedThemeId(lesson({ ageBand: "ks2" }), undefined)).toBe("splash");
    expect(plannedThemeId(lesson({ ageBand: "ks1" }), "nope")).toBe("splash");
    expect(plannedThemeId(lesson({ ageBand: "eyfs" }), undefined)).toBe("splash");
    expect(plannedThemeId(lesson({ ageBand: "ks3" }), "chalk")).toBe("studio");
    expect(plannedThemeId(lesson({ ageBand: "ks4" }), undefined)).toBe("studio");
    expect(plannedThemeId(lesson({ ageBand: "post16" }), "")).toBe("studio");
  });

  test("the teacher's explicit or remembered choice always wins", () => {
    const chosen = lesson({ themeId: "beacon", themeChosen: true, ageBand: "ks2" });
    expect(plannedThemeId(chosen, "treehouse")).toBe("beacon");
    expect(plannedThemeId(chosen, undefined)).toBe("beacon");
  });
});

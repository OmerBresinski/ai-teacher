import { describe, expect, test } from "bun:test";
import { previewTheme, startingTheme } from "./default-theme";
import { LIBRARY_THEMES } from "./library-themes";

describe("startingTheme (rulings 116, 202)", () => {
  test("the teacher's remembered theme is sent and wins", () => {
    expect(startingTheme("beacon")).toBe("beacon");
    expect(startingTheme("reading-room")).toBe("reading-room");
  });

  test("with no remembered theme nothing is sent, so the planner picks", () => {
    expect(startingTheme(undefined)).toBeUndefined();
    expect(startingTheme("")).toBeUndefined();
  });

  test("a remembered Chalk & Cream is sent as Splash, never as the retired id", () => {
    expect(startingTheme("chalk")).toBe("splash");
  });
});

describe("previewTheme: the key stage fallback (ruling 202)", () => {
  test.each([
    ["Reception", "splash"],
    ["Year 2", "splash"],
    ["Year 4", "splash"],
    ["Year 6", "splash"],
    ["Year 7", "studio"],
    ["Year 9", "studio"],
    ["Year 11", "studio"],
    ["Year 13", "studio"],
    [undefined, "splash"],
  ])("%s → %s", (year, theme) => {
    expect(previewTheme(year)).toBe(theme);
  });
});

test("the New dialog's picker offers no Chalk & Cream", () => {
  expect(LIBRARY_THEMES.map((t) => t.id)).not.toContain("chalk");
});

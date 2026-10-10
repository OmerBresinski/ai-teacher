import { describe, expect, test } from "bun:test";
import { assertKnownTheme, hasKnownOrNoTheme, withLiveTheme } from "./theme-guard";

describe("theme guard and retired themes (UX ruling 202)", () => {
  test("an older client's chalk is accepted and stored as splash", () => {
    expect(assertKnownTheme("chalk")).toBe("splash");
    expect(assertKnownTheme("studio")).toBe("studio");
    expect(assertKnownTheme(undefined)).toBeUndefined();
    expect(hasKnownOrNoTheme({ themeId: "chalk" })).toBe(true);
    expect(withLiveTheme({ id: "l", themeId: "chalk" })).toEqual({ id: "l", themeId: "splash" });
  });

  test("an id that never existed is still refused", () => {
    expect(() => assertKnownTheme("no-such-theme")).toThrow("That theme does not exist.");
    expect(hasKnownOrNoTheme({ themeId: "no-such-theme" })).toBe(false);
  });
});

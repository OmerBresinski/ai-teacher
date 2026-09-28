import { describe, expect, test } from "bun:test";
import { defaultThemeFor, startingTheme } from "./default-theme";

describe("defaultThemeFor (ruling 116)", () => {
  test.each([
    ["Science", "Reception", "playground"],
    ["Maths", "Year 2", "playground"],
    ["Maths", "Year 3", "playground"],
    ["Maths", "Year 4", "playground"],
    ["Maths", "Year 5", "chalk"],
    ["English", "Year 6", "chalk"],
    ["Science", "Year 8", "reading-room"],
    ["English", "Year 8", "reading-room"],
    ["Maths", "Year 11", "exam-hall"],
    ["History", "Year 12", "reading-room"],
    [undefined, "Year 13", "exam-hall"],
    [undefined, undefined, "chalk"],
    ["Maths", "Mixed", "chalk"],
  ])("%s, %s → %s", (subject, year, theme) => {
    expect(defaultThemeFor(subject, year)).toBe(theme);
  });

  test("the teacher's last theme wins over the class default", () => {
    expect(startingTheme("beacon", "Maths", "Year 2")).toBe("beacon");
    expect(startingTheme("", "Maths", "Year 2")).toBe("playground");
  });
});

import { describe, expect, test } from "bun:test";
import { iconSvg } from "./library";
import { iconAgeFor, iconColoursFor, iconSvgForTheme } from "./theme-colours";

describe("iconColoursFor", () => {
  const red = { colors: { accent: "#D7263D", ink: "#22152B" } };
  const green = { colors: { accent: "#1F7A5C", ink: "#14262E" } };

  test("slots follow the theme's accent and ink, with a darker accent and a wash", () => {
    const c = iconColoursFor(red);
    expect(c.primary).toBe("#d7263d");
    expect(c.ink).toBe("#22152b");
    expect(c.stroke).toBe("#22152b");
    expect(c.primaryDark).not.toBe(c.primary);
    expect(c.tint).not.toBe(c.primary);
  });

  test("the secondary slot partners the accent: blue for a warm accent, amber for a cool one", () => {
    expect(iconColoursFor(red).secondary).toBe("#2F7FD1");
    expect(iconColoursFor(green).secondary).toBe("#E8A33A");
  });

  test("a theme's own icon slots win", () => {
    expect(iconColoursFor({ ...red, iconSlots: { primary: "#000000" } }).primary).toBe("#000000");
  });
});

test("a theme colour that is not hex falls back to the default slots", () => {
  const c = iconColoursFor({ colors: { accent: "rgb(1,2,3)", ink: '"/><script>' } });
  expect(c.primary).toBe("#D7263D");
  expect(c.ink).toBe("#22152B");
});

describe("iconAgeFor", () => {
  test("key stage 1 is early, 2 primary, 3 and up secondary; no stage is primary", () => {
    expect(iconAgeFor("ks1")).toBe("early");
    expect(iconAgeFor("ks2")).toBe("primary");
    for (const ks of ["ks3", "ks4", "ks5"]) expect(iconAgeFor(ks)).toBe("secondary");
    expect(iconAgeFor(undefined)).toBe("primary");
  });
});

describe("iconSvgForTheme", () => {
  const theme = { colors: { accent: "#1F7A5C", ink: "#14262E" }, keyStage: "ks1" };
  test("draws with the theme's slots, its stage's age and the box's size level", () => {
    const svg = iconSvgForTheme("heart", theme, 120, 96)?.replace(/tji\d+/g, "id");
    const want = iconSvg("heart", {
      colours: iconColoursFor(theme),
      age: "early",
      size: "m",
      px: 96,
    }).replace(/tji\d+/g, "id");
    expect(svg).toBe(want);
    expect(iconSvgForTheme("heart", theme, 30)).toContain("<svg");
    expect(iconSvgForTheme("kitten", theme, 120)).toBeNull();
  });
});

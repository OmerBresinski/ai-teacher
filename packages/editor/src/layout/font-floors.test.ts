import { describe, expect, test } from "bun:test";
import type { TextPreset } from "@tj/domain/documents";
import { fontFloor, MIN_FONT_SIZE, THEMES, textRole } from "../model/themes";
import { resolveFontSize, resolveTextStyle } from "../slide/elements/kit";
import { stepDownSize } from "./reflow";

/* TeachDeck `lib/model/__tests__/font-floors.test.ts` (10): the projector floors every path clamps to. */

const PRESETS: TextPreset[] = ["title", "subtitle", "heading", "body", "small", "caption"];
const theme = THEMES[0];
if (!theme) throw new Error("no theme");

describe("projector minimums", () => {
  test("carries the research values scaled to 960x540", () => {
    expect(MIN_FONT_SIZE).toEqual({
      title: 48,
      question: 38,
      option: 31,
      heading: 26,
      body: 26,
      small: 24,
      caption: 14,
    });
  });
  test("maps every preset to a role", () => {
    expect(PRESETS.map((p) => textRole(p))).toEqual([
      "title",
      "title",
      "heading",
      "body",
      "small",
      "caption",
    ]);
  });
  test("puts an option card on the option floor whatever stop it is set in", () => {
    expect(fontFloor("small")).toBe(24);
    expect(fontFloor("small", "option")).toBe(31);
    expect(fontFloor("body", "option")).toBe(31);
  });
  test("separates a question stem from a plain slide heading", () => {
    expect(fontFloor("heading", "question")).toBe(38);
    expect(fontFloor("heading")).toBe(26);
    expect(textRole("heading", "question")).toBe("question");
    for (const t of THEMES) expect(t.sizes.heading).toBeGreaterThanOrEqual(fontFloor("heading"));
  });
  test("keeps the footnote stop where the themes were drawn", () => {
    expect(fontFloor("small")).toBe(24);
  });
  test("exempts the caption eyebrow from the reading floor", () => {
    expect(fontFloor("caption")).toBe(14);
    for (const t of THEMES) expect(t.sizes.caption).toBeLessThan(MIN_FONT_SIZE.body);
  });
});

describe("the floor clamps every path to the same number", () => {
  test("lifts a theme stop that sits below its role floor", () => {
    for (const t of THEMES) {
      for (const preset of PRESETS)
        expect(resolveFontSize(t, preset)).toBeGreaterThanOrEqual(fontFloor(preset));
      expect(resolveFontSize(t, "small", undefined, "option")).toBeGreaterThanOrEqual(31);
    }
  });
  test("lifts an author override too", () => {
    expect(resolveFontSize(theme, "title", 12)).toBe(48);
    expect(resolveFontSize(theme, "heading", 12)).toBe(26);
    expect(resolveFontSize(theme, "heading", 12, "question")).toBe(38);
    expect(resolveFontSize(theme, "body", 12)).toBe(26);
    expect(resolveFontSize(theme, "small", 12)).toBe(24);
    expect(resolveFontSize(theme, "caption", 4)).toBe(14);
    expect(resolveFontSize(theme, "small", 12, "option")).toBe(31);
  });
  test("reports the role on the resolved style, so the toolbar and the exporter agree", () => {
    expect(resolveTextStyle({ preset: "heading" }, theme).role).toBe("heading");
    expect(resolveTextStyle({ preset: "heading" }, theme, "heading", "question").role).toBe(
      "question",
    );
    expect(resolveTextStyle({ preset: "small" }, theme, "small", "option").role).toBe("option");
    expect(resolveTextStyle({ preset: "small" }, theme, "small", "option").fontSize).toBe(31);
  });
  test("never steps a size below its role floor", () => {
    for (const t of THEMES) {
      expect(stepDownSize(t, "heading", t.sizes.title)).toBeGreaterThanOrEqual(26);
      expect(stepDownSize(t, "heading", t.sizes.title, "question")).toBeGreaterThanOrEqual(38);
      expect(stepDownSize(t, "body", t.sizes.body)).toBeGreaterThanOrEqual(26);
      expect(stepDownSize(t, "small", t.sizes.body)).toBeGreaterThanOrEqual(24);
      expect(stepDownSize(t, "small", 40, "option")).toBeGreaterThanOrEqual(31);
      expect(stepDownSize(t, "body", 26)).toBe(26);
      expect(stepDownSize(t, "small", 31, "option")).toBe(31);
    }
  });
});

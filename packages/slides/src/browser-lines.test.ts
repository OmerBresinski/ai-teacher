import { describe, expect, test } from "bun:test";
import type { TextPreset } from "@tj/domain/documents";
import { docFromText } from "./factories";
import rows from "./fixtures/browser-lines.json";
import { measureHeadless } from "./text-measure";
import { resolveTextStyle } from "./text-style";
import { getTheme } from "./themes";

/*
 * The headless ruler against Chromium (`apps/web/scripts/probe-browser-lines.ts`): the same font
 * files, bold (600, 700) and regular strings, heading and body, four widths, three themes. The ruler
 * ignores kerning, so when it is wrong it must be wrong wide (one line too many), never short: a
 * short count is a slide that overflows in the browser.
 */
type Row = {
  theme: string;
  preset: TextPreset;
  weight: number;
  width: number;
  text: string;
  lines: number;
};

describe("the headless ruler matches the browser's line counts", () => {
  const results = (rows as Row[]).map((r) => {
    const t = getTheme(r.theme);
    const style = { preset: r.preset, fontWeight: r.weight };
    const h = measureHeadless(t)({
      doc: docFromText(r.text),
      width: r.width,
      style,
      preset: r.preset,
      inset: 0,
      chrome: 0,
    });
    const rr = resolveTextStyle(style, t);
    return { ...r, mine: Math.round(h / (rr.fontSize * rr.lineHeight)) };
  });
  test("never fewer lines than the browser", () => {
    expect(results.filter((r) => r.mine < r.lines)).toEqual([]);
  });
  test("at most one line wide, and exact on at least 95% of samples", () => {
    expect(results.filter((r) => r.mine > r.lines + 1)).toEqual([]);
    const exact = results.filter((r) => r.mine === r.lines).length;
    expect(exact / results.length).toBeGreaterThanOrEqual(0.95);
  });
});

import { describe, expect, it } from "bun:test";
import { findFractions } from "../text/fractions";
import { withFractionRuns } from "./fraction-runs";
import { paragraphsToTextProps } from "./pptx";
import type { RunParagraph } from "./runs";

/* PowerPoint gets the fractions the slide stacks (REVIEW-web #2), found by the same finder. */

const para = (...texts: string[]): RunParagraph => ({
  runs: texts.map((text) => ({ text })),
  level: 0,
});
const style = { fontFace: "Lexend", fontSize: 24, color: "2C2A24" };
/** The text with each numerator in ^() and each denominator in _(), as PowerPoint sets them. */
const shown = (paras: RunParagraph[], maths = false) =>
  paragraphsToTextProps(withFractionRuns(paras, maths), style)
    .map((p) =>
      p.options?.superscript ? `^(${p.text})` : p.options?.subscript ? `_(${p.text})` : p.text,
    )
    .join("");

describe("fractions in the PowerPoint export", () => {
  it("raises the numerator and lowers the denominator around the slash", () => {
    expect(shown([para("Find 3/4 of 20.")])).toBe("Find ^(3)/_(4) of 20.");
    expect(shown([para("x/4 + 3 = 8")])).toBe("^(x)/_(4) + 3 = 8");
    // A mixed number keeps its plain space; a run split across a fraction keeps its marks.
    expect(shown([para("= 7 1", "/2")])).toBe("= 7 ^(1)/_(2)");
    // A bracketed side keeps its brackets inline, so it cannot misread.
    expect(shown([para("(x + 2)/3 = 4")])).toBe("^((x + 2))/_(3) = 4");
  });
  it("leaves alone what the slide leaves as a slash", () => {
    for (const t of ["open 24/7", "a 50/50 chance", "speed in m/s", "on 2/9/1666"])
      expect(shown([para(t)])).toBe(t);
    // A word formula stacks only in a maths box, as on the screen.
    expect(shown([para("speed = distance/time")])).toBe("speed = distance/time");
    expect(shown([para("speed = distance/time")], true)).toBe("speed = ^(distance)/_(time)");
  });
  it("marks exactly the spans findFractions gives the screen, soft lines read as one text", () => {
    const lines = [para("Use 2/3 of 9."), { ...para("Then 1/2 + 1/4 = 3/4"), soft: true }];
    const text = "Use 2/3 of 9.\nThen 1/2 + 1/4 = 3/4";
    const want = findFractions(text).map((f) => text.slice(f.start, f.end));
    const got = shown(lines).match(/\^\([^)]*\)\/_\([^)]*\)/g) ?? [];
    expect(got.map((g) => g.replace(/[\^_()]/g, ""))).toEqual(want);
    expect(want).toEqual(["2/3", "1/2", "1/4", "3/4"]);
    // The text itself is unchanged: it copies and searches as written.
    expect(
      paragraphsToTextProps(withFractionRuns(lines), style)
        .map((p) => p.text)
        .join(""),
    ).toBe(text.replace("\n", ""));
  });
});

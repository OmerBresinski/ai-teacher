import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { balanceSlide, SIDE_PANEL_NAME, SPEECH_BUBBLE_NAME } from "./balance";
import { slideFits } from "./fit-check";
import fixture from "./fixtures/full-run-y1-balance.json";
import { SAFE } from "./grid";
import { getTheme } from "./themes";

/** FIX1: FULL-RUN y1 s2 (objectives), s4 (key-idea card) and s8 (discussion bubble), as generated. */
const theme = getTheme(fixture.theme);
const [objectives, keyIdea, discussion] = fixture.slides as unknown as Slide[];
const BOTTOM = SAFE.y + SAFE.h;

describe("balance", () => {
  test("the discussion prompt sits inside its bubble, the tail clear of the talk line", () => {
    const s = balanceSlide(discussion as Slide, theme);
    const b = s.elements.find((e) => e.name === SPEECH_BUBBLE_NAME)!;
    const [prompt, starters] = s.elements
      .filter((e) => e.type === "text")
      .sort((x, y) => x.y - y.y);
    expect(prompt!.y + prompt!.h).toBeLessThanOrEqual(b.y + b.h - 38 + 1);
    expect(b.y + b.h).toBeLessThanOrEqual(starters!.y);
    expect(slideFits(s, theme, 0).ok).toBe(true);
  });

  test("the key-idea card hugs its words and starts at the list's top", () => {
    const s = balanceSlide(keyIdea as Slide, theme);
    const panel = s.elements.find((e) => e.name === SIDE_PANEL_NAME)!;
    const before = (keyIdea as Slide).elements.find((e) => e.name === SIDE_PANEL_NAME)!;
    expect(panel.h).toBeLessThan(before.h * 0.7);
    const top = Math.min(
      ...(keyIdea as Slide).elements.filter((e) => e.name !== "Heading").map((e) => e.y),
    );
    // The card starts where the list does, under the heading: no centring.
    expect(panel.y).toBe(top);
    expect(slideFits(s, theme, 0).ok).toBe(true);
  });

  test("objectives rows start under the heading at their normal spacing (lists are not centred)", () => {
    const s = balanceSlide(objectives as Slide, theme);
    const rows = s.elements.filter((e) => e.name !== "Heading");
    const y0 = Math.min(...rows.map((e) => e.y));
    const y1 = Math.max(...rows.map((e) => e.y + e.h));
    const top0 = Math.min(
      ...(objectives as Slide).elements.filter((e) => e.name !== "Heading").map((e) => e.y),
    );
    expect(y0).toBe(top0);
    expect(y1).toBeLessThan(BOTTOM);
    expect(slideFits(s, theme, 0).ok).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { CALLOUT_KINDS, parseLesson, type TextPreset } from "@tj/domain/documents";
import { newLesson, newSlide } from "./factories";
import {
  calloutTone,
  DEFAULT_THEME_ID,
  FIT_VERSION,
  fontFloor,
  getTheme,
  MIN_FONT_SIZE,
  THEME_TAG_LABELS,
  THEMES,
} from "./themes";

describe("theme catalogue", () => {
  test("six themes; an unknown id falls back to chalk", () => {
    expect(THEMES).toHaveLength(6);
    expect(DEFAULT_THEME_ID).toBe("chalk");
    expect(getTheme("nope").id).toBe("chalk");
    expect(getTheme(undefined).id).toBe("chalk");
    expect(getTheme("night-lab").dark).toBe(true);
  });

  test("every theme has a size and line height for every preset, and a label for every tag", () => {
    const presets: TextPreset[] = ["title", "subtitle", "heading", "body", "small", "caption"];
    for (const theme of THEMES) {
      for (const preset of presets) {
        expect(theme.sizes[preset]).toBeGreaterThan(0);
        expect(theme.lineHeights[preset]).toBeGreaterThan(0);
      }
      for (const tag of theme.tags) expect(THEME_TAG_LABELS[tag]).toBeTruthy();
      expect(theme.fonts.title).toContain("var(--font-");
    }
  });

  test("font floors: the preset's role unless a role is named", () => {
    expect(fontFloor("title")).toBe(MIN_FONT_SIZE.title);
    expect(fontFloor("subtitle")).toBe(MIN_FONT_SIZE.title);
    expect(fontFloor("heading")).toBe(26);
    expect(fontFloor("heading", "question")).toBe(38);
    expect(fontFloor("small", "option")).toBe(31);
    expect(fontFloor("caption")).toBe(14);
    expect(FIT_VERSION).toBe(2);
  });

  test("a slide of every kind on every theme parses", () => {
    const lesson = newLesson("All kinds");
    for (const theme of THEMES) {
      lesson.slides = [
        "blank",
        "title",
        "objectives",
        "starter",
        "vocabulary",
        "content",
        "image-text",
        "worked-example",
        "instructions",
        "discussion",
        "true-false",
        "multiple-choice",
        "matching",
        "image-match",
        "fill-gap",
        "sort",
        "open-response",
        "exit-ticket",
        "timer",
        "plenary",
      ].map((kind) => newSlide(kind as Parameters<typeof newSlide>[0], theme.id));
      expect(() => parseLesson(JSON.parse(JSON.stringify(lesson)))).not.toThrow();
    }
  });
});

/** WCAG 2 contrast ratio between two `#RRGGBB` colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("callout tones", () => {
  for (const theme of THEMES) {
    test(`${theme.id}: each card's ink reads at 7:1, its icon at 4.5:1, and the card stands off the ground`, () => {
      for (const kind of CALLOUT_KINDS) {
        const tone = calloutTone(theme, kind);
        expect(contrast(tone.ink, tone.fill), `${kind} ink`).toBeGreaterThanOrEqual(7);
        expect(contrast(tone.icon, tone.fill), `${kind} icon`).toBeGreaterThanOrEqual(4.5);
        // The hairline (light) or the wash (dark) is what separates the card from the slide.
        expect(contrast(tone.line, theme.colors.background), `${kind} edge`).toBeGreaterThan(1.3);
      }
    });
  }
});

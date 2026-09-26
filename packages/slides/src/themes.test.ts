import { describe, expect, test } from "bun:test";
import { parseLesson, type TextPreset } from "@tj/domain/documents";
import { newLesson, newSlide } from "./factories";
import {
  DEFAULT_THEME_ID,
  FIT_VERSION,
  fontFloor,
  getTheme,
  MIN_FONT_SIZE,
  THEME_TAG_LABELS,
  THEMES,
} from "./themes";

describe("theme catalogue", () => {
  test("ten themes; the six older ids still resolve; an unknown id falls back to chalk", () => {
    expect(THEMES).toHaveLength(10);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const id of ["chalk", "playground", "reading-room", "exam-hall", "night-lab", "beacon"]) {
      expect(getTheme(id).id).toBe(id);
    }
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

  test("every ink, muted and accent colour is WCAG AA on every colour it can sit on", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const t of THEMES) {
      const c = t.colors;
      // The ground, the cards, and every colour the theme's background art paints.
      const grounds = [
        c.background,
        c.surface,
        ...(t.backgroundImage?.match(/#[0-9a-f]{6}/gi) ?? []),
      ];
      for (const ground of grounds) {
        for (const [name, fg] of Object.entries({
          ink: c.ink,
          heading: c.heading ?? c.ink,
          muted: c.muted,
          accent: c.accent,
        })) {
          expect(ratio(fg, ground), `${t.id} ${name} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(ratio(c.onAccent, c.accent), `${t.id} onAccent`).toBeGreaterThanOrEqual(4.5);
      for (const [name, fg] of Object.entries({ correct: c.correct, incorrect: c.incorrect })) {
        expect(ratio(fg, c.surface), `${t.id} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
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

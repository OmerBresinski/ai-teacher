import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { SLIDE_H } from "@tj/domain/documents";
import { SAFE } from "./grid";
import {
  ACCENT_BAR_NAME,
  accentTint,
  applyLook,
  HEADING_NAME,
  KEY_IDEA_NAME,
  KIND_TAG_NAME,
  mix,
} from "./look";
import { materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { getTheme, THEMES } from "./themes";

const META = { promptVersion: "test", model: "test", at: "2026-09-26T00:00:00.000Z" };
const counter = () => {
  let n = 0;
  return () => `e${++n}`;
};
const named = (slide: Slide, name: string) => slide.elements.filter((e) => e.name === name);
const plain = (el: TextElement) =>
  JSON.stringify(el.doc)
    .match(/"text":"([^"]*)"/g)
    ?.map((m) => m.slice(8, -1))
    .join("") ?? "";

describe("the lesson look", () => {
  test("mix blends two colours and the tint sits between accent and background", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    const chalk = getTheme("chalk");
    expect(accentTint(chalk)).not.toBe(chalk.colors.background);
    expect(accentTint(chalk)).not.toBe(chalk.colors.accent);
  });

  for (const theme of THEMES) {
    test(`${theme.id}: the title is a cover on the accent, its text in the accent's ink`, () => {
      const slide = materialiseSlide(
        { kind: "title", title: "Coastal erosion", subtitle: "Year 9 · Geography", factRefs: [] },
        theme.id,
        META,
        counter(),
      );
      expect(slide.background?.color).toBe(theme.colors.accent);
      const title = slide.elements.find(
        (e): e is TextElement => e.type === "text" && e.style.preset === "title",
      );
      expect(title?.style.color).toBe(theme.colors.onAccent);
      expect(named(slide, ACCENT_BAR_NAME)).toHaveLength(0);
    });

    test(`${theme.id}: a teaching slide takes a tag, a named heading, a lead, a card and the bar`, () => {
      const slide = materialiseSlide(
        {
          kind: "content",
          heading: "Hydraulic action widens cracks",
          body: "Hydraulic action is erosion by trapped air. Waves force air into cracks and squeeze it.",
          factRefs: ["k1"],
        },
        theme.id,
        META,
        counter(),
      );
      const [tag] = named(slide, KIND_TAG_NAME) as TextElement[];
      expect(tag && plain(tag)).toBe("TEACH");
      expect(tag?.y).toBe(SAFE.y);
      const [heading] = named(slide, HEADING_NAME) as TextElement[];
      expect(heading?.style.fontSize).toBeUndefined();
      expect(heading && tag && heading.y).toBeGreaterThanOrEqual((tag?.y ?? 0) + (tag?.h ?? 0));
      const [card] = named(slide, KEY_IDEA_NAME) as TextElement[];
      expect(card && plain(card)).toBe("Waves force air into cracks and squeeze it.");
      expect(card?.style.background).toBe(accentTint(theme));
      const [bar] = named(slide, ACCENT_BAR_NAME);
      expect(bar?.y).toBe(SLIDE_H - (bar?.h ?? 0));
      for (const el of slide.elements) {
        if (el.type === "text") expect(el.y + el.h).toBeLessThanOrEqual(SAFE_BOTTOM);
      }
    });
  }

  test("a question slide keeps its composition and takes the bar alone", () => {
    const slide = materialiseSlide(
      {
        kind: "true-false",
        statement: "Sound travels through a vacuum.",
        correct: false,
        explanation: "Sound needs particles to pass the vibration on.",
        factRefs: ["q1"],
      },
      "chalk",
      META,
      counter(),
    );
    expect(named(slide, KIND_TAG_NAME)).toHaveLength(0);
    expect(named(slide, ACCENT_BAR_NAME)).toHaveLength(1);
  });

  test("is idempotent: a styled slide is returned as it is", () => {
    const theme = getTheme("chalk");
    const slide = materialiseSlide(
      { kind: "starter", heading: "Do now", items: ["What is sediment?"], factRefs: [] },
      "chalk",
      META,
      counter(),
    );
    expect(applyLook(slide, theme)).toBe(slide);
  });
});

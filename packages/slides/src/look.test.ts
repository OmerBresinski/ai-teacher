import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { slideBackground } from "./background";
import { SAFE } from "./grid";
import { layoutSlide } from "./layouts";
import {
  ACCENT_BAR_NAME,
  accentTint,
  applyLook,
  contrastRatio,
  HEADING_DISPLAY,
  HEADING_NAME,
  KEY_IDEA_NAME,
  KIND_TAG_NAME,
  mix,
  panelFill,
} from "./look";
import { materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import {
  BODY_NAME,
  BULLET_NAME,
  ITEM_NAME,
  LEAD_NAME,
  PANEL_NAME,
  PANEL_TEXT_NAME,
} from "./structure";
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

  test("a theme without title art keeps the cover on its own ground (ruling 162)", () => {
    const bare = { ...getTheme("studio"), backgrounds: undefined };
    const laid = layoutSlide("title", "studio");
    const slide = applyLook({ id: "t", kind: "title", elements: laid.elements }, bare);
    expect(slide.background?.color).toBeUndefined();
    const title = slide.elements.find(
      (e): e is TextElement => e.type === "text" && e.style.preset === "title",
    );
    expect(title?.style.color).toBeUndefined();
  });

  for (const theme of THEMES) {
    test(`${theme.id}: accent text keeps 4.5:1 on the accent tint`, () => {
      expect(contrastRatio(theme.colors.accent, accentTint(theme))).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const theme of THEMES) {
    test(`${theme.id}: the title is a cover on the ground under the theme's title art (ruling 107)`, () => {
      const slide = materialiseSlide(
        { kind: "title", title: "Coastal erosion", subtitle: "Year 9 · Geography", factRefs: [] },
        theme.id,
        META,
        counter(),
      );
      expect(slide.background?.color).toBeUndefined();
      expect(slideBackground(theme, slide)).toBeTruthy();
      const title = slide.elements.find(
        (e): e is TextElement => e.type === "text" && e.style.preset === "title",
      );
      expect(title?.style.color).toBeUndefined();
      expect(named(slide, ACCENT_BAR_NAME)).toHaveLength(0);
    });

    test(`${theme.id}: a teaching slide takes no tag, a display heading at the top and the two columns`, () => {
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
      // No "TEACH" tag (Greg, 26 Sept): the heading takes the top lane, no empty band above it.
      expect(named(slide, KIND_TAG_NAME)).toHaveLength(0);
      const [heading] = named(slide, HEADING_NAME) as TextElement[];
      // A short heading is a display line, a third above the theme's heading size.
      expect(heading?.style.fontSize).toBe(Math.round(theme.sizes.heading * HEADING_DISPLAY));
      expect(heading?.y).toBe(SAFE.y);
      // No empty right half: the key idea sits on a tinted panel, the rest down the left.
      const [panel] = named(slide, PANEL_NAME);
      expect(panel && panel.type === "shape" && panel.fill).toBe(panelFill(theme));
      const [idea] = named(slide, PANEL_TEXT_NAME) as TextElement[];
      expect(idea && plain(idea)).toBe("Hydraulic action is erosion by trapped air.");
      const [rest] = named(slide, BODY_NAME) as TextElement[];
      expect(rest && plain(rest)).toBe("Waves force air into cracks and squeeze it.");
      expect((rest?.x ?? 0) + (rest?.w ?? 0)).toBeLessThanOrEqual(panel?.x ?? 0);
      expect(named(slide, KEY_IDEA_NAME)).toHaveLength(0);
      // No foot bar (Greg, 5 Oct 2026, ruling 159): a slide is its heading and its content.
      expect(named(slide, ACCENT_BAR_NAME)).toHaveLength(0);
      for (const el of slide.elements) {
        if (el.type === "text") expect(el.y + el.h).toBeLessThanOrEqual(SAFE_BOTTOM);
      }
    });
  }

  test("look/headings: a lead with points: the lead stays the lead, the points as dot bullets", () => {
    const slide = materialiseSlide(
      {
        kind: "content",
        heading: "Types of volcano",
        body: "Volcanoes are grouped by the shape their lava builds.",
        points: ["shield: runny lava, gentle slopes", "composite: layers of ash and lava"],
        factRefs: ["k1"],
      },
      "chalk",
      META,
      counter(),
    );
    // The writer's own list (shape `list`): no key term to set beside it, so no panel takes the lead.
    const [lead] = named(slide, LEAD_NAME) as TextElement[];
    expect(lead && plain(lead)).toBe("Volcanoes are grouped by the shape their lava builds.");
    expect(named(slide, PANEL_TEXT_NAME)).toHaveLength(0);
    const points = named(slide, ITEM_NAME) as TextElement[];
    expect(points.map(plain)).toEqual([
      "shield: runny lava, gentle slopes",
      "composite: layers of ash and lava",
    ]);
    expect(named(slide, BULLET_NAME)).toHaveLength(2);
    expect(named(slide, KEY_IDEA_NAME)).toHaveLength(0);
  });

  test("a question slide keeps its composition and takes no chrome", () => {
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
    expect(named(slide, ACCENT_BAR_NAME)).toHaveLength(0);
  });

  test("is idempotent: a second pass changes nothing", () => {
    const theme = getTheme("chalk");
    const slide = materialiseSlide(
      { kind: "starter", heading: "Do now", items: ["What is sediment?"], factRefs: [] },
      "chalk",
      META,
      counter(),
    );
    expect(applyLook(slide, theme)).toEqual(slide);
  });
});

describe("one heading size across a deck (P19-14)", () => {
  const meta = { promptVersion: "t", model: "m", at: "2026-09-27T00:00:00.000Z" };
  const headingSize = (spec: Parameters<typeof materialiseSlide>[0]) =>
    (
      materialiseSlide(spec, "chalk", meta).elements.find((e) => e.name === HEADING_NAME) as
        | TextElement
        | undefined
    )?.style.fontSize;

  test("a teaching slide and a one-line activity heading share the display size", () => {
    const display = Math.round(getTheme("chalk").sizes.heading * HEADING_DISPLAY);
    expect(
      headingSize({
        kind: "content",
        heading: "Why the Romans invaded",
        body: "Rome wanted metals.",
        factRefs: [],
      }),
    ).toBe(display);
    expect(
      headingSize({
        kind: "starter",
        heading: "Do now",
        items: ["What is an empire?", "What is an invasion?"],
        factRefs: [],
      } as never),
    ).toBe(display);
  });
});

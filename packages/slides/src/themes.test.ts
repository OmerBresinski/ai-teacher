import { describe, expect, test } from "bun:test";
import {
  CALLOUT_KINDS,
  type CalloutKind,
  parseLesson,
  type TextPreset,
  type Theme,
} from "@tj/domain/documents";
import { artOf as themeArtOf } from "./art";
import { newLesson, newSlide } from "./factories";
import { withThemeColours } from "./theme-colours";
import {
  CALLOUT_TONES,
  calloutTone,
  calloutTones,
  DEFAULT_THEME_ID,
  FIT_VERSION,
  fontFloor,
  getTheme,
  MIN_FONT_SIZE,
  THEME_TAG_LABELS,
  THEMES,
} from "./themes";

/** Every piece of a theme's art, per role and mirrored, and its single background, as one string. */
const artOf = (t: Theme) =>
  [
    t.backgroundImage ?? "",
    ...Object.values(themeArtOf(t) ?? {}).flatMap((layers) =>
      (layers ?? []).flatMap((l) => [l.image, l.flipped ?? ""]),
    ),
  ].join(" ");

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
      // The ground, the cards, the panels, and every colour the theme's background art paints
      // (an inline SVG's colours are URI-encoded).
      const grounds = [
        c.background,
        c.surface,
        ...(c.panel ? [c.panel] : []),
        ...(decodeURIComponent(artOf(t)).match(/#[0-9a-f]{6}/gi) ?? []),
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
    expect(FIT_VERSION).toBe(3);
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
        "diagram",
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

  test("themes-v2: the four playful themes differ in more than colour (Greg: the accent circles were too alike)", () => {
    const playful = ["playground", "crayon", "splash", "treehouse"].map((id) => getTheme(id));
    const distinct = (pick: (t: (typeof playful)[number]) => unknown) =>
      new Set(playful.map((t) => JSON.stringify(pick(t)))).size;
    expect(distinct((t) => t.ornament?.marker)).toBe(4);
    expect(distinct((t) => t.fonts.title)).toBe(4);
    expect(distinct((t) => [t.ornament?.tag, t.ornament?.tagRadius])).toBe(4);
    expect(distinct((t) => t.colors.panel)).toBe(4);
    expect(distinct((t) => t.radius)).toBe(4);
    // No theme's art is the old corner blob any more.
    for (const t of playful) expect(artOf(t)).not.toContain("radial-gradient(circle");
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

/** Hue in degrees of a hex colour, for the family check; 0 for a grey. */
function hue(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (Math.round(h * 60) + 360) % 360;
}

/** The hue band each kind keeps on every theme, read off the icon (the kind's fullest colour). */
const FAMILY: Record<CalloutKind, (h: number) => boolean> = {
  "watch-out": (h) => h >= 340 || h <= 20, // red
  example: (h) => h >= 120 && h <= 170, // green
  "key-words": (h) => h >= 30 && h <= 50, // amber
};

describe("callout tones", () => {
  test("every theme has its own set, keyed by id", () => {
    for (const theme of THEMES) expect(CALLOUT_TONES[theme.id]).toBeDefined();
    expect(new Set(THEMES.map((t) => JSON.stringify(calloutTones(t)))).size).toBe(THEMES.length);
  });

  test("a theme the table does not know takes Chalk's set, or Night Lab's when dark", () => {
    const chalk = getTheme("chalk");
    const night = getTheme("night-lab");
    expect(calloutTones({ ...chalk, id: "new-light" })).toBe(calloutTones(chalk));
    expect(calloutTones({ ...night, id: "new-dark" })).toBe(calloutTones(night));
  });

  for (const theme of THEMES) {
    test(`${theme.id}: each card's ink reads at 7:1, its icon at 4.5:1, the card stands off the ground, and each kind keeps its family`, () => {
      for (const kind of CALLOUT_KINDS) {
        const tone = calloutTone(theme, kind);
        expect(tone).toBe(calloutTones(theme)[kind]);
        // AAA for the label and text, AA for the icon (a graphic, so 3:1 would do; it gets more).
        expect(contrast(tone.ink, tone.fill), `${kind} ink`).toBeGreaterThanOrEqual(7);
        expect(contrast(tone.icon, tone.fill), `${kind} icon`).toBeGreaterThanOrEqual(4.5);
        // The hairline (light) or the wash (dark) is what separates the card from the slide.
        expect(contrast(tone.line, theme.colors.background), `${kind} edge`).toBeGreaterThan(1.3);
        expect(FAMILY[kind](hue(tone.icon)), `${kind} icon hue ${hue(tone.icon)}`).toBe(true);
        expect(FAMILY[kind](hue(tone.ink)), `${kind} ink hue ${hue(tone.ink)}`).toBe(true);
      }
    });
  }

  test("beacon: the hairline itself is AA against the tint and the ground, like its other edges", () => {
    const beacon = getTheme("beacon");
    for (const kind of CALLOUT_KINDS) {
      const tone = calloutTone(beacon, kind);
      expect(contrast(tone.line, tone.fill), `${kind} line on fill`).toBeGreaterThanOrEqual(3);
      expect(
        contrast(tone.line, beacon.colors.background),
        `${kind} line on ground`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

/*
 * Card and chrome colours come from the theme at render time (`withThemeColours`): every text the
 * look sets on a card or the ground reads at WCAG AA in every theme. Card text (ink) and the
 * reason column (muted, small) need 4.5:1; the badge numerals (onAccent on accent) and the
 * revealed answer (accent, bold, at least 29 px: large text) need 3:1.
 */
describe("look colours reach WCAG AA on every theme", () => {
  for (const theme of THEMES) {
    test(`${theme.id}: card and chrome pairs`, () => {
      const c = theme.colors;
      const card = c.surface;
      expect(contrast(c.ink, card), "ink on card").toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.ink, c.background), "ink on ground").toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.muted, card), "muted on card").toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.onAccent, c.accent), "badge").toBeGreaterThanOrEqual(3);
      expect(contrast(c.accent, card), "answer on card").toBeGreaterThanOrEqual(3);
    });
  }
  test("a chalk slide shown in Night Lab takes Night Lab's card, bar and ink", () => {
    const chalk = getTheme("chalk");
    const night = getTheme("night-lab");
    const slide = {
      id: "s",
      kind: "content" as const,
      elements: [
        {
          id: "c",
          type: "shape" as const,
          shape: "rounded" as const,
          x: 0,
          y: 0,
          w: 9,
          h: 9,
          fill: chalk.colors.surface,
          stroke: chalk.colors.line,
          name: "Compare card",
        },
        {
          id: "b",
          type: "shape" as const,
          shape: "rect" as const,
          x: 0,
          y: 531,
          w: 960,
          h: 9,
          fill: chalk.colors.accent,
          name: "Accent bar",
        },
        {
          id: "o",
          type: "shape" as const,
          shape: "rect" as const,
          x: 0,
          y: 0,
          w: 9,
          h: 9,
          fill: "#123456",
        },
      ],
    };
    const [card, bar, own] = withThemeColours(slide, night).elements as {
      fill?: string;
      stroke?: string;
    }[];
    expect(card?.fill).toBe(night.colors.surface);
    expect(card?.stroke).toBe(night.colors.line);
    expect(bar?.fill).toBe(night.colors.accent);
    expect(own?.fill).toBe("#123456");
    expect(contrast(night.colors.ink, card?.fill ?? "")).toBeGreaterThanOrEqual(4.5);
  });
});

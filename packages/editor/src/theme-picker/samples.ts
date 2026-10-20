import { type Lesson, richDocToPlainText, type Slide, type Theme } from "@tj/domain/documents";
import { DEMO_LESSON_SPECS, demoLessonSlides } from "@tj/slides";
import { FONT_LABELS, FONT_STACKS, type FontKey } from "@tj/slides/fonts";
import { getTheme, THEME_TAG_LABELS, THEMES } from "../model/themes";

/*
 * What the theme picker draws (Greg, decision 34): each theme's own cover, a starter slide and a
 * check question, laid out by the materialiser that writes a generated lesson (the demo lesson's
 * specs, the cover carrying the teacher's title), so every tile shows the theme's approved
 * composition (TEACH-215 part g), never a recoloured copy of another theme's slide.
 * Built once per title, theme and age band and cached for the session, so reopening the picker
 * costs nothing.
 */

export type ThemeSamples = {
  theme: Theme;
  cover: Slide;
  content: Slide;
  check: Slide;
  /** Every slide of the sample lesson (the debug sheet). */
  all: Slide[];
};

const MAX_CACHED = 96;
const cache = new Map<string, ThemeSamples>();

/** Which sample slides the picker shows (indices into the demo lesson). */
// The "Do now" starter: its eyebrow chip and numbered badges carry the theme's shapes and accent;
// the true/false check carries its answer cards (a sheet of all ten demo slides in all sixteen
// themes, 20 Oct: the cover and the starter differ most from theme to theme).
export const SAMPLE_PICK = { content: 2, check: 8 };

/**
 * The theme's sample slides for a lesson called `title` (with `subtitle` on the cover, or none),
 * at `ageBand`'s type scale when given: the demo lesson laid out by the real materialiser.
 */
export function themeSamples(
  themeId: string,
  title: string,
  ageBand?: string | null,
  subtitle?: string,
): ThemeSamples {
  const key = `${themeId}\u0000${title}\u0000${ageBand ?? ""}\u0000${subtitle ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const specs = DEMO_LESSON_SPECS.map((spec) =>
    spec.kind === "title" ? { ...spec, title, subtitle: subtitle ?? "" } : spec,
  );
  const { slides } = demoLessonSlides(themeId, { specs });
  const cover = slides[0];
  const content = slides[SAMPLE_PICK.content];
  const check = slides[SAMPLE_PICK.check];
  if (!cover || !content || !check) throw new Error("sample lesson is missing a slide");
  const samples = { theme: getTheme(themeId, ageBand), cover, content, check, all: slides };
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, samples);
  return samples;
}

/**
 * The words an existing lesson's own cover carries, for the previews: its title and its second
 * line as the teacher sees them ("Year 5. Where rain comes from"), else the lesson's title and its
 * year and subject. A preview never invents a class the lesson is not for.
 */
export function coverWords(lesson: Lesson): { title: string; subtitle: string } {
  const cover = lesson.slides.find((s) => s.kind === "title");
  const textAt = (preset: string): string | undefined => {
    for (const el of cover?.elements ?? []) {
      if (el.type !== "text" || el.style?.preset !== preset || !el.doc) continue;
      const text = richDocToPlainText(el.doc).trim();
      if (text) return text;
    }
    return undefined;
  };
  return {
    title: textAt("title") ?? lesson.title,
    subtitle: textAt("subtitle") ?? [lesson.yearGroup, lesson.subject].filter(Boolean).join(" · "),
  };
}

/** Test seam: how many sample sets are cached. */
export const cachedSampleCount = (): number => cache.size;

const FONT_BY_STACK = new Map<string, string>(
  (Object.keys(FONT_STACKS) as FontKey[]).map((key) => [FONT_STACKS[key], FONT_LABELS[key]]),
);

/** The family a stack names first, as a teacher reads it ("Fredoka"). */
export function fontName(stack: string): string {
  const known = FONT_BY_STACK.get(stack);
  if (known) return known;
  const first = stack.split(",")[0] ?? stack;
  return first.replace(/var\(--font-|\)|["']/g, "").trim();
}

/** "Fredoka and Nunito", or one name when the title and the body share a family. */
export function fontPair(theme: Theme): { title: string; body: string; label: string } {
  const title = fontName(theme.fonts.title);
  const body = fontName(theme.fonts.body);
  return { title, body, label: title === body ? title : `${title} and ${body}` };
}

/** The colours a teacher sees on the slides: ground, cards, ink, headings and the two accents. */
export function paletteOf(theme: Theme): { name: string; value: string }[] {
  const c = theme.colors;
  const all = [
    { name: "Background", value: c.background },
    { name: "Cards", value: c.panel ?? c.surface },
    { name: "Text", value: c.ink },
    { name: "Headings", value: c.heading ?? c.ink },
    { name: "Accent", value: c.accent },
    { name: "Second accent", value: c.accent2 },
  ];
  const seen = new Set<string>();
  return all.filter(({ value }) => {
    const v = value.toLowerCase();
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

/** Who a theme suits: its age line (the first sentence of `suits`, up to a colon) and its look. */
export function suitsOf(theme: Theme): { who: string; look: string } {
  const [first = theme.suits, ...rest] = theme.suits.split(/(?<=\.)\s+/);
  // "Any age, for a calm room: flat, muted, ..." reads as who, then the look.
  const [who = first, detail] = first.replace(/\.$/, "").split(/:\s+/);
  const look = [detail ? `${detail[0]?.toUpperCase()}${detail.slice(1)}.` : "", ...rest];
  return { who, look: look.filter(Boolean).join(" ") };
}

export type ThemeTagId = Theme["tags"][number];

/** The filter chips: every tag a picker theme carries, in the labels' order. */
export const FILTER_TAGS: ThemeTagId[] = (Object.keys(THEME_TAG_LABELS) as ThemeTagId[]).filter(
  (tag) => THEMES.some((t) => t.tags.includes(tag)),
);

export const tagLabel = (tag: ThemeTagId): string => THEME_TAG_LABELS[tag];

/** The groups the card variant lists, each theme in the first group it fits. */
export const THEME_GROUPS: { id: string; label: string; fits: (t: Theme) => boolean }[] = [
  {
    id: "young",
    label: "For younger classes",
    fits: (t) => t.tags.includes("early-learners"),
  },
  {
    id: "dark",
    label: "For a dark room",
    fits: (t) => t.tags.includes("dark") || Boolean(t.dark),
  },
  {
    id: "calm",
    label: "Calm and accessible",
    fits: (t) => t.tags.some((tag) => tag !== "early-learners" && tag !== "dark"),
  },
  { id: "everyday", label: "Everyday", fits: () => true },
];

export function groupThemes(themes: Theme[]): { id: string; label: string; themes: Theme[] }[] {
  const placed = new Set<string>();
  return THEME_GROUPS.map((group) => {
    const members = themes.filter((t) => !placed.has(t.id) && group.fits(t));
    for (const t of members) placed.add(t.id);
    return { id: group.id, label: group.label, themes: members };
  }).filter((g) => g.themes.length > 0);
}
